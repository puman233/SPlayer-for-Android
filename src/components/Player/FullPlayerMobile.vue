<script lang="ts">
type MobilePageType = "comment" | "info" | "lyric";
let savedPageType: MobilePageType = "info";
</script>

<template>
  <div
    ref="mobileStart"
    class="full-player-mobile"
    :style="{ '--lyric-h-offset': lyricHeaderHorizontalPadding }"
  >
    <div ref="topBarRef" class="top-bar">
      <div class="btn" @click.stop="statusStore.showFullPlayer = false">
        <SvgIcon name="Down" :size="26" />
      </div>
    </div>

    <!-- 下拉手势捕获区：信息页覆盖顶栏 + 封面区域；歌词页仅顶栏，避免拦截歌词滚动 -->
    <div
      ref="dragHandleRef"
      class="drag-handle"
      :style="{ height: dragHandleHeight }"
      aria-hidden="true"
    />

    <div
      :class="['mobile-content', { swiping: isHorizontalSwipe }]"
      :style="{ transform: contentTransform, '--page-count': totalPages }"
      @click.stop
    >
      <div v-if="hasComment" class="page comment-page">
        <PlayerComment :active="pageIndex === commentIdx" embedded class="mobile-comment" />
      </div>

      <div class="page info-page">
        <div class="cover-section">
          <PlayerCover :no-lyric="true" />
        </div>

        <div class="info-group">
          <div class="song-info-bar">
            <div class="info-section">
              <PlayerData :center="false" :light="false" class="mobile-data" />
            </div>
            <div class="info-actions">
              <div
                v-if="musicStore.playSong.type !== 'radio'"
                class="action-btn"
                @click="
                  toLikeSong(musicStore.playSong, !dataStore.isLikeSong(musicStore.playSong.id))
                "
              >
                <SvgIcon
                  :name="
                    dataStore.isLikeSong(musicStore.playSong.id) ? 'Favorite' : 'FavoriteBorder'
                  "
                  :size="26"
                  :class="{ liked: dataStore.isLikeSong(musicStore.playSong.id) }"
                />
              </div>
              <div
                class="action-btn"
                @click.stop="openPlaylistAdd([musicStore.playSong], !!musicStore.playSong.path)"
              >
                <SvgIcon name="AddList" :size="26" />
              </div>
            </div>
          </div>

          <div class="progress-section">
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[0] }}</span>
            <PlayerSlider class="player" :show-tooltip="false" />
            <span class="time" @click="toggleTimeFormat">{{ timeDisplay[1] }}</span>
          </div>

          <div class="control-section">
            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleShuffle()">
                <SvgIcon
                  :name="statusStore.shuffleIcon"
                  :size="24"
                  :depth="statusStore.shuffleMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>

            <div class="ctrl-btn" @click.stop="player.nextOrPrev('prev')">
              <SvgIcon name="SkipPrev" :size="36" />
            </div>

            <n-button
              :loading="statusStore.playLoading"
              class="play-btn"
              type="primary"
              strong
              secondary
              circle
              @click.stop="player.playOrPause()"
            >
              <template #icon>
                <Transition name="fade" mode="out-in">
                  <SvgIcon
                    :key="statusStore.playStatus ? 'Pause' : 'Play'"
                    :name="statusStore.playStatus ? 'Pause' : 'Play'"
                    :size="40"
                  />
                </Transition>
              </template>
            </n-button>

            <div class="ctrl-btn" @click.stop="player.nextOrPrev('next')">
              <SvgIcon name="SkipNext" :size="36" />
            </div>

            <template v-if="musicStore.playSong.type !== 'radio' && !statusStore.personalFmMode">
              <div class="mode-btn" @click.stop="player.toggleRepeat()">
                <SvgIcon
                  :name="statusStore.repeatIcon"
                  :size="24"
                  :depth="statusStore.repeatMode === 'off' ? 3 : 1"
                />
              </div>
            </template>
            <div v-else class="placeholder"></div>
          </div>
        </div>
      </div>

      <div v-if="hasLyric" class="page lyric-page">
        <div class="lyric-header">
          <s-image :src="musicStore.getSongCover('s')" cache-type="covers" class="lyric-cover" />
          <div class="lyric-info">
            <div class="name text-hidden">
              {{
                settingStore.hideBracketedContent
                  ? removeBrackets(musicStore.playSong.name)
                  : musicStore.playSong.name
              }}
            </div>
            <div class="artist text-hidden">{{ artistName }}</div>
          </div>
          <div
            v-if="musicStore.playSong.type !== 'radio'"
            class="action-btn"
            @click.stop="
              toLikeSong(musicStore.playSong, !dataStore.isLikeSong(musicStore.playSong.id))
            "
          >
            <SvgIcon
              :name="dataStore.isLikeSong(musicStore.playSong.id) ? 'Favorite' : 'FavoriteBorder'"
              :size="24"
              :class="{ liked: dataStore.isLikeSong(musicStore.playSong.id) }"
            />
          </div>
        </div>
        <div class="lyric-main">
          <PlayerLyric />
        </div>
      </div>
    </div>

    <div v-if="totalPages > 1" class="pagination">
      <div
        v-for="i in totalPages"
        :key="i"
        :class="['dot', { active: pageIndex === i - 1 }]"
        @click="pageIndex = i - 1"
      />
    </div>

    <!-- 移动端竖屏频谱：贴底浮层，与封面/歌词页共享展示 -->
    <PlayerSpectrum
      v-if="settingStore.showSpectrums"
      class="mobile-spectrum"
      :color="statusStore.mainColor ? `rgb(${statusStore.mainColor})` : 'rgb(239 239 239)'"
      :show="true"
      :height="56"
    />
  </div>
