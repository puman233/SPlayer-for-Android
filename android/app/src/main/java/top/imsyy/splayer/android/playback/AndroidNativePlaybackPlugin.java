package top.imsyy.splayer.android.playback;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.preference.PreferenceManager;
import android.provider.Settings;
import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.json.JSONException;
import org.json.JSONObject;
import top.imsyy.splayer.android.MainActivity;
import top.imsyy.splayer.android.cache.AudioCacheProvider;

@CapacitorPlugin(
    name = "AndroidNativePlayback",
    permissions = {
      @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
    })
public class AndroidNativePlaybackPlugin extends Plugin {
  @Override
  public void load() {
    PlaybackManager.getInstance(getContext()).attachPlugin(this);
  }

  @Override
  protected void handleOnDestroy() {
    PlaybackManager.getInstance(getContext()).detachPlugin(this);
  }

  @PluginMethod
  public void load(PluginCall call) {
    String url = call.getString("url", "");
    // Capacitor 从 JS 传 number 时底层是 Double，getLong 取不到要用 getDouble 转 long
    long positionMs = (long) (double) call.getDouble("positionMs", 0.0);
    boolean autoPlay = call.getBoolean("autoPlay", false);
    android.util.Log.d("CapacitorBridge", "load: positionMs=" + positionMs + " autoPlay=" + autoPlay);
    resolveOnMainThread(
        call, () -> PlaybackManager.getInstance(getContext()).load(url, positionMs, autoPlay));
  }

  @PluginMethod
  public void play(PluginCall call) {
    android.util.Log.d("CapacitorBridge", "play called");
    resolveOnMainThread(call, () -> PlaybackManager.getInstance(getContext()).play());
  }

  @PluginMethod
  public void pause(PluginCall call) {
    resolveOnMainThread(call, () -> PlaybackManager.getInstance(getContext()).pause());
  }

  @PluginMethod
  public void stop(PluginCall call) {
    resolveOnMainThread(call, () -> PlaybackManager.getInstance(getContext()).stop());
  }

  @PluginMethod
  public void cleanup(PluginCall call) {
    resolveOnMainThread(call, () -> PlaybackManager.getInstance(getContext()).cleanup());
  }

