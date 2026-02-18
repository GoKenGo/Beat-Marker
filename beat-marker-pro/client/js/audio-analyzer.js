/**
 * ════════════════════════════════════════════════════════════
 *  BEAT MARKER PRO — Audio Analysis Engine
 *  Multi-band onset detection: Drums, Bass, Melody, Transients
 * ════════════════════════════════════════════════════════════
 *
 *  Uses FFT-based spectral analysis to separate audio into
 *  frequency bands, then detects onsets in each band independently.
 *
 *  Frequency Bands:
 *    SUB BASS   :   20 –  80 Hz   (kick drum fundamental)
 *    BASS       :   80 – 300 Hz   (bass guitar, bass synth)
 *    LOW MID    :  300 – 2000 Hz  (snare body, vocals, guitar)
 *    HIGH MID   : 2000 – 6000 Hz  (melody clarity, snare crack)
 *    PRESENCE   : 6000 – 12000 Hz (hi-hats, cymbals, air)
 *    BRILLIANCE : 12000 – 20000 Hz (shimmer, sibilance)
 *
 *  Detection Channels:
 *    KICK     = Sub Bass + Bass energy peaks
 *    SNARE    = Low Mid + High Mid transients
 *    HI-HAT   = Presence + Brilliance transients
 *    BASS     = Sub Bass + Bass sustained energy
 *    MELODY   = Low Mid + High Mid spectral flux
 *    VOCAL    = 300-4000 Hz spectral centroid tracking
 * ════════════════════════════════════════════════════════════
 */

class AudioAnalyzer {
  constructor() {
    this.sampleRate = 44100;
    this.fftSize = 2048;
    this.hopSize = 512;
    this.bands = {
      subBass:    { low: 20,    high: 80 },
      bass:       { low: 80,    high: 300 },
      lowMid:     { low: 300,   high: 2000 },
      highMid:    { low: 2000,  high: 6000 },
      presence:   { low: 6000,  high: 12000 },
      brilliance: { low: 12000, high: 20000 },
    };
  }

