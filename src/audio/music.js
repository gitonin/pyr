import { audio, getNoiseBuffer } from './audio.js';
import { CONFIG } from '../core/config.js';
import { clamp } from '../core/utils.js';
import { bus } from '../core/events.js';

/**
 * Lookahead sequencer. A setInterval "tick" schedules notes a little ahead of
 * the audio clock, so everything lands sample-accurate even when rAF stutters.
 * Gameplay code never plays a percussive sound directly on a frame boundary —
 * it asks nextQuantised() for the upcoming subdivision and schedules there.
 */

const STEPS_PER_BAR = 16; // 16th notes

class MusicEngine {
  constructor() {
    this.bpm = CONFIG.audio.bpm;
    this.playing = false;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.intensity = 0; // 0..1, rises with level and with player stability
    this.stability = 1;
    this.padNodes = null;
  }

  get stepDuration() {
    return 60 / this.bpm / 4;
  }

  setBpm(bpm) {
    this.bpm = clamp(bpm, 40, 200);
  }

  setIntensity(v) {
    this.intensity = clamp(v, 0, 1);
  }

  setStability(v) {
    this.stability = clamp(v, 0, 1);
    if (this.padNodes && audio.ctx) {
      // Instability opens the pad filter and detunes it: the mix gets edgier.
      const t = audio.now;
      this.padNodes.filter.frequency.setTargetAtTime(420 + (1 - this.stability) * 1500, t, 0.3);
      this.padNodes.detune.detune.setTargetAtTime((1 - this.stability) * 45, t, 0.3);
    }
  }

  start() {
    if (!audio.ready || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextNoteTime = audio.now + 0.08;
    this._startPad();
    this.timer = setInterval(() => this._schedule(), CONFIG.audio.lookahead * 1000);
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this._stopPad();
  }

  /** Audio-clock time of the next subdivision boundary, for quantised SFX. */
  nextQuantised(division = 4) {
    if (!audio.ctx) return 0;
    const now = audio.now;
    if (!this.playing) return now;
    const grid = this.stepDuration * (STEPS_PER_BAR / division / 4);
    const since = now - this.nextNoteTime;
    const k = Math.ceil(since / grid);
    const t = this.nextNoteTime + k * grid;
    // Never schedule in the past, never delay a tap by more than a 16th.
    return Math.max(now + 0.005, Math.min(t, now + this.stepDuration));
  }

  _schedule() {
    if (!audio.ctx) return;
    const ahead = CONFIG.audio.scheduleAhead;
    while (this.nextNoteTime < audio.now + ahead) {
      this._playStep(this.step, this.nextNoteTime);
      bus.emit('music:step', { step: this.step, time: this.nextNoteTime });
      this.nextNoteTime += this.stepDuration;
      this.step = (this.step + 1) % (STEPS_PER_BAR * 4);
    }
  }

  _playStep(step, time) {
    const s = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const I = this.intensity;
    const dest = audio.musicBus;

    // Kick: half-time at low intensity, four-on-the-floor as it rises.
    if (s % 8 === 0 || (I > 0.45 && s % 4 === 0)) this._kick(time, dest, 0.9);
    // Sub bass follows the kick with a slow root movement per bar.
    if (s % 8 === 0) {
      const roots = [55, 55, 61.74, 49];
      this._sub(time, dest, roots[bar % roots.length], this.stepDuration * 7);
    }
    // Hats arrive with intensity and thicken on offbeats.
    if (I > 0.3 && s % 4 === 2) this._hat(time, dest, 0.5 + I * 0.5);
    if (I > 0.7 && s % 2 === 1) this._hat(time, dest, 0.25);
    // Sparse bell motif in the upper register.
    if (I > 0.5 && (s === 6 || s === 14) && bar % 2 === 1) {
      this._bell(time, dest, s === 6 ? 987.77 : 1318.5, 0.06 + I * 0.05);
    }
  }

  _kick(time, dest, gain) {
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain * (0.35 + this.intensity * 0.3), time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + 0.4);
  }

  _sub(time, dest, freq, dur) {
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.12 + this.intensity * 0.1, time + 0.05);
    g.gain.setTargetAtTime(0.0001, time + dur * 0.6, 0.25);
    osc.connect(lp);
    lp.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.5);
  }

  _hat(time, dest, gain) {
    const ctx = audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.05 * gain, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    src.connect(hp);
    hp.connect(g);
    g.connect(dest);
    src.start(time, Math.random());
    src.stop(time + 0.1);
  }

  _bell(time, dest, freq, gain) {
    const ctx = audio.ctx;
    [1, 2.01].forEach((m, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * m;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain / (i + 1), time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 1.4 - i * 0.5);
      osc.connect(g);
      g.connect(dest);
      osc.start(time);
      osc.stop(time + 1.6);
    });
  }

  /** Sustained detuned-saw pad: the bed the whole soundtrack sits on. */
  _startPad() {
    const ctx = audio.ctx;
    if (!ctx || this.padNodes) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.06, audio.now, 2.5);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const detune = ctx.createGain(); // parked node used only for its .detune proxy
    detune.detune = { setTargetAtTime: () => {} };

    const oscs = [110, 164.81, 220, 329.63].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 7;
      o.connect(filter);
      o.start();
      return o;
    });
    // Real detune proxy over the actual oscillators.
    detune.detune = {
      setTargetAtTime: (v, t, c) =>
        oscs.forEach((o, i) => o.detune.setTargetAtTime((i - 1.5) * 7 + (i % 2 ? v : -v), t, c)),
    };

    filter.connect(g);
    g.connect(audio.musicBus);
    this.padNodes = { oscs, filter, g, lfo, detune };
  }

  _stopPad() {
    if (!this.padNodes || !audio.ctx) return;
    const { oscs, g, lfo } = this.padNodes;
    g.gain.setTargetAtTime(0.0001, audio.now, 0.5);
    setTimeout(() => {
      oscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* noop */
        }
      });
      try {
        lfo.stop();
      } catch {
        /* noop */
      }
    }, 1600);
    this.padNodes = null;
  }
}

export const music = new MusicEngine();
