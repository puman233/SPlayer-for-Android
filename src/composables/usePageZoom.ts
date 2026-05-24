import { computed, onMounted, watch } from "vue";
import { useSettingStore } from "@/stores";
import { useDevice } from "@/composables/useDevice";
import { isCapacitorAndroid, isElectron } from "@/utils/env";

/** 页面缩放 */
export const usePageZoom = () => {
  const settingStore = useSettingStore();
  const { isPad, isPhonePortrait } = useDevice();

  const activeZoom = computed(() => {
    if (isElectron) return 100;
    if (isPad.value) return settingStore.padPageZoom;
    if (isPhonePortrait.value) return settingStore.phonePortraitPageZoom;
    return 100;
  });

  const fullscreenSafeBottom = computed(() => {
    if (!isCapacitorAndroid || !isPhonePortrait.value) return 0;
    return settingStore.androidFullscreenSafeAreaOptimize ? 32 : 0;
  });

  // 节流：合并同一帧内的多次调用，避免连发 resize
  let resizePending = false;
  const notifyResize = () => {
    if (resizePending) return;
    resizePending = true;
    const fire = () => window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(() => {
      fire();
      resizePending = false;
    });
    // 一次延迟兜底，处理 CSS 变量在某些场景下延迟生效后的二次布局
    setTimeout(fire, 150);
  };

  const apply = (zoom: number, safeBottom: number) => {
    const safe = Math.max(50, Math.min(200, Number(zoom) || 100));
    const ratio = safe / 100;

    // 固定 viewport
    let viewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.name = "viewport";
      document.head.appendChild(viewport);
    }
    viewport.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");

    // 缩放变量挂到 #app，避免 teleport 到 body 的弹出层继承到反向补偿值
    const appEl = (document.getElementById("app") || document.documentElement) as HTMLElement;
    appEl.style.setProperty("--page-zoom-ratio", String(ratio));
    appEl.style.setProperty("--page-zoom-width", `${100 / ratio}%`);
    appEl.style.setProperty("--page-zoom-height", `${100 / ratio}%`);
    appEl.style.setProperty("--page-zoom-100vw", `${100 / ratio}vw`);
    appEl.style.setProperty("--page-zoom-100vh", `${100 / ratio}vh`);
    appEl.style.setProperty("--page-zoom-100dvh", `${100 / ratio}dvh`);
    appEl.style.setProperty("--page-zoom-60vw", `${60 / ratio}vw`);
    appEl.style.setProperty("--android-fullscreen-safe-bottom", `${safeBottom / ratio}px`);

    // 仅在 ratio !== 1 时设置 transform：scale(1) 也会触发 stacking context 与
    // fixed containing block 切换，影响 Electron / 100% 缩放路径的 fixed 后代定位
    if (ratio === 1) {
      appEl.style.removeProperty("transform");
    } else {
      appEl.style.transform = `scale(${ratio})`;
    }
    (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = "";

    notifyResize();
  };

  onMounted(() => apply(activeZoom.value, fullscreenSafeBottom.value));
  watch([activeZoom, fullscreenSafeBottom], ([zoom, safeBottom]) => apply(zoom, safeBottom));
};
