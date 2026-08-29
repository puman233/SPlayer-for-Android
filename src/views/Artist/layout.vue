<template>
  <div :key="artistId" :class="['artist', { small: listScrolling }]">
    <Transition name="fade" mode="out-in">
      <div v-if="artistDetailData" class="detail">
        <div v-if="!settingStore.hiddenCovers.artistDetail" class="cover">
          <n-image
            :src="artistDetailData.coverSize?.m || artistDetailData.cover"
            :previewed-img-props="{ style: { borderRadius: '8px' } }"
            :preview-src="artistDetailData.cover"
            :renderToolbar="renderToolbar"
            show-toolbar-tooltip
            class="cover-img"
            @load="coverLoaded"
          >
            <template #placeholder>
              <div class="cover-loading">
                <img src="/images/artist.jpg?asset" class="loading-img" alt="loading-img" />
              </div>
            </template>
          </n-image>
          <!-- 封面背板 -->
          <n-image
            class="cover-shadow"
            preview-disabled
            :src="artistDetailData.coverSize?.m || artistDetailData.cover"
          />
        </div>
        <div class="data">
          <div class="name text-hidden">
            <n-text class="name-text">{{
              settingStore.hideBracketedContent
                ? removeBrackets(artistDetailData.name)
                : artistDetailData.name || "未知艺术家"
            }}</n-text>
            <n-text v-if="artistDetailData?.alia" class="name-alias" depth="3">
              {{ artistDetailData.alia || "未知艺术家" }}
            </n-text>
          </div>
          <n-collapse-transition :show="!listScrolling" class="collapse">
            <!-- 职业 -->
            <n-text v-if="artistDetailData?.identify" :depth="3" class="identify text-hidden">
              {{ artistDetailData.identify }}
            </n-text>
            <!-- 信息 -->
            <n-flex class="meta">
              <div
                class="item"
                @click="router.push({ name: 'artist-songs', query: { id: artistId } })"
              >
                <SvgIcon name="Music" :depth="3" />
                <n-text>{{ artistDetailData.musicSize || 0 }}</n-text>
              </div>
              <div
                class="item"
                @click="router.push({ name: 'artist-albums', query: { id: artistId } })"
              >
                <SvgIcon name="Album" :depth="3" />
                <n-text>{{ artistDetailData.albumSize || 0 }}</n-text>
              </div>
              <div
                class="item"
                @click="router.push({ name: 'artist-videos', query: { id: artistId } })"
              >
                <SvgIcon name="Video" :depth="3" />
                <n-text>{{ artistDetailData.mvSize || 0 }}</n-text>
              </div>
            </n-flex>
            <!-- 简介 -->
            <n-text
              v-if="artistDetailData.description"
              class="description text-hidden"
              @click="openDescModal(artistDetailData.description, '歌手简介')"
            >
              {{ artistDetailData.description }}
            </n-text>
          </n-collapse-transition>
          <n-flex class="menu" justify="space-between">
            <n-flex class="left" align="flex-end">
              <n-button
                :focusable="false"
                type="primary"
                strong
                secondary
                round
                @click="playAllSongs"
              >
                <template #icon>
                  <SvgIcon name="Play" />
                </template>
                播放
              </n-button>
              <n-button
                :focusable="false"
                strong
                secondary
                round
                @click="toLikeArtist(artistId, !isLikeArtist)"
              >
                <template #icon>
                  <SvgIcon :name="isLikeArtist ? 'Favorite' : 'FavoriteBorder'" />
                </template>
                {{ isLikeArtist ? "取消关注" : "关注歌手" }}
              </n-button>
              <!-- 更多 -->
              <n-dropdown :options="moreOptions" trigger="click" placement="bottom-start">
                <n-button :focusable="false" class="more" circle strong secondary>
                  <template #icon>
                    <SvgIcon name="List" />
                  </template>
                </n-button>
              </n-dropdown>
            </n-flex>
          </n-flex>
        </div>
      </div>
      <div v-else class="detail">
        <n-skeleton v-if="!settingStore.hiddenCovers.artistDetail" class="cover" />
        <div class="data">
          <n-skeleton :repeat="4" text />
        </div>
      </div>
    </Transition>
    <!-- 标签页 -->
    <n-tabs v-model:value="artistType" class="tabs" type="segment" @update:value="tabChange">
      <n-tab name="artist-songs"> 单曲 </n-tab>
      <n-tab name="artist-albums"> 专辑 </n-tab>
      <n-tab name="artist-videos"> 视频 </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component
            ref="componentRef"
            :is="Component"
            :id="artistId"
            class="router-view"
            @scroll="listScroll"
          />
        </KeepAlive>
        <component
          v-else
          ref="componentRef"
          :is="Component"
          :id="artistId"
          class="router-view"
          @scroll="listScroll"
        />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from "naive-ui";
