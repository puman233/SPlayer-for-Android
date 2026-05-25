<template>
  <div
    class="full-player-mobile-landscape"
    :style="{
      '--amll-landscape-font-size': amllLandscapeFontSize,
      '--lrc-landscape-size': lrcLandscapeSize,
      '--lrc-landscape-tran-size': lrcLandscapeTranSize,
      '--lrc-landscape-roma-size': lrcLandscapeRomaSize,
      '--landscape-cover-offset-x': landscapeCoverOffsetX,
      '--landscape-lyric-padding-x': landscapeLyricPaddingX,
    }"
  >
    <!-- 左：封面 + 紧凑信息 -->
    <div class="left-section" :class="{ 'show-comment': showComment }">
      <PlayerComment
        v-if="showComment"
        class="landscape-comment"
        embedded
        :active="showComment"
      />
      <template v-else>
        <div ref="coverRef" class="cover" data-stagger="cover">
          <!-- 复用 PlayerCover：跟随 settingStore.playerType / dynamicCover 走动态封面逻辑 -->
          <PlayerCover />
        </div>
        <div class="info" data-stagger="title">
          <div class="name text-hidden">{{ songNameText }}</div>
          <div v-if="aliaText" class="alia text-hidden">{{ aliaText }}</div>
          <div class="ar-line text-hidden">
            <SvgIcon :depth="3" name="Artist" :size="14" />
            <span class="ar">{{ artistText }}</span>
          </div>
          <div v-if="albumText" class="album-line text-hidden">
            <SvgIcon :depth="3" name="Album" :size="14" />
            <span class="album">{{ albumText }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 右：歌词 -->
    <div class="right-section" data-stagger="lyric">
      <PlayerLyric v-if="!noLrc" />
      <div v-else class="no-lrc">
        <SvgIcon name="MusicNote" :size="36" :depth="3" />
        <span>暂无歌词</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { useOrientationTransition } from "@/composables/useOrientationTransition";
import PlayerComment from "@/components/Player/PlayerComponents/PlayerComment.vue";
import PlayerLyric from "@/components/Player/PlayerLyric/index.vue";
import PlayerCover from "@/components/Player/PlayerMeta/PlayerCover.vue";
import { removeBrackets } from "@/utils/format";

const musicStore = useMusicStore();
const settingStore = useSettingStore();
const statusStore = useStatusStore();

// Hero 流转的终点位置（横屏 cover 容器）
const orientationTransition = useOrientationTransition();
const coverRef = ref<HTMLElement | null>(null);
watch(coverRef, (el) => orientationTransition.setCoverEl(el, "landscape"));
onBeforeUnmount(() => orientationTransition.setCoverEl(null, "landscape"));

const noLrc = computed(() => {
  const noNormalLrc = !musicStore.isHasLrc;
  const noYrcAvailable = !musicStore.isHasYrc || !settingStore.showWordLyrics;
  return noNormalLrc && noYrcAvailable;
});

const showComment = computed(
  () =>
    statusStore.showPlayerComment &&
    !musicStore.playSong.path &&
    !statusStore.effectivePureLyricMode,
);

// 字号独立绑定 lyricFontSizeLandscape；翻译/罗马音按 0.5 / 0.43 缩放
const amllLandscapeFontSize = computed(() => `${settingStore.lyricFontSizeLandscape}px`);
const lrcLandscapeSize = computed(() => `${settingStore.lyricFontSizeLandscape}px`);
const lrcLandscapeTranSize = computed(
  () => `${Math.round(settingStore.lyricFontSizeLandscape * 0.5)}px`,
);
const lrcLandscapeRomaSize = computed(
  () => `${Math.round(settingStore.lyricFontSizeLandscape * 0.43)}px`,
);

// 封面 X 偏移 / 歌词左右内边距
const landscapeCoverOffsetX = computed(() => `${settingStore.landscapeCoverOffsetX}px`);
const landscapeLyricPaddingX = computed(() => `${settingStore.landscapeLyricPaddingX}px`);

const aliaText = computed(() => {
  if (settingStore.hideBracketedContent) return "";
  return musicStore.playSong.alia || "";
});

// 末尾统一兜底，避免 hideBracketedContent + 空 name 返回空串
const songNameText = computed(() => {
  const raw = musicStore.playSong.name;
  const text = settingStore.hideBracketedContent ? removeBrackets(raw) : raw;
  return text || "未知曲目";
});

const artistText = computed(() => {
  const song = musicStore.playSong;
  if (song.type === "radio") return song.dj?.creator || "未知艺术家";
  const ar = song.artists;
  if (Array.isArray(ar)) {
    // 空数组 / 全空 → 未知艺术家
    const joined = ar
      .map((a) => (settingStore.hideBracketedContent ? removeBrackets(a.name) : a.name))
      .filter(Boolean)
      .join(" / ");
    return joined || "未知艺术家";
  }
  if (typeof ar === "string") {
    return (settingStore.hideBracketedContent ? removeBrackets(ar) : ar) || "未知艺术家";
  }
  return "未知艺术家";
});

const albumText = computed(() => {
  const album = musicStore.playSong.album;
  if (!album) return "";
  if (typeof album === "string") {
    return settingStore.hideBracketedContent ? removeBrackets(album) : album;
  }
  if (typeof album === "object") {
    return settingStore.hideBracketedContent ? removeBrackets(album.name) : album.name || "";
  }
  return "";
});
</script>

<style lang="scss" scoped>
.full-player-mobile-landscape {
  position: relative;
  width: 100%;
  // 顶/底栏 56+60=116；dvh 在旧 WebView 不解析，前一条 vh fallback
  height: calc(var(--page-zoom-100vh, 100vh) - 116px);
  height: calc(var(--page-zoom-100dvh, 100dvh) - 116px);
  display: flex;
  flex-direction: row;
  align-items: center;
  color: rgb(var(--main-cover-color));

  .left-section {
    width: 38%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    gap: 12px;
    transform: translateX(var(--landscape-cover-offset-x, 16px));

    &.show-comment {
      align-items: stretch;
      justify-content: stretch;
      padding: 6px 10px;
      gap: 0;
      transform: none;
    }

    .landscape-comment {
      width: 100%;
      height: 100%;
      min-height: 0;
      border-radius: 14px;
      background-color: rgba(var(--main-cover-color), 0.06);
      :deep(.song-data) {
        height: 64px;
        margin: 0 0 8px;
        padding: 0 10px;
        border-radius: 10px;
      }
      :deep(.song-data .cover-img) {
        width: 44px;
        height: 44px;
        border-radius: 9px;
      }
      :deep(.song-data .title) {
        font-size: 14px;
      }
      :deep(.song-data .artist) {
        font-size: 12px;
      }
      :deep(.song-data .actions) {
        gap: 6px;
      }
      :deep(.song-data .actions .close) {
        width: 32px;
        height: 32px;
      }
      :deep(.comment-scroll .n-scrollbar-content) {
        padding: 0 8px;
      }
      :deep(.placeholder) {
        height: 54px;
        padding-bottom: 10px;
      }
      :deep(.placeholder .title) {
        font-size: 16px;
      }
    }

    .cover {
      // 上限 220px，小高度屏按 50vh 自适应
      width: clamp(160px, 50vh, 220px);
      height: clamp(160px, 50vh, 220px);
      flex-shrink: 0;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
      background-color: rgba(255, 255, 255, 0.06);
      // 重置 PlayerCover 默认尺寸约束
      :deep(.player-cover) {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      :deep(.cover-img),
      :deep(.dynamic-cover) {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
      }
    }

    .info {
      width: 100%;
      max-width: 260px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;

      .name {
        font-size: 18px;
        font-weight: 600;
        line-height: 1.25;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .alia {
        font-size: 13px;
        opacity: 0.55;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ar-line,
      .album-line {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 14px;
        opacity: 0.75;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        .ar,
        .album {
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
      .album-line {
        font-size: 13px;
        opacity: 0.6;
      }
    }
  }

  .right-section {
    flex: 1;
    height: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    mix-blend-mode: var(--lyric-blend-mode);
    overflow: hidden;

    .no-lrc {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 100%;
      opacity: 0.6;
      font-size: 13px;
    }

    // === 修复 DefaultLyric 横屏被 300px placeholder 顶下 ===
    :deep(.default-lyric),
    :deep(.lyric-scroll-container) {
      // 隐藏 .lyric-menu 后回收右侧 80px；padding 由用户调
      padding-right: var(--landscape-lyric-padding-x, 20px) !important;
      padding-left: var(--landscape-lyric-padding-x, 20px) !important;
    }
    :deep(.lyric-scroll-container) {
      .placeholder:first-child {
        // 原 300px 顶占位会把横屏歌词挤出
        height: 80px !important;
      }
    }
    // 隐藏歌词右侧浮动菜单（设置/偏移/复制），横屏空间紧凑
    :deep(.lyric-menu) {
      display: none !important;
    }

    // === AMLL：字号独立 ===
    // AMLyric 在 .amll-lyric-player 用 inline style 设 --amll-lp-font-size，
    // 必须 !important 直接覆盖
    :deep(.amll-lyric-player) {
      --amll-lp-font-size: var(--amll-landscape-font-size) !important;
    }
    :deep(.am-lyric) {
      // 收紧 AMLL 左右 padding（原硬编 80px），改为滑块控制
      padding-right: var(--landscape-lyric-padding-x, 20px) !important;
      padding-left: var(--landscape-lyric-padding-x, 20px) !important;
    }

    // === DefaultLyric：三组字号独立 ===
    // DefaultLyric inline style 设 --lrc-size 等，必须 !important 覆盖
    :deep(.lyric) {
      --lrc-size: var(--lrc-landscape-size) !important;
      --lrc-tran-size: var(--lrc-landscape-tran-size) !important;
      --lrc-roma-size: var(--lrc-landscape-roma-size) !important;
    }
  }
}
</style>
