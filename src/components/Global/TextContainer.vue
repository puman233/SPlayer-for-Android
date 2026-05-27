<template>
  <div
    ref="textContainerRef"
    :class="['text-container', { overflowing: isTextOverflowing, scrolling: shouldScroll }]"
    @click.stop="activateScrollByClick"
    @pointerdown="recordPointerStart"
    @pointerup="activateScrollByPointer"
  >
    <div ref="scrollWrapperRef" class="scroll-wrapper">
      <div ref="textRef" class="text">
        <slot>{{ text }}</slot>
      </div>
      <div v-if="shouldScroll" class="text clone">
        <slot>{{ text }}</slot>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  text?: string;
  // 滚动速度 (px/frame)
  speed?: number;
  // 延迟时间
  delay?: number;
  // 两个内容之间的间距 (px)
  gap?: number;
  // 点击后才开启滚动
  activateOnClick?: boolean;
}>();

const gap = props.gap ?? 50;
const ACTIVATE_MOVE_TOLERANCE = 8;

const textRef = ref<HTMLElement | null>(null);
const textContainerRef = ref<HTMLElement | null>(null);
const scrollWrapperRef = ref<HTMLElement | null>(null);
const pointerStart = ref<{ x: number; y: number } | null>(null);
// pointerup 与合成 click 会同时触发 activate，pointerup 处理后让 click 跳过，避免双重 reflow
const pointerHandled = ref(false);

// 是否超出宽度
const isTextOverflowing = ref(false);
// 是否已点击开启滚动
const scrollActivated = ref(false);
const shouldScroll = computed(
  () => isTextOverflowing.value && (!props.activateOnClick || scrollActivated.value),
);

const { width: textContainerWidth } = useElementSize(textContainerRef);
const { width: textWidth } = useElementSize(textRef);

// 检查文本是否超出宽度
const checkTextWidth = () => {
  if (textRef.value && textContainerRef.value) {
    const contentWidth = textRef.value.scrollWidth;
    const containerWidth = textContainerRef.value.clientWidth || textContainerWidth.value;
    isTextOverflowing.value = contentWidth > containerWidth + 1;
  } else {
    isTextOverflowing.value = false;
  }
  updateScroll();
  // 触发一次重绘，解决某些情况下宽度计算不准确的问题
  if (scrollWrapperRef.value) {
    scrollWrapperRef.value.style.display = "none";
    scrollWrapperRef.value.offsetHeight;
    scrollWrapperRef.value.style.display = "";
  }
};

// 更新滚动状态
const updateScroll = () => {
  if (shouldScroll.value) {
    startScrolling();
  } else {
    stopScrolling();
  }
};

// 点击后开启跑马灯
const activateScroll = () => {
  if (!props.activateOnClick) return;
  checkTextWidth();
  if (!isTextOverflowing.value) return;
  scrollActivated.value = true;
};

// 记录轻触起点
const recordPointerStart = (event: PointerEvent) => {
  pointerStart.value = { x: event.clientX, y: event.clientY };
  pointerHandled.value = false;
};

// 移动端轻触后开启跑马灯（不 stopPropagation，避免阻断祖先 .main-player-body 的翻页手势）
const activateScrollByPointer = (event: PointerEvent) => {
  pointerHandled.value = true;
  if (!pointerStart.value) {
    activateScroll();
    return;
  }
  const distance = Math.hypot(
    event.clientX - pointerStart.value.x,
    event.clientY - pointerStart.value.y,
  );
  pointerStart.value = null;
  if (distance > ACTIVATE_MOVE_TOLERANCE) return;
  activateScroll();
};

// 合成 click：若 pointerup 已处理则跳过，仅在键盘 enter 等非指针场景生效
const activateScrollByClick = () => {
  if (pointerHandled.value) {
    pointerHandled.value = false;
    return;
  }
  activateScroll();
};

let animationId: number | null = null;
let scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

// 开始滚动
const startScrolling = () => {
  stopScrolling();
  if (!textRef.value || !textContainerRef.value || !scrollWrapperRef.value) return;
  const scrollSpeed = props.speed || 0.5;

  let currentPos = 0;
  const scroll = () => {
    if (!textRef.value || !textContainerRef.value || !scrollWrapperRef.value) return;
    // 当滚动到足以显示完整克隆内容时重置
    if (currentPos <= -textRef.value.scrollWidth - gap) {
      currentPos = 0;
    } else {
      currentPos -= scrollSpeed;
    }
    scrollWrapperRef.value.style.transform = `translateX(${currentPos}px)`;
    animationId = requestAnimationFrame(scroll);
  };
  // 延迟启动滚动
  scrollTimeoutId = setTimeout(() => {
    scroll();
  }, props.delay || 3000);
};

// 停止滚动
const stopScrolling = () => {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (scrollTimeoutId !== null) {
    clearTimeout(scrollTimeoutId);
    scrollTimeoutId = null;
  }
  if (scrollWrapperRef.value) {
    scrollWrapperRef.value.style.transform = "translateX(0)";
  }
};

watch(
  () => [props.text, textContainerWidth.value, textWidth.value],
  () => {
    nextTick(checkTextWidth);
  },
);

watch(
  () => props.text,
  () => {
    scrollActivated.value = false;
  },
);

watch(shouldScroll, () => {
  updateScroll();
});

onMounted(() => {
  nextTick(checkTextWidth);
});

onUnmounted(() => {
  stopScrolling();
});
</script>

<style lang="scss" scoped>
.text-container {
  position: relative;
  display: block;
  overflow: hidden;
  width: 100%;
  &:not(.scrolling) {
    .scroll-wrapper {
      display: block;
      width: 100%;
      min-width: 0;
    }
    .scroll-wrapper .text {
      display: block;
      overflow: hidden;
      width: 100%;
      max-width: 100%;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  .scroll-wrapper {
    position: relative;
    display: flex;
    width: fit-content;
    white-space: nowrap;
    will-change: transform;
    min-width: 100%;
    .text {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      &.clone {
        padding-left: v-bind("gap + 'px'");
      }
    }
  }
}
</style>
