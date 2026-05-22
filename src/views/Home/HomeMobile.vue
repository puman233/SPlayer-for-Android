<template>
  <div class="home-mobile">
    <!-- 顶部快捷入口 -->
    <div v-if="isLogin()" class="quick-actions">
      <div class="action-item" @click="router.push({ name: 'daily-songs' })">
        <div class="action-icon daily">
          <span class="date">{{ new Date().getDate() }}</span>
        </div>
        <span class="action-label">每日推荐</span>
      </div>
      <div class="action-item" @click="router.push({ name: 'like-songs' })">
        <div class="action-icon like">
          <SvgIcon name="Favorite" :size="24" />
        </div>
        <span class="action-label">我喜欢的</span>
      </div>
      <div class="action-item" @click="router.push({ name: 'discover-playlists' })">
        <div class="action-icon playlist">
          <SvgIcon name="Playlist" :size="24" />
        </div>
        <span class="action-label">歌单广场</span>
      </div>
      <div class="action-item" @click="router.push({ name: 'discover-artists' })">
        <div class="action-icon artist">
          <SvgIcon name="Artist" :size="24" />
        </div>
        <span class="action-label">歌手推荐</span>
      </div>
    </div>

    <!-- 推荐歌单 -->
    <section class="section">
      <div class="section-header">
        <h3 class="section-title">{{ isLogin() ? "专属歌单" : "推荐歌单" }}</h3>
        <span class="section-more" @click="router.push({ name: 'discover-playlists' })">
          更多 <SvgIcon name="Right" :size="16" />
        </span>
      </div>
      <div class="playlist-grid">
        <div
          v-for="item in playlistRec.slice(0, 6)"
          :key="item.id"
          class="playlist-item"
          @click="router.push({ path: `/playlist`, query: { id: item.id } })"
        >
          <div class="playlist-cover">
            <s-image :src="item.cover" cache-type="list-covers" class="cover-img" />
            <div class="play-count">
              <SvgIcon name="Play" :size="12" />
              {{ formatPlayCount(item.playCount) }}
            </div>
          </div>
          <div class="playlist-name">{{ item.name }}</div>
        </div>
      </div>
    </section>

    <!-- 新碟上架 -->
    <section class="section">
      <div class="section-header">
        <h3 class="section-title">新碟上架</h3>
        <span class="section-more" @click="router.push({ name: 'discover-new' })">
          更多 <SvgIcon name="Right" :size="16" />
        </span>
      </div>
      <div class="album-scroll">
        <div
          v-for="item in albumRec.slice(0, 10)"
          :key="item.id"
          class="album-item"
          @click="router.push({ path: `/album`, query: { id: item.id } })"
        >
          <div class="album-cover">
            <s-image :src="item.cover" cache-type="list-covers" class="cover-img" />
          </div>
          <div class="album-name">{{ item.name }}</div>
          <div class="album-artist">{{ item.artist }}</div>
        </div>
      </div>
    </section>

    <!-- 歌手推荐 -->
    <section class="section">
      <div class="section-header">
        <h3 class="section-title">歌手推荐</h3>
        <span class="section-more" @click="router.push({ name: 'discover-artists' })">
          更多 <SvgIcon name="Right" :size="16" />
        </span>
      </div>
      <div class="artist-scroll">
        <div
          v-for="item in artistRec.slice(0, 10)"
          :key="item.id"
          class="artist-item"
          @click="router.push({ path: `/artist`, query: { id: item.id } })"
        >
          <div class="artist-avatar">
            <s-image :src="item.cover" cache-type="list-covers" class="avatar-img" />
          </div>
          <div class="artist-name">{{ item.name }}</div>
        </div>
      </div>
    </section>

    <!-- 推荐 MV -->
    <section class="section">
      <div class="section-header">
        <h3 class="section-title">推荐 MV</h3>
        <span class="section-more" @click="router.push({ name: 'search-videos' })">
          更多 <SvgIcon name="Right" :size="16" />
        </span>
      </div>
      <div class="video-list">
        <div
          v-for="item in videoRec.slice(0, 4)"
          :key="item.id"
          class="video-item"
          @click="router.push({ path: `/video`, query: { id: item.id } })"
        >
          <div class="video-cover">
            <s-image :src="item.cover" cache-type="list-covers" class="cover-img" />
            <div class="video-duration">{{ item.duration }}</div>
            <div class="play-overlay">
              <SvgIcon name="Play" :size="32" />
            </div>
          </div>
          <div class="video-info">
            <div class="video-name">{{ item.name }}</div>
            <div class="video-artist">{{ item.artist }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-state">
      <n-spin size="large" description="正在加载..." />
    </div>

    <!-- 错误状态 -->
    <div v-if="error" class="error-state">
      <n-empty description="加载失败，请检查网络连接" size="large">
        <template #extra>
          <n-button @click="() => loadAllData(true)">重新加载</n-button>
        </template>
      </n-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDataStore, useSettingStore } from "@/stores";
