import { THREE, gfx } from './renderer.js';
import { clamp, randRange } from '../core/utils.js';

/**
 * Level 3 mist.
 *
 * A shell of billboarded noise puffs around the hourglass. Each puff keeps its
 * own density and its own resistance, so breath clears the scene in patches
 * rather than as one uniform fade. The mean density is the level's progress.
 */

const PUFF_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uDensity;
  uniform float uSeed;
  uniform float uSwirl;
  uniform vec3 uColor;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float noise21(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise21(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv - 0.5;
    // Rotate the sample field: the puff churns instead of sliding.
    float ang = uSwirl * 0.6 + uSeed * 6.28;
    float s = sin(ang), c = cos(ang);
    vec2 ruv = mat2(c, -s, s, c) * uv;

    float n = fbm(ruv * 3.2 + vec2(uTime * 0.05 + uSeed * 10.0, uTime * 0.03));
    n = mix(n, fbm(ruv * 7.0 - uTime * 0.08), 0.35);

    float radial = 1.0 - smoothstep(0.12, 0.5, length(uv));
    float a = radial * n * uDensity;
    a = clamp(a * 1.6, 0.0, 1.0);
    if (a < 0.004) discard;

    vec3 col = uColor * (0.55 + n * 0.7);
    float alpha = a * 0.78;
    gl_FragColor = vec4(col * alpha, alpha); // premultiplied context
  }
`;

export class Mist {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.puffs = [];
    this.swirl = 0;
    this.active = false;

    const count = gfx.mistBudget;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        uniforms: {
          uTime: { value: 0 },
          uDensity: { value: 1 },
          uSeed: { value: Math.random() },
          uSwirl: { value: 0 },
          uColor: { value: new THREE.Color(0x9fd8f0) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: PUFF_FRAG,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Puffs form a loose cylinder around the object, biased toward the camera.
      const a = (i / count) * Math.PI * 2 + randRange(-0.3, 0.3);
      const r = randRange(0.7, 2.4);
      const home = new THREE.Vector3(
        Math.cos(a) * r,
        randRange(0.15, 2.6),
        Math.sin(a) * r * 0.7 + randRange(0.2, 1.6)
      );
      mesh.position.copy(home);
      const scale = randRange(1.5, 3.4);
      mesh.scale.set(scale, scale * randRange(0.7, 1.1), 1);
      mesh.renderOrder = 10;

      this.puffs.push({
        mesh,
        mat,
        home,
        offset: new THREE.Vector3(),
        density: 1,
        resistance: randRange(0.55, 1.5),
        phase: Math.random() * Math.PI * 2,
      });
      this.group.add(mesh);
    }
    this.group.visible = false;
    this._camDir = new THREE.Vector3();
    this._toPuff = new THREE.Vector3();
    this._buildVeil();
    scene.add(this.group);
  }

  /**
   * Billboarded puffs alone cannot blind the player — they sit at fixed depths
   * and leave gaps. A veil pinned just in front of the camera closes those
   * gaps, so at full density the scene really is unreadable and every bit of
   * visibility has to be earned with breath.
   */
  _buildVeil() {
    this.veilMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uDensity: { value: 1 },
        uSwirl: { value: 0 },
        uColor: { value: new THREE.Color(0x8fcfe8) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uDensity;
        uniform float uSwirl;
        uniform vec3 uColor;
        ${PUFF_FRAG.slice(PUFF_FRAG.indexOf('float hash21'), PUFF_FRAG.indexOf('void main'))}
        void main() {
          vec2 uv = vUv;
          // Breath drives the swirl, so the veil visibly churns as it thins.
          vec2 flow = vec2(sin(uSwirl * 0.4) * 0.12, uSwirl * 0.05);
          float n = fbm(uv * 3.4 + flow + vec2(uTime * 0.03, 0.0));
          n = mix(n, fbm(uv * 8.0 - flow * 1.7), 0.4);
          // Clears from the centre outward: the player breathes a hole through.
          float centre = smoothstep(0.15, 0.62, length(uv - 0.5));
          float a = clamp(uDensity * (0.45 + n * 0.85) * (0.35 + centre * 0.85), 0.0, 0.94);
          if (a < 0.004) discard;
          vec3 col = uColor * (0.28 + n * 0.42);
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.veilMat);
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 20;
    this.group.add(this.veil);
  }

  _placeVeil() {
    const cam = this.camera;
    const dist = 0.6;
    const h = 2 * dist * Math.tan((cam.fov * Math.PI) / 360) * 1.25;
    this.veil.scale.set(h * cam.aspect * 1.25, h, 1);
    cam.getWorldDirection(this._camDir);
    this.veil.position.copy(cam.position).addScaledVector(this._camDir, dist);
    this.veil.quaternion.copy(cam.quaternion);
  }

  setActive(on) {
    this.active = on;
    this.group.visible = on;
  }

  reset() {
    for (const p of this.puffs) {
      p.density = 1;
      p.offset.set(0, 0, 0);
      p.mesh.position.copy(p.home);
      p.mat.uniforms.uDensity.value = 1;
    }
    this.swirl = 0;
    this.veilMat.uniforms.uDensity.value = 1;
  }

  get meanDensity() {
    let s = 0;
    for (const p of this.puffs) s += p.density;
    return s / this.puffs.length;
  }

  /**
   * @param {number} blow 0..1 breath strength
   * @param {number} clearRate density removed per second at full blow
   * @param {number} regrowth density restored per second when idle
   */
  update(dt, time, blow, clearRate, regrowth) {
    if (!this.active) return this.meanDensity;
    this.swirl += dt * (0.4 + blow * 3.2);

    const camDir = this._camDir;
    this.camera.getWorldDirection(camDir);

    for (const p of this.puffs) {
      // Puffs nearer the camera axis catch the breath first.
      const toPuff = this._toPuff.copy(p.mesh.position).sub(this.camera.position).normalize();
      const aim = clamp(toPuff.dot(camDir), 0, 1);
      const focus = Math.pow(aim, 6);

      const clearing = blow * clearRate * focus * (1.6 / p.resistance) * dt;
      p.density = clamp(p.density - clearing + (blow < 0.08 ? regrowth * dt : 0), 0, 1);

      // Breath pushes the puff away and sets it turning.
      const push = blow * focus * dt * 2.4;
      p.offset.x += (p.mesh.position.x - 0) * push * 0.35;
      p.offset.y += push * 0.25;
      p.offset.z += push * 1.1;
      p.offset.multiplyScalar(1 - dt * 0.55);

      const drift = Math.sin(time * 0.22 + p.phase) * 0.14;
      p.mesh.position.set(
        p.home.x + p.offset.x + drift,
        p.home.y + p.offset.y + Math.cos(time * 0.18 + p.phase) * 0.1,
        p.home.z + p.offset.z
      );
      p.mesh.quaternion.copy(this.camera.quaternion); // billboard
      p.mat.uniforms.uTime.value = time;
      p.mat.uniforms.uSwirl.value = this.swirl + p.phase;
      p.mat.uniforms.uDensity.value = p.density;
      p.mesh.visible = p.density > 0.01;
    }

    const mean = this.meanDensity;
    this._placeVeil();
    this.veilMat.uniforms.uTime.value = time;
    this.veilMat.uniforms.uSwirl.value = this.swirl;
    this.veilMat.uniforms.uDensity.value = mean;
    this.veil.visible = mean > 0.02;
    return mean;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const p of this.puffs) p.mat.dispose();
  }
}
