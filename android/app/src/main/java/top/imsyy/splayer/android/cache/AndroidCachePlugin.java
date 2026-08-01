package top.imsyy.splayer.android.cache;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Android 端缓存 Capacitor 插件。
 *
 * <p>所有数据走 base64（JSON 不能携带二进制）。读取大文件性能损失可接受（封面通常 < 200KB， 歌词 < 50KB；音频不走该通道而是 ExoPlayer
 * SimpleCache 直读）。
 *
 * <p>JS 调用 {@link top.imsyy.splayer.android.cache.CacheStorage} 单例。
 */
@CapacitorPlugin(name = "AndroidCache")
public class AndroidCachePlugin extends Plugin {

  /**
   * type 白名单：仅允许 CacheStorage 已声明的子目录名，杜绝 "../shared_prefs" 之类路径穿越。 与 CacheStorage 层的第二道防线（typeDir
   * canonical 校验）配合，双重隔离。
   */
  private static final Set<String> ALLOWED_TYPES =
      new HashSet<>(Arrays.asList(CacheStorage.knownTypes()));

  private CacheStorage storage() {
    return CacheStorage.getInstance(getContext());
  }

  /** 校验 type 在白名单内；非法直接 reject 并返 false。 */
  private boolean requireValidType(@androidx.annotation.Nullable String type, PluginCall call) {
    if (type == null) {
      call.reject("type 必填");
      return false;
    }
    if (!ALLOWED_TYPES.contains(type)) {
      call.reject("非法 type: " + type);
      return false;
    }
    return true;
  }

  @PluginMethod
  public void read(PluginCall call) {
    String type = call.getString("type");
    String key = call.getString("key");
    if (!requireValidType(type, call)) return;
    if (key == null) {
      call.reject("key 必填");
      return;
    }
    byte[] data = storage().read(type, key);
    JSObject ret = new JSObject();
    if (data == null) {
      ret.put("hit", false);
    } else {
      ret.put("hit", true);
      ret.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
      ret.put("size", data.length);
    }
    call.resolve(ret);
  }

  @PluginMethod
  public void write(PluginCall call) {
    String type = call.getString("type");
    String key = call.getString("key");
    String dataB64 = call.getString("data");
    if (!requireValidType(type, call)) return;
    if (key == null || dataB64 == null) {
      call.reject("key / data 必填");
      return;
    }
    byte[] bytes;
    try {
      bytes = Base64.decode(dataB64, Base64.DEFAULT);
    } catch (IllegalArgumentException e) {
      call.reject("data 不是合法 base64");
      return;
    }
    boolean ok = storage().write(type, key, bytes);
    JSObject ret = new JSObject();
    ret.put("success", ok);
    if (!ok) ret.put("message", "写入失败（磁盘不足或 IO 异常）");
    call.resolve(ret);
  }

  @PluginMethod
  public void remove(PluginCall call) {
    String type = call.getString("type");
    String key = call.getString("key");
    if (!requireValidType(type, call)) return;
    if (key == null) {
      call.reject("key 必填");
      return;
    }
    boolean ok = storage().remove(type, key);
    JSObject ret = new JSObject();
    ret.put("success", ok);
    call.resolve(ret);
  }

  @PluginMethod
  public void list(PluginCall call) {
    String type = call.getString("type");
    if (!requireValidType(type, call)) return;
    List<CacheStorage.CacheEntry> entries = storage().list(type);
    JSArray arr = new JSArray();
    for (CacheStorage.CacheEntry e : entries) {
      JSObject obj = new JSObject();
      obj.put("key", e.key);
      obj.put("size", e.size);
      obj.put("mtime", e.mtime);
      arr.put(obj);
    }
    JSObject ret = new JSObject();
    ret.put("entries", arr);
    call.resolve(ret);
  }

  @PluginMethod
  public void clear(PluginCall call) {
    String type = call.getString("type");
    if (!requireValidType(type, call)) return;
    boolean ok = storage().clear(type);
    JSObject ret = new JSObject();
    ret.put("success", ok);
    call.resolve(ret);
  }

  @PluginMethod
  public void clearAll(PluginCall call) {
    boolean ok = storage().clearAll();
    JSObject ret = new JSObject();
    ret.put("success", ok);
    call.resolve(ret);
  }

  /** 返回 {totalBytes, perType: {lyrics:..., covers:...}, deviceFreeBytes, maxBytes}。 */
  @PluginMethod
  public void getStats(PluginCall call) {
    CacheStorage cs = storage();
    JSObject ret = new JSObject();
    ret.put("totalBytes", cs.getTotalBytes());
    ret.put("deviceFreeBytes", cs.getDeviceFreeBytes());
    ret.put("maxBytes", cs.getMaxBytes());
    // 设备空间不足时的有效上限（剩余空间 × 60% 与用户设定取 min）；UI 用于展示「实际生效配额」。
    ret.put("effectiveMaxBytes", cs.getEffectiveMaxBytes());

    JSObject perType = new JSObject();
    Map<String, Long> map = cs.getPerTypeBytes();
    for (Map.Entry<String, Long> e : map.entrySet()) {
      perType.put(e.getKey(), e.getValue());
    }
    ret.put("perType", perType);
    call.resolve(ret);
  }

  /**
   * 设置最大缓存上限（字节）。最小 256MB，setting 端调用。
   *
   * <p>注意：参数 maxBytes 用 Double 接收，避免 Capacitor JS number → Long 在大整数上的精度损失。
   */
  @PluginMethod
  public void setMaxBytes(PluginCall call) {
    Double bytes = call.getDouble("maxBytes");
    if (bytes == null) {
      call.reject("maxBytes 必填");
      return;
    }
    storage().setMaxBytes(bytes.longValue());
    JSObject ret = new JSObject();
    ret.put("success", true);
    ret.put("appliedMaxBytes", storage().getMaxBytes());
    call.resolve(ret);
  }

  /** 主动触发一次全局 LRU 驱逐（设置面板「立即整理」按钮可用）。 */
  @PluginMethod
  public void enforceLimit(PluginCall call) {
    storage().enforceLimit();
    JSObject ret = new JSObject();
    ret.put("success", true);
    ret.put("totalBytes", storage().getTotalBytes());
    call.resolve(ret);
  }

  /** 提供 JSON 序列化辅助（IDE 已 import 但部分调用未用，避免 unused warn）。 */
  @SuppressWarnings("unused")
  private JSObject toJsObject(JSONObject json) throws JSONException {
    JSObject obj = new JSObject();
    java.util.Iterator<String> it = json.keys();
    while (it.hasNext()) {
      String k = it.next();
      obj.put(k, json.get(k));
    }
    return obj;
  }
}
