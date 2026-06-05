<template>
  <Teleport to="#app">
    <Transition
      :name="isCompactMobilePlayer ? 'mobile-card' : settingStore.playerExpandAnimation"
      :css="!isCompactMobilePlayer"
      mode="out-in"
      @enter="onMobileEnter"
      @leave="onMobileLeave"
    >
      <div
        v-if="statusStore.showFullPlayer"
        :style="{
          cursor: statusStore.playerMetaShow || showComment ? 'auto' : 'none',
          '--lyric-blend-mode': settingStore.lyricsBlendMode,
        }"
        :class="[
          'full-player',
          { 'fullscreen-comment': isFullscreenComment, landscape: isMobileLandscape },
        ]"
        :data-orientation-phase="orientationPhase"
        @mouseleave="playerLeave"
        @mousemove="playerMove"
        @click="playerMove"
      >
        <!-- 背景 -->
        <PlayerBackground />
        <!-- UI 隐藏时的拦截层：首次触摸恢复 UI，并短暂保留以吞掉后续合成 click，避免误触底栏按钮。 -->
        <div
          v-if="tapRestoreEnabled && (!statusStore.playerMetaShow || tapRestoreShield)"
          class="tap-restore-overlay"
          @pointerdown="onTapRestoreStart"
          @click="onTapRestoreClick"
        />
        <!-- 移动端 -->
        <FullPlayerMobile v-if="isCompactMobilePlayer" />
        <!-- 桌面端 -->
        <template v-else>
          <!-- 独立歌词 -->
          <Transition name="fade" mode="out-in">
            <div v-if="showInstantLyrics" :key="instantLyrics.content" class="lrc-instant">
              <span class="lrc">{{ instantLyrics.content }}</span>
              <span v-if="instantLyrics.tran" class="lrc-tran">{{ instantLyrics.tran }}</span>
            </div>
          </Transition>
          <!-- 菜单 -->
          <PlayerMenu @mouseenter.stop="stopHide" @mouseleave.stop="resumeHide" />
          <!-- 全屏封面 -->
          <PlayerCover v-if="showFullScreenCover" />
          <!-- 主内容 -->
          <!-- 切歌不再 unmount/remount 整个 player-content（之前 :key 含 playSong.id 会导致每次切歌都缩放重建，视觉抖动）；
               仅当布局形态切换（pureLyricMode 等）时才走 zoom 过渡 -->
          <Transition name="zoom" mode="out-in">
            <!-- 手机横屏：紧凑专用布局 -->
            <FullPlayerMobileLandscape
              v-if="isMobileLandscape"
              :key="`landscape-${playerContentKey}`"
            />
            <!-- 桌面 / 平板 -->
            <div
              v-else
              :key="`desktop-${playerContentKey}`"
              :class="['player-content', playerContentClasses]"
              @mousemove="playerMove"
            >
              <!-- 左侧封面和数据：内部组件自己负责歌曲信息切换的过渡，外层不再用 :key=playSong.id 的 zoom 动画 -->
              <div v-if="showLeftContent" class="content-left" :style="layoutStyles.left">
                <PlayerCover />
                <PlayerData :center="playerDataCenter" />
              </div>
              <!-- 半屏评论（左或右） -->
              <PlayerComment
                v-if="isHalfComment"
                :hide-song-data="commentOnRight"
                class="comment-half"
                :class="{ visible: showComment }"
                :style="commentHalfStyle"
              />
              <!-- 右侧歌词 -->
              <div
                class="content-right"
                :class="{ hidden: hideRightLyric }"
                :style="layoutStyles.right"
              >
                <PlayerData
                  v-if="showRightPlayerData"
                  :center="pureLyricMode || noLrc"
                  :light="!(isFullscreenType && noLrc)"
                />
                <PlayerLyric v-if="!noLrc" />
              </div>
            </div>
          </Transition>
          <!-- 全屏评论 -->
          <PlayerComment
            v-if="!isHalfComment"
            class="comment-full"
            :class="{ visible: showComment }"
          />
          <!-- 控制中心 -->
          <PlayerControl @mouseenter.stop="stopHide" @mouseleave.stop="resumeHide" />
          <!-- 桌面端频谱（移动端在 FullPlayerMobile 内渲染，避免 z-index 冲突） -->
          <PlayerSpectrum
            v-if="settingStore.showSpectrums"
            :color="statusStore.mainColor ? `rgb(${statusStore.mainColor})` : 'rgb(239 239 239)'"
            :show="!statusStore.playerMetaShow"
            :height="60"
          />
        </template>
      </div>
    </Transition>
    <OrientationOverlay />
  </Teleport>
