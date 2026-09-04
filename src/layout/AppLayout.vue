<template>
  <div id="app-layout">
    <Transition name="fade">
      <div
        v-if="
          (statusStore.themeBackgroundMode === 'image' ||
            statusStore.themeBackgroundMode === 'video') &&
          statusStore.backgroundImageUrl
        "
        :key="statusStore.backgroundImageUrl"
        class="background-container"
      >
        <div
          v-if="statusStore.themeBackgroundMode === 'image'"
          class="background-image"
          :style="{
            backgroundImage: `url(${statusStore.backgroundImageUrl})`,
            transform: `scale(${statusStore.backgroundConfig.scale})`,
            filter: `blur(${statusStore.backgroundConfig.blur}px)`,
          }"
        />
        <video
          v-else-if="statusStore.themeBackgroundMode === 'video'"
          class="background-image"
          :src="statusStore.backgroundImageUrl"
          autoplay
          loop
          muted
          :style="{
            objectFit: 'cover',
            transform: `scale(${statusStore.backgroundConfig.scale})`,
            filter: `blur(${statusStore.backgroundConfig.blur}px)`,
          }"
        />
        <div
          class="background-mask"
          :style="{
            backgroundColor: `rgba(0, 0, 0, ${backgroundMaskOpacity})`,
          }"
        />
      </div>
    </Transition>

    <div
      id="main"
      :class="{
        'pad-layout': isPad,
        'phone-layout': isPhone,
        'show-player': musicStore.isHasPlayer && statusStore.showPlayBar,
        'show-full-player': statusStore.showFullPlayer,
      }"
    >
      <n-layout v-if="isPad" id="pad-main" has-sider>
        <n-layout-sider
          id="main-sider"
          :style="{
            height:
              musicStore.isHasPlayer && statusStore.showPlayBar
                ? 'calc(var(--page-zoom-100dvh, 100dvh) - 80px)'
                : 'var(--page-zoom-100dvh, 100dvh)',
            ...padSiderBg,
          }"
          :content-style="{
            overflow: 'hidden',
            height: '100%',
            padding: '0',
          }"
          :native-scrollbar="false"
          :collapsed="statusStore.menuCollapsed"
          :collapsed-width="64"
          :width="240"
          collapse-mode="width"
          show-trigger="bar"
          bordered
          @collapse="statusStore.menuCollapsed = true"
          @expand="statusStore.menuCollapsed = false"
        >
          <Sider />
        </n-layout-sider>

        <n-layout id="main-layout" :style="padLayoutBg">
          <Nav id="main-header" />
          <n-layout
            ref="contentRef"
            id="main-content"
            :native-scrollbar="false"
            :style="{ '--layout-height': contentHeight }"
            :content-style="{
              display: 'grid',
              gridTemplateRows: '1fr',
              minHeight: '100%',
              boxSizing: 'border-box',
              padding: '0 24px',
            }"
            position="absolute"
            embedded
          >
            <RouterView v-slot="{ Component }">
              <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
                <KeepAlive v-if="settingStore.useKeepAlive" :max="20" :exclude="['layout']">
                  <component :is="Component" class="router-view" />
                </KeepAlive>
                <component v-else :is="Component" class="router-view" />
              </Transition>
            </RouterView>
            <n-back-top v-if="!statusStore.showFullPlayer" :right="40" :bottom="120">
              <SvgIcon :size="22" name="Up" />
            </n-back-top>
          </n-layout>
        </n-layout>
      </n-layout>

      <div v-else id="main-phone-layout" :style="phoneLayoutBg">
        <Nav id="main-header" />
        <main ref="contentRef" id="main-phone-content">
          <RouterView v-slot="{ Component }">
            <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
              <KeepAlive v-if="settingStore.useKeepAlive" :max="20" :exclude="['layout']">
                <component :is="Component" class="router-view" />
              </KeepAlive>
              <component v-else :is="Component" class="router-view" />
            </Transition>
          </RouterView>
          <n-back-top v-if="!statusStore.showFullPlayer" :right="16" :bottom="phoneBackTopBottom">
            <SvgIcon :size="22" name="Up" />
          </n-back-top>
        </main>
      </div>
    </div>

    <Transition name="fade">
      <nav
        v-if="isPhone && !statusStore.showFullPlayer"
        ref="navRef"
        class="mobile-bottom-nav"
        :style="mobileNavBg"
      >
        <div class="mobile-bottom-nav__indicator" :style="indicatorStyle" />
        <button
          v-for="(item, idx) in phoneNavItems"
          :key="item.key"
          :ref="(el) => setItemRef(el, idx)"
          :class="[
            'mobile-bottom-nav__item',
            { active: activePhoneNav === item.key },
            { 'nav-pressed': pressedNavKey === item.key },
            { 'nav-bounce': bounceNavKey === item.key },
          ]"
          type="button"
          @pointerdown="startLongPress(item.key)"
          @pointerup="endLongPress(item.key)"
          @pointercancel="endLongPress(item.key)"
          @pointerleave="cancelLongPress(item.key)"
          @click="handleNavClick(item.key, item.routeName)"
        >
          <SvgIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </Transition>

    <!-- 真懒加载：用户首次打开播放队列时才挂载，挂载后保持常驻避免 Drawer 动画重置 -->
    <SongPlayList v-if="hasMountedPlayList" />
    <MainPlayer />
    <PlayerProvider>
      <FullPlayer />
    </PlayerProvider>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useMusicStore, useStatusStore, useSettingStore, useDataStore } from "@/stores";
