package top.imsyy.splayer.android.cache;

import android.content.Context;
import android.os.StatFs;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 统一缓存存储：cacheDir 下分类型子目录，全局 LRU（按 mtime），严格遵从 maxBytes。
 *
 * <p>设计要点：
 *
 * <ul>
 *   <li>落盘到 {@link Context#getCacheDir()}，App 卸载随系统清理；ROM 「应用缓存」识别。
 *   <li>所有文件统一 {@code .bin} 扩展名，避开 MediaStore 扫描。
 *   <li>{@code .nomedia} 兜底。
 *   <li>读命中时刷新 mtime，确保「最近播放」不被误删。
 *   <li>写后概率性触发驱逐（10%），全局节流。手动调用 {@link #enforceLimit()} 立即执行。
 *   <li>maxBytes 由用户在 setting 设置严格生效；运行期不擅自下调。
 * </ul>
 */
public final class CacheStorage {

  private static final String TAG = "CacheStorage";
  /** 默认 5GB；setting 端调用 setMaxBytes 之前的兜底值。 */
  private static final long DEFAULT_MAX_BYTES = 5L * 1024 * 1024 * 1024;
  /** 最低 256MB：低于此值频繁驱逐反而损伤体验。 */
  private static final long MIN_MAX_BYTES = 256L * 1024 * 1024;
  /** 驱逐回到 80% 水位（避免抖动反复触发）。 */
  private static final double EVICT_TARGET_RATIO = 0.8;
  /** 写入后随机触发驱逐检查的概率，节流 stat 调用。 */
  private static final double EVICT_PROBE_PROB = 0.1;
  /** 文件扩展名：所有缓存文件统一 .bin 防 MediaStore 扫描。 */
  public static final String CACHE_EXT = ".bin";

  /** 已知缓存类型子目录名。新增类型在此扩展。ExoPlayer 的 exo/ 子目录由音频侧管理但参与全局 LRU。 */
  public static final String TYPE_LYRICS = "lyrics";

  public static final String TYPE_COVERS = "covers";
  public static final String TYPE_LIST_COVERS = "list-covers";
  public static final String TYPE_LIST_DATA = "list-data";
  public static final String TYPE_AUDIO = "exo"; // ExoPlayer SimpleCache 子目录

  private static final String[] ALL_TYPES = {
    TYPE_LYRICS, TYPE_COVERS, TYPE_LIST_COVERS, TYPE_LIST_DATA, TYPE_AUDIO
  };

  @SuppressWarnings("StaticFieldLeak")
  private static volatile CacheStorage instance;

  private final Context appContext;
  private final File rootDir;
  private final ExecutorService writeExecutor = Executors.newSingleThreadExecutor();
  private final AtomicLong maxBytes = new AtomicLong(DEFAULT_MAX_BYTES);

  /** 上次「驱逐至失败」日志时间戳，避免日志洪水。 */
  private volatile long lastEvictWarnAtMs = 0L;

  /**
   * 内存索引：type → 当前总字节。读 O(1) 替代扫盘。<br>
   * 维护策略：
   * <ul>
   *   <li>构造期一次性 baseline 扫描所有 type 子目录
   *   <li>{@link #write} 成功后增量加（若文件已存在则先减旧 size）
   *   <li>{@link #remove} / {@link #clear} 同步减或归零
   *   <li>{@link #enforceLimit} 删文件时同步减
   *   <li>{@code audio} 类型不进此 map（由 ExoPlayer SimpleCache.getCacheSpace 直接返）
   *   <li>启动后每 30min reconcile 一次：和实际扫描值对账，漂移 > 5% 则纠正
   * </ul>
   */
  private final ConcurrentHashMap<String, AtomicLong> perTypeBytes = new ConcurrentHashMap<>();

  /** 上次 reconcile 时间戳，防止短时间重复扫盘。 */
  private volatile long lastReconcileAtMs = 0L;

  /** reconcile 节流间隔：30 分钟。 */
  private static final long RECONCILE_INTERVAL_MS = 30L * 60L * 1000L;

  /** mtime 节流间隔：1 小时；read 命中时若 mtime 已 < 1h 前则不再 setLastModified。 */
  private static final long MTIME_THROTTLE_MS = 60L * 60L * 1000L;

  /**
   * 单次 read 返回给 JS 的上限：8MB。封面/歌词<2MB，list-data 歌单<5MB，8MB 足够且避免低端机 OOM。<br>
   * 超过该大小一定是异常（调用方错误使用 /烒文件写入），提前 reject。
   */
  private static final long MAX_READ_BYTES = 8L * 1024 * 1024;

  /**
   * 设备剩余空间不足时的自适应上限比例：缓存总占用不能超过剩余空间 × 60%。<br>
   * 例：设备剩 8GB → 有效封顶 4.8GB；设备剩 4GB → 有效封顶 2.4GB。<br>
   * 仅在该限制低于用户设定值时生效；高于用户设定仍以用户设定为准。
   */
  private static final double ADAPTIVE_FREE_RATIO = 0.6;

  private CacheStorage(@NonNull Context context) {
    this.appContext = context.getApplicationContext();
    this.rootDir = appContext.getCacheDir();
    if (!rootDir.exists()) {
      // noinspection ResultOfMethodCallIgnored
      rootDir.mkdirs();
    }
    ensureNoMediaSentinel();
    for (String type : ALL_TYPES) {
      ensureTypeDir(type);
      // 非 audio 类型预创建索引项（audio 走 SimpleCache.getCacheSpace 不入索引）
      if (!TYPE_AUDIO.equals(type)) {
        perTypeBytes.put(type, new AtomicLong(0L));
      }
    }
    // 构造期 baseline scan：后台线程跑，不阻塞首屏
    writeExecutor.submit(this::reconcileAllNow);
  }

  public static CacheStorage getInstance(@NonNull Context context) {
    if (instance == null) {
      synchronized (CacheStorage.class) {
        if (instance == null) {
          instance = new CacheStorage(context);
        }
      }
    }
    return instance;
  }

  /** 设置缓存上限（字节），最小 256MB；低于则按 256MB 处理。 */
  public void setMaxBytes(long bytes) {
    long clamped = Math.max(MIN_MAX_BYTES, bytes);
    long old = maxBytes.getAndSet(clamped);
    if (old != clamped) {
      // 上限调小时立即异步驱逐
      writeExecutor.submit(this::enforceLimit);
    }
  }

  /** 返回用户设定的原始上限（设置面板展示用）；不含设备容量自适应调控。 */
  public long getMaxBytes() {
    return maxBytes.get();
  }

  /**
   * 返回运行期生效的上限。计算逻辑：
   *
   * <ol>
   *   <li>读用户设定值 {@code maxBytes}（同 {@link #getMaxBytes}）
   *   <li>读设备剩余可用空间 {@code free}；StatFs 失败 (-1) 时跳过自适应
   *   <li>取 {@code min(maxBytes, free * 0.6)}，再与 {@link #MIN_MAX_BYTES} 取 max
   * </ol>
   *
   * <p>例：用户设 5GB、设备剩 8GB → effective = min(5GB, 4.8GB) = 4.8GB；<br>
   * 用户设 5GB、设备剩 20GB → effective = min(5GB, 12GB) = 5GB（用户设为准）。
   */
  public long getEffectiveMaxBytes() {
    long userMax = maxBytes.get();
    long free = getDeviceFreeBytes();
    if (free < 0) return userMax; // 读不出剩余空间，退化为用户设定
    long adaptive = (long) (free * ADAPTIVE_FREE_RATIO);
    long effective = Math.min(userMax, adaptive);
    return Math.max(MIN_MAX_BYTES, effective);
  }

  /** 当前剩余可用磁盘空间（用于 UI 校验，不参与运行期 cap 计算）。 */
  public long getDeviceFreeBytes() {
    try {
      StatFs stat = new StatFs(rootDir.getAbsolutePath());
      return stat.getAvailableBytes();
    } catch (Exception e) {
      return -1L;
    }
  }

  /** 获取总占用（O(1)：累加内存索引 + audio SimpleCache 占用）。 */
  public long getTotalBytes() {
    long total = 0L;
    for (String type : ALL_TYPES) {
      total += getTypeBytes(type);
    }
    return total;
  }

  /** 单类型占用 O(1)：非 audio 类型读内存索引；audio 走 SimpleCache.getCacheSpace。 */
  public long getTypeBytes(@NonNull String type) {
    if (TYPE_AUDIO.equals(type)) {
      return getAudioCacheSpace();
    }
    AtomicLong v = perTypeBytes.get(type);
    return v == null ? 0L : v.get();
  }

  /** 全部类型分项占用 O(1)。 */
  public Map<String, Long> getPerTypeBytes() {
    Map<String, Long> map = new HashMap<>();
    for (String type : ALL_TYPES) {
      map.put(type, getTypeBytes(type));
    }
    return map;
  }

  /**
   * 读 ExoPlayer SimpleCache 当前占用 —— 它内部已维护索引，O(1) 无扫盘。<br>
   * SimpleCache 尚未初始化（应用启动早期）则回退到一次性扫盘。
   */
  private long getAudioCacheSpace() {
    try {
      androidx.media3.datasource.cache.SimpleCache cache =
          AudioCacheProvider.peekSimpleCache();
      if (cache != null) return cache.getCacheSpace();
    } catch (Throwable e) {
      // SimpleCache 不可用时静默回退
    }
    return dirSize(typeDir(TYPE_AUDIO));
  }

  /** 读取（命中后节流刷新 mtime 让 LRU 视作最近使用）。 */
  @Nullable
  public byte[] read(@NonNull String type, @NonNull String key) {
    if (TYPE_AUDIO.equals(type)) {
      // audio 由 ExoPlayer SimpleCache 内部读取；JS 侧不应走 read('exo', …)。
      Log.w(TAG, "read('exo', " + key + ") rejected: audio cache is managed by SimpleCache");
      return null;
    }
    File f = fileFor(type, key);
    if (!f.isFile()) return null;
    long fileLen = f.length();
    if (fileLen > MAX_READ_BYTES) {
      Log.w(TAG, "read rejected: " + type + "/" + key + " size=" + fileLen + " > " + MAX_READ_BYTES);
      return null;
    }
    long oldMtime = f.lastModified();
    try (FileInputStream fis = new FileInputStream(f);
        ByteArrayOutputStream bos =
            new ByteArrayOutputStream(Math.max(1024, (int) Math.min(fileLen, MAX_READ_BYTES)))) {
      byte[] buf = new byte[8192];
      int n;
      while ((n = fis.read(buf)) != -1) bos.write(buf, 0, n);
      byte[] data = bos.toByteArray();
      // mtime 节流：仅在距上次更新已超 1 小时才 setLastModified，避免高频读触发 metadata 写
      long now = System.currentTimeMillis();
      if (now - oldMtime > MTIME_THROTTLE_MS) {
        // noinspection ResultOfMethodCallIgnored
        f.setLastModified(now);
      }
      return data;
    } catch (IOException e) {
      Log.w(TAG, "read failed: " + type + "/" + key, e);
      return null;
    }
  }

  /** 写入（同步路径；调用方需自行决定是否在异步线程执行）。写到 .tmp 后 rename，保证原子性。 */
  public boolean write(@NonNull String type, @NonNull String key, @NonNull byte[] data) {
    if (TYPE_AUDIO.equals(type)) {
      // 避免使用者在 audio/exo 目录写入普通 .bin；会被 SimpleCache 忽略并永不被 LRU 驱逐。
      Log.w(TAG, "write('exo', " + key + ") rejected: audio cache is managed by SimpleCache");
      return false;
    }
    File f = fileFor(type, key);
    File parent = f.getParentFile();
    if (parent != null && !parent.exists()) {
      // noinspection ResultOfMethodCallIgnored
      parent.mkdirs();
    }
    // 若文件已存在，先记录旧 size 用于索引差分
    long oldSize = f.isFile() ? f.length() : 0L;
    // 原子写：写临时文件 → rename 覆盖；进程被杀 / OOM 不会产生半截断缓存。
    // tmp 名带 UUID 防并发写同一 key 时互改 .tmp。Capacitor 插件多线程调用 + 内部 writeAsync 可能同时出现。
    File tmp = new File(f.getParentFile(), f.getName() + "." + UUID.randomUUID() + ".tmp");
    try (FileOutputStream fos = new FileOutputStream(tmp)) {
      fos.write(data);
      fos.getFD().sync();
    } catch (IOException e) {
      // noinspection ResultOfMethodCallIgnored
      tmp.delete();
      long now = System.currentTimeMillis();
      if (now - lastEvictWarnAtMs > 60_000L) {
        Log.w(TAG, "write failed (磁盘不足或 IO 异常): " + type + "/" + key, e);
        lastEvictWarnAtMs = now;
      }
      return false;
    }
    // rename 原子覆盖；Windows 上 rename 覆盖已存在文件会失败，先 delete（Android 实际是 POSIX 语义可直接覆盖，但保险起见）。
    if (f.exists() && !f.delete()) {
      Log.w(TAG, "write rename: 预删旧文件失败 " + type + "/" + key);
    }
    if (!tmp.renameTo(f)) {
      // noinspection ResultOfMethodCallIgnored
      tmp.delete();
      Log.w(TAG, "write rename failed: " + type + "/" + key);
      return false;
    }
    // 内存索引增量维护：新 size - 旧 size
    addBytes(type, data.length - oldSize);
    // 节流触发驱逐：内存索引 O(1)，可以提高检查频率（仍走异步线程）
    if (Math.random() < EVICT_PROBE_PROB) {
      writeExecutor.submit(this::enforceLimit);
    }
    // 周期 reconcile：30min 跑一次，纠正外部修改 / 索引漂移
    maybeReconcile();
    return true;
  }

  /** 异步写入。 */
  public void writeAsync(@NonNull String type, @NonNull String key, @NonNull byte[] data) {
    writeExecutor.submit(() -> write(type, key, data));
  }

  /** 删除单文件。 */
  public boolean remove(@NonNull String type, @NonNull String key) {
    if (TYPE_AUDIO.equals(type)) {
      Log.w(TAG, "remove('exo', " + key + ") rejected: audio cache is managed by SimpleCache");
      return false;
    }
    File f = fileFor(type, key);
    if (!f.isFile()) return false;
    long size = f.length();
    boolean ok = f.delete();
    if (ok) addBytes(type, -size);
    return ok;
  }

  /** 列出某类型下所有缓存文件（递归）。 */
  @NonNull
  public List<CacheEntry> list(@NonNull String type) {
    List<CacheEntry> out = new ArrayList<>();
    collectFiles(typeDir(type), type, out);
    return out;
  }

  /**
   * 清空单类型。
   *
   * <p>{@code exo}（音频）走 SimpleCache.removeResource：不能直接 deleteRecursive，
   * 否则活跃 SimpleCache 实例仍报握内部 ContentIndex，后续写入或 sweep 会招致索引/磁盘不一致。
   */
  public boolean clear(@NonNull String type) {
    if (TYPE_AUDIO.equals(type)) {
      AudioCacheProvider.clearAll(appContext);
      return true;
    }
    File dir = typeDir(type);
    boolean ok = deleteRecursive(dir);
    ensureTypeDir(type); // 重建空目录
    AtomicLong v = perTypeBytes.get(type);
    if (v != null) v.set(0L);
    return ok;
  }

  /** 清空所有类型。 */
  public boolean clearAll() {
    boolean allOk = true;
    for (String type : ALL_TYPES) {
      allOk = clear(type) && allOk;
    }
    ensureNoMediaSentinel();
    // 全清后索引归零（clear 已分别 set 0，这里 paranoia 二次确认）
    for (AtomicLong v : perTypeBytes.values()) {
      v.set(0L);
    }
    return allOk;
  }

  /**
   * 全局 LRU 驱逐：扫描所有类型，按 mtime 升序删除直到回到 maxBytes * 80%。
   *
   * <p>同步执行；调用方按需放到 {@link #writeExecutor}。
   * <p>驱逐时同步更新内存索引；audio 类型由 ExoPlayer 自管，这里不扫 exo/ 目录。
   */
  public synchronized void enforceLimit() {
    // 走有效上限：设备空间不足时会从 DEFAULT_MAX_BYTES 自适应降到 free * 60%。
    long limit = getEffectiveMaxBytes();
    // 快照 audio size：避免二轮计算 nonAudio 时与首轮 total 不一致。
    long audioSnapshot = getTypeBytes(TYPE_AUDIO);
    long nonAudioSnapshot = 0L;
    for (String t : ALL_TYPES) {
      if (TYPE_AUDIO.equals(t)) continue;
      nonAudioSnapshot += getTypeBytes(t);
    }
    long total = audioSnapshot + nonAudioSnapshot;
    if (total <= limit) return;

    long target = (long) (limit * EVICT_TARGET_RATIO);

    List<CacheEntry> all = new ArrayList<>();
    for (String type : ALL_TYPES) {
      // 这一轮仅收集非 audio：audio 不能走 file-level deleteRecursive（会破坏 SimpleCache 索引），
      // 后面如果还超配额统一交给 AudioCacheProvider.enforceLimitTo 走 SimpleCache.removeResource 路径。
      if (TYPE_AUDIO.equals(type)) continue;
      collectFiles(typeDir(type), type, all);
    }
    // 按 mtime 升序：最旧的先删
    all.sort(Comparator.comparingLong(e -> e.mtime));

    long deleted = 0L;
    for (CacheEntry e : all) {
      if (total - deleted <= target) break;
      File f = new File(e.absolutePath);
      long size = e.size;
      if (f.delete()) {
        deleted += size;
        addBytes(e.type, -size);
      }
    }
    long nonAudioAfter = nonAudioSnapshot - deleted;
    // 二轮：非 audio 全删完仍超额 → 压缩 audio。计算使用快照的 audio size 避免中途变化调控偏差。
    if (nonAudioAfter + audioSnapshot > limit) {
      long audioBudget = Math.max(0L, limit - nonAudioAfter);
      AudioCacheProvider.enforceLimitTo(appContext, audioBudget);
    }
    Log.i(
        TAG,
        "enforceLimit: 非 audio 已驱逐 " + deleted + " 字节，总计回到 " + getTotalBytes() + "/" + limit);
  }

  /** 计算给定 url 的缓存 key（md5 hex）。封面 / list-data 等有 url 的场景使用。 */
  @NonNull
  public static String keyFromUrl(@NonNull String url) {
    try {
      MessageDigest md = MessageDigest.getInstance("MD5");
      byte[] digest = md.digest(url.getBytes("UTF-8"));
      StringBuilder sb = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        String hex = Integer.toHexString(b & 0xFF);
        if (hex.length() == 1) sb.append('0');
        sb.append(hex);
      }
      return sb.toString();
    } catch (Exception e) {
      // 兜底：直接 hashCode（碰撞概率高，但不致命）
      return Integer.toHexString(url.hashCode());
    }
  }

  /** ExoPlayer SimpleCache 路径：cacheDir/exo/。供 PlaybackManager 构造 SimpleCache 用。 */
  @NonNull
  public File getAudioCacheDir() {
    return ensureTypeDir(TYPE_AUDIO);
  }

  // ==================== 内部 ====================

  /** 缓存项元数据。 */
  public static final class CacheEntry {
    public final String type;
    public final String key;
    public final long size;
    public final long mtime;
    public final String absolutePath;

    public CacheEntry(String type, String key, long size, long mtime, String absolutePath) {
      this.type = type;
      this.key = key;
      this.size = size;
      this.mtime = mtime;
      this.absolutePath = absolutePath;
    }
  }

  /** type 白名单（与 plugin 层 ALLOWED_TYPES 同步），用 Set 加速校验。 */
  private static final java.util.Set<String> KNOWN_TYPE_SET =
      new java.util.HashSet<>(java.util.Arrays.asList(ALL_TYPES));

  /**
   * 解析 type 子目录。
   *
   * <ol>
   *   <li>type 必须在白名单 {@link #ALL_TYPES} 内
   *   <li>canonical 路径必须以 rootDir 为前缀（防 Windows/Linux 任意符号链接 / 路径穿越）
   * </ol>
   *
   * 不满足任一条件直接抛 IAE：违法调用方应当被立刻发现，不可静默回退。
   */
  private File typeDir(@NonNull String type) {
    if (!KNOWN_TYPE_SET.contains(type)) {
      throw new IllegalArgumentException("非法 cache type: " + type);
    }
    File dir = new File(rootDir, type);
    try {
      String dirCanonical = dir.getCanonicalPath();
      String rootCanonical = rootDir.getCanonicalPath();
      if (!dirCanonical.equals(rootCanonical)
          && !dirCanonical.startsWith(rootCanonical + File.separator)) {
        throw new IllegalArgumentException("type 逃出 cache 根目录: " + type);
      }
    } catch (IOException e) {
      throw new IllegalArgumentException("canonical 解析失败: " + type, e);
    }
    return dir;
  }

  private File ensureTypeDir(@NonNull String type) {
    File dir = typeDir(type);
    if (!dir.exists()) {
      // noinspection ResultOfMethodCallIgnored
      dir.mkdirs();
    }
    return dir;
  }

  private File fileFor(@NonNull String type, @NonNull String key) {
    String safeKey = sanitizeKey(key);
    if (!safeKey.endsWith(CACHE_EXT)) {
      safeKey = safeKey + CACHE_EXT;
    }
    return new File(typeDir(type), safeKey);
  }

  /** 防路径穿越：去掉 .. 与 / 等。空 key 直接拒绝（sanitize 退化成 ".bin" 隐藏文件，list/sweep 反推会得到空 key，往返不对称）。 */
  @NonNull
  private static String sanitizeKey(@NonNull String key) {
    if (key.isEmpty()) {
      throw new IllegalArgumentException("cache key must not be empty");
    }
    return key.replace("..", "_").replace('/', '_').replace('\\', '_').replace(':', '_');
  }

  private void ensureNoMediaSentinel() {
    File flag = new File(rootDir, ".nomedia");
    if (!flag.exists()) {
      try {
        // noinspection ResultOfMethodCallIgnored
        flag.createNewFile();
      } catch (IOException ignored) {
      }
    }
  }

  private static long dirSize(@Nullable File dir) {
    if (dir == null || !dir.isDirectory()) return 0L;
    long total = 0L;
    File[] children = dir.listFiles();
    if (children == null) return 0L;
    for (File f : children) {
      if (f.isDirectory()) {
        total += dirSize(f);
      } else {
        total += f.length();
      }
    }
    return total;
  }

  private static boolean deleteRecursive(@Nullable File f) {
    if (f == null || !f.exists()) return true;
    if (f.isDirectory()) {
      File[] children = f.listFiles();
      if (children != null) {
        for (File c : children) deleteRecursive(c);
      }
    }
    return f.delete();
  }

  /** 递归收集类型目录下所有文件，相对路径作为 key（不带 .bin 扩展）。 */
  private void collectFiles(@Nullable File dir, @NonNull String type, @NonNull List<CacheEntry> out) {
    if (dir == null || !dir.isDirectory()) return;
    File[] children = dir.listFiles();
    if (children == null) return;
    for (File f : children) {
      if (f.isDirectory()) {
        collectFiles(f, type, out);
      } else if (f.isFile()) {
        String name = f.getName();
        String key = name.endsWith(CACHE_EXT) ? name.substring(0, name.length() - CACHE_EXT.length()) : name;
        out.add(new CacheEntry(type, key, f.length(), f.lastModified(), f.getAbsolutePath()));
      }
    }
  }

  /** 仅供调试 / 测试：拿全部 type 列表 */
  @NonNull
  public static String[] knownTypes() {
    return Arrays.copyOf(ALL_TYPES, ALL_TYPES.length);
  }

  // ==================== 内存索引维护 ====================

  /** 给指定 type 的内存索引加减字节数；audio 不进索引。 */
  private void addBytes(@NonNull String type, long delta) {
    if (TYPE_AUDIO.equals(type) || delta == 0L) return;
    AtomicLong v = perTypeBytes.get(type);
    if (v != null) {
      long newVal = v.addAndGet(delta);
      // 兜底：理论不会负，但若外部删 / 索引未跟上则纠正
      if (newVal < 0L) v.set(0L);
    }
  }

  /**
   * 节流 reconcile：仅在距上次 reconcile 已超 30min 时触发后台全扫，纠正索引漂移。<br>
   * 漂移来源：外部删文件（系统清缓存）、构造期 baseline 尚未跑完的并发写。
   */
  private void maybeReconcile() {
    long now = System.currentTimeMillis();
    if (now - lastReconcileAtMs < RECONCILE_INTERVAL_MS) return;
    lastReconcileAtMs = now;
    writeExecutor.submit(this::reconcileAllNow);
  }

  /** 强制 reconcile：扫所有非 audio type 目录，把内存索引校准到真实 size。 */
  private void reconcileAllNow() {
    for (String type : ALL_TYPES) {
      if (TYPE_AUDIO.equals(type)) continue;
      long real = dirSize(typeDir(type));
      AtomicLong v = perTypeBytes.get(type);
      if (v != null) {
        long old = v.getAndSet(real);
        long diff = Math.abs(real - old);
        // 漂移 > 1MB 时记日志，便于排查异常
        if (diff > 1024 * 1024) {
          Log.i(TAG, "reconcile " + type + ": " + old + " → " + real + " (diff=" + diff + ")");
        }
      }
    }
    lastReconcileAtMs = System.currentTimeMillis();
  }
}
