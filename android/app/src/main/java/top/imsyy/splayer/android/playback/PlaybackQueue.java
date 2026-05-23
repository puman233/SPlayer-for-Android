package top.imsyy.splayer.android.playback;

import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Java 端自治的滑动窗口播放队列。WebView 冻结时仍能自主切歌。
 *
 * <p>JS 端推 ±N 首窗口（{@code updateQueueContext}），Java 端窗口耗尽时 emit
 * {@code requestUrls} 让 JS 补。不线程安全，依赖 PlaybackManager 的 synchronized。
 *
 * <p>详见 .scratch/native-queue-design.md。
 */
public final class PlaybackQueue {
  /** 当前窗口（已按 shuffleMode 排过序） */
  private List<Track> windowTracks = Collections.emptyList();
  /** 当前正在播的曲目在 windowTracks 中的索引；-1 表示队列空 */
  private int windowCurrentIndex = -1;
  /** 循环模式：跨歌曲行为由此决定 */
  private RepeatMode repeatMode = RepeatMode.OFF;
  /** 全局是否还有上一首 / 下一首（窗口外信息，由 JS 端计算后传入） */
  private boolean hasPreviousOutsideWindow = false;
  private boolean hasNextOutsideWindow = false;
  /** personalFM 模式：单首推进，不预解析多首 */
  private boolean personalFmMode = false;

  public enum RepeatMode {
    OFF,
    ALL,
    ONE;

    public static RepeatMode fromString(@Nullable String value) {
      if (value == null) return OFF;
      switch (value) {
        case "all":
          return ALL;
        case "one":
          return ONE;
        default:
          return OFF;
      }
    }
  }

  /** 单首曲目元数据 + 已解析 URL。 */
  public static final class Track {
    /** 内部 songId。必须 long：2024+ 部分 ID 超过 Integer.MAX_VALUE，int 会溢出为负。 */
    public long songId;
    public long durationMs;
    public boolean canLike;
    public boolean liked;
    public String title = "";
    public String artist = "";
    public String album = "";
    public String coverUrl = "";
    /** 已解析的播放 URL；null 表示尚未解析（Java 端会按需通过 UrlResolver 补齐）。 */
    @Nullable public String url;
    /** 该曲目在 JS 端 playList 中的实际索引，回调时让 JS 直接定位 */
    public int playListIndex = -1;
    /**
     * 显式跳过标志：JS 端 shouldSkipSong（Fuck DJ Mode）置 true。
     *
     * <p>语义与 url==null 严格区分：
     * <ul>
     *   <li>url==null + skipSong=false → 还没 prefetch，Java 应主动解析后播放
     *   <li>skipSong=true → 用户屏蔽，Java 在 advance/back/peek 时直接跳过，不调上游解析接口
     * </ul>
     */
    public boolean skipSong = false;

    public Track copy() {
      Track c = new Track();
      c.songId = songId;
      c.durationMs = durationMs;
      c.canLike = canLike;
      c.liked = liked;
      c.title = title;
      c.artist = artist;
      c.album = album;
      c.coverUrl = coverUrl;
      c.url = url;
      c.playListIndex = playListIndex;
      c.skipSong = skipSong;
      return c;
    }

    public boolean playable() {
      return url != null && !url.isEmpty();
    }
  }

  /** 替换整个窗口（来自 JS 端 updateQueueContext）。 */
  public synchronized void replace(
      List<Track> tracks,
      int currentIndex,
      RepeatMode mode,
      boolean prevOutside,
      boolean nextOutside,
      boolean personalFm) {
    // 拷贝传入列表防御性隔离，避免外部 mutation 影响内部状态
    if (tracks == null || tracks.isEmpty()) {
      windowTracks = Collections.emptyList();
      windowCurrentIndex = -1;
    } else {
      List<Track> copy = new ArrayList<>(tracks.size());
      for (Track t : tracks) {
        if (t != null) copy.add(t.copy());
      }
      windowTracks = copy;
      // -1 透传：表示 JS 端尚未确定 current（如列表瞬时清空），不强制视为 0；
      // 否则 favorite/同步等会作用在错误的"窗口首曲"上。
      if (currentIndex < 0) {
        windowCurrentIndex = -1;
      } else if (currentIndex >= copy.size()) {
        windowCurrentIndex = copy.size() - 1;
      } else {
        windowCurrentIndex = currentIndex;
      }
    }
    repeatMode = mode == null ? RepeatMode.OFF : mode;
    hasPreviousOutsideWindow = prevOutside;
    hasNextOutsideWindow = nextOutside;
    personalFmMode = personalFm;
  }

  /** 当前曲目（可能为 null：队列空 / index 越界）。 */
  @Nullable
  public synchronized Track current() {
    if (windowCurrentIndex < 0 || windowCurrentIndex >= windowTracks.size()) return null;
    return windowTracks.get(windowCurrentIndex);
  }

