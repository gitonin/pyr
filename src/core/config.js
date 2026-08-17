/**
 * Central tuning table. Everything gameplay-facing that a designer would want
 * to touch lives here so no balancing pass requires hunting through systems.
 */

export const CONFIG = {
  // ---- Level durations (seconds of sand) -------------------------------
  levels: {
    1: {
      sandDuration: 45,
      instability: 0.45,
      perturbation: 0.05,
      warnAngle: 0.38,
      failAngle: 0.68,
      graceSeconds: 1.9,
    },
    2: {
      sandDuration: 55,
      instability: 0.78,
      perturbation: 0.11,
      warnAngle: 0.32,
      failAngle: 0.58,
      graceSeconds: 1.3,
      spawn: { startInterval: 2.2, minInterval: 0.75, rampSeconds: 40 },
      objectFallSpeed: { min: 0.9, max: 1.5 },
      missPenalty: 120,
      missShake: 0.16,
    },
    3: {
      sandDuration: 60,
      instability: 0.95,
      perturbation: 0.14,
      warnAngle: 0.3,
      failAngle: 0.55,
      graceSeconds: 1.2,
      mistRegrowth: 0.022, // density per second when not blowing
      mistClearPower: 0.55, // density removed per second at full blow
      mistWinThreshold: 0.18, // mean density considered "clear"
    },
  },

  // ---- Balance physics --------------------------------------------------
  physics: {
    spring: 7.4, // pull toward the tilt the player is asking for
    damping: 2.75, // velocity damping: enough to keep overshoot readable
    maxAngularAccel: 9.0, // acceleration clamp: no brutal snaps
    inputGain: 0.42, // radians of lean at full phone tilt
    deadzone: 0.035, // ignore involuntary micro-movement
    smoothing: 0.16, // EMA factor on raw sensor input (0..1, lower = smoother)
    recoveryAssist: 0.35, // gentle help back to centre while inside warn zone
  },

  // ---- Scoring ----------------------------------------------------------
  score: {
    perSecondBase: 100,
    perfectRadius: 0.07, // |lean| below this = perfect
    goodRadius: 0.17,
    multiplierStep: 0.35, // multiplier gained per second held perfect
    multiplierMax: 5,
    multiplierDecay: 1.1, // per second when outside the good radius
    calmBonusPerSecond: 45, // extra for low angular velocity
    objectHit: 250,
    objectWhiteBonus: 900,
    comboStep: 0.25,
    comboMax: 8,
    breathTick: 60,
  },

  // ---- Audio ------------------------------------------------------------
  audio: {
    bpm: 84,
    lookahead: 0.1,
    scheduleAhead: 0.22,
    musicVolume: 0.55,
    sfxVolume: 0.75,
  },

  // ---- Microphone (level 3) --------------------------------------------
  mic: {
    fftSize: 1024,
    calibrationSeconds: 1.6,
    thresholdOverAmbient: 2.6, // multiplier over calibrated ambient RMS
    flatnessMin: 0.24, // breath is broadband noise, not a tone
    smoothing: 0.22,
    minRms: 0.012,
  },

  // ---- Presentation -----------------------------------------------------
  render: {
    targetFps: 60,
    downgradeFps: 42, // sustained below this -> drop a quality tier
    downgradeSeconds: 2.5,
    particleCounts: { high: 900, medium: 480, low: 200 },
    mistPuffs: { high: 34, medium: 24, low: 16 },
  },

  haptics: {
    warn: [14],
    fail: [40, 60, 90],
    hit: [10],
    tick: [8],
  },
};

export const QUALITY_TIERS = ['low', 'medium', 'high'];
