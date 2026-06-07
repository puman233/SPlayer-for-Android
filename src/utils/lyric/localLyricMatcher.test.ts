import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findBestAmlLyricMatch,
  findBestLocalLyricMatch,
  matchLocalLyricMetadata,
  normalizeLocalLyricValues,
  type AmlLyricCandidate,
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

  it("支持数组元数据字段", () => {
    const result = matchLocalLyricMetadata(
      {
        musicName: ["星间旅行", "Stellar Trip"],
        album: ["夜空列车"],
        artists: ["Alice", "Bob"],
      },
      target,
      "standard",
    );

    assert.equal(result.matched, true);
    assert.equal(result.matchedFields, 3);
  });

  it("宽松模式允许标题包含匹配", () => {
    const result = matchLocalLyricMetadata(
      { musicName: "星间旅行 live" },
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

  it("标准模式必须匹配标题并由专辑或歌手佐证", () => {
    assert.equal(
      matchLocalLyricMetadata({ album: "夜空列车", artists: "Alice/Bob" }, target, "standard")
        .matched,
      false,
    );

    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行", album: "其他专辑", artists: "其他歌手" },
        target,
        "standard",
      ).matched,
      false,
    );

    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行", album: "夜空列车", artists: "其他歌手" },
        target,
        "standard",
      ).matched,
      true,
    );
  });

  it("宽松模式需要标题命中且可用专辑或歌手不能冲突", () => {
    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行 live", album: "其他专辑", artists: "其他歌手" },
        target,
        "loose",
      ).matched,
      false,
    );

    assert.equal(
      matchLocalLyricMetadata(
        { musicName: "星间旅行 live", album: "其他专辑", artists: "Alice feat. Bob" },
        target,
        "loose",
      ).matched,
      true,
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

  it("优先选择匹配字段更完整的候选，再比较格式和时间", () => {
    const candidates: LocalLyricCandidate[] = [
      {
        uri: "ttml-two-fields",
        name: "song.ttml",
        format: "ttml",
        directoryUri: "dir-a",
        directoryIndex: 0,
        lastModified: 500,
        metadata: { musicName: "星间旅行", album: "夜空列车", artists: "其他歌手" },
      },
      {
        uri: "lrc-three-fields",
        name: "song.lrc",
        format: "lrc",
        directoryUri: "dir-a",
        directoryIndex: 0,
        lastModified: 100,
        metadata: { musicName: "星间旅行", album: "夜空列车", artists: "Alice/Bob" },
      },
    ];

    assert.equal(findBestLocalLyricMatch(candidates, target, "standard")?.uri, "lrc-three-fields");
  });

  it("按 AMLL 评分、匹配字段、网易云 ID 和原顺序选择最佳歌词", () => {
    const candidates: AmlLyricCandidate[] = [
      {
        file: "no-ncm.ttml",
        title: "星间旅行",
        titles: ["星间旅行"],
        album: "夜空列车",
        albums: ["夜空列车"],
        artist: "Alice",
        artists: ["Alice"],
        score: 99,
      },
      {
        file: "less-match.ttml",
        title: "星间旅行",
        titles: ["星间旅行"],
        album: "夜空列车",
        albums: ["夜空列车"],
        artist: "其他歌手",
        artists: ["其他歌手"],
        ncmIds: [100],
        score: 99,
      },
      {
        file: "best.ttml",
        title: "星间旅行",
        titles: ["星间旅行"],
        album: "夜空列车",
        albums: ["夜空列车"],
        artist: "Alice",
        artists: ["Alice"],
        ncmIds: [101],
        score: 99,
      },
      {
        file: "later.ttml",
        title: "星间旅行",
        titles: ["星间旅行"],
        album: "夜空列车",
        albums: ["夜空列车"],
        artist: "Alice",
        artists: ["Alice"],
        ncmIds: [102],
        score: 99,
      },
    ];

    assert.equal(findBestAmlLyricMatch(candidates, target, "standard")?.file, "best.ttml");
  });

  it("AMLL 候选排序忽略无效网易云 ID", () => {
    const candidates: AmlLyricCandidate[] = [
      {
        file: "invalid-ncm.ttml",
        title: "星间旅行",
        album: "夜空列车",
        artist: "Alice",
        ncmIds: ["", "  ", false as unknown as string],
        score: 99,
      },
      {
        file: "valid-ncm.ttml",
        title: "星间旅行",
        album: "夜空列车",
        artist: "Alice",
        ncmIds: ["100"],
        score: 99,
      },
    ];

    assert.equal(findBestAmlLyricMatch(candidates, target, "standard")?.file, "valid-ncm.ttml");
  });

  it("AMLL 候选遵循标准和宽松匹配档位", () => {
    const candidates: AmlLyricCandidate[] = [
      {
        file: "loose.ttml",
        title: "星间旅行 live",
        titles: ["星间旅行 live"],
        album: "其他专辑",
        albums: ["其他专辑"],
        artist: "Alice feat. Bob",
        artists: ["Alice feat. Bob"],
        score: 1,
      },
    ];

    assert.equal(findBestAmlLyricMatch(candidates, target, "loose")?.file, "loose.ttml");
    assert.equal(findBestAmlLyricMatch(candidates, target, "standard"), null);
  });
});
