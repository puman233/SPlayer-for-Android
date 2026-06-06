package top.imsyy.splayer.android.lyric;

import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class AndroidLyricMetadataParser {
  private static final Pattern AMLL_META_PATTERN =
      Pattern.compile("<\\s*amll:meta\\b[^>]*>", Pattern.CASE_INSENSITIVE);
  private static final Pattern LRC_META_PATTERN =
      Pattern.compile("^\\s*\\[([a-zA-Z]+):([^\\]]*)]\\s*$", Pattern.MULTILINE);

  private AndroidLyricMetadataParser() {}

  static LyricMetadata extractTtmlMetadata(String ttml) {
    LyricMetadata metadata = new LyricMetadata();
    Matcher metaMatcher = AMLL_META_PATTERN.matcher(ttml);
    while (metaMatcher.find()) {
      String tag = metaMatcher.group();
      String key = readAttribute(tag, "key");
      String value = readAttribute(tag, "value");
      if (key == null || value == null) continue;
      metadata.put(key.trim(), decodeXmlAttribute(value).trim());
    }
    return metadata;
  }

  static LyricMetadata extractLrcMetadata(String lrc) {
    LyricMetadata metadata = new LyricMetadata();
    Matcher matcher = LRC_META_PATTERN.matcher(lrc);
    while (matcher.find()) {
      String key = matcher.group(1);
      String value = matcher.group(2);
      if (key == null || value == null) continue;
      metadata.putLrcTag(key.trim(), value.trim());
    }
    return metadata;
  }

  @Nullable
  private static String readAttribute(String tag, String name) {
    Pattern attrPattern =
        Pattern.compile("\\b" + Pattern.quote(name) + "\\s*=\\s*(['\"])(.*?)\\1");
    Matcher matcher = attrPattern.matcher(tag);
    if (!matcher.find()) return null;
    return matcher.group(2);
  }

  private static String decodeXmlAttribute(String value) {
    return value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
  }

  static class LyricMetadata {
    @Nullable String album;
    @Nullable String musicName;
    @Nullable String artists;
    @Nullable String ncmMusicId;

    void putLrcTag(String key, String value) {
      if (value.isEmpty()) return;
      switch (key.toLowerCase()) {
        case "ti":
          musicName = value;
          break;
        case "ar":
          artists = value;
          break;
        case "al":
          album = value;
          break;
        default:
          break;
      }
    }

    void put(String key, String value) {
      if (value.isEmpty()) return;
      switch (key) {
        case "album":
          album = value;
          break;
        case "musicName":
          musicName = value;
          break;
        case "artists":
          artists = value;
          break;
        case "ncmMusicId":
          ncmMusicId = value;
          break;
        default:
          break;
      }
    }

    JSObject toJSObject() {
      JSObject object = new JSObject();
      if (album != null && !album.isEmpty()) object.put("album", album);
      if (musicName != null && !musicName.isEmpty()) object.put("musicName", musicName);
      if (artists != null && !artists.isEmpty()) object.put("artists", artists);
      if (ncmMusicId != null && !ncmMusicId.isEmpty()) object.put("ncmMusicId", ncmMusicId);
      return object;
    }
  }
}
