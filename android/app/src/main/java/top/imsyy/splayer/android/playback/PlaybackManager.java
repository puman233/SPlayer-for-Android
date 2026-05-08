package top.imsyy.splayer.android.playback;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import android.view.KeyEvent;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import com.getcapacitor.JSObject;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import top.imsyy.splayer.android.MainActivity;
import top.imsyy.splayer.android.R;

@UnstableApi
public final class PlaybackManager {
  private static final String TAG = "PlaybackManager";
  private static final String NOTIFICATION_ICON_FONT_ASSET = "iconfont_notification.ttf";
  private static final String ICON_GLYPH_LYRIC = "\ue600";
  private static final String ICON_GLYPH_FAVORITE_FILLED = "\ue601";
  private static final String ICON_GLYPH_FAVORITE_OUTLINE = "\ue60a";
  private static final String ICON_GLYPH_PREVIOUS = "\ue63c";
  private static final String ICON_GLYPH_PLAY = "\ue63d";
  private static final String ICON_GLYPH_NEXT = "\ue63e";
  private static final String ICON_GLYPH_PAUSE = "\ue65f";
  private static final int FAVORITE_REQUEST_MAX_ATTEMPTS = 3;
  private static final long FAVORITE_REQUEST_RETRY_DELAY_MS = 350L;
  private static final long SEEK_STATE_GRACE_MS = 4000L;
  private static final long SEEK_POSITION_TOLERANCE_MS = 1500L;
  private static volatile PlaybackManager instance;

  private final Context appContext;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
  private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

  private ExoPlayer player;
  /** 暴露给 MediaSession 的包装 Player：覆写 availableCommands，让系统媒体面板始终展示上一/下一首。 */
  private Player sessionPlayer;
  private MediaSession mediaSession;
  private PlaybackService service;
  private AndroidNativePlaybackPlugin plugin;
  private Bitmap coverBitmap;
  /** 封面 JPEG 编码缓存，仅在 coverBitmap 变化时重压。 */
  private byte[] coverArtworkBytes;
  private Typeface notificationIconTypeface;

  private String currentSource = "";
  private String apiBaseUrl = "";
  private String cookie = "";
  private TrackMetadata currentMetadata = new TrackMetadata();
  private TrackMetadata queuedNextMetadata = null;
  private String queuedNextSource = "";

  private boolean controllerEnabled = true;
  private boolean desktopLyricButtonEnabled = false;
  private boolean desktopLyricEnabled = false;
  /** 允许与其他应用同时播放（关闭时才请求音频焦点，抢占其他应用） */
  private boolean allowMixWithOthers = true;
  private boolean canSkipPrevious = true;
  private boolean personalFmMode = false;
  private boolean repeatOneEnabled = false;
  private boolean liked = false;
  private boolean collapsed = false;
  private boolean favoriteRequestInFlight = false;
  private long pendingSeekPositionMs = C.TIME_UNSET;
  private long pendingSeekDeadlineMs = 0L;
  private long lastKnownPositionMs = 0L;
  /** NEXT 快路径锁：防止 native 快切与 JS autoNext 双线抢跑。 */
  private boolean pendingNativeNextSync = false;
  /** 快路径锁超时释放 Runnable。 */
  private final Runnable pendingNativeNextSyncTimeoutRunnable =
      () -> {
        if (pendingNativeNextSync) {
          android.util.Log.w(
              TAG,
              "pendingNativeNextSync timeout (5s without updateQueueContext), force release");
          pendingNativeNextSync = false;
        }
      };
  private static final long PENDING_NATIVE_NEXT_SYNC_TIMEOUT_MS = 5_000L;
  /** 已用 ExoPlayer 真实 duration 校准过的 source URL。 */
  private String durationCalibratedForSource = "";
  /** 悬浮歌词服务实例（运行时绑定） */
  private FloatingLyricService floatingLyricService;
  /** 远程状态同步：JS 端 AudioElementPlayer 驱动播放时，通知栏状态由此控制 */
  private boolean remoteMode = false;
  private boolean remoteIsPlaying = false;
  private long remotePositionMs = 0L;
  private long remoteDurationMs = 0L;
  /** Remote mode 下保持 CPU 唤醒，防止后台音频中断 */
  private PowerManager.WakeLock remoteWakeLock;
  private final SessionCommand nextSessionCommand =
      new SessionCommand(PlaybackConstants.ACTION_NEXT, Bundle.EMPTY);
  private final SessionCommand previousSessionCommand =
      new SessionCommand(PlaybackConstants.ACTION_PREVIOUS, Bundle.EMPTY);
  private final SessionCommand favoriteSessionCommand =
      new SessionCommand(PlaybackConstants.ACTION_FAVORITE, Bundle.EMPTY);
  private final SessionCommand desktopLyricSessionCommand =
      new SessionCommand(PlaybackConstants.ACTION_DESKTOP_LYRIC, Bundle.EMPTY);
  private final MediaSession.Callback mediaSessionCallback =
      new MediaSession.Callback() {
        @Override
        public MediaSession.ConnectionResult onConnect(
            MediaSession session, MediaSession.ControllerInfo controller) {
          return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
              .setAvailableSessionCommands(buildAvailableSessionCommands())
              .setAvailablePlayerCommands(buildAvailablePlayerCommands())
              .setCustomLayout(buildCustomLayout())
              .setMediaButtonPreferences(buildMediaButtonPreferences())
              .setSessionActivity(buildContentIntent())
              .build();
        }

        @Override
        public int onPlayerCommandRequest(
            MediaSession session, MediaSession.ControllerInfo controller, int playerCommand) {
          switch (playerCommand) {
            case Player.COMMAND_SEEK_TO_NEXT:
            case Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM:
              // 转发到 JS；返回 SKIPPED 避免控制器缓存 NOT_SUPPORTED 状态误判后续点击。
              handleSessionAction(PlaybackConstants.ACTION_NEXT);
              return SessionResult.RESULT_INFO_SKIPPED;
            case Player.COMMAND_SEEK_TO_PREVIOUS:
            case Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM:
              // 与 NEXT 对齐：无条件转发到 JS，由 JS 自行判断边界（personalFM/列表首尾等）。
              // 不在 native 端做条件检查 + 返回 NOT_SUPPORTED——某些 Media3 控制器（系统媒体面板/
              // 锁屏）会缓存 NOT_SUPPORTED 状态，导致后续 setAvailableCommands 重新声明可用后
              // 按钮点击仍不发命令，直到控制器重连（切歌单等场景）才解锁。
              handleSessionAction(PlaybackConstants.ACTION_PREVIOUS);
              return SessionResult.RESULT_INFO_SKIPPED;
            default:
              return MediaSession.Callback.super.onPlayerCommandRequest(
                  session, controller, playerCommand);
          }
        }

        @Override
        public ListenableFuture<SessionResult> onCustomCommand(
            MediaSession session,
            MediaSession.ControllerInfo controller,
            SessionCommand customCommand,
            Bundle args) {
          return Futures.immediateFuture(handleCustomCommand(customCommand));
        }

        @Override
        public boolean onMediaButtonEvent(
            MediaSession session, MediaSession.ControllerInfo controller, Intent intent) {
          KeyEvent keyEvent = extractKeyEvent(intent);
          if (keyEvent == null || keyEvent.getAction() != KeyEvent.ACTION_DOWN) {
            return false;
          }

          switch (keyEvent.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_NEXT:
              return handleSessionAction(PlaybackConstants.ACTION_NEXT);
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
              return handleSessionAction(PlaybackConstants.ACTION_PREVIOUS);
            case KeyEvent.KEYCODE_MEDIA_PLAY:
              play();
              return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
              pause();
              return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
              handleNotificationAction(PlaybackConstants.ACTION_TOGGLE_PLAYBACK);
              return true;
            default:
              return false;
          }
        }
      };

