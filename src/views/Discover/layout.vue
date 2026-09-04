<template>
  <div class="discover">
    <div class="title">
      <n-text class="keyword">发现音乐</n-text>
    </div>
    <n-tabs
      v-model:value="discoverType"
      class="tabs"
      :type="isPhone ? 'line' : 'segment'"
      @update:value="(name: string) => router.push({ name })"
    >
      <n-tab name="discover-playlists">歌单广场</n-tab>
      <n-tab name="discover-toplists">排行榜</n-tab>
      <n-tab name="discover-artists">歌手</n-tab>
      <n-tab name="discover-new">最新音乐</n-tab>
    </n-tabs>
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component :is="Component" :key="refreshKey" class="router-view" />
        </KeepAlive>
        <component v-else :is="Component" :key="refreshKey" class="router-view" />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import { useDevice } from "@/composables/useDevice";
import { useSettingStore } from "@/stores";
import { useViewRefresh } from "@/composables/useViewRefresh";

const router = useRouter();
const settingStore = useSettingStore();
const { isPhone } = useDevice();

const discoverType = ref<string>(
  (router.currentRoute.value?.name as string) || "discover-playlists",
);

// 底部导航长按刷新：发现页激活时重载当前子页
const route = useRoute();
const { refreshSeq } = useViewRefresh();
const refreshKey = ref(0);
watch(refreshSeq, () => {
  if (!String(route.name || "").startsWith("discover")) return;
  refreshKey.value++;
});
</script>

<style lang="scss" scoped>
.discover {
  display: flex;
  flex-direction: column;
  padding-bottom: 20px;

  .title {
    display: flex;
    align-items: flex-end;
    line-height: normal;
    margin-top: 12px;
    margin-bottom: 20px;
    height: 40px;

    .keyword {
      font-size: 30px;
      font-weight: bold;
      margin-right: 12px;
      line-height: normal;
    }
  }

  @media (max-width: 768px) {
    .title {
      margin-top: 8px;
      margin-bottom: 12px;
      height: auto;

      .keyword {
        font-size: 24px;
      }
    }
  }
}
</style>
