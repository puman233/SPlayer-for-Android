import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import axiosRetry from "axios-retry";
import { useSettingStore } from "@/stores";
import { getCookie } from "./cookie";
import { isLogin } from "./auth";
import { isCapacitorAndroid, isCapacitorNative, isDev } from "./env";
import { EMBEDDED_API_BASE_URL, restartEmbeddedApi, waitForEmbeddedApiReady } from "./embeddedApi";

declare module "axios" {
  interface InternalAxiosRequestConfig {
    _embeddedApiRetried?: boolean;
    /** 请求发起时间戳（性能诊断用） */
    _startTime?: number;
  }
}

/** 慢请求阈值（毫秒），超过则输出性能日志 */
const SLOW_REQUEST_THRESHOLD_MS = 2000;

const DEV_PROXY_BASE_URL = "/api/netease";
const ABSOLUTE_HTTP_URL_RE = /^https?:\/\//i;

let apiConfigWarningShown = false;

const normalizeApiBaseUrl = (value?: string | null): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return "";
  }
  return normalized.replace(/\/+$/, "");
};

const getEnvApiBaseUrl = (): string => normalizeApiBaseUrl(import.meta.env["VITE_API_URL"]);

const getStoredApiBaseUrl = (): string => {
  try {
    return normalizeApiBaseUrl(useSettingStore().apiBaseUrl);
  } catch {
    return "";
  }
};

const resolveApiBaseUrl = (): string => {
  if (isDev && !isCapacitorNative) {
    return DEV_PROXY_BASE_URL;
  }

  if (isCapacitorAndroid) {
    return EMBEDDED_API_BASE_URL;
  }

  const configuredBaseUrl = getStoredApiBaseUrl() || getEnvApiBaseUrl() || "";

  if (!configuredBaseUrl) {
    return "";
  }

  if (isCapacitorNative && !ABSOLUTE_HTTP_URL_RE.test(configuredBaseUrl)) {
    return "";
  }

  return configuredBaseUrl;
};

const notifyApiBaseUrlError = () => {
  if (apiConfigWarningShown) {
    return;
  }

  apiConfigWarningShown = true;

  const message = isCapacitorNative
    ? "Android 端未配置可访问的网易云 API 地址，请到 设置 > 网络代理 填写完整的 https:// 服务地址。"
    : "当前未配置可访问的网易云 API 地址，请检查 VITE_API_URL 或设置页中的 API 地址。";

  window.$message?.error(message, {
    duration: 5000,
  });
};

const attachApiBaseUrl = async (
  request: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> => {
  const explicitBaseUrl = String(request.baseURL || "");
  const requestUrl = String(request.url || "");

  if (ABSOLUTE_HTTP_URL_RE.test(explicitBaseUrl) || ABSOLUTE_HTTP_URL_RE.test(requestUrl)) {
    return request;
  }

  const baseURL = resolveApiBaseUrl();

  if (!baseURL) {
    notifyApiBaseUrlError();
    throw new AxiosError("Missing or invalid API base URL", AxiosError.ERR_BAD_REQUEST, request);
  }

  if (isCapacitorAndroid && baseURL === EMBEDDED_API_BASE_URL) {
    await waitForEmbeddedApiReady();
  }

  request.baseURL = baseURL;
  return request;
};

const server: AxiosInstance = axios.create({
  withCredentials: true,
  timeout: 30000,
});

axiosRetry(server, {
  retries: 3,
});

server.interceptors.request.use(
  async (request) => {
    await attachApiBaseUrl(request);

    // 记录请求发起时间，用于慢请求诊断
    request._startTime = performance.now();

    const settingStore = useSettingStore();
    if (!request.params) request.params = {};

    if (!request.params.noCookie && (isLogin() || getCookie("MUSIC_U") !== null)) {
      const cookie = `MUSIC_U=${getCookie("MUSIC_U")};os=pc;`;
      request.headers.set("X-SPlayer-Cookie", cookie);
    }

    if (settingStore.useRealIP) {
      if (settingStore.realIP) {
        request.params.realIP = settingStore.realIP;
      } else {
        request.params.randomCNIP = true;
      }
    }

    if (settingStore.proxyProtocol !== "off") {
      const protocol = settingStore.proxyProtocol.toLowerCase();
      const proxyServer = settingStore.proxyServe;
      const port = settingStore.proxyPort;
      const proxy = `${protocol}://${proxyServer}:${port}`;
      if (proxy) request.params.proxy = proxy;
    }

    return request;
  },
  (error: AxiosError) => {
    console.error("Request failed before dispatch:", error);
    return Promise.reject(error);
  },
);

server.interceptors.response.use(
  (response: AxiosResponse) => {
    // 慢请求诊断：仅当耗时超过阈值时输出（页面加载卡顿排查用）
    if (response.config?._startTime) {
      const cost = performance.now() - response.config._startTime;
      if (cost > SLOW_REQUEST_THRESHOLD_MS) {
        const method = (response.config.method || "GET").toUpperCase();
        console.warn(`[perf] 慢请求 ${Math.round(cost)}ms: ${method} ${response.config.url}`);
      }
    }
    return response;
  },
  async (error: AxiosError) => {
    if (
      isCapacitorAndroid &&
      error.config &&
      !error.config._embeddedApiRetried &&
      (error.code === "ECONNABORTED" ||
        error.code === "ERR_NETWORK" ||
        error.message.includes("Network Error") ||
        error.message.includes("timeout"))
    ) {
      const restarted = await restartEmbeddedApi();
      if (restarted) {
        error.config._embeddedApiRetried = true;
        return server.request(error.config);
      }
    }

    if (
      error.code === "ECONNABORTED" ||
      error.message.includes("timeout") ||
      error.message.includes("Network Error")
    ) {
      const activeBaseUrl = String(error.config?.baseURL || resolveApiBaseUrl() || "未配置");
      window.$message?.warning(
        `网络请求超时，请检查 API 服务地址和当前网络连接。当前地址: ${activeBaseUrl}`,
      );
      return Promise.resolve({ data: null });
    }

    const { response } = error;
    switch (response?.status) {
      case 400:
        console.warn("Bad request:", response.status, response.statusText);
        break;
      case 401:
        console.warn("Unauthorized:", response.status, response.statusText);
        break;
      case 403:
        console.warn("Forbidden:", response.status, response.statusText);
        break;
      case 404:
        console.warn("Not found:", response.status, response.statusText);
        break;
      case 500:
        console.warn("Server error:", response.status, response.statusText);
        break;
      default:
        console.warn("Unhandled request error:", error.message);
    }

    return Promise.reject(error);
  },
);

const request = async <T = any>(config: AxiosRequestConfig): Promise<T> => {
  const { data } = await server.request(config);
  return data as T;
};

export default request;