import type { ArtistType } from "@/types/main";
import { coverLoaded, renderIcon, copyData, getShareUrl } from "@/utils/helper";
import { renderToolbar } from "@/utils/meta";
import { openDescModal, openBatchList } from "@/utils/modal";
import { artistDetail } from "@/api/artist";
import { formatArtistsList, removeBrackets } from "@/utils/format";
import { useDataStore, useSettingStore } from "@/stores";
import { toLikeArtist } from "@/utils/auth";
import ArtistSongs from "./songs.vue";

const route = useRoute();
const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();

// 路由元素
const componentRef = ref<InstanceType<typeof ArtistSongs> | null>(null);

// 歌手 ID
const artistId = computed<number>(() => Number(route.query.id));

// 歌手分类
const artistType = ref<string>((route.name as string) || "artist-songs");

// 歌手数据
const artistDetailData = ref<ArtistType | null>(null);

// 列表是否滚动
const listScrolling = ref<boolean>(false);

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => [
  {
    label: "批量操作",
    key: "batch",
    show: artistType.value === "artist-songs",
    props: {
      onClick: () => {
        if (componentRef.value?.songData) {
          openBatchList(
            componentRef.value.songData,
            false,
            isLikeArtist.value ? artistId.value : undefined,
          );
        } else {
          window.$message.warning("暂无歌曲可操作");
        }
      },
    },
    icon: renderIcon("Batch"),
  },
  {
    label: "复制分享链接",
    key: "copy",
    props: {
      onClick: () => copyData(getShareUrl("artist", artistId.value), "已复制分享链接到剪贴板"),
    },
    icon: renderIcon("Share"),
  },
  {
    label: "打开源页面",
    key: "open",
    props: {
      onClick: () => {
        window.open(`https://music.163.com/#/artist?id=${artistId.value}`);
      },
    },
    icon: renderIcon("Link"),
  },
]);

// 是否处于收藏歌手
const isLikeArtist = computed(() => {
  return dataStore.userLikeData.artists.some((ar) => ar.id === artistId.value);
});

// 获取歌手详情
const getArtistDetail = async (id: number) => {
  try {
    if (!id) return;
    listScrolling.value = false;
    artistDetailData.value = null;
    const result = await artistDetail(id);
    artistDetailData.value = formatArtistsList(result.data.artist)[0];
    // 附加身份
    artistDetailData.value.identify = result.data.identify?.imageDesc;
  } catch (error) {
    console.error("Erorr getting artist detail:", error);
    window.$message.error("获取歌手详情失败");
  }
};

// Tabs 改变
const tabChange = (value: string) => {
  router.push({
    name: value,
    query: { id: artistId.value },
  });
};

// 播放全部歌曲
const playAllSongs = async () => {
  await router.push({ name: "artist-songs", query: { id: artistId.value } });
  if (componentRef.value) componentRef.value.playAllSongs();
};

// 列表滚动
const listScroll = (e: Event) => {
  // 滚动高度
  const scrollTop = (e.target as HTMLElement).scrollTop;
  listScrolling.value = scrollTop > 10;
};

// 监听路由更新
onBeforeRouteUpdate((to) => {
  listScrolling.value = false;
  // 检查是否仍在 artist 路由下
  const isArtistRoute = to.matched.some((m) => m.name === "artist");
  if (!isArtistRoute) return;
  artistType.value = to.name as string;
});