</template>

<script setup lang="ts">
import { useDevice } from "@/composables/useDevice";
import { useStatusStore, useMusicStore, useSettingStore } from "@/stores";
import { isElectron } from "@/utils/env";
import { PLAYER_META_HOLD_KEY, type PlayerMetaHold } from "@/composables/usePlayerMetaHold";
import { useOrientationTransition } from "@/composables/useOrientationTransition";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();

// 横竖屏切换状态机：phase 写到 root data-attribute，供 [data-stagger] CSS 触发
const { phase: orientationPhase } = useOrientationTransition();

const { isPhone, isPhonePortrait, isPad } = useDevice();
// tap-restore 仅沉浸式 / 平板生效；其他场景保留 autohide
const tapRestoreEnabled = computed(
  () => statusStore.isImmersiveFullscreen || isPad.value,
);
const tapRestoreShield = ref(false);
let tapRestoreShieldTimer: number | undefined;
const isCompactMobilePlayer = computed(() => isPhonePortrait.value);
// 手机横屏走紧凑布局（左小封面 + 右歌词），不走桌面/平板分支
const isMobileLandscape = computed(() => isPhone.value && !isPhonePortrait.value);

// 移动端卡片化进出场动画：兼容拖拽中的 inline transform，从当前位置平滑过渡
const MOBILE_CARD_ENTER = "transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)";
const MOBILE_CARD_LEAVE = "transform 0.32s cubic-bezier(0.4, 0, 1, 1)";

const onMobileEnter = (el: Element, done: () => void) => {
  if (!isCompactMobilePlayer.value) {
    done();
    return;
  }
  // 底栏拖拽开启模式：同步写好起始态再交给 MainPlayer 的拖拽逻辑接管，
  // 避免出现一帧 “无 transform 全屏可见” 的裸态
  if ((window as unknown as { __splayerDragOpen?: boolean }).__splayerDragOpen) {
    const parent = el as HTMLElement;
    parent.style.transformOrigin = "50% 0";
    parent.style.willChange = "transform";
    parent.style.transition = "none";
    parent.style.transform = "translate3d(0, var(--page-zoom-100vh, 100vh), 0) scale(0.92)";
    parent.style.borderRadius = "28px";
    parent.style.backfaceVisibility = "hidden";
    done();
    return;
  }
  const parent = el as HTMLElement;
  parent.style.transformOrigin = "50% 0";
  parent.style.willChange = "transform";
  parent.style.transition = "none";
  parent.style.transform = "translate3d(0, var(--page-zoom-100vh, 100vh), 0) scale(0.92)";
  parent.style.borderRadius = "28px";
  parent.style.backfaceVisibility = "hidden";
  // 强制重排，确保起始状态生效
  parent.getBoundingClientRect();
  requestAnimationFrame(() => {
    parent.style.transition = MOBILE_CARD_ENTER;
    parent.style.transform = "";
  });
  window.setTimeout(() => {
    parent.style.transition = "";
    parent.style.borderRadius = "";
    parent.style.willChange = "";
    parent.style.transformOrigin = "";
    parent.style.backfaceVisibility = "";
    done();
  }, 380);
};

const onMobileLeave = (el: Element, done: () => void) => {
  if (!isCompactMobilePlayer.value) {
    done();
    return;
  }
  const parent = el as HTMLElement;
  parent.style.transformOrigin = "50% 0";
  parent.style.willChange = "transform";
  parent.style.transition = MOBILE_CARD_LEAVE;
  parent.style.borderRadius = "28px";
  parent.style.backfaceVisibility = "hidden";
  requestAnimationFrame(() => {
    parent.style.transform = "translate3d(0, var(--page-zoom-100vh, 100vh), 0) scale(0.92)";
  });
  window.setTimeout(() => {
    done();
  }, 340);
};

