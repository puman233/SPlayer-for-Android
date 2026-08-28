import type { SongUrlResult, SongMatchInfo } from "./types";
import axios from "axios";
import getKuwoSongUrl from "./kuwo";
import getBodianSongUrl from "./bodian";
import getGequbaoSongUrl from "./gequbao";

/**
 * 直接获取网易云云盘链接
 * Thank @939163156
 * Power by GD音乐台(music.gdstudio.xyz)
 */
const NETEASE_API_BASE_URL = "https://music-api.gdstudio.xyz/api.php";
const NETEASE_API_TIMEOUT_MS = 10000;

const getNeteaseSongUrl = async (id: number | string): Promise<SongUrlResult> => {
  try {
    if (!id) {
      console.warn("[unblock] ⚠️ NeteaseSongUrl 缺少 id");
      return { code: 404, url: null };
    }
    // GD音乐台偶尔会限流/超时，设置独立超时避免拖慢解锁链路
    const result = await axios.get(NETEASE_API_BASE_URL, {
      params: { types: "url", id },
      timeout: NETEASE_API_TIMEOUT_MS,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://music.gdstudio.xyz/",
      },
    });
    console.log(`[unblock] 🌐 NeteaseSongUrl 响应状态: ${result.status}`, {
      id,
      data: result.data && typeof result.data === "object" ? result.data : String(result.data),
    });
    const data = result.data;
    // 校验响应结构：data 需为对象且含 url 字段
    const songUrl = data && typeof data === "object" ? data.url : undefined;
    if (!songUrl) {
      // 该歌曲在网易云无可用资源（可能已下架/版权受限），交由前端降级其他音源
      console.warn(
        `[unblock] ⚠️ NeteaseSongUrl 为空 (${id})：歌曲可能已下架或无版权，将降级其他音源`,
      );
      return { code: 404, url: null };
    }
    console.log("[unblock] 🔗 NeteaseSongUrl URL:", songUrl);
    return { code: 200, url: songUrl };
  } catch (error) {
    console.error("[unblock] ❌ Get NeteaseSongUrl Error:", error);
    return { code: 404, url: null };
  }
};

/**
 * 构造匹配信息
 * @param query 查询参数
 */
const buildMatchInfo = (query: { [key: string]: string }): SongMatchInfo => ({
  keyword: query.keyword || "",
  songName: query.songName || query.keyword?.split("-")?.[0]?.trim() || "",
  artist: query.artist || "",
});

/**
 * 处理歌曲解锁请求
 * @param server 音源名称（netease / kuwo / bodian / gequbao）
 * @param query 查询参数
 * @returns 解锁结果
 */
export const handleUnblockRequest = async (
  server: string,
  query: Record<string, unknown>,
): Promise<SongUrlResult> => {
  // 统一转为字符串参数（来自 URL 查询串）
  const q: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    q[key] = typeof value === "string" ? value : String(value ?? "");
  }

  switch (server) {
    case "netease":
      return getNeteaseSongUrl(q.id);
    case "kuwo":
      return getKuwoSongUrl(buildMatchInfo(q));
    case "bodian":
      return getBodianSongUrl(buildMatchInfo(q));
    case "gequbao":
      return getGequbaoSongUrl(buildMatchInfo(q));
    default:
      return { code: 404, url: null };
  }
};