import { personalized, newAlbumsAll, topArtists } from "@/api/rec";
import { allMv } from "@/api/video";
import { isLogin } from "@/utils/auth";
import { useCacheManager } from "@/core/resource/CacheManager";
import { prefetchListCovers } from "@/composables/useCoverCache";
import SvgIcon from "@/components/Global/SvgIcon.vue";
import SImage from "@/components/UI/s-image.vue";

const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();
const cacheManager = useCacheManager();

/** 首页推荐缓存键。复用 list-data 桶；过期 6 小时（推荐数据非强一致，背景刷新即可）。 */
const HOME_REC_CACHE_KEY = "home-rec.json";
const HOME_REC_TTL_MS = 6 * 60 * 60 * 1000;
interface HomeRecCache {
  version: number;
  timestamp: number;
  playlist: any[];
  album: any[];
  artist: any[];
  video: any[];
}
const HOME_REC_VERSION = 1;

// 加载状态
const loading = ref(false);
const error = ref(false);

// 推荐数据
const playlistRec = ref<any[]>([]);
const albumRec = ref<any[]>([]);
const artistRec = ref<any[]>([]);
const videoRec = ref<any[]>([]);

// 格式化播放次数
const formatPlayCount = (count: number) => {
  if (count > 100000000) {
    return (count / 100000000).toFixed(1) + "亿";
  } else if (count > 10000) {
    return (count / 10000).toFixed(1) + "万";
  }
  return count.toString();
};

/** 命中本地缓存：立刻渲染，不显 loading；失败 / 过期返 false 让网络请求接管。 */
const tryLoadFromCache = async (): Promise<boolean> => {
  try {
    const r = await cacheManager.get("list-data", HOME_REC_CACHE_KEY);
    if (!r.success || !r.data) return false;
    const json = new TextDecoder().decode(r.data);
    const c = JSON.parse(json) as HomeRecCache;
    if (c.version !== HOME_REC_VERSION) return false;
    if (Date.now() - c.timestamp > HOME_REC_TTL_MS) return false;
    playlistRec.value = c.playlist || [];
    albumRec.value = c.album || [];
    artistRec.value = c.artist || [];
    videoRec.value = c.video || [];
    // 进入页面立刻预热可视区域封面（4 个区块前 6 张足够）
    prefetchListCovers(playlistRec.value, "list-covers", 6);
    prefetchListCovers(albumRec.value, "list-covers", 6);
    prefetchListCovers(artistRec.value, "list-covers", 6);
    prefetchListCovers(videoRec.value, "list-covers", 6);
    return true;
  } catch {
    return false;
  }
};

const persistRecCache = async () => {
  const c: HomeRecCache = {
    version: HOME_REC_VERSION,
    timestamp: Date.now(),
    playlist: playlistRec.value,
    album: albumRec.value,
    artist: artistRec.value,
    video: videoRec.value,
  };
  try {
    await cacheManager.set("list-data", HOME_REC_CACHE_KEY, JSON.stringify(c));
  } catch (e) {
    console.warn("[HomeMobile] persist rec cache failed", e);
  }
};

// 加载所有数据
const loadAllData = async (forceRefresh: boolean = false) => {
  // 1. 先尝试缓存（命中则立即显示，避免冷启动等待 4 个 API）
  if (!forceRefresh) {
    const hit = await tryLoadFromCache();
    if (hit) {
      // 后台静默刷新，不显 loading
      void fetchFromNetwork(/* silent= */ true);
      return;
    }
  }
  await fetchFromNetwork(false);
};

const fetchFromNetwork = async (silent: boolean) => {
  if (!silent) {
    loading.value = true;
    error.value = false;
  }

  try {
    // 并行加载所有数据
    const [playlistRes, albumRes, artistRes, videoRes] = await Promise.all([
      // 推荐歌单
      personalized(isLogin() ? 21 : 20).catch(() => ({ result: [] })),
      // 新碟上架
      newAlbumsAll().catch(() => ({ albums: [] })),
      // 歌手推荐
      topArtists(6).catch(() => ({ artists: [] })),
      // 推荐 MV
      allMv().catch(() => ({ data: [] })),
    ]);

    // 处理歌单数据
    playlistRec.value = (playlistRes.result || [])
      .filter((pl: any) => !pl.name.includes("私人雷达"))
      .map((pl: any) => ({
        id: pl.id,
        name: pl.name,
        cover: pl.picUrl,
        playCount: pl.playcount || 0,
      }));

    // 处理新碟数据
    albumRec.value = (albumRes.albums || []).map((album: any) => ({
      id: album.id,
      name: album.name,
      cover: album.picUrl,
      artist: album.artist?.name || "未知艺术家",
    }));

    // 处理歌手数据
    artistRec.value = (artistRes.artists || []).map((artist: any) => ({
      id: artist.id,
      name: artist.name,
      cover: artist.picUrl,
    }));

    // 处理 MV 数据
    videoRec.value = (videoRes.data || []).map((mv: any) => ({
      id: mv.id,
      name: mv.name,
      cover: mv.cover,
      artist: mv.artistName,
      duration: mv.duration,
    }));

    // 入档本地缓存 + 预热封面
    void persistRecCache();
    prefetchListCovers(playlistRec.value, "list-covers", 6);
    prefetchListCovers(albumRec.value, "list-covers", 6);
    prefetchListCovers(artistRec.value, "list-covers", 6);
    prefetchListCovers(videoRec.value, "list-covers", 6);

    console.log("数据加载成功:", {
      playlist: playlistRec.value.length,
      album: albumRec.value.length,
      artist: artistRec.value.length,
      video: videoRec.value.length,
    });
  } catch (err) {
    console.error("加载数据失败:", err);
    if (!silent) error.value = true;
  } finally {
    if (!silent) loading.value = false;
  }
};

