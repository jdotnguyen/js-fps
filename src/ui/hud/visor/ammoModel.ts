/**
 * The weapon panel's pips (visor-hud design D3, D6): how many are filled, and the reload and dry-fire animations over
 * them. The weapon's own counts are the truth; events only start an animation, and when one ends or is cancelled the
 * pips return to those counts. It counts only the time it is given.
 */

/** What the model reads off the held weapon each step. `reloading` false ends a refill the weapon has dropped. */
export interface AmmoPoll {
  name: string;
  loaded: number;
  reserve: number;
  mag: number;
  reloading?: boolean;
}

export type ReloadMode = 'none' | 'pistol' | 'shotgun';

/** Share of a magazine reload spent clearing the pips; the rest refills them. */
export const CLEAR_SHARE = 0.15;
/** How long past its length a magazine reload may hold full without a word from the weapon. */
export const RELOAD_GRACE = 0.5;
/** Seconds `EMPTY` stays up after a dry fire. */
export const ALERT_SECONDS = 1.5;

/** A quarter of the magazine or less, but not nothing. */
export function isLow(loaded: number, mag: number): boolean {
  return loaded > 0 && loaded <= Math.ceil(mag / 4);
}

export class AmmoModel {
  /** Filled pips. */
  shown = 0;
  reload: ReloadMode = 'none';
  /** Seconds of the dry-fire alert left. */
  alert = 0;
  private name = '';
  private loaded = 0;
  private reserve = 0;
  private mag = 0;
  private t = 0;
  private duration = 0;
  private from = 0;
  private target = 0;

  /** Show the weapon as it is: the first frame, a swap, a load, a restore. */
  snap(poll: AmmoPoll): void {
    this.name = poll.name;
    this.loaded = this.shown = poll.loaded;
    this.reserve = poll.reserve;
    this.mag = poll.mag;
    this.reload = 'none';
    this.alert = 0;
  }

  /** One step of `dt` seconds. Returns the rounds picked up since the last step, for the `+N`, or 0. */
  step(poll: AmmoPoll, dt: number): number {
    if (poll.name !== this.name) {
      this.snap(poll);
      return 0;
    }
    // A reload only ever takes from the reserve, so a rise is a pickup.
    const gained = Math.max(0, poll.reserve - this.reserve);
    if (poll.loaded > this.loaded) this.alert = 0;
    this.loaded = poll.loaded;
    this.reserve = poll.reserve;
    this.alert = Math.max(0, this.alert - dt);
    if (this.reload !== 'none' && poll.reloading === false) this.reload = 'none';
    if (this.reload === 'pistol') {
      this.t += dt;
      if (this.t > this.duration + RELOAD_GRACE) this.reload = 'none';
      else this.shown = this.refill();
    }
    // A shotgun's counts rise shell by shell, so the pips follow them.
    if (this.reload !== 'pistol') this.shown = poll.loaded;
    return gained;
  }

  /** A shot left the weapon. Returns the pip that just emptied. */
  fired(): number {
    this.reload = 'none';
    this.alert = 0;
    this.shown = Math.max(0, this.shown - 1);
    return this.shown;
  }

  dryFire(): void {
    this.alert = ALERT_SECONDS;
  }

  /** `duration`: the length of a magazine reload; without one the weapon loads shell by shell. */
  reloadStart(duration?: number): void {
    this.alert = 0;
    if (duration === undefined || duration <= 0) {
      this.reload = 'shotgun';
      return;
    }
    this.reload = 'pistol';
    this.t = 0;
    this.duration = duration;
    this.from = this.shown;
    this.target = Math.min(this.mag, this.loaded + this.reserve);
  }

  /** A shell seated. Returns the pip it filled. */
  shellInsert(): number {
    this.shown = Math.min(this.mag, this.shown + 1);
    return this.shown - 1;
  }

  /** The reload ended, finished or broken off, with this many loaded. */
  reloaded(loaded: number): void {
    this.reload = 'none';
    this.loaded = this.shown = loaded;
  }

  /** The weapon changed: whatever was animating is over. The next step reads the new one. */
  equipped(): void {
    this.reload = 'none';
    this.alert = 0;
    this.name = '';
  }

  private refill(): number {
    const clear = this.duration * CLEAR_SHARE;
    if (this.t < clear) return Math.round(this.from * (1 - this.t / clear));
    const share = Math.min(1, (this.t - clear) / (this.duration - clear));
    return Math.floor(this.target * share + 1e-9);
  }
}
