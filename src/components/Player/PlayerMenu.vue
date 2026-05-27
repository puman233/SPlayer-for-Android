<template>
  <div class="player-menu">
    <Transition name="fade" mode="out-in">
      <div v-show="statusStore.playerMetaShow" class="menu-content">
        <n-flex class="left">
          <div
            v-if="musicStore.isHasLrc && musicStore.playSong.type !== 'radio'"
            :class="['menu-icon', { open: statusStore.effectivePureLyricMode }]"
            @click="togglePureLyricMode"
          >
            <SvgIcon name="TextPlay" />
          </div>
        </n-flex>
        <div class="drag-dom" />
        <n-flex class="right" justify="end">
          <div class="menu-icon" @click="onToggleFullscreen">
            <SvgIcon :name="effectiveFullscreen ? 'FullscreenExit' : 'Fullscreen'" />
          </div>
          <div v-if="showCloseBtn" class="menu-icon" @click="onCloseFullPlayer">
            <SvgIcon name="Down" />
          </div>
        </n-flex>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useStatusStore, useMusicStore } from "@/stores";
import { useOrientationTransition } from "@/composables/useOrientationTransition";
import { isCapacitorAndroid } from "@/utils/env";

const musicStore = useMusicStore();
const statusStore = useStatusStore();

// 桌面 / Electron 浏览器全屏 API
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
// 接入电影感切换协调器
const orientationTransition = useOrientationTransition();

// 任意一种全屏均管图标切换
const effectiveFullscreen = computed(() => isFullscreen.value || statusStore.isImmersiveFullscreen);

// 浏览器全屏隐藏下拉；沉浸式保留为退出入口
const showCloseBtn = computed(() => !isFullscreen.value);

const exitImmersive = async () => {
  await orientationTransition.exit(musicStore.songCover);
};

// 横屏沉浸式与竖屏的纯净歌词开关分别隔离，避免互相污染
const togglePureLyricMode = () => {
  if (statusStore.isImmersiveFullscreen) {
    statusStore.pureLyricModeLandscape = !statusStore.pureLyricModeLandscape;
  } else {
    statusStore.pureLyricMode = !statusStore.pureLyricMode;
  }
};

const onToggleFullscreen = async () => {
  if (statusStore.isImmersiveFullscreen) {
    await exitImmersive();
    return;
  }
  // Capacitor 环境内 DOM Fullscreen API 多数无效，避免触发
  if (isCapacitorAndroid) return;
  toggleFullscreen();
};

const onCloseFullPlayer = async () => {
  if (statusStore.isImmersiveFullscreen) {
    await exitImmersive();
  }
  statusStore.showFullPlayer = false;
};
</script>

<style lang="scss" scoped>
.player-menu {
  position: absolute;
  top: 0;
  width: 100%;
  min-height: 80px;
  overflow: hidden;
  z-index: 100;
  cursor: pointer;
  .menu-content {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 100%;
  }
  .drag-dom {
    height: 80px;
    margin: 0 100px;
    flex: 1;
    -webkit-app-region: drag;
  }
  .left,
  .right {
    padding: 0 20px;
    transition: opacity 0.3s;
    .menu-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      transition:
        opacity 0.3s,
        background-color 0.3s,
        transform 0.3s;
      cursor: pointer;
      .n-icon {
        font-size: 28px;
        color: rgb(var(--main-cover-color));
      }
      &:hover {
        transform: scale(1.05);
        background-color: rgba(var(--main-cover-color), 0.14);
        opacity: 1;
      }
      &:active {
        transform: scale(1);
      }
    }
  }
  .left {
    .menu-icon {
      opacity: 0.6;
      &.open {
        opacity: 1;
        &:hover {
          opacity: 1;
        }
      }
      &:hover {
        opacity: 0.6;
      }
    }
  }
}
</style>
