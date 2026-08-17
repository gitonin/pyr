import { audio, getNoiseBuffer } from './audio.js';
import { clamp, randRange } from '../core/utils.js';

/**
 * Every sound in YOU MAN is synthesised at runtime — there are no audio files
 * to download, decode or 404. If you want to swap in recorded assets later,
 * replace the bodies here; the call sites take no other dependency.
 *
 * PLACEHOLDER_SFX: the procedural voices below stand in for a final sound
 * design pass. Keys: glass, sandLoop, tension, calibrate, count, impact,
 * artifact_{cyan,red,orange,violet,white}, pixelBurst, breath, success, fail.
 */

function env(param, t, { attack = 0.005, decay = 0.2, peak = 1, sustain = 0, hold = 0 }) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack);
  if (hold) param.setValueAtTime(Math.max(0.0001, peak), t + attack + hold);
  param.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + attack + hold + decay);
}

function tone({ freq, type = 'sine', dur = 0.3, gain = 0.3, attack = 0.005, detune = 0, dest, at, glideTo }) {
  const ctx = audio.ctx;
  if (!ctx) return;
  const t = at ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
  osc.detune.value = detune;
  env(g.gain, t, { attack, decay: dur, peak: gain });
  osc.connect(g);
  g.connect(dest || audio.sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.1);
  return { osc, g };
}

function noise({ dur = 0.3, gain = 0.3, filter = 'bandpass', freq = 1200, q = 1, dest, at, sweepTo }) {
  const ctx = audio.ctx;
  if (!ctx) return;
  const t = at ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.frequency.setValueAtTime(freq, t);
  if (sweepTo) bq.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
  bq.Q.value = q;
  const g = ctx.createGain();
  env(g.gain, t, { attack: 0.004, decay: dur, peak: gain });
  src.connect(bq);
  bq.connect(g);
  g.connect(dest || audio.sfxBus);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.1);
  return { src, bq, g };
}