</template>

<script setup lang="ts">
import { useSwipe } from "@vueuse/core";
import { useMusicStore, useStatusStore, useDataStore, useSettingStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { toLikeSong } from "@/utils/auth";
import { openPlaylistAdd } from "@/utils/modal";
import { removeBrackets } from "@/utils/format";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const dataStore = useDataStore();
const player = usePlayerController();
const { timeDisplay, toggleTimeFormat } = useTimeFormat();

const LYRIC_HEADER_MAX_PADDING = 60;

const mobileStart = ref<HTMLElement | null>(null);
const topBarRef = ref<HTMLElement | null>(null);
const dragHandleRef = ref<HTMLElement | null>(null);

// 歌词/评论可用性
const hasLyric = computed(() => musicStore.isHasLrc && musicStore.playSong.type !== "radio");
const hasComment = computed(() => {
  if (musicStore.playSong.path) return false;
  if (statusStore.pureLyricMode) return false;
  if (settingStore.fullscreenPlayerElements?.comments === false) return false;
  const id = musicStore.playSong.id;
  return typeof id === "number" && id > 0;
});

// 总页数（信息页恒存在，评论/歌词按需）
const totalPages = computed(() => 1 + (hasComment.value ? 1 : 0) + (hasLyric.value ? 1 : 0));
// 页面顺序: [评论 | 信息 | 歌词]
// 评论页索引（恒为 0，若不存在则 -1）
const commentIdx = computed(() => (hasComment.value ? 0 : -1));
// 信息页索引（评论存在则后移一位）
const infoIdx = computed(() => (hasComment.value ? 1 : 0));
// 歌词页索引（在信息页之后）
const lyricIdx = computed(() => (hasLyric.value ? infoIdx.value + 1 : -1));

// 上次访问的页面类型 → 当前布局下的实际索引；不存在则回退到信息页
const resolveSavedPageIndex = (type: MobilePageType): number => {
  if (type === "comment" && hasComment.value) return commentIdx.value;
  if (type === "lyric" && hasLyric.value) return lyricIdx.value;
  return infoIdx.value;
};

// 默认落在「信息」页，并尽量恢复上次浏览的页面类型
const pageIndex = ref(resolveSavedPageIndex(savedPageType));

const lyricHeaderHorizontalPadding = computed(() => {
  const padding = Math.max(0, settingStore.lyricHorizontalOffset);
  return `${Math.min(padding, LYRIC_HEADER_MAX_PADDING)}px`;
});

// 当前页面类型
const currentPageType = computed<MobilePageType>(() => {
  if (pageIndex.value === commentIdx.value) return "comment";
  if (pageIndex.value === lyricIdx.value) return "lyric";
  return "info";
});

// 下拉关闭手势捕获区高度：信息页覆盖顶栏 + 封面区域；歌词页含顶栏 + 歌曲信息条；
// 评论页仅顶栏（让出滚动空间给评论列表）
const dragHandleHeight = computed(() => {
  if (currentPageType.value === "info") return "calc(40px + var(--mobile-safe-top) + 32vh)";
  if (currentPageType.value === "lyric") return "calc(140px + var(--mobile-safe-top))";
  return "calc(56px + var(--mobile-safe-top))";
});

// 顶部区域下拉关闭：整个全屏播放器（含背景蒙层）跟手下移，露出底部主页面
let dragValue = 0;
const CLOSE_THRESHOLD = 120;
const REVEAL_DISTANCE = 480;
const SPRING_TRANSITION =
  "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1)";

// 缓存目标元素，避免 touchmove 每帧 DOM 查询
let parentEl: HTMLElement | null = null;
let mainEl: HTMLElement | null = null;
let rafId = 0;
let pendingDy = 0;

const writeStyles = (dy: number) => {
  if (parentEl) {
    if (dy <= 0) {
      parentEl.style.transform = "";
    } else {
      const scale = Math.max(0.92, 1 - dy / 2400);
      parentEl.style.transform = `translate3d(0, ${dy}px, 0) scale(${scale})`;
    }
  }
  if (mainEl) {
    if (dy <= 0) {
      mainEl.style.opacity = "";
      mainEl.style.transform = "";
    } else {
      const progress = Math.min(dy / REVEAL_DISTANCE, 1);
      mainEl.style.opacity = String(progress);
      mainEl.style.transform = `scale(${0.9 + progress * 0.1})`;
    }
  }
};

// 通过 rAF 节流，避免 touchmove 高频写样式导致掉帧
const scheduleFlush = (dy: number) => {
  pendingDy = dy;
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    writeStyles(pendingDy);
  });
};

