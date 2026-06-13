package top.imsyy.splayer.android.playback;

import android.util.Log;
import androidx.annotation.Nullable;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Java 端 URL 解析器。WebView 冻结时仍可通过本地 embedded API（127.0.0.1:1145）拿到播放地址。
 *
 * <p>{@link #resolveSync} 阻塞调 /song/url/v1；{@link #prefetchAsync} 后台解析并写回
 * track.url。内置 64 项 LRU 缓存，2 线程并发。
 */
public final class PlaybackUrlResolver {
  private static final String TAG = "UrlResolver";
  private static final int CONNECT_TIMEOUT_MS = 8000;
  private static final int READ_TIMEOUT_MS = 8000;
  private static final int CACHE_SIZE = 64;
  /** 失败 songId 短期负缓存窗口（毫秒）：跨多次 prefetch 周期同一首失败时避免持续打上游 /song/url 接口。 */
  private static final long NEGATIVE_CACHE_TTL_MS = 30_000L;

  /** 2 线程：避免「播放刚起 + 用户立刻 NEXT」被串行。上游接口有节流，不宜调高。 */
  private final ExecutorService executor = Executors.newFixedThreadPool(2);

  /** cacheKey("songId:level") → URL。level 不同 → 文件/码率/endpoint 都可能不同，必须分键。 */
  private final LinkedHashMap<String, String> cache =
      new LinkedHashMap<String, String>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
          return size() > CACHE_SIZE;
        }
      };

  /** 正在解析的 songId 去重（LinkedHashMap 充当 set）。 */
  private final LinkedHashMap<Long, AtomicBoolean> inFlight = new LinkedHashMap<>();

  /** cacheKey("songId:level") → 失败时间戳；TTL 内重复请求直接返 null，避免 API 打风暴。 */
  private final LinkedHashMap<String, Long> negativeCache =
      new LinkedHashMap<String, Long>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
          return size() > CACHE_SIZE;
        }
      };

  private volatile String apiBaseUrl = "";
  private volatile String cookie = "";
  private volatile String songLevel = "exhigh";
  private volatile boolean disableAiAudio = false;
  private volatile boolean playSongDemo = false;

  private static String normalizeLevel(@Nullable String level, boolean disableAiAudio) {
    if (level == null || level.isEmpty()) return "exhigh";
    if (disableAiAudio
        && ("jymaster".equals(level)
            || "sky".equals(level)
            || "jyeffect".equals(level)
            || "vivid".equals(level))) {
      return "hires";
    }
    return level;
  }

  private static String[] getRequestLevels(String level) {
    if ("dolby".equals(level)) return new String[] {"dolby", "hires", "lossless", "exhigh"};
    if ("standard".equals(level)) return new String[] {level};
    if ("higher".equals(level)) return new String[] {"higher", "exhigh"};
    if ("hires".equals(level)) return new String[] {"hires", "lossless", "exhigh"};
    if ("lossless".equals(level)) return new String[] {"lossless", "exhigh"};
    if ("exhigh".equals(level)) return new String[] {"exhigh"};
    return new String[] {level, "hires", "lossless", "exhigh"};
  }

  private static String qualityKeyForLevel(String level) {
    if ("standard".equals(level)) return "l";
    if ("higher".equals(level)) return "m";
    if ("exhigh".equals(level)) return "h";
    if ("lossless".equals(level)) return "sq";
    if ("hires".equals(level)) return "hr";
    if ("jyeffect".equals(level)) return "je";
    if ("sky".equals(level)) return "sk";
    if ("jymaster".equals(level)) return "jm";
    if ("dolby".equals(level)) return "db";
    return "";
  }

  private static boolean isPlayableQualityLevel(@Nullable JSONObject qualityData, String level) {
    if (qualityData == null || "exhigh".equals(level)) return true;
    String key = qualityKeyForLevel(level);
    if (key.isEmpty()) return true;
    JSONObject quality = qualityData.optJSONObject(key);
    return quality != null && quality.optLong("br", 0L) > 0L;
  }

  private static String[] filterRequestLevels(String[] levels, @Nullable JSONObject qualityData) {
    if (qualityData == null) return levels;
    List<String> out = new ArrayList<>();
    for (String level : levels) {
      if (isPlayableQualityLevel(qualityData, level)) out.add(level);
    }
    return out.toArray(new String[0]);
  }

  public synchronized void updateContext(
      @Nullable String baseUrl,
      @Nullable String cookieValue,
      @Nullable String level,
      boolean disableAiAudioState,
      boolean playSongDemoState) {
    String newBaseUrl = baseUrl == null ? "" : baseUrl.trim();
    String newCookie = cookieValue == null ? "" : cookieValue.trim();
    String newLevel = normalizeLevel(level != null && !level.isEmpty() ? level : this.songLevel, disableAiAudioState);

    // 任一上下文变化都要清缓存：
    // - level 变 → URL 文件/码率/endpoint 不同
    // - cookie 变 → 换账号，旧账号缓存的 VIP URL / 失败记录都不再适用
    // - baseUrl 变 → embedded API 地址变更（极罕见），缓存失效
    boolean contextChanged =
        !newBaseUrl.equals(this.apiBaseUrl)
            || !newCookie.equals(this.cookie)
            || !newLevel.equals(this.songLevel)
            || disableAiAudioState != this.disableAiAudio
            || playSongDemoState != this.playSongDemo;

    this.apiBaseUrl = newBaseUrl;
    this.cookie = newCookie;
    this.songLevel = newLevel;
    this.disableAiAudio = disableAiAudioState;
    this.playSongDemo = playSongDemoState;

    if (contextChanged) {
      synchronized (cache) {
        cache.clear();
      }
      synchronized (negativeCache) {
        negativeCache.clear();
      }
    }
  }

  public void clear(long songId) {
    if (songId <= 0) return;
    String prefix = songId + ":";
    synchronized (cache) {
      cache.entrySet().removeIf(entry -> entry.getKey().startsWith(prefix));
    }
    synchronized (negativeCache) {
      negativeCache.entrySet().removeIf(entry -> entry.getKey().startsWith(prefix));
    }
  }

  /** 阻塞解析 songId 的 URL；命中缓存 / 失败 / 未配置返 null。 */
  @Nullable
  public String resolveSync(long songId) {
    if (songId <= 0) return null;
    String level;
    String baseUrl;
    String cookieValue;
    boolean allowTrial;
    synchronized (this) {
      level = normalizeLevel(songLevel, disableAiAudio);
      baseUrl = apiBaseUrl;
      cookieValue = cookie;
      allowTrial = playSongDemo;
    }
    String cacheKey = songId + ":" + level;
    String originalCacheKey = cacheKey;
    synchronized (cache) {
      String hit = cache.get(cacheKey);
      if (hit != null) return hit;
    }
    // 负缓存命中：TTL 内跳过重复网络调用。仅业务层“无可播 URL”入负缓存，
    // 网络异常/超时/HTTP 非 200 不入负缓存，以免临时故障吃掉后续 retry 机会。
    synchronized (negativeCache) {
      Long failedAt = negativeCache.get(cacheKey);
      if (failedAt != null) {
        if (System.currentTimeMillis() - failedAt < NEGATIVE_CACHE_TTL_MS) {
          return null;
        }
        negativeCache.remove(cacheKey);
      }
    }
    if (baseUrl.isEmpty()) {
      Log.w(TAG, "resolveSync skipped: apiBaseUrl empty");
      return null;
    }

    JSONObject qualityData = null;
    if ("dolby".equals(level)
        || "jymaster".equals(level)
        || "sky".equals(level)
        || "jyeffect".equals(level)) {
      qualityData = fetchQualityData(baseUrl, cookieValue, songId);
      if (qualityData != null && !isPlayableQualityLevel(qualityData, level)) {
        level = "hires";
        cacheKey = songId + ":" + level;
      }
    }

    String resolvedUrl = null;
    boolean hadNetworkFailure = false;
    boolean hadBusinessResponse = false;
    String resolvedLevel = level;
    String[] requestLevels = filterRequestLevels(getRequestLevels(level), qualityData);
    if (requestLevels.length == 0) {
      synchronized (negativeCache) {
        negativeCache.put(originalCacheKey, System.currentTimeMillis());
        negativeCache.put(cacheKey, System.currentTimeMillis());
      }
      return null;
    }
    for (String requestLevel : requestLevels) {
      HttpURLConnection connection = null;
      try {
        // dolby 走旧版接口，其余走 /song/url/v1
        String endpoint;
        if ("dolby".equals(requestLevel)) {
          endpoint =
              baseUrl
                  + "/song/url?id="
                  + songId
                  + "&br=999000&immerseType=c51&timestamp="
                  + System.currentTimeMillis();
        } else {
          endpoint =
              baseUrl
                  + "/song/url/v1?id="
                  + songId
                  + "&level="
                  + URLEncoder.encode(requestLevel, StandardCharsets.UTF_8.name())
                  + "&timestamp="
                  + System.currentTimeMillis();
        }
        if (!cookieValue.isEmpty()) {
          endpoint += "&cookie=" + URLEncoder.encode(cookieValue, StandardCharsets.UTF_8.name());
        }

        connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        if (!cookieValue.isEmpty()) {
          connection.setRequestProperty("Cookie", cookieValue);
        }
        connection.connect();

        int httpCode = connection.getResponseCode();
        if (httpCode != HttpURLConnection.HTTP_OK) {
          Log.w(TAG, "resolveSync songId=" + songId + " level=" + requestLevel + " http=" + httpCode);
          hadNetworkFailure = true;
        } else {
          hadBusinessResponse = true;
          String body = readBody(connection);
          JSONObject root = new JSONObject(body);
          JSONArray data = root.optJSONArray("data");
          if (data != null && data.length() > 0) {
            JSONObject first = data.optJSONObject(0);
            if (first != null) {
              String url = first.optString("url", "");
              if (!first.isNull("freeTrialInfo") && !allowTrial) {
                Log.w(TAG, "resolveSync songId=" + songId + " level=" + requestLevel + " trial skipped");
                continue;
              }
              if (!url.isEmpty() && !"null".equals(url)) {
                resolvedUrl = url;
                resolvedLevel = requestLevel;
                break;
              }
            }
          }
        }
      } catch (Exception e) {
        Log.w(TAG, "resolveSync failed songId=" + songId + " level=" + requestLevel, e);
        hadNetworkFailure = true;
      } finally {
        if (connection != null) connection.disconnect();
      }
    }

    if (resolvedUrl != null) {
      synchronized (cache) {
        cache.put(originalCacheKey, resolvedUrl);
        cache.put(cacheKey, resolvedUrl);
        cache.put(songId + ":" + resolvedLevel, resolvedUrl);
      }
      synchronized (negativeCache) {
        negativeCache.remove(originalCacheKey);
        negativeCache.remove(cacheKey);
        negativeCache.remove(songId + ":" + resolvedLevel);
      }
      return resolvedUrl;
    }
    if (hadBusinessResponse) {
      synchronized (negativeCache) {
        negativeCache.put(originalCacheKey, System.currentTimeMillis());
        negativeCache.put(cacheKey, System.currentTimeMillis());
      }
    }
    return null;
  }

  /**
   * 在内部线程池上异步解析 songId 的播放 URL，结果通过回调返回（运行在池线程，调用方自行 post 主线程）。
   *
   * <p>用于 NEXT/PREV 等需要立即播放的场景，避免共享 PlaybackManager 单线程 networkExecutor 与
   * favorite 请求互锁，同时享用 inFlight 去重 + cache 命中。
   *
   * @param songId 待解析的 songId
   * @param callback 解析回调（参数为 URL 或 null）
   */
  public void submitResolve(long songId, @Nullable java.util.function.Consumer<String> callback) {
    if (songId <= 0) {
      if (callback != null) callback.accept(null);
      return;
    }
    executor.submit(
        () -> {
          String url = resolveSync(songId);
          if (callback != null) callback.accept(url);
        });
  }

  /**
   * 后台解析 track.url，成功同步写回队列。
   *
   * @param onResolved 解析完成回调（运行在池线程，需自行 post 到主线程）
   */
  public void prefetchAsync(
      PlaybackQueue.Track track,
      PlaybackQueue queue,
      @Nullable Runnable onResolved) {
    if (track == null || track.songId <= 0 || track.playable()) return;
    long songId = track.songId;
    AtomicBoolean flag;
    synchronized (inFlight) {
      flag = inFlight.get(songId);
      if (flag != null && flag.get()) return; // 已有进行中的 task
      flag = new AtomicBoolean(true);
      inFlight.put(songId, flag);
    }
    final AtomicBoolean flagRef = flag;
    executor.submit(
        () -> {
          try {
            String url = resolveSync(songId);
            if (url != null) {
              track.url = url;
              if (queue != null) queue.updateTrackUrl(songId, url);
            }
            if (onResolved != null) onResolved.run();
          } finally {
            synchronized (inFlight) {
              flagRef.set(false);
              if (inFlight.get(songId) == flagRef) {
                inFlight.remove(songId);
              }
            }
          }
        });
  }

  private static String readBody(HttpURLConnection connection) throws Exception {
    try (BufferedReader reader =
        new BufferedReader(
            new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
      StringBuilder sb = new StringBuilder();
      String line;
      while ((line = reader.readLine()) != null) sb.append(line);
      return sb.toString();
    }
  }

  @Nullable
  private static JSONObject fetchQualityData(String baseUrl, String cookieValue, long songId) {
    HttpURLConnection connection = null;
    try {
      String endpoint =
          baseUrl
              + "/song/music/detail?id="
              + songId
              + "&timestamp="
              + System.currentTimeMillis();
      if (!cookieValue.isEmpty()) {
        endpoint += "&cookie=" + URLEncoder.encode(cookieValue, StandardCharsets.UTF_8.name());
      }
      connection = (HttpURLConnection) new URL(endpoint).openConnection();
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
      connection.setReadTimeout(READ_TIMEOUT_MS);
      connection.setRequestProperty("Accept", "application/json");
      if (!cookieValue.isEmpty()) {
        connection.setRequestProperty("Cookie", cookieValue);
      }
      connection.connect();
      if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
      JSONObject root = new JSONObject(readBody(connection));
      return root.optJSONObject("data");
    } catch (Exception e) {
      Log.w(TAG, "fetchQualityData failed songId=" + songId, e);
      return null;
    } finally {
      if (connection != null) connection.disconnect();
    }
  }
}
