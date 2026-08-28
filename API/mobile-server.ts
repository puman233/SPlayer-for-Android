import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import { createRequire } from "module";
import path from "path";
import { handleUnblockRequest } from "./unblock";

const DEFAULT_PORT = Number(process.env["SP_API_PORT"] || process.env["VITE_SERVER_PORT"] || 1145);
const DEFAULT_HOST = process.env["SP_API_HOST"] || "127.0.0.1";
const DEFAULT_AMLL_DB_SERVER =
  process.env["SP_AMLL_DB_SERVER"] || "https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml";
const ALLOWED_ORIGINS = ["https://localhost", "capacitor://localhost"];
const ALLOWED_HEADERS =
  "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-SPlayer-Cookie";
const EMBEDDED_API_READY_EVENT = "embedded-api-ready";

type ApiFunction = (params: Record<string, unknown>) => Promise<{ body?: unknown } | unknown>;

const EMBEDDED_API_VENDOR_ROOT = path.join(__dirname, "vendor", "netease-api");
const EMBEDDED_API_MAIN_ENTRY = path.join(EMBEDDED_API_VENDOR_ROOT, "main.js");
const nodeRequire = createRequire(EMBEDDED_API_MAIN_ENTRY);
let generateNeteaseApiConfig: (() => Promise<void>) | null = null;
let neteaseApiConfigPromise: Promise<void> | null = null;

const notifyEmbeddedApiReady = () => {
  try {
    // cordova-bridge 是 nodejs-mobile 注入的模块，需要通过全局 require 加载
    const globalRequire =
      typeof globalThis.require === "function"
        ? globalThis.require
        : typeof process.mainModule?.require === "function"
          ? process.mainModule.require // nodejs-mobile 回退（Node.js 已弃用此属性）
          : null;
    if (!globalRequire) {
      console.warn("[embedded-api] 无法获取全局 require，跳过就绪通知");
      return;
    }
    const cordova = globalRequire("cordova-bridge") as {
      channel?: { send?: (payload: unknown) => void };
    };
    cordova.channel?.send?.(EMBEDDED_API_READY_EVENT);
  } catch {
    // cordova-bridge 不可用时静默忽略，前端会通过轮询兜底
  }
};

const toPathCase = (value: string) => {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "/")
    .replace(/-/g, "/")
    .toLowerCase();
};

const setCorsHeaders = (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
};

const getHeaderValue = (value: string | string[] | undefined) => {
  return Array.isArray(value) ? value[0] : value;
};

const getApiErrorStatus = (status?: number) => {
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
};

const ensureNeteaseApiConfig = async () => {
  if (!neteaseApiConfigPromise) {
    generateNeteaseApiConfig ||= nodeRequire(
      path.join(EMBEDDED_API_VENDOR_ROOT, "generateConfig.js"),
    ) as () => Promise<void>;
    neteaseApiConfigPromise = Promise.resolve(generateNeteaseApiConfig()).catch(
      (error: unknown) => {
        neteaseApiConfigPromise = null;
        throw error;
      },
    );
  }

  await neteaseApiConfigPromise;
};

const createRouterMap = (neteaseApi: Record<string, unknown>) => {
  const routerMap = new Map<string, ApiFunction>();
  Object.keys(neteaseApi).forEach((key) => {
    const value = neteaseApi[key];
    if (typeof value !== "function") return;
    [key, toPathCase(key)].forEach((routePath) => {
      if (!routerMap.has(routePath)) routerMap.set(routePath, value as ApiFunction);
    });
  });
  return routerMap;
};

