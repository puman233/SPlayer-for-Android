import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchAndroidPrioritizedLyricResult,
  type AndroidLyricFetchers,
} from "./androidLyricScheduler.ts";

type ResultId = "empty" | "sidecar" | "directory" | "online" | "amll" | "qm" | "official";

interface TestResult {
  id: ResultId;
  hasLyric: boolean;
}

const result = (id: ResultId, hasLyric = id !== "empty"): TestResult => ({ id, hasLyric });

const deferredResult = () => {
  let resolve!: (value: TestResult) => void;
  const promise = new Promise<TestResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const deferredRejectedResult = () => {
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TestResult>((_, fail) => {
    reject = fail;
  });
  return { promise, reject };
};

const createFetchers = (
  values: Partial<Record<Exclude<ResultId, "empty">, TestResult | Promise<TestResult>>>,
  calls: string[],
): AndroidLyricFetchers<TestResult> => ({
  hasResult: (value) => value.hasLyric,
  emptyResult: () => result("empty", false),
  fetchSidecar: async () => {
    calls.push("sidecar");
    return values.sidecar ? await values.sidecar : result("empty", false);
  },
  fetchDirectory: async (preferMetadata) => {
    calls.push(`directory:${preferMetadata ? "metadata" : "index"}`);
    return values.directory ? await values.directory : result("empty", false);
  },
  fetchOnline: async () => {
    calls.push("online");
    return values.online ? await values.online : result("empty", false);
  },
  fetchAmlTtml: async () => {
    calls.push("amll");
    return values.amll ? await values.amll : result("empty", false);
  },
  fetchLegacyQm: async () => {
    calls.push("qm");
    return values.qm ? await values.qm : result("empty", false);
  },
  fetchOfficial: async () => {
    calls.push("official");
    return values.official ? await values.official : result("empty", false);
  },
});

describe("androidLyricScheduler", () => {
  it("在线歌曲直接请求在线歌词", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: false,
      priority: "auto",
      fetchers: createFetchers({ directory: result("directory"), online: result("online") }, calls),
    });

    assert.equal(lyric.id, "online");
    assert.deepEqual(calls, ["online"]);
  });

  it("在线歌曲不等待扫描目录未命中", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: false,
      priority: "auto",
      fetchers: createFetchers({ online: result("online") }, calls),
    });

    assert.equal(lyric.id, "online");
    assert.deepEqual(calls, ["online"]);
  });

  it("本地歌曲同目录歌词优先于扫描目录", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "auto",
      fetchers: createFetchers(
        { sidecar: result("sidecar"), directory: result("directory") },
        calls,
      ),
    });

    assert.equal(lyric.id, "sidecar");
    assert.deepEqual(calls, ["sidecar"]);
  });

  it("本地歌曲无同目录歌词时按 auto 优先级查找", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "auto",
      fetchers: createFetchers({ directory: result("directory"), amll: result("amll") }, calls),
    });

    assert.equal(lyric.id, "amll");
    assert.deepEqual(calls, ["sidecar", "amll", "directory:metadata", "qm", "official"]);
  });

  it("本地歌曲扫描目录未命中时按歌词优先级回退", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "qm",
      fetchers: createFetchers({ qm: result("qm"), amll: result("amll") }, calls),
    });

    assert.equal(lyric.id, "qm");
    assert.deepEqual(calls, ["sidecar", "qm", "directory:metadata", "amll", "official"]);
  });

  it("本地歌曲 local 优先级优先使用扫描目录", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "local",
      fetchers: createFetchers({ directory: result("directory"), amll: result("amll") }, calls),
    });

    assert.equal(lyric.id, "directory");
    assert.deepEqual(calls, ["sidecar", "directory:metadata"]);
  });

  it("本地歌曲同目录未命中后并发查询 YRC 和 TTML 来源", async () => {
    const calls: string[] = [];
    const amll = deferredResult();
    const directory = deferredResult();
    const qm = deferredResult();

    const lyricPromise = fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "ttml",
      fetchers: createFetchers(
        { amll: amll.promise, directory: directory.promise, qm: qm.promise },
        calls,
      ),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, ["sidecar", "amll", "directory:metadata", "qm", "official"]);

    directory.resolve(result("empty", false));
    qm.resolve(result("qm"));
    amll.resolve(result("empty", false));

    const lyric = await lyricPromise;

    assert.equal(lyric.id, "qm");
  });

  it("高优先级命中后消费低优先级失败请求", async () => {
    const calls: string[] = [];
    const directory = deferredRejectedResult();
    const unhandledReasons: unknown[] = [];
    const handleUnhandledRejection = (reason: unknown) => {
      unhandledReasons.push(reason);
    };

    process.on("unhandledRejection", handleUnhandledRejection);

    try {
      const lyric = await fetchAndroidPrioritizedLyricResult({
        isLocalSong: true,
        priority: "auto",
        fetchers: createFetchers(
          { amll: result("amll"), directory: directory.promise },
          calls,
        ),
      });

      directory.reject(new Error("directory failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(lyric.id, "amll");
      assert.deepEqual(calls, ["sidecar", "amll", "directory:metadata", "qm", "official"]);
      assert.deepEqual(unhandledReasons, []);
    } finally {
      process.off("unhandledRejection", handleUnhandledRejection);
    }
  });
});
