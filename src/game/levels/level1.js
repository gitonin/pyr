import { BaseLevel } from './baseLevel.js';

/**
 * Level 1 — pure balance. No interference: the level exists to teach the
 * feel of the inertia and to let the player find the neutral position.
 */
export class Level1 extends BaseLevel {
  constructor(ctx) {
    super(1, ctx);
  }

  enter() {
    super.enter();
    this.ctx.mist?.setActive(false);
  }
}
