import { CONFIG } from '../core/config.js';
import { clamp, Smoother } from '../core/utils.js';
import { requestMicrophone } from './permissions.js';
import { bus } from '../core/events.js';

/**
 * Breath detector.
 *
 * Privacy: the stream is routed into an AnalyserNode and nothing else. No
 * MediaRecorder, no buffers kept, no network. Only two scalars leave this
 * module: an intensity and a boolean. release() stops every track.
 *
 * Detection: a breath is broadband noise close to the mic. A tone (speech,
 * music) has a peaky spectrum, a tap has a single transient. So we require
 * BOTH sustained energy above the calibrated room floor AND high spectral
 * flatness, then smooth the result so the mist reacts fluidly.
 */
class MicManager {
  constructor() {
    this.available = false;
    this.mode = 'none'; // 'none' | 'mic' | 'touch'
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.timeBuf = null;
    this.freqBuf = null;

    this.ambientRms = 0.006;
    this.calibrating = false;
    this._calibSamples = [];
    this._calibUntil = 0;

    this.level = 0; // smoothed 0..1 blow strength
    this.rms = 0;
    this.flatness = 0;
    this.isBlowing = false;
    this.breathCount = 0;
    this._wasBlowing = false;
    this._smoother = new Smoother(CONFIG.mic.smoothing);
    this._touchHeld = false;
    this._touchLevel = 0;
  }

  /**
   * @param {() => Promise<AudioContext>} getCtx resolves the game's shared
   *   context. It is called only after the stream exists, so getUserMedia can
   *   be issued synchronously inside the user gesture that triggered it —
   *   iOS revokes the activation if anything is awaited first.
   */
  async enable(getCtx) {
    const res = await requestMicrophone();
    if (!res.ok) {
      this.mode = 'touch';
      bus.emit('mic:unavailable', res.reason);
      return { ok: false, reason: res.reason };
    }
    this.stream = res.stream;
    this.ctx = await getCtx();
    if (!this.ctx) {
      this.release();
      this.mode = 'touch';
      bus.emit('mic:unavailable', 'noaudio');
      return { ok: false, reason: 'unavailable' };
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = CONFIG.mic.fftSize;
    this.analyser.smoothingTimeConstant = 0.5;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser); // analyser is a sink: never reaches output
    this.timeBuf = new Float32Array(this.analyser.fftSize);
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.available = true;
    this.mode = 'mic';
    bus.emit('mic:ready');
    return { ok: true };
  }

  useTouchFallback() {
    this.mode = 'touch';
  }

  startCalibration() {
    if (this.mode !== 'mic') return;
    this.calibrating = true;
    this._calibSamples = [];
    this._calibUntil = performance.now() + CONFIG.mic.calibrationSeconds * 1000;
  }

  setTouchBlow(active) {
    this._touchHeld = active;
  }

  update(dt) {
    if (this.mode === 'touch') {
      const target = this._touchHeld ? 1 : 0;
      this._touchLevel += (target - this._touchLevel) * Math.min(1, dt * 6);
      this.level = this._touchLevel;
      this.rms = this.level * 0.2;
      this._updateBreathCount(this.level > 0.35);
      return this.level;
    }
    if (!this.available) return 0;

    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    this.rms = Math.sqrt(sum / this.timeBuf.length);

    if (this.calibrating) {
      this._calibSamples.push(this.rms);
      if (performance.now() >= this._calibUntil) {
        this._calibSamples.sort((a, b) => a - b);
        const median = this._calibSamples[Math.floor(this._calibSamples.length / 2)] || 0.006;
        this.ambientRms = Math.max(CONFIG.mic.minRms, median);
        this.calibrating = false;
        bus.emit('mic:calibrated', this.ambientRms);
      }
      this.level = 0;
      return 0;
    }

    this.analyser.getByteFrequencyData(this.freqBuf);
    this.flatness = spectralFlatness(this.freqBuf);

    const floor = this.ambientRms * CONFIG.mic.thresholdOverAmbient;
    const over = (this.rms - floor) / Math.max(floor, 0.02);
    const energetic = clamp(over, 0, 1.4);
    const noiseLike = this.flatness >= CONFIG.mic.flatnessMin ? 1 : this.flatness / CONFIG.mic.flatnessMin;

    const instant = clamp(energetic * noiseLike, 0, 1);
    this.level = this._smoother.push(instant);
    this._updateBreathCount(this.level > 0.3);
    return this.level;
  }

  _updateBreathCount(blowing) {
    this.isBlowing = blowing;
    if (blowing && !this._wasBlowing) {
      this.breathCount++;
      bus.emit('mic:breath');
    }
    this._wasBlowing = blowing;
  }

  release() {
    try {
      this.source?.disconnect();
      this.stream?.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* already torn down */
    }
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.available = false;
    this.level = 0;
    this.isBlowing = false;
  }
}

/** Geometric mean / arithmetic mean of the magnitude spectrum: 1 = white noise. */
function spectralFlatness(bins) {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  // Skip the lowest bins: room rumble and handling noise live there.
  for (let i = 4; i < bins.length; i++) {
    const v = bins[i] / 255 + 1e-5;
    logSum += Math.log(v);
    sum += v;
    n++;
  }
  if (!n || sum === 0) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

export const mic = new MicManager();
