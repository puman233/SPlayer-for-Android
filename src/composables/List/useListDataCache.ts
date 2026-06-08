import type { CoverType, SongType } from "@/types/main";
import { useCacheManager } from "@/core/resource/CacheManager";

/**
 * 列表类型
 *
 * - playlist / album / radio：网易云资源详情
 * - streaming-playlist：流媒体歌单，id 为字符串
 * - home-rec：首页推荐区聚合数据（4 条 API 合一），id 固定 0
 */
export type ListType = "playlist" | "album" | "radio" | "streaming-playlist" | "home-rec";

/**
 * 列表缓存数据结构
 */
export interface ListCacheData {
  /** 缓存版本号 */
  version: number;
  /** 缓存时间戳 */
  timestamp: number;
  /** 缓存是否完整 */
  complete: boolean;
  /** 列表类型 */
  type: ListType;
  /** 列表 ID（数字 或 字符串，后者供 streaming 场景） */
  id: number | string;
  /** 列表详情 */
  detail: CoverType;
  /** 歌曲列表 */
  songs: SongType[];
}

/** 缓存版本号 */
const CACHE_VERSION = 2; // 因缓存逻辑变更提升版本

/**
 * 列表数据缓存组合式函数
 * 提供列表缓存的读写功能
 */
export const useListDataCache = () => {
  const cacheManager = useCacheManager();

  /**
   * 生成缓存 key
   * @param type 列表类型
   * @param id 列表 ID
   */
  const getCacheKey = (type: ListType, id: number | string): string => {
    return `${type}-${id}.json`;
  };

  /**
   * 保存缓存
   * @param type 列表类型
   * @param id 列表 ID
   * @param detail 列表详情数据
   * @param songs 歌曲列表
   */
  const saveCache = async (
    type: ListType,
    id: number | string,
    detail: CoverType,
    songs: SongType[],
    complete: boolean = true,
  ): Promise<void> => {
    const cacheData: ListCacheData = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      complete,
      type,
      id,
      detail,
      songs,
    };

    const key = getCacheKey(type, id);
    const jsonStr = JSON.stringify(cacheData);

    try {
      await cacheManager.set("list-data", key, jsonStr);
      console.log(`✅ List cache saved: ${key}`);
    } catch (error) {
      console.error(`❌ Failed to save list cache: ${key}`, error);
    }
  };

  /**
   * 加载缓存
   * @param type 列表类型
   * @param id 列表 ID
   * @returns 缓存数据，如果不存在或已过期则返回 null
   */
  const loadCache = async (type: ListType, id: number | string): Promise<ListCacheData | null> => {
    const key = getCacheKey(type, id);

    try {
      const result = await cacheManager.get("list-data", key);
      if (!result.success || !result.data) {
        return null;
      }

      // 将 Uint8Array 转换为字符串
      const jsonStr = new TextDecoder().decode(result.data);
      const cacheData: ListCacheData = JSON.parse(jsonStr);

      // 检查版本
      if (cacheData.version !== CACHE_VERSION) {
        console.log(`⚠️ Cache version mismatch: ${key}, removing old cache`);
        await removeCache(type, id);
        return null;
      }

      if (typeof cacheData.complete !== "boolean") {
        cacheData.complete = true;
      }

      console.log(`✅ List cache loaded: ${key}`);
      return cacheData;
    } catch (error) {
      console.error(`❌ Failed to load list cache: ${key}`, error);
      return null;
    }
  };

  /**
   * 检查缓存是否需要更新
   * 通过比较 updateTime 来判断
   * @param cached 缓存数据
   * @param latestDetail 新获取的详情数据
   * @returns 是否需要更新
   */
  const checkNeedsUpdate = (cached: ListCacheData, latestDetail: CoverType): boolean => {
    // 修复 #9：partial cache（complete=false）不应触发全量重拉，应由调用方走「续传」路径
    // （getPlaylistAllSongs 从 cached.songs.length 偏移开始续传）。
    // 仅当上游 updateTime / count 真发生变化才返回 true。

    // 如果有 updateTime，则比较
    if (cached.detail.updateTime && latestDetail.updateTime) {
      const needsUpdate = cached.detail.updateTime !== latestDetail.updateTime;
      if (needsUpdate) {
        console.log(`🔄 Cache needs update: timestamp changed`);
        console.log(`   Old: ${cached.detail.updateTime}`);
        console.log(`   New: ${latestDetail.updateTime}`);
      } else {
        console.log(`✅ Cache is up to date (timestamp match)`);
      }
      return needsUpdate;
    }

    // 如果没有 updateTime，比较 count
    if (cached.detail.count !== latestDetail.count) {
      console.log(`🔄 Cache needs update: count changed`);
      return true;
    }

    if (cached.type === "album") {
      console.log(`✅ Album cache is up to date (count match)`);
    } else {
      console.log(`⚠️ No timestamp found, assuming up to date based on count`);
    }

    return false;
  };

  /**
   * 删除缓存
   * @param type 列表类型
   * @param id 列表 ID
   */
  const removeCache = async (type: ListType, id: number | string): Promise<void> => {
    const key = getCacheKey(type, id);

    try {
      await cacheManager.remove("list-data", key);
      console.log(`🗑️ List cache removed: ${key}`);
    } catch (error) {
      console.error(`❌ Failed to remove list cache: ${key}`, error);
    }
  };

  /**
   * 清除所有列表缓存
   */
  const clearAllCache = async (): Promise<void> => {
    try {
      await cacheManager.clear("list-data");
      console.log(`🗑️ All list cache cleared`);
    } catch (error) {
      console.error(`❌ Failed to clear list cache`, error);
    }
  };

  return {
    getCacheKey,
    saveCache,
    loadCache,
    checkNeedsUpdate,
    removeCache,
    clearAllCache,
  };
};