// 页面激活时加载数据
onActivated(() => {
  loadAllData();
});

// 页面挂载时加载数据
onMounted(() => {
  loadAllData();
});
</script>

<style lang="scss" scoped>
.home-mobile {
  width: 100%;
  min-height: 100%;
  padding: 16px;
  padding-bottom: 100px;

  // 快捷入口
  .quick-actions {
    display: flex;
    justify-content: space-between;
    margin-bottom: 24px;

    .action-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      cursor: pointer;

      .action-icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--primary-hex), var(--primary-hex));

        &.daily {
          background: linear-gradient(135deg, #ff6b6b, #ee5a24);
          position: relative;

          .date {
            font-size: 20px;
            font-weight: bold;
            color: white;
          }
        }

        &.like {
          background: linear-gradient(135deg, #ff4757, #ff6348);
        }

        &.playlist {
          background: linear-gradient(135deg, #2ed573, #7bed9f);
        }

        &.artist {
          background: linear-gradient(135deg, #1e90ff, #70a1ff);
        }

        :deep(.n-icon) {
          color: white;
        }
      }

      .action-label {
        font-size: 12px;
        color: var(--n-text-color);
      }
    }
  }

  // 区块样式
  .section {
    margin-bottom: 24px;

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;

      .section-title {
        font-size: 18px;
        font-weight: bold;
        margin: 0;
      }

      .section-more {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        color: var(--n-text-color-3);
        cursor: pointer;

        &:active {
          opacity: 0.7;
        }
      }
    }
  }

  // 歌单网格
  .playlist-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;

    .playlist-item {
      cursor: pointer;

      .playlist-cover {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 6px;

        .cover-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .play-count {
          position: absolute;
          top: 4px;
          right: 4px;
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 2px 6px;
          background: rgba(0, 0, 0, 0.5);
          border-radius: 10px;
          font-size: 10px;
          color: white;

          :deep(.n-icon) {
            color: white;
          }
        }
      }

      .playlist-name {
        font-size: 12px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    }
  }

  // 横向滚动容器
  .album-scroll,
  .artist-scroll {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 8px;
    scrollbar-width: none;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  // 新碟项
  .album-item {
    flex-shrink: 0;
    width: 110px;
    cursor: pointer;

    .album-cover {
      width: 110px;
      height: 110px;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 6px;

      .cover-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .album-name {
      font-size: 12px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 2px;
    }

    .album-artist {
      font-size: 11px;
      color: var(--n-text-color-3);
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  }

  // 歌手项
  .artist-item {
    flex-shrink: 0;
    width: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;

    .artist-avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      overflow: hidden;
      margin-bottom: 8px;

      .avatar-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .artist-name {
      font-size: 12px;
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  }

  // 视频列表
  .video-list {
    display: flex;
    flex-direction: column;
    gap: 12px;

    .video-item {
      display: flex;
      gap: 12px;
      cursor: pointer;

      .video-cover {
        position: relative;
        width: 140px;
        height: 80px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;

        .cover-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .video-duration {
          position: absolute;
          bottom: 4px;
          right: 4px;
          padding: 2px 6px;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 4px;
          font-size: 11px;
          color: white;
        }

        .play-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.3);
          opacity: 0;
          transition: opacity 0.3s;

          :deep(.n-icon) {
            color: white;
          }
        }

        &:active .play-overlay {
          opacity: 1;
        }
      }

      .video-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;

        .video-name {
          font-size: 14px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin-bottom: 4px;
        }

        .video-artist {
          font-size: 12px;
          color: var(--n-text-color-3);
        }
      }
    }
  }

  // 加载状态
  .loading-state {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 40px;
  }

  // 错误状态
  .error-state {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 40px;
  }
}
</style>