  private final Runnable progressRunnable =
      new Runnable() {
        @Override
        public void run() {
          emitProgressChanged();

          if (player != null && player.getCurrentMediaItem() != null) {
            mainHandler.postDelayed(this, 1000L);
          }
        }
      };

  private PlaybackManager(Context context) {
    this.appContext = context.getApplicationContext();
  }

  public static PlaybackManager getInstance(Context context) {
    if (instance == null) {
      synchronized (PlaybackManager.class) {
        if (instance == null) {
          instance = new PlaybackManager(context);
        }
      }
    }
    return instance;
  }

  public synchronized void attachService(PlaybackService playbackService) {
    service = playbackService;
    ensureInitialized();
    updateNotification();
  }

  public synchronized void detachService(PlaybackService playbackService) {
    if (service == playbackService) {
      service = null;
    }
  }

  public synchronized void attachPlugin(AndroidNativePlaybackPlugin playbackPlugin) {
    plugin = playbackPlugin;
    emitPlaybackState(true);
  }

  public synchronized void detachPlugin(AndroidNativePlaybackPlugin playbackPlugin) {
    if (plugin == playbackPlugin) {
      plugin = null;
    }
  }

  public synchronized MediaSession getSession() {
    ensureInitialized();
    return mediaSession;
  }

  public synchronized JSObject load(String url, long positionMs, boolean autoPlay) {
    Log.d(TAG, "load: url=" + url + " positionMs=" + positionMs + " autoPlay=" + autoPlay);
    ensureInitialized();
    ensureServiceRunning();

    // ExoPlayer 直接驱动播放，退出 remote mode（JS 驱动模式）
    remoteMode = false;
    currentSource = url == null ? "" : url;
    currentMetadata.url = currentSource;
    clearPendingSeek();
    lastKnownPositionMs = 0L;

    // 参考 SPlayer-ROM-Compat：先 setMediaItem + prepare，再 seekTo，最后 playWhenReady
    // 不用 setMediaItem(item, startPositionMs) ——某些 ROM/容器格式下 startPositionMs
    // 在 IDLE→prepare 转换中可能被丢弃，导致实际从 0 开始播放（UI 显示 seek 位置但音频从头放）
    player.setMediaItem(buildMediaItem(currentSource));
    player.prepare();
    durationCalibratedForSource = "";
    if (positionMs > 0) {
      player.seekTo(positionMs);
      beginPendingSeek(positionMs);
    }
    player.setPlayWhenReady(autoPlay);
    updateNotification();
    emitPlaybackState(true);
    return buildState();
  }

  public synchronized JSObject play() {
    ensureInitialized();
    ensureServiceRunning();
    player.play();
    updateNotification();
    emitPlaybackState(true);
    return buildState();
  }

  public synchronized JSObject pause() {
    ensureInitialized();
    player.pause();
    updateNotification();
    emitPlaybackState(true);
    return buildState();
  }

  public synchronized JSObject stop() {
    ensureInitialized();
    // 软停止：不清 MediaItem / 通知栏，留给下一次 load() 无缝替换，避免切歌瞬间闪烁。
    // 进程级清理走 cleanup() / onDestroy。
    player.pause();
    player.seekTo(0L);
    clearPendingSeek();
    lastKnownPositionMs = 0L;
    stopProgressUpdates();
    emitPlaybackState(true);
    return buildState();
  }

  /** 硬清理：清播放列表 / 登入登出等场景，清空 MediaItem、通知栏、queuedNext 及快路径锁。 */
  public synchronized JSObject cleanup() {
    ensureInitialized();
    player.pause();
    player.seekTo(0L);
    player.stop();
    player.clearMediaItems();
    currentSource = "";
    clearPendingSeek();
    lastKnownPositionMs = 0L;
    queuedNextSource = "";
    queuedNextMetadata = null;
    pendingNativeNextSync = false;
    mainHandler.removeCallbacks(pendingNativeNextSyncTimeoutRunnable);
    durationCalibratedForSource = "";
    stopProgressUpdates();
    clearNotification();
    emitPlaybackState(true);
    return buildState();
  }

  public synchronized JSObject seek(long positionMs) {
    ensureInitialized();
    long safePositionMs = Math.max(0L, positionMs);
    beginPendingSeek(safePositionMs);
    remoteMode = false;

    if (player.getCurrentMediaItem() == null
        || currentSource == null
        || currentSource.isEmpty()
        || player.getPlaybackState() == Player.STATE_IDLE) {
      boolean wasPlaying = player.getPlayWhenReady();
      player.setMediaItem(buildMediaItem(currentSource), safePositionMs);
      player.prepare();
      player.setPlayWhenReady(wasPlaying);
    } else {
      player.seekTo(safePositionMs);
    }

    updateNotification();
    emitPlaybackState(true);
    return buildState();
  }

  public synchronized void setVolume(float volume) {
    ensureInitialized();
    player.setVolume(Math.max(0f, Math.min(1f, volume)));
    emitPlaybackState(false);
    updateNotification();
  }

  public synchronized void setRate(float rate) {
    ensureInitialized();
    player.setPlaybackSpeed(Math.max(0.25f, Math.min(3f, rate)));
    emitPlaybackState(false);
    updateNotification();
  }

  public synchronized void updateMetadata(TrackMetadata metadata) {
    currentMetadata = metadata == null ? new TrackMetadata() : metadata;
    loadCoverBitmapAsync(currentMetadata.coverUrl);
    // 把最新元信息推回 ExoPlayer 当前 MediaItem，让锁屏 / 系统媒体面板同步刷新
    refreshCurrentMediaItemMetadata();
    updateMediaSessionButtons();
    updateNotification();
    emitPlaybackState(true);
  }

  public synchronized void updateQueueContext(
      boolean likedState,
      boolean canSkipPreviousState,
      boolean personalFmModeState,
      boolean controllerEnabledState,
      boolean desktopLyricButtonEnabledState,
      boolean desktopLyricEnabledState,
      boolean repeatOneState,
      @Nullable TrackMetadata nextTrack) {
    liked = likedState;
    currentMetadata.liked = likedState;
    canSkipPrevious = canSkipPreviousState;
    personalFmMode = personalFmModeState;
    controllerEnabled = controllerEnabledState;
    desktopLyricButtonEnabled = desktopLyricButtonEnabledState;
    desktopLyricEnabled = desktopLyricEnabledState;
    repeatOneEnabled = repeatOneState;
    queuedNextMetadata = nextTrack == null ? null : nextTrack.copy();
    queuedNextSource =
        queuedNextMetadata == null || queuedNextMetadata.url == null ? "" : queuedNextMetadata.url;
    // JS 端通过 updateQueueContext 推送新的 next 表明已经感知并处理了上一次的 autoNext，
    // 此时清除快路径锁，让后续 ACTION_NEXT 重新可以走 native 直切。
    pendingNativeNextSync = false;
    mainHandler.removeCallbacks(pendingNativeNextSyncTimeoutRunnable);
    updateMediaSessionButtons();
    updateNotification();
    emitPlaybackState(false);
  }

