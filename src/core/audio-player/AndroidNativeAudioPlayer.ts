import { isCapacitorAndroid } from "@/utils/env";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  AndroidNativePlayback,
  type AndroidNativePlaybackState,
  type AndroidNativeEndedEvent,
  type AndroidNativeErrorEvent,
} from "@/plugins/androidNativePlayback";
import type {
  EngineCapabilities,
  FadeCurve,
  IPlaybackEngine,
  PauseOptions,
  PlayOptions,
} from "./IPlaybackEngine";
import { AUDIO_EVENTS } from "./BaseAudioPlayer";

/**
 * Android 原生播放器（参照 SPlayer-ROM-Compat 实现）
 *
 * 核心设计原则：
 * 1. **TS 全权拥有 currentTime**：用 performance.now() 插值估算，不接收原生周期性位置上报
 *    - 缓冲期 ExoPlayer 经常短暂上报 positionMs=0，强行更新会导致 UI 进度回退
 *    - 插值方案对短暂卡顿不敏感，且天然避免 seek-to-zero
 * 2. **load() 一次性传入 url+seek+autoPlay**：Java 端原子完成 setMediaItem+prepare+playWhenReady
 * 3. **fire-and-forget**：所有原生调用 `void`，不等待返回
 * 4. **state 事件只更新结构性字段**：src / duration / paused / error，不动 _currentTime
 * 5. **seek 完成后接受原生上报**：仅当 expectPlaying=false（暂停 seek）才从原生确认位置
 */
export class AndroidNativeAudioPlayer extends EventTarget implements IPlaybackEngine {
  public readonly capabilities: EngineCapabilities = {
    supportsRate: true,
    supportsSinkId: false,
    supportsEqualizer: false,
    supportsSpectrum: false,
  };

  private _src = "";
  private _duration = 0;
  private _currentTime = 0;
  private _paused = true;
  private _volume = 1;
  private _rate = 1;
  private _errorCode = 0;
  private _replayGain = 1;
  private isInitialized = false;
  private listenersBound = false;
  private listenerHandles: PluginListenerHandle[] = [];

  /** 上一次 _currentTime / lastTimeSyncAt 校准时刻 (performance.now()) */
  private lastTimeSyncAt = 0;

  /** ended 事件去重（3 秒内同一 src 只派发一次） */
  private static readonly ENDED_DEDUP_MS = 3000;
  private lastEndedEventAt = 0;
  private lastEndedSrc = "";

