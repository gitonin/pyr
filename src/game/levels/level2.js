import { BaseLevel } from './baseLevel.js';
import { ArtifactField } from '../artifacts.js';
import { CONFIG } from '../../core/config.js';
import { vibrate } from '../../core/utils.js';
import { bus } from '../../core/events.js';

/**
 * Level 2 — balance under interference. Artifacts fall toward the glass; the
 * player must tap them away with one hand while the other keeps the device
 * steady. A missed artifact shoves the hourglass rather than ending the run.
 */
export class Level2 extends BaseLevel {
  constructor(ctx) {
    super(2, ctx);
    this.field = new ArtifactField(ctx.scene, ctx.camera, ctx.particles);
    this.field.onHit = (kind) => {
      this.ctx.score.registerArtifact(kind);
      vibrate(CONFIG.haptics.hit);
    };
    this.field.onMiss = () => {
      this.ctx.score.breakCombo(CONFIG.levels[2].missPenalty);
      const s = CONFIG.levels[2].missShake;
      // The shove is aimed away from the current lean, so it is recoverable.
      const m = this.balance.magnitude || 1;
      this.balance.impulse(
        (Math.random() - 0.5) * 6 + (this.balance.angle.x / m) * 3,
        (Math.random() - 0.5) * 6 + (this.balance.angle.z / m) * 3
      );
      this.shake = s;
      vibrate(CONFIG.haptics.fail);
      bus.emit('level:miss');
    };
  }

  enter() {
    super.enter();
    this.ctx.mist?.setActive(false);
    this.field.reset();
  }

  exit() {
    super.exit();
    this.field.reset();
  }

  onPointerDown(nx, ny) {
    return this.field.pick(nx, ny);
  }

  onUpdate(dt, time) {
    this.field.update(dt, time);
  }

  hudExtras() {
    return {
      combo: this.ctx.score.combo,
      comboMultiplier: this.ctx.score.comboMultiplier,
      objects: this.ctx.score.objects,
    };
  }

  dispose() {
    this.field.dispose();
  }
}
