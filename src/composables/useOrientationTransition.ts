import { computed, nextTick, ref, watch } from "vue";
import { useDevice } from "@/composables/useDevice";
import { useOrientationLock } from "@/composables/useOrientationLock";
import { useStatusStore } from "@/stores";
import { isCapacitorAndroid } from "@/utils/env";

// 横竖屏切换状态机：Backdrop + Hero + Stagger

export type OrientationPhase =
  | "idle"
  | "enter-rising"
  | "enter-rotating"
  | "enter-revealing"
  | "exit-collapsing"
  | "exit-rotating"
  | "exit-revealing";

export type CoverKind = "portrait" | "landscape";

// 模块级单例：组件 unmount 不打断状态机
const phase = ref<OrientationPhase>("idle");
const heroToRect = ref<DOMRect | null>(null);
const heroSrc = ref<string>("");
let busy = false;

const portraitCoverEl = ref<HTMLElement | null>(null);
const landscapeCoverEl = ref<HTMLElement | null>(null);

// 减少动效偏好
const reduce = ref(false);
if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduce.value = mq.matches;
  mq.addEventListener?.("change", (e) => {
    reduce.value = e.matches;
  });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等 condition 变 true，超时也 resolve（避免死锁） */
const waitFor = (cond: () => boolean, timeout = 800): Promise<void> =>
  new Promise((resolve) => {
    if (cond()) {
      resolve();
      return;
    }
    let resolved = false;
    const stop = watch(cond, (v) => {
      if (v && !resolved) {
        resolved = true;
        stop();
        resolve();
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stop();
        resolve();
      }
    }, timeout);
  });

const measure = (el: HTMLElement | null): DOMRect | null => {
  if (!el || !el.isConnected) return null;
  return el.getBoundingClientRect();
};

// 仅重置 phase / busy；heroToRect 保留到下次 enter/exit 起手再清，避免 Hero leave 动画期间丢 rect 塌陷到 0×0
const cleanup = () => {
  phase.value = "idle";
  busy = false;
};

export const useOrientationTransition = () => {
  const statusStore = useStatusStore();
  const { isPhonePortrait } = useDevice();
  const { lockPortrait } = useOrientationLock();

  // 注册 cover 元素
  const setCoverEl = (el: HTMLElement | null, kind: CoverKind) => {
    if (kind === "portrait") portraitCoverEl.value = el;
    else landscapeCoverEl.value = el;
  };

  // 是否处于过渡中
  const isTransitioning = computed(() => phase.value !== "idle");

  // 揭幕阶段
  const isRevealing = computed(
    () => phase.value === "enter-revealing" || phase.value === "exit-revealing",
  );

  // 横屏元素收起阶段
  const isCollapsing = computed(() => phase.value === "exit-collapsing");

  // 入场：竖屏 → 沉浸式横屏
  const enter = async (coverSrc: string): Promise<boolean> => {
    if (busy) return false;
    if (!isCapacitorAndroid) {
      // 非 Android 直接切状态
      statusStore.isImmersiveFullscreen = true;
      return true;
    }
    if (reduce.value) {
      // 跳过动效
      try {
        const { AndroidNativePlayback } = await import("@/plugins/androidNativePlayback");
        await AndroidNativePlayback.setImmersiveLandscape({ active: true });
      } catch (e) {
        console.warn("[orientationTransition] enter native failed (reduced-motion)", e);
        return false;
      }
      statusStore.isImmersiveFullscreen = true;
      return true;
    }

    busy = true;
    heroSrc.value = coverSrc;
    heroToRect.value = null;

    try {
      // 黑场升起：与 shutter-enter 260ms 同步后再起旋转
      phase.value = "enter-rising";
      await nextTick();
      await wait(280);

      // 触发 native 旋转
      try {
        const { AndroidNativePlayback } = await import("@/plugins/androidNativePlayback");
        await AndroidNativePlayback.setImmersiveLandscape({ active: true });
      } catch (e) {
        console.warn("[orientationTransition] enter native failed", e);
        cleanup();
        return false;
      }

      // 切 JS 状态触发 isMobileLandscape → 横屏布局挂载
      statusStore.isImmersiveFullscreen = true;
      phase.value = "enter-rotating";

      // 等横屏布局挂载 + landscapeCoverEl 就位（中低端机型需额外余量）
      await waitFor(
        () => !isPhonePortrait.value && landscapeCoverEl.value !== null,
        1200,
      );
      await nextTick();
      await wait(50);

      // 测横屏 cover 终点
      heroToRect.value = measure(landscapeCoverEl.value);

      // 揭幕
      phase.value = "enter-revealing";
      await wait(500);

      cleanup();
      return true;
    } catch (e) {
      console.warn("[orientationTransition] enter unexpected error", e);
      cleanup();
      return false;
    }
  };

  // 出场：沉浸式横屏 → 竖屏
  const exit = async (coverSrc: string): Promise<boolean> => {
    if (busy) return false;
    if (!isCapacitorAndroid) {
      statusStore.isImmersiveFullscreen = false;
      return true;
    }
    if (reduce.value) {
      statusStore.isImmersiveFullscreen = false;
      try {
        const { AndroidNativePlayback } = await import("@/plugins/androidNativePlayback");
        await AndroidNativePlayback.setImmersiveLandscape({ active: false });
      } catch (e) {
        console.warn("[orientationTransition] exit native failed (reduced-motion)", e);
      }
      await lockPortrait();
      return true;
    }

    busy = true;
    heroSrc.value = coverSrc;
    heroToRect.value = null;

    try {
      // 横屏元素收起 + 黑场升起：同步 shutter-enter 260ms 再释放方向锁
      phase.value = "exit-collapsing";
      await nextTick();
      await wait(280);

      // 释放方向锁，再 lockPortrait
      statusStore.isImmersiveFullscreen = false;
      try {
        const { AndroidNativePlayback } = await import("@/plugins/androidNativePlayback");
        await AndroidNativePlayback.setImmersiveLandscape({ active: false });
      } catch (e) {
        console.warn("[orientationTransition] exit native failed", e);
      }
      await lockPortrait();
      phase.value = "exit-rotating";

      // 等竖屏布局挂载
      await waitFor(() => isPhonePortrait.value, 800);
      await nextTick();
      await wait(50);

      // 黑场退场
      phase.value = "exit-revealing";
      await wait(340);

      cleanup();
      return true;
    } catch (e) {
      console.warn("[orientationTransition] exit unexpected error", e);
      cleanup();
      return false;
    }
  };

  return {
    phase: computed(() => phase.value),
    isTransitioning,
    isRevealing,
    isCollapsing,
    heroToRect: computed(() => heroToRect.value),
    heroSrc: computed(() => heroSrc.value),
    isReducedMotion: computed(() => reduce.value),
    setCoverEl,
    enter,
    exit,
  };
};