const beginDrag = () => {
  parentEl = (mobileStart.value?.parentElement as HTMLElement | null) ?? null;
  mainEl = document.getElementById("main");
  // 拖动期间禁用过渡 + 提示合成层，避免每帧重排
  if (parentEl) {
    parentEl.style.transition = "none";
    parentEl.style.willChange = "transform";
    parentEl.style.transformOrigin = "50% 0";
    parentEl.style.borderRadius = "28px";
    parentEl.style.backfaceVisibility = "hidden";
    parentEl.style.backdropFilter = "blur(48px)";
    parentEl.style.contain = "paint";
  }
  if (mainEl) {
    mainEl.style.transition = "none";
    mainEl.style.willChange = "transform, opacity";
  }
};

const clearWillChange = () => {
  if (parentEl) parentEl.style.willChange = "";
  if (mainEl) mainEl.style.willChange = "";
};

const resetInlineStyles = () => {
  if (parentEl) {
    parentEl.style.transition = "";
    parentEl.style.transform = "";
    parentEl.style.borderRadius = "";
    parentEl.style.transformOrigin = "";
    parentEl.style.willChange = "";
    parentEl.style.backfaceVisibility = "";
    parentEl.style.backdropFilter = "";
    parentEl.style.contain = "";
  }
  if (mainEl) {
    mainEl.style.transition = "";
    mainEl.style.opacity = "";
    mainEl.style.transform = "";
    mainEl.style.willChange = "";
  }
};

// 方向锁，避免左右翻页手势触发下拉
let directionLock: "h" | "v" | null = null;
let dragStarted = false;
const DIRECTION_LOCK_TOLERANCE = 8;

