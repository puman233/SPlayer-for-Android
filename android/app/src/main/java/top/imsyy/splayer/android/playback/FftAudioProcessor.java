package top.imsyy.splayer.android.playback;

import androidx.annotation.Nullable;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * ExoPlayer 解码链 FFT 处理器，输出 fftBins[256] + lowFreq。
 *
 * <p>lowFreq 对齐 PC 端 AudioEffectManager：0–280Hz 均值→threshold=180→pow(x,2)→EMA(0.28)。 fftBins 为
 * 80–2000Hz 紧凑频谱。PCM 原样透传；除 setListener 外都在音频线程调用。
 */
@UnstableApi
public final class FftAudioProcessor extends BaseAudioProcessor {
  // FFT 参数对齐 Web Audio AnalyserNode：fftSize=2048, minDecibels=-100, maxDecibels=-30。
  // lowFreq 语义对齐 PC 端 AudioEffectManager（0–280Hz 均值 + threshold + pow + EMA）。

  /** FFT 窗口大小（必须 2 的幂）。2048 点 ~23Hz/bin@48kHz，足以分辨 低频 0–280Hz 频带。 */
  private static final int FFT_SIZE = 2048;

  private static final int FFT_BIN_COUNT = FFT_SIZE / 2;

  /** STFT hop size，50% overlap。 */
  private static final int HOP_SIZE = FFT_SIZE / 2;

  /** 对外频谱 bin 数，保持 256 兼容前端。 */
  private static final int OUTPUT_BIN_COUNT = 256;

  /** 回调节流 ~33ms（30Hz），与 AnalyserNode rAF 节奏一致。 */
  private static final long FRAME_INTERVAL_NS = 33_000_000L;

  /** 目标等效采样率，贴近 PC AudioContext。 */
  private static final float TARGET_EFFECTIVE_RATE = 48000f;

  /** 频谱柱频段（Hz）。 */
  private static final float SPECTRUM_FREQ_LOW = 80f;

  private static final float SPECTRUM_FREQ_HIGH = 2000f;

  /** AMLL 低频驱动频带上限（Hz）。起点为 bin 1（跳过 DC），对应 PC 端前 3 bin @ fftSize=512。 */
  private static final float LOW_FREQ_BAND_END_HZ = 280f;

  /** dB 归一化窗口（对齐 AnalyserNode 默认 minDecibels/maxDecibels）。 */
  private static final float MIN_DB = -100f;

  private static final float MAX_DB = -30f;

  /** 低频底噪阈值（0–255 域）：低于此视为常态、不推动鼓点。 */
  private static final float LOW_FREQ_THRESHOLD = 180f;

  /** lowFreq EMA 平滑系数（对齐 PC 端 AudioEffectManager），raw 权重。 */
  private static final float LOW_FREQ_SMOOTHING = 0.28f;

  /** FFT 实例 + 蓄水池 + 工作数组。均为 thread-confined，仅音频线程访问。 */
  private final Fft fft = new Fft(FFT_SIZE);

  private final float[] sampleBuffer = new float[FFT_SIZE];
  private int sampleBufferPos = 0;
  private final float[] fftReal = new float[FFT_SIZE];
  private final float[] fftImag = new float[FFT_SIZE];

  /** 预计算 Hann 窗系数。 */
  private static final float[] HANN_WINDOW = buildHannWindow(FFT_SIZE);

  private static float[] buildHannWindow(int size) {
    float[] w = new float[size];
    for (int i = 0; i < size; i++) {
      w[i] = 0.5f * (1f - (float) Math.cos(2.0 * Math.PI * i / (size - 1)));
    }
    return w;
  }

  /** FFT 原始 bin 强度（0-255 域），bin k 对应频率 k * effectiveRate / FFT_SIZE。 */
  private final int[] fftBins = new int[FFT_BIN_COUNT];

  /** 对外输出紧凑频谱：80-2000Hz bin 线性拉伸到 256；outputBins[0]=高频, [255]=低频。 */
  private final int[] outputBins = new int[OUTPUT_BIN_COUNT];

  /** 上次回调时间戳，用于节流。 */
  private long lastCallbackNs = 0L;

  /** 固定 stride，onConfigure 计算。 */
  private int frameStride = 1;

  /** 当前等效采样率。 */
  private float effectiveRate = TARGET_EFFECTIVE_RATE;

  /** 频谱柱 bin 范围。 */
  private int spectrumBinStart = 1;

  private int spectrumBinEnd = 1;

  /** AMLL 低频驱动 bin 范围（0–280Hz，bin 1 起跳过 DC）。 */
  private int lowFreqBandStart = 1;

  private int lowFreqBandEnd = 1;

  /** 低频包络平滑状态。 */
  private float lowFreqSmoothed = 0f;

