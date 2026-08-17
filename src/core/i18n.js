import { store } from './storage.js';
import { bus } from './events.js';

/**
 * Flat key -> string dictionaries. Adding a language means adding one object
 * here and one entry to LANGUAGES; nothing else in the codebase changes.
 */
const DICT = {
  en: {
    'app.title': 'YOU MAN',
    'app.tagline': 'Find your balance.',
    'btn.start': 'START',
    'btn.howto': 'HOW TO PLAY',
    'btn.sound': 'SOUND',
    'btn.language': 'LANGUAGE',
    'btn.settings': 'SETTINGS',
    'btn.calibrate': 'CALIBRATE GYROSCOPE',
    'btn.recalibrate': 'RECALIBRATE',
    'btn.continue': 'CONTINUE',
    'btn.next': 'NEXT LEVEL',
    'btn.retry': 'TRY AGAIN',
    'btn.menu': 'MAIN MENU',
    'btn.resume': 'RESUME',
    'btn.restartLevel': 'RESTART LEVEL',
    'btn.playAgain': 'PLAY AGAIN',
    'btn.share': 'SHARE SCORE',
    'btn.close': 'CLOSE',
    'btn.touchMode': 'USE TOUCH MODE',
    'btn.allowMic': 'ALLOW MICROPHONE',
    'btn.skipMic': 'CONTINUE WITHOUT MIC',

    'howto.title': 'TILT TO BALANCE',
    'howto.line1': 'Tilt your phone gently to keep the pyramids aligned.',
    'howto.line2': 'Small movements are better than sudden ones.',
    'howto.left': 'LEFT',
    'howto.right': 'RIGHT',
    'howto.forward': 'FORWARD',
    'howto.back': 'BACK',
    'howto.desktop': 'Desktop: move the mouse or use the arrow keys.',

    'calib.title': 'CALIBRATION',
    'calib.instruction': 'Hold your phone in your usual playing position, then tap calibrate.',
    'calib.instructionFlat': 'Place your phone on a flat surface, then tap calibrate.',
    'calib.progress': 'STABILITY',
    'calib.done': 'NEUTRAL POSITION SAVED',
    'calib.hold': 'HOLD STILL',

    'perm.title': 'MOTION SENSORS',
    'perm.body': 'YOU MAN uses your device motion sensors to read the tilt of your phone. Nothing is recorded or sent anywhere.',
    'perm.denied': 'Motion access was denied. You can still play with touch controls.',
    'perm.unavailable': 'No gyroscope detected on this device. Touch mode is enabled.',
    'perm.grant': 'ENABLE MOTION',

    'count.go': 'BALANCE',

    'hud.level': 'LEVEL',
    'hud.score': 'SCORE',
    'hud.sand': 'SAND',
    'hud.stability': 'STABILITY',
    'hud.combo': 'COMBO',

    'level1.name': 'BALANCE',
    'level2.name': 'INTERFERENCE',
    'level3.name': 'BREATH',
    'level1.brief': 'Keep the pyramids aligned until the sand runs out.',
    'level2.brief': 'Tap the falling artifacts before they reach the glass.',
    'level3.brief': 'Blow into the microphone to clear the mist.',

    'level.complete': 'LEVEL {n} COMPLETE',
    'level.achieved': 'Balance achieved.',
    'level.score': 'SCORE',
    'level.accuracy': 'PRECISION',
    'level.objects': 'ARTIFACTS',
    'level.breaths': 'BREATHS',

    'fail.title': 'LOST BALANCE',
    'fail.body': 'The pyramids fell.',

    'final.title': 'YOU MAN',
    'final.body': 'You found your balance.',
    'final.score': 'FINAL SCORE',
    'final.time': 'TOTAL TIME',
    'final.best': 'BEST SCORE',
    'final.objects': 'ARTIFACTS DESTROYED',
    'final.precision': 'PRECISION',
    'final.breaths': 'BREATHS DETECTED',
    'final.rank': 'RANK',
    'rank.calm': 'CALM',
    'rank.focused': 'FOCUSED',
    'rank.precise': 'PRECISE',
    'rank.unshakable': 'UNSHAKABLE',

    'pause.title': 'PAUSED',

    'settings.title': 'SETTINGS',
    'settings.music': 'MUSIC VOLUME',
    'settings.sfx': 'EFFECTS VOLUME',
    'settings.haptics': 'VIBRATION',
    'settings.sensitivity': 'GYRO SENSITIVITY',
    'settings.quality': 'GRAPHICS QUALITY',
    'settings.contrast': 'HIGH CONTRAST',
    'settings.language': 'LANGUAGE',
    'quality.auto': 'AUTO',
    'quality.low': 'LOW',
    'quality.medium': 'MEDIUM',
    'quality.high': 'HIGH',
    'on': 'ON',
    'off': 'OFF',

    'mic.title': 'MICROPHONE',
    'mic.body': 'Level 3 listens for your breath to clear the mist. Audio is analysed on your device only — nothing is recorded, stored or sent.',
    'mic.denied': 'Microphone unavailable. Tap and hold the screen to blow instead.',
    'mic.calibrating': 'LISTENING TO THE ROOM…',
    'mic.blow': 'BLOW',
    'mic.fallbackHint': 'Hold the screen to blow',

    'loading': 'LOADING',
    'error.webgl': 'This device could not start WebGL. Try another browser.',
    'share.text': 'I balanced YOU MAN with {score} points. Find your balance.',
    'share.copied': 'SCORE COPIED',
  },

  fr: {
    'app.title': 'YOU MAN',
    'app.tagline': 'Trouvez votre équilibre.',
    'btn.start': 'COMMENCER',
    'btn.howto': 'COMMENT JOUER',
    'btn.sound': 'SON',
    'btn.language': 'LANGUE',
    'btn.settings': 'RÉGLAGES',
    'btn.calibrate': 'CALIBRER LE GYROSCOPE',
    'btn.recalibrate': 'RECALIBRER',
    'btn.continue': 'CONTINUER',
    'btn.next': 'NIVEAU SUIVANT',
    'btn.retry': 'RECOMMENCER',
    'btn.menu': 'MENU PRINCIPAL',
    'btn.resume': 'REPRENDRE',
    'btn.restartLevel': 'REPRENDRE LE NIVEAU',
    'btn.playAgain': 'REJOUER',
    'btn.share': 'PARTAGER LE SCORE',
    'btn.close': 'FERMER',
    'btn.touchMode': 'MODE TACTILE',
    'btn.allowMic': 'AUTORISER LE MICRO',
    'btn.skipMic': 'CONTINUER SANS MICRO',

    'howto.title': 'INCLINEZ POUR ÉQUILIBRER',
    'howto.line1': 'Inclinez doucement votre téléphone pour garder les pyramides alignées.',
    'howto.line2': 'Les petits mouvements sont plus efficaces que les mouvements brusques.',
    'howto.left': 'GAUCHE',
    'howto.right': 'DROITE',
    'howto.forward': 'AVANT',
    'howto.back': 'ARRIÈRE',
    'howto.desktop': 'Sur ordinateur : bougez la souris ou utilisez les flèches.',

    'calib.title': 'CALIBRATION',
    'calib.instruction': 'Tenez votre téléphone dans votre position de jeu habituelle, puis appuyez sur calibrer.',
    'calib.instructionFlat': 'Posez votre téléphone sur une surface plane, puis appuyez sur calibrer.',
    'calib.progress': 'STABILITÉ',
    'calib.done': 'POSITION NEUTRE ENREGISTRÉE',
    'calib.hold': 'NE BOUGEZ PLUS',

    'perm.title': 'CAPTEURS DE MOUVEMENT',
    'perm.body': "YOU MAN utilise les capteurs de mouvement pour lire l'inclinaison de votre téléphone. Rien n'est enregistré ni transmis.",
    'perm.denied': "L'accès aux capteurs a été refusé. Vous pouvez jouer en mode tactile.",
    'perm.unavailable': 'Aucun gyroscope détecté. Le mode tactile est activé.',
    'perm.grant': 'ACTIVER LES CAPTEURS',

    'count.go': 'ÉQUILIBRE',

    'hud.level': 'NIVEAU',
    'hud.score': 'SCORE',
    'hud.sand': 'SABLE',
    'hud.stability': 'STABILITÉ',
    'hud.combo': 'COMBO',

    'level1.name': 'ÉQUILIBRE',
    'level2.name': 'INTERFÉRENCE',
    'level3.name': 'SOUFFLE',
    'level1.brief': "Gardez les pyramides alignées jusqu'à la fin du sable.",
    'level2.brief': "Touchez les artefacts avant qu'ils n'atteignent le verre.",
    'level3.brief': 'Soufflez dans le microphone pour dissiper la brume.',

    'level.complete': 'NIVEAU {n} TERMINÉ',
    'level.achieved': 'Équilibre atteint.',
    'level.score': 'SCORE',
    'level.accuracy': 'PRÉCISION',
    'level.objects': 'ARTEFACTS',
    'level.breaths': 'SOUFFLES',

    'fail.title': 'ÉQUILIBRE PERDU',
    'fail.body': 'Les pyramides sont tombées.',

    'final.title': 'YOU MAN',
    'final.body': 'Équilibre atteint.',
    'final.score': 'SCORE FINAL',
    'final.time': 'TEMPS TOTAL',
    'final.best': 'MEILLEUR SCORE',
    'final.objects': 'ARTEFACTS DÉTRUITS',
    'final.precision': 'PRÉCISION',
    'final.breaths': 'SOUFFLES DÉTECTÉS',
    'final.rank': 'APPRÉCIATION',
    'rank.calm': 'CALME',
    'rank.focused': 'CONCENTRÉ',
    'rank.precise': 'PRÉCIS',
    'rank.unshakable': 'INÉBRANLABLE',

    'pause.title': 'PAUSE',

    'settings.title': 'RÉGLAGES',
    'settings.music': 'VOLUME MUSIQUE',
    'settings.sfx': 'VOLUME EFFETS',
    'settings.haptics': 'VIBRATIONS',
    'settings.sensitivity': 'SENSIBILITÉ GYRO',
    'settings.quality': 'QUALITÉ GRAPHIQUE',
    'settings.contrast': 'CONTRASTE ÉLEVÉ',
    'settings.language': 'LANGUE',
    'quality.auto': 'AUTO',
    'quality.low': 'BASSE',
    'quality.medium': 'MOYENNE',
    'quality.high': 'HAUTE',
    'on': 'OUI',
    'off': 'NON',

    'mic.title': 'MICROPHONE',
    'mic.body': "Le niveau 3 écoute votre souffle pour dissiper la brume. L'audio est analysé uniquement sur votre appareil — rien n'est enregistré, stocké ni transmis.",
    'mic.denied': "Microphone indisponible. Maintenez l'écran appuyé pour souffler.",
    'mic.calibrating': "ÉCOUTE DE L'AMBIANCE…",
    'mic.blow': 'SOUFFLEZ',
    'mic.fallbackHint': "Maintenez l'écran pour souffler",

    'loading': 'CHARGEMENT',
    'error.webgl': "WebGL n'a pas pu démarrer sur cet appareil. Essayez un autre navigateur.",
    'share.text': "J'ai tenu l'équilibre sur YOU MAN avec {score} points. Trouvez le vôtre.",
    'share.copied': 'SCORE COPIÉ',
  },
};

export const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
];

let current = store.get('language');
if (!current) {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  current = DICT[nav] ? nav : 'en';
}

export function t(key, params) {
  let s = DICT[current]?.[key] ?? DICT.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  if (!DICT[code]) return;
  current = code;
  store.set('language', code);
  document.documentElement.lang = code;
  applyTranslations();
  bus.emit('language:changed', code);
}

export function cycleLanguage() {
  const idx = LANGUAGES.findIndex((l) => l.code === current);
  setLanguage(LANGUAGES[(idx + 1) % LANGUAGES.length].code);
}

/** Replaces the text of every [data-i18n] node; call after any DOM injection. */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}

document.documentElement.lang = current;
