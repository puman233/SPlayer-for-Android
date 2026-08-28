import type { SongMatchInfo } from "./types";

/**
 * 归一化歌名用于匹配：小写 + 去除括号及其内容
 */
export const normalizeName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
};

/**
 * 归一化艺术家名：小写 + 统一分隔符为空格
 */
export const normalizeArtist = (artist: string): string => {
  return artist
    .toLowerCase()
    .replace(/[&/、，,;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * 校验搜索结果是否与原曲匹配（歌名 + 艺术家）
 * @param resultName 搜索结果歌名
 * @param resultArtist 搜索结果艺术家（可选）
 * @param match 原曲匹配信息
 */
export const isSongMatch = (
  resultName: string,
  resultArtist: string | undefined,
  match: SongMatchInfo,
): boolean => {
  const normalizedResult = normalizeName(resultName);
  const normalizedOriginal = normalizeName(match.songName);
  // 歌名：双向 includes（兼容一方带后缀的情况）
  if (
    !normalizedResult.includes(normalizedOriginal) &&
    !normalizedOriginal.includes(normalizedResult)
  ) {
    return false;
  }
  // 艺术家：归一化分隔符后双向 includes
  if (resultArtist && match.artist) {
    const normalizedResultArtist = normalizeArtist(resultArtist);
    const normalizedOriginalArtist = normalizeArtist(match.artist);
    if (
      !normalizedResultArtist.includes(normalizedOriginalArtist) &&
      !normalizedOriginalArtist.includes(normalizedResultArtist)
    ) {
      return false;
    }
  }
  return true;
};