  /** 安排快路径锁超时释放，重复调用会重置计时。 */
  private void schedulePendingNativeNextSyncTimeout() {
    mainHandler.removeCallbacks(pendingNativeNextSyncTimeoutRunnable);
    mainHandler.postDelayed(
        pendingNativeNextSyncTimeoutRunnable, PENDING_NATIVE_NEXT_SYNC_TIMEOUT_MS);
  }

  public synchronized void updateNotificationPrefs(
      boolean controllerEnabledState, boolean desktopLyricButtonEnabledState) {
    controllerEnabled = controllerEnabledState;
    desktopLyricButtonEnabled = desktopLyricButtonEnabledState;
    updateMediaSessionButtons();
    updateNotification();
  }

  /**
   * 设置是否允许与其他应用同时播放。
   * true：不请求音频焦点，允许与其他应用混音；
   * false：由 ExoPlayer 独占音频焦点，开始播放会暂停其他应用。
   */
  public synchronized void setAllowMixWithOthers(boolean allow) {
    allowMixWithOthers = allow;
    if (player != null) {
      player.setAudioAttributes(
          new AudioAttributes.Builder()
              .setUsage(C.USAGE_MEDIA)
              .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
              .build(),
          !allowMixWithOthers);
    }
  }

  public synchronized void syncApiContext(String baseUrl, String cookieValue) {
    apiBaseUrl = baseUrl == null ? "" : baseUrl.trim();
    cookie = cookieValue == null ? "" : cookieValue.trim();
  }

  /**
   * 远程状态同步：JS 端 AudioElementPlayer 驱动播放时，
   * 由 JS 主动推送播放状态，通知栏据此显示。
   */
  public synchronized void syncRemoteState(boolean playing, long positionMs, long durationMs) {
    ensureInitialized();
    ensureServiceRunning();
    remoteMode = true;
    remoteIsPlaying = playing;
    remotePositionMs = Math.max(0L, positionMs);
    remoteDurationMs = Math.max(0L, durationMs);
    updateRemoteWakeLock();
    updateNotification();
  }

  /** 通知栏应该显示"正在播放"还是"已暂停" */
  private boolean isEffectivelyPlaying() {
    if (remoteMode) return remoteIsPlaying;
    return player != null && player.isPlaying();
  }

  /** 通知栏应该显示"正在缓冲"吗 */
  private boolean isEffectivelyBuffering() {
    if (remoteMode) return false;
    return player != null && player.getPlaybackState() == Player.STATE_BUFFERING;
  }

  /** 在 remote mode 播放时持有 WakeLock，暂停/停止时释放 */
  private void updateRemoteWakeLock() {
    if (remoteMode && remoteIsPlaying) {
      if (remoteWakeLock == null) {
        PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
        remoteWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SPlayer::RemoteAudio");
        remoteWakeLock.setReferenceCounted(false);
      }
      if (!remoteWakeLock.isHeld()) {
        remoteWakeLock.acquire(4 * 60 * 60 * 1000L); // 最长 4 小时
      }
    } else {
      if (remoteWakeLock != null && remoteWakeLock.isHeld()) {
        remoteWakeLock.release();
      }
    }
  }

  public synchronized JSObject buildState() {
    ensureInitialized();

    JSObject state = new JSObject();
    state.put("src", currentSource);
    state.put("songId", currentMetadata.songId);
    state.put("paused", !player.getPlayWhenReady() || !player.isPlaying());
    state.put("ready", player.getPlaybackState() == Player.STATE_READY);
    state.put("playing", player.isPlaying());
    state.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
    state.put("durationMs", getDurationMs());
    state.put("positionMs", getPositionMs());
    state.put("volume", player.getVolume());
    state.put("playbackRate", player.getPlaybackParameters().speed);
    state.put("errorCode", 0);
    return state;
  }

  public synchronized void handleNotificationAction(String action) {
    if (action == null) {
      return;
    }

    switch (action) {
      case PlaybackConstants.ACTION_TOGGLE_PLAYBACK:
        if (remoteMode) {
          // remote 模式下转发给 JS 处理
          emitCustomAction(
              remoteIsPlaying ? "pause" : "play",
              null, null, null, null, true, null);
        } else {
          if (player == null) {
            return;
          }
          if (player.isPlaying()) {
            pause();
          } else {
            play();
          }
        }
        break;
      case PlaybackConstants.ACTION_NEXT:
        // 后台时 WebView 可能被冻结、JS 响应不及；有预载则 native 直接切歌 + emit autoNext，
        // 其余场景（personalFM、快路径锁中、无预载）回落到 emit next 由 JS 处理。
        if (!personalFmMode
            && !pendingNativeNextSync
            && queuedNextSource != null
            && !queuedNextSource.isEmpty()
            && queuedNextMetadata != null) {
          TrackMetadata nextMetadata = queuedNextMetadata;
          boolean nextLiked = nextMetadata.liked;
          int nextSongId = nextMetadata.songId;
          startTrackFromState(queuedNextSource, nextMetadata, nextLiked, true);
          queuedNextMetadata = null;
          queuedNextSource = "";
          pendingNativeNextSync = true;
          emitCustomAction("autoNext", nextSongId, nextLiked, null, null, true, null);
          // 5s 超时兜底：防 JS 异常路径不调 updateQueueContext 导致锁永久卡住。
          schedulePendingNativeNextSyncTimeout();
        } else {
          emitCustomAction("next", null, null, null, null, true, null);
        }
        break;
      case PlaybackConstants.ACTION_PREVIOUS:
        // 边界（personalFM、列表为空、playIndex 越界）全交给 JS 的 nextOrPrev("prev")。
        emitCustomAction("previous", null, null, null, null, true, null);
        break;
      case PlaybackConstants.ACTION_FAVORITE:
        toggleFavoriteAsync();
        break;
      case PlaybackConstants.ACTION_DESKTOP_LYRIC:
        desktopLyricEnabled = !desktopLyricEnabled;
        // 直接控制悬浮歌词服务
        if (desktopLyricEnabled) {
          showFloatingLyric();
        } else {
          hideFloatingLyric();
        }
        updateMediaSessionButtons();
        updateNotification();
        emitCustomAction("desktopLyric", null, null, desktopLyricEnabled, null, true, null);
        break;
      case PlaybackConstants.ACTION_COLLAPSE:
        collapsed = !collapsed;
        updateNotification();
        emitCustomAction("collapse", null, null, null, collapsed, true, null);
        break;
      default:
        break;
    }
  }

  private boolean handleSessionAction(String action) {
    if (action == null) {
      return false;
    }

    switch (action) {
      case PlaybackConstants.ACTION_NEXT:
        handleNotificationAction(action);
        return true;
      case PlaybackConstants.ACTION_PREVIOUS:
        // 不返 NOT_SUPPORTED：控制器会缓存该状态导致后续点击哑火。
        handleNotificationAction(action);
        return true;
      case PlaybackConstants.ACTION_FAVORITE:
        if (!currentMetadata.canLike) {
          return false;
        }
        handleNotificationAction(action);
        return true;
      case PlaybackConstants.ACTION_DESKTOP_LYRIC:
        if (!desktopLyricButtonEnabled) {
          return false;
        }
        handleNotificationAction(action);
        return true;
      default:
        return false;
    }
  }

