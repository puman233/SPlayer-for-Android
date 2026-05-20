/**
 * WebDAV 流媒体客户端
 *
 * WebDAV 是文件协议而非音乐索引协议，所以我们用以下方式实现统一接口：
 * - 用 PROPFIND 列目录，把音频文件视作歌曲
 * - 用 ID3/FLAC tag 解析（music-metadata）补全 artist/album/duration
 * - 首次连接后递归扫描整个库根，按标签聚合出 artists/albums
 * - 把目录结构作为"歌单"暴露（每个目录 = 一张歌单）
 */

import { SongType, QualityType } from "@/types/main";
import type {
  StreamingServerConfig,
  StreamingAlbumType,
  StreamingArtistType,
  StreamingPlaylistType,
} from "@/types/streaming";
import { parseBlob } from "music-metadata";

// ============ WebDAV 类型 ============

/** WebDAV 资源条目（PROPFIND 解析后） */
export interface WebDavEntry {
  /** 路径相对库根（如 "Music/Song.mp3"，目录以 / 结尾） */
  path: string;
  /** 文件名（最末段） */
  name: string;
  /** 是否目录 */
  isDirectory: boolean;
  /** 字节大小（仅文件） */
  size: number;
  /** 最后修改时间戳（毫秒） */
  lastModified: number;
  /** Content-Type（来自 D:getcontenttype） */
  contentType: string;
}

/** WebDAV tag 缓存条目 */
interface CachedTag {
  /** path → 标签 */
  artist: string;
  album: string;
  title: string;
  /** 时长，毫秒 */
  duration: number;
  /** 封面图（base64 data URL） */
  coverDataUrl?: string;
  /** 比特率 */
  bitRate?: number;
  /** 文件大小，避免文件被替换后用错缓存 */
  size: number;
  /** lastModified，避免文件被替换后用错缓存 */
  lastModified: number;
}

const tagCache = new Map<string, CachedTag>();
/** 标签缓存键：serverId + ":" + path */
const tagCacheKey = (config: StreamingServerConfig, path: string) => `${config.id}:${path}`;

// ============ 公共辅助 ============

const AUDIO_EXTS = new Set([
  "mp3",
  "flac",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "ape",
  "wma",
  "opus",
  "alac",
  "dsf",
  "dff",
  "dsd",
  "aiff",
  "aif",
]);

const isAudioFile = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return AUDIO_EXTS.has(name.slice(dot + 1).toLowerCase());
};

/**
 * 把字符串 ID 转为数字，与 Subsonic 模块逻辑一致（保证流媒体歌曲 ID 唯一稳定）
 * 用 1003 前缀区分 WebDAV
 */
const stringToNumericId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Number(`1003${Math.abs(hash)}`);
};

