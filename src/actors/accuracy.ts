import type { WeaponId } from '../render/viewmodel/rig.ts';

/** Per-weapon spread, hold-to-focus, and rapid-fire bloom tuning (weapon-accuracy spec). */
export interface AccuracyProfile {
  /** Rested hipfire spread half-angle (radians). */
  hipSpread: number;
  /** Initial ADS spread half-angle (radians) before hold-to-focus settles. */
  adsSpread: number;
  /** Fully focused ADS spread half-angle (radians). */
  focusSpread: number;
  /** Seconds of steady ADS required to reach 100% focus. */
  focusTime: number;
  /** Bloom (radians) added per shot when firing from the hip. */
  bloomPerShotHip: number;
  /** Bloom (radians) added per shot when firing while aiming down sights. */
  bloomPerShotAds: number;
  /** Maximum accumulated bloom (radians). */
  bloomMax: number;
  /** Brief hold (seconds) after a shot before bloom begins decaying. */
  bloomDelay: number;
  /** Bloom recovery speed (radians per second) after the hold elapses. */
  bloomDecayRate: number;
  /** Share of built-up focus lost when a shot is fired (1 = full reset). */
  shotFocusLoss: number;
}

/** Mutable per-weapon accuracy profiles so playtesting / debug tools can tune feel live. */
export const ACCURACY_PROFILES: Record<WeaponId, AccuracyProfile> = {
  pistol: {
    hipSpread: 0.024,
    adsSpread: 0.014,
    focusSpread: 0.002,
    focusTime: 0.75,
    bloomPerShotHip: 0.018,
    bloomPerShotAds: 0.012,
    bloomMax: 0.075,
    bloomDelay: 0.1,
    bloomDecayRate: 0.075,
    shotFocusLoss: 1,
  },
  shotgun: {
    hipSpread: 0.075,
    adsSpread: 0.062,
    focusSpread: 0.042,
    focusTime: 0.85,
    bloomPerShotHip: 0.026,
    bloomPerShotAds: 0.018,
    bloomMax: 0.11,
    bloomDelay: 0.12,
    bloomDecayRate: 0.05,
    shotFocusLoss: 1,
  },
};

/** Tuning constants for movement and camera-turn focus disturbance. */
export const ACCURACY_DISTURBANCE = {
  /** Minimum aimBlend required for hold-to-focus to accumulate. */
  aimThreshold: 0.85,
  /** aimBlend below which focus decays back toward 0. */
  aimDropThreshold: 0.5,
  /** Horizontal speed (m/s) below which movement does not slow focus. */
  moveFreeSpeed: 0.4,
  /** Focus gain multiplier while moving faster than `moveFreeSpeed`. */
  moveSlowFactor: 0.35,
  /** Angular turn rate (rad/s) below which gentle tracking does not disturb focus. */
  turnFreeRate: 0.35,
  /** Angular turn rate (rad/s) above which sharp flicks stall and shed focus. */
  turnFlickRate: 1.8,
  /** Focus shed per second during a sharp camera flick. */
  flickShedRate: 1.6,
  /** Focus decay per second when dropping out of ADS. */
  focusDropRate: 3.5,
  /** Bloom (radians) above which focus waits for bloom to settle before rebuilding. */
  bloomFocusGate: 0.004,
  /** Focus threshold (0..1) considered fully locked. */
  focusedThreshold: 0.98,
};

export interface AccuracyStepInput {
  dt: number;
  weapon: WeaponId;
  /** 0 = hipfire, 1 = fully aimed down sights. */
  aimBlend: number;
  /** Horizontal player speed in m/s. */
  moveSpeed: number;
  /** Angular camera speed in rad/s. */
  turnRate: number;
  sprinting: boolean;
  reloading: boolean;
  armed: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Pure dynamic weapon accuracy state (weapon-accuracy spec): owns rapid-fire bloom
 * and steady-aim hold-to-focus so hitscan (`fireShot`) and the crosshair HUD always
 * read the exact same angular spread cone.
 */
export class WeaponAccuracy {
  private currentWeapon: WeaponId = 'pistol';
  private _bloom = 0;
  private _bloomHold = 0;
  private _focus = 0;
  private _aimBlend = 0;
  private _armed = true;
  private _suppressed = false;

  get weapon(): WeaponId {
    return this.currentWeapon;
  }

