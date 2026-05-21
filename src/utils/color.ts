import type { CoverColors } from "@/types/main";
import {
  themeFromSourceColor,
  QuantizerCelebi,
  Hct,
  Score,
  argbFromHex,
  type Theme,
} from "@material/material-color-utilities";
import { rgbToHex } from "@imsyy/color-utils";
import { useSettingStore, useStatusStore } from "@/stores";
import { argbToRgb } from "./helper";
import { chunk } from "lodash-es";
import { sendTaskbarThemeColor } from "@/core/player/PlayerIpc";

// 单调主题（纯色模式）
export const MONOTONOUS_THEME = {
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

/**
 * 主色以 RGB 格式返回
 * @param {number} argb - 表示颜色的 ARGB 格式整数
 */
const getAccentColor = (argb: number) => {
  // 将 ARGB 转换为 RGB
  const [r, g, b] = [...argbToRgb(argb)];
  // 返回 rgb
  return { r, g, b };
};

/**
 * 生成主题配色方案
 * @param theme Material Theme 对象
 * @param variant 变体名称，默认为 'secondary'
 */
const getThemeSchema = (theme: Theme, variant: keyof Theme["palettes"] = "secondary") => {
  const { hue, chroma } = theme.palettes[variant];
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

/**
 * 根据颜色生成主题
 * @param color 颜色 Hex
 * @param variant 变体名称
 */
export const getThemeFromColor = (
  color: string,
  variant: keyof Theme["palettes"] = "secondary",
) => {
  const argb = argbFromHex(color);
  const theme = themeFromSourceColor(argb);
  return getThemeSchema(theme, variant);
};

// 修改全局颜色
export const setGlobalColor = (name: string, colorValue: string): void => {
  if (!name.startsWith("--")) {
    throw new Error("Variable name must start with '--'");
  }
  const root = document.body;
  root.style.setProperty(name, colorValue);
};

// 设置动态配色
export const setColorSchemes = (
  color: string | CoverColors,
  // 明暗模式
  mode: "dark" | "light",
): { [key: string]: string } => {
  const settingStore = useSettingStore();
  const colorData =
    typeof color === "string" ? getThemeFromColor(color, settingStore.themeVariant) : color;
  if (!colorData) throw new Error("Color data not found");
  // 指定模式颜色数据
  const colorModeData = colorData[mode];
  const modifiedColorModeData: { [key: string]: string } = {};
  // 是否全局应用
  if (!settingStore.themeGlobalColor && colorModeData) {
    // 修改关键颜色
    colorModeData.background =
      mode === "dark" ? { r: 16, g: 16, b: 20 } : { r: 246, g: 246, b: 246 };
    colorModeData["surface-container"] =
      mode === "dark" ? { r: 24, g: 24, b: 28 } : { r: 255, g: 255, b: 255 };
  }
  // 遍历颜色并修改
  for (const key in colorModeData) {
    const color = colorModeData[key];
    if (typeof color === "object" && "r" in color && "g" in color && "b" in color) {
      const hexValue = rgbToHex(color.r, color.g, color.b);
      // 修改后的颜色值存储在新的对象中
      modifiedColorModeData[`${key}-hex`] = hexValue;
      modifiedColorModeData[key] = `${color.r}, ${color.g}, ${color.b}`;
      // 设置样式
      setGlobalColor(`--${key}`, `${color.r}, ${color.g}, ${color.b}`);
      setGlobalColor(`--${key}-hex`, hexValue);
    } else {
      console.error(`Invalid color data for key: ${key}`);
    }
  }
  return modifiedColorModeData;
};

// 取色采样尺寸：从 50x50（2500 px）下调到 32x32（1024 px），
// quantize 工作量降至 ~40%，在保留主色识别准确度的同时显著缩短主线程阻塞。
const COVER_SAMPLE_SIZE = 32;

// 获取封面主题
export const getCoverColorData = (dom: HTMLImageElement) => {
  if (!dom) return null;
  // canvas
  const canvas = document.createElement("canvas");
  canvas.width = COVER_SAMPLE_SIZE;
  canvas.height = COVER_SAMPLE_SIZE;
  // 获取采样尺寸的图像颜色数据
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(
    dom,
    0,
    0,
    dom.naturalWidth,
    dom.naturalHeight,
    0,
    0,
    COVER_SAMPLE_SIZE,
    COVER_SAMPLE_SIZE,
  );
  const pixels = chunk(ctx.getImageData(0, 0, COVER_SAMPLE_SIZE, COVER_SAMPLE_SIZE).data, 4).map(
    (pixel) => {
      // 将颜色数据转换为整数表示
      return (
        (((pixel[3] << 24) >>> 0) |
          ((pixel[0] << 16) >>> 0) |
          ((pixel[1] << 8) >>> 0) |
          pixel[2]) >>>
        0
      );
    },
  );
  // 使用 QuantizerCelebi 进行颜色量化
  const quantizedColors = QuantizerCelebi.quantize(pixels, 128);
  const sortedQuantizedColors = Array.from(quantizedColors).sort((a, b) => b[1] - a[1]);
  // 获取最频繁的颜色，并转换为 RGB 格式
  const mostFrequentColors = sortedQuantizedColors.slice(0, 5).map((x) => argbToRgb(x[0]));
  // 如果最频繁的颜色差异很小，使用灰色强调色
  if (mostFrequentColors.every((x) => Math.max(...x) - Math.min(...x) < 5)) {
    return MONOTONOUS_THEME;
  }
  // 使用 Score 库对颜色进行评分
  const ranked = Score.score(new Map(sortedQuantizedColors.slice(0, 50)));
  const topColor = ranked[0];
  const theme = themeFromSourceColor(topColor);
  // 移除 canvas
  canvas.remove();
  const settingStore = useSettingStore();
  // 返回主题
  return getThemeSchema(theme, settingStore.themeVariant);
};

/**
 * 把主线程重活调度到空闲帧执行，避免在切歌首帧阻塞 30-100ms
 */
const runWhenIdle = (cb: () => void): void => {
  const ric = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => cb(), { timeout: 200 });
  } else {
    setTimeout(cb, 0);
  }
};