export const sfx = {
  /** UI tick when a button is pressed. */
  ui(at) {
    tone({ freq: 880, type: 'triangle', dur: 0.09, gain: 0.14, at });
    tone({ freq: 1760, type: 'sine', dur: 0.05, gain: 0.06, at });
  },

  /** Crystalline chime — menus, level entry, calibration success. */
  glass(at, root = 1046) {
    [1, 1.5, 2.25].forEach((m, i) => {
      tone({
        freq: root * m,
        type: 'sine',
        dur: 0.9 - i * 0.15,
        gain: 0.16 / (i + 1),
        attack: 0.008,
        at: (at ?? audio.now) + i * 0.045,
      });
    });
  },

  calibrate(at) {
    const t = at ?? audio.now;
    [523.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, type: 'sine', dur: 0.7, gain: 0.18, at: t + i * 0.12 })
    );
    noise({ dur: 0.5, gain: 0.05, freq: 4000, filter: 'highpass', at: t });
  },

  /** Countdown digit: a dull impact with a bright transient. */
  count(at, index = 0) {
    const t = at ?? audio.now;
    tone({ freq: 120 - index * 12, type: 'sine', dur: 0.35, gain: 0.5, glideTo: 55, at: t });
    noise({ dur: 0.18, gain: 0.12, freq: 2200, filter: 'bandpass', q: 0.8, at: t });
  },

  go(at) {
    const t = at ?? audio.now;
    tone({ freq: 220, type: 'sawtooth', dur: 1.1, gain: 0.28, glideTo: 110, at: t });
    [261.6, 392, 523.25, 659.25].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 1.2, gain: 0.1, at: t + i * 0.02 })
    );
    noise({ dur: 0.9, gain: 0.18, freq: 6000, filter: 'highpass', sweepTo: 400, at: t });
  },

  /** Rising tension drone while the player is inside the warning zone. */
  tension(intensity = 0.5, at) {
    const t = at ?? audio.now;
    tone({
      freq: 62 + intensity * 30,
      type: 'sawtooth',
      dur: 0.45,
      gain: 0.06 + intensity * 0.16,
      at: t,
    });
    noise({ dur: 0.4, gain: 0.03 + intensity * 0.07, freq: 300 + intensity * 900, q: 3, at: t });
  },

  artifact(kind, at) {
    const t = at ?? audio.now;
    switch (kind) {
      case 'cyan':
        tone({ freq: 1568, type: 'sine', dur: 0.28, gain: 0.22, at: t });
        tone({ freq: 2349, type: 'sine', dur: 0.18, gain: 0.1, at: t + 0.01 });
        break;
      case 'red':
        tone({ freq: 92, type: 'square', dur: 0.3, gain: 0.34, glideTo: 46, at: t });
        noise({ dur: 0.14, gain: 0.16, freq: 700, filter: 'lowpass', at: t });
        break;
      case 'orange':
        tone({ freq: 640, type: 'square', dur: 0.16, gain: 0.16, at: t });
        noise({ dur: 0.2, gain: 0.14, freq: 3200, q: 6, at: t });
        break;
      case 'violet':
        tone({ freq: 415, type: 'sawtooth', dur: 0.5, gain: 0.14, glideTo: 1660, at: t });
        tone({ freq: 622, type: 'sine', dur: 0.45, gain: 0.08, at: t + 0.03 });
        break;
      case 'white':
      default:
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          tone({ freq: f, type: 'triangle', dur: 0.8, gain: 0.13, at: t + i * 0.035 })
        );
        break;
    }
  },

  /** Short granular burst that reads as "pixels flying apart". */
  pixelBurst(at, tint = 1) {
    const t = at ?? audio.now;
    for (let i = 0; i < 5; i++) {
      noise({
        dur: 0.05,
        gain: 0.07,
        freq: randRange(1500, 7000) * tint,
        q: 8,
        at: t + i * 0.014,
      });
    }
  },

  miss(at) {
    const t = at ?? audio.now;
    tone({ freq: 180, type: 'sawtooth', dur: 0.5, gain: 0.22, glideTo: 60, at: t });
    noise({ dur: 0.4, gain: 0.1, freq: 900, filter: 'lowpass', sweepTo: 120, at: t });
  },

  /** Airy response while the player is blowing; called on a slow cadence. */
  breath(intensity = 0.5, at) {
    noise({
      dur: 0.5,
      gain: 0.04 + intensity * 0.1,
      freq: 900 + intensity * 2600,
      filter: 'bandpass',
      q: 0.7,
      sweepTo: 400,
      at,
    });
  },

  mistClear(at) {
    const t = at ?? audio.now;
    noise({ dur: 1.4, gain: 0.14, freq: 200, filter: 'highpass', sweepTo: 7000, at: t });
    [523.25, 659.25, 987.77].forEach((f, i) =>
      tone({ freq: f, type: 'sine', dur: 1.6, gain: 0.1, at: t + i * 0.08 })
    );
  },

  success(at) {
    const t = at ?? audio.now;
    [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 1.6 - i * 0.12, gain: 0.14, at: t + i * 0.09 })
    );
    noise({ dur: 1.2, gain: 0.07, freq: 300, filter: 'highpass', sweepTo: 6000, at: t });
  },

  fail(at) {
    const t = at ?? audio.now;
    tone({ freq: 330, type: 'sawtooth', dur: 1.6, gain: 0.26, glideTo: 41, at: t });
    tone({ freq: 220, type: 'square', dur: 1.4, gain: 0.14, glideTo: 33, at: t + 0.05 });
    noise({ dur: 1.3, gain: 0.18, freq: 2400, filter: 'lowpass', sweepTo: 80, at: t });
  },

  /** Glass shattering when the pyramids topple. */
  shatter(at) {
    const t = at ?? audio.now;
    for (let i = 0; i < 12; i++) {
      noise({
        dur: randRange(0.08, 0.3),
        gain: randRange(0.04, 0.12),
        freq: randRange(2000, 9000),
        q: 10,
        at: t + Math.random() * 0.35,
      });
    }
  },
};

/**
 * Continuous sand-fall hiss. Its gain follows the flow rate and its filter
 * follows the tilt, so the sound reports the state of the game on its own.
 */
export class SandVoice {
  constructor() {
    this.nodes = null;
  }

  start() {
    const ctx = audio.ctx;
    if (!ctx || this.nodes) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(audio.sfxBus);
    src.start();
    this.nodes = { src, bp, g };
  }

  set(flow, agitation = 0) {
    if (!this.nodes || !audio.ctx) return;
    const t = audio.now;
    this.nodes.g.gain.setTargetAtTime(clamp(flow, 0, 1) * 0.09, t, 0.12);
    this.nodes.bp.frequency.setTargetAtTime(1800 + agitation * 2600, t, 0.15);
  }

  stop() {
    if (!this.nodes) return;
    const t = audio.now;
    this.nodes.g.gain.setTargetAtTime(0.0001, t, 0.15);
    const { src } = this.nodes;
    setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, 500);
    this.nodes = null;
  }
}
