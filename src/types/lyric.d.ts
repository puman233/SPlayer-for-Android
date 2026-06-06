import { type LyricLine } from "@applemusic-like-lyrics/lyric";

/**
 * 歌词数据类型
 */
export interface SongLyric {
  lrcData: LyricLine[];
  yrcData: LyricLine[];
}

/**
 * 歌词优先级
 */
export type LyricPriority = "auto" | "qm" | "ttml" | "official" | "local";

/**
 * 本地歌词匹配档位
 */
export type LocalLyricMatchMode = "loose" | "standard" | "strict";
