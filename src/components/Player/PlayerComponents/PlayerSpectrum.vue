<template>
  <div :style="{ opacity: show ? '0.6' : '0.1' }" class="player-spectrum">
    <canvas ref="canvasRef" :style="{ height: height + 'px' }" class="spectrum-line" />
  </div>
</template>

<script setup lang="ts">
import { usePlayerController } from "@/core/player/PlayerController";

const props = defineProps<{
  show: boolean;
  height?: number;
  radius?: number;
  color?: string;
}>();

const player = usePlayerController();

// canvas
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isKeepDrawing = ref<boolean>(true);

const SKIP_BINS = 10;
const SPECTRUM_GAIN = 0.8;
let cachedCanvasWidth = 0;
let cachedCanvasHeight = 0;
let cachedPixelRatio = 0;
let ctx: CanvasRenderingContext2D | null = null;

// 仅尺寸变化时重设 canvas
const updateCanvasSize = () => {
  if (!canvasRef.value) return;
  const targetWidth = Math.min(document.body.clientWidth, 1600);
  const targetHeight = props.height || 80;
  const targetPixelRatio = window.devicePixelRatio || 1;
  if (
    targetWidth !== cachedCanvasWidth ||
    targetHeight !== cachedCanvasHeight ||
    targetPixelRatio !== cachedPixelRatio
  ) {
    canvasRef.value.width = Math.round(targetWidth * targetPixelRatio);
    canvasRef.value.height = Math.round(targetHeight * targetPixelRatio);
    canvasRef.value.style.width = `${targetWidth}px`;
    canvasRef.value.style.height = `${targetHeight}px`;
    cachedCanvasWidth = targetWidth;
    cachedCanvasHeight = targetHeight;
    cachedPixelRatio = targetPixelRatio;
    ctx = canvasRef.value.getContext("2d");
    ctx?.setTransform(targetPixelRatio, 0, 0, targetPixelRatio, 0, 0);
  }
};

// 数据源 30Hz，锁 ~30Hz 重绘与数据更新同步
const DRAW_INTERVAL_MS = 33;
let lastDrawTime = 0;

const drawSpectrum = () => {
  if (!isKeepDrawing.value || !ctx) return;
  const now = performance.now();
  if (now - lastDrawTime < DRAW_INTERVAL_MS) return;
  lastDrawTime = now;
  const spectrumData = player.getSpectrumData();
  if (!spectrumData) return;
  const dataLen = spectrumData.length - SKIP_BINS;
  if (dataLen <= 0) return;
  const numBars = Math.floor(dataLen / 2.5);
  if (numBars <= 0) return;
  const canvasWidth = cachedCanvasWidth;
  const canvasHeight = cachedCanvasHeight;
  const cornerRadius = props.radius || 2.5;
  const barWidth = canvasWidth / numBars / 2;
  const halfWidth = canvasWidth / 2;
  const drawWidth = barWidth - 3;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = props.color || "#efefef";

  // 累积所有柱到单 Path 后一次 fill，减少 GPU 状态切换
  ctx.beginPath();
  for (let i = 0; i < numBars; i++) {
    const barHeight = (spectrumData[i + SKIP_BINS] / 255) * canvasHeight * SPECTRUM_GAIN;
    if (barHeight <= 0) continue;
    const x1 = i * barWidth + halfWidth;
    const x2 = halfWidth - (i + 1) * barWidth;
    const y = canvasHeight - barHeight;
    addRoundRectPath(ctx, x1, y, drawWidth, barHeight, cornerRadius);
    addRoundRectPath(ctx, x2, y, drawWidth, barHeight, cornerRadius);
  }
  ctx.fill();
};

// 追加圆角矩形 sub-path；外层负责 beginPath + fill 批处理
const addRoundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

// 开始绘制频谱
const { pause: pauseDraw, resume: resumeDraw } = useRafFn(
  () => {
    drawSpectrum();
  },
  { immediate: false },
);

const onResize = () => updateCanvasSize();

// 避免重复 acquire/release 撕裂 Java visualizerRefCount
let visualizerHeld = false;
const acquireVis = () => {
  if (visualizerHeld) return;
  visualizerHeld = true;
  void player.acquireVisualizer();
};
const releaseVis = () => {
  if (!visualizerHeld) return;
  visualizerHeld = false;
  player.releaseVisualizer();
};

// 仅 visibility 切换驱动 acquire/release；props.show 只控 CSS opacity，
// 不接入避免 playerMetaShow 高频 toggle 让原生 enableVisualizer 队列堆积导致 flag 错位锁死
const onVisibility = () => {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    if (!isKeepDrawing.value) return;
    acquireVis();
    resumeDraw();
  } else {
    pauseDraw();
    releaseVis();
  }
};

onMounted(() => {
  isKeepDrawing.value = true;
  updateCanvasSize();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    acquireVis();
    resumeDraw();
  }
});

watch(() => props.height, () => updateCanvasSize());

onBeforeUnmount(() => {
  isKeepDrawing.value = false;
  pauseDraw();
  window.removeEventListener("resize", onResize);
  document.removeEventListener("visibilitychange", onVisibility);
  releaseVis();
});
</script>

<style lang="scss" scoped>
.player-spectrum {
  position: fixed;
  left: 0;
  bottom: 0;
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  opacity: 0.6;
  z-index: -1;
  pointer-events: none;
  transition: opacity 0.3s;
  mask: linear-gradient(
    90deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 10%,
    #fff 15%,
    #fff 85%,
    hsla(0, 0%, 100%, 0.6) 90%,
    hsla(0, 0%, 100%, 0)
  );
  -webkit-mask: linear-gradient(
    90deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 10%,
    #fff 15%,
    #fff 85%,
    hsla(0, 0%, 100%, 0.6) 90%,
    hsla(0, 0%, 100%, 0)
  );
  .spectrum-line {
    mask: linear-gradient(
      90deg,
      hsla(0, 0%, 100%, 0) 0,
      hsla(0, 0%, 100%, 0.6) 5%,
      #fff 10%,
      #fff 90%,
      hsla(0, 0%, 100%, 0.6) 95%,
      hsla(0, 0%, 100%, 0)
    );
    -webkit-mask: linear-gradient(
      90deg,
      hsla(0, 0%, 100%, 0) 0,
      hsla(0, 0%, 100%, 0.6) 5%,
      #fff 10%,
      #fff 90%,
      hsla(0, 0%, 100%, 0.6) 95%,
      hsla(0, 0%, 100%, 0)
    );
  }
}
</style>