  private SessionResult handleCustomCommand(SessionCommand customCommand) {
    if (customCommand == null || customCommand.customAction == null) {
      return new SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED);
    }

    return handleSessionAction(customCommand.customAction)
        ? new SessionResult(SessionResult.RESULT_SUCCESS)
        : new SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED);
  }

  private synchronized void ensureInitialized() {
    if (player != null && mediaSession != null) {
      return;
    }

    createNotificationChannel();

    player = new ExoPlayer.Builder(appContext)
        .setMediaSourceFactory(
            new DefaultMediaSourceFactory(
                appContext,
                new DefaultExtractorsFactory()
                    .setConstantBitrateSeekingEnabled(true)
                    .setConstantBitrateSeekingAlwaysEnabled(true)))
        .build();
    player.setAudioAttributes(
        new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(),
        !allowMixWithOthers);
    player.setHandleAudioBecomingNoisy(true);
    player.addListener(
        new Player.Listener() {
          @Override
          public void onPlaybackStateChanged(int playbackState) {
            if (playbackState == Player.STATE_ENDED) {
              stopProgressUpdates();
              if (handleAutoAdvanceOnEnded()) {
                return;
              }
              emitEnded();
            } else if (playbackState == Player.STATE_READY || playbackState == Player.STATE_BUFFERING) {
              startProgressUpdates();
              if (playbackState == Player.STATE_READY) {
                calibrateDurationFromPlayer();
              }
            }

            updateNotification();
            emitPlaybackState(true);
          }

          @Override
          public void onIsPlayingChanged(boolean isPlaying) {
            if (isPlaying) {
              startProgressUpdates();
            }
            updateNotification();
            emitPlaybackState(true);
          }

          @Override
          public void onPositionDiscontinuity(
              Player.PositionInfo oldPosition,
              Player.PositionInfo newPosition,
              int reason) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK
                || reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
                || reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) {
              // authoritative：seek/外部拖拽。TS 端需据此强制刷新估算基准。
              emitProgressChanged(Math.max(0L, newPosition.positionMs), true, true);
              updateNotification();
              emitPlaybackState(true);
            }
          }

          @Override
          public void onPlayerError(PlaybackException error) {
            emitError(error.errorCode, error.getMessage());
            updateNotification();
          }
        });

    sessionPlayer =
        new ForwardingPlayer(player) {
          @Override
          public Player.Commands getAvailableCommands() {
            // 强声明 PREV/NEXT 可用，避免 ExoPlayer 队列只有 1 项时按钮被置灰。
            return new Player.Commands.Builder()
                .addAll(super.getAvailableCommands())
                .add(Player.COMMAND_SEEK_TO_NEXT)
                .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build();
          }

          @Override
          public boolean isCommandAvailable(int command) {
            return getAvailableCommands().contains(command);
          }

          // 系统媒体面板/锁屏的 PREV/NEXT 点击会直接调这几个方法，底层 1 项队列会全部 no-op；
          // 在这里劫持后转发到 JS 是唯一能确保按钮可点的位置。
          // 防呆：native 内部勿调 sessionPlayer.seekTo{Next,Previous}*，会被劫持成 emit 而不推进队列；
          // 需主动切曲请用 startTrackFromState() / handleSessionAction()。
          @Override
          public void seekToPrevious() {
            handleSessionAction(PlaybackConstants.ACTION_PREVIOUS);
          }

          @Override
          public void seekToPreviousMediaItem() {
            handleSessionAction(PlaybackConstants.ACTION_PREVIOUS);
          }

          @Override
          public void seekToNext() {
            handleSessionAction(PlaybackConstants.ACTION_NEXT);
          }

          @Override
          public void seekToNextMediaItem() {
            handleSessionAction(PlaybackConstants.ACTION_NEXT);
          }
        };

    mediaSession =
        new MediaSession.Builder(appContext, sessionPlayer)
            .setSessionActivity(buildContentIntent())
            .setCallback(mediaSessionCallback)
            .setCustomLayout(buildCustomLayout())
            .setMediaButtonPreferences(buildMediaButtonPreferences())
            .setPeriodicPositionUpdateEnabled(true)
            .build();
    updateMediaSessionButtons();
    coverBitmap = BitmapFactory.decodeResource(appContext.getResources(), R.mipmap.ic_launcher);
    coverArtworkBytes = encodeArtworkBytes(coverBitmap);
  }

  /** 用 ExoPlayer 真实 duration 校准 metadata；同一 source 只走一次，偏差 ≤ 500ms 跳过。 */
  private void calibrateDurationFromPlayer() {
    if (player == null) {
      return;
    }
    if (currentSource == null || currentSource.isEmpty()) {
      return;
    }
    if (currentSource.equals(durationCalibratedForSource)) {
      return;
    }
    long realDurationMs = player.getDuration();
    if (realDurationMs == C.TIME_UNSET || realDurationMs <= 0L) {
      return;
    }
    durationCalibratedForSource = currentSource;
    if (Math.abs(realDurationMs - currentMetadata.durationMs) <= 500L) {
      return;
    }
    currentMetadata.durationMs = realDurationMs;
    refreshCurrentMediaItemMetadata();
  }

  /** Bitmap → JPEG@90 byte[]，用作 MediaMetadata.artworkData。 */
  @Nullable
  private byte[] encodeArtworkBytes(@Nullable Bitmap bitmap) {
    if (bitmap == null) {
      return null;
    }
    try {
      ByteArrayOutputStream baos = new ByteArrayOutputStream();
      if (bitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos)) {
        return baos.toByteArray();
      }
    } catch (Exception e) {
      Log.w(TAG, "encodeArtworkBytes failed", e);
    }
    return null;
  }

  private void ensureServiceRunning() {
    Intent intent = new Intent(appContext, PlaybackService.class);
    ContextCompat.startForegroundService(appContext, intent);
  }

  private MediaItem buildMediaItem(String url) {
    MediaItem.Builder builder = new MediaItem.Builder();
    if (url != null && !url.isEmpty()) {
      builder.setUri(Uri.parse(url));
    }
    builder.setMediaMetadata(buildMediaMetadata());
    return builder.build();
  }

  private MediaMetadata buildMediaMetadata() {
    MediaMetadata.Builder builder = new MediaMetadata.Builder();

    if (currentMetadata.title != null) {
      builder.setTitle(currentMetadata.title);
    }
    if (currentMetadata.artist != null) {
      builder.setArtist(currentMetadata.artist);
    }
    if (currentMetadata.album != null) {
      builder.setAlbumTitle(currentMetadata.album);
    }
    if (currentMetadata.durationMs > 0) {
      builder.setDurationMs(currentMetadata.durationMs);
    }
    if (currentMetadata.coverUrl != null
        && !currentMetadata.coverUrl.isEmpty()
        && !currentMetadata.coverUrl.startsWith("blob:")) {
      try {
        builder.setArtworkUri(Uri.parse(currentMetadata.coverUrl));
      } catch (Exception ignored) {
      }
    }
    // artworkData 覆盖 blob:/网络不可达场景，蓝牙 AVRCP / Auto 必需这个才有封面。
    if (coverArtworkBytes != null) {
      builder.setArtworkData(coverArtworkBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER);
    }

    return builder.build();
  }

  /** 不重 prepare、不打断播放地把 metadata 同步到当前 MediaItem。 */
  private void refreshCurrentMediaItemMetadata() {
    if (player == null) {
      return;
    }
    MediaItem current = player.getCurrentMediaItem();
    if (current == null) {
      return;
    }
    try {
      MediaItem updated = current.buildUpon().setMediaMetadata(buildMediaMetadata()).build();
      int index = player.getCurrentMediaItemIndex();
      if (index >= 0 && index < player.getMediaItemCount()) {
        player.replaceMediaItem(index, updated);
      }
    } catch (Exception e) {
      Log.w(TAG, "refreshCurrentMediaItemMetadata failed", e);
    }
  }

  private boolean handleAutoAdvanceOnEnded() {
    if (repeatOneEnabled && currentSource != null && !currentSource.isEmpty()) {
      startTrackFromState(currentSource, currentMetadata, liked, false);
      return true;
    }

    if (queuedNextSource == null || queuedNextSource.isEmpty() || queuedNextMetadata == null) {
      return false;
    }

    TrackMetadata nextMetadata = queuedNextMetadata;
    boolean nextLiked = nextMetadata.liked;
    startTrackFromState(queuedNextSource, nextMetadata, nextLiked, true);
    queuedNextMetadata = null;
    queuedNextSource = "";
    emitCustomAction("autoNext", nextMetadata.songId, nextLiked, null, null, true, null);
    return true;
  }

  private void startTrackFromState(
      String source, TrackMetadata metadata, boolean likedState, boolean emitProgressImmediately) {
    if (player == null) {
      return;
    }

    currentSource = source == null ? "" : source;
    currentMetadata = metadata == null ? new TrackMetadata() : metadata.copy();
    liked = likedState;
    clearPendingSeek();
    lastKnownPositionMs = 0L;
    durationCalibratedForSource = "";
    player.setMediaItem(buildMediaItem(currentSource));
    player.prepare();
    player.seekTo(0L);
    player.play();
    loadCoverBitmapAsync(currentMetadata.coverUrl);
    updateMediaSessionButtons();
    updateNotification();
    // 注意：先 emitPlaybackState 再 emitProgressChanged。
    // gapless 切歌时 TS 引擎要先从 playbackStateChanged.src 检测到换轨并重置内部 _currentTime/lastTimeSyncAt，
    // 否则 progressChanged 触发的 timeupdate 会用旧基准估算出错误位置（进度条直接跳到末尾）。
    emitPlaybackState(true);
    if (emitProgressImmediately) {
      emitProgressChanged();
    }
  }

  private SessionCommands buildAvailableSessionCommands() {
    // PREV 不随 personalFM 屏蔽：FM 下 prev 交由 JS 走 initPersonalFM，语义一致。
    SessionCommands.Builder builder =
        new SessionCommands.Builder().add(nextSessionCommand).add(previousSessionCommand);

    if (currentMetadata.canLike) {
      builder.add(favoriteSessionCommand);
    }
    if (desktopLyricButtonEnabled) {
      builder.add(desktopLyricSessionCommand);
    }

    return builder.build();
  }

  private Player.Commands buildAvailablePlayerCommands() {
    Player.Commands.Builder builder =
        new Player.Commands.Builder().addAll(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS);
    builder.add(Player.COMMAND_SEEK_TO_NEXT);
    builder.add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM);
    builder.add(Player.COMMAND_SEEK_TO_PREVIOUS);
    builder.add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM);

    return builder.build();
  }

  private List<CommandButton> buildCustomLayout() {
    return buildMediaButtonPreferences();
  }

  private List<CommandButton> buildMediaButtonPreferences() {
    List<CommandButton> buttons = new ArrayList<>();
    if (!controllerEnabled) {
      return buttons;
    }

    if (currentMetadata.canLike) {
      buttons.add(
          new CommandButton.Builder(
                  liked ? CommandButton.ICON_HEART_FILLED : CommandButton.ICON_HEART_UNFILLED)
              .setSessionCommand(favoriteSessionCommand)
              .setDisplayName(appContext.getString(R.string.playback_notification_favorite))
              .setSlots(CommandButton.SLOT_BACK_SECONDARY, CommandButton.SLOT_OVERFLOW)
              .build());
    }

    buttons.add(
        new CommandButton.Builder(CommandButton.ICON_PREVIOUS)
            .setSessionCommand(previousSessionCommand)
            .setDisplayName(appContext.getString(R.string.playback_notification_previous))
            .setSlots(CommandButton.SLOT_BACK)
            .build());

    buttons.add(
        new CommandButton.Builder(CommandButton.ICON_NEXT)
            .setSessionCommand(nextSessionCommand)
            .setDisplayName(appContext.getString(R.string.playback_notification_next))
            .setSlots(CommandButton.SLOT_FORWARD)
            .build());

    if (desktopLyricButtonEnabled) {
      buttons.add(
          new CommandButton.Builder(CommandButton.ICON_SUBTITLES)
              .setSessionCommand(desktopLyricSessionCommand)
              .setDisplayName(appContext.getString(R.string.playback_notification_desktop_lyric))
              .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
              .build());
    }

    return buttons;
  }

  private void updateMediaSessionButtons() {
    if (mediaSession == null) {
      return;
    }

    List<CommandButton> customLayout = buildCustomLayout();
    List<CommandButton> mediaButtonPreferences = buildMediaButtonPreferences();
    SessionCommands sessionCommands = buildAvailableSessionCommands();

    mediaSession.setCustomLayout(customLayout);
    mediaSession.setMediaButtonPreferences(mediaButtonPreferences);
    for (MediaSession.ControllerInfo controller : mediaSession.getConnectedControllers()) {
      mediaSession.setAvailableCommands(
          controller, sessionCommands, buildAvailablePlayerCommands());
    }
  }

  private void updateNotification() {
    if (service == null || player == null) {
      return;
    }

    if (!remoteMode && player.getCurrentMediaItem() == null && currentSource.isEmpty()) {
      clearNotification();
      return;
    }
    if (remoteMode && currentMetadata.title.isEmpty() && currentSource.isEmpty()) {
      clearNotification();
      return;
    }

    Notification notification = buildNotification();
    try {
      if (isEffectivelyPlaying() || isEffectivelyBuffering()) {
        service.startForeground(PlaybackConstants.NOTIFICATION_ID, notification);
      } else {
        service.stopForeground(false);
        NotificationManagerCompat.from(appContext)
            .notify(PlaybackConstants.NOTIFICATION_ID, notification);
      }
    } catch (SecurityException error) {
      Log.w(TAG, "Failed to show playback notification", error);
    }
  }

  private Notification buildNotification() {
    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(appContext, PlaybackConstants.CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(buildContentIntent())
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(isEffectivelyPlaying() || isEffectivelyBuffering())
            .setContentTitle(safeText(currentMetadata.title, appContext.getString(R.string.app_name)))
            .setContentText(safeText(currentMetadata.artist, ""))
            .setLargeIcon(coverBitmap);

    if (!controllerEnabled) {
      return builder.build();
    }

    int actionCount = 0;
    int playPauseActionIndex = 0;
    int nextActionIndex = 0;
    int previousActionIndex = 0;

    if (currentMetadata.canLike) {
      builder.addAction(buildNotificationAction(
          liked ? ICON_GLYPH_FAVORITE_FILLED : ICON_GLYPH_FAVORITE_OUTLINE,
          liked ? android.R.drawable.btn_star_big_on : android.R.drawable.btn_star_big_off,
          appContext.getString(R.string.playback_notification_favorite),
          PlaybackConstants.ACTION_FAVORITE));
      actionCount++;
    }

    previousActionIndex = actionCount;
    builder.addAction(buildNotificationAction(
        ICON_GLYPH_PREVIOUS,
        android.R.drawable.ic_media_previous,
        appContext.getString(R.string.playback_notification_previous),
        PlaybackConstants.ACTION_PREVIOUS));
    actionCount++;

    playPauseActionIndex = actionCount;
    boolean effectivelyPlaying = isEffectivelyPlaying();
    builder.addAction(buildNotificationAction(
        effectivelyPlaying ? ICON_GLYPH_PAUSE : ICON_GLYPH_PLAY,
        effectivelyPlaying
            ? android.R.drawable.ic_media_pause
            : android.R.drawable.ic_media_play,
        appContext.getString(R.string.playback_notification_play_pause),
        PlaybackConstants.ACTION_TOGGLE_PLAYBACK));
    actionCount++;

    nextActionIndex = actionCount;
    builder.addAction(buildNotificationAction(
        ICON_GLYPH_NEXT,
        android.R.drawable.ic_media_next,
        appContext.getString(R.string.playback_notification_next),
        PlaybackConstants.ACTION_NEXT));
    actionCount++;

    if (desktopLyricButtonEnabled) {
      builder.addAction(buildNotificationAction(
          ICON_GLYPH_LYRIC,
          desktopLyricEnabled
              ? android.R.drawable.presence_audio_online
              : android.R.drawable.presence_audio_busy,
          appContext.getString(R.string.playback_notification_desktop_lyric),
          PlaybackConstants.ACTION_DESKTOP_LYRIC));
      actionCount++;
    }

    int[] compactActionIndices =
        new int[] {previousActionIndex, playPauseActionIndex, nextActionIndex};

    builder.setStyle(
        new androidx.media.app.NotificationCompat.MediaStyle()
            .setShowActionsInCompactView(compactActionIndices)
            .setMediaSession(
                android.support.v4.media.session.MediaSessionCompat.Token.fromToken(
                    mediaSession.getPlatformToken())));

    return builder.build();
  }

  private NotificationCompat.Action buildNotificationAction(
      @Nullable String glyph, int fallbackIconResId, CharSequence title, String action) {
    PendingIntent pendingIntent = buildActionPendingIntent(action);
    Bitmap iconBitmap = glyph == null ? null : renderNotificationGlyph(glyph);
    if (iconBitmap != null) {
      return new NotificationCompat.Action.Builder(
              IconCompat.createWithBitmap(iconBitmap), title, pendingIntent)
          .build();
    }

    return new NotificationCompat.Action.Builder(fallbackIconResId, title, pendingIntent).build();
  }

  @Nullable
  private Bitmap renderNotificationGlyph(String glyph) {
    Typeface typeface = getNotificationIconTypeface();
    if (typeface == null) {
      return null;
    }

    float density = appContext.getResources().getDisplayMetrics().density;
    int bitmapSize = Math.max(48, Math.round(24f * density));
    float textSize = bitmapSize * 0.78f;

    Bitmap bitmap = Bitmap.createBitmap(bitmapSize, bitmapSize, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    paint.setColor(Color.WHITE);
    paint.setTypeface(typeface);
    paint.setTextAlign(Paint.Align.CENTER);
    paint.setTextSize(textSize);

    Paint.FontMetrics fontMetrics = paint.getFontMetrics();
    float baseline = (bitmapSize - fontMetrics.ascent - fontMetrics.descent) / 2f;
    canvas.drawText(glyph, bitmapSize / 2f, baseline, paint);
    return bitmap;
  }

  @Nullable
  private synchronized Typeface getNotificationIconTypeface() {
    if (notificationIconTypeface != null) {
      return notificationIconTypeface;
    }

    try {
      notificationIconTypeface =
          Typeface.createFromAsset(appContext.getAssets(), NOTIFICATION_ICON_FONT_ASSET);
      return notificationIconTypeface;
    } catch (Exception error) {
      Log.w(TAG, "Failed to load notification icon font", error);
      return null;
    }
  }

  private PendingIntent buildContentIntent() {
    Intent intent = new Intent(appContext, MainActivity.class);
    intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return PendingIntent.getActivity(
        appContext, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
  }

  private PendingIntent buildActionPendingIntent(String action) {
    Intent intent = new Intent(appContext, PlaybackActionReceiver.class);
    intent.setAction(action);
    return PendingIntent.getBroadcast(
        appContext,
        action.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
  }

  private int immutableFlag() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
  }

  @Nullable
  private KeyEvent extractKeyEvent(Intent intent) {
    if (intent == null) {
      return null;
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class);
    }

    Object value = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
    return value instanceof KeyEvent ? (KeyEvent) value : null;
  }

  private synchronized void clearNotification() {
    stopProgressUpdates();

    if (service != null) {
      try {
        service.stopForeground(true);
      } catch (Exception error) {
        Log.w(TAG, "Failed to stop foreground playback service", error);
      }
    }

    NotificationManagerCompat.from(appContext).cancel(PlaybackConstants.NOTIFICATION_ID);
  }

  private void createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }

    NotificationChannel channel =
        new NotificationChannel(
            PlaybackConstants.CHANNEL_ID,
            appContext.getString(R.string.playback_notification_channel_name),
            NotificationManager.IMPORTANCE_LOW);
    channel.setDescription(appContext.getString(R.string.playback_notification_channel_description));

    NotificationManager notificationManager =
        ContextCompat.getSystemService(appContext, NotificationManager.class);
    if (notificationManager != null) {
      notificationManager.createNotificationChannel(channel);
    }
  }

  private void startProgressUpdates() {
    mainHandler.removeCallbacks(progressRunnable);
    mainHandler.post(progressRunnable);
  }

  private void stopProgressUpdates() {
    mainHandler.removeCallbacks(progressRunnable);
  }

  private void emitPlaybackState(boolean retain) {
    AndroidNativePlaybackPlugin currentPlugin = plugin;
    if (currentPlugin != null) {
      currentPlugin.emitEvent("playbackStateChanged", buildState(), retain);
    }
  }

  private void emitProgressChanged() {
    emitProgressChanged(getPositionMs());
  }

  private void emitProgressChanged(long positionMs) {
    emitProgressChanged(positionMs, true, false);
  }

  /** authoritative=true 表示权威 seek，TS 端需据此刷新估算基准；false 是周期轮询。 */
  private void emitProgressChanged(
      long positionMs, boolean acknowledgePendingSeek, boolean authoritative) {
    AndroidNativePlaybackPlugin currentPlugin = plugin;
    long safePositionMs = Math.max(0L, positionMs);
    if (acknowledgePendingSeek) {
      rememberReportedPosition(safePositionMs);
    } else {
      lastKnownPositionMs = safePositionMs;
    }
    if (currentPlugin == null) {
      return;
    }

    JSObject payload = new JSObject();
    payload.put("durationMs", getDurationMs());
    payload.put("positionMs", safePositionMs);
    if (authoritative) {
      payload.put("authoritative", true);
    }
    currentPlugin.emitEvent("progressChanged", payload, true);
  }

  private void emitEnded() {
    AndroidNativePlaybackPlugin currentPlugin = plugin;
    if (currentPlugin == null) {
      return;
    }

    JSObject payload = new JSObject();
    payload.put("durationMs", getDurationMs());
    currentPlugin.emitEvent("ended", payload, true);
  }

  private void emitError(int errorCode, @Nullable String message) {
    AndroidNativePlaybackPlugin currentPlugin = plugin;
    if (currentPlugin == null) {
      return;
    }

    JSObject payload = new JSObject();
    payload.put("errorCode", errorCode);
    if (message != null) {
      payload.put("message", message);
    }
    currentPlugin.emitEvent("error", payload, true);
  }

  private void emitCustomAction(
      String action,
      @Nullable Integer songId,
      @Nullable Boolean likedState,
      @Nullable Boolean desktopLyricEnabledState,
      @Nullable Boolean collapsedState,
      boolean success,
      @Nullable String message) {
    AndroidNativePlaybackPlugin currentPlugin = plugin;
    if (currentPlugin == null) {
      return;
    }

    JSObject payload = new JSObject();
    payload.put("action", action);
    payload.put("success", success);
    if (songId != null) {
      payload.put("songId", songId);
    }
    if (likedState != null) {
      payload.put("liked", likedState);
    }
    if (desktopLyricEnabledState != null) {
      payload.put("desktopLyricEnabled", desktopLyricEnabledState);
    }
    if (collapsedState != null) {
      payload.put("collapsed", collapsedState);
    }
    if (message != null) {
      payload.put("message", message);
    }
    currentPlugin.emitEvent("customAction", payload, true);
  }

  private void loadCoverBitmapAsync(String coverUrl) {
    if (coverUrl == null || coverUrl.isEmpty() || coverUrl.startsWith("blob:")) {
      coverBitmap = BitmapFactory.decodeResource(appContext.getResources(), R.mipmap.ic_launcher);
      coverArtworkBytes = encodeArtworkBytes(coverBitmap);
      updateNotification();
      return;
    }

    artworkExecutor.execute(
        () -> {
          Bitmap bitmap = null;
          InputStream inputStream = null;
          HttpURLConnection connection = null;

          try {
            if (coverUrl.startsWith("http://") || coverUrl.startsWith("https://")) {
              connection = (HttpURLConnection) new URL(coverUrl).openConnection();
              connection.setConnectTimeout(8000);
              connection.setReadTimeout(8000);
              connection.setDoInput(true);
              connection.connect();
              inputStream = connection.getInputStream();
              bitmap = BitmapFactory.decodeStream(inputStream);
            } else if (coverUrl.startsWith("file://")) {
              bitmap = BitmapFactory.decodeFile(Uri.parse(coverUrl).getPath());
            }
          } catch (Exception error) {
            Log.w(TAG, "Failed to load cover art", error);
          } finally {
            try {
              if (inputStream != null) {
                inputStream.close();
              }
            } catch (Exception ignored) {
            }
            if (connection != null) {
              connection.disconnect();
            }
          }

          final Bitmap resolvedBitmap =
              bitmap != null
                  ? bitmap
                  : BitmapFactory.decodeResource(appContext.getResources(), R.mipmap.ic_launcher);

          // JPEG 编码在后台线程完成，避免主线程卡帧。
          final byte[] encodedBytes = encodeArtworkBytes(resolvedBitmap);
          mainHandler.post(
              () -> {
                coverBitmap = resolvedBitmap;
                coverArtworkBytes = encodedBytes;
                refreshCurrentMediaItemMetadata();
                updateNotification();
              });
        });
  }

  private void toggleFavoriteAsync() {
    if (!currentMetadata.canLike || currentMetadata.songId <= 0) {
      emitCustomAction("favorite", currentMetadata.songId, liked, null, null, false, "favorite_unavailable");
      return;
    }

    if (apiBaseUrl.isEmpty() || cookie.isEmpty()) {
      emitCustomAction("favorite", currentMetadata.songId, liked, null, null, false, "login_required");
      return;
    }

    final boolean targetLike = !liked;
    final int songId = currentMetadata.songId;
    synchronized (this) {
      if (favoriteRequestInFlight) {
        emitCustomAction("favorite", songId, liked, null, null, false, "favorite_busy");
        return;
      }
      favoriteRequestInFlight = true;
    }

    networkExecutor.execute(
        () -> {
          FavoriteRequestResult requestResult = performFavoriteRequest(songId, targetLike);
          mainHandler.post(
              () -> {
                favoriteRequestInFlight = false;
                if (requestResult.success) {
                  liked = targetLike;
                  currentMetadata.liked = targetLike;
                  updateMediaSessionButtons();
                  updateNotification();
                }

                emitCustomAction(
                    "favorite",
                    songId,
                    requestResult.success ? targetLike : liked,
                    null,
                    null,
                    requestResult.success,
                    requestResult.message);
              });
        });
  }

  private FavoriteRequestResult performFavoriteRequest(int songId, boolean targetLike) {
    String likeEndpoint = apiBaseUrl.endsWith("/like") ? apiBaseUrl : apiBaseUrl + "/like";

    for (int attempt = 1; attempt <= FAVORITE_REQUEST_MAX_ATTEMPTS; attempt++) {
      HttpURLConnection connection = null;
      try {
        String encodedCookie = URLEncoder.encode(cookie, StandardCharsets.UTF_8.name());
        String separator = likeEndpoint.contains("?") ? "&" : "?";
        String urlString =
            likeEndpoint
                + separator
                + "id="
                + songId
                + "&like="
                + targetLike
                + "&timestamp="
                + System.currentTimeMillis()
                + "&cookie="
                + encodedCookie;

        connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", cookie);
        connection.connect();

        int httpCode = connection.getResponseCode();
        InputStream inputStream = httpCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String response = readStream(inputStream);
        int businessCode = parseBusinessCode(response);

        if (httpCode == 200 && businessCode == 200) {
          return FavoriteRequestResult.success();
        }

        if (businessCode == 301 || businessCode == 401 || response.contains("需要登录")) {
          return FavoriteRequestResult.failure("login_required");
        }

        if (attempt >= FAVORITE_REQUEST_MAX_ATTEMPTS || !shouldRetryFavoriteRequest(httpCode, businessCode)) {
          Log.w(
              TAG,
              "Favorite request failed, httpCode="
                  + httpCode
                  + ", businessCode="
                  + businessCode
                  + ", response="
                  + response);
          return FavoriteRequestResult.failure("favorite_failed");
        }
      } catch (Exception error) {
        Log.w(TAG, "Failed to toggle song favorite, attempt=" + attempt, error);
        if (attempt >= FAVORITE_REQUEST_MAX_ATTEMPTS) {
          return FavoriteRequestResult.failure("favorite_failed");
        }
      } finally {
        if (connection != null) {
          connection.disconnect();
        }
      }

      try {
        Thread.sleep(FAVORITE_REQUEST_RETRY_DELAY_MS);
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
        return FavoriteRequestResult.failure("favorite_failed");
      }
    }

    return FavoriteRequestResult.failure("favorite_failed");
  }

  private int parseBusinessCode(String response) {
    if (response == null || response.isEmpty()) {
      return -1;
    }

    try {
      return new JSONObject(response).optInt("code", -1);
    } catch (Exception error) {
      Log.w(TAG, "Failed to parse favorite response", error);
      return -1;
    }
  }

  private boolean shouldRetryFavoriteRequest(int httpCode, int businessCode) {
    if (httpCode >= 500) {
      return true;
    }
    return httpCode == 0 || httpCode == 408 || httpCode == 429 || businessCode == -1;
  }

  private String readStream(@Nullable InputStream inputStream) throws Exception {
    if (inputStream == null) {
      return "";
    }

    BufferedReader reader =
        new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
    StringBuilder builder = new StringBuilder();
    String line;

    while ((line = reader.readLine()) != null) {
      builder.append(line);
    }

    reader.close();
    return builder.toString();
  }

  private long getDurationMs() {
    if (player == null) {
      return currentMetadata.durationMs;
    }
    long duration = player.getDuration();
    if (duration > 0) {
      return duration;
    }
    return Math.max(0L, currentMetadata.durationMs);
  }

  private long getPositionMs() {
    if (player == null) {
      return Math.max(0L, lastKnownPositionMs);
    }

    long playerPositionMs = Math.max(0L, player.getCurrentPosition());
    if (pendingSeekPositionMs != C.TIME_UNSET) {
      long now = System.currentTimeMillis();
      if (now > pendingSeekDeadlineMs) {
        clearPendingSeek();
      } else if (playerPositionMs + 250L < pendingSeekPositionMs) {
        return Math.max(0L, lastKnownPositionMs);
      }
      // 位置已到达 seek 目标，更新 lastKnownPositionMs 但不清除 pendingSeek
      // 只让 deadline 自然过期，防止后续异步回调携带旧位置覆盖
    }

    lastKnownPositionMs = playerPositionMs;
    return playerPositionMs;
  }

  private void beginPendingSeek(long positionMs) {
    pendingSeekPositionMs = Math.max(0L, positionMs);
    pendingSeekDeadlineMs = System.currentTimeMillis() + SEEK_STATE_GRACE_MS;
    lastKnownPositionMs = pendingSeekPositionMs;
  }

  private void clearPendingSeek() {
    pendingSeekPositionMs = C.TIME_UNSET;
    pendingSeekDeadlineMs = 0L;
  }

  private void rememberReportedPosition(long positionMs) {
    long safePositionMs = Math.max(0L, positionMs);

    if (pendingSeekPositionMs != C.TIME_UNSET) {
      long now = System.currentTimeMillis();
      if (now > pendingSeekDeadlineMs) {
        clearPendingSeek();
      } else if (safePositionMs + 250L < pendingSeekPositionMs) {
        return;
      }
    }

    lastKnownPositionMs = safePositionMs;
  }

  private String formatTime(long timeMs) {
    long totalSeconds = Math.max(0L, timeMs / 1000L);
    long minutes = totalSeconds / 60L;
    long seconds = totalSeconds % 60L;
    return String.format("%d:%02d", minutes, seconds);
  }

  private String safeText(@Nullable String value, String fallback) {
    return value == null || value.trim().isEmpty() ? fallback : value;
  }

  // ========== 悬浮歌词 API ==========

  // 缓冲区：服务未就绪时暂存数据，就绪后回放
  private String bufferedLrcJson = null, bufferedYrcJson = null;
  private String bufferedSongName = null, bufferedArtist = null;
  private long bufferedTimeMs = 0;
  private boolean bufferedPlaying = false;
  private JSONObject bufferedLyricConfig = null;

  /** 开启悬浮歌词服务 */
  public synchronized void showFloatingLyric() {
    Intent intent = new Intent(appContext, FloatingLyricService.class);
    appContext.startService(intent);
  }

  /** 关闭悬浮歌词服务 */
  public synchronized void hideFloatingLyric() {
    floatingLyricService = null;
    bufferedLrcJson = null;
    bufferedYrcJson = null;
    Intent intent = new Intent(appContext, FloatingLyricService.class);
    appContext.stopService(intent);
  }

  /** 服务启动时注册——立即回放缓冲数据 */
  public synchronized void attachFloatingLyricService(FloatingLyricService service) {
    floatingLyricService = service;
    // 先应用配置再推数据
    if (bufferedLyricConfig != null) {
      service.applyConfig(bufferedLyricConfig);
    }
    // 回放缓冲数据
    if (bufferedLrcJson != null || bufferedYrcJson != null) {
      service.pushLyrics(bufferedLrcJson, bufferedYrcJson);
    }
    if (bufferedSongName != null) {
      service.pushSongInfo(bufferedSongName, bufferedArtist);
    }
    service.pushProgress(bufferedTimeMs, bufferedPlaying);
  }

  public synchronized void detachFloatingLyricService(FloatingLyricService service) {
    if (floatingLyricService == service) floatingLyricService = null;
  }

  /** 推送歌词——有服务直推，没服务先缓冲 */
  public synchronized void updateFloatingLyricData(String lrcJson, String yrcJson) {
    bufferedLrcJson = lrcJson;
    bufferedYrcJson = yrcJson;
    if (floatingLyricService != null) floatingLyricService.pushLyrics(lrcJson, yrcJson);
  }

  /** 推送进度 */
  public synchronized void updateFloatingLyricProgress(long timeMs, boolean playing) {
    bufferedTimeMs = timeMs;
    bufferedPlaying = playing;
    if (floatingLyricService != null) floatingLyricService.pushProgress(timeMs, playing);
  }

  /** 推送歌曲信息 */
  public synchronized void updateFloatingLyricSongInfo(String name, String artist) {
    bufferedSongName = name;
    bufferedArtist = artist;
    if (floatingLyricService != null) floatingLyricService.pushSongInfo(name, artist);
  }

  /** 推送桌面歌词配置（颜色、字号、字重、遮罩等） */
  public synchronized void updateFloatingLyricConfig(JSONObject config) {
    bufferedLyricConfig = config;
    if (floatingLyricService != null) floatingLyricService.applyConfig(config);
  }

  public synchronized boolean isFloatingLyricRunning() {
    return floatingLyricService != null;
  }

  /** 悬浮歌词被用户在窗口内关闭 */
  public void emitDesktopLyricClosed() {
    desktopLyricEnabled = false;
    updateMediaSessionButtons();
    updateNotification();
    emitCustomAction("desktopLyric", null, null, false, null, true, null);
  }

  /** 设置悬浮歌词锁定 */
  public synchronized void setFloatingLyricLocked(boolean locked) {
    if (floatingLyricService != null) floatingLyricService.setLocked(locked);
  }

  static final class TrackMetadata {
    int songId;
    long durationMs;
    boolean canLike;
    boolean liked;
    String title = "";
    String artist = "";
    String album = "";
    String coverUrl = "";
    String url = "";

    TrackMetadata copy() {
      TrackMetadata copy = new TrackMetadata();
      copy.songId = songId;
      copy.durationMs = durationMs;
      copy.canLike = canLike;
      copy.liked = liked;
      copy.title = title;
      copy.artist = artist;
      copy.album = album;
      copy.coverUrl = coverUrl;
      copy.url = url;
      return copy;
    }
  }

  private static final class FavoriteRequestResult {
    final boolean success;
    final String message;

    private FavoriteRequestResult(boolean success, @Nullable String message) {
      this.success = success;
      this.message = message;
    }

    static FavoriteRequestResult success() {
      return new FavoriteRequestResult(true, null);
    }

    static FavoriteRequestResult failure(String message) {
      return new FavoriteRequestResult(false, message);
    }
  }
}
