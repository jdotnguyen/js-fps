/**
 * What the player is allowed to do right now (ADR-0004 control API). Sequences push a
 * layer and release it on end or cancel; the effective state is the base with every
 * live layer applied in push order, so releasing any layer restores what was under it
 * even if layers end out of order.
 */
export type MoveMode = 'free' | 'slow' | 'locked';
export type LookMode = 'free' | 'clamped' | 'locked';

export interface ControlState {
  move: MoveMode;
  look: LookMode;
  weapons: boolean;
  flashlight: boolean;
  interact: boolean;
}

export const FREE_CONTROL: Readonly<ControlState> = Object.freeze({
  move: 'free',
  look: 'free',
  weapons: true,
  flashlight: true,
  interact: true,
});

/**
 * "On rails" (intro-sequence spec): the player cannot move on their own. Cutscene bars show while
 * this holds. A scripted walk counts too, so the caller passes whether one is active.
 */
export function isOnRails(state: Readonly<ControlState>, scriptedWalk: boolean): boolean {
  return state.move === 'locked' || scriptedWalk;
}

interface Layer {
  id: number;
  owner: string;
  over: Partial<ControlState>;
}

export class ControlStack {
  private base: ControlState = { ...FREE_CONTROL };
  private layers: Layer[] = [];
  private nextId = 1;
  private cached: ControlState | null = null;

  /** Effective control state. */
  get state(): Readonly<ControlState> {
    if (!this.cached) {
      const out = { ...this.base };
      for (const l of this.layers) Object.assign(out, l.over);
      this.cached = out;
    }
    return this.cached;
  }

  /** Change the base state (what remains when no sequence holds a layer). */
  set(over: Partial<ControlState>): void {
    Object.assign(this.base, over);
    this.cached = null;
  }

  /**
   * Temporarily override control. Returns a release function; calling it more than once
   * is harmless. `owner` names the sequence, for debugging.
   */
  push(over: Partial<ControlState>, owner = 'anonymous'): () => void {
    const id = this.nextId++;
    this.layers.push({ id, owner, over: { ...over } });
    this.cached = null;
    return () => {
      const before = this.layers.length;
      this.layers = this.layers.filter((l) => l.id !== id);
      if (this.layers.length !== before) this.cached = null;
    };
  }

  /** Drop every layer and restore free control (death, load, quit to title). */
  reset(): void {
    this.base = { ...FREE_CONTROL };
    this.layers = [];
    this.cached = null;
  }

  /** Owners of live layers, oldest first. */
  owners(): string[] {
    return this.layers.map((l) => l.owner);
  }
}
