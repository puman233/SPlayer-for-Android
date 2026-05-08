package top.imsyy.splayer.android.playback;

import android.content.SharedPreferences;
import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.preference.PreferenceManager;
import android.provider.Settings;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.function.Supplier;

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
    metadata.songId = call.getInt("songId", 0);
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
          PlaybackManager.getInstance(getContext())
              .updateQueueContext(
                  call.getBoolean("liked", false),
                  call.getBoolean("canSkipPrevious", true),
                  call.getBoolean("personalFmMode", false),
                  call.getBoolean("controllerEnabled", true),
                  call.getBoolean("desktopLyricButtonEnabled", false),
                  call.getBoolean("desktopLyricEnabled", false),
                  call.getBoolean("repeatOne", false),
                  readTrackMetadata(call, "nextTrack", true));
          call.resolve();
        });
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
          prefs.edit().putBoolean("androidShowStatusBar", show).apply();
          if (getActivity() instanceof top.imsyy.splayer.android.MainActivity) {
            ((top.imsyy.splayer.android.MainActivity) getActivity()).applyImmersiveMode();
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
              .syncApiContext(call.getString("apiBaseUrl", ""), call.getString("cookie", ""));
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
    metadata.songId = data.optInt("songId", 0);
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
