import { createApp } from "vue";
import App from "./App.vue";
import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import router from "@/router";
import { debounceDirective, throttleDirective, visibleDirective } from "@/utils/instruction";
import "@/style/main.scss";
import "@/style/animate.scss";
import { isCapacitorAndroid, isElectron } from "./utils/env";
import { waitForEmbeddedApiReady, startHealthCheck } from "./utils/embeddedApi";

const app = createApp(App);
const pinia = createPinia();

pinia.use(piniaPluginPersistedstate);
app.use(pinia);
app.use(router);
app.directive("debounce", debounceDirective);
app.directive("throttle", throttleDirective);
app.directive("visible", visibleDirective);

app.config.errorHandler = (err, _instance, info) => {
  const error = err as Error & { isAxiosError?: boolean; code?: string };
  const message = error?.message || "";
  const nonCriticalKeywords = [
    "timeout",
    "Network Error",
    "网络",
    "超时",
    "ECONNABORTED",
    "ECONNREFUSED",
    "ENOTFOUND",
    "Failed to fetch",
    "Load failed",
  ];
  const isNonCritical =
    error?.isAxiosError ||
    error?.code === "ECONNABORTED" ||
    nonCriticalKeywords.some((keyword) => message.includes(keyword));

  if (isNonCritical) {
    console.warn("[Vue ErrorHandler] Ignored non-fatal error", err, info);
    return;
  }

  console.error("[Vue ErrorHandler] Fatal error", err, info);
};

app.mount("#app");

if (isCapacitorAndroid) {
  void waitForEmbeddedApiReady()
    .then(() => {
      startHealthCheck();
    })
    .catch((error) => {
      console.error("Failed to warm up embedded API:", error);
    });
}

// Electron 专属初始化路径：在 Android / Web 下不加载这些模块图谱，缩减主 chunk
if (isElectron && !location.hash.includes("desktop-lyric")) {
  void (async () => {
    const [{ default: initIpc }, { sendRegisterProtocol }, { useSettingStore }] = await Promise.all(
      [import("@/utils/initIpc"), import("@/utils/protocol"), import("@/stores")],
    );
    initIpc();
    const settings = useSettingStore();
    sendRegisterProtocol("orpheus", settings.registryProtocol.orpheus);
  })().catch((err) => {
    console.error("Electron 主进程辅助模块加载失败:", err);
  });
}