  /**
   * Main analysis entry point.
   * Returns detected events for each channel, or null if cancelled.
   *
   * @param {AudioBuffer} audioBuffer
   * @param {object} options
   * @param {function} progressCallback  (pct, msg) => void
   * @param {object} cancelToken         { cancelled: boolean } — set .cancelled = true to abort
   */
  async analyze(audioBuffer, options = {}, progressCallback = null, cancelToken = null) {
    const {
      detectKick = true,
      detectSnare = true,
      detectHihat = true,
      detectBass = true,
      detectMelody = true,
      detectVocal = false,
      sensitivityKick = 0.5,
      sensitivitySnare = 0.5,
      sensitivityHihat = 0.5,
      sensitivityBass = 0.5,
      sensitivityMelody = 0.5,
      sensitivityVocal = 0.5,
      minIntervalKick = 0.12,    // Min time between kick detections (sec)
      minIntervalSnare = 0.08,
      minIntervalHihat = 0.05,
      minIntervalBass = 0.15,
      minIntervalMelody = 0.10,
      minIntervalVocal = 0.15,
    } = options;

    this.sampleRate = audioBuffer.sampleRate;

    const isCancelled = () => cancelToken && cancelToken.cancelled;

    // Mix to mono
    if (progressCallback) progressCallback(5, "Mixing to mono...");
    if (isCancelled()) return null;
    const mono = this._mixToMono(audioBuffer);

    // Compute STFT
    if (progressCallback) progressCallback(10, "Computing spectral analysis...");
    if (isCancelled()) return null;
    const spectrogram = this._computeSTFT(mono, progressCallback, cancelToken);
    if (!spectrogram || isCancelled()) return null;

    // Extract band energies
    if (progressCallback) progressCallback(50, "Extracting frequency bands...");
    if (isCancelled()) return null;
    const bandEnergies = this._extractBandEnergies(spectrogram);

    // Compute spectral flux per band
    if (progressCallback) progressCallback(60, "Computing spectral flux...");
    if (isCancelled()) return null;
    const bandFlux = this._computeBandFlux(spectrogram);

    const results = {};

    // ── KICK DETECTION ──
    if (detectKick) {
      if (progressCallback) progressCallback(65, "Detecting kicks...");
      if (isCancelled()) return null;
      const kickEnergy = this._combineBands(bandEnergies, ['subBass', 'bass'], [0.7, 0.3]);
      const kickOnsets = this._detectOnsets(kickEnergy, {
        sensitivity: sensitivityKick,
        minInterval: minIntervalKick,
        adaptiveWindow: 15,
        useHFC: false,
      });
      results.kick = kickOnsets.map(i => ({
        time: this._frameToTime(i),
        frame: i,
        strength: kickEnergy[i],
        type: 'kick',
      }));
    }

    // ── SNARE DETECTION ──
    if (detectSnare) {
      if (progressCallback) progressCallback(70, "Detecting snares...");
      if (isCancelled()) return null;
      // Snare has wide spectral energy: body in low-mid, crack/snap in high-mid
      const snareEnergy = this._combineBands(bandEnergies, ['lowMid', 'highMid'], [0.4, 0.6]);
      // Also use spectral broadness — snare noise is spectrally wide
      const spectralBroadness = this._computeSpectralBroadness(spectrogram);
      const combinedSnare = snareEnergy.map((e, i) => e * (0.6 + 0.4 * (spectralBroadness[i] || 0)));

      const snareOnsets = this._detectOnsets(combinedSnare, {
        sensitivity: sensitivitySnare,
        minInterval: minIntervalSnare,
        adaptiveWindow: 12,
        useHFC: false,
      });
      results.snare = snareOnsets.map(i => ({
        time: this._frameToTime(i),
        frame: i,
        strength: combinedSnare[i],
        type: 'snare',
      }));
    }

    // ── HI-HAT / CYMBAL DETECTION ──
    if (detectHihat) {
      if (progressCallback) progressCallback(75, "Detecting hi-hats...");
      if (isCancelled()) return null;
      // Hi-hats dominate in the presence and brilliance bands
      // Use High Frequency Content (HFC) weighting for transient detection
      const hihatEnergy = this._combineBands(bandEnergies, ['presence', 'brilliance'], [0.5, 0.5]);
      const hfc = this._computeHFC(spectrogram);
      const combinedHihat = hihatEnergy.map((e, i) => e * 0.4 + (hfc[i] || 0) * 0.6);

      const hihatOnsets = this._detectOnsets(combinedHihat, {
        sensitivity: sensitivityHihat,
        minInterval: minIntervalHihat,
        adaptiveWindow: 8,
        useHFC: true,
      });
      results.hihat = hihatOnsets.map(i => ({
        time: this._frameToTime(i),
        frame: i,
        strength: combinedHihat[i],
        type: 'hihat',
      }));
    }

    // ── BASS LINE DETECTION ──
    if (detectBass) {
      if (progressCallback) progressCallback(80, "Detecting bass notes...");
      if (isCancelled()) return null;
      // Bass detection focuses on sustained low frequency energy changes
      const bassEnergy = this._combineBands(bandEnergies, ['subBass', 'bass'], [0.3, 0.7]);
      // Use spectral flux in the bass range specifically for note changes
      const bassFlux = this._combineBands(bandFlux, ['subBass', 'bass'], [0.3, 0.7]);

      const bassOnsets = this._detectOnsets(bassFlux, {
        sensitivity: sensitivityBass,
        minInterval: minIntervalBass,
        adaptiveWindow: 20,
        useHFC: false,
      });
      results.bass = bassOnsets.map(i => ({
        time: this._frameToTime(i),
        frame: i,
        strength: bassEnergy[i],
        type: 'bass',
      }));
    }

    // ── MELODY DETECTION ──
    if (detectMelody) {
      if (progressCallback) progressCallback(85, "Detecting melody changes...");
      if (isCancelled()) return null;
      // Melody lives in the mid range — detect pitch/note changes via spectral flux
      const melodyFlux = this._combineBands(bandFlux, ['lowMid', 'highMid'], [0.5, 0.5]);
      // Spectral centroid changes indicate melodic movement
      const centroidFlux = this._computeCentroidFlux(spectrogram);
      const combinedMelody = melodyFlux.map((e, i) => e * 0.6 + (centroidFlux[i] || 0) * 0.4);

      const melodyOnsets = this._detectOnsets(combinedMelody, {
        sensitivity: sensitivityMelody,
        minInterval: minIntervalMelody,
        adaptiveWindow: 15,
        useHFC: false,
      });
      results.melody = melodyOnsets.map(i => ({
        time: this._frameToTime(i),
        frame: i,
        strength: combinedMelody[i],
        type: 'melody',
      }));
    }

    // ── VOCAL DETECTION ──
    if (detectVocal) {
      if (progressCallback) progressCallback(88, "Detecting vocal onsets...");
      // Vocals are 300-4000 Hz, detection via spectral centroid in that range
      const vocalFlux = this._computeVocalFlux(spectrogram);
      const vocalOnsets = this._detectOnsets(vocalFlux, {
        sensitivity: sensitivityVocal,
        minInterval: minIntervalVocal,
        adaptiveWindow: 18,
        useHFC: false,
      });
      results.vocal = vocalOnsets.map(i => ({
        time: this._frameToTime(i),
        frame: i,
        strength: vocalFlux[i],
        type: 'vocal',
      }));
    }

    // ── BPM ESTIMATION ──
    if (progressCallback) progressCallback(92, "Estimating BPM...");
    const allOnsetEnergy = this._combineBands(bandEnergies,
      ['subBass', 'bass', 'lowMid', 'highMid'], [0.3, 0.2, 0.25, 0.25]);
    results.bpm = this._estimateBPM(allOnsetEnergy);

    if (progressCallback) progressCallback(100, "Analysis complete");

    return results;
  }