import { useBlobURLManager } from "@/core/resource/BlobURLManager";
import { isElectron } from "@/utils/env";
import { useDevice } from "@/composables/useDevice";
import { useInit } from "@/composables/useInit";
import { triggerViewRefresh } from "@/composables/useViewRefresh";
import MainPlayer from "@/components/Player/MainPlayer.vue";
import FullPlayer from "@/components/Player/FullPlayer.vue";
import PlayerProvider from "@/components/Global/PlayerProvider.vue";

// 播放队列（n-drawer）首次打开才挂载，配合 defineAsyncComponent 异步拉取 chunk；
// 挂载后保持常驻，避免每次开关重置 n-drawer 入场动画。
const SongPlayList = defineAsyncComponent(() => import("@/components/List/SongPlayList.vue"));
const hasMountedPlayList = ref(false);

const musicStore = useMusicStore();
const statusStore = useStatusStore();
// 监听首次打开播放队列，触发懒加载
watch(
  () => statusStore.playListShow,
  (show) => {
    if (show) hasMountedPlayList.value = true;
  },
  { immediate: true },
);
const settingStore = useSettingStore();
const dataStore = useDataStore();
const route = useRoute();
const router = useRouter();

const blobURLManager = useBlobURLManager();
const { isPad, isPhone } = useDevice();

const phoneNavItems = [
  { key: "home", label: "推荐", icon: "Home", routeName: "home" },
  { key: "discover", label: "发现", icon: "Discover", routeName: "discover" },
  { key: "like", label: "收藏", icon: "Star", routeName: "like" },
  { key: "history", label: "最近", icon: "History", routeName: "history" },
] as const;

const activePhoneNav = computed(() => {
  const routeName = String(route.name || "");

  if (routeName.startsWith("discover")) return "discover";
  if (routeName.startsWith("like")) return "like";
  if (routeName.startsWith("history")) return "history";
  if (routeName === "home") return "home";

  return "home";
});

