import { bus } from './events.js';
import { store } from './storage.js';

export const SCREEN = {
  LOADING: 'loading',
  INTRO: 'intro',
  HOWTO: 'howto',
  PERMISSION: 'permission',
  CALIBRATE: 'calibrate',
  MIC_PERMISSION: 'micPermission',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  LEVEL_COMPLETE: 'levelComplete',
  GAME_OVER: 'gameOver',
  FINALE: 'finale',
  SETTINGS: 'settings',
};

function emptyRun() {
  return {
    score: 0,
    totalTime: 0,
    objectsDestroyed: 0,
    breaths: 0,
    // precision = time-weighted mean of the per-frame stability value
    precisionAccum: 0,
    precisionFrames: 0,
    levelScores: {},
  };
}

class GameState {
  constructor() {
    this.screen = SCREEN.LOADING;
    this.previousScreen = null;
    this.level = 1;
    this.run = emptyRun();
    this.inputMode = 'gyro'; // 'gyro' | 'touch'
    this.micMode = 'none'; // 'none' | 'mic' | 'touch'
    this.quality = 'high';
    this.muted = store.get('muted');
  }

  setScreen(screen, payload = {}) {
    if (this.screen === screen) return;
    this.previousScreen = this.screen;
    this.screen = screen;
    bus.emit('screen:changed', { screen, previous: this.previousScreen, ...payload });
  }

  resetRun() {
    this.run = emptyRun();
    this.level = 1;
  }

  addScore(points) {
    this.run.score = Math.max(0, this.run.score + Math.round(points));
  }

  get precision() {
    if (!this.run.precisionFrames) return 0;
    return this.run.precisionAccum / this.run.precisionFrames;
  }

  commitBest() {
    const best = store.get('bestScore') || 0;
    if (this.run.score > best) {
      store.set('bestScore', this.run.score);
      return true;
    }
    return false;
  }

  get bestScore() {
    return store.get('bestScore') || 0;
  }

  /** 0..1 precision -> qualitative rank shown on the final screen. */
  get rank() {
    const p = this.precision;
    if (p >= 0.88) return 'rank.unshakable';
    if (p >= 0.74) return 'rank.precise';
    if (p >= 0.55) return 'rank.focused';
    return 'rank.calm';
  }
}

export const state = new GameState();
