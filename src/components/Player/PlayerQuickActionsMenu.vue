<template>
  <n-popover
    v-model:show="popoverShow"
    placement="bottom-end"
    trigger="click"
    :show-arrow="false"
    :z-index="11000"
    :style="{ padding: '6px', borderRadius: '10px' }"
    class="quick-actions-popover"
    @update:show="handlePopoverShow"
  >
    <template #trigger>
      <!-- 同时挂 menu-icon 让 PlayerControl 的 :deep(.menu-icon) 风格命中 -->
      <div :class="triggerClass" aria-label="更多快捷操作">
        <SvgIcon name="More" :size="triggerIconSize" />
      </div>
    </template>

    <div class="quick-actions-panel" @click.stop>
      <!-- 快捷开关分组 -->
      <div class="qa-group">
        <div class="qa-group-title">快捷开关</div>

        <!-- 音频频谱 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="Eq" :size="18" />
            <span class="qa-item-text">音频频谱</span>
          </div>
          <n-switch
            :value="settingStore.showSpectrums"
            :disabled="settingStore.playbackEngine === 'mpv'"
            :round="false"
            size="small"
            @update:value="(v: boolean) => (settingStore.showSpectrums = v)"
          />
        </div>

        <!-- 动态封面 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="Album" :size="18" />
            <span class="qa-item-text">动态封面</span>
          </div>
          <n-switch v-model:value="settingStore.dynamicCover" :round="false" size="small" />
        </div>

        <!-- 桌面歌词 -->
        <div v-if="canUseDesktopLyric" class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="DesktopLyric" :size="18" />
            <span class="qa-item-text">桌面歌词</span>
          </div>
          <n-switch
            :value="statusStore.showDesktopLyric"
            :round="false"
            size="small"
            @update:value="(v: boolean) => player.setDesktopLyricShow(v)"
          />
        </div>

        <!-- 逐词效果 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="TextPlay" :size="18" />
            <span class="qa-item-text">逐词效果</span>
          </div>
          <n-switch v-model:value="settingStore.showWordLyrics" :round="false" size="small" />
        </div>

        <!-- 在线 TTML 歌词 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="Cloud" :size="18" />
            <span class="qa-item-text">在线 TTML 歌词</span>
          </div>
          <n-switch
            v-model:value="settingStore.enableOnlineTTMLLyric"
            :round="false"
            size="small"
          />
        </div>

        <!-- 音量 -->
        <div class="qa-item qa-volume">
          <div class="qa-item-label">
            <SvgIcon :name="statusStore.playVolumeIcon" :size="18" />
            <span class="qa-item-text">音量</span>
            <span class="qa-volume-value">{{ statusStore.playVolumePercent }}%</span>
          </div>
          <n-slider
            :value="statusStore.playVolume"
            :min="0"
            :max="1"
            :step="0.01"
            :tooltip="false"
            class="qa-volume-slider"
            @update:value="(v: number) => player.setVolume(v)"
          />
        </div>

        <!-- 歌词字号：横屏沉浸式与竖屏完全隔离，分别绑定不同字段 -->
        <div class="qa-item qa-volume">
          <div class="qa-item-label">
            <SvgIcon name="TextSizeAdd" :size="18" />
            <span class="qa-item-text">{{ lyricFontSizeLabel }}</span>
            <span class="qa-volume-value">{{ lyricFontSizeValue }}</span>
          </div>
          <div class="qa-stepper">
            <n-button
              block
              secondary
              size="tiny"
              :disabled="lyricFontSizeValue <= lyricFontSizeMin"
              @click="adjustLyricFontSize(-lyricFontSizeStep)"
            >
              -
            </n-button>
            <n-button
              block
              secondary
              size="tiny"
              :disabled="lyricFontSizeValue >= lyricFontSizeMax"
              @click="adjustLyricFontSize(lyricFontSizeStep)"
            >
              +
            </n-button>
          </div>
        </div>

        <!-- 横屏专属：封面整体 X 偏移 -->
        <div v-if="isLandscapeImmersive" class="qa-item qa-volume">
          <div class="qa-item-label">
            <SvgIcon name="Album" :size="18" />
            <span class="qa-item-text">横屏封面位置</span>
            <span class="qa-volume-value">{{ settingStore.landscapeCoverOffsetX }}</span>
          </div>
          <div class="qa-stepper">
            <n-button
              block
              secondary
              size="tiny"
              :disabled="settingStore.landscapeCoverOffsetX <= LANDSCAPE_COVER_OFFSET_MIN"
              @click="adjustLandscapeCoverOffset(-LANDSCAPE_COVER_OFFSET_STEP)"
            >
              -
            </n-button>
            <n-button
              block
              secondary
              size="tiny"
              :disabled="settingStore.landscapeCoverOffsetX >= LANDSCAPE_COVER_OFFSET_MAX"
              @click="adjustLandscapeCoverOffset(LANDSCAPE_COVER_OFFSET_STEP)"
            >
              +
            </n-button>
          </div>
        </div>

        <!-- 横屏专属：歌词区左右内边距 -->
        <div v-if="isLandscapeImmersive" class="qa-item qa-volume">
          <div class="qa-item-label">
            <SvgIcon name="TextPlay" :size="18" />
            <span class="qa-item-text">横屏歌词边距</span>
            <span class="qa-volume-value">{{ settingStore.landscapeLyricPaddingX }}</span>
          </div>
          <div class="qa-stepper">
            <n-button
              block
              secondary
              size="tiny"
              :disabled="settingStore.landscapeLyricPaddingX <= LANDSCAPE_LYRIC_PADDING_MIN"
              @click="adjustLandscapeLyricPadding(-LANDSCAPE_LYRIC_PADDING_STEP)"
            >
              -
            </n-button>
            <n-button
              block
              secondary
              size="tiny"
              :disabled="settingStore.landscapeLyricPaddingX >= LANDSCAPE_LYRIC_PADDING_MAX"
              @click="adjustLandscapeLyricPadding(LANDSCAPE_LYRIC_PADDING_STEP)"
            >
              +
            </n-button>
          </div>
        </div>
      </div>

      <!-- AMLL 效果分组 -->
      <div class="qa-group">
        <div class="qa-group-title">AMLL 效果</div>

        <!-- AMLL 逐词渲染：开启时提示发热与耗电 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="Lyrics" :size="18" />
            <span class="qa-item-text">AMLL 逐词渲染</span>
          </div>
          <n-switch
            :value="settingStore.useAMLyrics"
            :round="false"
            size="small"
            @update:value="onToggleAMLyrics"
          />
        </div>

        <!-- 弹簧效果 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="AutoFix" :size="18" />
            <span class="qa-item-text">弹簧效果</span>
          </div>
          <n-switch
            v-model:value="settingStore.useAMSpring"
            :disabled="!settingStore.useAMLyrics"
            :round="false"
            size="small"
          />
        </div>

        <!-- AMLL 动态背景：独立于逐词渲染，关闭时回退到上次非 animation 背景 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="Palette" :size="18" />
            <span class="qa-item-text">AMLL 动态背景</span>
          </div>
          <n-switch v-model:value="amllAnimationBg" :round="false" size="small" />
        </div>

        <!-- 隐藏已播放歌词 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="EyeLock" :size="18" />
            <span class="qa-item-text">隐藏已播放</span>
          </div>
          <n-switch
            v-model:value="settingStore.hidePassedLines"
            :disabled="!settingStore.useAMLyrics"
            :round="false"
            size="small"
          />
        </div>

        <!-- 歌词模糊 -->
        <div class="qa-item">
          <div class="qa-item-label">
            <SvgIcon name="AutoTheme" :size="18" />
            <span class="qa-item-text">歌词模糊</span>
          </div>
          <n-switch v-model:value="settingStore.lyricsBlur" :round="false" size="small" />
        </div>
      </div>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount } from "vue";
