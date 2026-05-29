/**
 * 封面取色 Worker。
 * 同时导出算法函数，供主线程回退使用。
 */

import {
  themeFromSourceColor,
  QuantizerCelebi,
  Hct,
  Score,
  type Theme,
} from "@material/material-color-utilities";
import type { CoverColors } from "@/types/main";

// ============================================================
// 常量
// ============================================================

// 取色采样尺寸
export const COVER_SAMPLE_SIZE = 32;

// 单调主题（纯色模式 / 灰度封面回退）
export const MONOTONOUS_THEME: CoverColors = {
  main: { r: 239, g: 239, b: 239 },
  light: {
    primary: { r: 10, g: 10, b: 10 },
    background: { r: 238, g: 238, b: 238 },
    "surface-container": { r: 212, g: 212, b: 212 },
  },
  dark: {
    primary: { r: 239, g: 239, b: 239 },
    background: { r: 31, g: 31, b: 31 },
    "surface-container": { r: 39, g: 39, b: 39 },
  },
};

// ============================================================
// 类型
// ============================================================

// 主题变体类型
export type ThemeVariantKey =
  | "primary"
  | "secondary"
  | "tertiary"
  | "neutral"
  | "neutralVariant"
  | "error";

// Worker 请求消息
export interface CoverColorWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  variant: ThemeVariantKey;
}

// Worker 响应消息
export interface CoverColorWorkerResponse {
  id: number;
  data: CoverColors | null;
  error?: string;
}

// ============================================================
// 算法（主线程 / Worker 共用）
// ============================================================

// ARGB 32 位整数 → RGB 三分量
const argbToRgbTuple = (x: number): [number, number, number] => [
  (x >> 16) & 0xff,
  (x >> 8) & 0xff,
  x & 0xff,
];

// 主色以 RGB 格式返回
const getAccentColor = (argb: number) => {
  const [r, g, b] = argbToRgbTuple(argb);
  return { r, g, b };
};

// 生成主题配色方案
const getThemeSchema = (theme: Theme, variant: ThemeVariantKey = "secondary"): CoverColors => {
  const palette = theme.palettes[variant];
  const { hue, chroma } = palette;
  const getColor = (tone: number) => getAccentColor(Hct.from(hue, chroma, tone).toInt());

  return {
    main: getColor(90),
    light: {
      primary: getColor(10),
      background: getColor(94),
      "surface-container": getColor(90),
    },
    dark: {
      primary: getColor(90),
      background: getColor(20),
      "surface-container": getColor(16),
    },
  };
};

// RGBA 像素转 ARGB 整数
export const rgbaPixelsToArgbInts = (data: Uint8ClampedArray): number[] => {
  const len = data.length / 4;
  const out = new Array<number>(len);
  for (let i = 0, p = 0; i < len; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const a = data[p + 3];
    out[i] = (((a << 24) >>> 0) | ((r << 16) >>> 0) | ((g << 8) >>> 0) | b) >>> 0;
  }
  return out;
};

// 提取 Material 主题配色
export const argbPixelsToCoverColors = (
  pixels: number[],
  variant: ThemeVariantKey = "secondary",
): CoverColors => {
  // 颜色量化
  const quantizedColors = QuantizerCelebi.quantize(pixels, 128);
  const sortedQuantizedColors = Array.from(quantizedColors).sort((a, b) => b[1] - a[1]);
  // 检测灰度封面
  const mostFrequentColors = sortedQuantizedColors.slice(0, 5).map((x) => argbToRgbTuple(x[0]));
  if (mostFrequentColors.every((x) => Math.max(...x) - Math.min(...x) < 5)) {
    return MONOTONOUS_THEME;
  }
  // 颜色评分 + 生成 Material 主题
  const ranked = Score.score(new Map(sortedQuantizedColors.slice(0, 50)));
  const topColor = ranked[0];
  const theme = themeFromSourceColor(topColor);
  return getThemeSchema(theme, variant);
};

// ============================================================
// Worker 入口
// ============================================================

self.onmessage = (ev: MessageEvent<CoverColorWorkerRequest>) => {
  const { id, buffer, width, height, variant } = ev.data;
  try {
    const expected = width * height * 4;
    if (!buffer || buffer.byteLength !== expected) {
      const resp: CoverColorWorkerResponse = {
        id,
        data: null,
        error: `Invalid buffer size ${buffer?.byteLength ?? 0}, expected ${expected}`,
      };
      self.postMessage(resp);
      return;
    }
    const rgba = new Uint8ClampedArray(buffer);
    const pixels = rgbaPixelsToArgbInts(rgba);
    const data = argbPixelsToCoverColors(pixels, variant);
    const resp: CoverColorWorkerResponse = { id, data };
    self.postMessage(resp);
  } catch (err) {
    const resp: CoverColorWorkerResponse = {
      id,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(resp);
  }
};