// 底栏滑动指示器：跟随激活的 nav item，动画平滑到位
const navRef = ref<HTMLElement | null>(null);
const itemRefs = ref<(HTMLElement | null)[]>([]);
const indicatorStyle = ref<Record<string, string>>({});
const setItemRef = (el: unknown, idx: number) => {
  itemRefs.value[idx] = el instanceof HTMLElement ? el : null;
};
const updateIndicator = () => {
  const idx = phoneNavItems.findIndex((it) => it.key === activePhoneNav.value);
  const el = itemRefs.value[idx];
  if (!el) {
    indicatorStyle.value = { opacity: "0" };
    return;
  }
  indicatorStyle.value = {
    transform: `translate3d(${el.offsetLeft}px, ${el.offsetTop}px, 0)`,
    width: `${el.offsetWidth}px`,
    height: `${el.offsetHeight}px`,
    opacity: "1",
  };
};
watch(activePhoneNav, () => nextTick(updateIndicator));
watch(
  () => isPhone.value && !statusStore.showFullPlayer,
  (visible) => {
    if (visible) nextTick(updateIndicator);
  },
);

const contentRef = ref<HTMLElement | null>(null);
const { height: contentHeight } = useElementSize(contentRef);

const backgroundMaskOpacity = computed(
  () => Math.min(Math.max(statusStore.backgroundConfig.maskOpacity, 0), 80) / 100,
);

// 布局层透明度
const imageLayoutVars = computed(() => {
  const f = Math.min(Math.max(statusStore.backgroundConfig.maskOpacity, 0), 80) / 80;
  return {
    bgTop: 0.02 + f * 0.2,
    bgBottom: 0.01 + f * 0.14,
    surface: 0.02 + f * 0.22,
    nav: 0.04 + f * 0.24,
  };
});

// 页面磨砂效果
const frostedBlur = computed(() => {
  const blur = Math.min(Math.max(statusStore.backgroundConfig.frostedBlur, 0), 20);
  return blur > 0 ? `blur(${blur}px)` : "none";
});

const frostedBlurVar = "--custom-background-frosted-blur";
const applyFrostedBlurVar = () => {
  if (statusStore.isCustomBackground) {
    document.documentElement.style.setProperty(frostedBlurVar, frostedBlur.value);
  } else {
    document.documentElement.style.removeProperty(frostedBlurVar);
  }
};
watch(() => [statusStore.isCustomBackground, frostedBlur.value], applyFrostedBlurVar, {
  immediate: true,
});
onUnmounted(() => document.documentElement.style.removeProperty(frostedBlurVar));

// 手机布局背景
const phoneLayoutBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { bgTop, bgBottom } = imageLayoutVars.value;
  return {
    background: `linear-gradient(180deg, rgba(var(--background), ${bgTop}), rgba(var(--background), ${bgBottom}))`,
  };
});

// 底部导航背景
const mobileNavBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { nav } = imageLayoutVars.value;
  return {
    backgroundColor: `rgba(var(--surface-container), ${nav})`,
    backdropFilter: frostedBlur.value,
    WebkitBackdropFilter: frostedBlur.value,
  };
});

// Pad 主布局背景
const padLayoutBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { bgTop, bgBottom } = imageLayoutVars.value;
  return {
    background: `linear-gradient(180deg, rgba(var(--background), ${bgTop}), rgba(var(--background), ${bgBottom}))`,
  };
});

// Pad 侧栏背景
const padSiderBg = computed(() => {
  if (!statusStore.isCustomBackground) return {};
  const { surface } = imageLayoutVars.value;
  return {
    backgroundColor: `rgba(var(--surface-container), ${surface})`,
    backdropFilter: frostedBlur.value,
    WebkitBackdropFilter: frostedBlur.value,
  };
});

// 回到顶部偏移
const phoneBackTopBottom = computed(() => {
  const navHeight = 56;
  const playerHeight = 64;
  const playerGap = 8;
  const hasPlayer = musicStore.isHasPlayer && statusStore.showPlayBar;
  // 底栏上方
  const base = navHeight + 16;
  return hasPlayer ? base + playerHeight + playerGap : base;
});

const loadBackgroundImage = async () => {
  if (statusStore.backgroundImageUrl) return;
  if (statusStore.themeBackgroundMode === "image" || statusStore.themeBackgroundMode === "video") {
    const blob = await dataStore.getBackgroundImage();
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      statusStore.backgroundImageUrl = blobURLManager.createBlobURL(
        arrayBuffer,
        blob.type,
        "background-image",
      );
    }
  }
};

