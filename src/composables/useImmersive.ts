import { onBeforeUnmount, onMounted } from "vue";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useSettingStore, useStatusStore } from "@/stores";

/**
 * Android immersive mode:
 * - overlays the webview under the status bar
 * - hides the status bar after the app boots (unless user chose to show it)
 */
export const useImmersive = () => {
  let reapplyTimer: number | undefined;

  const applyImmersive = async () => {
    if (Capacitor.getPlatform() !== "android") return;

    document.documentElement.classList.add("android-capacitor");

    try {
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setOverlaysWebView({ overlay: true });
      const settingStore = useSettingStore();
      const statusStore = useStatusStore();
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
    window.clearTimeout(reapplyTimer);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("orientationchange", handleOrientationChange);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  return {
    applyImmersive,
  };
};