const { lengthX: topLengthX, lengthY: topLengthY } = useSwipe(dragHandleRef, {
  threshold: 0,
  onSwipeStart: () => {
    directionLock = null;
    dragStarted = false;
  },
  onSwipe: () => {
    // 横向手势锁定后直接放行给翻页 useSwipe 处理
    if (directionLock === "h") return;
    if (!directionLock) {
      const ax = Math.abs(topLengthX.value);
      const ay = Math.abs(topLengthY.value);
      if (Math.max(ax, ay) < DIRECTION_LOCK_TOLERANCE) return;
      directionLock = ay > ax ? "v" : "h";
      if (directionLock === "h") return;
    }
    if (!dragStarted) {
      beginDrag();
      dragStarted = true;
    }
    // useSwipe 的 lengthY = startY - currentY，下滑时为负值
    const dy = -topLengthY.value;
    // 仅允许向下拖动；上滑做强阻尼
    dragValue = dy >= 0 ? dy : dy * 0.2;
    scheduleFlush(Math.max(dragValue, 0));
  },
  onSwipeEnd: () => {
    const wasDragging = dragStarted;
    directionLock = null;
    dragStarted = false;
    if (!wasDragging) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (dragValue > CLOSE_THRESHOLD) {
      // 触发关闭：清掉 inline transition 让父级 @leave 钩子从当前位移继续滑出
      if (parentEl) {
        parentEl.style.transition = "";
      }
      // 同步把主页面平滑回到完全可见，避免卡片滑出过程中仍然可见拖动半透明状态
      if (mainEl) {
        mainEl.style.transition =
          "opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
        mainEl.style.opacity = "1";
        mainEl.style.transform = "scale(1)";
      }
      statusStore.showFullPlayer = false;
      window.setTimeout(() => {
        clearWillChange();
        resetInlineStyles();
      }, 400);
    } else {
      // 取消关闭：弹簧回弹（border-radius 不参与过渡，立即清掉避免末尾突变）
      if (parentEl) {
        parentEl.style.transition = SPRING_TRANSITION;
        parentEl.style.borderRadius = "";
      }
      if (mainEl) mainEl.style.transition = SPRING_TRANSITION;
      writeStyles(0);
      window.setTimeout(() => {
        clearWillChange();
        resetInlineStyles();
      }, 360);
    }
    dragValue = 0;
  },
});

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
  resetInlineStyles();
});

const artistName = computed(() => {
  const artists = musicStore.playSong.artists;
  if (Array.isArray(artists)) {
    return artists.map((artist) => artist.name).join(" / ");
  }
  return (artists as string) || "未知艺术家";
});

// 页面可用性变化时按页面语义迁移 pageIndex
watch([hasComment, hasLyric], (_n, [prevHasComment, prevHasLyric]) => {
  const prevCommentIdx = prevHasComment ? 0 : -1;
  const prevInfoIdx = prevHasComment ? 1 : 0;
  const prevLyricIdx = prevHasLyric ? prevInfoIdx + 1 : -1;

  let prevType: MobilePageType = "info";
  if (pageIndex.value === prevCommentIdx) prevType = "comment";
  else if (pageIndex.value === prevLyricIdx) prevType = "lyric";

  pageIndex.value = resolveSavedPageIndex(prevType);
});

// 同步缓存页面语义
watch(currentPageType, (t) => {
  savedPageType = t;
});

const { direction, isSwiping, lengthX, lengthY } = useSwipe(mobileStart, {
  threshold: 5,
  onSwipeEnd: () => {
    if (totalPages.value <= 1) return;
    // 仅在主方向为水平时触发翻页，避免上下滑动歌词/评论误触
    if (Math.abs(lengthX.value) <= Math.abs(lengthY.value)) return;

    if (direction.value === "left" && lengthX.value > 100) {
      pageIndex.value = Math.min(pageIndex.value + 1, totalPages.value - 1);
    } else if (direction.value === "right" && lengthX.value < -100) {
      pageIndex.value = Math.max(pageIndex.value - 1, 0);
    }
  },
});

// 当前滑动是否为水平方向（用于跟手位移）
const isHorizontalSwipe = computed(
  () => isSwiping.value && Math.abs(lengthX.value) > Math.abs(lengthY.value),
);

