package top.imsyy.splayer.android.playback;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import top.imsyy.splayer.android.R;

public class FloatingLyricService extends Service {
  private static final String TAG = "FloatingLyric";
  private static final String PREFS = "floating_lyric_prefs";
  private static final int DRAG_SLOP = 10;

  private WindowManager wm;
  private LyricView view;
  private WindowManager.LayoutParams lp;

  /** 锁定时的独立解锁按钮小窗口 */
  private View unlockBtnView;

  private WindowManager.LayoutParams unlockLp;
  private SharedPreferences prefs;
  private final Handler handler = new Handler(Looper.getMainLooper());

  /* ---------- 歌词数据 ---------- */
  volatile List<Line> lrcLines = new ArrayList<>();
  volatile List<Line> yrcLines = new ArrayList<>();
  volatile String songName = "", artistName = "";

  /* ---------- 时间插值 ---------- */
  volatile long baseMs = 0;
  volatile long anchorNano = System.nanoTime();
  volatile boolean playing = false;

  /* ---------- 配置 ---------- */
  int colorPlayed = 0xFFFE7971, colorUnplayed = 0xFFCCCCCC, colorShadow = 0x80000000;
  float fontSizeSp = 16f;
  int fontWeight = 400;
  boolean wordMode = true, locked = false, showCtrls = false;
  boolean showTran = true;
  boolean doubleLine = true;
  boolean animation = true;

  /** 文本背景遮罩 */
  boolean textBackgroundMask = false;

  int backgroundMaskColor = 0x80000000;

  /** 对齐方式：left / center / right / both */
  String alignPosition = "both";

  /** 悬浮窗宽度占屏幕百分比 (30-100) */
  int windowWidthPercent = 84;

  /** 悬浮窗高度 (dp) */
  int windowHeightDp = 72;

  /** 平板模式：最小屏幕宽度 >=600dp，复刻桌面端 header 三栏布局 */
  boolean tabletMode = false;

  /* ---------- 行切换动画 ---------- */
  private int lastLineIdx = -1;
  private long lineAnimStartNano = 0L;
  private static final long LINE_ANIM_DURATION_NANO = 260L * 1_000_000L;

  /* ---------- 拖拽 ---------- */
  private float tX0, tY0;
  private int wX0, wY0;
  private boolean dragging;

  /* ---------- 控制栏按钮命中区 ---------- */
  private final RectF rLock = new RectF(),
      rPrev = new RectF(),
      rPlay = new RectF(),
      rNext = new RectF(),
      rClose = new RectF(),
      rUnlock = new RectF(),
      rFavorite = new RectF(),
      rTitle = new RectF();

  // 复刻桌面端单色线稿图标
  private static final int ICON_MUSIC = 1, ICON_PREV = 2, ICON_PLAY = 3, ICON_PAUSE = 4,
      ICON_NEXT = 5, ICON_HEART = 6, ICON_HEART_FILLED = 7, ICON_LOCK = 8, ICON_UNLOCK = 9,
      ICON_CLOSE = 10;
  /** 红心收藏颜色 */
  private static final int COLOR_HEART_LIKED = 0xFFE0446A;

  /** VectorDrawable 图标缓存，避免每帧重复加载 */
  private final Map<Integer, Drawable> iconCache = new HashMap<>();

  // ==================== 生命周期 ====================

  @Override
  public void onCreate() {
    super.onCreate();
    prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    locked = prefs.getBoolean("locked", false);
    // 恢复上次保存的配置，避免每次开启都是硬编码默认值
    restoreConfigFromPrefs();
    wm = (WindowManager) getSystemService(WINDOW_SERVICE);
    buildView();
    // 如果上次是锁定状态，恢复穿透 + 显示解锁按钮
    if (locked) {
      lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
      try {
        wm.updateViewLayout(view, lp);
      } catch (Exception ignored) {
      }
      showUnlockBtn();
    }
    PlaybackManager.getInstance(this).attachFloatingLyricService(this);
  }

  /** 从 SharedPreferences 恢复歌词配置 */
  private void restoreConfigFromPrefs() {
    colorPlayed = prefs.getInt("colorPlayed", colorPlayed);
    colorUnplayed = prefs.getInt("colorUnplayed", colorUnplayed);
    colorShadow = prefs.getInt("colorShadow", colorShadow);
    backgroundMaskColor = prefs.getInt("backgroundMaskColor", backgroundMaskColor);
    fontSizeSp = prefs.getFloat("fontSizeSp", fontSizeSp);
    fontWeight = prefs.getInt("fontWeight", fontWeight);
    wordMode = prefs.getBoolean("wordMode", wordMode);
    showTran = prefs.getBoolean("showTran", showTran);
    doubleLine = prefs.getBoolean("doubleLine", doubleLine);
    animation = prefs.getBoolean("animation", animation);
    textBackgroundMask = prefs.getBoolean("textBackgroundMask", textBackgroundMask);
    windowWidthPercent = prefs.getInt("windowWidthPercent", windowWidthPercent);
    windowHeightDp = prefs.getInt("windowHeightDp", windowHeightDp);
    String pos = prefs.getString("alignPosition", alignPosition);
    if (pos != null) alignPosition = pos;
  }

