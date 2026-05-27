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
    <n-card
      v-if="showDeviceModeOverride"
      :bordered="false"
      embedded
      size="small"
      class="fullscreen-optimize"
    >
      <div class="device-mode">
        <div class="fullscreen-optimize__text">
          <n-text class="fullscreen-optimize__title">设备形态</n-text>
          <n-text depth="3" class="fullscreen-optimize__desc">
            自动识别异常时可手动强制切换布局
          </n-text>
        </div>
        <n-radio-group
          :value="settingStore.androidDeviceModeOverride"
          name="device-mode-override"
          size="small"
          @update:value="handleDeviceModeChange"
        >
          <n-radio-button value="auto">自动</n-radio-button>
          <n-radio-button value="phone">手机模式</n-radio-button>
          <n-radio-button value="pad">平板模式</n-radio-button>
        </n-radio-group>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { useDevice } from "@/composables/useDevice";
import { isCapacitorAndroid, isElectron } from "@/utils/env";

const settingStore = useSettingStore();
const { isPad, isPadDevice, isPhone, isPhonePortrait } = useDevice();
const zoomPercentage = ref(100);
// 首次从 store / IPC 同步当前值不应回写：避免一次无意义的 persist + apply
const isReady = ref(false);

const modeLabel = computed(() => {
  if (isElectron) return "桌面缩放";
  if (isPad.value) return "平板模式缩放";
  if (isPadDevice.value && isPhonePortrait.value) return "平板竖屏缩放";
  if (isPhonePortrait.value) return "手机竖屏缩放";
  return "页面缩放";
});

// 全面屏优化对所有 Android 形态有效（手机/平板、横/竖）
const showFullscreenOptimize = computed(() => isCapacitorAndroid);
// 设备形态手动覆盖仅 Android 端有意义（桌面端走 Electron 分支）
const showDeviceModeOverride = computed(() => isCapacitorAndroid);

// 设备形态切换：强制模式可能与硬件不匹配，弹窗确认；恢复自动直接生效
const handleDeviceModeChange = (mode: "auto" | "phone" | "pad") => {
  if (mode === settingStore.androidDeviceModeOverride) return;
  if (mode === "auto") {
    settingStore.androidDeviceModeOverride = mode;
    return;
  }
  window.$dialog.warning({
    title: "切换设备形态",
    content: "手动切换或将导致 UI 错乱，如正常请勿使用",
    positiveText: "继续切换",
    negativeText: "取消",
    onPositiveClick: () => {
      settingStore.androidDeviceModeOverride = mode;
    },
  });
};

const getZoom = () => {
  // Electron 走原生 zoom-factor IPC，不应回读移动端字段（防御：onMounted 已先短路到 IPC 分支）
  if (isElectron) return 100;
  if (isPad.value) return settingStore.padPageZoom;
  if (isPadDevice.value && isPhonePortrait.value) return settingStore.padPortraitPageZoom;
  // 手机端竖屏与横屏共享同一缩放字段，与 usePageZoom.activeZoom 保持一致
  if (isPhone.value) return settingStore.phonePortraitPageZoom;
  return 100;
};

const getDefaultZoom = () => {
  if (isPadDevice.value && isPhonePortrait.value) return 120;
  return 100;
};

const setZoom = (value: number) => {
  // Electron 走原生 zoom-factor IPC，不应写入移动端字段（防御：watcher 已先短路到 IPC 分支）
  if (isElectron) return;
  if (isPad.value) {
    settingStore.padPageZoom = value;
    return;
  }
  if (isPadDevice.value && isPhonePortrait.value) {
    settingStore.padPortraitPageZoom = value;
    return;
  }
  // 手机端竖屏与横屏共享同一缩放字段，与 usePageZoom.activeZoom / getZoom 保持一致
  if (isPhone.value) {
    settingStore.phonePortraitPageZoom = value;
    return;
  }
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
  zoomPercentage.value = getDefaultZoom();
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

  .device-mode {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;

    .n-radio-group {
      align-self: flex-end;
    }
  }
}
</style>