  // ══════════════════════════════════════════════════
  //  DSP CORE
  // ══════════════════════════════════════════════════

  _mixToMono(audioBuffer) {
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0);
    }
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      mono[i] = (left[i] + right[i]) * 0.5;
    }
    return mono;
  }

  /**
   * Short-Time Fourier Transform
   * Returns array of magnitude spectra, or null if cancelled.
   */
  _computeSTFT(samples, progressCallback, cancelToken = null) {
    const numFrames = Math.floor((samples.length - this.fftSize) / this.hopSize) + 1;
    const spectrogram = [];
    const halfFFT = this.fftSize / 2;

    // Hann window
    const window = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.fftSize - 1)));
    }

    for (let frame = 0; frame < numFrames; frame++) {
      // Check cancellation every 200 frames to keep UI responsive
      if (frame % 200 === 0 && cancelToken && cancelToken.cancelled) {
        return null;
      }

      const start = frame * this.hopSize;

      // Apply window
      const windowed = new Float32Array(this.fftSize);
      for (let i = 0; i < this.fftSize; i++) {
        windowed[i] = (samples[start + i] || 0) * window[i];
      }

      // FFT (using simple radix-2 DIT)
      const spectrum = this._fft(windowed);
      const magnitudes = new Float32Array(halfFFT);
      for (let i = 0; i < halfFFT; i++) {
        magnitudes[i] = Math.sqrt(spectrum.real[i] * spectrum.real[i] +
                                   spectrum.imag[i] * spectrum.imag[i]);
      }

      spectrogram.push(magnitudes);

      if (progressCallback && frame % 500 === 0) {
        const pct = 10 + Math.floor((frame / numFrames) * 40);
        progressCallback(pct, `Spectral analysis: ${Math.floor(frame / numFrames * 100)}%`);
      }
    }

    return spectrogram;
  }

  /**
   * Radix-2 FFT (Cooley-Tukey)
   */
  _fft(input) {
    const N = input.length;
    if (N <= 1) {
      return { real: new Float32Array([input[0] || 0]), imag: new Float32Array([0]) };
    }

    // Bit-reversal permutation
    const real = new Float32Array(N);
    const imag = new Float32Array(N);

    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let reversed = 0;
      let val = i;
      for (let b = 0; b < bits; b++) {
        reversed = (reversed << 1) | (val & 1);
        val >>= 1;
      }
      real[reversed] = input[i];
    }

    // Butterfly operations
    for (let size = 2; size <= N; size *= 2) {
      const halfSize = size / 2;
      const angle = -2 * Math.PI / size;

      for (let i = 0; i < N; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const wr = Math.cos(angle * j);
          const wi = Math.sin(angle * j);

          const tReal = wr * real[i + j + halfSize] - wi * imag[i + j + halfSize];
          const tImag = wr * imag[i + j + halfSize] + wi * real[i + j + halfSize];

          real[i + j + halfSize] = real[i + j] - tReal;
          imag[i + j + halfSize] = imag[i + j] - tImag;
          real[i + j] += tReal;
          imag[i + j] += tImag;
        }
      }
    }

    return { real, imag };
  }

  // ══════════════════════════════════════════════════
  //  BAND ENERGY EXTRACTION
  // ══════════════════════════════════════════════════

  _binForFreq(freq) {
    return Math.round(freq * this.fftSize / this.sampleRate);
  }

  _extractBandEnergies(spectrogram) {
    const result = {};
    for (const [bandName, range] of Object.entries(this.bands)) {
      const lowBin = this._binForFreq(range.low);
      const highBin = Math.min(this._binForFreq(range.high), this.fftSize / 2 - 1);
      const numBins = highBin - lowBin + 1;

      result[bandName] = spectrogram.map(frame => {
        let energy = 0;
        for (let b = lowBin; b <= highBin; b++) {
          energy += frame[b] * frame[b];
        }
        return energy / numBins;
      });
    }
    return result;
  }

  // ══════════════════════════════════════════════════
  //  SPECTRAL FLUX (per band)
  // ══════════════════════════════════════════════════

  _computeBandFlux(spectrogram) {
    const result = {};
    for (const [bandName, range] of Object.entries(this.bands)) {
      const lowBin = this._binForFreq(range.low);
      const highBin = Math.min(this._binForFreq(range.high), this.fftSize / 2 - 1);

      const flux = new Float32Array(spectrogram.length);
      for (let i = 1; i < spectrogram.length; i++) {
        let sum = 0;
        for (let b = lowBin; b <= highBin; b++) {
          const diff = spectrogram[i][b] - spectrogram[i - 1][b];
          if (diff > 0) sum += diff * diff; // Half-wave rectified
        }
        flux[i] = Math.sqrt(sum);
      }
      result[bandName] = flux;
    }
    return result;
  }

  // ══════════════════════════════════════════════════
  //  SPECTRAL FEATURES
  // ══════════════════════════════════════════════════

  /**
   * High Frequency Content — weights spectrum by frequency,
   * emphasizing high-frequency transients (hi-hats, cymbals)
   */
  _computeHFC(spectrogram) {
    return spectrogram.map(frame => {
      let hfc = 0;
      for (let b = 0; b < frame.length; b++) {
        hfc += frame[b] * frame[b] * (b + 1);
      }
      return hfc / frame.length;
    });
  }

  /**
   * Spectral broadness — measures how spread the energy is.
   * Snare drums have very broad spectra (noise-like).
   */
  _computeSpectralBroadness(spectrogram) {
    return spectrogram.map(frame => {
      let totalEnergy = 0;
      let centroid = 0;
      for (let b = 0; b < frame.length; b++) {
        const e = frame[b] * frame[b];
        totalEnergy += e;
        centroid += e * b;
      }
      if (totalEnergy === 0) return 0;
      centroid /= totalEnergy;

      // Spectral spread (variance)
      let spread = 0;
      for (let b = 0; b < frame.length; b++) {
        const e = frame[b] * frame[b];
        spread += e * (b - centroid) * (b - centroid);
      }
      spread = Math.sqrt(spread / totalEnergy);

      // Normalize
      return Math.min(1, spread / (frame.length * 0.3));
    });
  }

  /**
   * Spectral centroid flux — measures melodic movement
   */
  _computeCentroidFlux(spectrogram) {
    const lowBin = this._binForFreq(300);
    const highBin = this._binForFreq(6000);

    const centroids = spectrogram.map(frame => {
      let totalEnergy = 0;
      let centroid = 0;
      for (let b = lowBin; b <= highBin && b < frame.length; b++) {
        const e = frame[b] * frame[b];
        totalEnergy += e;
        centroid += e * b;
      }
      return totalEnergy > 0 ? centroid / totalEnergy : 0;
    });

    // Flux of centroid changes
    const flux = new Float32Array(centroids.length);
    for (let i = 1; i < centroids.length; i++) {
      flux[i] = Math.abs(centroids[i] - centroids[i - 1]);
    }

    // Normalize
    const maxFlux = Math.max(...flux) || 1;
    for (let i = 0; i < flux.length; i++) {
      flux[i] /= maxFlux;
    }

    return flux;
  }

  /**
   * Vocal-range spectral flux (300-4000 Hz)
   */
  _computeVocalFlux(spectrogram) {
    const lowBin = this._binForFreq(300);
    const highBin = this._binForFreq(4000);

    const flux = new Float32Array(spectrogram.length);
    for (let i = 1; i < spectrogram.length; i++) {
      let sum = 0;
      for (let b = lowBin; b <= highBin && b < spectrogram[i].length; b++) {
        const diff = spectrogram[i][b] - spectrogram[i - 1][b];
        if (diff > 0) sum += diff * diff;
      }
      flux[i] = Math.sqrt(sum);
    }

    // Normalize
    const maxFlux = Math.max(...flux) || 1;
    for (let i = 0; i < flux.length; i++) {
      flux[i] /= maxFlux;
    }

    return flux;
  }

  // ══════════════════════════════════════════════════
  //  BAND COMBINATION
  // ══════════════════════════════════════════════════

  _combineBands(bandData, bandNames, weights) {
    const length = bandData[bandNames[0]].length;
    const combined = new Float32Array(length);

    for (let i = 0; i < bandNames.length; i++) {
      const data = bandData[bandNames[i]];
      const weight = weights[i];
      for (let j = 0; j < length; j++) {
        combined[j] += (data[j] || 0) * weight;
      }
    }

    // Normalize
    let max = 0;
    for (let i = 0; i < combined.length; i++) {
      if (combined[i] > max) max = combined[i];
    }
    if (max > 0) {
      for (let i = 0; i < combined.length; i++) {
        combined[i] /= max;
      }
    }

    return combined;
  }

  // ══════════════════════════════════════════════════
  //  ONSET DETECTION
  // ══════════════════════════════════════════════════

  /**
   * Adaptive threshold onset detection with peak picking.
   *
   * sensitivity: 0-1 (higher = more detections)
   * minInterval: minimum seconds between detections
   * adaptiveWindow: frames for local mean computation
   */
  _detectOnsets(signal, options = {}) {
    const {
      sensitivity = 0.5,
      minInterval = 0.1,
      adaptiveWindow = 15,
    } = options;

    // Convert sensitivity to threshold multiplier (inverted: high sensitivity = low threshold)
    const thresholdMult = 1.0 + (1.0 - sensitivity) * 3.0; // Range: 1.0 - 4.0
    const minGapFrames = Math.floor(minInterval * this.sampleRate / this.hopSize);

    // Compute onset detection function (first-order difference, half-wave rectified)
    const odf = new Float32Array(signal.length);
    for (let i = 1; i < signal.length; i++) {
      const diff = signal[i] - signal[i - 1];
      odf[i] = diff > 0 ? diff : 0;
    }

    // Adaptive threshold
    const onsets = [];
    for (let i = adaptiveWindow; i < odf.length - adaptiveWindow; i++) {
      // Local mean
      let localMean = 0;
      for (let j = i - adaptiveWindow; j <= i + adaptiveWindow; j++) {
        localMean += odf[j];
      }
      localMean /= (2 * adaptiveWindow + 1);

      const threshold = localMean * thresholdMult + 0.001;

      // Peak picking: must be above threshold AND a local maximum
      if (odf[i] > threshold &&
          odf[i] >= odf[i - 1] &&
          odf[i] >= odf[i + 1]) {

        // Check minimum gap from last onset
        if (onsets.length === 0 || (i - onsets[onsets.length - 1]) >= minGapFrames) {
          onsets.push(i);
        } else if (odf[i] > odf[onsets[onsets.length - 1]]) {
          // Replace previous if this one is stronger
          onsets[onsets.length - 1] = i;
        }
      }
    }

    return onsets;
  }

  // ══════════════════════════════════════════════════
  //  BPM ESTIMATION
  // ══════════════════════════════════════════════════

  _estimateBPM(energySignal) {
    // Use autocorrelation on the onset detection function
    const odf = new Float32Array(energySignal.length);
    for (let i = 1; i < energySignal.length; i++) {
      const diff = energySignal[i] - energySignal[i - 1];
      odf[i] = diff > 0 ? diff : 0;
    }

    // Autocorrelation for lag range corresponding to 50-200 BPM
    const minLag = Math.floor(60 / 200 * this.sampleRate / this.hopSize);
    const maxLag = Math.floor(60 / 50 * this.sampleRate / this.hopSize);
    const acfLength = Math.min(maxLag + 1, odf.length);

    let bestLag = minLag;
    let bestCorr = -Infinity;

    for (let lag = minLag; lag <= maxLag && lag < acfLength; lag++) {
      let corr = 0;
      let count = 0;
      for (let i = 0; i < odf.length - lag; i++) {
        corr += odf[i] * odf[i + lag];
        count++;
      }
      corr /= count;

      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    const beatIntervalSec = bestLag * this.hopSize / this.sampleRate;
    let bpm = 60 / beatIntervalSec;

    // Normalize to common range
    while (bpm > 200) bpm /= 2;
    while (bpm < 60) bpm *= 2;

    return Math.round(bpm * 10) / 10;
  }

  // ══════════════════════════════════════════════════
  //  UTILITIES
  // ══════════════════════════════════════════════════

  _frameToTime(frameIndex) {
    return frameIndex * this.hopSize / this.sampleRate;
  }
}

// Export for UXP
if (typeof module !== 'undefined') {
  module.exports = AudioAnalyzer;
}
