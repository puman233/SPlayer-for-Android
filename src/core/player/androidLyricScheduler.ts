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

type LyricRequestResult<TResult> =
  | { fulfilled: true; result: TResult }
  | { fulfilled: false };

const settleLyricRequest = async <TResult>(
  fetchSource: LyricSource<TResult>,
): Promise<LyricRequestResult<TResult>> => {
  try {
    return { fulfilled: true, result: await fetchSource() };
  } catch {
    return { fulfilled: false };
  }
};

const fetchFirstByPriority = async <TResult>(
  sources: Array<LyricSource<TResult>>,
  fetchers: AndroidLyricFetchers<TResult>,
): Promise<TResult> => {
  const requests = sources.map((fetchSource) => settleLyricRequest(fetchSource));

  for (const request of requests) {
    const settled = await request;
    if (settled.fulfilled && fetchers.hasResult(settled.result)) return settled.result;
  }

  return fetchers.emptyResult();
};

export const fetchAndroidPrioritizedLyricResult = async <TResult>({
  isLocalSong,
  priority,
  fetchers,
}: AndroidLyricSchedulerOptions<TResult>): Promise<TResult> => {
  if (isLocalSong) {
    const sidecarResult = await fetchers.fetchSidecar();
    if (fetchers.hasResult(sidecarResult)) return sidecarResult;
  }

  if (!isLocalSong) {
    return fetchers.fetchOnline();
  }

  const localDirectory = () => fetchers.fetchDirectory(true);

  if (priority === "local") {
    const directoryResult = await localDirectory();
    if (fetchers.hasResult(directoryResult)) return directoryResult;
    return fetchFirstByPriority(
      [fetchers.fetchAmlTtml, fetchers.fetchLegacyQm, fetchers.fetchOfficial],
      fetchers,
    );
  }

  const sourceOrders: Partial<Record<AndroidLyricPriority, Array<LyricSource<TResult>>>> = {
    ttml: [fetchers.fetchAmlTtml, localDirectory, fetchers.fetchLegacyQm, fetchers.fetchOfficial],
    qm: [fetchers.fetchLegacyQm, localDirectory, fetchers.fetchAmlTtml, fetchers.fetchOfficial],
    official: [fetchers.fetchOfficial, localDirectory],
    auto: [fetchers.fetchAmlTtml, localDirectory, fetchers.fetchLegacyQm, fetchers.fetchOfficial],
  };

  const sources = sourceOrders[priority] || sourceOrders.auto || [];
  return fetchFirstByPriority(sources, fetchers);
};
