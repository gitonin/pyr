/* YOU MAN service worker — app-shell cache so the game runs offline. */
const VERSION = 'youman-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/main.css',
  './vendor/three.module.min.js',
  './vendor/three.core.min.js',
  './assets/icons/icon.svg',
  './src/main.js',
  './src/core/config.js',
  './src/core/events.js',
  './src/core/i18n.js',
  './src/core/state.js',
  './src/core/storage.js',
  './src/core/utils.js',
  './src/input/permissions.js',
  './src/input/tilt.js',
  './src/input/mic.js',
  './src/audio/audio.js',
  './src/audio/music.js',
  './src/audio/sfx.js',
  './src/render/renderer.js',
  './src/render/environment.js',
  './src/render/hourglass.js',
  './src/render/particles.js',
  './src/render/mist.js',
  './src/game/balance.js',
  './src/game/score.js',
  './src/game/artifacts.js',
  './src/game/levels/baseLevel.js',
  './src/game/levels/level1.js',
  './src/game/levels/level2.js',
  './src/game/levels/level3.js',
  './src/ui/screens.js',
  './src/ui/hud.js',
  './src/ui/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      // addAll is all-or-nothing; add individually so one miss cannot brick install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Network-first keeps development fast; the cache is the offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
