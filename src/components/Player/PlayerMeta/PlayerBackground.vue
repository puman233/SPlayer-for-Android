<template>
  <div :class="['background', settingStore.playerBackgroundType]">
    <Transition name="fade" mode="out-in">
      <!-- 背景色 -->
      <div
        v-if="settingStore.playerBackgroundType === 'color'"
        :key="musicStore.songCover"
        class="color"
      />
      <!-- 背景模糊 -->
      <s-image
        v-else-if="settingStore.playerBackgroundType === 'blur'"
        :src="musicStore.songCover"
        :observe-visibility="false"
        class="bg-img"
        alt="cover"
      />
      <!-- 流体效果 -->
      <BackgroundRender
        v-else-if="settingStore.playerBackgroundType === 'animation'"
        :album="musicStore.songCover"
        :fps="settingStore.playerBackgroundFps ?? 60"
        :flowSpeed="flowSpeed"
        :hasLyric="musicStore.isHasLrc"
        :lowFreqVolume="lowFreqVolume"
        :renderScale="settingStore.playerBackgroundRenderScale ?? 0.5"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { usePlayerController } from "@/core/player/PlayerController";

const musicStore = useMusicStore();
const settingStore = useSettingStore();
const statusStore = useStatusStore();
const player = usePlayerController();

// 低频音量
const lowFreqVolume = ref(1.0);
let smoothedLowFreqVolume = 0;

const LOW_FREQ_GAIN = 1.85;
const LOW_FREQ_ATTACK = 0.38;
const LOW_FREQ_RELEASE = 0.045;
const LOW_FREQ_DEAD_ZONE = 0.015;

// 文档可见性：后台/锁屏时全链路降耗。前台启动默认 visible（SSR/无 document 兜底为 true）
const documentVisible = ref(typeof document === "undefined" || document.visibilityState === "visible");
const onVisibility = () => {
  documentVisible.value = document.visibilityState === "visible";
};

const flowSpeed = computed(() => {
  if (!documentVisible.value) return 0;
  if (!statusStore.playStatus && settingStore.playerBackgroundPause) return 0;
  else return settingStore.playerBackgroundFlowSpeed ?? 4;
});

// AMLL Core 背景动效驱动值：80-120Hz 低频限幅平滑到 [0,1]，未启用时回落 1.0
const { pause: pauseRaf, resume: resumeRaf } = useRafFn(
  () => {
    if (
      settingStore.playerBackgroundLowFreqVolume &&
      settingStore.playerBackgroundType === "animation" &&
      statusStore.playStatus
    ) {
      const rawValue = Math.max(0, Math.min(1, player.getLowFrequencyVolume()));
      const targetValue = rawValue <= LOW_FREQ_DEAD_ZONE ? 0 : rawValue * LOW_FREQ_GAIN;
      const smoothFactor = targetValue > smoothedLowFreqVolume ? LOW_FREQ_ATTACK : LOW_FREQ_RELEASE;
      smoothedLowFreqVolume += smoothFactor * (targetValue - smoothedLowFreqVolume);
      lowFreqVolume.value = smoothedLowFreqVolume;
    }
  },
  { immediate: false },
);

// 避免重复 acquire/release
let visualizerHeld = false;
const acquireFreq = () => {
  if (visualizerHeld) return;
  visualizerHeld = true;
  void player.acquireVisualizer();
};
const releaseFreq = () => {
  if (!visualizerHeld) return;
  visualizerHeld = false;
  player.releaseVisualizer();
};

// RAF 启停 + 频谱采集 acquire/release（仅 Android 原生有效）；后台立即全释放
watch(
  () => [
    settingStore.playerBackgroundLowFreqVolume,
    settingStore.playerBackgroundType,
    statusStore.playStatus,
    documentVisible.value,
  ],
  ([enabled, bgType, playing, visible]) => {
    const needFreq = enabled && bgType === "animation" && visible;
    if (needFreq) {
      acquireFreq();
      playing ? resumeRaf() : pauseRaf();
    } else {
      pauseRaf();
      smoothedLowFreqVolume = 0;
      lowFreqVolume.value = 1.0;
      releaseFreq();
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
});

onBeforeUnmount(() => {
  pauseRaf();
  releaseFreq();
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
  }
});
</script>

<style lang="scss" scoped>
.background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: -1;
  &::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(20px);
  }
  &.blur {
    display: flex;
    align-items: center;
    justify-content: center;
    .bg-img {
      width: 100%;
      height: auto;
      transform: scale(1.5);
      filter: blur(80px) contrast(1.2);
    }
  }
  &.color {
    background-color: rgb(var(--main-cover-color));
    .color {
      width: 100%;
      height: 100%;
      background-color: rgb(var(--main-cover-color));
    }
  }
  &.animation {
    &::after {
      display: none;
    }
  }
}
</style>
