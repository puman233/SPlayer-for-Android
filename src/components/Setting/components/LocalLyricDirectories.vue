<template>
  <n-card class="set-item" content-style="flex-direction: column; padding: 16px;">
    <n-flex justify="space-between" align="center" style="width: 100%">
      <div class="label">
        <n-text class="name">{{ item?.label || "本地歌词覆盖在线歌词" }}</n-text>
        <n-text class="tip" :depth="3" v-if="item?.description" v-html="item.description" />
        <n-text class="tip" :depth="3" v-else-if="isCapacitorAndroid">
          选择歌词目录，支持 .ttml、.yrc 和 .lrc 格式 <br />
          TTML/LRC 元数据可用于本地歌曲匹配 <br />
          添加后会自动扫描
        </n-text>
        <n-text class="tip" :depth="3" v-else>
          可在这些文件夹及其子文件夹内覆盖在线歌曲的歌词 <br />
          将歌词文件命名为 `歌曲ID.后缀名` 或者 `任意前缀.歌曲ID.后缀名` 即可 <br />
          支持 .lrc 和 .ttml 格式 <br />
          （提示：可以在前缀加上歌名等信息，也可以利用子文件夹分类管理）
        </n-text>
      </div>
      <n-flex :size="8">
        <n-button
          v-if="isCapacitorAndroid"
          strong
          secondary
          :loading="scanLoading"
          :disabled="!hasAndroidDirectories || picking"
          @click="scanAndroidLyricDirectories()"
        >
          <template #icon>
            <SvgIcon name="Refresh" />
          </template>
          重新扫描
        </n-button>
        <n-button strong secondary :loading="picking" :disabled="scanLoading" @click="addDirectory">
          <template #icon>
            <SvgIcon name="Folder" />
          </template>
          添加
        </n-button>
      </n-flex>
    </n-flex>

    <template v-if="isCapacitorAndroid">
      <n-collapse-transition :show="hasAndroidScanMeta">
        <n-flex class="scan-summary" align="center" :size="8">
          <n-text :depth="3">最近扫描：{{ scanTimeText }}</n-text>
          <n-tag size="small">歌词 {{ androidScanMeta.totalFiles }}</n-tag>
          <n-tag size="small" type="success">命中 {{ androidScanMeta.matchedFiles }}</n-tag>
          <n-tag size="small" type="warning">重复 {{ androidScanMeta.duplicateIds }}</n-tag>
          <n-tag size="small" :type="androidScanMeta.failedFiles ? 'error' : 'default'">
            失败 {{ androidScanMeta.failedFiles }}
          </n-tag>
        </n-flex>
      </n-collapse-transition>

      <n-collapse-transition :show="hasAndroidDirectories">
        <n-list class="directory-list" :bordered="false">
          <n-list-item
            v-for="(directory, index) in settingStore.androidLyricDirectories"
            :key="directory.uri"
          >
            <n-flex justify="space-between" align="center" style="width: 100%" :wrap="false">
              <div class="directory-info">
                <n-text class="name">{{ getAndroidDirectoryDisplayName(directory, index) }}</n-text>
              </div>
              <n-button
                strong
                secondary
                :disabled="scanLoading || picking"
                @click="removeAndroidLyricDirectory(index)"
              >
                <template #icon>
                  <SvgIcon name="Delete" />
                </template>
              </n-button>
            </n-flex>
          </n-list-item>
        </n-list>
      </n-collapse-transition>
    </template>

    <template v-else>
      <n-collapse-transition :show="settingStore.localLyricPath.length > 0">
        <n-list class="directory-list" :bordered="false">
          <n-list-item v-for="(path, index) in settingStore.localLyricPath" :key="path">
            <n-flex justify="space-between" align="center" style="width: 100%" :wrap="false">
              <div class="directory-info">
                <n-text class="name">{{ path }}</n-text>
              </div>
              <n-button strong secondary @click="changeLocalLyricPath(index)">
                <template #icon>
                  <SvgIcon name="Delete" />
                </template>
              </n-button>
            </n-flex>
          </n-list-item>
        </n-list>
      </n-collapse-transition>
    </template>
  </n-card>
</template>

<script setup lang="ts">
import { AndroidLocalLyric, type AndroidLyricDirectory } from "@/plugins/androidLocalLyric";
import { useSettingStore } from "@/stores";
import type { SettingItem } from "@/types/settings";
import { isCapacitorAndroid } from "@/utils/env";
import { changeLocalLyricPath } from "@/utils/helper";

defineProps<{
  item?: SettingItem;
}>();

const settingStore = useSettingStore();
const picking = ref(false);
const scanLoading = ref(false);

