export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const randRange = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function formatScore(n) {
  return Math.round(n).toString().padStart(6, '0');
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

let hapticsScale = 1;
export function setHapticsIntensity(v) {
  hapticsScale = clamp(v, 0, 1);
}

export function vibrate(pattern) {
  if (!hapticsScale || !navigator.vibrate) return;
  const scaled = (Array.isArray(pattern) ? pattern : [pattern]).map((n) =>
    Math.max(1, Math.round(n * hapticsScale))
  );
  try {
    navigator.vibrate(scaled);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

/** One-pole low-pass filter for noisy sensor streams. */
export class Smoother {
  constructor(alpha = 0.15, initial = 0) {
    this.alpha = alpha;
    this.value = initial;
    this.primed = false;
  }
  push(v) {
    if (!this.primed) {
      this.value = v;
      this.primed = true;
    } else {
      this.value += (v - this.value) * this.alpha;
    }
    return this.value;
  }
  reset(v = 0) {
    this.value = v;
    this.primed = false;
  }
}
