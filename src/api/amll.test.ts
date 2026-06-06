import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildAmlRawLyricUrl,
  fetchAmlRawLyric,
  normalizeAmlLyricSearchResults,
  searchAmlLyrics,
  searchAmlLyricsWithStatus,
} from "./amll.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("amll api", () => {
  it("归一化搜索结果字段", () => {
    const results = normalizeAmlLyricSearchResults([
      {
        title: "星间旅行",
        titles: ["Stellar Trip"],
        artist: "Alice",
        artists: "Bob",
        album: "夜空列车",
        albums: ["Night Train"],
        ncmIds: ["123", 456, "bad"],
        file: "song.ttml",
        score: "98",
      },
    ]);

    assert.deepEqual(results, [
      {
        title: "星间旅行",
        titles: ["Stellar Trip"],
        artist: "Alice",
        artists: ["Bob"],
        album: "夜空列车",
        albums: ["Night Train"],
        ncmIds: [123, 456],
        file: "song.ttml",
        score: 98,
      },
    ]);
  });

  it("拼接 raw lyric 地址并编码文件名", () => {
    assert.equal(
      buildAmlRawLyricUrl("dir/song name.ttml"),
      "https://amlldb.bikonoo.com/raw-lyrics/dir/song%20name.ttml",
    );
  });

  it("空搜索结果返回成功状态和空数组", async () => {
    globalThis.fetch = async (_input, init) => {
      assert.ok(init?.signal);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.deepEqual(await searchAmlLyrics("不存在", "title"), []);
    assert.deepEqual(await searchAmlLyricsWithStatus("不存在", "title"), {
      ok: true,
      results: [],
    });
  });

  it("搜索网络失败返回失败状态", async () => {
    globalThis.fetch = async () => {
      throw new Error("network");
    };

    assert.deepEqual(await searchAmlLyricsWithStatus("不存在", "title"), {
      ok: false,
      results: [],
    });
  });

  it("下载 raw TTML 失败返回 null", async () => {
    globalThis.fetch = async (_input, init) => {
      assert.ok(init?.signal);
      return new Response("", { status: 404 });
    };

    assert.equal(await fetchAmlRawLyric("missing.ttml"), null);
  });
});