const contentTransform = computed(() => {
  const pageWidthPct = 100 / totalPages.value;
  const baseOffset = pageIndex.value * pageWidthPct;
  if (!isHorizontalSwipe.value || totalPages.value <= 1) {
    return `translateX(-${baseOffset}%)`;
  }

  let pixelOffset = lengthX.value;
  if (pageIndex.value === 0 && pixelOffset < 0) {
    pixelOffset *= 0.3;
  }
  if (pageIndex.value === totalPages.value - 1 && pixelOffset > 0) {
    pixelOffset *= 0.3;
  }

  return `translateX(calc(-${baseOffset}% - ${pixelOffset}px))`;
});
</script>

<style lang="scss" scoped>
.full-player-mobile {
  --mobile-safe-top: max(env(safe-area-inset-top), 0px);
  --mobile-safe-bottom: max(env(safe-area-inset-bottom), 0px);
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  // 频谱贴底浮层：absolute 锚定容器底部，避开 PlayerSpectrum 默认 fixed + z-index:-1
  :deep(.mobile-spectrum) {
    position: absolute;
    z-index: 1;
    opacity: 0.45 !important;
  }

  .drag-handle {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    pointer-events: auto;
    background: transparent;
    touch-action: none;
  }

  .top-bar {
    position: absolute;
    inset: 0 0 auto;
    height: calc(56px + var(--mobile-safe-top));
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: var(--mobile-safe-top) 20px 0;
    z-index: 10;

    .btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;

      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }

      .n-icon {
        color: rgb(var(--main-cover-color));
        opacity: 0.8;
      }
    }
  }

  .mobile-content {
    flex: 1;
    display: flex;
    width: calc(var(--page-count, 1) * 100%);
    height: 100%;
    transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    // 横滑交给 useSwipe
    touch-action: pan-y;

    &.swiping {
      transition: none;
    }

    .page {
      width: calc(100% / var(--page-count, 1));
      flex: 0 0 calc(100% / var(--page-count, 1));
      height: 100%;
      position: relative;
    }
  }

  .info-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 20px calc(24px + var(--mobile-safe-bottom));
    overflow-y: auto;

    .cover-section {
      width: 100%;
      min-height: clamp(220px, 42vh, 420px);
      margin-top: calc(52px + var(--mobile-safe-top));
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: center;

      :deep(.player-cover) {
        width: min(100%, clamp(240px, 72vw, 380px));

        &.record {
          width: clamp(220px, 64vw, 360px);

          .cover-img {
            width: clamp(220px, 64vw, 360px);
            height: clamp(220px, 64vw, 360px);
            min-width: clamp(220px, 64vw, 360px);
          }

          .pointer {
            width: clamp(56px, 16vw, 88px);
            top: clamp(-72px, -12vw, -52px);
          }
        }
      }
    }

    .info-group {
      width: 100%;
      display: flex;
      flex-direction: column;
    }

    .song-info-bar {
      width: 100%;
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;

      .info-section {
        flex: 1;
        min-width: 0;
        margin-right: 12px;

        :deep(.mobile-data) {
          width: 100%;
          max-width: 100%;

          .name {
            margin-left: 0;
          }
        }
      }

      .info-actions {
        display: flex;
        gap: 16px;
        padding-top: 20px;
        flex-shrink: 0;
      }
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s;

      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }

      .n-icon {
        color: rgb(var(--main-cover-color));
        opacity: 0.6;
        transition:
          opacity 0.2s,
          transform 0.2s;

        &.liked {
          fill: rgb(var(--main-cover-color));
          opacity: 1;
        }
      }
    }

    .progress-section {
      display: flex;
      align-items: center;
      margin: 0 0 24px;

      .time {
        width: 40px;
        font-size: 12px;
        text-align: center;
        color: rgb(var(--main-cover-color));
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
      }

      .n-slider {
        margin: 0 12px;
      }
    }

    .control-section {
      width: 100%;
      max-width: 420px;
      margin: 0 auto 24px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .placeholder {
        width: 24px;
      }

      .mode-btn {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0.8;

        .n-icon {
          color: rgb(var(--main-cover-color));
        }
      }

      .ctrl-btn {
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;

        .n-icon {
          color: rgb(var(--main-cover-color));
        }
      }

      .play-btn {
        width: 60px;
        height: 60px;
        font-size: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s;
        background-color: rgba(var(--main-cover-color), 0.2);
        color: rgb(var(--main-cover-color));

        &.n-button--primary-type {
          --n-color: rgba(var(--main-cover-color), 0.14);
          --n-color-hover: rgba(var(--main-cover-color), 0.2);
          --n-color-focus: rgba(var(--main-cover-color), 0.2);
          --n-color-pressed: rgba(var(--main-cover-color), 0.12);
        }

        &:active {
          transform: scale(0.95);
        }
      }
    }
  }

  .lyric-page {
    padding: calc(56px + var(--mobile-safe-top)) 20px calc(24px + var(--mobile-safe-bottom));
    display: flex;
    flex-direction: column;

    .lyric-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      flex-shrink: 0;
      padding-top: 8px;
      padding-left: var(--lyric-h-offset, 0px);
      padding-right: var(--lyric-h-offset, 0px);
      // 喜欢按钮位于下拉手势区上方，需要抬高层级保持可点击
      .action-btn {
        position: relative;
        z-index: 11;
      }

      .lyric-cover {
        width: 50px;
        height: 50px;
        flex-shrink: 0;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

        :deep(img) {
          width: 100%;
          height: 100%;
          border-radius: 6px;
        }
      }

      .lyric-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;

        .name {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 2px;
        }

        .artist {
          font-size: 13px;
          opacity: 0.6;
        }
      }
    }

    .lyric-main {
      flex: 1;
      min-height: 0;
      position: relative;
    }
  }

  .comment-page {
    padding: calc(56px + var(--mobile-safe-top)) 0 calc(24px + var(--mobile-safe-bottom));
    display: flex;
    flex-direction: column;
    overflow: hidden;

    // 小屏视觉调优
    :deep(.mobile-comment) {
      .song-data {
        height: 80px;
        margin: 0 16px 12px;
        padding: 0 14px;

        .cover-img {
          width: 56px;
          height: 56px;
          border-radius: 10px;
        }

        .title {
          font-size: 17px;
        }

        .artist {
          font-size: 12px;
        }

        .actions {
          gap: 8px;

          .close {
            width: 36px;
            height: 36px;
          }
        }
      }

      .comment-scroll .n-scrollbar-content {
        padding: 0 16px;
      }

      .placeholder {
        height: 56px;
        padding-bottom: 10px;

        &:last-child {
          height: 0;
          padding-top: 24px;
        }

        .title {
          font-size: 18px;

          .n-icon {
            margin-right: 4px;
          }
        }
      }
    }
  }

  .pagination {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(16px + var(--mobile-safe-bottom));
    display: flex;
    justify-content: center;
    gap: 8px;
    pointer-events: none;

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.2);
      transition: all 0.3s;
      pointer-events: auto;

      &.active {
        width: 16px;
        border-radius: 4px;
        background-color: rgb(var(--main-cover-color));
        opacity: 0.8;
      }
    }
  }

  @media (max-width: 512px) {
    .top-bar {
      padding: var(--mobile-safe-top) 16px 0;
    }

    .info-page {
      padding: 0 16px calc(20px + var(--mobile-safe-bottom));

      .cover-section {
        min-height: clamp(200px, 38vh, 320px);
        margin-top: calc(48px + var(--mobile-safe-top));
      }

      .song-info-bar {
        margin-bottom: 16px;
      }

      .control-section {
        .ctrl-btn {
          width: 44px;
          height: 44px;
        }
      }
    }

    .lyric-page {
      padding: calc(52px + var(--mobile-safe-top)) 16px calc(20px + var(--mobile-safe-bottom));

      .lyric-header {
        gap: 12px;
      }
    }

    .comment-page {
      padding: calc(52px + var(--mobile-safe-top)) 0 calc(20px + var(--mobile-safe-bottom));

      :deep(.mobile-comment) {
        .song-data {
          margin: 0 12px 10px;
          padding: 0 12px;
        }

        .comment-scroll {
          .n-scrollbar-content {
            padding: 0 12px;
          }
        }
      }
    }
  }
}
</style>
