<template>
  <div class="lyric-poster">
    <n-scrollbar class="preview-pane">
      <div class="canvas-shell">
        <canvas ref="canvasRef" />
      </div>
    </n-scrollbar>
    <div class="config-pane">
      <div class="config-scroll">
        <div class="config-content">
          <div class="config-section">
            <div class="section-title">画布</div>
            <div class="row-group">
              <n-radio-group v-model:value="config.mode" size="small" class="full-width-group">
                <n-radio-button value="cover">封面背景</n-radio-button>
                <n-radio-button value="plain">纯色页面</n-radio-button>
              </n-radio-group>
            </div>
            <div class="row-group">
              <n-radio-group v-model:value="config.size" size="small" class="full-width-group">
                <n-radio-button value="portrait">1080 × 1440</n-radio-button>
                <n-radio-button value="square">1080 × 1080</n-radio-button>
              </n-radio-group>
            </div>
          </div>

          <div class="config-section">
            <div class="section-title">颜色</div>
            <div class="color-row">
              <label class="color-item">
                <span class="color-label">背景色</span>
                <n-color-picker v-model:value="config.backgroundColor" :show-alpha="false" />
              </label>
              <label class="color-item">
                <span class="color-label">歌词颜色</span>
                <n-color-picker v-model:value="config.textColor" :show-alpha="false" />
              </label>
            </div>
            <div class="color-row">
              <label class="color-item">
                <span class="color-label">辅助文字</span>
                <n-color-picker v-model:value="config.secondaryColor" :show-alpha="false" />
              </label>
            </div>
          </div>

          <div class="config-section">
            <div class="section-title">歌词</div>
            <label class="slider-item">
              <span class="slider-label">歌词位置 {{ config.lyricsTop }}%</span>
              <n-slider v-model:value="config.lyricsTop" :min="12" :max="72" />
            </label>
            <label class="slider-item">
              <span class="slider-label">歌词字号 {{ config.fontSize }}</span>
              <n-slider v-model:value="config.fontSize" :min="30" :max="72" />
            </label>
            <label class="slider-item">
              <span class="slider-label">行间距 {{ config.lineGap }}</span>
              <n-slider v-model:value="config.lineGap" :min="12" :max="56" />
            </label>
            <label v-if="config.mode === 'cover'" class="slider-item">
              <span class="slider-label">遮罩 {{ config.maskOpacity }}%</span>
              <n-slider v-model:value="config.maskOpacity" :min="0" :max="80" />
            </label>
            <label v-else class="slider-item">
              <span class="slider-label">底部封面大小 {{ config.coverSize }}%</span>
              <n-slider v-model:value="config.coverSize" :min="18" :max="42" />
            </label>
            <div class="row-group">
              <n-radio-group v-model:value="config.textAlign" size="small" class="full-width-group">
                <n-radio-button value="left">左对齐</n-radio-button>
                <n-radio-button value="center">居中</n-radio-button>
                <n-radio-button value="right">右对齐</n-radio-button>
              </n-radio-group>
            </div>
          </div>

          <div class="config-section">
            <div class="section-title">内容</div>
            <div class="check-grid">
              <n-checkbox v-model:checked="config.showTranslation">翻译</n-checkbox>
              <n-checkbox v-model:checked="config.showRomaji">音译</n-checkbox>
              <n-checkbox v-model:checked="config.showTitle">歌名</n-checkbox>
              <n-checkbox v-model:checked="config.showArtist">歌手</n-checkbox>
              <n-checkbox v-model:checked="config.showAlbum">专辑</n-checkbox>
              <n-checkbox v-model:checked="config.showLink">网易云链接</n-checkbox>
              <n-checkbox v-model:checked="config.showQr">二维码</n-checkbox>
              <n-checkbox v-model:checked="config.showWatermark">显示水印</n-checkbox>
            </div>
          </div>
        </div>
      </div>

      <div class="config-actions">
        <n-button block :loading="exporting" @click="savePoster">保存图片</n-button>
        <n-button block :loading="exporting" type="primary" @click="sharePoster">系统分享</n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import QRCode from "qrcode";
import { useMusicStore, useSettingStore } from "@/stores";
import { isCapacitorAndroid } from "@/utils/env";
import { AndroidShare } from "@/plugins/androidShare";

