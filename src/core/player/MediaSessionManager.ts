import { likeSong } from "@/api/song";
import { useMusicStore, useSettingStore, useStatusStore } from "@/stores";
import { getCookie } from "@/utils/cookie";
import { EMBEDDED_API_BASE_URL } from "@/utils/embeddedApi";
import { isCapacitorAndroid, isElectron } from "@/utils/env";
import { getPlaySongData } from "@/utils/format";
import { AI_AUDIO_LEVELS } from "@/utils/meta";
import { msToS } from "@/utils/time";
import type { SystemMediaEvent } from "@emi";
import { throttle } from "lodash-es";
import {
  AndroidNativePlayback,
  type AndroidNativeCustomActionEvent,
} from "@/plugins/androidNativePlayback";
import type { PluginListenerHandle } from "@capacitor/core";
import { usePlayerController } from "./PlayerController";
import { useAudioManager } from "./AudioManager";
import {
  enableDiscordRpc,
  sendMediaMetadata,
  sendMediaPlayMode,
  sendMediaPlayState,
  sendMediaPlaybackRate,
  sendMediaVolume,
  sendMediaTimeline,
  updateDiscordConfig,
} from "./PlayerIpc";

const normalizeAndroidSongLevel = (level: string, disableAiAudio: boolean): string => {
  if (disableAiAudio && AI_AUDIO_LEVELS.includes(level)) return "hires";
  return level;
};

class MediaSessionManager {
  private metadataAbortController: AbortController | null = null;
  private currentRate: number = 1;
  private androidCustomActionListener: PluginListenerHandle | null = null;

  private throttledSendTimeline = throttle((currentTime: number, duration: number) => {
    sendMediaTimeline(currentTime, duration);
  }, 200);

  private throttledSyncAndroidRemoteState = throttle(
    (playing: boolean, positionMs: number, durationMs: number) => {
      void AndroidNativePlayback.syncRemoteState({ playing, positionMs, durationMs });
    },
    1000,
  );

