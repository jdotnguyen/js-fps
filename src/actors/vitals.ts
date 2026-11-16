/**
 * Player health and the Downed state (ADR-0004, numbers from ADR-0008 difficulty).
 *
 *   alive --(hp hits 0, revives left)--> downed --(medic revive)--> alive
 *   alive --(hp hits 0, no revives left)--> dead
 *   downed --(bleed-out timer ends)--> dead
 *
 * Pure state; the Player turns transitions into events and feedback.
 */
export type VitalState = 'alive' | 'downed' | 'dead';

export interface VitalsTuning {
  playerDamageTaken: number;
  bleedOutTime: number;
  reviveHp: number;
  /** null = unlimited. */
  revivesPerCheckpoint: number | null;
}

export type VitalsChange = 'damaged' | 'downed' | 'died' | 'revived' | 'healed' | null;

export const MAX_HP = 100;
export const LOW_HP = 30;
/** Each point of damage taken while downed removes this many seconds of bleed-out. */
export const DOWNED_HIT_DRAIN = 0.15;

export class Vitals {
  hp = MAX_HP;
  state: VitalState = 'alive';
  /** Seconds left before a downed player dies. */
  bleed = 0;
  /** Revives used since the last checkpoint. */
  revivesUsed = 0;
  private readonly tuning: () => VitalsTuning;

  constructor(tuning: () => VitalsTuning) {
    this.tuning = tuning;
  }

  get low(): boolean {
    return this.state === 'alive' && this.hp <= LOW_HP;
  }

  get revivesLeft(): number | null {
    const limit = this.tuning().revivesPerCheckpoint;
    return limit === null ? null : Math.max(0, limit - this.revivesUsed);
  }

  /** Raw damage before difficulty scaling. Returns what changed. */
  damage(raw: number): VitalsChange {
    if (raw <= 0 || this.state === 'dead') return null;
    const t = this.tuning();
    const amount = raw * t.playerDamageTaken;
    if (this.state === 'downed') {
      this.bleed -= amount * DOWNED_HIT_DRAIN;
      return this.bleed <= 0 ? this.die() : 'damaged';
    }
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return 'damaged';
    if (this.revivesLeft === 0) return this.die();
    this.state = 'downed';
    this.bleed = t.bleedOutTime;
    return 'downed';
  }

  heal(amount: number): VitalsChange {
    if (this.state !== 'alive' || amount <= 0 || this.hp >= MAX_HP) return null;
    this.hp = Math.min(MAX_HP, this.hp + amount);
    return 'healed';
  }

  /** The medic's 3 s revive finished. */
  revive(): VitalsChange {
    if (this.state !== 'downed') return null;
    this.state = 'alive';
    this.hp = this.tuning().reviveHp;
    this.bleed = 0;
    this.revivesUsed++;
    return 'revived';
  }

  update(dt: number): VitalsChange {
    if (this.state !== 'downed') return null;
    this.bleed -= dt;
    return this.bleed <= 0 ? this.die() : null;
  }

  /** New checkpoint reached: the revive budget refills. */
  checkpoint(): void {
    this.revivesUsed = 0;
  }

  /** Fresh life (new game, load, restart). */
  reset(hp = MAX_HP): void {
    this.hp = Math.max(1, Math.min(MAX_HP, hp));
    this.state = 'alive';
    this.bleed = 0;
    this.revivesUsed = 0;
  }

  private die(): VitalsChange {
    this.state = 'dead';
    this.hp = 0;
    this.bleed = 0;
    return 'died';
  }
}
