export type AmlLyricSearchType = "all" | "title" | "artist" | "album" | "id";

export interface AmlLyricSearchResult {
  title?: string;
  titles?: string[];
  artist?: string;
  artists?: string[];
  album?: string;
  albums?: string[];
  ncmIds?: number[];
  file: string;
  score?: number;
}

export interface AmlLyricSearchResponse {
  ok: boolean;
  results: AmlLyricSearchResult[];
}

const AMLL_API_BASE = "https://amlldb.bikonoo.com";
const AMLL_SEARCH_URL = `${AMLL_API_BASE}/api/search-lyrics`;
export const AMLL_REQUEST_TIMEOUT_MS = 10_000;

const createTimeoutSignal = (): { signal?: AbortSignal; cleanup?: () => void } => {
  if (typeof AbortSignal !== "undefined") {
    const timeout = (AbortSignal as typeof AbortSignal & { timeout?: (ms: number) => AbortSignal })
      .timeout;
    if (typeof timeout === "function") {
      return { signal: timeout(AMLL_REQUEST_TIMEOUT_MS) };
    }
  }
  if (typeof AbortController === "undefined") return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AMLL_REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
};

const toStringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const toStringArray = (value: unknown): string[] | undefined => {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalized = [
    ...new Set(values.filter((item): item is string => typeof item === "string")),
  ];
  return normalized.length ? normalized : undefined;
};

const toNumberArray = (value: unknown): number[] | undefined => {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const normalized = [
    ...new Set(
      values
        .map((item) => {
          if (typeof item === "string") {
            const trimmed = item.trim();
            return trimmed ? Number(trimmed) : Number.NaN;
          }
          return typeof item === "number" ? item : Number.NaN;
        })
        .filter((item) => Number.isFinite(item)),
    ),
  ];
  return normalized.length ? normalized : undefined;
};

const toNumberValue = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const buildAmlRawLyricUrl = (file: string): string => {
  const segments = file.trim().split("/").filter(Boolean);
  if (!segments.length || segments.some((item) => item === "." || item === "..")) {
    throw new Error("Invalid AMLL lyric file path");
  }

  const encodedFile = segments.map((item) => encodeURIComponent(item)).join("/");
  return `${AMLL_API_BASE}/raw-lyrics/${encodedFile}`;
};

export const normalizeAmlLyricSearchResults = (input: unknown): AmlLyricSearchResult[] => {
  const items = Array.isArray(input) ? input : [];
  return items
    .map((item): AmlLyricSearchResult | null => {
      if (!item || typeof item !== "object") return null;
      const data = item as Record<string, unknown>;
      const file = toStringValue(data.file);
      if (!file) return null;
      const result: AmlLyricSearchResult = { file };
      const title = toStringValue(data.title);
      const titles = toStringArray(data.titles);
      const artist = toStringValue(data.artist);
      const artists = toStringArray(data.artists);
      const album = toStringValue(data.album);
      const albums = toStringArray(data.albums);
      const ncmIds = toNumberArray(data.ncmIds);
      const score = toNumberValue(data.score);
      if (title) result.title = title;
      if (titles) result.titles = titles;
      if (artist) result.artist = artist;
      if (artists) result.artists = artists;
      if (album) result.album = album;
      if (albums) result.albums = albums;
      if (ncmIds) result.ncmIds = ncmIds;
      if (score !== undefined) result.score = score;
      return result;
    })
    .filter((item): item is AmlLyricSearchResult => Boolean(item));
};

export const searchAmlLyrics = async (
  query: string,
  type: AmlLyricSearchType = "title",
): Promise<AmlLyricSearchResult[]> => {
  const response = await searchAmlLyricsWithStatus(query, type);
  return response.results;
};

export const searchAmlLyricsWithStatus = async (
  query: string,
  type: AmlLyricSearchType = "title",
): Promise<AmlLyricSearchResponse> => {
  const keyword = query.trim();
  if (!keyword) return { ok: true, results: [] };

  const timeout = createTimeoutSignal();
  try {
    const response = await fetch(AMLL_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: keyword, type }),
      signal: timeout.signal,
    });
    if (!response.ok) return { ok: false, results: [] };
    return { ok: true, results: normalizeAmlLyricSearchResults(await response.json()) };
  } catch {
    return { ok: false, results: [] };
  } finally {
    timeout.cleanup?.();
  }
};

export const fetchAmlRawLyric = async (file: string): Promise<string | null> => {
  const lyricFile = file.trim();
  if (!lyricFile) return null;

  const timeout = createTimeoutSignal();
  try {
    const response = await fetch(buildAmlRawLyricUrl(lyricFile), { signal: timeout.signal });
    if (!response.ok) return null;
    const content = await response.text();
    return content.trim() ? content : null;
  } catch {
    return null;
  } finally {
    timeout.cleanup?.();
  }
};
