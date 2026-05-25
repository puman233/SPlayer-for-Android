<template>
  <div class="scaling-modal">
    <div class="tip">
      <n-text depth="3" class="value">{{ modeLabel }}：50% - 200%</n-text>
    </div>
    <n-input-number
      v-model:value="zoomPercentage"
      :min="50"
      :max="200"
      :step="5"
      button-placement="both"
      class="scaling-input"
    >
      <template #suffix>%</template>
    </n-input-number>
    <n-button size="small" secondary type="primary" @click="resetZoom"> 恢复默认 </n-button>
    <n-card
      v-if="showFullscreenOptimize"
      :bordered="false"
      embedded
      size="small"
      class="fullscreen-optimize"
    >
      <n-flex :wrap="false" align="center" justify="space-between">
        <div class="fullscreen-optimize__text">
          <n-text class="fullscreen-optimize__title">全面屏优化</n-text>
          <n-text depth="3" class="fullscreen-optimize__desc">
            避免底部按钮被系统返回按钮遮挡
          </n-text>
        </div>
        <n-switch v-model:value="settingStore.androidFullscreenSafeAreaOptimize" :round="false" />
      </n-flex>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { useDevice } from "@/composables/useDevice";
import { isCapacitorAndroid, isElectron } from "@/utils/env";

const settingStore = useSettingStore();
const { isPad, isPhonePortrait } = useDevice();
const zoomPercentage = ref(100);
// 首次从 store / IPC 同步当前值不应回写：避免一次无意义的 persist + apply
const isReady = ref(false);

const modeLabel = computed(() => {
  if (isElectron) return "桌面缩放";
  if (isPad.value) return "平板模式缩放";
  if (isPhonePortrait.value) return "手机竖屏缩放";
  return "页面缩放";
});

const showFullscreenOptimize = computed(() => isCapacitorAndroid && isPhonePortrait.value);

const getZoom = () => {
  // Electron 走原生 zoom-factor IPC，不应回读移动端字段（防御：onMounted 已先短路到 IPC 分支）
  if (isElectron) return 100;
  if (isPad.value) return settingStore.padPageZoom;
  if (isPhonePortrait.value) return settingStore.phonePortraitPageZoom;
  return 100;
};

const setZoom = (value: number) => {
  // Electron 走原生 zoom-factor IPC，不应写入移动端字段（防御：watcher 已先短路到 IPC 分支）
  if (isElectron) return;
  if (isPad.value) {
    settingStore.padPageZoom = value;
    return;
  }
  if (isPhonePortrait.value) {
    settingStore.phonePortraitPageZoom = value;
    return;
  }
  // 其他模式（如手机横屏）没有对应缩放路径，丢弃写入避免静默落到无效字段
};

watch(zoomPercentage, (newVal) => {
  if (!isReady.value) return;
  if (!newVal) return;
  if (isElectron) {
    window.electron.ipcRenderer.invoke("set-zoom-factor", newVal / 100);
    return;
  }
  setZoom(newVal);
});

const resetZoom = () => {
  zoomPercentage.value = 100;
};

onMounted(async () => {
  if (isElectron) {
    const currentZoom = (await window.electron.ipcRenderer.invoke("get-zoom-factor")) as number;
    zoomPercentage.value = Math.round(currentZoom * 100);
  } else {
    zoomPercentage.value = getZoom() || 100;
  }
  // 等当前帧 watcher 被同步触发完再放开写入
  await nextTick();
  isReady.value = true;
});
</script>

<style lang="scss" scoped>
.scaling-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 24px 0;

  .scaling-input {
    width: 200px;
    text-align: center;
    :deep(.n-input__input-el) {
      text-align: center;
    }
  }

  .tip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    .value {
      font-size: 13px;
    }
  }

  .fullscreen-optimize {
    width: 100%;

    &__text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    &__title {
      font-size: 14px;
    }

    &__desc {
      font-size: 12px;
    }
  }
}
</style>
