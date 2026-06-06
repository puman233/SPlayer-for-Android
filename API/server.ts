import fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import NeteaseCloudMusicApi from "@neteasecloudmusicapienhanced/api";
import { pathCase } from "change-case";
import { createRequire } from "module";

const DEFAULT_PORT = Number(process.env["SP_API_PORT"] || process.env["VITE_SERVER_PORT"] || 1145);
const DEFAULT_HOST = process.env["SP_API_HOST"] || "0.0.0.0";
const IS_EMBEDDED_RUNTIME = process.env["SP_EMBEDDED"] === "1";
const DEFAULT_AMLL_DB_SERVER =
  process.env["SP_AMLL_DB_SERVER"] || "https://amlldb.bikonoo.com/ncm-lyrics/%s.ttml";
const DEFAULT_ALLOWED_ORIGINS = ["https://localhost", "capacitor://localhost"];
const CUSTOM_ALLOWED_ORIGINS = process.env["SP_API_ALLOWED_ORIGINS"];
const ALLOWED_ORIGINS = (CUSTOM_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_HEADERS =
  "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-SPlayer-Cookie";
const NETEASE_API = NeteaseCloudMusicApi as unknown as Record<
  string,
  (params: Record<string, unknown>) => Promise<any>
>;
const require = createRequire(import.meta.url);
const generateNeteaseApiConfig = require(
  "@neteasecloudmusicapienhanced/api/generateConfig.js",
) as () => Promise<void>;
let neteaseApiConfigPromise: Promise<void> | null = null;

const isAllowedOrigin = (origin?: string) => {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (CUSTOM_ALLOWED_ORIGINS) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

const getHeaderValue = (value: string | string[] | undefined) => {
  return Array.isArray(value) ? value[0] : value;
};

const getApiErrorStatus = (status?: number) => {
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
};

const ensureNeteaseApiConfig = async () => {
  if (!neteaseApiConfigPromise) {
    neteaseApiConfigPromise = Promise.resolve(generateNeteaseApiConfig()).catch((error: unknown) => {
      neteaseApiConfigPromise = null;
      throw error;
    });
  }

  await neteaseApiConfigPromise;
};

const createRouterMap = () => {
  const routerMap = new Map<string, string>();
  Object.keys(NETEASE_API).forEach((key) => {
    if (typeof NETEASE_API[key] !== "function") return;
    [key, pathCase(key)].forEach((routePath) => {
      if (!routerMap.has(routePath)) routerMap.set(routePath, key);
    });
  });
  return routerMap;
};

const ROUTER_MAP = createRouterMap();

const mergeCookieInput = (request: FastifyRequest) => {
  const query = (request.query as Record<string, unknown>) ?? {};
  const body = (request.body as Record<string, unknown>) ?? {};
  const { cookie: _queryCookie, ...safeQuery } = query;
  const { cookie: _bodyCookie, ...safeBody } = body;
  const origin = request.headers.origin;
  const cookieHeader = request.headers.cookie;
  const customCookie = isAllowedOrigin(origin)
    ? getHeaderValue(request.headers["x-splayer-cookie"])
    : undefined;
  const cookie = customCookie || cookieHeader;

  return {
    ...safeQuery,
    ...safeBody,
    ...(cookie ? { cookie } : {}),
  };
};

const resolveRouterName = (requestPath: string) => {
  return ROUTER_MAP.get(requestPath);
};

const createDynamicHandler =
  (server: ReturnType<typeof fastify>) => async (request: FastifyRequest, reply: FastifyReply) => {
    const requestPath = (request.params as Record<string, string>)["*"];
    const routerName = resolveRouterName(requestPath);

    if (!routerName) {
      return reply.status(404).send({ error: "API not found" });
    }

    const neteaseApi = NETEASE_API[routerName];

    try {
      await ensureNeteaseApiConfig();
      const result = await neteaseApi(mergeCookieInput(request));
      return reply.send(result.body);
    } catch (error: unknown) {
      server.log.error({ err: error, requestPath }, "Netease API request failed");

      if (typeof error === "object" && error) {
        const apiError = error as { status?: number; body?: unknown; message?: string };
        return reply
          .status(getApiErrorStatus(apiError.status))
          .send(apiError.body || { error: apiError.message || "Internal Server Error" });
      }

      return reply.status(500).send({ error: String(error) });
    }
  };

export const createStandaloneApiServer = async () => {
  const server = fastify({
    logger: true,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
  });

  await server.register(fastifyCookie);
  await server.register(fastifyMultipart);

  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (isAllowedOrigin(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  });

  server.options("/*", async (_request, reply) => {
    reply.status(204).send();
  });

  server.get("/api", async () => {
    return {
      name: "SPlayer API",
      description: "Standalone local API service for SPlayer Android/Desktop",
      list: [
        {
          name: "NeteaseCloudMusicApi",
          url: "/api/netease",
        },
      ],
    };
  });

  server.get("/api/netease", async () => {
    return {
      name: "@neteasecloudmusicapienhanced/api",
      description: "NeteaseCloudMusicApi Enhanced",
      url: "https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced",
    };
  });

  const dynamicHandler = createDynamicHandler(server);
  server.get("/api/netease/*", dynamicHandler);
  server.post("/api/netease/*", dynamicHandler);

  server.get(
    "/api/netease/lyric/ttml",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = (request.query as Record<string, string | undefined>).id;
      if (!id) {
        return reply.status(400).send({ error: "id is required" });
      }

      const url = DEFAULT_AMLL_DB_SERVER.replace("%s", String(id));

      try {
        const response = await fetch(url);
        if (response.status !== 200) {
          return reply.send(null);
        }
        return reply.send(await response.text());
      } catch (error) {
        server.log.error({ err: error, id }, "Fetch TTML lyric failed");
        return reply.send(null);
      }
    },
  );

  return server;
};

export const startStandaloneApiServer = async () => {
  const server = await createStandaloneApiServer();

  try {
    await server.listen({
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
    });

    server.log.info(`SPlayer standalone API running at http://${DEFAULT_HOST}:${DEFAULT_PORT}/api`);
    server.log.info(
      `Use this base URL in Android: http://<your-computer-ip>:${DEFAULT_PORT}/api/netease`,
    );
    return server;
  } catch (error) {
    server.log.error(error, "Failed to start standalone API");
    throw error;
  }
};

void startStandaloneApiServer().catch(() => {
  if (IS_EMBEDDED_RUNTIME) {
    console.error("[embedded-api] startStandaloneApiServer failed; keeping runtime alive");
    return;
  }
  process.exit(1);
});