import { useSettingStore, useStatusStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";
import { isElectron, isCapacitorAndroid } from "@/utils/env";
import { PLAYER_META_HOLD_KEY } from "@/composables/usePlayerMetaHold";
import { useBackClosable } from "@/composables/useAndroidBack";

const popoverShow = ref(false);
useBackClosable(popoverShow);

// 触发器外观：mobile 用 40px 圆形，control 与 PlayerControl 其他 menu-icon 一致
const props = withDefaults(defineProps<{ variant?: "mobile" | "control" }>(), {
  variant: "mobile",
});
const triggerIconSize = computed(() => (props.variant === "control" ? 24 : 26));
// 同时挂 menu-icon class 让父级 :deep(.menu-icon) 选择器也能命中
const triggerClass = computed(() => ["qa-trigger", `qa-trigger--${props.variant}`, "menu-icon"]);

const settingStore = useSettingStore();
const statusStore = useStatusStore();
const player = usePlayerController();

// 桌面歌词仅在桌面端 / 安卓端可用
const canUseDesktopLyric = computed(() => isElectron || isCapacitorAndroid);

// 横屏字号独立绑定，与竖屏不共享字段
const isLandscapeImmersive = computed(() => statusStore.isImmersiveFullscreen);
const lyricFontSizeLabel = computed(() =>
  isLandscapeImmersive.value ? "横屏模式字号" : "歌词字号",
);
const lyricFontSizeValue = computed<number>({
  get: () =>
    isLandscapeImmersive.value
      ? settingStore.lyricFontSizeLandscape
      : settingStore.lyricFontSize,
  set: (v) => {
    if (isLandscapeImmersive.value) {
      settingStore.lyricFontSizeLandscape = v;
    } else {
      settingStore.lyricFontSize = v;
    }
  },
});
// 横屏：12-35；竖屏：24-100
const lyricFontSizeMin = computed(() => (isLandscapeImmersive.value ? 12 : 24));
const lyricFontSizeMax = computed(() => (isLandscapeImmersive.value ? 35 : 100));
const lyricFontSizeStep = computed(() => (isLandscapeImmersive.value ? 1 : 2));
const LANDSCAPE_COVER_OFFSET_MIN = -80;
const LANDSCAPE_COVER_OFFSET_MAX = 80;
const LANDSCAPE_COVER_OFFSET_STEP = 2;
const LANDSCAPE_LYRIC_PADDING_MIN = 0;
const LANDSCAPE_LYRIC_PADDING_MAX = 120;
const LANDSCAPE_LYRIC_PADDING_STEP = 2;

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const adjustLyricFontSize = (delta: number) => {
  lyricFontSizeValue.value = clampValue(
    lyricFontSizeValue.value + delta,
    lyricFontSizeMin.value,
    lyricFontSizeMax.value,
  );
};

const adjustLandscapeCoverOffset = (delta: number) => {
  settingStore.landscapeCoverOffsetX = clampValue(
    settingStore.landscapeCoverOffsetX + delta,
    LANDSCAPE_COVER_OFFSET_MIN,
    LANDSCAPE_COVER_OFFSET_MAX,
  );
};

const adjustLandscapeLyricPadding = (delta: number) => {
  settingStore.landscapeLyricPaddingX = clampValue(
    settingStore.landscapeLyricPaddingX + delta,
    LANDSCAPE_LYRIC_PADDING_MIN,
    LANDSCAPE_LYRIC_PADDING_MAX,
  );
};

// 开启 AMLL 逐词渲染时提示发热与耗电；关闭则静默
const onToggleAMLyrics = (v: boolean) => {
  settingStore.useAMLyrics = v;
  if (v) {
    window.$message?.warning("使用此模式将增加发热与耗电", { duration: 3000 });
  }
};

// AMLL 动态背景开关：playerBackgroundType === 'animation' ↔ 上次非 animation 值
// 上次值持久化在 settingStore.lastNonAnimationPlayerBg，跨组件 mount / 跨页面切换都保留
const amllAnimationBg = computed<boolean>({
  get: () => settingStore.playerBackgroundType === "animation",
  set: (v) => {
    if (v) {
      // 切换到 animation 之前先把当前非 animation 值持久化，避免丢失用户偏好
      if (
        settingStore.playerBackgroundType !== "animation" &&
        (settingStore.playerBackgroundType === "none" ||
          settingStore.playerBackgroundType === "blur" ||
          settingStore.playerBackgroundType === "color")
      ) {
        settingStore.lastNonAnimationPlayerBg = settingStore.playerBackgroundType;
      }
      // 首次激活动态背景时默认开启背景跳动；后续激活尊重用户偏好
      if (!settingStore.amllAnimationBgEverActivated) {
        settingStore.playerBackgroundLowFreqVolume = true;
        settingStore.amllAnimationBgEverActivated = true;
      }
      settingStore.playerBackgroundType = "animation";
    } else {
      settingStore.playerBackgroundType = settingStore.lastNonAnimationPlayerBg;
    }
  },
});

// 注入 FullPlayer 提供的 hold 接口；FullPlayerMobile 路径下父级未 provide 时 inject 为 null 即可
const playerMetaHold = inject(PLAYER_META_HOLD_KEY, null);
let popoverHoldAcquired = false;
const handlePopoverShow = (show: boolean) => {
  if (!playerMetaHold) return;
  if (show && !popoverHoldAcquired) {
    playerMetaHold.acquire();
    popoverHoldAcquired = true;
  } else if (!show && popoverHoldAcquired) {
    playerMetaHold.release();
    popoverHoldAcquired = false;
  }
};

// 组件卸载时若仍持有 hold，保底释放，避免计数泄漏
onBeforeUnmount(() => {
  if (popoverHoldAcquired && playerMetaHold) {
    playerMetaHold.release();
    popoverHoldAcquired = false;
  }
});
</script>

<style lang="scss" scoped>
.qa-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

// 移动端：与 FullPlayerMobile 的 .info-actions 风格一致
.qa-trigger--mobile {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.15);
  }
}

