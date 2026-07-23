package top.imsyy.splayer.android.playback;

import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** 10 段图示均衡器，运行在 Media3 PCM 解码链中。 */
@UnstableApi
public final class EqualizerAudioProcessor extends BaseAudioProcessor {
  private static final double[] FREQUENCIES = {31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
  private final float[] gains = new float[10];
  private final double[][] coefficients = new double[10][5];
  private double[][] x1 = new double[10][0];
  private double[][] x2 = new double[10][0];
  private double[][] y1 = new double[10][0];
  private double[][] y2 = new double[10][0];
  private int channelCount;
  private int sampleRate;

  public synchronized void setGains(float[] values) {
    for (int i = 0; i < gains.length; i++) gains[i] = values != null && i < values.length ? Math.max(-12, Math.min(12, values[i])) : 0;
    updateCoefficients();
  }

  @Override
  protected AudioFormat onConfigure(AudioFormat format) throws UnhandledAudioFormatException {
    if (format.encoding != androidx.media3.common.C.ENCODING_PCM_16BIT) throw new UnhandledAudioFormatException(format);
    channelCount = format.channelCount;
    sampleRate = format.sampleRate;
    x1 = new double[10][channelCount]; x2 = new double[10][channelCount];
    y1 = new double[10][channelCount]; y2 = new double[10][channelCount];
    updateCoefficients(format.sampleRate);
    return format;
  }

  private synchronized void updateCoefficients() {
    if (sampleRate > 0) updateCoefficients(sampleRate);
  }

  private void updateCoefficients(int sampleRate) {
    for (int i = 0; i < 10; i++) {
      double frequency = Math.min(FREQUENCIES[i], sampleRate * 0.45);
      double a = Math.pow(10, gains[i] / 40.0), w = 2 * Math.PI * frequency / sampleRate;
      double alpha = Math.sin(w) / (2 * 1.0), cos = Math.cos(w);
      double b0 = 1 + alpha * a, b1 = -2 * cos, b2 = 1 - alpha * a;
      double a0 = 1 + alpha / a, a1 = -2 * cos, a2 = 1 - alpha / a;
      coefficients[i][0] = b0 / a0; coefficients[i][1] = b1 / a0; coefficients[i][2] = b2 / a0;
      coefficients[i][3] = a1 / a0; coefficients[i][4] = a2 / a0;
    }
  }

  @Override
  public void queueInput(ByteBuffer inputBuffer) {
    int bytes = inputBuffer.remaining();
    ByteBuffer output = replaceOutputBuffer(bytes).order(ByteOrder.nativeOrder());
    int channel = 0;
    while (inputBuffer.remaining() >= 2) {
      double sample = inputBuffer.getShort() / 32768.0;
      for (int band = 0; band < 10; band++) {
        double[] c = coefficients[band];
        double result = c[0] * sample + c[1] * x1[band][channel] + c[2] * x2[band][channel] - c[3] * y1[band][channel] - c[4] * y2[band][channel];
        x2[band][channel] = x1[band][channel]; x1[band][channel] = sample;
        y2[band][channel] = y1[band][channel]; y1[band][channel] = result;
        sample = result;
      }
      output.putShort((short) Math.max(-32768, Math.min(32767, Math.round(sample * 32768))));
      channel = (channel + 1) % Math.max(1, channelCount);
    }
    output.flip();
  }

  @Override protected void onFlush() {
    for (int i = 0; i < 10; i++) for (int c = 0; c < channelCount; c++) { x1[i][c] = 0; x2[i][c] = 0; y1[i][c] = 0; y2[i][c] = 0; }
  }
  @Override protected void onReset() { onFlush(); }
}
