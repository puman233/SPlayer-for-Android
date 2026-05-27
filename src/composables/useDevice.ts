import { computed, ref } from "vue";

// Material Design 3 expanded 断点（dp/CSS px），覆盖多数 7~10 寸 Android 平板
export const ANDROID_PAD_BREAKPOINT = 600;

// 模块级单例：所有 useDevice() 共用同一份 viewport 状态与监听器，避免重复注册造成内存泄漏
const hasWindow = typeof window !== "undefined";
const rawWidth = ref(hasWindow ? window.innerWidth : 0);
const rawHeight = ref(hasWindow ? window.innerHeight : 0);

/**
 * 基于 UA 的平板硬件识别（一次性计算，UA 不会变）：
 * - 模型名含「Pad」：iPad / MatePad / MiPad / Galaxy Tab / Lenovo Pad 等
 * - Android 平板 UA 不含「Mobile」token；手机 UA 必带「Mobile」
 *
 * 与 viewport/screen 短边判定走 OR 关系：尺寸或 UA 任一命中即识别为平板，
 * 避免某些 WebView 视口缩水 + 短边接近断点时误判。
 */
const uaIsTablet = ((): boolean => {
  if (!hasWindow || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/pad/i.test(ua)) return true;
  // Android tablet 标识：含 Android 但不含 Mobile（W3C/Google 推荐约定）
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true;
  // Tablet 关键字（部分 ROM 自定义 UA）
  if (/Tablet/i.test(ua)) return true;
  return false;
})();
// screen.* 反映设备物理屏幕（CSS px），不会被 WebView 状态栏/导航条 inset 裁掉，
// 对设备形态判定比 innerWidth/innerHeight 更可靠
const rawScreenWidth = ref(hasWindow ? window.screen?.width || 0 : 0);
const rawScreenHeight = ref(hasWindow ? window.screen?.height || 0 : 0);

const refreshSize = () => {
  if (!hasWindow) return;
  rawWidth.value = window.innerWidth;
  rawHeight.value = window.innerHeight;
  rawScreenWidth.value = window.screen?.width || 0;
  rawScreenHeight.value = window.screen?.height || 0;
};

if (hasWindow) {
  window.addEventListener("resize", refreshSize);
  window.addEventListener("orientationchange", () => setTimeout(refreshSize, 300));
}

// 设备视口（用于布局判断的等效像素，朝向用 viewport，因为 screen 在部分 Android 上不随旋转更新）
const effectiveWidth = computed(() => rawWidth.value);
const effectiveHeight = computed(() => rawHeight.value);

// 设备形态判定用「viewport 与 screen 短边取较大者」：
// 部分 Android WebView 会把 status bar / 三键导航栏从 innerWidth/innerHeight 里扣掉，
// 导致 7 寸平板的 viewport 短边低于 600 被误判为手机；screen.* 是物理屏幕尺寸，更稳。
const viewportShortest = computed(() =>
  Math.min(effectiveWidth.value, effectiveHeight.value),
);
const screenShortest = computed(() => {
  const w = rawScreenWidth.value;
  const h = rawScreenHeight.value;
  if (!w || !h) return 0;
  return Math.min(w, h);
});
const shortestSide = computed(() =>
  Math.max(viewportShortest.value, screenShortest.value),
);
const isLandscape = computed(() => effectiveWidth.value > effectiveHeight.value);

// === 用户手动覆盖：防止 UA / 短边识别失败时无法切换设备形态 ===
// 由 App.vue 从 settingStore.androidDeviceModeOverride 同步到此 ref
export type DeviceModeOverride = "auto" | "phone" | "pad";
const deviceModeOverride = ref<DeviceModeOverride>("auto");

// === 设备硬件形态（不随旋转变化）===
// 仅用于"是否物理手机/平板"的判断：沉浸式横屏入口、方向锁等硬件相关逻辑
const isPadDevice = computed(() => {
  if (deviceModeOverride.value === "phone") return false;
  if (deviceModeOverride.value === "pad") return true;
  return uaIsTablet || shortestSide.value >= ANDROID_PAD_BREAKPOINT;
});
const isPhoneDevice = computed(() => !isPadDevice.value);

// === UI 布局模式（随旋转切换）===
// 仅平板横屏走平板 UI；平板竖屏 / 任意朝向手机 都走手机 UI
// 平板竖屏单列窄宽不适合双栏侧导航，统一回退手机布局，体验一致
const isPad = computed(() => isPadDevice.value && isLandscape.value);
const isPhone = computed(() => !isPad.value);

// 细化语义（基于布局模式，保持与 isPad/isPhone 一致）
const isPhonePortrait = computed(() => isPhone.value && !isLandscape.value);
const isPhoneLandscape = computed(() => isPhone.value && isLandscape.value);
const shellMode = computed(() => (isPad.value ? "pad" : "phone"));

export const useDevice = () => {
  return {
    width: rawWidth,
    height: rawHeight,
    // 用于布局判断的等效像素
    effectiveWidth,
    effectiveHeight,
    shortestSide,
    isLandscape,
    isPad,
    isPhone,
    isPadDevice,
    isPhoneDevice,
    isPhonePortrait,
    isPhoneLandscape,
    shellMode,
    breakpoint: ANDROID_PAD_BREAKPOINT,
    deviceModeOverride,
  };
};