watchEffect(() => {
  statusStore.mainContentHeight = contentHeight.value;
});

const navigatePhoneNav = (routeName: (typeof phoneNavItems)[number]["routeName"]) => {
  if (route.name === routeName) return;
  router.push({ name: routeName });
};

// 底部导航长按刷新：短暂按压即触发，响应更快
const LONG_PRESS_MS = 700;
const navTimers: Record<string, number> = {};
const navFired: Record<string, boolean> = {};
// 按下/弹起动画状态键
const pressedNavKey = ref<string | null>(null);
const bounceNavKey = ref<string | null>(null);

// 长按开始
const startLongPress = (key: string) => {
  if (navTimers[key]) window.clearTimeout(navTimers[key]);
  navFired[key] = false;
  pressedNavKey.value = key;
  navTimers[key] = window.setTimeout(() => {
    navFired[key] = true;
    // 触发震动，提供即时反馈
    navigator.vibrate?.(15);
    // 触发当前页面刷新
    triggerViewRefresh();
    // 弹起回弹动画
    bounceNavKey.value = key;
    window.setTimeout(() => {
      pressedNavKey.value = null;
      bounceNavKey.value = null;
    }, 320);
  }, LONG_PRESS_MS);
};

// 长按结束（提前松开，未触发刷新）
const endLongPress = (key: string) => {
  if (navTimers[key]) {
    window.clearTimeout(navTimers[key]);
    delete navTimers[key];
  }
  if (!navFired[key]) pressedNavKey.value = null;
};

// 指针离开：取消长按
const cancelLongPress = (key: string) => {
  if (navTimers[key]) {
    window.clearTimeout(navTimers[key]);
    delete navTimers[key];
  }
  pressedNavKey.value = null;
};

// 点击：若已触发长按刷新则消费掉，不再切换 Tab
const handleNavClick = (key: string, routeName: (typeof phoneNavItems)[number]["routeName"]) => {
  if (navFired[key]) {
    navFired[key] = false;
    return;
  }
  navigatePhoneNav(routeName);
};

useInit();

// 横竖屏切换后强制刷新布局：触发 resize 事件帮助依赖视口尺寸的组件重新计算
const handleOrientationChange = () => {
  // 触发多次 resize 事件以覆盖不同时机：立即、动画中、完成后
  const fire = () => window.dispatchEvent(new Event("resize"));
  fire();
  requestAnimationFrame(fire);
  setTimeout(fire, 150);
  setTimeout(fire, 400);
};

// matchMedia 在部分设备上比 orientationchange 事件更可靠
const orientationMql = window.matchMedia("(orientation: portrait)");

onMounted(() => {
  loadBackgroundImage();
  window.addEventListener("orientationchange", handleOrientationChange);
  window.addEventListener("resize", updateIndicator);
  // 首次挂载也尝试一次（nav 可能尚未渲染，wait nextTick 更稳）
  nextTick(updateIndicator);
  orientationMql.addEventListener?.("change", handleOrientationChange);
  if (!isElectron) {
    window.addEventListener("beforeunload", (event) => {
      // 软件热重载时跳过拦截，避免弹出“确认离开”对话框
      if ((window as unknown as { __splayerHotReloading?: boolean }).__splayerHotReloading) {
        return;
      }
      event.preventDefault();
      blobURLManager.revokeAllBlobURLs();
      event.returnValue = "";
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("orientationchange", handleOrientationChange);
  window.removeEventListener("resize", updateIndicator);
  orientationMql.removeEventListener?.("change", handleOrientationChange);
  // 清理长按计时器，避免卸载后残留
  Object.values(navTimers).forEach((t) => window.clearTimeout(t));
});
</script>

<style lang="scss" scoped>
#app-layout {
  // 安全区变量依赖 usePageZoom 挂在 #app 上的 --android-fullscreen-*，必须在此作用域才能正确取值
  --safe-area-top: max(env(safe-area-inset-top), var(--android-fullscreen-safe-top, 0px));
  --safe-area-bottom: max(env(safe-area-inset-bottom), var(--android-fullscreen-safe-bottom, 0px));
  --app-header-height: calc(72px + var(--safe-area-top));
  --phone-nav-height: 56px;
  --phone-nav-total-height: calc(var(--phone-nav-height) + var(--safe-area-bottom));
  --phone-player-height: 64px;
  --phone-player-gap: 8px;
  --phone-content-gap: 12px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.background-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;

  .background-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    transform-origin: center center;
  }

  .background-mask {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}

#main {
  flex: 1;
  height: 100%;
  transition:
    transform 0.3s var(--n-bezier),
    opacity 0.3s var(--n-bezier);

  .router-view {
    position: relative;
    min-height: 100%;

    &.n-result {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
  }

  &.show-full-player {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.9);

    #main-header {
      -webkit-app-region: no-drag;
    }
  }
}