  @Nullable private volatile DataListener listener;

  /** setListener 跨线程重置令牌：主线程只置 flag，音频线程在 analyze() 入口消费，避免状态字段 race */
  private volatile boolean pendingReset = false;

  public interface DataListener {
    /**
     * @param fftBins 长度 256 的 0-255 频段能量（80-2000Hz 紧凑映射，bin[0]=高频, bin[255]=低频）
     * @param lowFreq 0–280Hz 频带阈值超出量的平滑值 [0, 1]，驱动 AMLL 鼓点跳动
     */
    void onData(int[] fftBins, float lowFreq);
  }

  public void setListener(@Nullable DataListener listener) {
    this.listener = listener;
    // 仅设 flag，不从主线程直写状态字段；音频线程在下一次 analyze 入口消费。
    pendingReset = true;
  }

  /** 重置运行时状态。 */
  private void resetVisualState() {
    sampleBufferPos = 0;
    lastCallbackNs = 0L;
    lowFreqSmoothed = 0f;
  }

  /** 根据 effectiveRate 重算 bin 下标。 */
  private void recomputeBinRanges() {
    float er = this.effectiveRate;
    if (er <= 0f) return;
    spectrumBinStart = Math.max(1, (int) Math.floor(SPECTRUM_FREQ_LOW * FFT_SIZE / er));
    spectrumBinEnd =
        Math.min(FFT_BIN_COUNT - 1, (int) Math.ceil(SPECTRUM_FREQ_HIGH * FFT_SIZE / er));
    if (spectrumBinEnd < spectrumBinStart) spectrumBinEnd = spectrumBinStart;
    // 0–280Hz 对齐 PC 端前 3 bin@fftSize=512；bin 1 起跳过 DC 避免直流偏置污染。
    lowFreqBandStart = 1;
    lowFreqBandEnd =
        Math.min(FFT_BIN_COUNT - 1, (int) Math.ceil(LOW_FREQ_BAND_END_HZ * FFT_SIZE / er));
    if (lowFreqBandEnd < lowFreqBandStart) lowFreqBandEnd = lowFreqBandStart;
  }

  @Override
  protected AudioFormat onConfigure(AudioFormat inputAudioFormat)
      throws UnhandledAudioFormatException {
    // 仅接受 16bit PCM，其他 encoding 交上游 ToInt16PcmAudioProcessor 转换
    if (inputAudioFormat.encoding != androidx.media3.common.C.ENCODING_PCM_16BIT) {
      throw new UnhandledAudioFormatException(inputAudioFormat);
    }

    // 44.1/48kHz 不降采样，高采样率才降到接近 48kHz
    frameStride = Math.max(1, Math.round(inputAudioFormat.sampleRate / TARGET_EFFECTIVE_RATE));
    effectiveRate = (float) inputAudioFormat.sampleRate / frameStride;

    recomputeBinRanges();

    // 透传上游格式
    return inputAudioFormat;
  }

  @Override
  public void queueInput(ByteBuffer inputBuffer) {
    int bytesRemaining = inputBuffer.remaining();
    if (bytesRemaining == 0) {
      return;
    }

    // 分析 PCM
    analyze(inputBuffer);

    // 透传到下游
    ByteBuffer output = replaceOutputBuffer(bytesRemaining);
    output.put(inputBuffer);
    output.flip();
  }

  /** mono 化 + 写入累积缓冲，满后触发 FFT。用 duplicate() 不影响透传。 */
  private void analyze(ByteBuffer inputBuffer) {
    // setListener 可能在主线程设了 pendingReset，这里是唯一由音频线程消费点，
    // 以避免跨线程同时读写 sampleBufferPos / lastCallbackNs / lowFreqSmoothed 的 race。
    if (pendingReset) {
      pendingReset = false;
      resetVisualState();
    }

    DataListener cb = listener;
    if (cb == null) {
      // 无消费者时跳过 FFT
      return;
    }

    int channelCount = inputAudioFormat.channelCount;
    if (channelCount <= 0) {
      return;
    }

    ByteBuffer view = inputBuffer.duplicate().order(ByteOrder.nativeOrder());
    int bytesPerFrame = channelCount * 2; // 16bit = 2 bytes/channel
    int totalFrames = view.remaining() / bytesPerFrame;

    int strideFrames = frameStride;

    // 降采样时连续 stride 个采样求平均，抓高频混叠
    for (int frame = 0; frame + strideFrames <= totalFrames; frame += strideFrames) {
      float monoSum = 0f;
      for (int sub = 0; sub < strideFrames; sub++) {
        int byteOffset = (frame + sub) * bytesPerFrame;
        int chSum = 0;
        for (int ch = 0; ch < channelCount; ch++) {
          chSum += view.getShort(view.position() + byteOffset + ch * 2);
        }
        monoSum += (float) chSum / channelCount;
      }
      float mono = monoSum / strideFrames;

      sampleBuffer[sampleBufferPos++] = mono;
      if (sampleBufferPos >= FFT_SIZE) {
        // 节流前置：未达 30Hz 间隔时不进入 FFT 计算，仅走 overlap shift，
        // 避免函数命名误导阅读者认为窗内已经做了 FFT。
        long now = System.nanoTime();
        if (now - lastCallbackNs >= FRAME_INTERVAL_NS) {
          lastCallbackNs = now;
          runFftAndCallback(cb);
        }
        // overlap shift：把后部 (FFT_SIZE - HOP_SIZE) 个样本移到开头，下次从 (FFT_SIZE - HOP_SIZE) 位置续写。
        // 通用公式不再假设 HOP = FFT/2。
        final int keepCount = FFT_SIZE - HOP_SIZE;
        System.arraycopy(sampleBuffer, HOP_SIZE, sampleBuffer, 0, keepCount);
        sampleBufferPos = keepCount;
      }
    }
  }