  public init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    if (!this.listenersBound && isCapacitorAndroid) {
      this.listenersBound = true;
      void this.bindNativeListeners();
    }
  }

  public destroy(): void {
    this.isInitialized = false;
    this.listenersBound = false;
    this._src = "";
    this._duration = 0;
    this._currentTime = 0;
    this._paused = true;
    this.lastTimeSyncAt = 0;
    this.lastEndedEventAt = 0;
    this.lastEndedSrc = "";
    void this.releaseListeners();
  }

  public async play(url?: string, options?: PlayOptions): Promise<void> {
    if (!this.isInitialized) this.init();
    const shouldPlay = options?.autoPlay ?? true;
    const seekSeconds = options?.seek && options.seek > 0 ? options.seek : 0;

    if (url) {
      // 乐观更新本地状态（UI 立即反映期望的 seek 位置）。
      // 注意：即使 shouldPlay=true，这里也强制 _paused=true，让 estimateCurrentTime() 冻结在 seekSeconds，
      // 避免 ExoPlayer 在 prep/buffer 阶段（实际未开播）TS 的估算时钟先于真实播放累加，
      // 等到首次 progressChanged 时进度条直接跳到一个非 0 的错误位置。
      // 真实开播由 Java 端 playbackStateChanged(paused=false) 触发 applyStructuralState 翻转 _paused 并重置 lastTimeSyncAt。
      this._src = url;
      this._currentTime = seekSeconds;
      this._duration = 0;
      this._paused = true;
      this._errorCode = 0;
      this.lastTimeSyncAt = performance.now();
      this.lastEndedEventAt = 0;
      this.lastEndedSrc = "";

      // 一次性把 url+positionMs+autoPlay 交给 Java，原子完成 prepare+seekTo+playWhenReady
      const positionMs = seekSeconds > 0 ? Math.round(seekSeconds * 1000) : 0;
      void AndroidNativePlayback.load({ url, positionMs, autoPlay: shouldPlay });

      this.dispatchEvent(new Event(AUDIO_EVENTS.LOAD_START));
      return;
    }

    // 无 URL：仅执行 seek 与/或 resume
    if (seekSeconds > 0) {
      this.seek(seekSeconds);
    }

    if (!shouldPlay || !this._paused) return;

    await this.resume(options);
  }

  public async resume(_options?: { fadeIn?: boolean; fadeDuration?: number }): Promise<void> {
    this._paused = false;
    this.lastTimeSyncAt = performance.now();
    void AndroidNativePlayback.play();
  }

  public pause(_options?: PauseOptions): void {
    // 暂停瞬间快照当前估算时间，作为新基准
    this._currentTime = this.estimateCurrentTime();
    this._paused = true;
    this.lastTimeSyncAt = performance.now();
    void AndroidNativePlayback.pause();
    this.dispatchEvent(new Event(AUDIO_EVENTS.PAUSE));
  }

  public stop(): void {
    this.lastTimeSyncAt = 0;
    this.lastEndedEventAt = 0;
    this.lastEndedSrc = "";
    this._paused = true;
    this._currentTime = 0;
    this._src = "";
    this._duration = 0;
    void AndroidNativePlayback.stop();
  }

  public seek(time: number): void {
    const safeTime = Math.max(0, time);

    this._currentTime = safeTime;
    this.lastTimeSyncAt = performance.now();

    this.dispatchEvent(new Event(AUDIO_EVENTS.SEEKING));
    void AndroidNativePlayback.seek({
      positionMs: Math.max(0, Math.round(safeTime * 1000)),
    });
    this.dispatchEvent(new Event(AUDIO_EVENTS.SEEKED));
  }

  public setVolume(value: number): void {
    this._volume = Math.max(0, Math.min(1, value));
    if (isCapacitorAndroid) {
      void AndroidNativePlayback.setVolume({ volume: this._volume });
    }
  }

  public getVolume(): number {
    return this._volume;
  }

  public setRate(rate: number): void {
    // 速率变化前先快照当前估算位置，防止后续插值把切换前的时间用新速率重算
    this._currentTime = this.estimateCurrentTime();
    this.lastTimeSyncAt = performance.now();
    this._rate = rate;
    if (isCapacitorAndroid) {
      void AndroidNativePlayback.setRate({ rate });
    }
  }

  public getRate(): number {
    return this._rate;
  }

  public setAudioDelayCompensation(_offset: number): void {}

  public async setSinkId(_deviceId: string): Promise<void> {}

  public setReplayGain(gain: number): void {
    this._replayGain = gain;
  }

  public getErrorCode(): number {
    return this._errorCode;
  }

  public get duration(): number {
    return this._duration;
  }

  public get currentTime(): number {
    return this.estimateCurrentTime();
  }

  public get paused(): boolean {
    return this._paused;
  }

  public get src(): string {
    return this._src;
  }

  /** 基于 _currentTime + (now - lastTimeSyncAt) * rate 估算当前播放位置 */
  private estimateCurrentTime(): number {
    if (this._paused || this.lastTimeSyncAt <= 0) return this._currentTime;
    const elapsed = ((performance.now() - this.lastTimeSyncAt) / 1000) * this._rate;
    const estimated = this._currentTime + Math.max(elapsed, 0);
    if (this._duration > 0) return Math.min(estimated, this._duration);
    return estimated;
  }

  // ========== 原生事件监听 ==========

  private async bindNativeListeners() {
    // playbackStateChanged: 只接受结构性字段，不动 currentTime
    this.listenerHandles.push(
      await AndroidNativePlayback.addListener("playbackStateChanged", (event) => {
        this.applyStructuralState(event);
      }),
    );

    // progressChanged: 同步 duration + 派发 timeupdate。
    // 常规轮询不更新 _currentTime（防缓冲期 0 假数据回退）；authoritative=true 时强制刷新基准。
    this.listenerHandles.push(
      await AndroidNativePlayback.addListener("progressChanged", (event) => {
        const nextDuration = Math.max(0, event.durationMs) / 1000;
        if (nextDuration > 0) this._duration = nextDuration;
        if (event.authoritative === true) {
          const safePositionSec = Math.max(0, event.positionMs) / 1000;
          this._currentTime = safePositionSec;
          this.lastTimeSyncAt = performance.now();
          this.dispatchEvent(new Event(AUDIO_EVENTS.SEEKING));
          this.dispatchEvent(new Event(AUDIO_EVENTS.SEEKED));
        }
        this.dispatchEvent(new Event(AUDIO_EVENTS.TIME_UPDATE));
      }),
    );

    this.listenerHandles.push(
      await AndroidNativePlayback.addListener("ended", (event: AndroidNativeEndedEvent) => {
        const now = performance.now();
        if (
          this._src &&
          this._src === this.lastEndedSrc &&
          now - this.lastEndedEventAt < AndroidNativeAudioPlayer.ENDED_DEDUP_MS
        ) {
          return;
        }
        this.lastEndedSrc = this._src;
        this.lastEndedEventAt = now;

        const endDuration = Math.max(0, event.durationMs) / 1000;
        if (endDuration > 0) this._duration = endDuration;
        this._currentTime = this._duration > 0 ? this._duration : this._currentTime;
        this._paused = true;
        this.lastTimeSyncAt = performance.now();
        this.dispatchEvent(new Event(AUDIO_EVENTS.TIME_UPDATE));
        this.dispatchEvent(new Event(AUDIO_EVENTS.ENDED));
      }),
    );

    this.listenerHandles.push(
      await AndroidNativePlayback.addListener("error", (event: AndroidNativeErrorEvent) => {
        this._errorCode = event.errorCode || 2;
        this.dispatchEvent(
          new CustomEvent(AUDIO_EVENTS.ERROR, {
            detail: { originalEvent: new Event("error"), errorCode: this._errorCode },
          }),
        );
      }),
    );
  }

  private async releaseListeners() {
    const handles = [...this.listenerHandles];
    this.listenerHandles = [];
    await Promise.allSettled(handles.map((handle) => handle.remove()));
  }

  /**
   * 从原生 playbackStateChanged 事件更新「结构性」状态。
   *
   * **不更新 _currentTime / lastTimeSyncAt**——位置由 TS 用 performance.now() 插值。
   * 只接受：src / durationMs / paused / playing / playbackRate / ready / errorCode。
   */
  private applyStructuralState(state: Partial<AndroidNativePlaybackState>) {
    if (typeof state.src === "string" && state.src) {
      // 检测 Java 端单方面换轨（gapless 预排队 handleAutoAdvanceOnEnded 走 customAction("autoNext") 路径，
      // 不会调 TS 的 play()/load()，所以 TS 引擎状态不会被重置）。
      // 若 src 和当前不同，把位置 / paused / duration / 估算时钟基准全部归零，
      // 防止 estimateCurrentTime 用旧 _currentTime + elapsed 算出错误进度，
      // 等同一事件后续把 paused=false 翻过来时进度条就从 0 起步。
      if (state.src !== this._src) {
        this._src = state.src;
        this._currentTime = 0;
        this._duration = 0;
        this._paused = true;
        this.lastTimeSyncAt = performance.now();
        this.lastEndedEventAt = 0;
        this.lastEndedSrc = "";
      } else {
        this._src = state.src;
      }
    }

    if (typeof state.durationMs === "number") {
      const nextDuration = Math.max(0, state.durationMs) / 1000;
      if (nextDuration > 0) this._duration = nextDuration;
    }

    // 处理 paused / playing 状态
    let nextPaused: boolean | null = null;
    if (typeof state.paused === "boolean") {
      nextPaused = state.paused;
    } else if (typeof state.playing === "boolean") {
      nextPaused = !state.playing;
    }

    if (nextPaused !== null) {
      const wasPaused = this._paused;
      if (wasPaused !== nextPaused) {
        if (nextPaused) {
          // 切换到暂停：快照当前估算时间作为新基准
          this._currentTime = this.estimateCurrentTime();
        }
        this._paused = nextPaused;
        this.lastTimeSyncAt = performance.now();
        this.dispatchEvent(new Event(nextPaused ? AUDIO_EVENTS.PAUSE : AUDIO_EVENTS.PLAY));
      }
    }

    if (typeof state.ready === "boolean" && state.ready) {
      this.dispatchEvent(new Event(AUDIO_EVENTS.CAN_PLAY));
    }

    if (typeof state.playbackRate === "number" && state.playbackRate > 0) {
      this._rate = state.playbackRate;
    }

    if (typeof state.errorCode === "number" && state.errorCode !== 0) {
      this._errorCode = state.errorCode;
    }
  }

  // 兼容 IPlaybackEngine 可选接口
  public rampVolumeTo(value: number, _duration: number, _curve?: FadeCurve): void {
    this.setVolume(value);
  }
}