const props = defineProps<{
  selectedLines: number[];
  showTranslation: boolean;
  showRomaji: boolean;
}>();

const musicStore = useMusicStore();
const settingStore = useSettingStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const exporting = ref(false);
const coverImage = shallowRef<HTMLImageElement | null>(null);
const qrImage = shallowRef<HTMLImageElement | null>(null);
const watermarkImage = shallowRef<HTMLImageElement | null>(null);

const config = reactive({
  mode: "cover" as "cover" | "plain",
  size: "portrait" as "portrait" | "square",
  backgroundColor: "#16181d",
  textColor: "#ffffff",
  secondaryColor: "#c8cbd2",
  lyricsTop: 30,
  fontSize: 48,
  lineGap: 28,
  maskOpacity: 42,
  coverSize: 28,
  textAlign: "left" as CanvasTextAlign,
  showTranslation: props.showTranslation,
  showRomaji: props.showRomaji,
  showTitle: true,
  showArtist: true,
  showAlbum: true,
  showLink: true,
  showQr: true,
  showWatermark: true,
});

const rawLyrics = computed(() => {
  const lyric = musicStore.songLyric;
  return settingStore.showWordLyrics && lyric.yrcData?.length ? lyric.yrcData : lyric.lrcData;
});

const selectedLyrics = computed(() =>
  props.selectedLines
    .slice()
    .sort((a, b) => a - b)
    .map((index) => rawLyrics.value[index])
    .filter(Boolean),
);

const artist = computed(() => {
  const artists = musicStore.playSong.artists;
  return Array.isArray(artists) ? artists.map((item) => item.name).join(" / ") : artists;
});

const album = computed(() => {
  const value = musicStore.playSong.album;
  return typeof value === "string" ? value : value?.name || "";
});

const songLink = computed(() => `https://music.163.com/song?id=${musicStore.playSong.id}`);

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });

const loadAssets = async () => {
  const cover = musicStore.getSongCover("xl") || musicStore.playSong.cover;
  try {
    if (cover) {
      const response = await fetch(cover);
      const objectUrl = URL.createObjectURL(await response.blob());
      coverImage.value = await loadImage(objectUrl);
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.warn("歌词海报封面加载失败:", error);
  }
  try {
    qrImage.value = await loadImage(
      await QRCode.toDataURL(songLink.value, { width: 220, margin: 1, errorCorrectionLevel: "M" }),
    );
  } catch (error) {
    console.warn("歌词海报二维码生成失败:", error);
  }
  try {
    watermarkImage.value = await loadImage(
      `${import.meta.env.BASE_URL}icons/SPA-CE-favicon-512x512-2.png`,
    );
  } catch (error) {
    console.warn("歌词海报水印图标加载失败:", error);
  }
};

const drawCover = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
};

const wrapText = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const rows: string[] = [];
  let row = "";
  for (const character of text) {
    if (context.measureText(row + character).width > maxWidth && row) {
      rows.push(row);
      row = character;
    } else {
      row += character;
    }
  }
  if (row) rows.push(row);
  return rows;
};

