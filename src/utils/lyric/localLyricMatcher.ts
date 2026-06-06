export type LocalLyricMatchMode = "loose" | "standard" | "strict";
export type LocalLyricFormat = "ttml" | "yrc" | "lrc";

export interface LocalLyricMetadata {
  album?: string;
  musicName?: string;
  artists?: string;
  ncmMusicId?: string;
}

export interface LocalLyricMatchTarget {
  album?: string;
  musicName?: string;
  artists?: string;
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

const VALUE_SEPARATOR = /[/&,&，、;；]+/;
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

export const normalizeLocalLyricValues = (value?: string): string[] => {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(VALUE_SEPARATOR)
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