  /** Current accumulated rapid-fire bloom in radians. */
  get bloom(): number {
    return this._bloom;
  }

  /** Current hold-to-focus progress in 0..1. */
  get focus(): number {
    return this._focus;
  }

  /** True when armed, ready to fire, bloom is settled, and focus is fully locked. */
  get focused(): boolean {
    return this._armed && !this._suppressed && this._focus >= ACCURACY_DISTURBANCE.focusedThreshold && this._bloom < 0.001;
  }

  get armed(): boolean {
    return this._armed;
  }

  /** True while sprinting or reloading (brackets suppressed). */
  get suppressed(): boolean {
    return this._suppressed;
  }

  /** Current resolved angular spread half-angle in radians. */
  get spreadRad(): number {
    const p = ACCURACY_PROFILES[this.currentWeapon];
    const aimedBase = lerp(p.adsSpread, p.focusSpread, easeOutQuad(this._focus));
    const stanceBase = lerp(p.hipSpread, aimedBase, this._aimBlend);
    return stanceBase + this._bloom;
  }

  /** Reset all dynamic state (new game, load, or death restart). */
  reset(weapon: WeaponId = this.currentWeapon): void {
    this.currentWeapon = weapon;
    this._bloom = 0;
    this._bloomHold = 0;
    this._focus = 0;
    this._aimBlend = 0;
    this._suppressed = false;
  }

  /** Advance bloom decay and hold-to-focus state by `input.dt` seconds. */
  step(input: AccuracyStepInput): void {
    const dt = Math.max(0, input.dt);
    const switched = input.weapon !== this.currentWeapon;
    if (switched) {
      this.currentWeapon = input.weapon;
      this._focus = 0;
      this._bloom = 0;
      this._bloomHold = 0;
    }
    this._aimBlend = clamp01(input.aimBlend);
    this._armed = input.armed;
    this._suppressed = input.sprinting || input.reloading;
    if (switched) return;

    const p = ACCURACY_PROFILES[this.currentWeapon];
    const d = ACCURACY_DISTURBANCE;

    // 1. Bloom decay after brief post-shot hold.
    if (this._bloomHold > 0) {
      this._bloomHold = Math.max(0, this._bloomHold - dt);
    } else if (this._bloom > 0) {
      this._bloom = Math.max(0, this._bloom - p.bloomDecayRate * dt);
    }

    // 2. Focus cleared immediately when unarmed, sprinting, or reloading.
    if (!this._armed || this._suppressed) {
      this._focus = 0;
      return;
    }

    // 3. Focus decays when releasing ADS.
    if (this._aimBlend < d.aimDropThreshold) {
      this._focus = Math.max(0, this._focus - d.focusDropRate * dt);
      return;
    }

    // 4. Hold-to-focus while aimed down sights.
    if (this._aimBlend >= d.aimThreshold && this._bloom <= d.bloomFocusGate) {
      if (input.turnRate >= d.turnFlickRate) {
        this._focus = Math.max(0, this._focus - d.flickShedRate * dt);
        return;
      }
      let stability = 1;
      if (input.moveSpeed > d.moveFreeSpeed) {
        stability *= d.moveSlowFactor;
      }
      if (input.turnRate > d.turnFreeRate) {
        const t = clamp01((input.turnRate - d.turnFreeRate) / (d.turnFlickRate - d.turnFreeRate));
        stability *= 1 - t;
      }
      if (p.focusTime > 0 && stability > 0) {
        this._focus = Math.min(1, this._focus + (dt / p.focusTime) * stability);
      }
    }
  }

  /** Apply shot impulse: add bloom (hip or ADS) and drop focus. Call after reading `spreadRad` for the shot. */
  onShot(weapon: WeaponId = this.currentWeapon): void {
    if (weapon !== this.currentWeapon) {
      this.currentWeapon = weapon;
      this._bloom = 0;
      this._focus = 0;
    }
    const p = ACCURACY_PROFILES[this.currentWeapon];
    const kick = lerp(p.bloomPerShotHip, p.bloomPerShotAds, this._aimBlend);
    this._bloom = Math.min(p.bloomMax, this._bloom + kick);
    this._bloomHold = p.bloomDelay;
    this._focus = Math.max(0, this._focus - p.shotFocusLoss);
  }
}
