package top.imsyy.splayer.android;

import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.preference.PreferenceManager;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import top.imsyy.splayer.android.cache.AndroidCachePlugin;
import top.imsyy.splayer.android.cache.AudioPrefetchTtlIndex;
import top.imsyy.splayer.android.download.AndroidDownloadPlugin;
import top.imsyy.splayer.android.lyric.AndroidLocalLyricPlugin;
import top.imsyy.splayer.android.playback.AndroidNativePlaybackPlugin;
import top.imsyy.splayer.android.share.AndroidSharePlugin;

public class MainActivity extends BridgeActivity {
  // 供 plugin 跨类引用，避免双源硬编码
  public static final String PREF_SHOW_STATUS_BAR = "androidShowStatusBar";
  /** 横屏沉浸式：同时隐藏状态栏与全面屏导航手势条 */
  public static final String PREF_IMMERSIVE_LANDSCAPE = "immersiveLandscape";
  public static final String PREF_HIDE_NAVIGATION_BAR = "hideNavigationBar";
  /** 进程级 sweep 启动标记：Activity 重建（旋屏 / 配置变更）时不再重复 post Runnable。 */
  private static volatile boolean sweepBootstrapped = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(AndroidNativePlaybackPlugin.class);
    registerPlugin(AndroidLocalLyricPlugin.class);
    registerPlugin(AndroidDownloadPlugin.class);
    registerPlugin(AndroidCachePlugin.class);
    registerPlugin(AndroidSharePlugin.class);
    super.onCreate(savedInstanceState);
    // 冷启动重置沉浸式 pref，避免强杀残留隐藏导航栏；旋屏重建（savedInstanceState != null）保留
    if (savedInstanceState == null) {
      try {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
        if (prefs.getBoolean(PREF_IMMERSIVE_LANDSCAPE, false)) {
          prefs.edit().putBoolean(PREF_IMMERSIVE_LANDSCAPE, false).apply();
        }
      } catch (Exception ignored) {
        // pref 读写失败不阻塞启动
      }
    }
    applyImmersiveMode();
    applyWebViewTextZoom();
    // 音频预载 TTL：推迟到首帧后再初始化（构造期会同步读 SharedPreferences，冷启动加密磁盘可能耗百毫秒）。
    // 这里 post 2s，startPeriodicSweep 内部再 postDelayed 5s，首次 sweep 实际 ≈7s 后开始；
    // 之后每 30min 周期清理；TTL=50min；期间用户重复播放该 url 会通过 PlaybackManager.load 续期。
    if (!sweepBootstrapped) {
      sweepBootstrapped = true;
      new Handler(Looper.getMainLooper()).postDelayed(
          () -> AudioPrefetchTtlIndex.getInstance(getApplicationContext()).startPeriodicSweep(),
          2_000L);
    }
  }

  @Override
  public void onResume() {
    super.onResume();
    applyImmersiveMode();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      applyImmersiveMode();
    }
  }

  private boolean shouldShowStatusBar() {
    try {
      SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
      return prefs.getBoolean(PREF_SHOW_STATUS_BAR, false);
    } catch (Exception e) {
      return false;
    }
  }

  private boolean isImmersiveLandscape() {
    try {
      SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
      return prefs.getBoolean(PREF_IMMERSIVE_LANDSCAPE, false);
    } catch (Exception e) {
      return false;
    }
  }

  private boolean shouldHideNavigationBar() {
    try {
      SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
      return prefs.getBoolean(PREF_HIDE_NAVIGATION_BAR, false);
    } catch (Exception e) {
      return false;
    }
  }

  public void applyImmersiveMode() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

    View decorView = getWindow().getDecorView();
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decorView);
    boolean immersiveLandscape = isImmersiveLandscape();
    boolean hideNavigationBar = immersiveLandscape || shouldHideNavigationBar();
    boolean showStatusBar = shouldShowStatusBar() && !immersiveLandscape;
    // 注意：不能根据「值未变」跳过 controller.hide(navigationBars)，因为 onResume /
    // onWindowFocusChanged 后系统会主动恢复显示导航栏（transient sticky 依赖反复 hide），
    // 跳过会导致竖屏底栏不再隐藏
    if (controller != null) {
      if (showStatusBar) {
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
        controller.show(WindowInsetsCompat.Type.statusBars());
      } else {
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
      }
      // 沉浸式才隐藏导航栏，其他场景始终显示
      if (hideNavigationBar) {
        controller.hide(WindowInsetsCompat.Type.navigationBars());
      } else {
        controller.show(WindowInsetsCompat.Type.navigationBars());
      }
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
          | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
      if (!showStatusBar) {
        flags |= View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
      }
      if (hideNavigationBar) {
        flags |= View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
      }
      decorView.setSystemUiVisibility(flags);
    }
  }

  private void applyWebViewTextZoom() {
    WebView webView = getBridge().getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setTextZoom(100);
  }
}
