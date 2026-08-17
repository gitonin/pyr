import { BaseLevel } from './baseLevel.js';
import { CONFIG } from '../../core/config.js';
import { clamp } from '../../core/utils.js';
import { mic } from '../../input/mic.js';
import { sfx } from '../../audio/sfx.js';
import { music } from '../../audio/music.js';
import { bus } from '../../core/events.js';

/**
 * Level 3 — breath and mist.
 *
 * The scene starts blind. Sand only moves as fast as the player can see, so
 * clearing the mist *is* the progress bar; balance still has to hold while
 * they breathe. Mist creeps back when they stop, which forces the player to
 * alternate between blowing and steadying rather than doing one then the other.
 */
export class Level3 extends BaseLevel {
  constructor(ctx) {
    super(3, ctx);
    this.density = 1;
    this.blow = 0;
    this._breathSfxTimer = 0;
    this._revealed = false;
    this._offBreath = bus.on('mic:breath', () => this.ctx.score.registerBreath());
  }

  enter() {
    super.enter();
    const { mist } = this.ctx;
    mist.reset();
    mist.setActive(true);
    this.density = 1;
    this._revealed = false;
    mic.breathCount = 0;
    this.ctx.hourglass.setOpacity(1);
    if (mic.mode === 'mic') mic.startCalibration();
  }

  exit() {
    super.exit();
    this.ctx.mist.setActive(false);
    this._offBreath?.();
  }

  /** Touch fallback: holding anywhere on the screen counts as blowing. */
  onPointerDown() {
    if (mic.mode === 'touch') mic.setTouchBlow(true);
    return false;
  }

  onPointerUp() {
    if (mic.mode === 'touch') mic.setTouchBlow(false);
  }

  flowRate() {
    // Sand barely moves while the player is blind.
    return clamp(1.15 - this.density * 1.0, 0.08, 1);
  }

  onUpdate(dt, time) {
    const p = this.params;
    this.blow = mic.update(dt);

    this.density = this.ctx.mist.update(dt, time, this.blow, p.mistClearPower, p.mistRegrowth);

    // Blowing makes the object harder to hold: a small pressure on the glass.
    if (this.blow > 0.2) {
      this.balance.impulse(0, -this.blow * dt * 3.2);
    }

    this._breathSfxTimer -= dt;
    if (this.blow > 0.15 && this._breathSfxTimer <= 0) {
      sfx.breath(this.blow);
      this._breathSfxTimer = 0.45;
    }

    // The moment the fog thins enough, the scene is revealed with a pulse.
    if (!this._revealed && this.density <= p.mistWinThreshold) {
      this._revealed = true;
      sfx.mistClear();
      this.ctx.particles.bloom({ x: 0, y: 1.06, z: 0 }, 0x36e0ff, 140, 2.6);
      music.setIntensity(1);
      bus.emit('level:revealed');
    }

    this.ctx.hourglass.setOpacity(clamp(1 - this.density * 0.35, 0.5, 1));
  }

  /** Cannot finish while still blinded, even if the sand ran out. */
  blocked() {
    return this.density > this.params.mistWinThreshold;
  }

  hudExtras() {
    return {
      mist: this.density,
      blow: this.blow,
      micMode: mic.mode,
      breaths: mic.breathCount,
    };
  }
}