#pad-main {
  height: 100%;

  #main-layout {
    background: linear-gradient(
      180deg,
      rgba(var(--background), 0.86),
      rgba(var(--background), 0.78)
    );
  }

  #main-content {
    top: var(--app-header-height);
    background-color: transparent;
    transition: bottom 0.3s;
  }
}

#main.show-player {
  #pad-main {
    #main-content {
      // 同步纳入底部安全区，避免内容被加高后的播放栏挡住
      bottom: calc(80px + var(--safe-area-bottom));
    }
  }
}

#main-phone-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
  background: linear-gradient(180deg, rgba(var(--background), 0.94), rgba(var(--background), 0.9));
}

:global(html.image) {
  #main-header {
    position: relative;
    z-index: 2;
    background-color: rgba(var(--surface-container), 0.08);
    backdrop-filter: var(--custom-background-frosted-blur, none);
    -webkit-backdrop-filter: var(--custom-background-frosted-blur, none);
  }
}

#main-phone-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 14px calc(var(--phone-nav-total-height) + 8px);
  box-sizing: border-box;
}

#main.show-player {
  #main-phone-content {
    /* 播放栏现在浮于底栏之上：底栏 + 间距 + 播放栏 + 一点冗余 */
    padding-bottom: calc(
      var(--phone-nav-total-height) + var(--phone-player-gap) + var(--phone-player-height) + 12px
    );
  }
}

.mobile-bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 6px 8px calc(6px + var(--safe-area-bottom));
  background-color: var(--surface-container-hex);
  box-shadow: 0 -1px 8px rgba(0, 0, 0, 0.06);
  transition: opacity 0.3s var(--n-bezier);

  &__indicator {
    position: absolute;
    top: 0;
    left: 0;
    border-radius: 10px;
    background: rgba(var(--primary), 0.12);
    transition:
      transform 0.3s var(--n-bezier),
      width 0.3s var(--n-bezier),
      height 0.3s var(--n-bezier),
      opacity 0.2s var(--n-bezier);
    pointer-events: none;
    z-index: 0;
    will-change: transform, width;
  }

  &__item {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 38px;
    padding: 2px 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--n-text-color-2);
    transition:
      color 0.3s var(--n-bezier),
      transform 0.15s var(--n-bezier);

    .n-icon {
      font-size: 17px;
    }

    span {
      font-size: 10px;
      line-height: 1;
      text-align: center;
      word-break: keep-all;
    }

    &.active {
      color: var(--primary-hex);
    }

    &:active {
      transform: scale(0.94);
    }

    // 长按刷新：按压缩放 0.92，弹起回弹 1.0
    &.nav-pressed {
      transform: scale(0.92);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    &.nav-bounce {
      animation: nav-bounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
  }

  @keyframes nav-bounce {
    0% {
      transform: scale(0.92);
    }
    100% {
      transform: scale(1);
    }
  }

  @media (max-width: 360px) {
    &__item {
      .n-icon {
        font-size: 16px;
      }
      span {
        font-size: 9px;
      }
    }
  }
}
</style>
