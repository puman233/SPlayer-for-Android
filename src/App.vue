<template>
  <div :class="['app-shell', `app-shell--${shellMode}`]">
    <Provider>
      <router-view />
    </Provider>
  </div>
</template>

<script setup lang="ts">
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) SPlayer-Dev Contributors
// Original source: https://github.com/SPlayer-Dev/SPlayer
import { useDevice } from "@/composables/useDevice";
import { useImmersive } from "@/composables/useImmersive";
import { useAndroidBack } from "@/composables/useAndroidBack";
import { usePageZoom } from "@/composables/usePageZoom";
import { useSettingStore } from "@/stores";

const { shellMode, deviceModeOverride } = useDevice();
const settingStore = useSettingStore();

// 设备形态手动覆盖：从设置项同步到 useDevice 模块级 ref
watch(
  () => settingStore.androidDeviceModeOverride,
  (mode) => {
    deviceModeOverride.value = mode ?? "auto";
  },
  { immediate: true },
);

useImmersive();
useAndroidBack();
usePageZoom();
</script>

<style scoped>
.app-shell {
  width: 100%;
  height: 100%;
}
</style>