  /** 持久化当前配置 */
  private void persistConfigToPrefs() {
    if (prefs == null) return;
    prefs
        .edit()
        .putInt("colorPlayed", colorPlayed)
        .putInt("colorUnplayed", colorUnplayed)
        .putInt("colorShadow", colorShadow)
        .putInt("backgroundMaskColor", backgroundMaskColor)
        .putFloat("fontSizeSp", fontSizeSp)
        .putInt("fontWeight", fontWeight)
        .putBoolean("wordMode", wordMode)
        .putBoolean("showTran", showTran)
        .putBoolean("doubleLine", doubleLine)
        .putBoolean("animation", animation)
        .putBoolean("textBackgroundMask", textBackgroundMask)
        .putInt("windowWidthPercent", windowWidthPercent)
        .putInt("windowHeightDp", windowHeightDp)
        .putString("alignPosition", alignPosition)
        .apply();
  }

  @Override
  public int onStartCommand(Intent i, int f, int id) {
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    PlaybackManager.getInstance(this).detachFloatingLyricService(this);
    removeUnlockBtn();
    if (view != null) {
      try {
        wm.removeView(view);
      } catch (Exception ignored) {
      }
      view = null;
    }
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent i) {
    return null;
  }

  // ==================== View 构建 ====================

  /** 把坐标限制在 [0, max] 区间；max <= 0 时回退到 0（窗口大于可用空间时贴边） */
  private static int clampCoord(int v, int max) {
    return Math.max(0, Math.min(v, Math.max(0, max)));
  }