  /** 用户确认退出：停服务 + finishAndRemoveTask + System.exit */
  @PluginMethod
  public void shutdownApp(PluginCall call) {
    Activity activity = getActivity();
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).shutdownAll();
          call.resolve();
          // 等桥消息送达 JS 后再退，给 100ms 余量
          new android.os.Handler(android.os.Looper.getMainLooper())
              .postDelayed(
                  () -> {
                    if (activity != null) {
                      try {
                        activity.finishAndRemoveTask();
                      } catch (Exception ignored) {
                      }
                    }
                    System.exit(0);
                  },
                  100L);
        });
  }

  @PluginMethod
  public void seek(PluginCall call) {
    // Capacitor 从 JS 传 number 时底层是 Double，getLong 会取不到默认返回 0L 导致 seek-to-zero
    long positionMs = (long) (double) call.getDouble("positionMs", 0.0);
    android.util.Log.d("CapacitorBridge", "seek: positionMs=" + positionMs);
    resolveOnMainThread(call, () -> PlaybackManager.getInstance(getContext()).seek(positionMs));
  }

  @PluginMethod
  public void setVolume(PluginCall call) {
    float volume = call.getFloat("volume", 1f);
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).setVolume(volume);
          call.resolve();
        });
  }

  @PluginMethod
  public void setRate(PluginCall call) {
    float rate = call.getFloat("rate", 1f);
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).setRate(rate);
          call.resolve();
        });
  }

  @PluginMethod
  public void updateMetadata(PluginCall call) {
    PlaybackManager.TrackMetadata metadata = new PlaybackManager.TrackMetadata();
    // long：上游 songId 可超 int32 上限，用 optLong 避免溢出
    metadata.songId = call.getData().optLong("songId", 0L);
    metadata.title = call.getString("title", "");
    metadata.artist = call.getString("artist", "");
    metadata.album = call.getString("album", "");
    metadata.coverUrl = call.getString("coverUrl", "");
    // 同 seek/load：JS number → Double，用 getDouble 避免 0
    metadata.durationMs = (long) (double) call.getDouble("durationMs", 0.0);
    metadata.canLike = call.getBoolean("canLike", false);
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).updateMetadata(metadata);
          call.resolve();
        });
  }

  @PluginMethod
  public void updateQueueContext(PluginCall call) {
    runOnMainThread(
        call,
        () -> {
          List<PlaybackQueue.Track> windowTracks = readWindowTracks(call);
          PlaybackManager.getInstance(getContext())
              .updateQueueContext(
                  call.getBoolean("liked", false),
                  call.getBoolean("canSkipPrevious", true),
                  call.getBoolean("personalFmMode", false),
                  call.getBoolean("controllerEnabled", true),
                  call.getBoolean("desktopLyricButtonEnabled", false),
                  call.getBoolean("desktopLyricEnabled", false),
                  windowTracks,
                  call.getInt("windowCurrentIndex", -1),
                  call.getString("repeatMode", "off"),
                  call.getBoolean("hasPreviousOutsideWindow", false),
                  call.getBoolean("hasNextOutsideWindow", false),
                  // windowRefilled：仅 refreshAndroidQueueWindow 路径置 true，
                  // Java 端据此区分本次推送是否为「补窗响应」，避免无关 sync（liked / 桌面歌词等）误触发续播。
                  call.getBoolean("windowRefilled", false),
                  // windowResetFromWrap：仅末尾 ALL wrap 路径置 true（修复 #3）。
                  // true 时 Java 用 current() 续播（windowCurrentIndex 已指向 track 0）；
                  // false 时仍用 advanceRaw(false)（窗口右滑场景，currentIndex 是刚结束的曲目）。
                  call.getBoolean("windowResetFromWrap", false));
          call.resolve();
        });
  }

  /**
   * 解析 JS 端推送的 windowTracks 数组（每首带元数据 + 已解析 URL + playListIndex）。
   *
   * 容错策略：
   * - JSArray 不存在或为空 → 返回空 list（PlaybackQueue 会进入空队列状态）
   * - 单元素解析失败 → 跳过该元素继续解析其余（避免一首坏数据让整窗失效）
   */
  @Nullable
  private List<PlaybackQueue.Track> readWindowTracks(PluginCall call) {
    JSArray array = call.getArray("windowTracks");
    if (array == null || array.length() == 0) {
      return null;
    }
    List<PlaybackQueue.Track> tracks = new ArrayList<>(array.length());
    for (int i = 0; i < array.length(); i++) {
      try {
        JSONObject obj = array.getJSONObject(i);
        PlaybackQueue.Track t = new PlaybackQueue.Track();
        t.songId = obj.optLong("songId", 0L);
        t.title = safeOptString(obj, "title");
        t.artist = safeOptString(obj, "artist");
        t.album = safeOptString(obj, "album");
        t.coverUrl = safeOptString(obj, "coverUrl");
        t.durationMs = obj.optLong("durationMs", 0L);
        t.canLike = obj.optBoolean("canLike", false);
        t.liked = obj.optBoolean("liked", false);
        t.playListIndex = obj.optInt("playListIndex", -1);
        t.skipSong = obj.optBoolean("skipSong", false);
        // 必须 isNull 显式判空：optString 遇 JSON null 会返回字符串 "null"，会让 ExoPlayer 拿 Uri.parse("null") → ENOENT。
        String url = obj.isNull("url") ? null : obj.optString("url", "");
        t.url = (url == null || url.isEmpty()) ? null : url;
        tracks.add(t);
      } catch (JSONException ignored) {
        // 单首解析失败容忍，继续下一首
      }
    }
    return tracks;
  }

  /**
   * 避开 optString 遇 JSON null 返字符串 "null" 的坑，先 isNull 拦截。
   *
   * <p>语义约定：返回空串 "" 表示「未提供」。当前调用点（title/artist/album/coverUrl）下游
   * 均把 "" 与 null 等价处理（参见 PlaybackManager.loadCoverBitmapAsync / refreshCurrentMediaItemMetadata），
   * 不需要保留 null 区分。url 字段不走该 helper：见 readWindowTracks 内的特殊处理。
   */
  private static String safeOptString(JSONObject obj, String key) {
    if (obj.isNull(key)) return "";
    return obj.optString(key, "");
  }

  @PluginMethod
  public void updateNotificationPrefs(PluginCall call) {
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext())
              .updateNotificationPrefs(
                  call.getBoolean("controllerEnabled", true),
                  call.getBoolean("desktopLyricButtonEnabled", false));
          call.resolve();
        });
  }

  @PluginMethod
  public void setAllowMixWithOthers(PluginCall call) {
    boolean allow = call.getBoolean("allow", true);
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).setAllowMixWithOthers(allow);
          call.resolve();
        });
  }

  @PluginMethod
  public void setShowStatusBar(PluginCall call) {
    boolean show = call.getBoolean("show", false);
    runOnMainThread(
        call,
        () -> {
          SharedPreferences prefs = android.preference.PreferenceManager.getDefaultSharedPreferences(getContext());
          prefs.edit().putBoolean(MainActivity.PREF_SHOW_STATUS_BAR, show).apply();
          Activity activity = getActivity();
          if (activity instanceof MainActivity) {
            ((MainActivity) activity).applyImmersiveMode();
          }
          call.resolve();
        });
  }

  @PluginMethod
  public void setHideNavigationBar(PluginCall call) {
    boolean hide = call.getBoolean("hide", false);
    runOnMainThread(
        call,
        () -> {
          SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(getContext());
          prefs.edit().putBoolean(MainActivity.PREF_HIDE_NAVIGATION_BAR, hide).apply();
          Activity activity = getActivity();
          if (activity == null) {
            // Activity 已销毁但 plugin 尚未 detach，避免 NPE；与 setImmersiveLandscape 风格一致
            call.reject("Activity unavailable");
            return;
          }
          if (activity instanceof MainActivity) {
            ((MainActivity) activity).applyImmersiveMode();
          }
          call.resolve();
        });
  }

  /**
   * 横屏沉浸式：active=true 用 SENSOR_LANDSCAPE 跟随设备翻转，
   * active=false 用 UNSPECIFIED 释放（前端会再调 lockPortrait）。
   */
  @PluginMethod
  public void setImmersiveLandscape(PluginCall call) {
    boolean active = call.getBoolean("active", false);
    runOnMainThread(
        call,
        () -> {
          SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(getContext());
          prefs.edit().putBoolean(MainActivity.PREF_IMMERSIVE_LANDSCAPE, active).apply();
          Activity activity = getActivity();
          if (activity == null) {
            // Activity 已销毁但 plugin 尚未 detach，避免 NPE
            call.reject("Activity unavailable");
            return;
          }
          activity.setRequestedOrientation(
              active
                  ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                  : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
          if (activity instanceof MainActivity) {
            ((MainActivity) activity).applyImmersiveMode();
          }
          call.resolve();
        });
  }

  @PluginMethod
  public void syncApiContext(PluginCall call) {
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext())
              .syncApiContext(
                  call.getString("apiBaseUrl", ""),
                  call.getString("cookie", ""),
                  call.getString("songLevel", "exhigh"),
                  Boolean.TRUE.equals(call.getBoolean("disableAiAudio", false)));
          call.resolve();
        });
  }

  @PluginMethod
  public void getState(PluginCall call) {
    resolveOnMainThread(call, () -> PlaybackManager.getInstance(getContext()).buildState());
  }

  @PluginMethod
  public void syncRemoteState(PluginCall call) {
    boolean playing = call.getBoolean("playing", false);
    // 同 seek/load：JS number → Double，用 getDouble 转 long
    long positionMs = (long) (double) call.getDouble("positionMs", 0.0);
    long durationMs = (long) (double) call.getDouble("durationMs", 0.0);
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext())
              .syncRemoteState(playing, positionMs, durationMs);
          call.resolve();
        });
  }

  @PluginMethod
  public void requestNotificationPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      call.resolve(permissionResult(true));
      return;
    }

    if (getPermissionState("notifications") == PermissionState.GRANTED) {
      call.resolve(permissionResult(true));
      return;
    }

    requestPermissionForAlias("notifications", call, "onNotificationPermissionResult");
  }

  @PermissionCallback
  private void onNotificationPermissionResult(@Nullable PluginCall call) {
    if (call == null) {
      return;
    }

    call.resolve(permissionResult(getPermissionState("notifications") == PermissionState.GRANTED));
  }

  // ========== 悬浮歌词相关 ==========

  @PluginMethod
  public void showFloatingLyric(PluginCall call) {
    if (!Settings.canDrawOverlays(getContext())) {
      call.reject("OVERLAY_PERMISSION_DENIED");
      return;
    }
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).showFloatingLyric();
          call.resolve();
        });
  }

  @PluginMethod
  public void hideFloatingLyric(PluginCall call) {
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).hideFloatingLyric();
          call.resolve();
        });
  }

  @PluginMethod
  public void updateFloatingLyricData(PluginCall call) {
    String lrcJson = call.getString("lrcData", "[]");
    String yrcJson = call.getString("yrcData", "[]");
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).updateFloatingLyricData(lrcJson, yrcJson);
          call.resolve();
        });
  }

  @PluginMethod
  public void updateFloatingLyricProgress(PluginCall call) {
    // Capacitor 从 JS 传 number 时，底层类型是 Double 而不是 Long
    double timeMsDouble = call.getDouble("timeMs", 0.0);
    long timeMs = (long) timeMsDouble;
    boolean playing = call.getBoolean("playing", false);
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).updateFloatingLyricProgress(timeMs, playing);
          call.resolve();
        });
  }

  @PluginMethod
  public void updateFloatingLyricSongInfo(PluginCall call) {
    String name = call.getString("name", "");
    String artist = call.getString("artist", "");
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).updateFloatingLyricSongInfo(name, artist);
          call.resolve();
        });
  }

  @PluginMethod
  public void updateFloatingLyricConfig(PluginCall call) {
    com.getcapacitor.JSObject data = call.getObject("config");
    // 如果没有嵌套 config，直接用 call 的所有字段
    com.getcapacitor.JSObject payload = data != null ? data : call.getData();
    runOnMainThread(
        call,
        () -> {
          PlaybackManager.getInstance(getContext()).updateFloatingLyricConfig(payload);
          call.resolve();
        });
  }

  @PluginMethod
  public void checkOverlayPermission(PluginCall call) {
    JSObject result = new JSObject();
    result.put("granted", Settings.canDrawOverlays(getContext()));
    call.resolve(result);
  }

  // 频谱可视化 Media3 AudioProcessor 内嵌 FFT

  /**
   * 预下载下一首音频前 512 KB 到 SimpleCache。
   *
   * <p>调用方（SongManager.prefetchNextSong）拿到下一首 url 后立即 fire-and-forget。
   * 切歌后 ExoPlayer setMediaItem 命中缓存，跳过 100-500ms 的 OPEN→网络握手。
   *
   * <p>同 cacheKey 的并发请求会被 dedup；切歌时上一首未完成的 prefetch 会被自动取消让带宽。
   */
  @PluginMethod
  public void prefetchAudio(PluginCall call) {
    String url = call.getString("url", "");
    if (url == null || url.isEmpty()) {
      call.resolve();
      return;
    }
    AudioCacheProvider.prefetchUrl(getContext(), url);
    call.resolve();
  }

  @PluginMethod
  public void enableVisualizer(PluginCall call) {
    boolean enable = call.getBoolean("enable", false);
    runOnMainThread(
        call,
        () -> {
          boolean ok = PlaybackManager.getInstance(getContext()).enableVisualizer(enable);
          call.resolve(permissionResult(ok));
        });
  }

  @PluginMethod
  public void requestOverlayPermission(PluginCall call) {
    if (Settings.canDrawOverlays(getContext())) {
      call.resolve(permissionResult(true));
      return;
    }
    Intent intent = new Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + getContext().getPackageName()));
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(intent);
    // 用户需要手动授予，返回 false 表示需要用户操作
    call.resolve(permissionResult(false));
  }

  public void emitEvent(String eventName, JSObject payload, boolean retainUntilConsumed) {
    notifyListeners(eventName, payload, retainUntilConsumed);
  }

  private void resolveOnMainThread(PluginCall call, Supplier<JSObject> action) {
    runOnMainThread(
        call,
        () -> {
          call.resolve(action.get());
        });
  }

  private void runOnMainThread(PluginCall call, Runnable action) {
    if (getActivity() == null) {
      call.reject("Activity unavailable");
      return;
    }

    getActivity()
        .runOnUiThread(
            () -> {
              try {
                action.run();
              } catch (Exception error) {
                call.reject(error.getMessage(), error);
              }
            });
  }

  private JSObject permissionResult(boolean granted) {
    JSObject result = new JSObject();
    result.put("granted", granted);
    return result;
  }

  @Nullable
  private PlaybackManager.TrackMetadata readTrackMetadata(
      PluginCall call, String fieldName, boolean includeUrl) {
    JSObject data = call.getObject(fieldName);
    if (data == null) {
      return null;
    }

    PlaybackManager.TrackMetadata metadata = new PlaybackManager.TrackMetadata();
    metadata.songId = data.optLong("songId", 0L);
    metadata.title = data.optString("title", "");
    metadata.artist = data.optString("artist", "");
    metadata.album = data.optString("album", "");
    metadata.coverUrl = data.optString("coverUrl", "");
    metadata.durationMs = (long) data.optDouble("durationMs", 0.0);
    metadata.canLike = data.optBoolean("canLike", false);
    metadata.liked = data.optBoolean("liked", false);
    if (includeUrl) {
      metadata.url = data.optString("url", "");
    }
    return metadata;
  }
}
