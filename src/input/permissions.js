/**
 * Everything that needs an explicit user gesture / OS prompt goes through here,
 * so no sensor is ever opened as a side effect of loading the page.
 */

export const isSecure = window.isSecureContext;

export function needsMotionPrompt() {
  return typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function';
}

export function motionApiPresent() {
  return typeof DeviceOrientationEvent !== 'undefined' ||
    typeof DeviceMotionEvent !== 'undefined';
}

/**
 * @returns {Promise<'granted'|'denied'|'unsupported'|'insecure'>}
 * On iOS 13+ this MUST be called synchronously inside a user gesture handler.
 */
export async function requestMotionPermission() {
  if (!motionApiPresent()) return 'unsupported';
  if (!isSecure) return 'insecure';
  if (!needsMotionPrompt()) return 'granted'; // Android / desktop: no prompt
  try {
    const res = await DeviceMotionEvent.requestPermission();
    return res === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    console.warn('[permissions] motion request failed', err);
    return 'denied';
  }
}

/**
 * Confirms real orientation events actually arrive — some Android browsers
 * expose the API but never fire it (no sensor, or a locked-down webview).
 */
export function probeOrientationEvents(timeout = 1200) {
  return new Promise((resolve) => {
    if (typeof DeviceOrientationEvent === 'undefined') return resolve(false);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      window.removeEventListener('deviceorientation', onEvent);
      clearTimeout(timer);
      resolve(ok);
    };
    const onEvent = (e) => {
      if (e.beta !== null || e.gamma !== null || e.alpha !== null) finish(true);
    };
    window.addEventListener('deviceorientation', onEvent);
    const timer = setTimeout(() => finish(false), timeout);
  });
}

export async function requestMicrophone() {
  if (!isSecure) return { ok: false, reason: 'insecure' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'unsupported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    return { ok: true, stream };
  } catch (err) {
    return { ok: false, reason: err?.name === 'NotAllowedError' ? 'denied' : 'unavailable' };
  }
}
