import { CONFIG } from '../../core/config.js';
import { clamp, vibrate } from '../../core/utils.js';
import { BalanceModel } from '../balance.js';
import { music } from '../../audio/music.js';
import { sfx, SandVoice } from '../../audio/sfx.js';
import { bus } from '../../core/events.js';

/**
 * Shared level machinery: sand flow, balance integration, danger feedback and
 * completion. Levels subclass this and override the hooks; the run loop in
 * main.js only ever talks to this interface.
 */
export class BaseLevel {
  constructor(index, ctx) {
    this.index = index;
    this.ctx = ctx; // { hourglass, particles, mist, score, artifacts... }
    this.params = CONFIG.levels[index];
    this.balance = new BalanceModel();
    this.sand = 1;
    this.elapsed = 0;
    this.complete = false;
    this.failed = false;
    this.sandVoice = new SandVoice();
    this._tensionCooldown = 0;
    this._warnLatch = false;
    this.shake = 0;
  }

  get progress() {
    return 1 - this.sand;
  }

  /** Levels override to slow or gate the flow; 1 = nominal rate. */
  flowRate() {
    return 1;
  }

  enter() {
    const { hourglass, particles } = this.ctx;
    this.balance.reset();
    this.sand = 1;
    this.elapsed = 0;
    this.complete = false;
    this.failed = false;
    this.shake = 0;
    hourglass.reset();
    hourglass.setBreathing(false);
    particles.clear();
    this.sandVoice.start();
    music.setIntensity(0.25 + this.index * 0.25);
    bus.emit('level:enter', this.index);
  }

  exit() {
    this.sandVoice.stop();
    bus.emit('level:exit', this.index);
  }

  onPointerDown() {}
  onPointerUp() {}

  update(dt, time, input) {
    if (this.complete || this.failed) return this;
    this.elapsed += dt;

    this.balance.update(dt, input, this.params, this.progress);

    // Sand drains a little slower when the neck is off-axis: the flow reports
    // the player's steadiness back to them.
    const neck = 0.72 + this.balance.stability * 0.28;
    const rate = (1 / this.params.sandDuration) * neck * this.flowRate();
    this.sand = clamp(this.sand - rate * dt, 0, 1);

    this.ctx.score.update(dt, this.balance, this.params);
    this._sync(dt, time);
    this.onUpdate?.(dt, time, input);

    if (this.balance.failed) this._fail();
    else if (this.sand <= 0 && !this.blocked?.()) this._succeed();
    return this;
  }

  _sync(dt, time) {
    const { hourglass } = this.ctx;
    const b = this.balance;
    hourglass.setLean({ x: b.angle.x, z: b.angle.z });
    hourglass.setSandRemaining(this.sand);
    hourglass.setDanger(b.danger);
    hourglass.setAgitation(clamp(b.speed / 2.2, 0, 1));

    this.sandVoice.set(this.sand > 0 ? 0.55 + b.danger * 0.45 : 0, clamp(b.speed / 2, 0, 1));
    music.setStability(b.stability);

    this.shake = Math.max(0, this.shake - dt * 2.2);

    // Tension audio + haptics, rate-limited so they stay atmospheric.
    this._tensionCooldown -= dt;
    if (b.danger > 0.42 && this._tensionCooldown <= 0) {
      sfx.tension(b.danger);
      this._tensionCooldown = 0.45 - b.danger * 0.2;
    }
    if (b.danger > 0.55 && !this._warnLatch) {
      this._warnLatch = true;
      vibrate(CONFIG.haptics.warn);
    } else if (b.danger < 0.4) {
      this._warnLatch = false;
    }
  }

  _fail() {
    this.failed = true;
    this.ctx.hourglass.topple(this.balance.failDir.x, this.balance.failDir.z);
    this.ctx.particles.burst(
      { x: 0, y: 1.06, z: 0 },
      0xff2d3d,
      70,
      { speed: 3.2, life: 1.3, size: 0.06, gravity: -3.6 }
    );
    this.sandVoice.stop();
    sfx.shatter();
    sfx.fail();
    vibrate(CONFIG.haptics.fail);
    music.setIntensity(0);
    bus.emit('level:failed', this.index);
  }

  _succeed() {
    this.complete = true;
    this.sandVoice.stop();
    sfx.success();
    this.ctx.particles.bloom({ x: 0, y: 1.06, z: 0 }, 0x36e0ff, 120, 2.2);
    this.ctx.hourglass.setBreathing(true);
    bus.emit('level:complete', { index: this.index, score: this.ctx.score.levelScore });
  }

  /** Extra HUD rows a level wants to show. */
  hudExtras() {
    return null;
  }
}
