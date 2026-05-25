import { computed, ref } from "vue";

export const ANDROID_PAD_BREAKPOINT = 768;

// 模块级单例：所有 useDevice() 共用同一份 viewport 状态与监听器，避免重复注册造成内存泄漏
const hasWindow = typeof window !== "undefined";
const rawWidth = ref(hasWindow ? window.innerWidth : 0);
const rawHeight = ref(hasWindow ? window.innerHeight : 0);

const refreshSize = () => {
  if (!hasWindow) return;
  rawWidth.value = window.innerWidth;
  rawHeight.value = window.innerHeight;
};

if (hasWindow) {
  window.addEventListener("resize", refreshSize);
  window.addEventListener("orientationchange", () => setTimeout(refreshSize, 300));
}

// 设备视口
const effectiveWidth = computed(() => rawWidth.value);
const effectiveHeight = computed(() => rawHeight.value);

const shortestSide = computed(() => Math.min(effectiveWidth.value, effectiveHeight.value));
const isLandscape = computed(() => effectiveWidth.value > effectiveHeight.value);
const isPad = computed(() => shortestSide.value >= ANDROID_PAD_BREAKPOINT);
const isPhone = computed(() => shortestSide.value < ANDROID_PAD_BREAKPOINT);
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
    isPhonePortrait,
    isPhoneLandscape,
    shellMode,
    breakpoint: ANDROID_PAD_BREAKPOINT,
  };
};
