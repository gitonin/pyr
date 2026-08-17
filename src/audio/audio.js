import { CONFIG } from '../core/config.js';
import { store } from '../core/storage.js';
import { clamp } from '../core/utils.js';
import { bus } from '../core/events.js';

/**
 * Owns the single AudioContext and the mix buses.
 *
 *   master ── musicBus ── (music.js)
 *          └─ sfxBus   ── (sfx.js)
 *
 * Browsers require a user gesture before audio starts, so unlock() is called
 * from the first tap; everything before that is silently skipped.
 */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = store.get('muted') || false;
    this.musicVolume = store.get('musicVolume');
    this.sfxVolume = store.get('sfxVolume');
    this._duckUntil = 0;
  }

  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        console.warn('[audio] Web Audio API unavailable — running silent');
        return false;
      }
      this.ctx = new Ctor({ latencyHint: 'interactive' });

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;

      // A gentle limiter keeps stacked synth voices from clipping on phones.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.2;

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;

      // Shared reverb gives every source the same room; cheaper than per-voice.
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = makeImpulse(this.ctx, 2.6, 2.4);
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.32;

      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.reverbSend);
      this.sfxBus.connect(this.reverbSend);
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.master);
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);

      this.ready = true;
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('[audio] resume rejected', err);
      }
    }
    return this.ctx.state === 'running';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMuted(m) {
    this.muted = m;
    store.set('muted', m);
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.now);
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.now, 0.05);
    }
    bus.emit('audio:muted', m);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMusicVolume(v) {
    this.musicVolume = clamp(v, 0, 1);
    store.set('musicVolume', this.musicVolume);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.now, 0.08);
  }

  setSfxVolume(v) {
    this.sfxVolume = clamp(v, 0, 1);
    store.set('sfxVolume', this.sfxVolume);
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.now, 0.08);
  }

  /** Pull the music down under an important message, then bring it back. */
  duck(seconds = 1.6, amount = 0.35) {
    if (!this.ready) return;
    const t = this.now;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * amount, t, 0.08);
    this.musicBus.gain.setTargetAtTime(this.musicVolume, t + seconds, 0.35);
  }

  suspend() {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }
}

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export const audio = new AudioManager();

/** Shared white-noise buffer — allocated once, reused by every noise voice. */
let noiseBuffer = null;
export function getNoiseBuffer(ctx) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

export { CONFIG as AUDIO_CONFIG };
