import { CONFIG } from '../core/config.js';
import { clamp, Smoother } from '../core/utils.js';
import { bus } from '../core/events.js';
import { store } from '../core/storage.js';

/**
 * Single source of truth for "which way is the player leaning the device".
 *
 * Output is a normalised vector in [-1, 1]:
 *   x  > 0  -> player is tilting right
 *   y  > 0  -> player is tilting forward (top of the phone away from them)
 *
 * Two backends feed it: real device orientation, and a pointer/keyboard
 * fallback so the game is fully playable on desktop or on a phone whose
 * gyroscope is missing or blocked.
 */

const RANGE_DEG = 26; // device tilt that maps to full deflection

class TiltManager {
  constructor() {
    this.mode = 'touch';
    this.raw = { beta: 0, gamma: 0 };
    this.neutral = { beta: 0, gamma: 0 };
    this.calibrated = false;
    this.hasSignal = false;
    this.lastEventAt = 0;

    this.smoothX = new Smoother(CONFIG.physics.smoothing);
    this.smoothY = new Smoother(CONFIG.physics.smoothing);
    this.value = { x: 0, y: 0 };
    this.rawValue = { x: 0, y: 0 };
    this.rotationRate = 0; // rad/s magnitude, used by the stability model

    this._pointer = { x: 0, y: 0, active: false };
    this._keys = new Set();
    this._onOrientation = this._onOrientation.bind(this);
    this._onMotion = this._onMotion.bind(this);
    this.sensitivity = store.get('gyroSensitivity') || 1;
  }

  setSensitivity(v) {
    this.sensitivity = clamp(v, 0.4, 2);
    store.set('gyroSensitivity', this.sensitivity);
  }

  // ---- backends ---------------------------------------------------------

  enableGyro() {
    if (this.mode === 'gyro') return;
    window.addEventListener('deviceorientation', this._onOrientation);
    window.addEventListener('devicemotion', this._onMotion);
    this.mode = 'gyro';
    bus.emit('tilt:mode', 'gyro');
  }

  enableTouch() {
    if (this.mode === 'touch') return;
    window.removeEventListener('deviceorientation', this._onOrientation);
    window.removeEventListener('devicemotion', this._onMotion);
    this.mode = 'touch';
    bus.emit('tilt:mode', 'touch');
  }

  _onOrientation(e) {
    if (e.beta === null && e.gamma === null) return;
    this.hasSignal = true;
    this.lastEventAt = performance.now();

    // Compensate for the screen being rotated relative to the device frame.
    const angle = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
    const beta = e.beta ?? 0;
    const gamma = e.gamma ?? 0;
    let b = beta;
    let g = gamma;
    if (angle === 90) {
      b = -gamma;
      g = beta;
    } else if (angle === 180) {
      b = -beta;
      g = -gamma;
    } else if (angle === 270 || angle === -90) {
      b = gamma;
      g = -beta;
    }
    this.raw.beta = b;
    this.raw.gamma = g;
  }

  _onMotion(e) {
    const r = e.rotationRate;
    if (!r) return;
    const mag = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
    this.rotationRate = (mag * Math.PI) / 180;
  }

  // ---- pointer / keyboard fallback -------------------------------------

  attachFallbackControls(target) {
    const setFromClient = (cx, cy) => {
      const r = target.getBoundingClientRect();
      this._pointer.x = ((cx - r.left) / r.width) * 2 - 1;
      this._pointer.y = -(((cy - r.top) / r.height) * 2 - 1);
    };

    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || this._pointer.active) setFromClient(e.clientX, e.clientY);
    });
    target.addEventListener('pointerdown', (e) => {
      this._pointer.active = true;
      setFromClient(e.clientX, e.clientY);
    });
    const release = () => {
      this._pointer.active = false;
    };
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
    target.addEventListener('pointerleave', release);

    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(e.key)) {
        this._keys.add(e.key);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.key));
  }

  _fallbackVector() {
    let x = 0;
    let y = 0;
    const k = this._keys;
    if (k.has('ArrowLeft') || k.has('a')) x -= 1;
    if (k.has('ArrowRight') || k.has('d')) x += 1;
    if (k.has('ArrowUp') || k.has('w')) y += 1;
    if (k.has('ArrowDown') || k.has('s')) y -= 1;
    if (x || y) return { x, y };
    // Pointer position drives tilt; the centre of the screen is neutral.
    return { x: this._pointer.x * 1.15, y: this._pointer.y * 1.15 };
  }

  // ---- calibration ------------------------------------------------------

  calibrate() {
    this.neutral.beta = this.raw.beta;
    this.neutral.gamma = this.raw.gamma;
    this.calibrated = true;
    this.smoothX.reset(0);
    this.smoothY.reset(0);
    bus.emit('tilt:calibrated');
  }

  /** How still the device is right now, 0..1 — drives the calibration meter. */
  stillness() {
    if (this.mode !== 'gyro') return 1;
    return clamp(1 - this.rotationRate / 1.2, 0, 1);
  }

  /** True if the gyro backend stopped delivering events (sensor lost). */
  get stale() {
    return this.mode === 'gyro' && this.hasSignal &&
      performance.now() - this.lastEventAt > 2000;
  }

  update() {
    let vx;
    let vy;
    if (this.mode === 'gyro' && this.hasSignal) {
      vx = (this.raw.gamma - this.neutral.gamma) / RANGE_DEG;
      vy = -(this.raw.beta - this.neutral.beta) / RANGE_DEG;
    } else {
      const f = this._fallbackVector();
      vx = f.x;
      vy = f.y;
    }

    vx = clamp(vx * this.sensitivity, -1.6, 1.6);
    vy = clamp(vy * this.sensitivity, -1.6, 1.6);

    // Deadzone applied before smoothing so tiny hand tremor never leaks in.
    const dz = CONFIG.physics.deadzone;
    const gate = (v) => (Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz));

    this.rawValue.x = gate(vx);
    this.rawValue.y = gate(vy);
    this.value.x = this.smoothX.push(this.rawValue.x);
    this.value.y = this.smoothY.push(this.rawValue.y);
    return this.value;
  }
}

export const tilt = new TiltManager();
