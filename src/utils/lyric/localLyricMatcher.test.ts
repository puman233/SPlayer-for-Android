import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findBestLocalLyricMatch,
  matchLocalLyricMetadata,
  normalizeLocalLyricValues,
  type LocalLyricCandidate,
} from "./localLyricMatcher.ts";

const target = {
  musicName: "星间旅行",
  album: "夜空列车",
  artists: "Alice / Bob",
};

describe("localLyricMatcher", () => {
  it("拆分多值字段并归一化", () => {
    assert.deepEqual(normalizeLocalLyricValues(" Alice / Bob、Carol & Dave ; Eve "), [
      "alice",
      "bob",
      "carol",
      "dave",
      "eve",
    ]);
  });

  it("宽松模式任一项包含即可匹配", () => {
    const result = matchLocalLyricMetadata(
      { musicName: "星间旅行 live", album: "其他专辑", artists: "其他歌手" },
      target,
      "loose",
    );

    assert.equal(result.matched, true);
    assert.equal(result.matchedFields, 1);
  });

  it("标准模式要求至少两项完全匹配", () => {
    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行", album: "夜空列车", artists: "其他歌手" },
        target,
        "standard",
      ).matched,
      true,
    );

    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行", album: "其他专辑", artists: "其他歌手" },
        target,
        "standard",
      ).matched,
      false,
    );
  });

  it("严格模式要求声明的三项元数据全部完全匹配", () => {
    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行", album: "夜空列车", artists: "Alice/Bob" },
        target,
        "strict",
      ).matched,
      true,
    );

    assert.equal(
      matchLocalLyricMetadata({ musicName: "星间旅行", album: "夜空列车" }, target, "strict")
        .matched,
      false,
    );
  });

  it("按格式、目录顺序和修改时间选择最佳歌词", () => {
    const candidates: LocalLyricCandidate[] = [
      {
        uri: "lrc",
        name: "song.lrc",
        format: "lrc",
        directoryUri: "dir-a",
        directoryIndex: 0,
        lastModified: 300,
        metadata: { musicName: "星间旅行", album: "夜空列车", artists: "Alice" },
      },
      {
        uri: "yrc",
        name: "song.yrc",
        format: "yrc",
        directoryUri: "dir-a",
        directoryIndex: 0,
        lastModified: 100,
        metadata: { musicName: "星间旅行", album: "夜空列车", artists: "Alice" },
      },
      {
        uri: "ttml-old",
        name: "song-old.ttml",
        format: "ttml",
        directoryUri: "dir-b",
        directoryIndex: 1,
        lastModified: 500,
        metadata: { musicName: "星间旅行", album: "夜空列车", artists: "Alice" },
      },
      {
        uri: "ttml-new",
        name: "song-new.ttml",
        format: "ttml",
        directoryUri: "dir-a",
        directoryIndex: 0,
        lastModified: 200,
        metadata: { musicName: "星间旅行", album: "夜空列车", artists: "Alice" },
      },
    ];

    assert.equal(findBestLocalLyricMatch(candidates, target, "standard")?.uri, "ttml-new");
  });
});
