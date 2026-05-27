import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface AndroidNativePlaybackState {
  src: string;
  songId?: number;
  paused: boolean;
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  durationMs: number;
  positionMs: number;
  volume: number;
  playbackRate: number;
  errorCode: number;
}

export interface AndroidNativeLoadOptions {
  url: string;
  positionMs?: number;
  autoPlay?: boolean;
}

export interface AndroidNativeMetadataPayload {
  songId?: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  durationMs: number;
  canLike?: boolean;
}

/**
 * 单首曲目在窗口中的元数据 + 已解析 URL + playListIndex。
 *
 * url 与 skipSong 严格区分语义：
 * - url == null && !skipSong → 还没 prefetch，Java 端按需通过 UrlResolver 解析后播放
 * - skipSong === true → JS 端 shouldSkipSong（Fuck DJ 等）已判定屏蔽，Java 直接跳过不解析
 */
export interface AndroidNativeWindowTrack {
  songId: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  durationMs: number;
  canLike: boolean;
  liked: boolean;
  url: string | null;
  /** 该曲目在 JS 端 playList 中的实际索引；Java 切歌后 emit trackChanged 时回传，TS 端据此同步 statusStore.playIndex */
  playListIndex: number;
  /** JS 端 shouldSkipSong（Fuck DJ Mode）置 true；Java advance/back/peek 跳过且不调上游解析接口 */
  skipSong: boolean;
}

/**
 * 播放队列窗口推送 payload。
 *
 * 替代旧的 nextTrack 单首预载机制：JS 端在每次切歌完成 / 列表变化 / repeat 模式变化后，
 * 推送当前播放点 ±N 首到 Java 端。Java 据此自治处理 ENDED / NEXT / PREVIOUS，
 * 完全脱离 WebView 后台冻结的影响。详见 .scratch/native-queue-design.md。
 */
export interface AndroidNativeQueueContextPayload {
  liked: boolean;
  canSkipPrevious: boolean;
  personalFmMode: boolean;
  controllerEnabled: boolean;
  desktopLyricButtonEnabled: boolean;
  desktopLyricEnabled: boolean;
  /** "off" | "all" | "one"：单曲循环 "one" 由 Java 在 ENDED 时响应 */
  repeatMode: "off" | "all" | "one";
  /** 当前播放点 ±N 首；首位为可播曲目时 Java 立刻自治续播 */
  windowTracks: AndroidNativeWindowTrack[];
  /** 当前正在播的曲目在 windowTracks 中的索引（0-based） */
  windowCurrentIndex: number;
  /** 全局是否还有窗口左侧外的歌曲（false → Java 在 ALL 模式下可自行 wrap 到队首） */
  hasPreviousOutsideWindow: boolean;
  /** 全局是否还有窗口右侧外的歌曲（true → Java 在窗口耗尽时 emit requestUrls 让 JS 补） */
  hasNextOutsideWindow: boolean;
  /**
   * 是否为「补窗响应」推送：仅 refreshAndroidQueueWindow（Java emit requestUrls 后）路径置 true。
   * Java 端据此区分本次推送是否为续播触发，避免 liked / 桌面歌词等无关 sync 误消费 pendingResumeAfterRefill。
   */
  windowRefilled?: boolean;
  /**
   * 是否为「末尾 ALL wrap」推送：JS 已把 playIndex 重置为 0，windowCurrentIndex 直接指向应播曲。<br>
   * Java 端据此选择 current()（true）或 advanceRaw(false)（false）以避免跳过 track 0（修复 #3）。
   */
  windowResetFromWrap?: boolean;
}

export interface AndroidNativeNotificationPrefsPayload {
  controllerEnabled: boolean;
  desktopLyricButtonEnabled: boolean;
}

export interface AndroidNativeApiContextPayload {
  apiBaseUrl: string;
  cookie: string;
  /** 当前用户偏好音质等级（exhigh / lossless / hires / standard …），Java 端 UrlResolver 用于 /song/url/v1?level= */
  songLevel?: string;
}

export type AndroidNativePlaybackStateEvent = AndroidNativePlaybackState;

export interface AndroidNativeProgressEvent {
  durationMs: number;
  positionMs: number;
  /** 权威 seek 标志：true 时 TS 端须强制刷新估算基准；缺省为周期轮询可忽略。 */
  authoritative?: boolean;
}

export interface AndroidNativeEndedEvent {
  durationMs: number;
}

export interface AndroidNativeErrorEvent {
  errorCode: number;
  message?: string;
}

export interface AndroidNativeCustomActionEvent {
  action:
    | "next"
    | "previous"
    | "play"
    | "pause"
    | "favorite"
    | "desktopLyric"
    | "desktopLyricReady"
    | "collapse"
    | "autoNext"
    /** Java 自治切歌后通知 TS 同步 statusStore.playIndex（payload 含 playListIndex/source） */
    | "trackChanged"
    /** Java 队列窗口耗尽，请求 TS 推新窗口 */
    | "requestUrls";
  songId?: number;
  liked?: boolean;
  desktopLyricEnabled?: boolean;
  collapsed?: boolean;
  success?: boolean;
  message?: string;
  /** trackChanged 携带：Java 切到的曲目在 JS playList 中的真实索引 */
  playListIndex?: number;
  /** trackChanged 携带：触发原因，UI 据此区分 toast/动画 */
  source?: "auto" | "next" | "previous";
}

export interface AndroidNativePermissionResult {
  granted: boolean;
}

