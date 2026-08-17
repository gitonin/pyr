import { THREE, gfx } from '../render/renderer.js';
import { CONFIG } from '../core/config.js';
import { clamp, randRange, pick } from '../core/utils.js';
import { music } from '../audio/music.js';
import { sfx } from '../audio/sfx.js';
import { CENTER_Y } from '../render/hourglass.js';

/**
 * Level 2 artifacts: small solids that drift down toward the glass. Tapping
 * one destroys it; letting it reach the danger zone shoves the hourglass.
 *
 * Picking is done in screen space rather than by mesh raycast — a finger is
 * imprecise and the objects are tiny, so a projected-radius test is both
 * cheaper and much fairer.
 */

export const ARTIFACT_TYPES = {
  cyan: { color: 0x36e0ff, weight: 30, division: 4, geo: 'octa', points: 1 },
  red: { color: 0xff2d3d, weight: 22, division: 2, geo: 'box', points: 1 },
  orange: { color: 0xff7a2a, weight: 20, division: 8, geo: 'tetra', points: 1 },
  violet: { color: 0x9b6bff, weight: 20, division: 4, geo: 'icosa', points: 1 },
  white: { color: 0xeafcff, weight: 8, division: 1, geo: 'dodeca', points: 3 },
};

const DANGER_Y = CENTER_Y - 0.75;

// Spawn bounds are derived from the live camera so the field stays on screen
// on any aspect ratio, from a tall phone to a landscape tablet.
const gfxCameraDistance = () => Math.abs(gfx.camera.position.z);
const portraitAspect = () => Math.min(gfx.camera.aspect, 1.1);

function weightedKind() {
  const entries = Object.entries(ARTIFACT_TYPES);
  const total = entries.reduce((s, [, v]) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    r -= v.weight;
    if (r <= 0) return k;
  }
  return 'cyan';
}

function geometryFor(name) {
  switch (name) {
    case 'box':
      return new THREE.BoxGeometry(0.2, 0.2, 0.2);
    case 'tetra':
      return new THREE.TetrahedronGeometry(0.16);
    case 'icosa':
      return new THREE.IcosahedronGeometry(0.14);
    case 'dodeca':
      return new THREE.DodecahedronGeometry(0.15);
    case 'octa':
    default:
      return new THREE.OctahedronGeometry(0.15);
  }
}

export class ArtifactField {
  constructor(scene, camera, particles) {
    this.scene = scene;
    this.camera = camera;
    this.particles = particles;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.geometries = {};
    for (const name of ['box', 'tetra', 'icosa', 'dodeca', 'octa']) {
      this.geometries[name] = geometryFor(name);
    }
    this.items = [];
    this.spawnTimer = 1.2;
    this.elapsed = 0;
    this.onMiss = null;
    this.onHit = null;
    this._ndc = new THREE.Vector3();
  }

  reset() {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items.length = 0;
    this.spawnTimer = 1.2;
    this.elapsed = 0;
  }

  /** Spawn interval tightens and fall speed rises across the level. */
  _interval() {
    const c = CONFIG.levels[2].spawn;
    const t = clamp(this.elapsed / c.rampSeconds, 0, 1);
    return c.startInterval + (c.minInterval - c.startInterval) * t;
  }

  spawn() {
    const kind = weightedKind();
    const def = ARTIFACT_TYPES[kind];
    const mesh = new THREE.Mesh(
      this.geometries[def.geo],
      new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.geometries[def.geo]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, fog: false })
    );
    mesh.add(edges);

    // A portrait frustum is narrow: at the object's depth only ~1 unit of
    // half-width is on screen, so artifacts are spawned behind the glass where
    // the frustum is wider. They stay clear of dead centre so the pyramids are
    // never fully masked, and every spawn is guaranteed reachable by a thumb.
    const side = Math.random() < 0.5 ? -1 : 1;
    const z = randRange(-2.2, -0.3);
    const halfWidth = 0.42 * (gfxCameraDistance() - z) * portraitAspect();
    const x = side * randRange(0.34, Math.max(0.5, halfWidth * 0.82));
    mesh.position.set(x, randRange(3.4, 4.4), z);
    mesh.renderOrder = 7;
    this.group.add(mesh);

    const speeds = CONFIG.levels[2].objectFallSpeed;
    const ramp = clamp(this.elapsed / CONFIG.levels[2].spawn.rampSeconds, 0, 1);
    this.items.push({
      kind,
      def,
      mesh,
      speed: randRange(speeds.min, speeds.max) * (1 + ramp * 0.55),
      drift: randRange(-0.35, 0.35) * (1 + ramp),
      swayAmp: randRange(0.05, 0.28) * (1 + ramp * 0.8),
      swayFreq: randRange(0.7, 2.1),
      phase: Math.random() * Math.PI * 2,
      spin: new THREE.Vector3(randRange(-2, 2), randRange(-2, 2), randRange(-2, 2)),
      alive: true,
      age: 0,
    });
  }

  update(dt, time) {
    this.elapsed += dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn();
      this.spawnTimer = this._interval() * randRange(0.8, 1.2);
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const m = it.mesh;
      m.position.y -= it.speed * dt;
      m.position.x += (it.drift * 0.2 + Math.sin(time * it.swayFreq + it.phase) * it.swayAmp) * dt;
      m.position.z += Math.cos(time * it.swayFreq * 0.7 + it.phase) * it.swayAmp * 0.5 * dt;
      m.rotation.x += it.spin.x * dt;
      m.rotation.y += it.spin.y * dt;
      m.rotation.z += it.spin.z * dt;
      m.material.opacity = 0.75 + Math.sin(time * 6 + it.phase) * 0.15;

      if (m.position.y <= DANGER_Y) {
        this._destroy(i, false);
      }
    }
  }

  /**
   * @param {number} nx normalised device x (-1..1)
   * @param {number} ny normalised device y (-1..1)
   * @param {number} radius pick radius in NDC units
   * @returns {boolean} true when something was hit
   */
  pick(nx, ny, radius = 0.16) {
    let best = -1;
    let bestDist = radius;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      this._ndc.copy(it.mesh.position).project(this.camera);
      if (this._ndc.z > 1) continue;
      const d = Math.hypot(this._ndc.x - nx, this._ndc.y - ny);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return false;
    this._destroy(best, true);
    return true;
  }

  _destroy(index, byPlayer) {
    const it = this.items[index];
    if (!it) return;
    this.items.splice(index, 1);
    this.group.remove(it.mesh);
    it.mesh.material.dispose();

    if (byPlayer) {
      this.particles.burst(it.mesh.position, it.def.color, 26, {
        speed: 2.1,
        life: 0.7,
        size: 0.05,
        gravity: -2.2,
      });
      // Sound lands on the next musical subdivision for this artifact type.
      const at = music.nextQuantised(it.def.division);
      sfx.artifact(it.kind, at);
      sfx.pixelBurst(at, it.kind === 'red' ? 0.5 : 1.2);
      this.onHit?.(it.kind, it.mesh.position);
    } else {
      this.particles.burst(it.mesh.position, 0xff2d3d, 14, {
        speed: 1.1,
        life: 0.5,
        size: 0.04,
        gravity: -3,
      });
      sfx.miss();
      this.onMiss?.(it.kind, it.mesh.position);
    }
  }

  dispose() {
    this.reset();
    this.scene.remove(this.group);
    Object.values(this.geometries).forEach((g) => g.dispose());
  }
}

export { DANGER_Y };
export const randomKind = weightedKind;
export const anyKind = () => pick(Object.keys(ARTIFACT_TYPES));