  private void runFftAndCallback(DataListener cb) {
    // 节流已由调用方在 analyze() 处预筛，这里不再重复检查。

    // 去 DC：避免直流偏置经 Hann 窗泄漏到低频 bin
    float dcSum = 0f;
    for (int i = 0; i < FFT_SIZE; i++) {
      dcSum += sampleBuffer[i];
    }
    float dcMean = dcSum / FFT_SIZE;

    // 去 DC + Hann 窗
    for (int i = 0; i < FFT_SIZE; i++) {
      fftReal[i] = (sampleBuffer[i] - dcMean) * HANN_WINDOW[i];
      fftImag[i] = 0f;
    }

    fft.transform(fftReal, fftImag);

    // 计算关心范围内的 bin，范围外置 0；FFT 自然顺序 bin k = k * effectiveRate / FFT_SIZE，无需镜像
    final float dbRange = MAX_DB - MIN_DB;
    int fftCalcStart = Math.min(lowFreqBandStart, spectrumBinStart);
    int fftCalcEnd = Math.max(lowFreqBandEnd, spectrumBinEnd);
    for (int k = 0; k < FFT_BIN_COUNT; k++) {
      if (k < fftCalcStart || k > fftCalcEnd) {
        fftBins[k] = 0;
        continue;
      }
      float real = fftReal[k];
      float imag = fftImag[k];
      float mag = (float) Math.sqrt(real * real + imag * imag);
      float normalized = mag / (FFT_SIZE / 2f) / 32768f;
      float db = normalized <= 1e-7f ? MIN_DB : 20f * (float) Math.log10(normalized);
      float t = (db - MIN_DB) / dbRange;
      if (t < 0f) t = 0f;
      else if (t > 1f) t = 1f;
      fftBins[k] = (int) (t * 255f);
    }

    // AMLL 低频音量：对齐 PC 端 AudioEffectManager.getLowFrequencyVolume()
    //   1) 0–280Hz 均值   2) threshold=180 过滤底噪   3) pow(x, 2) 扩展动态   4) EMA 平滑
    int lowFreqSum = 0;
    int lowFreqCount = 0;
    for (int i = lowFreqBandStart; i <= lowFreqBandEnd; i++) {
      lowFreqSum += fftBins[i];
      lowFreqCount++;
    }
    float lowFreqAvg = lowFreqCount > 0 ? (float) lowFreqSum / lowFreqCount : 0f;
    float overThreshold = (lowFreqAvg - LOW_FREQ_THRESHOLD) / (255f - LOW_FREQ_THRESHOLD);
    if (overThreshold < 0f) overThreshold = 0f;
    float lowFreqRaw = overThreshold * overThreshold;
    lowFreqSmoothed += LOW_FREQ_SMOOTHING * (lowFreqRaw - lowFreqSmoothed);
    if (lowFreqSmoothed < 0f) lowFreqSmoothed = 0f;
    else if (lowFreqSmoothed > 1f) lowFreqSmoothed = 1f;

    // 紧凑映射：80-2000Hz bin 线性插值拉伸到 outputBins
    // 输出按 outputBins[0]=高频, [255]=低频 反转，匹配前端 SKIP_BINS 跳过高频噪声的可视化布局
    int sourceSpan = spectrumBinEnd - spectrumBinStart;
    if (sourceSpan <= 0) {
      for (int k = 0; k < OUTPUT_BIN_COUNT; k++) outputBins[k] = 0;
    } else {
      for (int k = 0; k < OUTPUT_BIN_COUNT; k++) {
        float srcPos = (float) k * sourceSpan / (OUTPUT_BIN_COUNT - 1);
        int srcLow = spectrumBinStart + (int) srcPos;
        int srcHigh = Math.min(srcLow + 1, spectrumBinEnd);
        float frac = srcPos - (int) srcPos;
        int interp = (int) (fftBins[srcLow] * (1f - frac) + fftBins[srcHigh] * frac);
        if (interp < 0) interp = 0;
        else if (interp > 255) interp = 255;
        outputBins[OUTPUT_BIN_COUNT - 1 - k] = interp;
      }
    }

    cb.onData(outputBins, lowFreqSmoothed);
  }

