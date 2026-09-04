<template>
  <div class="home">
    <div v-if="settingStore.showHomeGreeting" class="welcome">
      <n-h1>{{ greetings }}</n-h1>
      <n-text depth="3">由此开启好心情 ~</n-text>
    </div>
    <HomeOnline v-if="settingStore.useOnlineService" :key="refreshKey" />
    <HomeLocal v-else :key="refreshKey" />
  </div>
</template>

<script setup lang="ts">
import { useSettingStore, useDataStore } from "@/stores";
import { getGreeting } from "@/utils/time";
import { isLogin } from "@/utils/auth";
import { useViewRefresh } from "@/composables/useViewRefresh";
import HomeOnline from "./HomeOnline.vue";
import HomeLocal from "./HomeLocal.vue";

const settingStore = useSettingStore();
const dataStore = useDataStore();

const greetings = computed(() => {
  const greeting = getGreeting();
  const name = isLogin() ? dataStore.userData.name : "";
  return name ? `${greeting}，${name}` : greeting;
});

// 底部导航长按刷新：仅首页激活时重载推荐子页
const route = useRoute();
const { refreshSeq } = useViewRefresh();
const refreshKey = ref(0);
watch(refreshSeq, () => {
  if (route.name !== "home") return;
  refreshKey.value++;
});
</script>

<style lang="scss" scoped>
.home {
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  padding-bottom: 20px;

  .welcome {
    margin-top: 8px;
    margin-bottom: 20px;

    .n-h1 {
      margin: 0;
      font-weight: bold;
    }
  }

  @media (max-width: 768px) {
    max-width: 100%;

    .welcome {
      margin-top: 0;
      margin-bottom: 16px;

      .n-h1 {
        font-size: 26px;
      }
    }
  }
}
</style>
