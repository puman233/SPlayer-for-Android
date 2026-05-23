<template>
  <div class="local-playlists">
    <n-scrollbar>
      <!-- 歌单列表 -->
      <CoverList
        :data="playlistData"
        :loading="false"
        :show-size="false"
        :hiddenCover="settingStore.hiddenCovers.playlist"
        type="playlist"
        empty-description="暂无本地歌单"
      />
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import type { CoverType } from "@/types/main";
import { useLocalStore, useSettingStore } from "@/stores";
import CoverList from "@/components/List/CoverList.vue";

defineOptions({ inheritAttrs: false });

const localStore = useLocalStore();
const settingStore = useSettingStore();

// 歌单数据
const playlistData = computed<CoverType[]>(() => {
  return localStore.localPlaylists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    cover: playlist.cover || "/images/album.jpg?asset",
    description: playlist.description,
    count: playlist.songs.length,
    createTime: playlist.createTime,
    updateTime: playlist.updateTime,
  }));
});
</script>

<style lang="scss" scoped>
.local-playlists {
  flex: 1;
  max-height: calc((var(--layout-height) - 132) * 1px);
  overflow: hidden;
  .cover-list {
    padding: 4px;
  }
  .empty {
    margin-top: 100px;
  }
  @media (max-width: 767px) and (orientation: portrait) {
    max-height: none;
    min-height: 100%;
    overflow: visible;
    :deep(.n-scrollbar) {
      max-height: none;
    }
    .cover-list {
      padding: 0 2px 12px;
    }
    .empty {
      margin-top: 48px;
    }
  }
}
</style>