  private void buildView() {
    view = new LyricView(this);
    DisplayMetrics dm = getResources().getDisplayMetrics();
    int pct = Math.max(30, Math.min(100, windowWidthPercent));
    int hDp = Math.max(48, Math.min(240, windowHeightDp));
    // 平板模式：最小屏幕宽度 >=600dp，复刻桌面端布局
    tabletMode = getResources().getConfiguration().smallestScreenWidthDp >= 600;
    // 平板需要更高窗口以容纳 header + 歌词（动态智能调整）
    int effHdp = tabletMode ? Math.max(hDp, 110) : hDp;
    int w = (int) (dm.widthPixels * (pct / 100f)), h = (int) (effHdp * dm.density);
    // 默认垂直位置：平板在屏幕 70% 处，手机在 30% 处
    int defaultY = (int) (dm.heightPixels * (tabletMode ? 0.70f : 0.30f));
    int x = prefs.getInt("x", (dm.widthPixels - w) / 2);
    int y = prefs.getInt("y", defaultY);
    // 控件不得超出屏幕边缘（含初始位置）
    x = clampCoord(x, dm.widthPixels - w);
    y = clampCoord(y, dm.heightPixels - h);

    lp =
        new WindowManager.LayoutParams(
            w,
            h,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
    lp.gravity = Gravity.TOP | Gravity.START;
    lp.x = x;
    lp.y = y;
    try {
      wm.addView(view, lp);
    } catch (Exception e) {
      Log.e(TAG, "addView", e);
    }
  }

  /** 根据当前 windowWidthPercent / windowHeightDp 重新应用窗口尺寸 */
  private void applyWindowSize() {
    if (view == null || lp == null || wm == null) return;
    DisplayMetrics dm = getResources().getDisplayMetrics();
    int pct = Math.max(30, Math.min(100, windowWidthPercent));
    int hDp = Math.max(48, Math.min(240, windowHeightDp));
    int effHdp = tabletMode ? Math.max(hDp, 110) : hDp;
    int newW = (int) (dm.widthPixels * (pct / 100f));
    int newH = (int) (effHdp * dm.density);
    if (lp.width == newW && lp.height == newH) return;
    lp.width = newW;
    lp.height = newH;
    // 尺寸变化后重新把位置钳制在屏幕内
    lp.x = clampCoord(lp.x, dm.widthPixels - newW);
    lp.y = clampCoord(lp.y, dm.heightPixels - newH);
    try {
      wm.updateViewLayout(view, lp);
    } catch (Exception ignored) {
    }
  }

  // ==================== 对外 API ====================

  public void pushLyrics(String lrcJson, String yrcJson) {
    lrcLines = parseLines(lrcJson);
    yrcLines = parseLines(yrcJson);
    postRedraw();
  }

  public void pushProgress(long ms, boolean isPlaying) {
    baseMs = ms;
    anchorNano = System.nanoTime();
    playing = isPlaying;
    postRedraw();
  }

  public void pushSongInfo(String name, String artist) {
    songName = name != null ? name : "";
    artistName = artist != null ? artist : "";
    postRedraw();
  }

  /** 应用来自 JS 端的桌面歌词配置。所有字段均可选，缺失则保持现值。 */
  public void applyConfig(JSONObject config) {
    if (config == null) return;
    Integer parsedPlayed = parseColor(config.opt("playedColor"));
    if (parsedPlayed != null) colorPlayed = parsedPlayed;
    Integer parsedUnplayed = parseColor(config.opt("unplayedColor"));
    if (parsedUnplayed != null) colorUnplayed = parsedUnplayed;
    Integer parsedShadow = parseColor(config.opt("shadowColor"));
    if (parsedShadow != null) colorShadow = parsedShadow;
    Integer parsedMask = parseColor(config.opt("backgroundMaskColor"));
    if (parsedMask != null) backgroundMaskColor = parsedMask;
    if (config.has("fontSize")) {
      double f = config.optDouble("fontSize", fontSizeSp);
      if (!Double.isNaN(f) && f > 0) fontSizeSp = (float) f;
    }
    if (config.has("fontWeight")) {
      int w = config.optInt("fontWeight", fontWeight);
      if (w >= 100 && w <= 900) fontWeight = w;
    }
    if (config.has("showWordLyrics")) wordMode = config.optBoolean("showWordLyrics", wordMode);
    if (config.has("showTran")) showTran = config.optBoolean("showTran", showTran);
    if (config.has("isDoubleLine")) doubleLine = config.optBoolean("isDoubleLine", doubleLine);
    if (config.has("animation")) animation = config.optBoolean("animation", animation);
    if (config.has("textBackgroundMask"))
      textBackgroundMask = config.optBoolean("textBackgroundMask", textBackgroundMask);
    if (config.has("position")) {
      String pos = config.optString("position", alignPosition);
      if (pos != null && !pos.isEmpty()) alignPosition = pos;
    }
    if (config.has("windowWidthPercent")) {
      int p = config.optInt("windowWidthPercent", windowWidthPercent);
      if (p >= 30 && p <= 100) windowWidthPercent = p;
    }
    if (config.has("windowHeightDp")) {
      int hd = config.optInt("windowHeightDp", windowHeightDp);
      if (hd >= 48 && hd <= 240) windowHeightDp = hd;
    }
    persistConfigToPrefs();
    applyWindowSize();
    postRedraw();
  }

  /** 解析颜色字符串： - #RRGGBB / #AARRGGBB / #RGB - rgb(r,g,b) / rgba(r,g,b,a) */
  private static Integer parseColor(Object raw) {
    if (!(raw instanceof String)) return null;
    String v = ((String) raw).trim();
    if (v.isEmpty()) return null;
    try {
      if (v.startsWith("#")) {
        return Color.parseColor(v);
      }
      String lower = v.toLowerCase();
      if (lower.startsWith("rgba(") || lower.startsWith("rgb(")) {
        int lp = v.indexOf('('), rp = v.indexOf(')');
        if (lp < 0 || rp < 0) return null;
        String inner = v.substring(lp + 1, rp);
        String[] parts = inner.split(",");
        if (parts.length < 3) return null;
        int r = clamp255((int) Math.round(Double.parseDouble(parts[0].trim())));
        int g = clamp255((int) Math.round(Double.parseDouble(parts[1].trim())));
        int b = clamp255((int) Math.round(Double.parseDouble(parts[2].trim())));
        int a = 255;
        if (parts.length >= 4) {
          double af = Double.parseDouble(parts[3].trim());
          // 支持 0-1 的浮点透明度 或 0-255 的整型
          a = af <= 1.0 ? (int) Math.round(af * 255) : clamp255((int) Math.round(af));
        }
        return Color.argb(a, r, g, b);
      }
    } catch (Exception ignored) {
    }
    return null;
  }

  private static int clamp255(int v) {
    return Math.max(0, Math.min(255, v));
  }

  public void setLocked(boolean v) {
    locked = v;
    prefs.edit().putBoolean("locked", v).apply();
    showCtrls = false;
    if (v) {
      // 锁定：主窗口穿透 + 显示解锁小按钮
      lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
      try {
        wm.updateViewLayout(view, lp);
      } catch (Exception ignored) {
      }
      showUnlockBtn();
    } else {
      // 解锁：主窗口恢复触摸 + 移除解锁按钮
      lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
      try {
        wm.updateViewLayout(view, lp);
      } catch (Exception ignored) {
      }
      removeUnlockBtn();
    }
    postRedraw();
  }

  /** 显示独立的解锁按钮小窗口 */
  private void showUnlockBtn() {
    if (unlockBtnView != null) return;
    DisplayMetrics dm = getResources().getDisplayMetrics();
    float d = dm.density;
    int btnSize = (int) (32 * d);

    unlockBtnView =
        new View(this) {
          final Paint bp = new Paint(Paint.ANTI_ALIAS_FLAG);

          @Override
          protected void onDraw(Canvas c) {
            float d = getResources().getDisplayMetrics().density;
            // 与主歌词窗口保持一致：仅在开启文本背景遮罩时绘制背景
            if (textBackgroundMask) {
              bp.setColor(backgroundMaskColor);
              if ((bp.getColor() >>> 24) != 0) {
                c.drawRoundRect(0, 0, getWidth(), getHeight(), 8 * d, 8 * d, bp);
              }
            }
            // 复刻桌面端 SVG 解锁图标（VectorDrawable）
            Drawable lockIcon = getResources().getDrawable(R.drawable.lyric_unlock, null);
            if (lockIcon != null) {
              lockIcon = lockIcon.mutate();
              lockIcon.setTint(0xFFFFFFFF);
              float size = Math.min(getWidth(), getHeight()) * 0.62f;
              float half = size / 2f;
              float cx = getWidth() / 2f, cy = getHeight() / 2f;
              lockIcon.setBounds(
                  (int) (cx - half), (int) (cy - half), (int) (cx + half), (int) (cy + half));
              lockIcon.draw(c);
            }
          }
        };
    unlockBtnView.setOnClickListener(v -> setLocked(false));

    int overlayType =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

    unlockLp =
        new WindowManager.LayoutParams(
            btnSize,
            btnSize,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
    unlockLp.gravity = Gravity.TOP | Gravity.START;
    // 放在主窗口右上角
    unlockLp.x = lp.x + lp.width - btnSize - (int) (4 * d);
    unlockLp.y = lp.y + (int) (4 * d);

    try {
      wm.addView(unlockBtnView, unlockLp);
    } catch (Exception e) {
      Log.e(TAG, "addUnlock", e);
    }
  }

  /** 移除解锁按钮窗口 */
  private void removeUnlockBtn() {
    if (unlockBtnView != null) {
      try {
        wm.removeView(unlockBtnView);
      } catch (Exception ignored) {
      }
      unlockBtnView = null;
    }
  }

  private void postRedraw() {
    if (view != null) view.postInvalidateOnAnimation();
    if (unlockBtnView != null) unlockBtnView.postInvalidateOnAnimation();
  }

  // ==================== 时间计算 ====================

  long seekMs() {
    if (!playing) return baseMs + 300;
    long elapsed = (System.nanoTime() - anchorNano) / 1_000_000L;
    return baseMs + elapsed + 300;
  }

  List<Line> activeLines() {
    return (wordMode && !yrcLines.isEmpty()) ? yrcLines : lrcLines;
  }

  /** 当前歌曲是否已收藏（决定红心填充/描边） */
  boolean isCurLiked() {
    try {
      return PlaybackManager.getInstance(this).isCurrentLiked();
    } catch (Exception e) {
      return false;
    }
  }

  int findIndex(List<Line> ly, long ms) {
    int r = -1;
    for (int i = 0; i < ly.size(); i++) {
      if (ms >= ly.get(i).start) r = i;
      else break;
    }
    return r;
  }

  // ==================== 按钮处理 ====================

  private void onBtnTap(float x, float y) {
    if (rUnlock.contains(x, y)) {
      setLocked(false);
      return;
    }
    if (rTitle.contains(x, y)) {
      // 点击歌名区：悬浮窗自身的锁定/关闭等 header 处理（预留）
      return;
    }
    if (rFavorite.contains(x, y)) {
      // 平板红心：添加/取消收藏当前歌曲
      PlaybackManager.getInstance(this).handleNotificationAction(PlaybackConstants.ACTION_FAVORITE);
      postRedraw();
      return;
    }
    if (rClose.contains(x, y)) {
      PlaybackManager pm = PlaybackManager.getInstance(this);
      pm.hideFloatingLyric();
      pm.emitDesktopLyricClosed();
      return;
    }
    if (rLock.contains(x, y)) {
      setLocked(true);
      return;
    }
    if (rPrev.contains(x, y)) {
      PlaybackManager.getInstance(this).handleNotificationAction(PlaybackConstants.ACTION_PREVIOUS);
      return;
    }
    if (rPlay.contains(x, y)) {
      PlaybackManager.getInstance(this)
          .handleNotificationAction(PlaybackConstants.ACTION_TOGGLE_PLAYBACK);
      return;
    }
    if (rNext.contains(x, y)) {
      PlaybackManager.getInstance(this).handleNotificationAction(PlaybackConstants.ACTION_NEXT);
    }
  }

  // ==================== 解析 ====================

  private static List<Line> parseLines(String json) {
    List<Line> r = new ArrayList<>();
    if (json == null || json.isEmpty()) return r;
    try {
      JSONArray a = new JSONArray(json);
      for (int i = 0; i < a.length(); i++) {
        JSONObject o = a.getJSONObject(i);
        Line l = new Line();
        l.start = o.optLong("startTime", 0);
        l.end = o.optLong("endTime", 0);
        l.tran = o.optString("translatedLyric", "");
        JSONArray wa = o.optJSONArray("words");
        if (wa != null)
          for (int j = 0; j < wa.length(); j++) {
            JSONObject wo = wa.getJSONObject(j);
            l.words.add(
                new Word(
                    wo.optString("word", ""),
                    wo.optLong("startTime", 0),
                    wo.optLong("endTime", 0)));
          }
        r.add(l);
      }
    } catch (Exception e) {
      Log.w(TAG, "parse", e);
    }
    return r;
  }

  // ==================== 自定义 View ====================

  private class LyricView extends View {
    private final Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final Paint bp = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ip = new Paint(Paint.ANTI_ALIAS_FLAG);

    LyricView(Context c) {
      super(c);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
      // 锁定时主窗口 FLAG_NOT_TOUCHABLE，不会进入这里
      switch (e.getAction()) {
        case MotionEvent.ACTION_DOWN:
          tX0 = e.getRawX();
          tY0 = e.getRawY();
          wX0 = lp.x;
          wY0 = lp.y;
          dragging = false;
          return true;
        case MotionEvent.ACTION_MOVE:
          float dx = e.getRawX() - tX0, dy = e.getRawY() - tY0;
          if (!dragging && (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP)) dragging = true;
          if (dragging) {
            int nx = wX0 + (int) dx, ny = wY0 + (int) dy;
            DisplayMetrics dm = getResources().getDisplayMetrics();
            lp.x = clampCoord(nx, dm.widthPixels - lp.width);
            lp.y = clampCoord(ny, dm.heightPixels - lp.height);
            try {
              wm.updateViewLayout(view, lp);
            } catch (Exception ignored) {
            }
          }
          return true;
        case MotionEvent.ACTION_UP:
          if (dragging) {
            prefs.edit().putInt("x", lp.x).putInt("y", lp.y).apply();
          } else {
            if (showCtrls) onBtnTap(e.getX(), e.getY());
            showCtrls = !showCtrls;
            invalidate();
            handler.removeCallbacksAndMessages(null);
            if (showCtrls)
              handler.postDelayed(
                  () -> {
                    showCtrls = false;
                    postRedraw();
                  },
                  5000);
          }
          return true;
      }
      return super.onTouchEvent(e);
    }

    @Override
    protected void onDraw(Canvas c) {
      int w = getWidth(), h = getHeight();
      float d = getResources().getDisplayMetrics().density;
      float sd = getResources().getDisplayMetrics().scaledDensity;

      // 背景：控制栏模式用半透明深色；文本遮罩开启时用用户配置色；否则透明（避免默认遮罩）
      int bgColor;
      if (showCtrls) {
        bgColor = 0xDD1E1E2E;
      } else if (textBackgroundMask) {
        bgColor = backgroundMaskColor;
      } else {
        bgColor = 0x00000000;
      }
      if ((bgColor >>> 24) != 0) {
        bp.setColor(bgColor);
        c.drawRoundRect(0, 0, w, h, 14 * d, 14 * d, bp);
      }

      if (locked) {
        paintLyrics(c, w, h, d, sd, 0f);
      } else if (showCtrls) {
        if (tabletMode) {
          // 平板复刻桌面端：header + 歌词同屏
          float headerH = paintTabletHeader(c, w, h, d);
          paintLyrics(c, w, h, d, sd, headerH);
        } else {
          paintControls(c, w, h, d);
        }
      } else {
        paintLyrics(c, w, h, d, sd, 0f);
      }

      // 关键：播放中或正在动画中时自驱动连续重绘
      boolean animating =
          animation
              && lineAnimStartNano > 0
              && (System.nanoTime() - lineAnimStartNano) < LINE_ANIM_DURATION_NANO;
      if ((playing || animating) && !showCtrls) {
        postInvalidateOnAnimation();
      }
    }

    // ---------- 歌词绘制 ----------

    /** 计算自适应字号：以用户 config 字号为基础，按区域高度/屏幕尺寸做智能调整 */
    private float computeAdaptiveFontSize(float d, float sd, float areaH, boolean twoLine) {
      float tsz = fontSizeSp * sd;
      // 平板屏幕更大，适当放大便于阅读
      if (tabletMode) tsz *= 1.12f;
      // 依据歌词区域高度约束，保证单行/双行都放得下
      float avail = areaH * 0.82f;
      // 双行约占 2 倍行高，单行约 1.25 倍行高
      float lineFactor = twoLine ? 2.0f : 1.25f;
      float maxByHeight = avail / lineFactor;
      if (tsz > maxByHeight) tsz = maxByHeight;
      // 保证可读性下限
      float min = 14f * sd;
      if (tsz < min) tsz = min;
      return tsz;
    }

    private void paintLyrics(Canvas c, int w, int h, float d, float sd, float topPad) {
      // 顶部预留（平板 header 高度），歌词绘制在其下方区域内
      float areaTop = Math.max(0f, topPad);
      float areaH = Math.max(1f, h - topPad);
      float areaMid = areaTop + areaH * 0.5f;

      float pad = 14 * d, maxW = w - pad * 2;
      List<Line> ly = activeLines();
      long sk = seekMs();
      int idx = ly.isEmpty() ? -1 : findIndex(ly, sk);

      // 无歌词：显示占位信息
      if (ly.isEmpty() || idx < 0 || idx >= ly.size()) {
        lastLineIdx = -1;
        lineAnimStartNano = 0L;
        String txt = songName.isEmpty() ? "SPlayer" : songName + " - " + artistName;
        float tsz = computeAdaptiveFontSize(d, sd, areaH, false);
        tp.setTextSize(tsz);
        // 字重：>=600 用 BOLD，否则 NORMAL
        tp.setTypeface(
            Typeface.create(Typeface.DEFAULT, fontWeight >= 600 ? Typeface.BOLD : Typeface.NORMAL));
        tp.setShadowLayer(2 * d, 0, 0, colorShadow);
        tp.setShader(null);
        tp.setColor(0xBBFFFFFF);
        drawFittedText(c, txt, w, areaMid, tp, maxW, pad, tsz, alignPosition);
        return;
      }

      // 检测行切换，触发动画
      if (idx != lastLineIdx) {
        if (lastLineIdx >= 0 && animation) {
          lineAnimStartNano = System.nanoTime();
        } else {
          lineAnimStartNano = 0L;
        }
        lastLineIdx = idx;
      }

      float animProg = 1f;
      if (animation && lineAnimStartNano > 0) {
        long dt = System.nanoTime() - lineAnimStartNano;
        if (dt >= LINE_ANIM_DURATION_NANO) {
          lineAnimStartNano = 0L;
          animProg = 1f;
        } else {
          animProg = dt / (float) LINE_ANIM_DURATION_NANO;
        }
      }
      // easeOutCubic
      float eased = 1f - (float) Math.pow(1f - animProg, 3);

      Line line = ly.get(idx);
      boolean hasTran = showTran && line.tran != null && !line.tran.isEmpty();
      boolean hasNext = idx + 1 < ly.size();
      boolean twoLine = doubleLine && (hasTran || hasNext);

      // 自适应字号（需在确定 twoLine 之后计算）
      float tsz = computeAdaptiveFontSize(d, sd, areaH, twoLine);
      // 歌词区域内的相对位置
      float mainY = twoLine ? areaTop + areaH * 0.34f : areaMid;

      tp.setTextSize(tsz);
      // 字重：>=600 用 BOLD，否则 NORMAL
      tp.setTypeface(
          Typeface.create(Typeface.DEFAULT, fontWeight >= 600 ? Typeface.BOLD : Typeface.NORMAL));
      tp.setShadowLayer(2 * d, 0, 0, colorShadow);
      tp.setShader(null);

      // 主歌词（带切入动画：上一行淡出+上移，当前行淡入+从下方移入）
      if (animation && eased < 1f && idx - 1 >= 0) {
        Line prev = ly.get(idx - 1);
        int prevAlpha = (int) (255 * (1f - eased));
        float prevOffset = -areaH * 0.4f * eased;
        int saved = c.save();
        c.translate(0, prevOffset);
        tp.setShader(null);
        tp.setColor((prevAlpha << 24) | (colorPlayed & 0x00FFFFFF));
        tp.setTextSize(tsz);
        drawFittedText(c, lineText(prev), w, mainY, tp, maxW, pad, tsz, alignPosition);
        c.restoreToCount(saved);
      }

      int curAlpha = animation ? (int) (255 * eased) : 255;
      float curOffset = animation ? areaH * 0.4f * (1f - eased) : 0f;
      int savedC = c.save();
      c.translate(0, curOffset);
      if (wordMode && !yrcLines.isEmpty() && line.words.size() > 1) {
        paintWordLyric(c, line, sk, w, mainY, tsz, pad, d, curAlpha);
      } else {
        tp.setShader(null);
        tp.setColor((Math.max(0, Math.min(255, curAlpha)) << 24) | (colorPlayed & 0x00FFFFFF));
        tp.setTextSize(tsz);
        drawFittedText(c, lineText(line), w, mainY, tp, maxW, pad, tsz, alignPosition);
      }
      c.restoreToCount(savedC);

      // 第二行
      if (twoLine) {
        String sub = hasTran ? line.tran : lineText(ly.get(idx + 1));
        tp.setShader(null);
        int subAlpha = animation ? (int) (255 * eased) : 255;
        tp.setColor((Math.max(0, Math.min(255, subAlpha)) << 24) | (colorUnplayed & 0x00FFFFFF));
        float subSize = tsz * 0.7f;
        tp.setTextSize(subSize);
        drawFittedText(c, sub, w, areaTop + areaH * 0.72f, tp, maxW, pad, subSize, alignPosition);
      }
    }

    /** 绘制文字并在宽度不足时按比例缩小，避免截断为省略号。 */
    private void drawFittedText(
        Canvas c,
        String text,
        int w,
        float cy,
        Paint p,
        float maxW,
        float pad,
        float baseSize,
        String align) {
      if (text == null || text.isEmpty() || maxW <= 0) return;
      p.setShader(null);
      p.setTextSize(baseSize);
      float tw = p.measureText(text);
      if (tw > maxW) {
        // 文本过长时按比例缩小字号，最多缩到 55%
        float scale = Math.max(0.55f, maxW / tw);
        p.setTextSize(baseSize * scale);
        tw = p.measureText(text);
      }
      Paint.FontMetrics fm = p.getFontMetrics();
      float y = cy - (fm.ascent + fm.descent) / 2f;
      float x;
      switch (align) {
        case "left":
          x = pad;
          break;
        case "right":
          x = Math.max(pad, w - pad - tw);
          break;
        case "center":
        case "both":
        default:
          x = Math.max(0, (w - tw) / 2f);
          break;
      }
      c.drawText(text, x, y, p);
    }

    private void paintWordLyric(
        Canvas c, Line line, long sk, int w, float cy, float tsz, float pad, float d, int alpha) {
      tp.setTextSize(tsz);
      tp.setTypeface(
          Typeface.create(Typeface.DEFAULT, fontWeight >= 600 ? Typeface.BOLD : Typeface.NORMAL));
      tp.setShader(null);
      // 逐字渲染时关闭 shadow，避免 gradient 模式下出现白色描边
      tp.setShadowLayer(0, 0, 0, 0);
      int n = line.words.size();
      float[] ww = new float[n];
      float total = 0;
      for (int i = 0; i < n; i++) {
        ww[i] = tp.measureText(line.words.get(i).text);
        total += ww[i];
      }
      // 逐字歌词也按比例缩小以适配宽度
      float maxW = w - pad * 2;
      float scale = 1f;
      if (total > maxW && maxW > 0) {
        scale = Math.max(0.55f, maxW / total);
        tp.setTextSize(tsz * scale);
        total = 0;
        for (int i = 0; i < n; i++) {
          ww[i] = tp.measureText(line.words.get(i).text);
          total += ww[i];
        }
      }
      float x;
      switch (alignPosition) {
        case "left":
          x = pad;
          break;
        case "right":
          x = Math.max(pad, w - pad - total);
          break;
        case "center":
        case "both":
        default:
          x = Math.max(pad, (w - total) / 2f);
          break;
      }
      Paint.FontMetrics fm = tp.getFontMetrics();
      float bl = cy - (fm.ascent + fm.descent) / 2f;
      int a = Math.max(0, Math.min(255, alpha));

      for (int i = 0; i < n; i++) {
        Word word = line.words.get(i);
        float prog = wordProg(word, sk);
        tp.setShader(null);
        if (prog <= 0f) {
          tp.setColor((a << 24) | (colorUnplayed & 0x00FFFFFF));
        } else if (prog >= 1f) {
          tp.setColor((a << 24) | (colorPlayed & 0x00FFFFFF));
        } else {
          float sx = x + ww[i] * prog;
          int cp = (a << 24) | (colorPlayed & 0x00FFFFFF);
          int cu = (a << 24) | (colorUnplayed & 0x00FFFFFF);
          tp.setShader(
              new LinearGradient(
                  sx - d * 0.5f, 0, sx + d * 0.5f, 0, cp, cu, Shader.TileMode.CLAMP));
          tp.setColor(Color.WHITE);
        }
        c.drawText(word.text, x, bl, tp);
        x += ww[i];
      }
      tp.setShader(null);
      // 恢复 shadow
      tp.setShadowLayer(2 * d, 0, 0, colorShadow);
    }

    private float wordProg(Word w, long sk) {
      if (sk >= w.end) return 1f;
      if (sk <= w.start) return 0f;
      return (float) (sk - w.start) / Math.max(w.end - w.start, 1f);
    }

    // ---------- 控制栏 ----------

    private void paintControls(Canvas c, int w, int h, float d) {
      float sz = 34 * d, gap = 20 * d;
      float tw = sz * 5 + gap * 4, sx = (w - tw) / 2f;
      float cy = h * 0.58f; // 按钮下移，为顶部歌名留空间
      ip.setTextAlign(Paint.Align.CENTER);
      ip.setTextSize(18 * d);
      ip.setColor(0xFFFFFFFF);

      // 顶部歌名-歌手（对齐桌面端 header）
      if (!songName.isEmpty()) {
        float oldSz = ip.getTextSize();
        int oldColor = ip.getColor();
        ip.setTextSize(14 * d);
        ip.setColor(0xEEFFFFFF);
        ip.setShadowLayer(2 * d, 0, 0, 0x80000000);
        c.drawText(songName + " - " + artistName, w / 2f, h * 0.17f, ip);
        ip.setTextSize(oldSz);
        ip.setColor(oldColor);
        ip.clearShadowLayer();
      }

      drawBtn(c, rLock, sx, cy, sz, d, ICON_LOCK);
      drawBtn(c, rPrev, sx + sz + gap, cy, sz, d, ICON_PREV);
      drawBtn(c, rPlay, sx + (sz + gap) * 2, cy, sz, d, playing ? ICON_PAUSE : ICON_PLAY);
      drawBtn(c, rNext, sx + (sz + gap) * 3, cy, sz, d, ICON_NEXT);
      drawBtn(c, rClose, sx + (sz + gap) * 4, cy, sz, d, ICON_CLOSE);
    }

    private void drawBtn(Canvas c, RectF r, float l, float cy, float sz, float d, int iconType) {
      r.set(l, cy - sz / 2, l + sz, cy + sz / 2);
      bp.setColor(0x40FFFFFF);
      c.drawRoundRect(r, 8 * d, 8 * d, bp);
      drawResIcon(c, iconType, r.centerX(), r.centerY(), sz * 0.58f);
    }

    /** 用 VectorDrawable（复刻桌面端 SVG 图标）绘制按钮图标。 */
    private void drawResIcon(Canvas c, int iconType, float cx, float cy, float sizePx) {
      int resId;
      int tint;
      switch (iconType) {
        case ICON_PLAY:
          resId = R.drawable.lyric_play;
          tint = 0xFFFFFFFF;
          break;
        case ICON_PAUSE:
          resId = R.drawable.lyric_pause;
          tint = 0xFFFFFFFF;
          break;
        case ICON_PREV:
          resId = R.drawable.lyric_prev;
          tint = 0xFFFFFFFF;
          break;
        case ICON_NEXT:
          resId = R.drawable.lyric_next;
          tint = 0xFFFFFFFF;
          break;
        case ICON_CLOSE:
          resId = R.drawable.lyric_close;
          tint = 0xFFFFFFFF;
          break;
        case ICON_LOCK:
          resId = R.drawable.lyric_lock;
          tint = 0xFFFFFFFF;
          break;
        case ICON_UNLOCK:
          resId = R.drawable.lyric_unlock;
          tint = 0xFFFFFFFF;
          break;
        case ICON_HEART:
          resId = R.drawable.lyric_heart;
          tint = COLOR_HEART_LIKED;
          break;
        case ICON_HEART_FILLED:
          resId = R.drawable.lyric_heart_filled;
          tint = COLOR_HEART_LIKED;
          break;
        case ICON_MUSIC:
          resId = R.drawable.lyric_music;
          tint = 0xFFFFFFFF;
          break;
        default:
          return;
      }
      Drawable d = cachedIcon(resId);
      if (d == null) return;
      d.setTint(tint);
      float half = sizePx / 2f;
      d.setBounds((int) (cx - half), (int) (cy - half), (int) (cx + half), (int) (cy + half));
      d.draw(c);
    }

    /** 缓存 VectorDrawable，避免每帧重复加载。 */
    private Drawable cachedIcon(int resId) {
      Drawable d = iconCache.get(resId);
      if (d == null) {
        try {
          d = getResources().getDrawable(resId, null);
          if (d != null) d = d.mutate();
        } catch (Exception e) {
          d = null;
        }
        iconCache.put(resId, d);
      }
      return d;
    }


    /**
     * 平板 header 三栏布局（复刻桌面端图1）：左：音符+歌名歌手；中：上一首/播放暂停/下一首；
     * 右：设置/锁定/关闭。返回 header 高度（px），供歌词绘制下移。
     */
    private float paintTabletHeader(Canvas c, int w, int h, float d) {
      float headerH = Math.min(h * 0.44f, 64 * d);
      ip.setTextAlign(Paint.Align.CENTER);
      ip.setColor(0xFFFFFFFF);

      float cy = headerH * 0.5f;
      float sz = 30 * d;
      float gap = 16 * d;

      // ---- 右侧：红心(收藏) / 锁定 / 关闭 ----
      float rx = w - d * 12 - sz;
      drawBtn(c, rClose, rx, cy, sz, d, ICON_CLOSE);
      drawBtn(c, rLock, rx - sz - gap, cy, sz, d, locked ? ICON_UNLOCK : ICON_LOCK);
      drawBtn(c, rFavorite, rx - (sz + gap) * 2, cy, sz, d, isCurLiked() ? ICON_HEART_FILLED : ICON_HEART);

      // ---- 中部：上一首 / 播放暂停 / 下一首 ----
      float cw = sz * 3 + gap * 2;
      float cx = (w - cw) / 2f;
      drawBtn(c, rPrev, cx, cy, sz, d, ICON_PREV);
      drawBtn(c, rPlay, cx + sz + gap, cy, sz, d, playing ? ICON_PAUSE : ICON_PLAY);
      drawBtn(c, rNext, cx + (sz + gap) * 2, cy, sz, d, ICON_NEXT);

      // ---- 左侧：音符 + 歌名歌手 ----
      float lx = d * 12;
      drawResIcon(c, ICON_MUSIC, lx + 13 * d, cy, sz * 0.48f);
      float iconW = 26 * d;
      float titleX = lx + iconW;
      float cRight = cx - d * 8;
      float titleMaxW = cRight - titleX;
      ip.setColor(0xEEFFFFFF);
      ip.setShadowLayer(2 * d, 0, 0, 0x80000000);
      if (titleMaxW > 24 * d) {
        ip.setTextAlign(Paint.Align.LEFT);
        float oldSz = ip.getTextSize();
        ip.setTextSize(15 * d);
        String title = songName.isEmpty() ? "SPlayer" : songName + " - " + artistName;
        float tw = ip.measureText(title);
        if (tw > titleMaxW) {
          int cut = title.length();
          while (cut > 1 && tw > titleMaxW) {
            cut--;
            tw = ip.measureText(title.substring(0, cut) + "…");
          }
          title = title.substring(0, cut) + "…";
        }
        c.drawText(
            title,
            titleX,
            cy - (ip.getFontMetrics().ascent + ip.getFontMetrics().descent) / 2f,
            ip);
        ip.setTextSize(oldSz);
        rTitle.set(titleX, cy - sz / 2, titleX + tw, cy + sz / 2);
        ip.setTextAlign(Paint.Align.CENTER);
      }
      ip.clearShadowLayer();

      // header 底部分隔线
      bp.setColor(0x28FFFFFF);
      c.drawRect(d * 8, headerH - d, w - d * 8, headerH, bp);
      return headerH;
    }

    // ---------- 工具 ----------

  }

  // ==================== 数据结构 ====================

  static String lineText(Line l) {
    if (l == null || l.words.isEmpty()) return "";
    StringBuilder sb = new StringBuilder();
    for (Word w : l.words) sb.append(w.text);
    return sb.toString();
  }

  static class Line {
    long start, end;
    String tran = "";
    List<Word> words = new ArrayList<>();
  }

  static class Word {
    final String text;
    final long start, end;

    Word(String t, long s, long e) {
      text = t;
      start = s;
      end = e;
    }
  }
}
