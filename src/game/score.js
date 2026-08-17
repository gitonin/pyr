import { CONFIG } from '../core/config.js';
import { clamp } from '../core/utils.js';
import { state } from '../core/state.js';
import { bus } from '../core/events.js';

/**
 * Rewards stillness, not survival: points scale with how close to centre the
 * player holds the object, and a multiplier grows only while inside the
 * "perfect" radius. Artifacts in level 2 feed a separate combo chain.
 */
export class ScoreSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.multiplier = 1;
    this.combo = 0;
    this.comboMultiplier = 1;
    this.levelScore = 0;
    this.objects = 0;
    this.precisionAccum = 0;
    this.precisionSamples = 0;
    this._pending = 0;
  }

  update(dt, balance, params) {
    const S = CONFIG.score;
    const mag = balance.magnitude;
    const precision = balance.precision(params);

    if (mag <= S.perfectRadius) {
      this.multiplier = clamp(this.multiplier + S.multiplierStep * dt, 1, S.multiplierMax);
    } else if (mag > S.goodRadius) {
      this.multiplier = clamp(this.multiplier - S.multiplierDecay * dt, 1, S.multiplierMax);
    }

    const calm = clamp(1 - balance.speed / 1.6, 0, 1);
    const gained =
      (S.perSecondBase * precision + S.calmBonusPerSecond * calm) * this.multiplier * dt;

    this.levelScore += gained;
    this._pending += gained;
    if (this._pending >= 1) {
      const whole = Math.floor(this._pending);
      this._pending -= whole;
      state.addScore(whole);
    }

    this.precisionAccum += precision * dt;
    this.precisionSamples += dt;
    state.run.precisionAccum += precision * dt;
    state.run.precisionFrames += dt;
  }

  /** @returns {number} points awarded */
  registerArtifact(kind) {
    const S = CONFIG.score;
    this.combo++;
    this.comboMultiplier = clamp(1 + this.combo * S.comboStep, 1, S.comboMax);
    const base = kind === 'white' ? S.objectWhiteBonus : S.objectHit;
    const points = Math.round(base * this.comboMultiplier);
    this.objects++;
    state.run.objectsDestroyed++;
    state.addScore(points);
    this.levelScore += points;
    bus.emit('score:artifact', { kind, points, combo: this.combo });
    return points;
  }

  breakCombo(penalty = CONFIG.levels[2].missPenalty) {
    this.combo = 0;
    this.comboMultiplier = 1;
    this.multiplier = 1;
    state.addScore(-penalty);
    this.levelScore = Math.max(0, this.levelScore - penalty);
    bus.emit('score:penalty', penalty);
  }

  registerBreath() {
    state.addScore(CONFIG.score.breathTick);
    this.levelScore += CONFIG.score.breathTick;
    state.run.breaths++;
  }

  get precision() {
    return this.precisionSamples ? this.precisionAccum / this.precisionSamples : 0;
  }
}
