/**
 * When the visor goes quiet (visor-hud design D9): after `CALM_AFTER` seconds of play with nothing happening and
 * nothing below full. The panels' own CSS eases the dimming.
 */

export const CALM_AFTER = 6;

export class CalmModel {
  private idle = 0;

  get dim(): boolean {
    return this.idle >= CALM_AFTER;
  }

  /** Something happened: a hit, a shot, a reload, a swap, a pickup. */
  wake(): void {
    this.idle = 0;
  }

  /** One step of `dt` seconds. `busy`: health, stamina or the magazine is below full, or Jay is sprinting. */
  step(busy: boolean, dt: number): void {
    // Capped, so a long quiet spell costs nothing to wake from and the sum stays exact.
    this.idle = busy ? 0 : Math.min(CALM_AFTER, this.idle + dt);
  }
}
