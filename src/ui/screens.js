import { applyTranslations, t } from '../core/i18n.js';

/**
 * Screen manager. Sections are declared in index.html with [data-screen];
 * only one is mounted at a time, with a two-frame handoff so the CSS opacity
 * transition actually runs (display:none cancels transitions otherwise).
 */
class ScreenManager {
  constructor() {
    this.nodes = new Map();
    document.querySelectorAll('[data-screen]').forEach((el) => {
      this.nodes.set(el.dataset.screen, el);
    });
    this.current = null;
    this._pending = null;
  }

  show(name) {
    const next = this.nodes.get(name);
    if (!next) {
      console.warn(`[screens] unknown screen "${name}"`);
      return;
    }
    if (this.current === next) return;

    for (const [key, el] of this.nodes) {
      if (key === name) continue;
      el.classList.remove('is-active');
      el.style.opacity = '';
    }
    // Dialogs (pause, settings) sit above; everything else replaces.
    next.classList.add('is-active');
    next.style.opacity = '0';
    cancelAnimationFrame(this._pending);
    this._pending = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        next.style.opacity = '';
      });
    });
    this.current = next;
    applyTranslations(next);
  }

  hideAll() {
    for (const el of this.nodes.values()) el.classList.remove('is-active');
    this.current = null;
  }

  node(name) {
    return this.nodes.get(name);
  }
}

export const screens = new ScreenManager();

export function $(id) {
  return document.getElementById(id);
}

/** Fills a <dl> from [labelKey, value] pairs. */
export function setStats(el, rows) {
  el.innerHTML = '';
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = t(key);
    const dd = document.createElement('dd');
    dd.textContent = value;
    el.append(dt, dd);
  }
}

/** Attaches a handler that also plays the UI click and prevents ghost taps. */
export function onTap(el, fn) {
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    fn(e);
  });
}
