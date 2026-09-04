import type { LyricConfig } from "../../types/desktop-lyric";

const config: LyricConfig = {
  isLock: false,
  playedColor: "#fe7971",
  unplayedColor: "#ccc",
  shadowColor: "rgba(0, 0, 0, 0.5)",
  fontFamily: "system-ui",
  fontSize: 24,
  fontWeight: 400,
  showTran: true,
  showWordLyrics: true,
  isDoubleLine: true,
  position: "both",
  limitBounds: false,
  textBackgroundMask: false,
  backgroundMaskColor: "rgba(0, 0, 0, 0.5)",
  alwaysShowPlayInfo: false,
  animation: true,
  windowWidthPercent: 84, // 默认宽度为屏幕 84%（左右各 8% 边距）
  windowHeightDp: 72,
};

export default config;
