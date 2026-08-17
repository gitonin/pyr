import { $, onTap } from './screens.js';
import { store } from '../core/storage.js';
import { audio } from '../audio/audio.js';
import { gfx } from '../render/renderer.js';
import { tilt } from '../input/tilt.js';
import { setLanguage, getLanguage } from '../core/i18n.js';
import { setHapticsIntensity, vibrate } from '../core/utils.js';
import { bus } from '../core/events.js';

/** Wires the settings panel to the systems it controls and to localStorage. */
export function initSettings(onClose) {
  const music = $('setMusic');
  const sfxEl = $('setSfx');
  const haptics = $('setHaptics');
  const sens = $('setSensitivity');

  music.value = store.get('musicVolume');
  sfxEl.value = store.get('sfxVolume');
  haptics.value = store.get('hapticsIntensity');
  sens.value = store.get('gyroSensitivity');
  setHapticsIntensity(Number(haptics.value));

  music.addEventListener('input', () => audio.setMusicVolume(Number(music.value)));
  sfxEl.addEventListener('input', () => audio.setSfxVolume(Number(sfxEl.value)));
  haptics.addEventListener('change', () => {
    const v = Number(haptics.value);
    store.set('hapticsIntensity', v);
    setHapticsIntensity(v);
    vibrate([30]);
  });
  sens.addEventListener('input', () => tilt.setSensitivity(Number(sens.value)));

  const segment = (id, value, onPick) => {
    const root = $(id);
    const sync = (v) => {
      root.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.value === v));
    };
    root.querySelectorAll('button').forEach((b) => {
      onTap(b, () => {
        sync(b.dataset.value);
        onPick(b.dataset.value);
      });
    });
    sync(value);
    return sync;
  };

  segment('setQuality', store.get('quality') || 'auto', (v) => {
    if (v === 'auto') gfx.setAutoQuality(true);
    else gfx.setQuality(v);
  });

  const applyContrast = (on) => {
    document.documentElement.dataset.contrast = on ? 'on' : 'off';
    store.set('highContrast', on);
    bus.emit('contrast:changed', on);
  };
  segment('setContrast', store.get('highContrast') ? 'on' : 'off', (v) => applyContrast(v === 'on'));
  applyContrast(store.get('highContrast'));

  const syncLang = segment('setLanguage', getLanguage(), (v) => setLanguage(v));
  bus.on('language:changed', (code) => syncLang(code));

  onTap($('btnSettingsClose'), onClose);
}