/** 封面主颜色 */
const mainCoverColor = useCssVar("--main-cover-color", document.documentElement);

/** 播放器样式是否为全屏封面 */
const isFullscreenType = computed(() => settingStore.playerType === "fullscreen");

/** 没有歌词 */
const noLrc = computed<boolean>(() => {
  const noNormalLrc = !musicStore.isHasLrc;
  const noYrcAvailable = !musicStore.isHasYrc || !settingStore.showWordLyrics;
  return noNormalLrc && noYrcAvailable;
});

/** 是否处于纯净歌词模式（按模式分路） */
const pureLyricMode = computed<boolean>(
  () => statusStore.effectivePureLyricMode && musicStore.isHasLrc,
);

/** 评论是否可见（综合判断） */
const showComment = computed<boolean>(
  () =>
    statusStore.showPlayerComment &&
    !musicStore.playSong.path &&
    !statusStore.effectivePureLyricMode &&
    !isPhonePortrait.value,
);

/** 评论显示模式 */
const commentDisplayMode = computed(() => settingStore.commentDisplayMode);

/** 沉浸式 / 平板强制左侧半屏评论，忽略 commentDisplayMode */
const forceLeftHalfComment = computed(
  () => statusStore.isImmersiveFullscreen || isPad.value,
);

/** 评论是否在右侧 */
const commentOnRight = computed(
  () => !forceLeftHalfComment.value && commentDisplayMode.value === "right",
);

/** 是否半屏评论（无歌词时回退全屏） */
const isHalfComment = computed(
  () =>
    (forceLeftHalfComment.value || commentDisplayMode.value !== "fullscreen") &&
    !noLrc.value,
);

/** 是否全屏评论 */
const isFullscreenComment = computed(() => showComment.value && !isHalfComment.value);

/** 主内容 key（仅在布局形态变化时切换，不在切歌时切换，避免抖动） */
const playerContentKey = computed(
  () => `${statusStore.effectivePureLyricMode ? "pure" : "normal"}`,
);

/** 主内容 class */
const playerContentClasses = computed(() => ({
  "no-lrc": noLrc.value,
  "full-screen": isFullscreenType.value,
  pure: pureLyricMode.value && musicStore.isHasLrc,
}));

/** 左右布局样式 */
const layoutStyles = computed(() => {
  const ratio = isFullscreenType.value ? 50 : settingStore.playerStyleRatio;
  return {
    left: { width: `${ratio}%`, minWidth: `${ratio}%` },
    right: { width: `${100 - ratio}%`, maxWidth: `${100 - ratio}%` },
  };
});

/** 半屏评论定位样式 */
const commentHalfStyle = computed(() => ({
  ...(commentOnRight.value ? layoutStyles.value.right : layoutStyles.value.left),
  [commentOnRight.value ? "right" : "left"]: "0",
}));

/** 是否显示左侧封面区域 */
const showLeftContent = computed(
  () =>
    !pureLyricMode.value &&
    !isFullscreenType.value &&
    // 左半屏评论显示中时，隐藏左侧封面
    !(showComment.value && isHalfComment.value && !commentOnRight.value),
);

/** 是否隐藏右侧歌词（右半屏评论显示时） */
const hideRightLyric = computed(
  () => showComment.value && isHalfComment.value && commentOnRight.value,
);

/** 是否显示右侧 PlayerData */
const showRightPlayerData = computed(
  () => (pureLyricMode.value && musicStore.isHasLrc) || isFullscreenType.value,
);

/** 是否显示全屏封面 */
const showFullScreenCover = computed(
  () => isFullscreenType.value && !pureLyricMode.value && !showComment.value,
);

/** 是否显示顶部实时歌词 */
const showInstantLyrics = computed(
  () => showComment.value && (isFullscreenComment.value || commentOnRight.value),
);

