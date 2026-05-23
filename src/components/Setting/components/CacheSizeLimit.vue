<template>
  <n-card class="set-item">
    <div class="label">
      <n-text class="name">{{ item?.label || "缓存大小上限" }}</n-text>
      <n-text class="tip" :depth="3">
        达到上限后将自动驱逐最久未访问的缓存（优先长期未播放的音频）。下限 256 MB。
      </n-text>
      <n-text v-if="deviceFreeDisplay" class="tip" :depth="3">
        设备剩余：{{ deviceFreeDisplay }}。当前生效上限：{{ effectiveLimitDisplay }}
      </n-text>
    </div>
    <n-input-group class="set">
      <n-input-number
        :value="limitGB"
        :update-value-on-input="false"
        :min="0.25"
        :step="0.5"
        :precision="2"
        style="width: 70%"
        @update:value="onUpdateLimit"
      />
      <n-select :value="1" :options="[{ label: 'GB', value: 1 }]" disabled style="width: 30%" />
    </n-input-group>
  </n-card>
</template>

<script setup lang="ts">
import { SettingItem } from "@/types/settings";
import { useSettingStore } from "@/stores";
import { useCacheManager } from "@/core/resource/CacheManager";
import { formatFileSize } from "@/utils/helper";

defineProps<{ item?: SettingItem }>();

const settingStore = useSettingStore();
const cacheManager = useCacheManager();

// store 存 MB；UI 展示 GB；同步到 Java 端
const limitGB = computed(() => +(settingStore.maxCacheSizeMB / 1024).toFixed(2));
const deviceFreeBytes = ref<number>(-1);
const effectiveMaxBytes = ref<number>(0);

const deviceFreeDisplay = computed(() =>
  deviceFreeBytes.value > 0 ? formatFileSize(deviceFreeBytes.value) : "",
);
const effectiveLimitDisplay = computed(() =>
  effectiveMaxBytes.value > 0
    ? formatFileSize(effectiveMaxBytes.value)
    : formatFileSize(settingStore.maxCacheSizeMB * 1024 * 1024),
);

const refreshStats = async () => {
  try {
    const r = await cacheManager.getStats();
    if (r.success && r.data) {
      deviceFreeBytes.value = r.data.deviceFreeBytes;
      // 走 effectiveMaxBytes：设备空间不足时会自动从用户设定降到 free * 60%。
      effectiveMaxBytes.value = r.data.effectiveMaxBytes;
    }
  } catch (e) {
    console.warn("[CacheSizeLimit] getStats failed:", e);
  }
};

const applyLimit = async (mb: number) => {
  settingStore.maxCacheSizeMB = mb;
  try {
    await cacheManager.setMaxBytes(Math.round(mb * 1024 * 1024));
  } catch (e) {
    console.warn("[CacheSizeLimit] setMaxBytes failed:", e);
  }
  await refreshStats();
};

const onUpdateLimit = async (value: number | null) => {
  if (value == null) return;
  // 下限夹紧：256 MB = 0.25 GB
  const gb = Math.max(0.25, value);
  const mb = Math.round(gb * 1024);
  const wantBytes = mb * 1024 * 1024;
  // 超过设备剩余 90% 时弹二次确认；确认后仍按用户设置严格生效
  if (deviceFreeBytes.value > 0 && wantBytes > deviceFreeBytes.value * 0.9) {
    await new Promise<void>((resolve) => {
      window.$dialog.warning({
        title: "设置超过剩余存储",
        content: `当前设备剩余 ${formatFileSize(deviceFreeBytes.value)}，你即将设置上限为 ${formatFileSize(wantBytes)}，可能导致缓存写入失败。仍要继续吗？`,
        positiveText: "仍然使用该值",
        negativeText: "取消",
        onPositiveClick: async () => {
          await applyLimit(mb);
          resolve();
        },
        onNegativeClick: () => resolve(),
        onClose: () => resolve(),
        onMaskClick: () => resolve(),
      });
    });
    return;
  }
  await applyLimit(mb);
};

onMounted(async () => {
  // 启动同步 store → Java：避免升级后 Java 默认值与用户设置不一致
  try {
    await cacheManager.setMaxBytes(settingStore.maxCacheSizeMB * 1024 * 1024);
  } catch (e) {
    console.warn("[CacheSizeLimit] init setMaxBytes failed:", e);
  }
  await refreshStats();
});
</script>