let coverColorRequestId = 0;

// URL → 主题缓存：重复播放（包括预取/上一首/历史回放）零计算开销。
// 用 LRU 上限避免无限增长（不同专辑封面 URL 可能成百上千）。
const COVER_COLOR_CACHE_MAX = 64;
const coverColorCache = new Map<string, CoverColors>();
const readCoverColorCache = (url: string): CoverColors | undefined => {
  const cached = coverColorCache.get(url);
  if (!cached) return undefined;
  // 命中后移到末尾，维持 LRU
  coverColorCache.delete(url);
  coverColorCache.set(url, cached);
  return cached;
};
const writeCoverColorCache = (url: string, data: CoverColors) => {
  if (coverColorCache.has(url)) coverColorCache.delete(url);
  coverColorCache.set(url, data);
  while (coverColorCache.size > COVER_COLOR_CACHE_MAX) {
    const oldestKey = coverColorCache.keys().next().value;
    if (oldestKey === undefined) break;
    coverColorCache.delete(oldestKey);
  }
};

// 应用取色结果到 store，分离公共写入逻辑给"缓存命中"和"现算完成"两条路径复用。
const applyCoverColor = (data: CoverColors) => {
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();
  statusStore.songCoverTheme = data;
  if (!settingStore.playerFollowCoverColor) {
    statusStore.songCoverTheme.main = { r: 239, g: 239, b: 239 };
  }
  sendTaskbarCoverColor();
};

/**
 * 获取歌曲封面颜色数据
 * @param coverUrl 歌曲封面地址
 */
export const getCoverColor = async (coverUrl: string) => {
  if (!coverUrl) return;
  const requestId = ++coverColorRequestId;

  // 缓存命中：立即应用，跳过图片加载与 quantize 重计算。
  const cached = readCoverColorCache(coverUrl);
  if (cached) {
    applyCoverColor(cached);
    return;
  }

  // 创建图像元素
  const image = new Image();
  image.crossOrigin = "Anonymous";
  image.src = coverUrl;
  const cleanupImage = () => {
    image.onload = null;
    image.onerror = null;
    image.src = "";
  };
  // 图像加载完成：把 canvas 像素采样 + quantize 推到空闲帧，避免阻塞切歌首屏渲染
  image.onload = () => {
    runWhenIdle(() => {
      if (requestId !== coverColorRequestId) {
        cleanupImage();
        return;
      }
      // 获取图片数据
      const coverColorData = getCoverColorData(image);
      if (coverColorData) {
        writeCoverColorCache(coverUrl, coverColorData);
        applyCoverColor(coverColorData);
      }
      // 移除元素
      cleanupImage();
    });
  };
  image.onerror = () => {
    cleanupImage();
  };
};

/**
 * 发送任务栏封面颜色
 * 从 statusStore.songCoverTheme 读取封面主色
 */
export const sendTaskbarCoverColor = () => {
  const settingStore = useSettingStore();
  if (!settingStore.taskbarLyricUseThemeColor) {
    sendTaskbarThemeColor(null);
    return;
  }
  const statusStore = useStatusStore();
  const coverTheme = statusStore.songCoverTheme;
  // 检查亮暗模式数据是否存在
  if (!coverTheme?.dark?.primary || !coverTheme?.light?.primary) return;
  const darkPrimary = coverTheme.dark.primary;
  const lightPrimary = coverTheme.light.primary;
  sendTaskbarThemeColor({
    dark: rgbToHex(darkPrimary.r, darkPrimary.g, darkPrimary.b),
    light: rgbToHex(lightPrimary.r, lightPrimary.g, lightPrimary.b),
  });
};
