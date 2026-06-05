import { isCapacitorAndroid } from "./env";

export const EMBEDDED_API_PORT = 1145;
export const EMBEDDED_API_ORIGIN = `http://127.0.0.1:${EMBEDDED_API_PORT}`;
export const EMBEDDED_API_BASE_URL = `${EMBEDDED_API_ORIGIN}/api/netease`;

const DEVICE_READY_TIMEOUT_MS = 15000;
const EMBEDDED_API_READY_TIMEOUT_MS = 45000;
const EMBEDDED_API_POLL_INTERVAL_MS = 400;

let nodeRuntimeStartPromise: Promise<void> | null = null;
let embeddedApiReadyPromise: Promise<void> | null = null;
let nodeRuntimeStarted = false;
let embeddedApiErrorShown = false;
let healthCheckTimer: number | null = null;
let restartInProgress: Promise<void> | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const reportEmbeddedApiError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[embedded-api] startup failed:", error);
  if (embeddedApiErrorShown) return;
  embeddedApiErrorShown = true;
  window.$message?.error(`内置 API 启动失败: ${message}`, {
    duration: 6000,
  });
};

const waitForNodeRuntimeBridge = async () => {
  if (!isCapacitorAndroid) return;
  if (window.nodejs) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener("deviceready", onDeviceReady);
    };

    const onDeviceReady = () => {
      if (window.nodejs) {
        cleanup();
        resolve();
      }
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for nodejs-mobile bridge"));
    }, DEVICE_READY_TIMEOUT_MS);

    document.addEventListener("deviceready", onDeviceReady, { once: true });

    const poll = async () => {
      while (!window.nodejs) {
        await delay(100);
        if (window.nodejs) {
          cleanup();
          resolve();
          return;
        }
      }
    };

    void poll();
  });
};

export const startEmbeddedApiRuntime = async () => {
  if (!isCapacitorAndroid) return;
  if (nodeRuntimeStarted) return;
  if (nodeRuntimeStartPromise) return nodeRuntimeStartPromise;

  nodeRuntimeStartPromise = (async () => {
    await waitForNodeRuntimeBridge();

    await new Promise<void>((resolve, reject) => {
      const nodeRuntime = window.nodejs;
      if (!nodeRuntime) {
        reject(new Error("nodejs-mobile runtime bridge is unavailable"));
        return;
      }

      nodeRuntime.channel.setListener((message) => {
        console.info("[embedded-api]", message);
      });

      nodeRuntime.start(
        "main.js",
        (error) => {
          if (error) {
            const message = String(error);
            if (message.toLowerCase().includes("already")) {
              nodeRuntimeStarted = true;
              resolve();
              return;
            }
            reject(error);
            return;
          }

          nodeRuntimeStarted = true;
          resolve();
        },
        { redirectOutputToLogcat: true },
      );
    });
  })();

  try {
    await nodeRuntimeStartPromise;
  } catch (error) {
    nodeRuntimeStartPromise = null;
    reportEmbeddedApiError(error);
    throw error;
  }
};

const isEmbeddedApiHealthy = async () => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${EMBEDDED_API_ORIGIN}/api`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
};

export const waitForEmbeddedApiReady = async () => {
  if (!isCapacitorAndroid) return;
  if (embeddedApiReadyPromise) return embeddedApiReadyPromise;

  embeddedApiReadyPromise = (async () => {
    await startEmbeddedApiRuntime();

    const startedAt = Date.now();
    while (Date.now() - startedAt < EMBEDDED_API_READY_TIMEOUT_MS) {
      if (await isEmbeddedApiHealthy()) {
        return;
      }
      await delay(EMBEDDED_API_POLL_INTERVAL_MS);
    }

    throw new Error("Embedded API server did not become ready in time");
  })();

  try {
    await embeddedApiReadyPromise;
  } catch (error) {
    embeddedApiReadyPromise = null;
    reportEmbeddedApiError(error);
    throw error;
  }
};

/**
 * 尝试重启 Node.js 运行时并等待 API 恢复
 * 多次调用会合并为同一个 Promise
 */
export const restartEmbeddedApi = async (): Promise<boolean> => {
  if (!isCapacitorAndroid) return false;
  if (restartInProgress) {
    try {
      await restartInProgress;
      return true;
    } catch {
      return false;
    }
  }

  restartInProgress = (async () => {
    console.warn("[embedded-api] restarting Node.js runtime...");
    // 重置状态以允许重新启动
    nodeRuntimeStartPromise = null;
    embeddedApiReadyPromise = null;
    nodeRuntimeStarted = false;
    embeddedApiErrorShown = false;
    await waitForEmbeddedApiReady();
    console.info("[embedded-api] restart successful");
  })();

  try {
    await restartInProgress;
    return true;
  } catch (error) {
    console.error("[embedded-api] restart failed:", error);
    return false;
  } finally {
    restartInProgress = null;
  }
};

const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_MAX_FAILURES = 2;

/**
 * 启动定期心跳检查，连续失败后自动重启
 */
export const startHealthCheck = () => {
  if (!isCapacitorAndroid) return;
  if (healthCheckTimer) return;

  let consecutiveFailures = 0;

  healthCheckTimer = window.setInterval(async () => {
    const healthy = await isEmbeddedApiHealthy();
    if (healthy) {
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures++;
    console.warn(
      `[embedded-api] health check failed (${consecutiveFailures}/${HEALTH_CHECK_MAX_FAILURES})`,
    );

    if (consecutiveFailures >= HEALTH_CHECK_MAX_FAILURES) {
      consecutiveFailures = 0;
      window.$message?.warning("内置 API 服务异常，正在自动恢复...", { duration: 3000 });
      await restartEmbeddedApi();
    }
  }, HEALTH_CHECK_INTERVAL_MS);
};
