import { onBeforeUnmount, onMounted, onUnmounted, watch, type Ref } from "vue";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useRouter } from "vue-router";
import { useMusicStore, useStatusStore } from "@/stores";
import { useOrientationTransition } from "@/composables/useOrientationTransition";
import { AndroidNativePlayback } from "@/plugins/androidNativePlayback";

const ROOT_PATHS = new Set(["/", "/home"]);

/**
 * 安卓返回键处理栈
 *
 * 子级 UI（n-modal / n-drawer / 自定义弹层）在打开时注册自己的 back 处理函数，
 * useAndroidBack 在分发返回事件时优先消费栈顶处理器。
 * - 处理函数返回 true：表示已消化本次 back，停止后续分发
 * - 返回 false / undefined：放行，继续走下一层
 */
export type BackHandler = () => boolean | void | Promise<boolean | void>;

const backHandlerStack: BackHandler[] = [];

/** 注册 back 处理器，返回反注册函数 */
export const pushBackHandler = (handler: BackHandler): (() => void) => {
  backHandlerStack.push(handler);
  return () => {
    const idx = backHandlerStack.lastIndexOf(handler);
    if (idx !== -1) backHandlerStack.splice(idx, 1);
  };
};

/** setup 内自动绑定，onMounted 推栈、onBeforeUnmount 出栈 */
export const useBackHandler = (handler: BackHandler): void => {
  let off: (() => void) | null = null;
  onMounted(() => {
    off = pushBackHandler(handler);
  });
  onBeforeUnmount(() => {
    off?.();
    off = null;
  });
};

/**
 * v-model:show ref 接入返回键
 * options.onBack 返回 true 表示已消费但不关闭，用于多层级逐层折叠
 */
export const useBackClosable = (
  showRef: Ref<boolean>,
  options?: { onBack?: () => boolean | void },
): void => {
  let off: (() => void) | null = null;
  const detach = () => {
    off?.();
    off = null;
  };
  const stop = watch(
    showRef,
    (visible) => {
      if (visible) {
        if (off) return;
        off = pushBackHandler(() => {
          // 给上层消费机会
          if (options?.onBack?.() === true) return true;
          // self-cleanup 防连按 race
          detach();
          showRef.value = false;
          return true;
        });
      } else {
        detach();
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    stop();
    detach();
  });
};

/** 从栈顶向下分发，handler 抛错视为已处理 */
const dispatchBackStack = async (): Promise<boolean> => {
  for (let i = backHandlerStack.length - 1; i >= 0; i--) {
    const handler = backHandlerStack[i];
    try {
      const handled = await handler();
      if (handled === true) return true;
    } catch (e) {
      console.warn("[useAndroidBack] back handler threw, treated as handled", e);
      return true;
    }
  }
  return false;
};

/** 能否 router.back：看 history.state.back，比 history.length 可靠 */
const canRouterBack = (currentPath: string): boolean => {
  if (ROOT_PATHS.has(currentPath)) return false;
  const state = window.history.state as { back?: string | null } | null;
  return !!state && typeof state.back === "string" && state.back.length > 0;
};

export const useAndroidBack = () => {
  const router = useRouter();
  const statusStore = useStatusStore();
  const musicStore = useMusicStore();
  const orientationTransition = useOrientationTransition();
  let listener: PluginListenerHandle | null = null;
  // 防 addListener race：resolve 前组件卸载则后续移除新 handle
  let cancelled = false;
  // 沉浸式退出期间防重入（覆盖整个 ~670ms 动画）
  let immersiveExiting = false;
  // 退出确认弹窗单例标志
  let exitConfirmShown = false;

  /** 退出确认弹窗：back 可关闭，不走全局 modal 包装器所以手动接栈 */
  const showExitConfirm = () => {
    if (exitConfirmShown) return;
    exitConfirmShown = true;
    let off: (() => void) | null = null;
    const dialog = window.$dialog.warning({
      title: "退出 SPlayer",
      content: "确定要退出吗？",
      positiveText: "退出",
      negativeText: "取消",
      autoFocus: false,
      onPositiveClick: async () => {
        // 优先走原生 shutdownApp：停前台服务再强杀进程；失败兜底 exitApp
        try {
          await AndroidNativePlayback.shutdownApp();
        } catch (e) {
          console.warn("[useAndroidBack] shutdownApp failed, fallback to exitApp", e);
          await CapacitorApp.exitApp();
        }
      },
      onAfterLeave: () => {
        off?.();
        off = null;
        exitConfirmShown = false;
      },
    });
    off = pushBackHandler(() => {
      // self-cleanup 防连按 race
      off?.();
      off = null;
      dialog.destroy();
      return true;
    });
  };

  onMounted(async () => {
    if (Capacitor.getPlatform() !== "android") return;

    const handle = await CapacitorApp.addListener("backButton", async () => {
      // 0) 子级弹层
      if (await dispatchBackStack()) return;
      // 1) 搜索遮罩
      if (statusStore.searchFocus) {
        statusStore.searchFocus = false;
        return;
      }
      // 2) 播放列表面板
      if (statusStore.playListShow) {
        statusStore.playListShow = false;
        return;
      }
      // 3) 播放器评论面板
      if (statusStore.showPlayerComment) {
        statusStore.showPlayerComment = false;
        return;
      }
      // 4) 沉浸式横屏
      if (statusStore.isImmersiveFullscreen) {
        // 其他入口已在 exit，本次吞即可
        if (orientationTransition.isTransitioning.value) return;
        if (immersiveExiting) return;
        immersiveExiting = true;
        try {
          await orientationTransition.exit(musicStore.songCover);
        } finally {
          immersiveExiting = false;
        }
        return;
      }
      // 5) 全屏播放器
      if (statusStore.showFullPlayer) {
        statusStore.showFullPlayer = false;
        return;
      }
      // 6) 路由回退
      if (canRouterBack(router.currentRoute.value.path)) {
        await router.back();
        return;
      }
      // 7) 已到根，弹确认框
      showExitConfirm();
    });

    if (cancelled) {
      handle.remove();
      return;
    }
    listener = handle;
  });

  onUnmounted(() => {
    cancelled = true;
    listener?.remove();
    listener = null;
  });
};
