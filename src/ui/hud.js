import { $ } from './screens.js';
import { formatScore, clamp } from '../core/utils.js';
import { t } from '../core/i18n.js';

/**
 * In-game overlay. Kept deliberately sparse: level, score, two vertical
 * meters, and the reticle that shows where the upper apex actually is.
 * Everything else fades in only when its level needs it.
 */
export class Hud {
  constructor() {
    this.root = $('hud');
    this.level = $('hudLevel');
    this.score = $('hudScore');
    this.mult = $('hudMult');
    this.sand = $('sandFill');
    this.stab = $('stabFill');
    this.extra = $('hudExtra');
    this.breath = $('breathMeter');
    this.breathFill = $('breathFill');
    this.breathHint = $('breathHint');
    this.reticle = $('reticle');
    this.reticleDot = $('reticleDot');
    this.flash = $('dangerFlash');
    this._lastScore = -1;
    this._lastExtra = '';
  }

  show(level) {
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('is-visible'));
    this.level.textContent = String(level);
    this.breath.hidden = level !== 3;
    this._lastExtra = '';
    this.extra.innerHTML = '';
  }

  hide() {
    this.root.classList.remove('is-visible');
    setTimeout(() => {
      this.root.hidden = true;
    }, 400);
  }

  update(runtime) {
    const { score, multiplier, sand, stability, danger, lean, extras, failAngle } = runtime;

    if (score !== this._lastScore) {
      this.score.textContent = formatScore(score);
      this._lastScore = score;
    }

    if (multiplier > 1.05) {
      this.mult.textContent = `×${multiplier.toFixed(1)}`;
      this.mult.classList.toggle('hot', multiplier > 3);
    } else {
      this.mult.textContent = '';
      this.mult.classList.remove('hot');
    }

    this.sand.style.transform = `scaleY(${clamp(sand, 0, 1)})`;
    this.stab.style.transform = `scaleY(${clamp(stability, 0, 1)})`;
    const stabColor = danger > 0.55 ? 'var(--red)' : danger > 0.28 ? 'var(--ember)' : 'var(--cyan)';
    this.stab.style.background = stabColor;
    this.reticleDot.style.background = stabColor;
    this.reticleDot.style.boxShadow = `0 0 12px ${stabColor}`;

    // The dot maps the apex offset onto the reticle: pure spatial feedback.
    const k = 46 / Math.max(0.001, failAngle);
    this.reticleDot.style.transform =
      `translate(${clamp(lean.x * k, -46, 46)}px, ${clamp(-lean.z * k, -46, 46)}px)`;
    this.reticle.style.opacity = String(0.35 + danger * 0.6);

    this.flash.style.opacity = String(danger > 0.5 ? (danger - 0.5) * 1.3 : 0);

    if (extras) this._renderExtras(extras);
  }

  _renderExtras(x) {
    if (x.mist !== undefined) {
      const pct = Math.round((1 - x.mist) * 100);
      const key = `${pct}|${x.breaths}`;
      if (key !== this._lastExtra) {
        this._lastExtra = key;
        this.extra.innerHTML =
          `<span>${t('level3.name')} <b>${pct}%</b></span>` +
          `<span>${t('final.breaths')} <b>${x.breaths}</b></span>`;
      }
      this.breathFill.style.width = `${clamp(x.blow, 0, 1) * 100}%`;
      this.breath.classList.toggle('active', x.blow > 0.25);
      this.breathHint.textContent = x.micMode === 'touch' ? t('mic.fallbackHint') : '';
      return;
    }
    if (x.combo !== undefined) {
      const key = `${x.combo}|${x.objects}`;
      if (key === this._lastExtra) return;
      this._lastExtra = key;
      const hot = x.combo >= 6 ? ' class="combo-hot"' : '';
      this.extra.innerHTML =
        `<span${hot}>${t('hud.combo')} <b>×${x.comboMultiplier.toFixed(2)}</b></span>` +
        `<span>${t('level.objects')} <b>${x.objects}</b></span>`;
    }
  }

  clearFlash() {
    this.flash.style.opacity = '0';
  }
}