const sendJson = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  setCorsHeaders(request, response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

const sendText = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: string,
) => {
  setCorsHeaders(request, response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(payload);
};

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parseBody = (rawBody: string, contentType: string | undefined) => {
  if (!rawBody) return {};

  const normalizedContentType = (contentType || "").toLowerCase();

  if (normalizedContentType.includes("application/json")) {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }
};

const mergeCookieInput = (
  query: Record<string, unknown>,
  body: Record<string, unknown>,
  origin: string | undefined,
  cookieHeader: string | undefined,
  splayerCookieHeader: string | undefined,
) => {
  const { cookie: _queryCookie, ...safeQuery } = query;
  const { cookie: _bodyCookie, ...safeBody } = body;
  const customCookie = origin && ALLOWED_ORIGINS.includes(origin) ? splayerCookieHeader : undefined;
  const cookie = customCookie || cookieHeader;

  return {
    ...safeQuery,
    ...safeBody,
    ...(cookie ? { cookie } : {}),
  };
};

let routerMap: Map<string, ApiFunction> | null = null;

const loadNeteaseApi = (requestPath: string): ApiFunction | null => {
  if (!routerMap) {
    routerMap = createRouterMap(nodeRequire(EMBEDDED_API_MAIN_ENTRY) as Record<string, unknown>);
  }
  return routerMap.get(requestPath) || null;
};

const fetchText = (url: string) =>
  new Promise<string | null>((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const request = client.get(url, (response) => {
      if ((response.statusCode || 500) !== 200) {
        response.resume();
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });

    request.on("error", reject);
  });

const handleNeteaseRoute = async (
  pathname: string,
  query: Record<string, unknown>,
  body: Record<string, unknown>,
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (pathname === "/api/netease") {
    sendJson(request, response, 200, {
      name: "@neteasecloudmusicapienhanced/api",
      description: "NeteaseCloudMusicApi Enhanced",
      url: "https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced",
    });
    return;
  }

  if (pathname === "/api/netease/lyric/ttml") {
    const id = String(query.id || "");
    if (!id) {
      sendJson(request, response, 400, { error: "id is required" });
      return;
    }

    try {
      const text = await fetchText(DEFAULT_AMLL_DB_SERVER.replace("%s", id));
      if (text === null) {
        sendJson(request, response, 200, null);
        return;
      }
      sendText(request, response, 200, text);
    } catch (error) {
      console.error("[embedded-api] Fetch TTML lyric failed", error);
      sendJson(request, response, 200, null);
    }
    return;
  }

  const requestPath = pathname.replace(/^\/api\/netease\//, "");

  // 歌曲解锁路由（/api/netease/unblock/{server}）
  if (requestPath.startsWith("unblock/")) {
    const server = requestPath.slice("unblock/".length);
    try {
      const result = await handleUnblockRequest(server, query);
      sendJson(request, response, 200, result);
    } catch (error) {
      console.error("[embedded-api] Unblock request failed", server, error);
      sendJson(request, response, 200, { code: 500, url: null });
    }
    return;
  }

  const neteaseApi = loadNeteaseApi(requestPath);
  if (!neteaseApi) {
    sendJson(request, response, 404, { error: "API not found" });
    return;
  }

  try {
    await ensureNeteaseApiConfig();
    const result = await neteaseApi(
      mergeCookieInput(
        query,
        body,
        request.headers.origin,
        request.headers.cookie,
        getHeaderValue(request.headers["x-splayer-cookie"]),
      ),
    );
    const payload =
      typeof result === "object" && result && "body" in result
        ? (result as { body?: unknown }).body
        : result;
    sendJson(request, response, 200, payload);
  } catch (error: unknown) {
    console.error("[embedded-api] Netease API request failed", requestPath, error);

    if (typeof error === "object" && error) {
      const apiError = error as { status?: number; body?: unknown; message?: string };
      sendJson(
        request,
        response,
        getApiErrorStatus(apiError.status),
        apiError.body || { error: apiError.message || "Internal Server Error" },
      );
      return;
    }

    sendJson(request, response, 500, { error: String(error) });
  }
};

export const startEmbeddedApiServer = async () => {
  const server = http.createServer(async (request, response) => {
    setCorsHeaders(request, response);

    if (!request.url) {
      sendJson(request, response, 400, { error: "Missing request URL" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const query = Object.fromEntries(url.searchParams.entries());
    const rawBody = request.method === "POST" ? await readRequestBody(request) : "";
    const body = parseBody(rawBody, request.headers["content-type"]);

    if (pathname === "/api") {
      sendJson(request, response, 200, {
        name: "SPlayer API",
        description: "Embedded local API service for SPlayer Android",
        list: [
          {
            name: "NeteaseCloudMusicApi",
            url: "/api/netease",
          },
        ],
      });
      return;
    }

    if (pathname === "/api/netease" || pathname.startsWith("/api/netease/")) {
      await handleNeteaseRoute(pathname, query, body, request, response);
      return;
    }

    sendJson(request, response, 404, { error: "API not found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`[embedded-api] listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}/api`);
  notifyEmbeddedApiReady();
  return server;
};

void startEmbeddedApiServer().catch((error) => {
  console.error("[embedded-api] startEmbeddedApiServer failed", error);
});