/** 数据是否居中 */
const playerDataCenter = computed<boolean>(
  () =>
    !musicStore.isHasLrc ||
    statusStore.effectivePureLyricMode ||
    settingStore.playerType === "record" ||
    musicStore.playSong.type === "radio",
);

/** 当前实时歌词 */
const instantLyrics = computed(() => {
  const isYrc = musicStore.songLyric.yrcData?.length && settingStore.showWordLyrics;
  const content = isYrc
    ? musicStore.songLyric.yrcData[statusStore.lyricIndex]
    : musicStore.songLyric.lrcData[statusStore.lyricIndex];
  const contentStr = content?.words?.map((v) => v.word).join("") || "";
  return { content: contentStr, tran: settingStore.showTran && content?.translatedLyric };
});

/** 由 popover 等弹层 acquire / release 的引用计数，hold > 0 期间禁止自动隐藏 */
const playerMetaHoldCount = ref(0);

const {
  isPending,
  start: startShow,
  stop: stopShow,
} = useTimeoutFn(() => {
  if (!settingStore.autoHidePlayerMeta) return;
  // 有弹层 hold 时不隐藏，避免 popover trigger DOM 消失导致定位错乱
  if (playerMetaHoldCount.value > 0) return;
  statusStore.playerMetaShow = false;
}, 3000);

/** 鼠标是否在操作区域（菜单/控制栏） */
const inControlArea = ref(false);

const playerMove = useThrottleFn(
  () => {
    statusStore.playerMetaShow = true;
    if (settingStore.autoHidePlayerMeta && !isPending.value && !inControlArea.value) {
      startShow();
    }
  },
  300,
  false,
);

const stopHide = () => {
  inControlArea.value = true;
  stopShow();
  statusStore.playerMetaShow = true;
};

const resumeHide = () => {
  inControlArea.value = false;
  if (settingStore.autoHidePlayerMeta && playerMetaHoldCount.value === 0) {
    startShow();
  }
};

const playerLeave = () => {
  if (settingStore.autoHidePlayerMeta && playerMetaHoldCount.value === 0) {
    statusStore.playerMetaShow = false;
    stopShow();
  }
};

const restorePlayerMeta = () => {
  statusStore.playerMetaShow = true;
  if (settingStore.autoHidePlayerMeta && playerMetaHoldCount.value === 0) {
    startShow();
  }
};

const clearTapRestoreShieldTimer = () => {
  if (tapRestoreShieldTimer === undefined) return;
  window.clearTimeout(tapRestoreShieldTimer);
  tapRestoreShieldTimer = undefined;
};

const releaseTapRestoreShield = () => {
  clearTapRestoreShieldTimer();
  tapRestoreShield.value = false;
};

const holdTapRestoreShield = (duration = 420) => {
  clearTapRestoreShieldTimer();
  tapRestoreShield.value = true;
  tapRestoreShieldTimer = window.setTimeout(() => {
    tapRestoreShield.value = false;
    tapRestoreShieldTimer = undefined;
  }, duration);
};

const stopCancelableEvent = (event: Event) => {
  event.stopPropagation();
  if (event.cancelable) event.preventDefault();
};

// 拦截层 touch：恢复 UI 后短暂保留 overlay 吞掉合成 click
// 不变量：playerMetaHoldCount > 0 或 inControlArea 时不会隐藏 meta，overlay 不出现
const onTapRestoreStart = (event: PointerEvent) => {
  stopCancelableEvent(event);
  holdTapRestoreShield();
  restorePlayerMeta();
};

// pointerdown 已尽量取消，多数 WebView 不会再派发 click；此处仅兜底恢复 UI，
// 不再立即 release shield，让 holdTapRestoreShield 的计时器自然走完
const onTapRestoreClick = (event: MouseEvent) => {
  stopCancelableEvent(event);
  restorePlayerMeta();
};