/** 规范化基地址（去掉末尾斜杠） */
const normalizeBaseUrl = (url: string): string => {
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

/** 规范化库根路径（保证以 / 开头、以 / 结尾） */
const normalizeRoot = (root?: string): string => {
  if (!root || root === "/") return "/";
  let r = root.trim();
  if (!r.startsWith("/")) r = "/" + r;
  if (!r.endsWith("/")) r = r + "/";
  return r;
};

/** 拼接库根 + 子路径（保证不重复 / ） */
const joinPath = (root: string, sub: string): string => {
  const r = normalizeRoot(root);
  if (!sub || sub === "/") return r;
  const cleanSub = sub.startsWith("/") ? sub.slice(1) : sub;
  return r + cleanSub;
};

/**
 * URL 编码 WebDAV 路径（保留 / 不编码）
 * 不能用 encodeURI，因为它不会对 # ? 等编码
 */
const encodePath = (p: string): string => {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
};

/** 构建认证头 */
const getAuthHeaders = (config: StreamingServerConfig): Record<string, string> => {
  const headers: Record<string, string> = {};
  // username 为空视为匿名访问
  if (!config.username && !config.password) return headers;
  // 只支持 Basic（Digest 浏览器原生 fetch 不支持，需要先做一次 401 拿 nonce 再算 H(A1)/H(A2)；此版本不实现）
  // 用户在 UI 选择 digest 时会被警告
  const token = btoa(unescape(encodeURIComponent(`${config.username}:${config.password}`)));
  headers.Authorization = `Basic ${token}`;
  return headers;
};

/** 给 song.streamUrl 用：把认证内嵌进 URL（http://user:pass@host/...），ExoPlayer/audio 标签可识别 */
export const getStreamUrl = (config: StreamingServerConfig, songPath: string): string => {
  const base = normalizeBaseUrl(config.url);
  const url = new URL(base);
  if (config.username || config.password) {
    url.username = encodeURIComponent(config.username || "");
    url.password = encodeURIComponent(config.password || "");
  }
  // url.pathname 已经被 URL 规范化，需要拼接资源路径
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = basePath + encodePath(songPath);
  return url.toString();
};

// ============ PROPFIND ============

/** 单次 PROPFIND 列出一层（Depth: 1） */
const propfind = async (
  config: StreamingServerConfig,
  remotePath: string,
): Promise<WebDavEntry[]> => {
  const base = normalizeBaseUrl(config.url);
  const url = `${base}${encodePath(remotePath)}`;

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<D:propfind xmlns:D="DAV:">` +
    `<D:prop>` +
    `<D:displayname/><D:getcontentlength/><D:getcontenttype/><D:getlastmodified/><D:resourcetype/>` +
    `</D:prop>` +
    `</D:propfind>`;

  const response = await fetch(url, {
    method: "PROPFIND",
    headers: {
      ...getAuthHeaders(config),
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`PROPFIND 失败：${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return parsePropfindXml(xml, remotePath);
};

/** 解析 PROPFIND 207 Multi-Status XML */
const parsePropfindXml = (xml: string, requestedPath: string): WebDavEntry[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  // multistatus 命名空间是 DAV:，Tag 名带 D: 或不带都可能（不同服务器风格不一）
  // 用 getElementsByTagNameNS 处理
  const NS = "DAV:";
  const responses = Array.from(doc.getElementsByTagNameNS(NS, "response"));

  const entries: WebDavEntry[] = [];
  // 对比时把"自身"行排除（PROPFIND 返回的第一个 response 一般是自己）
  const requested = decodeURIComponent(requestedPath).replace(/\/+$/, "") || "/";

  for (const res of responses) {
    const hrefEl = res.getElementsByTagNameNS(NS, "href")[0];
    if (!hrefEl) continue;
    const href = hrefEl.textContent || "";
    if (!href) continue;
    // href 可能是绝对 URL，也可能是相对路径
    const decodedHref = (() => {
      try {
        // 是绝对 URL 时取 pathname
        const u = new URL(href);
        return decodeURIComponent(u.pathname);
      } catch {
        return decodeURIComponent(href);
      }
    })();

    const propstat = res.getElementsByTagNameNS(NS, "propstat")[0];
    if (!propstat) continue;
    const prop = propstat.getElementsByTagNameNS(NS, "prop")[0];
    if (!prop) continue;

    const resourceType = prop.getElementsByTagNameNS(NS, "resourcetype")[0];
    const isDirectory = !!(
      resourceType && resourceType.getElementsByTagNameNS(NS, "collection").length > 0
    );

    const stripped = decodedHref.replace(/\/+$/, "") || "/";
    if (stripped === requested) continue; // 跳过"自身"

    const sizeText = prop.getElementsByTagNameNS(NS, "getcontentlength")[0]?.textContent || "0";
    const size = Number.parseInt(sizeText, 10) || 0;
    const contentType =
      prop.getElementsByTagNameNS(NS, "getcontenttype")[0]?.textContent?.trim() || "";
    const lastModRaw =
      prop.getElementsByTagNameNS(NS, "getlastmodified")[0]?.textContent?.trim() || "";
    const lastModified = lastModRaw ? Date.parse(lastModRaw) || 0 : 0;
    const displayName =
      prop.getElementsByTagNameNS(NS, "displayname")[0]?.textContent?.trim() || "";

    // 计算文件名：优先 displayname，否则 href 末段
    const fallbackName = decodedHref.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";

    entries.push({
      path: decodedHref,
      name: displayName || fallbackName,
      isDirectory,
      size,
      lastModified,
      contentType,
    });
  }

  return entries;
};

// ============ 标签解析 ============

/**
 * 下载指定文件的前 N 字节并用 music-metadata 解析标签
 * music-metadata 的 parseBlob 自带嗅探，不需要全文件下载
 * 但浏览器 fetch 流式截断不一定生效，因此对 >5MB 文件做 Range 请求只取前/后两块
 */
const fetchTagsForSong = async (
  config: StreamingServerConfig,
  entry: WebDavEntry,
): Promise<CachedTag | null> => {
  const cacheKey = tagCacheKey(config, entry.path);
  const cached = tagCache.get(cacheKey);
  if (cached && cached.size === entry.size && cached.lastModified === entry.lastModified) {
    return cached;
  }

  try {
    const base = normalizeBaseUrl(config.url);
    const url = `${base}${encodePath(entry.path)}`;
    const headers: Record<string, string> = { ...getAuthHeaders(config) };
    // 大文件只取前 1MB 的 ID3 帧（FLAC METADATA_BLOCK 在前部）
    // 大于 5MB 时启用 Range；否则直接全量
    if (entry.size > 5 * 1024 * 1024) {
      headers.Range = "bytes=0-1048575";
    }

    const response = await fetch(url, { headers });
    if (!response.ok && response.status !== 206) {
      console.warn("[WebDAV] tag fetch failed:", entry.path, response.status);
      return null;
    }
    const blob = await response.blob();
    const meta = await parseBlob(blob, { skipCovers: false, duration: true });

    // 如果用 Range 截断了文件，duration 不准——用比特率推断
    let duration = (meta.format.duration || 0) * 1000;
    if (entry.size > 5 * 1024 * 1024 && meta.format.bitrate) {
      // bitrate 单位 bps；duration = size * 8 / bitrate
      duration = (entry.size * 8 * 1000) / meta.format.bitrate;
    }

    let coverDataUrl: string | undefined;
    const pic = meta.common.picture?.[0];
    if (pic) {
      // base64 编码的 data URL
      const bytes = new Uint8Array(pic.data);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      coverDataUrl = `data:${pic.format};base64,${btoa(binary)}`;
    }

    const result: CachedTag = {
      artist: meta.common.artist || meta.common.albumartist || "未知艺术家",
      album: meta.common.album || "未知专辑",
      title: meta.common.title || stripExt(entry.name),
      duration: Math.round(duration),
      coverDataUrl,
      bitRate: meta.format.bitrate,
      size: entry.size,
      lastModified: entry.lastModified,
    };
    tagCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.warn("[WebDAV] parse tag error:", entry.path, e);
    // 解析失败也写入降级缓存，避免反复重试
    const fallback: CachedTag = {
      artist: "未知艺术家",
      album: "未知专辑",
      title: stripExt(entry.name),
      duration: 0,
      size: entry.size,
      lastModified: entry.lastModified,
    };
    tagCache.set(cacheKey, fallback);
    return fallback;
  }
};

const stripExt = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

// ============ 库索引（递归扫描） ============

/** 库索引缓存：serverId → { songs, scannedAt } */
interface LibraryIndex {
  songs: SongType[];
  scannedAt: number;
}
const libraryIndex = new Map<string, LibraryIndex>();
/** 缓存 5 分钟 */
const INDEX_TTL = 5 * 60 * 1000;

/**
 * 递归扫描库根目录，返回所有歌曲（带标签）
 * 限制并发避免压垮服务器
 */
const scanLibrary = async (
  config: StreamingServerConfig,
  onProgress?: (count: number) => void,
): Promise<SongType[]> => {
  const root = (config as StreamingServerConfig & { libraryRoot?: string }).libraryRoot || "/";

  const queue: string[] = [normalizeRoot(root)];
  const audioEntries: WebDavEntry[] = [];

  while (queue.length > 0) {
    const path = queue.shift()!;
    let entries: WebDavEntry[];
    try {
      entries = await propfind(config, path);
    } catch (e) {
      console.warn("[WebDAV] PROPFIND failed:", path, e);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        queue.push(entry.path);
      } else if (isAudioFile(entry.name)) {
        audioEntries.push(entry);
      }
    }
  }

  const songs: SongType[] = [];
  // 限制 4 个并发
  const concurrency = 4;
  let inFlight = 0;
  let idx = 0;
  await new Promise<void>((resolve) => {
    const next = () => {
      while (inFlight < concurrency && idx < audioEntries.length) {
        const entry = audioEntries[idx++];
        inFlight++;
        fetchTagsForSong(config, entry)
          .then((tag) => {
            const song = entryToSong(config, entry, tag);
            if (song) songs.push(song);
            onProgress?.(songs.length);
          })
          .catch((e) => console.warn("[WebDAV] tag scan failed:", entry.path, e))
          .finally(() => {
            inFlight--;
            if (idx >= audioEntries.length && inFlight === 0) resolve();
            else next();
          });
      }
      if (audioEntries.length === 0) resolve();
    };
    next();
  });

  return songs;
};

/** 把 WebDAV entry + tag 转成统一 SongType */
const entryToSong = (
  config: StreamingServerConfig,
  entry: WebDavEntry,
  tag: CachedTag | null,
): SongType => {
  const cover = tag?.coverDataUrl || "";
  return {
    id: stringToNumericId(entry.path),
    originalId: entry.path,
    name: tag?.title || stripExt(entry.name),
    artists: tag?.artist || "未知艺术家",
    album: tag?.album || "未知专辑",
    cover,
    coverSize: cover ? { s: cover, m: cover, l: cover, xl: cover } : undefined,
    duration: tag?.duration || 0,
    size: entry.size,
    quality: inferQuality(entry, tag),
    free: 0,
    mv: null,
    type: "streaming",
    serverId: config.id,
    serverType: config.type,
    streamUrl: getStreamUrl(config, entry.path),
    source: "streaming",
    path: "",
  };
};

/** 简单根据扩展名/比特率推断音质 */
const inferQuality = (entry: WebDavEntry, tag: CachedTag | null): QualityType => {
  const ext = entry.name.toLowerCase().split(".").pop() || "";
  const lossless = ["flac", "ape", "wav", "alac", "aiff", "aif", "dsd", "dsf", "dff"];
  if (lossless.includes(ext)) return QualityType.SQ;
  if (tag?.bitRate && tag.bitRate >= 320_000) return QualityType.HQ;
  if (tag?.bitRate && tag.bitRate >= 192_000) return QualityType.MQ;
  return QualityType.LQ;
};

/** 取或建索引 */
const getOrBuildIndex = async (config: StreamingServerConfig): Promise<SongType[]> => {
  const existing = libraryIndex.get(config.id);
  if (existing && Date.now() - existing.scannedAt < INDEX_TTL) {
    return existing.songs;
  }
  const songs = await scanLibrary(config);
  libraryIndex.set(config.id, { songs, scannedAt: Date.now() });
  return songs;
};

/** 失效索引（用户手动刷新或更换库根时） */
export const invalidateLibrary = (serverId: string): void => {
  libraryIndex.delete(serverId);
};

// ============ 公共 API ============

/** 测试连接（PROPFIND 库根） */
export const ping = async (
  config: StreamingServerConfig,
): Promise<{ version: string; serverVersion?: string }> => {
  const root = (config as StreamingServerConfig & { libraryRoot?: string }).libraryRoot || "/";
  await propfind(config, normalizeRoot(root));
  return { version: "WebDAV", serverVersion: "WebDAV" };
};

/** 列指定子目录（用于"文件夹"浏览模式） */
export const listDirectory = async (
  config: StreamingServerConfig,
  subPath: string = "/",
): Promise<{ directories: WebDavEntry[]; songs: SongType[] }> => {
  const root = (config as StreamingServerConfig & { libraryRoot?: string }).libraryRoot || "/";
  const fullPath = joinPath(root, subPath);
  const entries = await propfind(config, fullPath);
  const directories = entries.filter((e) => e.isDirectory);
  const audioFiles = entries.filter((e) => !e.isDirectory && isAudioFile(e.name));

  // 列文件夹时不立即解析每个文件的 tag（开销大），先用文件名兜底
  const songs = audioFiles.map((entry) => entryToSong(config, entry, null));
  return { directories, songs };
};

/** 列出歌曲（分页，从索引取） */
export const getSongs = async (
  config: StreamingServerConfig,
  offset: number = 0,
  size: number = 50,
): Promise<SongType[]> => {
  const all = await getOrBuildIndex(config);
  return all.slice(offset, offset + size);
};

/** 随机若干首 */
export const getRandomSongs = async (
  config: StreamingServerConfig,
  count: number = 50,
): Promise<SongType[]> => {
  const all = await getOrBuildIndex(config);
  if (all.length <= count) return [...all];
  const result: SongType[] = [];
  const indexes = new Set<number>();
  while (result.length < count && indexes.size < all.length) {
    const i = Math.floor(Math.random() * all.length);
    if (indexes.has(i)) continue;
    indexes.add(i);
    result.push(all[i]);
  }
  return result;
};

/** 按标签聚合艺术家 */
export const getArtists = async (config: StreamingServerConfig): Promise<StreamingArtistType[]> => {
  const all = await getOrBuildIndex(config);
  const map = new Map<string, { name: string; cover: string; albumNames: Set<string> }>();
  for (const song of all) {
    const artistName =
      typeof song.artists === "string"
        ? song.artists
        : Array.isArray(song.artists)
          ? song.artists[0]?.name || "未知艺术家"
          : "未知艺术家";
    const albumName = typeof song.album === "string" ? song.album : song.album?.name || "未知专辑";
    if (!map.has(artistName)) {
      map.set(artistName, { name: artistName, cover: song.cover || "", albumNames: new Set() });
    }
    const entry = map.get(artistName)!;
    if (!entry.cover && song.cover) entry.cover = song.cover;
    entry.albumNames.add(albumName);
  }
  return Array.from(map.values()).map((a) => {
    const cover = a.cover;
    return {
      id: stringToNumericId("artist:" + a.name).toString(),
      name: a.name,
      cover,
      coverSize: cover ? { s: cover, m: cover, l: cover, xl: cover } : undefined,
      albumCount: a.albumNames.size,
      serverId: config.id,
      serverType: config.type,
    };
  });
};

/** 按标签聚合专辑 */
export const getAlbums = async (config: StreamingServerConfig): Promise<StreamingAlbumType[]> => {
  const all = await getOrBuildIndex(config);
  const map = new Map<
    string,
    { name: string; artist: string; cover: string; songCount: number; duration: number }
  >();
  for (const song of all) {
    const artistName =
      typeof song.artists === "string"
        ? song.artists
        : Array.isArray(song.artists)
          ? song.artists[0]?.name || "未知艺术家"
          : "未知艺术家";
    const albumName = typeof song.album === "string" ? song.album : song.album?.name || "未知专辑";
    const key = `${artistName}::${albumName}`;
    if (!map.has(key)) {
      map.set(key, {
        name: albumName,
        artist: artistName,
        cover: song.cover || "",
        songCount: 0,
        duration: 0,
      });
    }
    const entry = map.get(key)!;
    if (!entry.cover && song.cover) entry.cover = song.cover;
    entry.songCount += 1;
    entry.duration += song.duration || 0;
  }
  return Array.from(map.entries()).map(([key, a]) => {
    const cover = a.cover;
    return {
      id: stringToNumericId("album:" + key).toString(),
      name: a.name,
      artist: a.artist,
      cover,
      coverSize: cover ? { s: cover, m: cover, l: cover, xl: cover } : undefined,
      songCount: a.songCount,
      duration: a.duration,
      serverId: config.id,
      serverType: config.type,
    };
  });
};

/** 把"目录"作为"歌单"暴露 */
export const getPlaylists = async (
  config: StreamingServerConfig,
): Promise<StreamingPlaylistType[]> => {
  const root = (config as StreamingServerConfig & { libraryRoot?: string }).libraryRoot || "/";
  const entries = await propfind(config, normalizeRoot(root));
  const directories = entries.filter((e) => e.isDirectory);
  return directories.map((d) => ({
    id: d.path,
    name: d.name || stripExt(d.name),
    description: "WebDAV 目录",
    cover: "",
    songCount: undefined,
    duration: undefined,
    public: false,
    serverId: config.id,
    serverType: config.type,
  }));
};

/** 取专辑的歌曲（从索引筛选） */
export const getAlbumItems = async (
  config: StreamingServerConfig,
  albumKey: string,
): Promise<SongType[]> => {
  const all = await getOrBuildIndex(config);
  // albumKey 是 "album:<artist>::<album>" 哈希后的数字 ID 字符串——但在 store 调用时
  // 我们传的是聚合 ID（数字字符串），无法逆向。这里改为：在 store/UI 侧以 album 标签筛选
  // 兜底：用名称匹配
  return all.filter((song) => {
    const albumName = typeof song.album === "string" ? song.album : song.album?.name || "";
    return stringToNumericId("album:" + albumKey) === stringToNumericId("album:" + albumName);
  });
};

/** 取目录歌曲（递归该目录） */
export const getPlaylistItems = async (
  config: StreamingServerConfig,
  dirPath: string,
): Promise<SongType[]> => {
  const queue: string[] = [dirPath];
  const audioEntries: WebDavEntry[] = [];
  while (queue.length > 0) {
    const p = queue.shift()!;
    try {
      const entries = await propfind(config, p);
      for (const entry of entries) {
        if (entry.isDirectory) queue.push(entry.path);
        else if (isAudioFile(entry.name)) audioEntries.push(entry);
      }
    } catch (e) {
      console.warn("[WebDAV] dir read failed:", p, e);
    }
  }
  // 取 tag（并发 4）
  const songs: SongType[] = [];
  const concurrency = 4;
  let inFlight = 0;
  let idx = 0;
  await new Promise<void>((resolve) => {
    const next = () => {
      if (audioEntries.length === 0) {
        resolve();
        return;
      }
      while (inFlight < concurrency && idx < audioEntries.length) {
        const entry = audioEntries[idx++];
        inFlight++;
        fetchTagsForSong(config, entry)
          .then((tag) => {
            songs.push(entryToSong(config, entry, tag));
          })
          .catch((e) => console.warn("[WebDAV] tag failed:", entry.path, e))
          .finally(() => {
            inFlight--;
            if (idx >= audioEntries.length && inFlight === 0) resolve();
            else next();
          });
      }
    };
    next();
  });
  return songs;
};

/** 搜索（在已有索引内做关键词匹配，命中标题/艺术家/专辑） */
export const search = async (
  config: StreamingServerConfig,
  query: string,
): Promise<{
  artists: StreamingArtistType[];
  albums: StreamingAlbumType[];
  songs: SongType[];
}> => {
  const all = await getOrBuildIndex(config);
  const q = query.trim().toLowerCase();
  if (!q) return { artists: [], albums: [], songs: [] };

  const songs = all.filter((s) => {
    const name = (s.name || "").toLowerCase();
    const artist =
      typeof s.artists === "string"
        ? s.artists.toLowerCase()
        : Array.isArray(s.artists)
          ? s.artists
              .map((a) => a.name)
              .join(" ")
              .toLowerCase()
          : "";
    const album =
      typeof s.album === "string" ? s.album.toLowerCase() : (s.album?.name || "").toLowerCase();
    return name.includes(q) || artist.includes(q) || album.includes(q);
  });

  // 派生搜索结果的艺术家/专辑
  const artistMap = new Map<string, StreamingArtistType>();
  const albumMap = new Map<string, StreamingAlbumType>();

  const allArtists = await getArtists(config);
  for (const a of allArtists) {
    if (a.name.toLowerCase().includes(q)) artistMap.set(a.id, a);
  }
  const allAlbums = await getAlbums(config);
  for (const al of allAlbums) {
    if (al.name.toLowerCase().includes(q)) albumMap.set(al.id, al);
  }

  return {
    artists: Array.from(artistMap.values()),
    albums: Array.from(albumMap.values()),
    songs,
  };
};

/** WebDAV 没有歌词接口，留空实现保持接口一致 */
export const getLyrics = async (_config: StreamingServerConfig, _songId: string): Promise<string> =>
  "";

export default {
  ping,
  listDirectory,
  getSongs,
  getRandomSongs,
  getArtists,
  getAlbums,
  getPlaylists,
  getAlbumItems,
  getPlaylistItems,
  search,
  getLyrics,
  getStreamUrl,
  invalidateLibrary,
};