/**
 * 频谱可视化数据事件 payload
 * - fft: 长度 256 的 0-255 整数数组，覆盖 0~24kHz（FftAudioProcessor 解码链 FFT 输出）
 * - lowFreq: 归一化 + 平滑后的低频音量 [0.0, 1.0]，驱动 AMLL 流体背景鼓点
 *
 * Java 端节流 ~30Hz 推送，TS 端缓存最新值，rAF 内同步读取，避免每帧跨 JNI。
 */
export interface AndroidNativeVisualizerDataEvent {
  /**
   * 频谱字节数据的 base64 编码（256 字节 0-255）。
   *
   * <p>新格式：相比直接传 number[]，JSON 体积缩减 3-4×，跨 JNI 桥延迟显著降低，
   * 避免每帧 30Hz × 256 个 JSArray.put 的 GC 压力。
   */
  fftB64: string;
  lowFreq: number;
}

export interface AndroidNativeFloatingLyricDataPayload {
  lrcData: string;
  yrcData: string;
}

export interface AndroidNativeFloatingLyricProgressPayload {
  timeMs: number;
  playing: boolean;
}

export interface AndroidNativeFloatingLyricSongInfoPayload {
  name: string;
  artist: string;
}

export interface AndroidNativeFloatingLyricConfigPayload {
  playedColor?: string;
  unplayedColor?: string;
  shadowColor?: string;
  backgroundMaskColor?: string;
  textBackgroundMask?: boolean;
  showTran?: boolean;
  showWordLyrics?: boolean;
  isDoubleLine?: boolean;
  animation?: boolean;
  fontSize?: number;
  fontWeight?: number;
  position?: "left" | "center" | "right" | "both";
  windowWidthPercent?: number;
  windowHeightDp?: number;
}

export interface AndroidNativePlaybackPlugin {
  load(options: AndroidNativeLoadOptions): Promise<AndroidNativePlaybackState>;
  play(): Promise<AndroidNativePlaybackState>;
  pause(): Promise<AndroidNativePlaybackState>;
  stop(): Promise<AndroidNativePlaybackState>;
  /** 硬清理：清 MediaItem / 通知栏 / 播放队列窗口。仅用于清场场景，切歌仍用 stop()。 */
  cleanup(): Promise<AndroidNativePlaybackState>;
  seek(options: { positionMs: number }): Promise<AndroidNativePlaybackState>;
  setVolume(options: { volume: number }): Promise<void>;
  setRate(options: { rate: number }): Promise<void>;
  updateMetadata(options: AndroidNativeMetadataPayload): Promise<void>;
  updateQueueContext(options: AndroidNativeQueueContextPayload): Promise<void>;
  updateNotificationPrefs(options: AndroidNativeNotificationPrefsPayload): Promise<void>;
  setAllowMixWithOthers(options: { allow: boolean }): Promise<void>;
  setShowStatusBar(options: { show: boolean }): Promise<void>;
  setHideNavigationBar(options: { hide: boolean }): Promise<void>;
  /** 横屏沉浸式：同时隐藏状态栏与全面屏导航手势条 */
  setImmersiveLandscape(options: { active: boolean }): Promise<void>;
  syncApiContext(options: AndroidNativeApiContextPayload): Promise<void>;
  syncRemoteState(options: {
    playing: boolean;
    positionMs: number;
    durationMs: number;
  }): Promise<void>;
  getState(): Promise<AndroidNativePlaybackState>;
  requestNotificationPermission(): Promise<AndroidNativePermissionResult>;
  showFloatingLyric(): Promise<void>;
  hideFloatingLyric(): Promise<void>;
  updateFloatingLyricData(options: AndroidNativeFloatingLyricDataPayload): Promise<void>;
  updateFloatingLyricProgress(options: AndroidNativeFloatingLyricProgressPayload): Promise<void>;
  updateFloatingLyricSongInfo(options: AndroidNativeFloatingLyricSongInfoPayload): Promise<void>;
  updateFloatingLyricConfig(options: AndroidNativeFloatingLyricConfigPayload): Promise<void>;
  checkOverlayPermission(): Promise<AndroidNativePermissionResult>;
  requestOverlayPermission(): Promise<AndroidNativePermissionResult>;
  /**
   * 启用/停用音频频谱可视化（Media3 AudioProcessor 内嵌 FFT，无需任何权限）。
   * 关闭时 Java 端 listener=null 直接跳过 FFT 计算，CPU 占用归零。
   */
  enableVisualizer(options: { enable: boolean }): Promise<AndroidNativePermissionResult>;
  /**
   * 预下载音频前 512 KB 到 ExoPlayer SimpleCache。fire-and-forget，立即 resolve。
   * 同 url 并发去重；切歌时未完成的预下载会自动取消让带宽。
   */
  prefetchAudio(options: { url: string }): Promise<void>;
  addListener(
    eventName: "playbackStateChanged",
    listenerFunc: (event: AndroidNativePlaybackStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "progressChanged",
    listenerFunc: (event: AndroidNativeProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "ended",
    listenerFunc: (event: AndroidNativeEndedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "error",
    listenerFunc: (event: AndroidNativeErrorEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "customAction",
    listenerFunc: (event: AndroidNativeCustomActionEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "visualizerData",
    listenerFunc: (event: AndroidNativeVisualizerDataEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const AndroidNativePlayback =
  registerPlugin<AndroidNativePlaybackPlugin>("AndroidNativePlayback");