// 弹层 hold：popover 打开期间 acquire，关闭后 release
const playerMetaHold: PlayerMetaHold = {
  acquire: () => {
    playerMetaHoldCount.value++;
    // autoHide 关闭时无自动隐藏可阻止，hold 仅记账，不主动写 playerMetaShow
    if (!settingStore.autoHidePlayerMeta) return;
    stopShow();
    statusStore.playerMetaShow = true;
  },
  release: () => {
    playerMetaHoldCount.value = Math.max(0, playerMetaHoldCount.value - 1);
    if (
      playerMetaHoldCount.value === 0 &&
      settingStore.autoHidePlayerMeta &&
      !inControlArea.value
    ) {
      startShow();
    }
  },
};
provide(PLAYER_META_HOLD_KEY, playerMetaHold);

watch(
  () => statusStore.mainColor,
  (newVal) => {
    mainCoverColor.value = newVal;
  },
);

onMounted(() => {
  mainCoverColor.value = statusStore.mainColor;
  if (isElectron && settingStore.preventSleep) {
    window.electron?.ipcRenderer.send("prevent-sleep", true);
  }
});

onBeforeUnmount(() => {
  stopShow();
  clearTapRestoreShieldTimer();
  if (isElectron) window.electron?.ipcRenderer.send("prevent-sleep", false);
});
</script>

<style lang="scss" scoped>
.full-player {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgb(var(--main-cover-color));
  background-color: #00000060;
  backdrop-filter: blur(80px);
  overflow: hidden;
  z-index: 1000;
  // 全屏透明拦截层：吞掉首次触摸 + 合成 click
  .tap-restore-overlay {
    position: absolute;
    inset: 0;
    z-index: 200;
    background: transparent;
    cursor: default;
  }
  .lrc-instant {
    position: absolute;
    top: 0;
    height: 80px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    .lrc {
      font-size: 18px;
    }
    .lrc-tran {
      font-size: 14px;
      opacity: 0.6;
    }
  }
  .player-content {
    position: absolute;
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: calc(var(--page-zoom-100dvh, 100dvh) - 160px);
    transition:
      opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
      transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    .content-left {
      position: absolute;
      left: 0;
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition:
        width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
        opacity 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
        transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .content-right {
      position: absolute;
      right: 0;
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      mix-blend-mode: var(--lyric-blend-mode);
      transition:
        width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s,
        opacity 0.3s ease;
      .player-data {
        margin-top: 0;
        margin-bottom: 26px;
      }
      &.hidden {
        opacity: 0;
        pointer-events: none;
      }
    }
    .comment-half {
      position: absolute;
      height: 100%;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      &.visible {
        opacity: 1;
        pointer-events: auto;
      }
    }
    &.pure {
      .content-right {
        align-items: center;
        width: 100% !important;
        max-width: 100% !important;
      }
    }
    &.no-lrc {
      &:not(.full-screen) {
        .content-left {
          width: 50% !important;
          transform: translateX(50%);
        }
        .content-right {
          opacity: 0;
          pointer-events: none;
        }
      }
      &.full-screen {
        .content-right {
          .player-data {
            width: 100%;
            max-width: 100%;
            // 30vh 表示相对屏幕高度的初始偏移，需走 --page-zoom-100vh 防止 transform 二次缩放
            transform: translateY(calc(var(--page-zoom-100vh, 100vh) * 0.3));
          }
        }
      }
    }
  }
  .comment-full {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    &.visible {
      opacity: 1;
      pointer-events: auto;
    }
  }
  &.fullscreen-comment {
    .player-content {
      &:not(.pure) {
        transform: scale(0.95);
        opacity: 0;
      }
    }
  }

  // === 手机横屏：紧凑顶/底栏 ===
  &.landscape {
    :deep(.player-menu) {
      min-height: 56px;
      .menu-icon {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        .n-icon {
          font-size: 22px !important;
        }
      }
      .left,
      .right {
        padding: 0 12px;
      }
      .drag-dom {
        margin: 0 40px;
      }
    }
    :deep(.player-control) {
      height: 60px;
      .control-content {
        .left,
        .right {
          padding: 0 12px;
        }
        .center {
          max-height: 60px;
          .btn {
            gap: 0;
            .btn-icon {
              width: 32px;
              height: 32px;
            }
            .play-pause {
              --n-width: 38px;
              --n-height: 38px;
            }
          }
        }
      }
    }
  }
}
</style>
