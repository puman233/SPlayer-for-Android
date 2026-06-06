export type LocalLyricMatchMode = "loose" | "standard" | "strict";
export type LocalLyricFormat = "ttml" | "yrc" | "lrc";
export type LocalLyricMetadataValue = string | string[];

export interface LocalLyricMetadata {
  album?: LocalLyricMetadataValue;
  musicName?: LocalLyricMetadataValue;
  artists?: LocalLyricMetadataValue;
  ncmMusicId?: LocalLyricMetadataValue;
}

export interface LocalLyricMatchTarget {
  album?: LocalLyricMetadataValue;
  musicName?: LocalLyricMetadataValue;
  artists?: LocalLyricMetadataValue;
}

export interface LocalLyricCandidate {
  uri: string;
  name: string;
  lastModified: number;
  directoryUri: string;
  format: LocalLyricFormat;
  metadata?: LocalLyricMetadata;
  directoryIndex?: number;
}

export interface LocalLyricMatchResult {
  matched: boolean;
  matchedFields: number;
}

export interface AmlLyricCandidate {
  title?: string;
  titles?: LocalLyricMetadataValue;
  artist?: string;
  artists?: LocalLyricMetadataValue;
  album?: string;
  albums?: LocalLyricMetadataValue;
  ncmIds?: Array<number | string>;
  file?: string;
  score?: number;
}

const VALUE_SEPARATOR = /[/&,，、;；]+/;
const FORMAT_WEIGHT: Record<LocalLyricFormat, number> = {
  ttml: 3,
  yrc: 2,
  lrc: 1,
};

const normalizeValue = (value: string) =>
  value
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();

export const normalizeLocalLyricValues = (value?: LocalLyricMetadataValue): string[] => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .flatMap((item) => item.split(VALUE_SEPARATOR))
        .map(normalizeValue)
        .filter(Boolean),
    ),
  ];
};

const hasExactOverlap = (source: string[], target: string[]) =>
  source.some((sourceValue) => target.includes(sourceValue));

const hasContainsOverlap = (source: string[], target: string[]) =>
  source.some((sourceValue) =>
    target.some(
      (targetValue) => sourceValue.includes(targetValue) || targetValue.includes(sourceValue),
    ),
  );

const getFieldPairs = (metadata: LocalLyricMetadata, target: LocalLyricMatchTarget) => [
  {
    source: normalizeLocalLyricValues(metadata.musicName),
    target: normalizeLocalLyricValues(target.musicName),
  },
  {
    source: normalizeLocalLyricValues(metadata.album),
    target: normalizeLocalLyricValues(target.album),
  },
  {
    source: normalizeLocalLyricValues(metadata.artists),
    target: normalizeLocalLyricValues(target.artists),
  },
];

export const matchLocalLyricMetadata = (
  metadata: LocalLyricMetadata | undefined,
  target: LocalLyricMatchTarget,
  mode: LocalLyricMatchMode,
): LocalLyricMatchResult => {
  if (!metadata) return { matched: false, matchedFields: 0 };

  const pairs = getFieldPairs(metadata, target);
  const declaredPairs = pairs.filter((pair) => pair.source.length > 0);
  const exactMatches = pairs.filter(
    (pair) =>
      pair.source.length > 0 &&
      pair.target.length > 0 &&
      hasExactOverlap(pair.source, pair.target),
  ).length;

  if (mode === "loose") {
    const hasLooseMatch = pairs.some(
      (pair) =>
        pair.source.length > 0 &&
        pair.target.length > 0 &&
        hasContainsOverlap(pair.source, pair.target),
    );
    return {
      matched: hasLooseMatch,
      matchedFields: hasLooseMatch ? Math.max(exactMatches, 1) : 0,
    };
  }

  if (mode === "strict") {
    const allDeclared = declaredPairs.length === 3;
    return { matched: allDeclared && exactMatches === 3, matchedFields: exactMatches };
  }

  return { matched: exactMatches >= 2, matchedFields: exactMatches };
};

export const findBestLocalLyricMatch = (
  candidates: LocalLyricCandidate[],
  target: LocalLyricMatchTarget,
  mode: LocalLyricMatchMode,
): LocalLyricCandidate | null => {
  const matched = candidates
    .map((candidate, order) => ({
      candidate,
      order,
      match: matchLocalLyricMetadata(candidate.metadata, target, mode),
    }))
    .filter((item) => item.match.matched);

  matched.sort((a, b) => {
    const formatDiff = FORMAT_WEIGHT[b.candidate.format] - FORMAT_WEIGHT[a.candidate.format];
    if (formatDiff) return formatDiff;

    const directoryDiff =
      (a.candidate.directoryIndex ?? a.order) - (b.candidate.directoryIndex ?? b.order);
    if (directoryDiff) return directoryDiff;

    const timeDiff = (b.candidate.lastModified || 0) - (a.candidate.lastModified || 0);
    if (timeDiff) return timeDiff;

    return a.order - b.order;
  });

  return matched[0]?.candidate || null;
};

const mergeValues = (
  primary?: string,
  values?: LocalLyricMetadataValue,
): LocalLyricMetadataValue | undefined => {
  const merged = [
    ...(primary ? [primary] : []),
    ...(Array.isArray(values) ? values : values ? [values] : []),
  ];
  return merged.length ? merged : undefined;
};

const normalizeNcmIds = (ids?: Array<number | string>) =>
  Array.isArray(ids) ? ids.filter((id) => Number.isFinite(Number(id))) : [];

export const findBestAmlLyricMatch = (
  candidates: AmlLyricCandidate[],
  target: LocalLyricMatchTarget,
  mode: LocalLyricMatchMode,
): AmlLyricCandidate | null => {
  const matched = candidates
    .map((candidate, order) => ({
      candidate,
      order,
      score: Number(candidate.score || 0),
      hasNcmId: normalizeNcmIds(candidate.ncmIds).length > 0,
      match: matchLocalLyricMetadata(
        {
          musicName: mergeValues(candidate.title, candidate.titles),
          album: mergeValues(candidate.album, candidate.albums),
          artists: mergeValues(candidate.artist, candidate.artists),
        },
        target,
        mode,
      ),
    }))
    .filter((item) => Boolean(item.candidate.file) && item.match.matched);

  matched.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff) return scoreDiff;

    const fieldDiff = b.match.matchedFields - a.match.matchedFields;
    if (fieldDiff) return fieldDiff;

    const ncmDiff = Number(b.hasNcmId) - Number(a.hasNcmId);
    if (ncmDiff) return ncmDiff;

    return a.order - b.order;
  });

  return matched[0]?.candidate || null;
};
