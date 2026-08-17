/** localStorage wrapper that degrades to memory when storage is unavailable. */

const KEY = 'youman.v1';
const memory = new Map();

let backend;
try {
  const probe = '__youman_probe__';
  window.localStorage.setItem(probe, '1');
  window.localStorage.removeItem(probe);
  backend = window.localStorage;
} catch {
  backend = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
  };
}

const DEFAULTS = {
  bestScore: 0,
  language: null, // null = auto-detect once
  musicVolume: 0.55,
  sfxVolume: 0.75,
  hapticsIntensity: 0.7,
  gyroSensitivity: 1,
  quality: 'auto',
  highContrast: false,
  muted: false,
  seenHowTo: false,
};

function read() {
  try {
    return { ...DEFAULTS, ...JSON.parse(backend.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let cache = read();

export const store = {
  get(key) {
    return cache[key];
  },
  all() {
    return { ...cache };
  },
  set(key, value) {
    cache[key] = value;
    this.flush();
  },
  merge(patch) {
    cache = { ...cache, ...patch };
    this.flush();
  },
  flush() {
    try {
      backend.setItem(KEY, JSON.stringify(cache));
    } catch (err) {
      console.warn('[storage] could not persist settings', err);
    }
  },
};