  /** 当前 index 距窗口右边缘的非 skipSong 剩余首数，<= edgeThreshold 时调用方应 emit requestUrls。 */
  public synchronized int playableTracksAhead() {
    if (windowTracks.isEmpty() || windowCurrentIndex < 0) return 0;
    int count = 0;
    for (int i = windowCurrentIndex + 1; i < windowTracks.size(); i++) {
      if (!windowTracks.get(i).skipSong) count++;
    }
    return count;
  }

  public synchronized boolean hasPreviousOutsideWindow() {
    return hasPreviousOutsideWindow;
  }

  public synchronized boolean hasNextOutsideWindow() {
    return hasNextOutsideWindow;
  }

  /**
   * 推进下一首；跳过 skipSong=true 的曲目（Fuck DJ 等用户级屏蔽），
   * 但不跳过 url==null（让 UrlResolver 后台解析）。
   *
   * @param respectRepeatOne ENDED 调用传 true（响应单曲循环），用户 NEXT 传 false
   */
  @Nullable
  public synchronized Track advanceRaw(boolean respectRepeatOne) {
    if (windowTracks.isEmpty()) return null;
    if (respectRepeatOne && repeatMode == RepeatMode.ONE) {
      return current();
    }
    int probe = windowCurrentIndex + 1;
    while (probe < windowTracks.size()) {
      Track t = windowTracks.get(probe);
      if (!t.skipSong) {
        windowCurrentIndex = probe;
        return t;
      }
      probe++;
    }
    // 窗口右缘：仅当窗口完整覆盖全局列表（前后均无外部歌曲）时，ALL 模式才可在窗口内 wrap。
    // 若 hasNextOutsideWindow=true 或 hasPreviousOutsideWindow=true，必须返 null 让上层 emit
    // requestUrls 让 JS 重新构造窗口（含 wrap 到 0 的语义），否则会跳过窗口外所有曲目错误回到
    // windowTracks[0]。
    if (repeatMode == RepeatMode.ALL
        && !hasPreviousOutsideWindow
        && !hasNextOutsideWindow
        && !windowTracks.isEmpty()) {
      // 窗口完整覆盖全局：从头扫描第一个非 skip 曲目
      for (int i = 0; i < windowTracks.size(); i++) {
        Track t = windowTracks.get(i);
        if (!t.skipSong) {
          windowCurrentIndex = i;
          return t;
        }
      }
    }
    return null;
  }

  /** 后退一首；同样跳过 skipSong=true 的曲目。窗口前缘耗尽返回 null。 */
  @Nullable
  public synchronized Track backRaw() {
    if (windowTracks.isEmpty()) return null;
    int probe = windowCurrentIndex - 1;
    while (probe >= 0) {
      Track t = windowTracks.get(probe);
      if (!t.skipSong) {
        windowCurrentIndex = probe;
        return t;
      }
      probe--;
    }
    return null;
  }

  /** 从当前 index 之后取 N 首 url==null 且 !skipSong 的曲目；UrlResolver 据此后台批量预解析。 */
  public synchronized List<Track> peekUpcomingUnresolved(int count) {
    List<Track> out = new ArrayList<>(count);
    if (windowTracks.isEmpty() || windowCurrentIndex < 0) return out;
    for (int i = windowCurrentIndex + 1; i < windowTracks.size() && out.size() < count; i++) {
      Track t = windowTracks.get(i);
      if (t.url == null && !t.skipSong) out.add(t);
    }
    return out;
  }

  /**
   * 取窗口内当前曲目之后 N 首已 resolved 的 URL 列表（!skipSong）。<br>
   * 供 Java 端音频字节预载用：锁屏 / WebView 冻结时仍能保证下一首切歌秒响。
   */
  public synchronized List<String> peekUpcomingResolvedUrls(int count) {
    List<String> out = new ArrayList<>(count);
    if (windowTracks.isEmpty() || windowCurrentIndex < 0) return out;
    for (int i = windowCurrentIndex + 1; i < windowTracks.size() && out.size() < count; i++) {
      Track t = windowTracks.get(i);
      if (t.url != null && !t.url.isEmpty() && !t.skipSong) out.add(t.url);
    }
    return out;
  }

  /** 用 songId 在窗口里查找 Track 的当前 URL；找不到 / 未解析返 null。 */
  @Nullable
  public synchronized String findUrlBySongId(long songId) {
    for (Track t : windowTracks) {
      if (t.songId == songId) {
        return t.url;
      }
    }
    return null;
  }

  /** 用 songId 在窗口里查找 Track 并就地写回 url（UrlResolver 解析完成回调用）。 */
  public synchronized boolean updateTrackUrl(long songId, @Nullable String url) {
    if (url == null || url.isEmpty()) return false;
    for (Track t : windowTracks) {
      if (t.songId == songId) {
        t.url = url;
        return true;
      }
    }
    return false;
  }

  public synchronized boolean isPersonalFm() {
    return personalFmMode;
  }

  public synchronized RepeatMode getRepeatMode() {
    return repeatMode;
  }

  public synchronized boolean isEmpty() {
    return windowTracks.isEmpty();
  }
}