  private throttledUpdatePositionState = throttle((duration: number, position: number) => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setPositionState({
        duration: msToS(duration),
        position: msToS(position),
        playbackRate: this.currentRate,
      });
    }
  }, 1000);

  private shouldUseNativeMedia(): boolean {
    return isElectron || isCapacitorAndroid;
  }

  private handleMediaEvent(
    event: SystemMediaEvent,
    player: ReturnType<typeof usePlayerController>,
  ) {
    switch (event.type) {
      case "Play":
        player.play();
        break;
      case "Pause":
        player.pause();
        sendMediaPlayState("Paused");
        break;
      case "Stop":
        player.pause();
        player.setSeek(0);
        sendMediaPlayState("Paused");
        break;
      case "NextSong":
        player.nextOrPrev("next");
        break;
      case "PreviousSong":
        player.nextOrPrev("prev");
        break;
      case "Seek":
        if (event.positionMs != null) {
          player.setSeek(event.positionMs);
        }
        break;
      case "ToggleShuffle":
        player.toggleShuffle();
        break;
      case "ToggleRepeat":
        player.toggleRepeat();
        break;
      case "SetRate":
        if (event.rate != null) {
          player.setRate(event.rate);
        }
        break;
      case "SetVolume":
        if (event.volume != null) {
          player.setVolume(event.volume);
        }
        break;
    }
  }

  private async bindAndroidMediaEvents(player: ReturnType<typeof usePlayerController>) {
    if (this.androidCustomActionListener) {
      return;
    }

    this.androidCustomActionListener = await AndroidNativePlayback.addListener(
      "customAction",
      (event: AndroidNativeCustomActionEvent) => {
        switch (event.action) {
          case "next":
            void player.nextOrPrev("next");
            break;
          case "previous":
            void player.nextOrPrev("prev");
            break;
          case "play":
            void player.play();
            break;
          case "pause":
            void player.pause();
            break;
          case "favorite": {
            if (event.success === false) {
              if (event.message === "login_required") {
                window.$message.warning("璇峰厛鐧诲綍鍚庡啀鏀惰棌姝屾洸");
              } else if (
                typeof event.songId === "number" &&
                typeof event.liked === "boolean" &&
                event.message !== "favorite_unavailable" &&
                event.message !== "favorite_busy"
              ) {
                void this.retryFavoriteThroughWebApi(player, event.songId, !event.liked);
              } else {
                window.$message.error("鏀惰棌鎿嶄綔澶辫触锛岃閲嶈瘯");
              }
              break;
            }
            const targetSongId =
              typeof event.songId === "number"
                ? event.songId
                : typeof getPlaySongData()?.id === "number"
                  ? getPlaySongData()!.id
                  : undefined;
            if (typeof event.liked === "boolean" && typeof targetSongId === "number") {
              player.applySongLikeState(targetSongId, event.liked);
            }
            break;
          }
          case "desktopLyric":
            if (typeof event.desktopLyricEnabled === "boolean") {
              player.setDesktopLyricShow(event.desktopLyricEnabled);
            } else {
              player.toggleDesktopLyric();
            }
            break;
          case "collapse":
            break;
          case "autoNext":
            // 旧路径兼容：新队列走 trackChanged
            if (typeof event.songId === "number") {
              void player.applyNativeAutoNext(event.songId, event.liked);
            }
            break;
          case "trackChanged":
            // Java 切歌通知：用 playListIndex 直接定位
            if (typeof event.playListIndex === "number" && event.playListIndex >= 0) {
              void player.applyNativeTrackChanged(
                event.playListIndex,
                typeof event.songId === "number" ? event.songId : undefined,
                event.liked,
                event.source,
              );
            }
            break;
          case "requestUrls":
            // 窗口耗尽：补 prefetch 后重推窗口
            void player.refreshAndroidQueueWindow();
            break;
        }
      },
    );
  }

  private async retryFavoriteThroughWebApi(
    player: ReturnType<typeof usePlayerController>,
    songId: number,
    targetLike: boolean,
  ) {
    try {
      await likeSong(songId, targetLike);
      player.applySongLikeState(songId, targetLike);
      await player.syncAndroidPlaybackContext();
    } catch (error) {
      console.error("[AndroidMedia] favorite fallback failed:", error);
      window.$message.error("鏀惰棌鎿嶄綔澶辫触锛岃閲嶈瘯");
    }
  }

  /**
   * 切歌时 PlayerController.syncAndroidPlaybackContext 与 MediaSessionManager.updateMetadata
   * 都会调一次 syncApiContext，参数完全一致。Java 端幂等，但 IPC 跨 JNI 仍要 30-150ms。
   * 这里用 lastKey 去重：参数无变化直接 resolve，避免主线程上重复 await。
   */
  private lastSyncedApiContextKey: string | null = null;
  /**
   * 并发去重：相同 key 的 IPC 正在跑时，后续调用复用同一 Promise；
   * lastSyncedApiContextKey 只在 await 后赋值，不能拦住「同时进入 await」的并发。
   * 详见 fix#4：避免切歌瞬间 2-3 处并行调用都打穿到 Java 端。
   */
  private pendingSyncApiContextKey: string | null = null;
  private pendingSyncApiContextPromise: Promise<void> | null = null;

  public async syncAndroidApiContext(force: boolean = false) {
    if (!isCapacitorAndroid) return;

    const settingStore = useSettingStore();
    const musicCookie = getCookie("MUSIC_U");
    const cookie = musicCookie ? `MUSIC_U=${musicCookie};os=pc;` : "";
    const songLevel = normalizeAndroidSongLevel(
      settingStore.songLevel,
      settingStore.disableAiAudio,
    );
    const key = `${EMBEDDED_API_BASE_URL}|${cookie}|${songLevel}|${settingStore.disableAiAudio}`;
    if (!force && this.lastSyncedApiContextKey === key) return;
    // 并发去重：同 key 已有 IPC 在跑直接复用 Promise；force 时强制新发起
    if (!force && this.pendingSyncApiContextKey === key && this.pendingSyncApiContextPromise) {
      return this.pendingSyncApiContextPromise;
    }

    const jobRef: { current: Promise<void> | null } = { current: null };
    const job = (async () => {
      try {
        await AndroidNativePlayback.syncApiContext({
          apiBaseUrl: EMBEDDED_API_BASE_URL,
          cookie,
          songLevel,
          disableAiAudio: settingStore.disableAiAudio,
        });
        this.lastSyncedApiContextKey = key;
      } finally {
        // 仅当 pending 还是本任务时才清；force 重入场景下可能已被新 job 覆盖
        if (this.pendingSyncApiContextPromise === jobRef.current) {
          this.pendingSyncApiContextKey = null;
          this.pendingSyncApiContextPromise = null;
        }
      }
    })();
    jobRef.current = job;
    this.pendingSyncApiContextKey = key;
    this.pendingSyncApiContextPromise = job;
    return job;
  }

  /** 用户登录登出 / 切换音质后调用，清空 dedup 强制下次同步。 */
  public invalidateSyncedApiContext() {
    this.lastSyncedApiContextKey = null;
    // 不清 pending：让正在跑的 IPC 完成后自然清理；下次调用 key 不同会自然 force
  }

  public init() {
    const settingStore = useSettingStore();
    const player = usePlayerController();
    const statusStore = useStatusStore();

    this.currentRate = statusStore.playRate;

    if (isCapacitorAndroid) {
      void this.bindAndroidMediaEvents(player);
      void this.syncAndroidApiContext();
      return;
    }

    if (!settingStore.smtcOpen) return;

    if (isElectron) {
      window.electron.ipcRenderer.removeAllListeners("media-event");
      window.electron.ipcRenderer.on("media-event", (_, event) => {
        this.handleMediaEvent(event as SystemMediaEvent, player);
      });

      const shuffle = statusStore.shuffleMode !== "off";
      const repeat =
        statusStore.repeatMode === "list"
          ? "List"
          : statusStore.repeatMode === "one"
            ? "Track"
            : "None";
      sendMediaPlayMode(shuffle, repeat);
      player.syncMediaPlayMode();
      sendMediaPlaybackRate(statusStore.playRate);

      if (settingStore.discordRpc.enabled) {
        enableDiscordRpc();
        updateDiscordConfig({
          showWhenPaused: settingStore.discordRpc.showWhenPaused,
          displayMode: settingStore.discordRpc.displayMode,
        });
      }

      return;
    }

    if ("mediaSession" in navigator) {
      const nav = navigator.mediaSession;
      nav.setActionHandler("play", () => player.play());
      nav.setActionHandler("pause", () => player.pause());
      nav.setActionHandler("previoustrack", () => player.nextOrPrev("prev"));
      nav.setActionHandler("nexttrack", () => player.nextOrPrev("next"));
      nav.setActionHandler("seekto", (e) => {
        if (e.seekTime) player.setSeek(e.seekTime * 1000);
      });
    }
  }

  public async updateMetadata() {
    if (!("mediaSession" in navigator) && !this.shouldUseNativeMedia()) return;

    const musicStore = useMusicStore();
    const settingStore = useSettingStore();
    const song = getPlaySongData();
    if (!song) return;

    if (this.metadataAbortController) {
      this.metadataAbortController.abort();
    }
    this.metadataAbortController = new AbortController();
    const { signal } = this.metadataAbortController;
    const metadata = this.buildMetadata(song);

    if (isCapacitorAndroid) {
      await this.syncAndroidApiContext();
      // 本地歌曲封面：JS 侧 metadata.coverUrl 已经被 Capacitor.convertFileSrc 转成
      // https://localhost/_capacitor_file_/...，原生 HttpURLConnection 拿不到自签证书。
      // 这里优先取 song.cover 的原始 file:// 路径交给 Java，Java 侧的 file:// 分支可直接 decodeFile。
      const rawCover = typeof song.cover === "string" ? song.cover : "";
      const nativeCoverUrl =
        song.path && (rawCover.startsWith("file://") || rawCover.startsWith("content://"))
          ? rawCover
          : metadata.coverUrl;
      await AndroidNativePlayback.updateMetadata({
        songId: typeof song.id === "number" ? song.id : undefined,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        coverUrl: nativeCoverUrl,
        durationMs: song.duration || 0,
        canLike: !song.path && song.type !== "streaming",
      });
      return;
    }

    if (this.shouldUseNativeMedia() && settingStore.smtcOpen) {
      try {
        let coverBuffer: Uint8Array | undefined;

        if (song.path && !metadata.coverUrl.startsWith("blob:")) {
          try {
            const coverData = (await window.electron.ipcRenderer.invoke(
              "get-music-cover",
              song.path,
            )) as { data?: ArrayLike<number> } | null;
            if (coverData?.data && !signal.aborted) {
              coverBuffer = new Uint8Array(coverData.data);
            }
          } catch {
            // ignore
          }
        } else if (
          metadata.coverUrl &&
          (metadata.coverUrl.startsWith("http") || metadata.coverUrl.startsWith("blob:"))
        ) {
          try {
            const resp = await fetch(metadata.coverUrl, { signal });
            coverBuffer = new Uint8Array(await resp.arrayBuffer());
          } catch {
            // ignore
          }
        }

        sendMediaMetadata({
          songName: metadata.title,
          authorName: metadata.artist,
          albumName: metadata.album,
          originalCoverUrl: metadata.coverUrl,
          coverData: coverBuffer as Buffer,
          duration: song.duration,
          ncmId: typeof song.id === "number" ? song.id : undefined,
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[Media] update metadata failed:", error);
        }
      } finally {
        if (this.metadataAbortController?.signal === signal) {
          this.metadataAbortController = null;
        }
      }
      return;
    }

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artwork: this.buildArtwork(musicStore),
      });
    }
  }

  private buildMetadata(song: ReturnType<typeof getPlaySongData>) {
    const isRadio = song!.type === "radio";
    const musicStore = useMusicStore();

    return {
      title: song!.name,
      artist: isRadio
        ? song!.dj?.creator || "鏈煡鎾"
        : Array.isArray(song!.artists)
          ? song!.artists.map((a) => a.name).join("/")
          : String(song!.artists),
      album: isRadio
        ? song!.dj?.name || "鏈煡鎾"
        : typeof song!.album === "object"
          ? song!.album.name
          : String(song!.album),
      coverUrl: musicStore.getSongCover("xl") || musicStore.playSong.cover || "",
    };
  }

  private buildArtwork(musicStore: ReturnType<typeof useMusicStore>) {
    return [
      {
        src: musicStore.getSongCover("s") || musicStore.playSong.cover || "",
        sizes: "100x100",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("m") || musicStore.playSong.cover || "",
        sizes: "300x300",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("cover") || musicStore.playSong.cover || "",
        sizes: "512x512",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("l") || musicStore.playSong.cover || "",
        sizes: "1024x1024",
        type: "image/jpeg",
      },
      {
        src: musicStore.getSongCover("xl") || musicStore.playSong.cover || "",
        sizes: "1920x1920",
        type: "image/jpeg",
      },
    ];
  }

  public updateState(duration: number, position: number, immediate: boolean = false) {
    const settingStore = useSettingStore();
    if (isCapacitorAndroid) {
      // 使用原生 ExoPlayer (AndroidNativeAudioPlayer) 时，ExoPlayer 会自动更新 MediaSession 位置，
      // 不再通过 syncRemoteState 覆盖为 remote mode。
      const engineType = useAudioManager().engineType;
      if (engineType !== "android-native") {
        // 秒 → ms（原生 API 统一 ms）
        this.throttledSyncAndroidRemoteState(
          true,
          Math.max(0, Math.round(position * 1000)),
          Math.max(0, Math.round(duration * 1000)),
        );
      }
      return;
    }
    if (!settingStore.smtcOpen) return;

    if (this.shouldUseNativeMedia()) {
      if (immediate) {
        this.throttledSendTimeline.cancel();
        sendMediaTimeline(position, duration, true);
      } else {
        this.throttledSendTimeline(position, duration);
      }
      return;
    }

    this.throttledUpdatePositionState(duration, position);
  }

  public updatePlaybackStatus(isPlaying: boolean) {
    if (isCapacitorAndroid) return;
    if (this.shouldUseNativeMedia()) {
      sendMediaPlayState(isPlaying ? "Playing" : "Paused");
    }
  }

  public updatePlaybackRate(rate: number) {
    this.currentRate = rate;

    if (isCapacitorAndroid) return;
    if (this.shouldUseNativeMedia()) {
      sendMediaPlaybackRate(rate);
    }
  }

  public updateVolume(volume: number) {
    if (isCapacitorAndroid) return;
    if (this.shouldUseNativeMedia()) {
      sendMediaVolume(volume);
    }
  }
}

export const mediaSessionManager = new MediaSessionManager();
