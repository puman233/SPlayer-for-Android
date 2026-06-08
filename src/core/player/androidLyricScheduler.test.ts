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

const createFetchers = (
  values: Partial<Record<Exclude<ResultId, "empty">, TestResult>>,
  calls: string[],
): AndroidLyricFetchers<TestResult> => ({
  hasResult: (value) => value.hasLyric,
  emptyResult: () => result("empty", false),
  fetchSidecar: async () => {
    calls.push("sidecar");
    return values.sidecar ?? result("empty", false);
  },
  fetchDirectory: async (preferMetadata) => {
    calls.push(`directory:${preferMetadata ? "metadata" : "index"}`);
    return values.directory ?? result("empty", false);
  },
  fetchOnline: async () => {
    calls.push("online");
    return values.online ?? result("empty", false);
  },
  fetchAmlTtml: async () => {
    calls.push("amll");
    return values.amll ?? result("empty", false);
  },
  fetchLegacyQm: async () => {
    calls.push("qm");
    return values.qm ?? result("empty", false);
  },
  fetchOfficial: async () => {
    calls.push("official");
    return values.official ?? result("empty", false);
  },
});

describe("androidLyricScheduler", () => {
  it("在线歌曲先查 Android 扫描目录，命中后不请求在线歌词", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: false,
      priority: "auto",
      fetchers: createFetchers({ directory: result("directory"), online: result("online") }, calls),
    });

    assert.equal(lyric.id, "directory");
    assert.deepEqual(calls, ["directory:index"]);
  });

  it("在线歌曲扫描目录未命中时回退在线歌词", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: false,
      priority: "auto",
      fetchers: createFetchers({ online: result("online") }, calls),
    });

    assert.equal(lyric.id, "online");
    assert.deepEqual(calls, ["directory:index", "online"]);
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

  it("本地歌曲无同目录歌词时优先使用扫描目录", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "auto",
      fetchers: createFetchers({ directory: result("directory"), amll: result("amll") }, calls),
    });

    assert.equal(lyric.id, "directory");
    assert.deepEqual(calls, ["sidecar", "directory:metadata"]);
  });

  it("本地歌曲扫描目录未命中时按歌词优先级回退", async () => {
    const calls: string[] = [];

    const lyric = await fetchAndroidPrioritizedLyricResult({
      isLocalSong: true,
      priority: "qm",
      fetchers: createFetchers({ qm: result("qm"), amll: result("amll") }, calls),
    });

    assert.equal(lyric.id, "qm");
    assert.deepEqual(calls, ["sidecar", "directory:metadata", "qm"]);
  });
});
