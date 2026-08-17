#!/usr/bin/env node
/**
 * Headless play-through. Boots the game in a phone-sized Chromium, drives the
 * real UI, fast-forwards the sand through the config, and asserts that all
 * three levels complete and the finale renders. Console errors fail the run.
 *
 *   npm run dev &        # or any static server on :5173
 *   npm run smoke
 */
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Mono 16-bit PCM white noise — the closest thing to a breath in a file. */
function whiteNoiseWav(seconds, rate, amplitude) {
  const frames = seconds * rate;
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round((Math.random() * 2 - 1) * amplitude * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const URL = process.env.SMOKE_URL || 'http://localhost:5173/index.html';
const errors = [];
let failures = 0;

const check = (label, ok) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['Pixel 7'],
  permissions: [],
});
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const screen = () => page.evaluate(() => window.YOUMAN?.state.screen);
const waitScreen = (name, timeout = 25000) =>
  page.waitForFunction((n) => window.YOUMAN?.state.screen === n, name, { timeout });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.YOUMAN, null, { timeout: 15000 });

check('WebGL context and boot', await page.evaluate(() => !!window.YOUMAN.gfx.renderer));
await waitScreen('intro');
check('intro screen', (await screen()) === 'intro');

// Shorten the levels so the whole run fits in a test.
await page.evaluate(() => {
  for (const k of [1, 2, 3]) window.YOUMAN.CONFIG.levels[k].sandDuration = 3;
  window.YOUMAN.CONFIG.levels[3].mistClearPower = 6;
});

await page.click('#btnStart');
await waitScreen('howto');
check('how-to screen', true);

await page.click('#btnToCalibrate');
// No motion sensors in headless Chromium: the game must fall back to touch.
await waitScreen('permission');
check('motion fallback offered', true);
await page.click('#btnTouchMode');
await waitScreen('calibrate');
check('calibration screen', true);

await page.click('#btnCalibrate');
await waitScreen('playing', 20000);
check('countdown ran and level 1 started', await page.evaluate(() => window.YOUMAN.state.level === 1));
check('HUD visible', await page.isVisible('#hud'));

// Hold the pointer at screen centre: neutral tilt in the touch backend.
const box = page.viewportSize();
await page.mouse.move(box.width / 2, box.height / 2);

await waitScreen('levelComplete', 30000);
check('level 1 completed', true);
check('score accumulated', (await page.evaluate(() => window.YOUMAN.state.run.score)) > 0);

await page.click('#btnNextLevel');
await waitScreen('playing', 20000);
check('level 2 started', await page.evaluate(() => window.YOUMAN.state.level === 2));

// Tap wherever an artifact currently is, proving the picking path works.
await page.waitForFunction(() => window.YOUMAN.game.level.field.items.length > 0, null, { timeout: 15000 });
const hit = await page.evaluate(() => {
  const g = window.YOUMAN.game;
  const it = g.level.field.items[0];
  const v = it.mesh.position.clone().project(window.YOUMAN.gfx.camera);
  return g.level.onPointerDown(v.x, v.y);
});
check('artifact destroyed by tap', hit === true);

await waitScreen('levelComplete', 40000);
check('level 2 completed', true);

await page.click('#btnNextLevel');
await waitScreen('micPermission', 15000);
check('microphone consent requested before level 3', true);
await page.click('#btnSkipMic');
await waitScreen('playing', 20000);
check('level 3 started with touch fallback', await page.evaluate(() => window.YOUMAN.state.level === 3));

// Simulate a sustained breath through the documented fallback.
await page.evaluate(() => window.YOUMAN.mic.setTouchBlow(true));
await waitScreen('levelComplete', 60000);
check('mist cleared and level 3 completed', true);
check('breaths counted', (await page.evaluate(() => window.YOUMAN.state.run.breaths)) > 0);

await page.click('#btnNextLevel');
await waitScreen('finale', 15000);
check('finale screen', true);
const final = await page.evaluate(() => ({
  score: window.YOUMAN.state.run.score,
  best: window.YOUMAN.state.bestScore,
  rank: document.getElementById('finalRank').textContent,
}));
check(`final score ${final.score} persisted as best ${final.best}`, final.best === final.score);
check(`rank shown (${final.rank})`, !!final.rank);

await page.screenshot({ path: process.env.SMOKE_SHOT || '/tmp/youman-finale.png' });

check(`no console errors (${errors.length})`, errors.length === 0);
if (errors.length) errors.slice(0, 10).forEach((e) => console.log(`    ${e}`));

await browser.close();

// ---- second pass: the real microphone path, fed with synthetic breath ------
// Chromium's built-in fake device is silent, which proves nothing about the
// detector. A white-noise WAV is spectrally what a breath is, so feeding one
// in exercises the flatness heuristic for real.
const noiseWav = join(tmpdir(), 'youman-breath.wav');
writeFileSync(noiseWav, whiteNoiseWav(2, 48000, 0.5));

const micBrowser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${noiseWav}`,
  ],
});
const micCtx = await micBrowser.newContext({ ...devices['Pixel 7'], permissions: ['microphone'] });
const micPage = await micCtx.newPage();
micPage.on('pageerror', (e) => console.log(`    mic pass pageerror: ${e.message}`));
await micPage.goto(URL, { waitUntil: 'load' });
await micPage.waitForFunction(() => !!window.YOUMAN, null, { timeout: 15000 });
await micPage.waitForFunction(() => window.YOUMAN.state.screen === 'intro');

const micResult = await micPage.evaluate(async () => {
  const Y = window.YOUMAN;
  const res = await Y.mic.enable(async () => {
    await Y.audio.unlock();
    return Y.audio.ctx;
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  const pump = async (ms) => {
    const t0 = performance.now();
    // Drive the analyser by hand: the game loop only polls it during level 3.
    while (performance.now() - t0 < ms) {
      Y.mic.update(0.016);
      await new Promise((r) => requestAnimationFrame(r));
    }
  };

  Y.mic.startCalibration();
  await pump(2200);
  const calibrated = !Y.mic.calibrating;
  const measuredAmbient = Y.mic.ambientRms;

  // The fake device plays the noise file on a loop, so it is also what got
  // measured as "ambient". Drop the floor to a quiet-room value and confirm
  // the same signal now reads as a breath.
  Y.mic.ambientRms = 0.004;
  await pump(900);

  const out = {
    ok: true,
    mode: Y.mic.mode,
    calibrated,
    ambient: measuredAmbient,
    rms: Y.mic.rms,
    flatness: Y.mic.flatness,
    level: Y.mic.level,
    blowing: Y.mic.isBlowing,
    breaths: Y.mic.breathCount,
  };
  Y.mic.release();
  out.releasedTracks = Y.mic.stream === null;
  return out;
});

check('microphone stream opens', micResult.ok === true);
check(`analyser receives audio (rms=${micResult.rms?.toFixed(4)})`, micResult.rms > 0);
check(`ambient calibration completes (${micResult.ambient?.toFixed(4)})`, micResult.calibrated === true);
check(`broadband noise reads as breath (flatness=${micResult.flatness?.toFixed(2)}, level=${micResult.level?.toFixed(2)})`,
  micResult.blowing === true && micResult.level > 0.3);
check(`breath counted (${micResult.breaths})`, micResult.breaths > 0);
check('release() stops every track', micResult.releasedTracks === true);
await micBrowser.close();
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
