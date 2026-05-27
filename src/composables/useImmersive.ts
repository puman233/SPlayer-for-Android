import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useDevice } from "@/composables/useDevice";
import { AndroidNativePlayback } from "@/plugins/androidNativePlayback";
import { useSettingStore, useStatusStore } from "@/stores";

/**
 * Android immersive mode:
 * - overlays the webview under the status bar
 * - hides the status bar after the app boots (unless user chose to show it)
 */
export const useImmersive = () => {
  let reapplyTimer: number | undefined;
  let exitImmersiveReapplyTimer: number | undefined;
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();
  const { isPadDevice, isPhonePortrait } = useDevice();
  // 平板横竖屏都隐藏底部导航栏，手机仍仅竖屏隐藏
  const shouldHideNavigationBar = computed(
    () => settingStore.androidHidePortraitNavBar && (isPhonePortrait.value || isPadDevice.value),
  );
  // 退出沉浸式后给 lockPortrait + orientationchange 留出窗口，避免 isPhonePortrait
  // 仍为 false 的瞬间把 hide 错写为 false（导致 native applyImmersiveMode 计算
  // hideNavigationBar = false||false = false 触发导航栏闪现）
  const EXIT_IMMERSIVE_GUARD_MS = 700;
  let exitImmersiveAt = 0;
  const isInExitGuardWindow = () => Date.now() - exitImmersiveAt < EXIT_IMMERSIVE_GUARD_MS;

  const applyImmersive = async () => {
    if (Capacitor.getPlatform() !== "android") return;

    document.documentElement.classList.add("android-capacitor");

    try {
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setOverlaysWebView({ overlay: true });
      // 沉浸式期间状态栏由 native 接管，不按 androidShowStatusBar 恢复
      if (settingStore.androidShowStatusBar && !statusStore.isImmersiveFullscreen) {
        await StatusBar.show();
      } else {
        await StatusBar.hide();
      }
    } catch (error) {
      console.warn("[useImmersive] Failed to enter immersive mode", error);
    }
  };

  const scheduleImmersive = (delay = 180) => {
    if (Capacitor.getPlatform() !== "android") return;

    window.clearTimeout(reapplyTimer);
    reapplyTimer = window.setTimeout(() => {
      void applyImmersive();
    }, delay);
  };

  // 沉浸式期间前端守护跳过，由 native applyImmersiveMode 接管
  const isImmersiveActive = () => useStatusStore().isImmersiveFullscreen;
  const wantsStatusBar = () => useSettingStore().androidShowStatusBar && !isImmersiveActive();

  const handleFocus = () => {
    if (wantsStatusBar()) return;
    scheduleImmersive(120);
  };
  const handleResize = () => {
    if (wantsStatusBar()) return;
    scheduleImmersive(220);
  };
  const handleOrientationChange = () => {
    if (wantsStatusBar()) {
      void StatusBar.show().catch(() => {});
      return;
    }
    scheduleImmersive(260);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      if (wantsStatusBar()) {
        void StatusBar.show().catch(() => {});
        return;
      }
      scheduleImmersive();
    }
  };

  onMounted(() => {
    void applyImmersive();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onBeforeUnmount(() => {
    // 不在卸载时重置 hideNavigationBar pref，避免覆盖用户偏好导致下次冷启动一帧
    // 导航栏可见。MainActivity.onCreate 仅重置 PREF_IMMERSIVE_LANDSCAPE，本 pref
    // 是用户设置项，应当持久化
    window.clearTimeout(reapplyTimer);
    window.clearTimeout(exitImmersiveReapplyTimer);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("orientationchange", handleOrientationChange);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  watch(
    shouldHideNavigationBar,
    (hide) => {
      if (Capacitor.getPlatform() !== "android") return;
      // 沉浸式期间 / 退出沉浸式守卫窗口内由 native 的 immersiveLandscape 分支主导，
      // 前端不写 pref，避免 sensor 横屏 isPhonePortrait=false 污染 PREF_HIDE_NAVIGATION_BAR
      if (statusStore.isImmersiveFullscreen || isInExitGuardWindow()) return;
      void AndroidNativePlayback.setHideNavigationBar({ hide });
    },
    { immediate: true },
  );

  // 退出沉浸式时机延迟回写：等 lockPortrait + orientationchange 把 isPhonePortrait
  // 推回 true，再用稳定后的 shouldHideNavigationBar 写一次 pref
  watch(
    () => statusStore.isImmersiveFullscreen,
    (immersive, prev) => {
      if (Capacitor.getPlatform() !== "android") return;
      if (!prev || immersive) return;
      exitImmersiveAt = Date.now();
      window.clearTimeout(exitImmersiveReapplyTimer);
      exitImmersiveReapplyTimer = window.setTimeout(() => {
        void AndroidNativePlayback.setHideNavigationBar({ hide: shouldHideNavigationBar.value });
      }, EXIT_IMMERSIVE_GUARD_MS);
    },
  );

  return {
    applyImmersive,
  };
};