const androidScanMeta = computed(() => settingStore.androidLyricScanMeta);
const hasAndroidDirectories = computed(() => settingStore.androidLyricDirectories.length > 0);
const hasAndroidScanMeta = computed(
  () =>
    androidScanMeta.value.lastScanAt > 0 ||
    androidScanMeta.value.totalFiles > 0 ||
    androidScanMeta.value.matchedFiles > 0 ||
    androidScanMeta.value.failedFiles > 0,
);
const scanTimeText = computed(() =>
  androidScanMeta.value.lastScanAt
    ? new Date(androidScanMeta.value.lastScanAt).toLocaleString()
    : "未扫描",
);

const getLastNameSegment = (value: string) => {
  let name = value.trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    // 保留原始名称
  }
  const cleanName = name.split(/[?#]/)[0];
  const slashSegment = cleanName.split(/[\\/]/).filter(Boolean).at(-1) || cleanName;
  return slashSegment.split(":").filter(Boolean).at(-1)?.trim() || "";
};

const getAndroidDirectoryDisplayName = (directory: AndroidLyricDirectory, index: number) => {
  const name = getLastNameSegment(directory.name || directory.uri || "");
  return name || `歌词目录 ${index + 1}`;
};

const resetAndroidLyricIndex = () => {
  settingStore.androidLyricIndexMap = {};
  settingStore.androidLyricEntries = [];
  settingStore.androidLyricScanMeta = {
    lastScanAt: 0,
    totalFiles: 0,
    matchedFiles: 0,
    duplicateIds: 0,
    failedFiles: 0,
  };
};

const scanAndroidLyricDirectories = async (showSuccess = true) => {
  if (!isCapacitorAndroid) return false;
  if (!settingStore.androidLyricDirectories.length) {
    resetAndroidLyricIndex();
    return true;
  }

  scanLoading.value = true;
  try {
    const directories = settingStore.androidLyricDirectories.map((directory) => ({
      uri: directory.uri,
      name: directory.name,
    }));
    const summary = await AndroidLocalLyric.scanLyricDirectories({ directories });
    settingStore.androidLyricIndexMap = summary.indexMap || {};
    settingStore.androidLyricEntries = Array.isArray(summary.entries) ? summary.entries : [];
    settingStore.androidLyricScanMeta = {
      lastScanAt: Date.now(),
      totalFiles: summary.totalFiles || 0,
      matchedFiles: summary.matchedFiles || 0,
      duplicateIds: summary.duplicateIds || 0,
      failedFiles: summary.failedFiles || 0,
    };

    if (summary.failedFiles > 0) {
      window.$message.warning(`扫描完成，${summary.failedFiles} 个文件读取失败`);
    } else if (showSuccess) {
      window.$message.success(`扫描完成，命中 ${summary.matchedFiles} 个歌词文件`);
    }
    return true;
  } catch (error) {
    console.error("扫描 Android 本地歌词目录失败:", error);
    window.$message.error("扫描本地歌词目录失败，请重新授权目录");
    return false;
  } finally {
    scanLoading.value = false;
  }
};

const addAndroidLyricDirectory = async () => {
  picking.value = true;
  try {
    const result = await AndroidLocalLyric.pickLyricDirectory();
    if (result.cancelled || !result.uri) return;

    const directory: AndroidLyricDirectory = {
      uri: result.uri,
      name: result.name || "歌词目录",
    };
    const exists = settingStore.androidLyricDirectories.some((item) => item.uri === directory.uri);
    if (exists) {
      window.$message.warning("该目录已添加");
      return;
    }

    settingStore.androidLyricDirectories.push(directory);
    const scanned = await scanAndroidLyricDirectories(false);
    if (scanned) window.$message.success("已添加歌词目录");
  } catch (error) {
    console.error("添加 Android 本地歌词目录失败:", error);
    window.$message.error("添加本地歌词目录失败");
  } finally {
    picking.value = false;
  }
};

const removeAndroidLyricDirectory = async (index: number) => {
  settingStore.androidLyricDirectories.splice(index, 1);
  await scanAndroidLyricDirectories(false);
  window.$message.success("已删除歌词目录");
};

const addDirectory = async () => {
  if (isCapacitorAndroid) {
    await addAndroidLyricDirectory();
    return;
  }
  await changeLocalLyricPath();
};
</script>

<style scoped lang="scss">
.scan-summary {
  margin-top: 12px;
}

.directory-list {
  margin-top: 12px;
  overflow: hidden;
  border-radius: 8px;
  background-color: rgba(var(--primary), 0.05);

  :deep(.n-list-item) {
    padding: 10px 12px;
  }
}

.directory-info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
