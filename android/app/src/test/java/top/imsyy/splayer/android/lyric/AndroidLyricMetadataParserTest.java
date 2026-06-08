package top.imsyy.splayer.android.lyric;

import static org.junit.Assert.assertEquals;

import java.util.Locale;
import org.junit.Test;

public class AndroidLyricMetadataParserTest {
  @Test
  public void extractsLrcMetadataTags() {
    AndroidLyricMetadataParser.LyricMetadata metadata =
        AndroidLyricMetadataParser.extractLrcMetadata(
            "[ti:星间旅行]\n"
                + "[ar:Alice / Bob]\n"
                + "[al:夜空列车]\n"
                + "[by:ignored]\n"
                + "[00:01.00]第一句歌词");

    assertEquals("星间旅行", metadata.musicName);
    assertEquals("Alice / Bob", metadata.artists);
    assertEquals("夜空列车", metadata.album);
  }

  @Test
  public void keepsBlankLrcMetadataUnset() {
    AndroidLyricMetadataParser.LyricMetadata metadata =
        AndroidLyricMetadataParser.extractLrcMetadata(
            "[ti:]\n" + "[ar:  ]\n" + "[al:夜空列车]\n" + "[00:01.00]第一句歌词");

    assertEquals(null, metadata.musicName);
    assertEquals(null, metadata.artists);
    assertEquals("夜空列车", metadata.album);
  }

  @Test
  public void extractsTtmlMetadataTags() {
    AndroidLyricMetadataParser.LyricMetadata metadata =
        AndroidLyricMetadataParser.extractTtmlMetadata(
            "<tt><head><metadata>"
                + "<amll:meta key=\"musicName\" value=\"星间旅行\" />"
                + "<amll:meta key=\"artists\" value=\"Alice &amp; Bob\" />"
                + "<amll:meta key=\"album\" value=\"夜空列车\" />"
                + "<amll:meta key=\"ncmMusicId\" value=\"123456\" />"
                + "</metadata></head></tt>");

    assertEquals("星间旅行", metadata.musicName);
    assertEquals("Alice & Bob", metadata.artists);
    assertEquals("夜空列车", metadata.album);
    assertEquals("123456", metadata.ncmMusicId);
  }

  @Test
  public void extractsUppercaseLrcMetadataTagsWithTurkishLocale() {
    Locale original = Locale.getDefault();
    Locale.setDefault(new Locale("tr", "TR"));
    try {
      AndroidLyricMetadataParser.LyricMetadata metadata =
          AndroidLyricMetadataParser.extractLrcMetadata(
              "[TI:星间旅行]\n"
                  + "[AR:Alice / Bob]\n"
                  + "[AL:夜空列车]\n"
                  + "[00:01.00]第一句歌词");

      assertEquals("星间旅行", metadata.musicName);
      assertEquals("Alice / Bob", metadata.artists);
      assertEquals("夜空列车", metadata.album);
    } finally {
      Locale.setDefault(original);
    }
  }
}
