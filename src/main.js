import { THREE, gfx } from './render/renderer.js';
import { Environment } from './render/environment.js';
import { Hourglass, CENTER_Y } from './render/hourglass.js';
import { ParticleSystem } from './render/particles.js';
import { Mist } from './render/mist.js';

import { CONFIG } from './core/config.js';
import { state, SCREEN } from './core/state.js';
import { store } from './core/storage.js';
import { bus } from './core/events.js';
import { t, applyTranslations, cycleLanguage, getLanguage } from './core/i18n.js';
import { clamp, formatScore, formatTime, vibrate, setHapticsIntensity } from './core/utils.js';

import { tilt } from './input/tilt.js';
import { mic } from './input/mic.js';
import {
  requestMotionPermission,
  probeOrientationEvents,
  motionApiPresent,
  isSecure,
} from './input/permissions.js';

import { audio } from './audio/audio.js';
import { music } from './audio/music.js';
import { sfx } from './audio/sfx.js';

import { ScoreSystem } from './game/score.js';
import { Level1 } from './game/levels/level1.js';
import { Level2 } from './game/levels/level2.js';
import { Level3 } from './game/levels/level3.js';

import { screens, $, setStats, onTap } from './ui/screens.js';
import { Hud } from './ui/hud.js';
import { initSettings } from './ui/settings.js';

