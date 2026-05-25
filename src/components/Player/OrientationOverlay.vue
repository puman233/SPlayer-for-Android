<template>
  <!-- 黑场遮罩 -->
  <Transition name="shutter">
    <div v-if="showBackdrop" class="orientation-backdrop" :class="phaseClass" aria-hidden="true" />
  </Transition>
  <!-- 揭幕封面（仅进入横屏） -->
  <Transition name="hero">
    <img
      v-if="showHero && heroSrc && heroToRect"
      :src="heroSrc"
      :style="rectStyle"
      class="orientation-hero"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  </Transition>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { useOrientationTransition } from "@/composables/useOrientationTransition";

const { phase, isTransitioning, heroToRect, heroSrc } = useOrientationTransition();

// 过渡期间常驻，CSS 控制 fade
const showBackdrop = computed(() => isTransitioning.value);
const phaseClass = computed(() => `phase-${phase.value}`);

// 仅进入横屏时渲染封面
const showHero = computed(() => phase.value === "enter-revealing");

// 固定在横屏 cover 终点
const rectStyle = computed<CSSProperties>(() => {
  const r = heroToRect.value;
  if (!r) return {};
  return {
    top: `${r.top}px`,
    left: `${r.left}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: "16px",
  };
});
</script>

<style lang="scss" scoped>
// 半透明黑遮罩，过扫防露边
// 有两路径：元素自身 transition 供 phase-class 切换使用；shutter Transition 供 v-if 进出场使用
.orientation-backdrop {
  position: fixed;
  inset: -12vmax;
  z-index: 9000;
  pointer-events: none;
  background-color: rgba(0, 0, 0, 0.62);
  transform: translateZ(0);
  transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity;
}

.phase-enter-revealing,
.phase-exit-revealing {
  opacity: 0;
}

// 揭幕封面：仅 transform + opacity 入场
.orientation-hero {
  position: fixed;
  z-index: 9100;
  pointer-events: none;
  object-fit: cover;
  // 静态阴影，不参与 transition
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
  will-change: transform, opacity;
  transform: scale(1);
  opacity: 1;
}

// 揭幕入场
.hero-enter-active {
  transition:
    transform 480ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
.hero-enter-from {
  opacity: 0;
  transform: scale(0.92);
}

// 揭幕退场
.hero-leave-active {
  transition:
    transform 240ms cubic-bezier(0.4, 0, 1, 1),
    opacity 200ms cubic-bezier(0.4, 0, 1, 1);
}
.hero-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
