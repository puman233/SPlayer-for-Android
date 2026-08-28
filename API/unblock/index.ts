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
const getNeteaseSongUrl = async (id: number | string): Promise<SongUrlResult> => {
  try {
    if (!id) return { code: 404, url: null };
    const baseUrl = "https://music-api.gdstudio.xyz/api.php";
    const result = await axios.get(baseUrl, {
      params: { types: "url", id },
    });
    const songUrl = result.data.url;
    // 链接为空时视为失败
    if (!songUrl) {
      console.warn("⚠️ NeteaseSongUrl 为空:", id);
      return { code: 404, url: null };
    }
    console.log("🔗 NeteaseSongUrl URL:", songUrl);
    return { code: 200, url: songUrl };
  } catch (error) {
    console.error("❌ Get NeteaseSongUrl Error:", error);
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
