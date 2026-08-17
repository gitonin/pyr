import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG, QUALITY_TIERS } from '../core/config.js';
import { store } from '../core/storage.js';
import { bus } from '../core/events.js';
import { clamp } from '../core/utils.js';

export const PALETTE = {
  deepNight: 0x030710,
  night: 0x061225,
  blue: 0x0b2a4a,
  cyan: 0x36e0ff,
  cyanSoft: 0x7ff0ff,
  turquoise: 0x2ad4c8,
  red: 0xff2d3d,
  ember: 0xff6a2a,
  violet: 0x9b6bff,
  white: 0xeafcff,
};

const PIXEL_CAP = { low: 1, medium: 1.5, high: 2 };

/** Single source of truth for fog — the hand-written shaders match this. */
export const FOG = { color: 0x040c18, density: 0.108 };

/**
 * Two camera framings. Menus sit the object small and high so the type has
 * room; gameplay moves in close so small leans read as large motion.
 */
const FRAMINGS = {
  menu: { pos: [0, 1.5, 7.3], look: [0, 0.5, 0] },
  game: { pos: [0, 1.3, 4.85], look: [0, 1.05, 0] },
};

class RendererManager {
  constructor() {
    this.quality = 'high';
    this.autoQuality = true;
    this._fpsSamples = [];
    this._lowFpsTime = 0;
  }

  init(canvas) {
    let gl;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      });
      gl = this.renderer.getContext();
    } catch (err) {
      console.error('[renderer] WebGL init failed', err);
      return false;
    }
    if (!gl) return false;

    this.renderer.setClearColor(PALETTE.deepNight, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(FOG.color, FOG.density);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 90);
    this._framePos = new THREE.Vector3(...FRAMINGS.menu.pos);
    this._frameLook = new THREE.Vector3(...FRAMINGS.menu.look);
    this._targetPos = this._framePos.clone();
    this._targetLook = this._frameLook.clone();
    this.camera.position.copy(this._framePos);
    this.camera.lookAt(this._frameLook);

    this.clock = new THREE.Clock();

    const detected = this._detectQuality();
    const saved = store.get('quality');
    this.autoQuality = !saved || saved === 'auto';
    this.setQuality(this.autoQuality ? detected : saved, false);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    return true;
  }

  _detectQuality() {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const px = window.devicePixelRatio || 1;
    const small = Math.min(window.innerWidth, window.innerHeight) < 380;
    if (mem <= 2 || cores <= 3 || small) return 'low';
    if (mem <= 4 || cores <= 6 || px > 2.6) return 'medium';
    return 'high';
  }

  setQuality(tier, persist = true) {
    if (!QUALITY_TIERS.includes(tier)) tier = 'medium';
    const changed = tier !== this.quality;
    this.quality = tier;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_CAP[tier]));
    this.resize();
    if (persist) {
      this.autoQuality = false;
      store.set('quality', tier);
    }
    if (changed) bus.emit('quality:changed', tier);
  }

  setAutoQuality(on) {
    this.autoQuality = on;
    store.set('quality', on ? 'auto' : this.quality);
    if (on) this.setQuality(this._detectQuality(), false);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones are narrow: widen the FOV so the object always fits.
    this.camera.fov = h > w ? 50 : 40;
    this.camera.updateProjectionMatrix();
  }

  /** Watches the frame rate and steps quality down if the device struggles. */
  monitor(dt) {
    if (!this.autoQuality || dt <= 0) return;
    const fps = 1 / dt;
    this._fpsSamples.push(fps);
    if (this._fpsSamples.length > 60) this._fpsSamples.shift();
    if (this._fpsSamples.length < 45) return;
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    if (avg < CONFIG.render.downgradeFps) {
      this._lowFpsTime += dt;
      if (this._lowFpsTime > CONFIG.render.downgradeSeconds) {
        const idx = QUALITY_TIERS.indexOf(this.quality);
        if (idx > 0) {
          console.info(`[renderer] ${avg.toFixed(0)} fps — dropping to ${QUALITY_TIERS[idx - 1]}`);
          this.setQuality(QUALITY_TIERS[idx - 1], false);
        }
        this._lowFpsTime = 0;
        this._fpsSamples.length = 0;
      }
    } else {
      this._lowFpsTime = Math.max(0, this._lowFpsTime - dt);
    }
  }

  setFraming(name) {
    const f = FRAMINGS[name] || FRAMINGS.game;
    this._targetPos.set(...f.pos);
    this._targetLook.set(...f.look);
  }

  /** Slow drift + reactive shake, applied on top of the current framing. */
  updateCamera(dt, time, shake = 0, lean = { x: 0, y: 0 }) {
    const k = 1 - Math.exp(-2.2 * dt);
    this._framePos.lerp(this._targetPos, k);
    this._frameLook.lerp(this._targetLook, k);

    const b = this._framePos;
    const sway = Math.sin(time * 0.21) * 0.06;
    const rise = Math.sin(time * 0.14 + 1.2) * 0.035;
    const jx = shake ? (Math.random() - 0.5) * shake * 0.35 : 0;
    const jy = shake ? (Math.random() - 0.5) * shake * 0.35 : 0;
    this.camera.position.set(
      b.x + sway + lean.x * 0.22 + jx,
      b.y + rise + lean.y * 0.1 + jy,
      b.z
    );
    const l = this._frameLook;
    this.camera.lookAt(l.x + lean.x * 0.06, l.y + lean.y * 0.03, l.z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get particleBudget() {
    return CONFIG.render.particleCounts[this.quality];
  }

  get mistBudget() {
    return CONFIG.render.mistPuffs[this.quality];
  }

  get supportsTransmission() {
    return this.quality === 'high';
  }
}

export const gfx = new RendererManager();
export { THREE };
export const tmpColor = new THREE.Color();
export const lerpColor = (out, a, b, t) => out.set(a).lerp(tmpColor.set(b), clamp(t, 0, 1));