  @Override
  protected void onFlush() {
    // seek/flush 重置蓄水池，避免跨片段污染
    resetVisualState();
  }

  @Override
  protected void onReset() {
    resetVisualState();
    // listener 由 PlaybackManager 管理，不清
  }

  /**
   * 原地 radix-2 Cooley-Tukey FFT。
   *
   * <p>仅支持 size 为 2 的幂；构造时预计算旋转因子（W = e^(-i*2π*k/N)）的 cos/sin 表， 避免每次 FFT 都重算三角函数。
   *
   * <p>用法：
   *
   * <pre>
   *   Fft fft = new Fft(2048);
   *   float[] real = new float[2048];
   *   float[] imag = new float[2048]; // 全零
   *   // ... 填入 PCM 样本到 real ...
   *   fft.transform(real, imag);
   *   // 频谱幅度 = sqrt(real[k]^2 + imag[k]^2)，k = 0..N/2-1
   * </pre>
   *
   * 不是线程安全：调用方应在单一线程（音频处理线程）内重用。
   */
  private static final class Fft {
    private final int size;
    private final int log2Size;
    private final float[] cosTable;
    private final float[] sinTable;
    private final int[] bitReverseTable;

    Fft(int size) {
      if (size <= 0 || (size & (size - 1)) != 0) {
        throw new IllegalArgumentException("FFT size must be a power of 2, got: " + size);
      }
      this.size = size;
      this.log2Size = Integer.numberOfTrailingZeros(size);

      // 预计算旋转因子表（半周期足够，二象限对称由 sign 决定）
      int half = size / 2;
      cosTable = new float[half];
      sinTable = new float[half];
      for (int i = 0; i < half; i++) {
        double angle = -2.0 * Math.PI * i / size;
        cosTable[i] = (float) Math.cos(angle);
        sinTable[i] = (float) Math.sin(angle);
      }

      // 预计算位反转索引表
      bitReverseTable = new int[size];
      for (int i = 0; i < size; i++) {
        bitReverseTable[i] = reverseBits(i, log2Size);
      }
    }

    public int getSize() {
      return size;
    }

    /** 原地 FFT。real / imag 长度必须等于构造时的 size。输出位置 k 的频段对应频率 k * sampleRate / size。 */
    public void transform(float[] real, float[] imag) {
      if (real.length != size || imag.length != size) {
        throw new IllegalArgumentException(
            "FFT input length mismatch: expected "
                + size
                + ", got real="
                + real.length
                + ", imag="
                + imag.length);
      }

      // 位反转排序：经典 Cooley-Tukey 第一步
      for (int i = 0; i < size; i++) {
        int j = bitReverseTable[i];
        if (j > i) {
          float tmpR = real[i];
          real[i] = real[j];
          real[j] = tmpR;
          float tmpI = imag[i];
          imag[i] = imag[j];
          imag[j] = tmpI;
        }
      }

      // 蝶形运算：从 size=2 开始倍增
      for (int stage = 1; stage <= log2Size; stage++) {
        int m = 1 << stage; // 当前蝶形段长度
        int mHalf = m >> 1;
        int twiddleStep = size / m; // 旋转因子在 cosTable/sinTable 中的步长

        for (int k = 0; k < size; k += m) {
          for (int j = 0; j < mHalf; j++) {
            int twiddleIndex = j * twiddleStep;
            float wR = cosTable[twiddleIndex];
            float wI = sinTable[twiddleIndex];

            int idx = k + j;
            int idxPair = idx + mHalf;
            float tR = wR * real[idxPair] - wI * imag[idxPair];
            float tI = wR * imag[idxPair] + wI * real[idxPair];

            real[idxPair] = real[idx] - tR;
            imag[idxPair] = imag[idx] - tI;
            real[idx] = real[idx] + tR;
            imag[idx] = imag[idx] + tI;
          }
        }
      }
    }

    private static int reverseBits(int x, int bits) {
      int result = 0;
      for (int i = 0; i < bits; i++) {
        result = (result << 1) | (x & 1);
        x >>>= 1;
      }
      return result;
    }
  }
}