const fitText = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  if (context.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while (fitted && context.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted}…`;
};

const renderPoster = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const width = 1080;
  const height = config.size === "portrait" ? 1440 : 1080;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = config.backgroundColor;
  context.fillRect(0, 0, width, height);
  if (config.mode === "cover" && coverImage.value) {
    drawCover(context, coverImage.value, 0, 0, width, height);
    context.fillStyle = `rgba(0, 0, 0, ${config.maskOpacity / 100})`;
    context.fillRect(0, 0, width, height);
  }

  const padding = 86;
  const maxTextWidth = width - padding * 2;
  const watermarkHeight = config.showWatermark ? 76 : 0;
  const textX =
    config.textAlign === "left"
      ? padding
      : config.textAlign === "right"
        ? width - padding
        : width / 2;
  const watermarkTop = height - padding - watermarkHeight;
  const footerBottom = watermarkTop - 28;
  const coverSize = config.mode === "plain" ? Math.round((width * config.coverSize) / 100) : 0;
  const footerHeight = Math.max(config.mode === "plain" ? 350 : 190, coverSize + 28);
  const footerTop = footerBottom - footerHeight;
  const lyricsTop = (height * config.lyricsTop) / 100;
  const lyricsMaxHeight = Math.max(120, footerTop - lyricsTop - 72);
  let lyricFontSize = config.fontSize;
  context.textAlign = config.textAlign;
  context.textBaseline = "top";

  const getLyricRows = (fontSize: number) => {
    const rows: { text: string; main: boolean; height: number }[] = [];
    for (const line of selectedLyrics.value) {
      const mainText = line.words?.map((word) => word.word).join("") || "";
      context.font = `600 ${fontSize}px sans-serif`;
      for (const row of wrapText(context, mainText, maxTextWidth)) {
        rows.push({ text: row, main: true, height: fontSize * 1.42 });
      }
      const suffixes = [
        config.showTranslation ? line.translatedLyric : "",
        config.showRomaji
          ? line.romanLyric || line.words?.map((word) => word.romanWord).join("")
          : "",
      ].filter(Boolean) as string[];
      context.font = `${Math.round(fontSize * 0.55)}px sans-serif`;
      for (const suffix of suffixes) {
        for (const row of wrapText(context, suffix, maxTextWidth)) {
          rows.push({ text: row, main: false, height: fontSize * 0.86 });
        }
      }
      rows.push({ text: "", main: false, height: config.lineGap });
    }
    if (rows.length) rows.pop();
    return rows;
  };

  let lyricRows = getLyricRows(lyricFontSize);
  while (
    lyricFontSize > 26 &&
    lyricRows.reduce((total, row) => total + row.height, 0) > lyricsMaxHeight
  ) {
    lyricFontSize -= 2;
    lyricRows = getLyricRows(lyricFontSize);
  }
  let y = lyricsTop;
  for (const row of lyricRows) {
    if (y + row.height > footerTop - 72) break;
    if (row.text) {
      context.fillStyle = row.main ? config.textColor : config.secondaryColor;
      context.font = row.main
        ? `600 ${lyricFontSize}px sans-serif`
        : `${Math.round(lyricFontSize * 0.55)}px sans-serif`;
      context.fillText(row.text, textX, y);
    }
    y += row.height;
  }

  const coverTop = footerBottom - coverSize;
  const footerY = config.mode === "plain" ? coverTop + 28 : footerBottom - 136;
  const qrSize = config.showQr && qrImage.value ? 136 : 0;
  if (config.mode === "plain" && coverImage.value) {
    drawCover(context, coverImage.value, padding, coverTop, coverSize, coverSize);
  }
  const footerX =
    config.mode === "plain" ? padding + Math.round((width * config.coverSize) / 100) + 52 : padding;
  const footerTextWidth = width - footerX - padding - (qrSize ? qrSize + 44 : 0);
  context.textAlign = "left";
  if (config.showTitle) {
    context.fillStyle = config.textColor;
    context.font = "600 36px sans-serif";
    context.fillText(fitText(context, musicStore.playSong.name, footerTextWidth), footerX, footerY);
  }
  const metadata = [config.showArtist ? artist.value : "", config.showAlbum ? album.value : ""]
    .filter(Boolean)
    .join(" · ");
  if (metadata) {
    context.fillStyle = config.secondaryColor;
    context.font = "26px sans-serif";
    context.fillText(fitText(context, metadata, footerTextWidth), footerX, footerY + 62);
  }
  if (config.showLink) {
    context.fillStyle = config.secondaryColor;
    context.font = "22px sans-serif";
    context.fillText(fitText(context, songLink.value, footerTextWidth), footerX, footerY + 112);
  }
  if (qrSize && qrImage.value) {
    context.drawImage(
      qrImage.value,
      width - padding - qrSize,
      footerBottom - qrSize,
      qrSize,
      qrSize,
    );
  }
  if (config.showWatermark) {
    const watermarkY = watermarkTop + 8;
    const iconSize = 52;
    const textX = padding + iconSize + 16;
    context.textAlign = "left";
    context.textBaseline = "top";
    if (watermarkImage.value) {
      context.globalAlpha = 0.86;
      context.drawImage(watermarkImage.value, padding, watermarkY, iconSize, iconSize);
      context.globalAlpha = 1;
    }
    context.fillStyle = config.textColor;
    context.font = "600 22px sans-serif";
    context.fillText("SPlayer For Android", textX, watermarkY + 2);
    context.fillStyle = config.secondaryColor;
    context.font = "16px sans-serif";
    context.fillText("Generated by SPlayer-Dev/SPlayer-for-Android", textX, watermarkY + 32);
  }
};

const fileName = computed(() => {
  const safeName = musicStore.playSong.name.replace(/[\\/:*?"<>|]/g, "_");
  return `${safeName}-歌词海报.png`;
});

const getDataUrl = () => {
  renderPoster();
  return canvasRef.value?.toDataURL("image/png") || "";
};

const downloadWeb = (dataUrl: string) => {
  const link = document.createElement("a");
  link.download = fileName.value;
  link.href = dataUrl;
  link.click();
};

const savePoster = async () => {
  exporting.value = true;
  try {
    const dataUrl = getDataUrl();
    if (isCapacitorAndroid) {
      await AndroidShare.saveImage({ dataUrl, fileName: fileName.value });
      window.$message.success("海报已保存到相册");
    } else {
      downloadWeb(dataUrl);
    }
  } catch (error) {
    console.error("保存歌词海报失败:", error);
    window.$message.error("保存海报失败");
  } finally {
    exporting.value = false;
  }
};

const sharePoster = async () => {
  exporting.value = true;
  try {
    const dataUrl = getDataUrl();
    if (isCapacitorAndroid) {
      await AndroidShare.shareImage({
        dataUrl,
        fileName: fileName.value,
        title: `${musicStore.playSong.name} - ${artist.value}`,
        text: config.showLink ? songLink.value : "",
      });
    } else {
      downloadWeb(dataUrl);
      window.$message.info("当前平台已改为下载图片");
    }
  } catch (error) {
    console.error("分享歌词海报失败:", error);
    window.$message.error("分享海报失败");
  } finally {
    exporting.value = false;
  }
};

watch(config, renderPoster, { deep: true });
watch([coverImage, qrImage, watermarkImage], renderPoster);
onMounted(async () => {
  renderPoster();
  await loadAssets();
  renderPoster();
});
</script>

<style scoped lang="scss">
.lyric-poster {
  display: flex;
  flex-direction: row;
  gap: 16px;
  height: min(76vh, 760px);
}
.preview-pane {
  flex: 1;
  min-width: 0;
  background: #0c0d10;
  border-radius: 12px;
  overflow: auto;
  .canvas-shell {
    min-height: 100%;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    display: block;
    width: 100%;
    max-width: 520px;
    height: auto;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  }
}
.config-pane {
  flex: 0 0 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  .config-scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .config-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }
  .config-section {
    min-width: 0;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    &:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }
  }
  .section-title {
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 700;
    color: #e2e4e9;
  }
  .row-group {
    margin-bottom: 8px;
    &:last-child {
      margin-bottom: 0;
    }
  }
  .full-width-group {
    width: 100%;
    :deep(.n-radio-button-wrapper) {
      flex: 1;
      text-align: center;
      white-space: nowrap;
    }
  }
  .color-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    &:last-child {
      margin-bottom: 0;
    }
  }
  .color-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .color-label {
    font-size: 12px;
    color: #9a9cae;
  }
  .slider-item {
    display: block;
    width: 100%;
    margin-bottom: 14px;
    &:last-child {
      margin-bottom: 0;
    }
  }
  .slider-label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    color: #9a9cae;
  }
  .check-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 8px;
  }
  .config-actions {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
}
@media (max-width: 760px) {
  .lyric-poster {
    flex-direction: column;
    height: 82vh;
  }
  .preview-pane {
    flex: 0 0 34%;
  }
  .config-pane {
    flex: 1;
    flex-basis: auto;
    .config-content {
      gap: 14px;
      padding: 14px;
    }
    .section-title {
      margin-bottom: 8px;
      font-size: 13px;
    }
    .row-group {
      margin-bottom: 7px;
    }
    .full-width-group {
      :deep(.n-radio-button-wrapper) {
        font-size: 12px;
        padding-left: 6px;
        padding-right: 6px;
      }
    }
    .color-row {
      gap: 6px;
      margin-bottom: 7px;
    }
    .slider-item {
      margin-bottom: 12px;
    }
    .check-grid {
      gap: 9px 6px;
    }
    .config-actions {
      gap: 8px;
      padding: 10px 14px;
    }
  }
}
</style>