// 控制中心：与 PlayerControl 其他 menu-icon 风格保持一致
.qa-trigger--control {
  padding: 8px;
  border-radius: 8px;
  transition:
    background-color 0.3s,
    transform 0.3s;

  :deep(.n-icon) {
    color: rgb(var(--main-cover-color));
  }

  &:hover {
    transform: scale(1.1);
    background-color: rgba(var(--main-cover-color), 0.14);
  }

  &:active {
    transform: scale(1);
  }
}

// 紧凑菜单：背景 / 文字 / 边框 / 阴影由 Naive UI popover 主题接管，
// 这里只负责内部布局，避免在浅色模式下因自定义颜色对比度不足看不清
.quick-actions-panel {
  width: 220px;
  // 跟随页面缩放；dvh 不解析时 fallback 到 vh
  max-height: min(calc(var(--page-zoom-100vh, 100vh) * 0.48), 360px);
  max-height: min(calc(var(--page-zoom-100dvh, 100dvh) * 0.48), 360px);
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: 13px;
  line-height: 1.4;

  // 细滚动条，减少视觉干扰（移动端默认隐藏，触控滚动即可）
  scrollbar-width: thin;
  scrollbar-color: var(--n-scrollbar-color, rgba(0, 0, 0, 0.2)) transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    border-radius: 2px;
    background-color: var(--n-scrollbar-color, rgba(0, 0, 0, 0.2));
  }
  &::-webkit-scrollbar-track {
    background-color: transparent;
  }
}

.qa-group {
  display: flex;
  flex-direction: column;

  & + .qa-group {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--n-divider-color);
  }
}

.qa-group-title {
  padding: 4px 8px 2px;
  font-size: 11px;
  font-weight: 600;
  // text-color-3 在明暗模式下都是次要文字色（对比度合适）
  color: var(--n-text-color-3);
  letter-spacing: 0.4px;
}

.qa-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding: 0 8px;
  border-radius: 6px;
  transition: background-color 0.15s;
  color: var(--n-text-color);

  &:hover {
    background-color: var(--n-action-color);
  }
}

.qa-item-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.qa-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 音量行：标签在上、滑块在下，整体保持紧凑
.qa-volume {
  flex-direction: column;
  align-items: stretch;
  height: auto;
  padding: 6px 8px 8px;
  gap: 4px;

  .qa-item-label {
    width: 100%;
  }

  .qa-volume-value {
    font-size: 11px;
    color: var(--n-text-color-3);
    flex-shrink: 0;
    min-width: 32px;
    text-align: right;
  }

  .qa-volume-slider {
    width: 100%;
  }
}

.qa-stepper {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
}
</style>