// 监听 ID 变化
watch(
  () => artistId.value,
  (val) => {
    if (val) getArtistDetail(val);
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
.artist {
  display: flex;
  flex-direction: column;
  height: 100%;
  .detail {
    display: flex;
    height: 240px;
    width: 100%;
    padding: 12px 0 30px 0;
    will-change: height, opacity;
    z-index: 1;
    transition:
      height 0.3s,
      opacity 0.3s;
    .cover {
      position: relative;
      display: flex;
      width: auto;
      height: 100%;
      aspect-ratio: 1 / 1;
      margin-right: 20px;
      border-radius: 50%;
      transition:
        opacity 0.3s,
        margin 0.3s,
        transform 0.3s;
      :deep(img) {
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 0.35s ease-in-out;
      }
      .cover-img {
        border-radius: 50%;
        overflow: hidden;
        z-index: 1;
        transition:
          opacity 0.3s,
          filter 0.3s,
          transform 0.3s;
      }
      .cover-shadow {
        position: absolute;
        top: 8px;
        height: 100%;
        width: 100%;
        border-radius: 50%;
        filter: blur(12px) opacity(0.6);
        transform: scale(0.92, 0.96);
        z-index: 0;
        background-size: cover;
        aspect-ratio: 1/1;
        :deep(img) {
          opacity: 1;
        }
      }
      &:active {
        transform: scale(0.98);
      }
    }
    .data {
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1;
      padding-right: 60px;
      :deep(.n-skeleton) {
        height: 30px;
        margin-top: 12px;
        border-radius: 8px;
        &:first-child {
          width: 60%;
          margin-top: 0;
          height: 40px;
        }
      }
      .description {
        margin-bottom: 8px;
        padding-left: 4px;
        cursor: pointer;
      }
      .name {
        font-size: 30px;
        font-weight: bold;
        height: 48px;
        transition:
          font-size 0.3s var(--n-bezier),
          color 0.3s var(--n-bezier);
        .name-alias {
          &::before {
            content: "（";
            margin-right: 6px;
          }
          &::after {
            content: "）";
            margin-left: 6px;
          }
        }
      }
      .identify {
        font-size: 16px;
        margin-bottom: 8px;
        padding-left: 4px;
      }
      .collapse {
        position: absolute;
        top: 48px;
        margin: 8px 0;
      }
      .meta {
        margin-bottom: 8px;
        .item {
          display: flex;
          align-items: center;
          cursor: pointer;
          .n-icon {
            font-size: 20px;
            margin-right: 4px;
          }
        }
      }
      .menu {
        position: absolute;
        left: 0;
        bottom: 0;
        width: 100%;
        .n-button {
          height: 40px;
          transition: all 0.3s var(--n-bezier);
        }
        .more {
          width: 40px;
        }
      }
    }
  }
  .tabs {
    height: 40px;
    z-index: 1;
  }
  .router-view {
    flex: 1;
    overflow: hidden;
    &.artist-songs {
      position: absolute;
      width: 100%;
      height: 100%;
      padding-top: 280px;
      transition:
        padding 0.3s,
        transform 0.3s,
        opacity 0.3s;
    }
  }
  &.small {
    .detail {
      height: 120px;
      .cover {
        margin-right: 12px;
        .cover-mask,
        .play-count {
          opacity: 0;
        }
      }
      .data {
        .name {
          font-size: 22px;
        }
        .menu {
          .n-button,
          .search {
            height: 32px;
            --n-font-size: 13px;
            --n-padding: 0 14px;
            --n-icon-size: 16px;
          }
        }
      }
    }
    .router-view {
      &.artist-songs {
        padding-top: 160px;
      }
    }
  }
  // 窄屏幕下缩小封面、减少右侧留白，避免歌手名被截断成两个字
  @media (max-width: 768px) {
    .detail {
      height: 196px;
      // 减小上下留白，为下方信息/菜单腾出内容区，避免 meta 与菜单重叠
      padding: 8px 0 8px 0;
      .cover {
        // 固定尺寸避免依赖父容器高度，左上对齐不参与拉伸
        width: 120px;
        height: 120px;
        margin-right: 14px;
        flex-shrink: 0;
        align-self: flex-start;
      }
      .data {
        // 移动端：歌手名强制单行，恢复绝对定位布局，避免 name 换行导致下方 meta/菜单错位
        align-self: stretch;
        overflow: hidden;
        padding-right: 12px;
        min-width: 0;
        .name {
          // 固定单行高度，保证下方绝对定位参考点稳定
          height: 30px;
          min-height: 30px;
          line-height: 30px;
          overflow: hidden;
          &.text-hidden {
            -webkit-line-clamp: 1;
            line-clamp: 1;
          }
          .name-text {
            word-break: break-word;
          }
        }
        .identify {
          font-size: 13px;
        }
        .collapse {
          position: absolute;
          top: 32px;
          left: 0;
          right: 0;
          overflow: hidden;
          margin: 0;
        }
        .meta {
          gap: 8px !important;
          .item {
            .n-icon {
              font-size: 16px;
            }
          }
        }
        .menu {
          position: absolute;
          left: 0;
          bottom: 0;
          width: 100%;
          .n-button {
            height: 32px;
            --n-font-size: 13px;
            --n-padding: 0 12px;
            --n-icon-size: 16px;
          }
          .more {
            width: 32px;
          }
        }
      }
    }
    .router-view.artist-songs {
      padding-top: 216px;
    }
    &.small {
      .router-view.artist-songs {
        padding-top: 150px;
      }
    }
  }
}
</style>
