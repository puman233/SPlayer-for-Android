export type AndroidLyricPriority = "auto" | "qm" | "ttml" | "official" | "local";

export interface AndroidLyricFetchers<TResult> {
  hasResult(result: TResult): boolean;
  emptyResult(): TResult;
  fetchSidecar(): Promise<TResult>;
  fetchDirectory(preferMetadata: boolean): Promise<TResult>;
  fetchOnline(): Promise<TResult>;
  fetchAmlTtml(): Promise<TResult>;
  fetchLegacyQm(): Promise<TResult>;
  fetchOfficial(): Promise<TResult>;
}

export interface AndroidLyricSchedulerOptions<TResult> {
  isLocalSong: boolean;
  priority: AndroidLyricPriority;
  fetchers: AndroidLyricFetchers<TResult>;
}

type LyricSource<TResult> = () => Promise<TResult>;

export const fetchAndroidPrioritizedLyricResult = async <TResult>({
  isLocalSong,
  priority,
  fetchers,
}: AndroidLyricSchedulerOptions<TResult>): Promise<TResult> => {
  if (isLocalSong) {
    const sidecarResult = await fetchers.fetchSidecar();
    if (fetchers.hasResult(sidecarResult)) return sidecarResult;
  }

  const directoryResult = await fetchers.fetchDirectory(isLocalSong);
  if (fetchers.hasResult(directoryResult)) return directoryResult;

  if (!isLocalSong) {
    return fetchers.fetchOnline();
  }

  const sourceOrders: Partial<Record<AndroidLyricPriority, Array<LyricSource<TResult>>>> = {
    local: [fetchers.fetchAmlTtml, fetchers.fetchLegacyQm, fetchers.fetchOfficial],
    ttml: [fetchers.fetchAmlTtml, fetchers.fetchLegacyQm, fetchers.fetchOfficial],
    qm: [fetchers.fetchLegacyQm, fetchers.fetchAmlTtml, fetchers.fetchOfficial],
    official: [fetchers.fetchOfficial],
    auto: [fetchers.fetchAmlTtml, fetchers.fetchLegacyQm, fetchers.fetchOfficial],
  };

  const sources = sourceOrders[priority] || sourceOrders.auto || [];
  for (const fetchSource of sources) {
    const result = await fetchSource();
    if (fetchers.hasResult(result)) return result;
  }

  return fetchers.emptyResult();
};