const IS_TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Game {
  constructor() {
    this.score = new ScoreSystem();
    this.level = null;
    this.levels = { 1: Level1, 2: Level2, 3: Level3 };
    this.time = 0;
    this.runStart = 0;
    this.paused = false;
    this._settingsReturn = SCREEN.INTRO;
    this._calibrating = false;
    this._sensorToken = 0;
    this._pointer = { x: 0, y: 0 };
  }

  // ======================= boot =======================

  async boot() {
    document.body.classList.toggle('is-desktop', !IS_TOUCH);

    if (!gfx.init($('stage'))) {
      screens.show('error');
      $('errorText').textContent = t('error.webgl');
      return;
    }

    this.env = new Environment(gfx.scene);
    this.hourglass = new Hourglass(gfx.scene);
    this.particles = new ParticleSystem(gfx.scene);
    this.mist = new Mist(gfx.scene, gfx.camera);
    this.hud = new Hud();

    this.ctx = {
      scene: gfx.scene,
      camera: gfx.camera,
      hourglass: this.hourglass,
      particles: this.particles,
      mist: this.mist,
      score: this.score,
    };

    setHapticsIntensity(store.get('hapticsIntensity'));
    this.env.setContrast(store.get('highContrast'));
    bus.on('contrast:changed', (on) => this.env.setContrast(on));
    bus.on('quality:changed', () => this.env.rebuildDust());
    bus.on('language:changed', () => this._refreshDynamicText());

    this._wireUi();
    this._wirePointer();
    this._wireLifecycle();
    initSettings(() => this._closeSettings());

    this.hourglass.setBreathing(true);
    this.hourglass.setSandRemaining(0.62);

    this.clock = new THREE.Clock();
    requestAnimationFrame(() => this._loop());

    await sleep(700); // let the first frames land before revealing the menu
    this._toIntro();
    this._registerServiceWorker();
  }

  _registerServiceWorker() {
    // The single-file build has no separate sw.js to point at.
    if (window.YOUMAN_SINGLE_FILE) return;
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch((err) => console.info('[pwa] service worker not registered', err.message));
  }

  // ======================= UI wiring =======================

  _wireUi() {
    const tap = (id, fn) => onTap($(id), async (e) => {
      await this._unlockAudio();
      sfx.ui();
      fn(e);
    });

    /**
     * iOS only grants DeviceMotion / getUserMedia when the request is issued
     * synchronously inside the gesture handler. Awaiting the audio unlock
     * first would spend the user activation, so these buttons fire their
     * sensor request immediately and unlock audio afterwards.
     */
    const tapSensor = (id, fn) => onTap($(id), (e) => {
      fn(e);
      this._unlockAudio().then(() => sfx.ui());
    });

    // START can jump straight to the sensor prompt for a returning player, so
    // it takes the gesture-preserving path too.
    tapSensor('btnStart', () =>
      store.get('seenHowTo') ? this._toSensors() : this._show(SCREEN.HOWTO)
    );
    tap('btnHowTo', () => this._show(SCREEN.HOWTO));
    tap('btnHowToBack', () => this._toIntro());
    tapSensor('btnToCalibrate', () => {
      store.set('seenHowTo', true);
      this._toSensors();
    });

    tap('btnSound', () => this._toggleSound());
    tap('btnFinalSound', () => this._toggleSound());
    tap('btnLang', () => cycleLanguage());
    tap('btnSettings', () => this._openSettings());

    tapSensor('btnGrantMotion', () => this._requestSensors());
    tap('btnTouchMode', () => {
      tilt.enableTouch();
      state.inputMode = 'touch';
      this._toCalibration();
    });

    tap('btnCalibrate', () => this._runCalibration());
    tap('btnCalibContinue', () => this._startLevel(state.level));

    tapSensor('btnAllowMic', () => this._enableMic());
    tap('btnSkipMic', () => {
      mic.useTouchFallback();
      state.micMode = 'touch';
      this._startLevel(3);
    });

    tap('btnPause', () => this._pause());
    tap('btnResume', () => this._resume());
    tap('btnPauseSettings', () => this._openSettings());
    tap('btnPauseRestart', () => this._startLevel(state.level));
    tap('btnPauseMenu', () => this._abandonToMenu());

    tap('btnNextLevel', () => this._advance());
    tap('btnCompleteMenu', () => this._abandonToMenu());
    tap('btnRetry', () => this._startLevel(state.level));
    tap('btnFailMenu', () => this._abandonToMenu());
    tap('btnPlayAgain', () => {
      state.resetRun();
      this._startLevel(1);
    });
    tap('btnFinalMenu', () => this._abandonToMenu());
    tap('btnShare', () => this._share());

    this._syncSoundChips();
    bus.on('audio:muted', () => this._syncSoundChips());
  }

  _wirePointer() {
    const canvas = $('stage');
    tilt.attachFallbackControls(canvas);

    const toNdc = (e) => {
      this._pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this._pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      return this._pointer;
    };

    // Pointer events on the whole document so HUD chrome never eats a tap.
    document.addEventListener(
      'pointerdown',
      async (e) => {
        await this._unlockAudio();
        if (state.screen !== SCREEN.PLAYING || !this.level) return;
        if (e.target.closest('button')) return;
        const p = toNdc(e);
        this.level.onPointerDown(p.x, p.y);
      },
      { passive: true }
    );
    const up = () => this.level?.onPointerUp();
    document.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointercancel', up, { passive: true });

    // Desktop test aid: hold B to simulate a breath in level 3.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'b' || e.key === 'B') mic.setTouchBlow(true);
      if (e.key === 'Escape' && state.screen === SCREEN.PLAYING) this._pause();
      if (e.key === 'p' || e.key === 'P') {
        if (state.screen === SCREEN.PLAYING) this._pause();
        else if (state.screen === SCREEN.PAUSED) this._resume();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'b' || e.key === 'B') mic.setTouchBlow(false);
    });
  }

  _wireLifecycle() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (state.screen === SCREEN.PLAYING) this._pause();
        audio.suspend();
      } else if (state.screen !== SCREEN.PAUSED) {
        audio.resume();
      }
    });

    window.addEventListener('error', (e) => {
      console.error('[fatal]', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('[fatal] unhandled rejection', e.reason);
    });
  }

  async _unlockAudio() {
    if (this._audioReady) return;
    this._audioReady = true;
    const ok = await audio.unlock();
    if (ok) {
      audio.setMusicVolume(store.get('musicVolume'));
      audio.setSfxVolume(store.get('sfxVolume'));
      music.setIntensity(0.18);
      music.start();
    }
  }

  // ======================= screen flow =======================

  _show(screen) {
    state.setScreen(screen);
    screens.show(screen);
    // Settings can be opened from anywhere, so it never re-frames the camera.
    if (screen !== SCREEN.SETTINGS) {
      const inGame =
        screen === SCREEN.COUNTDOWN || screen === SCREEN.PLAYING || screen === SCREEN.PAUSED;
      gfx.setFraming(inGame ? 'game' : 'menu');
    }
  }

  _toIntro() {
    this._cancelSensorRequest();
    this.level?.exit();
    this.level = null;
    this.hourglass.reset();
    this.hourglass.setBreathing(true);
    this.hourglass.setSandRemaining(0.62);
    this.mist.setActive(false);
    this.particles.clear();
    this.hud.hide();
    this.hud.clearFlash();
    music.setIntensity(0.18);
    music.setStability(1);
    state.resetRun();
    this._show(SCREEN.INTRO);
    const best = state.bestScore;
    $('introBest').textContent = best ? `${t('final.best')} ${formatScore(best)}` : '';
  }

  _abandonToMenu() {
    mic.release();
    this._toIntro();
  }

  // ---- sensors ----

  async _toSensors() {
    if (!motionApiPresent() || !isSecure) {
      this._show(SCREEN.PERMISSION);
      this._sensorFallback('perm.unavailable');
      return;
    }
    // iOS needs the prompt inside the gesture; this call chain is still within it.
    this._show(SCREEN.PERMISSION);
    $('permNote').hidden = true;
    await this._requestSensors();
  }

  /**
   * Permission prompts and the event probe are slow and asynchronous, and the
   * player can walk away from the screen while they run (touch mode, back to
   * the menu). Every step is therefore fenced by a token: a stale request may
   * still finish, but it is not allowed to move anyone's screen.
   */
  async _requestSensors() {
    const token = ++this._sensorToken;
    const stale = () => token !== this._sensorToken || state.screen !== SCREEN.PERMISSION;

    const res = await requestMotionPermission();
    if (stale()) return;
    if (res !== 'granted') {
      this._sensorFallback(res === 'denied' ? 'perm.denied' : 'perm.unavailable');
      return;
    }
    tilt.enableGyro();
    const ok = await probeOrientationEvents(1400);
    if (stale()) return;
    if (!ok) {
      this._sensorFallback('perm.unavailable');
      return;
    }
    state.inputMode = 'gyro';
    this._toCalibration();
  }

  _cancelSensorRequest() {
    this._sensorToken++;
  }

  _sensorFallback(noteKey) {
    tilt.enableTouch();
    state.inputMode = 'touch';
    const note = $('permNote');
    note.textContent = t(noteKey);
    note.hidden = false;
    this._show(SCREEN.PERMISSION);
  }

  _toCalibration() {
    this._cancelSensorRequest();
    this._show(SCREEN.CALIBRATE);
    this._prepCalibration();
  }

  // ---- calibration ----

  _prepCalibration() {
    $('calibDone').hidden = true;
    $('btnCalibContinue').disabled = true;
    $('calibMeter').style.width = '0%';
    $('ringFg').style.strokeDashoffset = '327';
    $('calibPercent').textContent = '0%';
    $('calibInstruction').dataset.i18n =
      state.inputMode === 'gyro' ? 'calib.instruction' : 'howto.desktop';
    applyTranslations(screens.node(SCREEN.CALIBRATE));
  }

  async _runCalibration() {
    if (this._calibrating) return;
    this._calibrating = true;
    const btn = $('btnCalibrate');
    btn.disabled = true;

    const duration = 2.0;
    let progress = 0;
    const ring = $('ringFg');
    const meter = $('calibMeter');
    const pct = $('calibPercent');

    // Progress accrues only while the device is reasonably still, so the bar
    // teaches the player what "steady" means before the level starts.
    while (progress < 1) {
      await new Promise((r) => requestAnimationFrame(r));
      const still = tilt.stillness();
      progress = clamp(progress + (1 / 60 / duration) * (0.25 + still * 1.35), 0, 1);
      ring.style.strokeDashoffset = String(327 * (1 - progress));
      meter.style.width = `${progress * 100}%`;
      pct.textContent = `${Math.round(progress * 100)}%`;
    }

    tilt.calibrate();
    sfx.calibrate();
    vibrate(CONFIG.haptics.tick);
    $('calibDone').hidden = false;
    $('btnCalibContinue').disabled = false;
    btn.disabled = false;
    this._calibrating = false;

    await sleep(900);
    if (state.screen === SCREEN.CALIBRATE) this._startLevel(state.level);
  }

  // ---- microphone (level 3 only) ----

  async _enableMic() {
    const note = $('micNote');
    note.hidden = true;
    // getUserMedia is started first, inside the gesture; the audio graph is
    // only needed once a stream exists, so the unlock is deferred into here.
    const res = await mic.enable(async () => {
      await this._unlockAudio();
      return audio.ctx;
    });
    if (!res.ok) {
      note.textContent = t('mic.denied');
      note.hidden = false;
      mic.useTouchFallback();
      state.micMode = 'touch';
      await sleep(1400);
    } else {
      state.micMode = 'mic';
    }
    this._startLevel(3);
  }

  // ======================= level lifecycle =======================

  async _startLevel(index) {
    if (index === 3 && state.micMode === 'none') {
      this._show(SCREEN.MIC_PERMISSION);
      return;
    }

    this.level?.exit();
    this.level?.dispose?.();
    state.level = index;
    this.score.reset();
    this.hud.clearFlash();

    const Ctor = this.levels[index] || Level1;
    this.level = new Ctor(this.ctx);
    this.level.enter();
    this.hourglass.setSandRemaining(1);

    await this._countdown(index);
    if (!this.level) return; // player left during the countdown

    this.hud.show(index);
    this.runStart = performance.now();
    this._show(SCREEN.PLAYING);
  }

  async _countdown(index) {
    this._show(SCREEN.COUNTDOWN);
    const el = $('countdownValue');
    const brief = $('countdownBrief');
    brief.textContent = t(`level${index}.brief`);
    audio.duck(2.4, 0.5);
    music.setIntensity(0.12 + index * 0.1);

    for (let i = 3; i >= 1; i--) {
      el.textContent = String(i);
      el.className = 'countdown tick';
      sfx.count(undefined, 3 - i);
      vibrate(CONFIG.haptics.tick);
      this._countdownPulse = 1;
      // eslint-disable-next-line no-await-in-loop
      await sleep(850);
      if (state.screen !== SCREEN.COUNTDOWN) return;
      el.className = 'countdown';
      // Reflow so the animation restarts on the next digit.
      void el.offsetWidth;
    }

    el.textContent = t('count.go');
    el.className = 'countdown go';
    sfx.go();
    vibrate([18, 40, 18]);
    this._countdownPulse = 2.2;
    music.setIntensity(0.35 + index * 0.22);
    await sleep(720);
    brief.textContent = '';
  }

  _advance() {
    const next = state.level + 1;
    if (next > 3) {
      this._finale();
      return;
    }
    state.level = next;
    if (next === 3 && state.micMode === 'none') {
      this._show(SCREEN.MIC_PERMISSION);
      return;
    }
    this._startLevel(next);
  }

  _onLevelComplete() {
    this.hud.hide();
    state.run.levelScores[state.level] = Math.round(this.score.levelScore);
    music.setIntensity(0.3);

    $('completeTitle').textContent = t('level.complete', { n: state.level });
    const rows = [
      ['level.score', formatScore(this.score.levelScore)],
      ['level.accuracy', `${Math.round(this.score.precision * 100)}%`],
    ];
    if (state.level === 2) rows.push(['level.objects', String(this.score.objects)]);
    if (state.level === 3) rows.push(['level.breaths', String(mic.breathCount)]);
    setStats($('completeStats'), rows);

    this._show(SCREEN.LEVEL_COMPLETE);
    // After show(): the screen transition re-applies translations to the panel.
    $('btnNextLevel').textContent = state.level >= 3 ? t('btn.continue') : t('btn.next');
  }

  _onLevelFailed() {
    this.hud.hide();
    setStats($('failStats'), [
      ['level.score', formatScore(state.run.score)],
      ['level.accuracy', `${Math.round(this.score.precision * 100)}%`],
      ['hud.level', String(state.level)],
    ]);
    this._show(SCREEN.GAME_OVER);
  }

  _finale() {
    mic.release();
    const isBest = state.commitBest();

    $('finalRank').textContent = t(state.rank);
    setStats($('finalStats'), [
      ['final.score', formatScore(state.run.score)],
      ['final.time', formatTime(state.run.totalTime)],
      ['final.best', formatScore(state.bestScore) + (isBest ? ' ★' : '')],
      ['final.objects', String(state.run.objectsDestroyed)],
      ['final.precision', `${Math.round(state.precision * 100)}%`],
      ['final.breaths', String(state.run.breaths)],
    ]);

    this.hud.hide();
    this.hourglass.setBreathing(true);
    this.particles.bloom({ x: 0, y: CENTER_Y, z: 0 }, 0x36e0ff, 160, 3);
    sfx.glass(undefined, 784);
    music.setIntensity(0.5);
    this._show(SCREEN.FINALE);
  }

  async _share() {
    const text = t('share.text', { score: formatScore(state.run.score) });
    const payload = { title: 'YOU MAN', text, url: location.href };
    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(`${text} ${location.href}`);
    } catch {
      /* user dismissed the sheet, or the clipboard is unavailable */
    }
    const toast = $('shareToast');
    toast.hidden = false;
    setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  // ======================= pause & settings =======================

  _pause() {
    if (state.screen !== SCREEN.PLAYING) return;
    this.paused = true;
    this._show(SCREEN.PAUSED);
    music.setIntensity(0.15);
    audio.duck(9999, 0.4);
  }

  _resume() {
    this.paused = false;
    this.clock.getDelta(); // discard the paused interval
    audio.duck(0.1, 1);
    music.setIntensity(0.35 + state.level * 0.22);
    this._show(SCREEN.PLAYING);
  }

  _openSettings() {
    this._settingsReturn = state.screen;
    if (state.screen === SCREEN.PLAYING) this._pause();
    this._show(SCREEN.SETTINGS);
  }

  _closeSettings() {
    sfx.ui();
    const back = this._settingsReturn === SCREEN.PLAYING ? SCREEN.PAUSED : this._settingsReturn;
    this._show(back || SCREEN.INTRO);
  }

  _toggleSound() {
    const muted = audio.toggleMute();
    this._syncSoundChips();
    if (!muted) sfx.ui();
  }

  _syncSoundChips() {
    const label = audio.muted ? t('off') : t('on');
    const a = $('soundValue');
    const b = $('finalSoundValue');
    if (a) a.textContent = label;
    if (b) b.textContent = label;
    const lang = $('langValue');
    if (lang) lang.textContent = getLanguage().toUpperCase();
  }

  _refreshDynamicText() {
    applyTranslations();
    this._syncSoundChips();
    const best = state.bestScore;
    $('introBest').textContent = best ? `${t('final.best')} ${formatScore(best)}` : '';
  }

  // ======================= frame =======================

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05); // clamp after a tab switch
    this.time += dt;
    gfx.monitor(dt);

    const playing = state.screen === SCREEN.PLAYING && this.level && !this.paused;
    const input = tilt.update();

    if (playing) {
      state.run.totalTime += dt;
      this.level.update(dt, this.time, input);

      const b = this.level.balance;
      this.hud.update({
        score: state.run.score,
        multiplier: this.score.multiplier,
        sand: this.level.sand,
        stability: b.stability,
        danger: b.danger,
        lean: b.angle,
        failAngle: this.level.params.failAngle,
        extras: this.level.hudExtras(),
      });

      if (this.level.complete) this._onLevelComplete();
      else if (this.level.failed) this._onLevelFailed();

      // The gyro can vanish mid-game (permission revoked, sensor sleep).
      if (tilt.stale) {
        tilt.enableTouch();
        state.inputMode = 'touch';
      }
    } else if (state.screen === SCREEN.CALIBRATE) {
      const bubble = $('calibBubble');
      if (bubble) {
        bubble.style.transform =
          `translate(${clamp(tilt.rawValue.x, -1, 1) * 42}px, ${clamp(-tilt.rawValue.y, -1, 1) * 42}px)`;
      }
    } else if (state.screen === SCREEN.MIC_PERMISSION && mic.mode === 'mic') {
      mic.update(dt);
    }

    // Menus and result screens keep the object alive and breathing.
    const danger = playing ? this.level.balance.danger : 0;
    const lean = playing ? this.level.balance.angle : { x: 0, z: 0 };
    const glow = state.screen === SCREEN.LEVEL_COMPLETE || state.screen === SCREEN.FINALE ? 1.6 : 1;

    if (this._countdownPulse > 0) {
      this._countdownPulse = Math.max(0, this._countdownPulse - dt * 2.2);
    }

    this.hourglass.update(dt, this.time);
    this.particles.update(dt);
    this.env.update(dt, this.time, {
      danger,
      glow: glow + (this._countdownPulse || 0) * 0.5,
      lean: { x: lean.x * 2, y: lean.z * 2 },
    });

    const shake = (playing ? this.level.shake : 0) + danger * 0.05;
    gfx.updateCamera(dt, this.time, shake, { x: lean.x, y: lean.z });
    gfx.render();
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error('[boot] failed', err);
  screens.show('error');
  const el = $('errorText');
  if (el) el.textContent = `${err?.message || err}`;
});

// Exposed for manual tuning from the console during development.
window.YOUMAN = { game, state, CONFIG, gfx, audio, music, tilt, mic };
