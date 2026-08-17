import { CONFIG } from '../core/config.js';
import { clamp, smoothstep } from '../core/utils.js';

/**
 * The balance model — an inverted pendulum the player steers with the device.
 *
 * Near the centre the object behaves like a damped spring following the tilt,
 * which is forgiving and readable. As the lean grows, a destabilising term
 * fades in and the spring loses authority, so drifting outward accelerates.
 * That gives a wide calm zone and a genuinely tense edge, without the
 * knife-edge instability of a pure pendulum.
 */
export class BalanceModel {
  constructor() {
    this.angle = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.stability = 1;
    this.danger = 0;
    this.dangerTime = 0;
    this.failed = false;
    this.failDir = { x: 1, z: 0 };
    this._noiseSeed = Math.random() * 100;
    this._t = 0;
    this._impulse = { x: 0, z: 0 };
  }

  reset() {
    this.angle.x = this.angle.z = 0;
    this.vel.x = this.vel.z = 0;
    this.stability = 1;
    this.danger = 0;
    this.dangerTime = 0;
    this.failed = false;
    this._t = 0;
    this._impulse.x = this._impulse.z = 0;
  }

  /** External shove: a missed artifact, a gust, a scripted event. */
  impulse(x, z) {
    this._impulse.x += x;
    this._impulse.z += z;
  }

  get magnitude() {
    return Math.hypot(this.angle.x, this.angle.z);
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /**
   * @param input {x, y} normalised device tilt, -1..1
   * @param p level parameters (see CONFIG.levels)
   * @param progress 0..1 through the level; difficulty scales with it
   */
  update(dt, input, p, progress = 0) {
    if (this.failed) return this;
    const P = CONFIG.physics;
    this._t += dt;

    const instability = p.instability * (0.55 + progress * 0.65);
    const wobbleAmp = p.perturbation * (0.4 + progress * 0.9);

    // Smooth, non-repeating drift so the object is never perfectly still.
    const wobbleX =
      Math.sin(this._t * 0.83 + this._noiseSeed) * 0.6 +
      Math.sin(this._t * 1.97 + this._noiseSeed * 2.1) * 0.4;
    const wobbleZ =
      Math.cos(this._t * 0.71 + this._noiseSeed * 1.7) * 0.6 +
      Math.cos(this._t * 2.31 + this._noiseSeed * 0.9) * 0.4;

    const mag = this.magnitude;
    const edge = smoothstep(p.warnAngle * 0.3, p.warnAngle, mag);
    const centre = 1 - edge;

    for (const [axis, inVal, wobble] of [
      ['x', input.x, wobbleX],
      ['z', -input.y, wobbleZ],
    ]) {
      const target = inVal * P.inputGain;
      const a = this.angle[axis];
      const v = this.vel[axis];

      let accel =
        P.spring * (target - a) * (0.45 + centre * 0.55) - // control fades near the edge
        P.damping * v +
        instability * a * edge + // destabilising term, only once drifting
        -P.recoveryAssist * a * centre + // gentle self-centring when calm
        wobble * wobbleAmp +
        this._impulse[axis];

      accel = clamp(accel, -P.maxAngularAccel, P.maxAngularAccel);
      this.vel[axis] = v + accel * dt;
      this.angle[axis] = a + this.vel[axis] * dt;
    }
    this._impulse.x *= Math.max(0, 1 - dt * 9);
    this._impulse.z *= Math.max(0, 1 - dt * 9);

    const m = this.magnitude;
    const spin = this.speed;
    this.stability = clamp(
      (1 - clamp(m / p.failAngle, 0, 1)) * (1 - clamp(spin / 5, 0, 0.4)),
      0,
      1
    );
    this.danger = smoothstep(p.warnAngle * 0.65, p.failAngle, m);

    if (m > p.warnAngle) {
      this.dangerTime += dt;
    } else {
      this.dangerTime = Math.max(0, this.dangerTime - dt * 1.8);
    }

    if (m >= p.failAngle || this.dangerTime >= p.graceSeconds) {
      this.failed = true;
      const n = m || 1;
      this.failDir.x = this.angle.x / n;
      this.failDir.z = this.angle.z / n;
    }
    return this;
  }

  /** How close to dead centre, 0..1 — the value the score system rewards. */
  precision(p) {
    const m = this.magnitude;
    if (m <= CONFIG.score.perfectRadius) return 1;
    return clamp(1 - (m - CONFIG.score.perfectRadius) / (p.failAngle - CONFIG.score.perfectRadius), 0, 1);
  }
}
