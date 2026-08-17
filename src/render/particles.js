import { THREE, gfx } from './renderer.js';
import { randRange } from '../core/utils.js';

/**
 * One pooled Points system for every burst in the game. Nothing is allocated
 * after construction; when the pool is exhausted the oldest particles are
 * recycled, which is what keeps the frame budget flat on weak devices.
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.max = { low: 260, medium: 700, high: 1300 }[gfx.quality] || 700;
    this.count = 0;
    this.cursor = 0;

    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.size = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    this.gravity = new Float32Array(this.max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: 320 * Math.min(window.devicePixelRatio || 1, 2) } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aAlpha;
          varying vec3 vColor;
          varying float vAlpha;
          uniform float uScale;
          void main() {
            vColor = aColor;
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uScale / max(0.4, -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            // Quantise the sprite into blocks: the debris reads as pixels.
            vec2 q = floor(gl_PointCoord * 4.0) / 4.0 + 0.125;
            vec2 d = q - 0.5;
            if (dot(d, d) > 0.26) discard;
            gl_FragColor = vec4(vColor * vAlpha, vAlpha);
          }
        `,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this._c = new THREE.Color();
  }

  /**
   * @param {THREE.Vector3|{x,y,z}} p origin
   * @param {number} color hex
   */
  burst(p, color, n = 24, opts = {}) {
    const {
      speed = 1.6,
      spread = 1,
      life = 0.8,
      size = 0.06,
      gravity = -1.6,
      up = 0.4,
    } = opts;
    this._c.setHex(color);
    const amount = Math.min(n, Math.floor(this.max * 0.35));
    for (let i = 0; i < amount; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.count = Math.min(this.count + 1, this.max);

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(randRange(-1, 1));
      const s = speed * randRange(0.3, 1) * spread;
      this.pos[idx * 3] = p.x;
      this.pos[idx * 3 + 1] = p.y;
      this.pos[idx * 3 + 2] = p.z;
      this.vel[idx * 3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[idx * 3 + 1] = Math.cos(phi) * s + up;
      this.vel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
      this.col[idx * 3] = this._c.r;
      this.col[idx * 3 + 1] = this._c.g;
      this.col[idx * 3 + 2] = this._c.b;
      const l = life * randRange(0.6, 1.3);
      this.life[idx] = l;
      this.maxLife[idx] = l;
      this.size[idx] = size * randRange(0.5, 1.5);
      this.alpha[idx] = 1;
      this.gravity[idx] = gravity;
    }
  }

  /** Soft dome of light — used for level completions and mist clearing. */
  bloom(p, color, n = 90, radius = 1.6) {
    this.burst(p, color, n, {
      speed: radius,
      life: 1.8,
      size: 0.05,
      gravity: -0.15,
      up: 0.2,
    });
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.vel[i * 3 + 1] += this.gravity[i] * dt;
      this.vel[i * 3] *= 1 - dt * 1.1;
      this.vel[i * 3 + 2] *= 1 - dt * 1.1;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.25;
      }
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t;
      alive++;
    }
    this.geo.setDrawRange(0, this.max);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.points.visible = alive > 0;
    return alive;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.points.material.dispose();
  }
}
