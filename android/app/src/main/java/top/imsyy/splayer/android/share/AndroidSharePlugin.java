package top.imsyy.splayer.android.share;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "AndroidShare")
public class AndroidSharePlugin extends Plugin {
  @PluginMethod
  public void saveImage(PluginCall call) {
    String dataUrl = call.getString("dataUrl", "");
    String fileName = safeFileName(call.getString("fileName", "lyric-poster.png"));
    try {
      byte[] image = decodeDataUrl(dataUrl);
      ContentValues values = new ContentValues();
      values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
      values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
      values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/SPlayer");
      values.put(MediaStore.Images.Media.IS_PENDING, 1);
      ContentResolver resolver = getContext().getContentResolver();
      Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
      if (uri == null) throw new IllegalStateException("Unable to create MediaStore item");
      try (OutputStream output = resolver.openOutputStream(uri)) {
        if (output == null) throw new IllegalStateException("Unable to open MediaStore output");
        output.write(image);
      } catch (Exception error) {
        resolver.delete(uri, null, null);
        throw error;
      }
      values.clear();
      values.put(MediaStore.Images.Media.IS_PENDING, 0);
      resolver.update(uri, values, null, null);
      JSObject result = new JSObject();
      result.put("uri", uri.toString());
      call.resolve(result);
    } catch (Exception error) {
      call.reject("SAVE_IMAGE_FAILED", error);
    }
  }

  @PluginMethod
  public void shareImage(PluginCall call) {
    String dataUrl = call.getString("dataUrl", "");
    String fileName = safeFileName(call.getString("fileName", "lyric-poster.png"));
    try {
      File directory = new File(getContext().getCacheDir(), "shared-images");
      if (!directory.exists() && !directory.mkdirs()) {
        throw new IllegalStateException("Unable to create share cache directory");
      }
      File imageFile = new File(directory, fileName);
      try (FileOutputStream output = new FileOutputStream(imageFile)) {
        output.write(decodeDataUrl(dataUrl));
      }
      Uri uri = FileProvider.getUriForFile(
          getContext(), getContext().getPackageName() + ".fileprovider", imageFile);
      Intent intent = new Intent(Intent.ACTION_SEND);
      intent.setType("image/png");
      intent.putExtra(Intent.EXTRA_STREAM, uri);
      intent.putExtra(Intent.EXTRA_TITLE, call.getString("title", "歌词海报"));
      String text = call.getString("text", "");
      if (!text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      Intent chooser = Intent.createChooser(intent, "分享歌词海报");
      chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(chooser);
      call.resolve();
    } catch (Exception error) {
      call.reject("SHARE_IMAGE_FAILED", error);
    }
  }

  private static byte[] decodeDataUrl(String dataUrl) {
    int separator = dataUrl.indexOf(',');
    if (separator < 0) throw new IllegalArgumentException("Invalid image data URL");
    return Base64.decode(dataUrl.substring(separator + 1), Base64.DEFAULT);
  }

  private static String safeFileName(String fileName) {
    String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
    return safe.endsWith(".png") ? safe : safe + ".png";
  }
}
