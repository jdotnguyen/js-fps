import type { LoopHandle } from '../audio/engine.ts';
import { Rng } from '../core/rng.ts';

/**
 * Bram's brew (in-world-audio spec: Bram makes a brew, When a brew may start, A brew gives way): now and then, while Jay
 * is free in the Commons between the intro and the drop, he walks from his station to the coffee machine, works it with
 * its sound, and walks back. A script always wins: `interrupt` drops the trip where it stands.
 *
 * Pure logic driven by `update(dt)` over a small host interface, so it runs in node tests without bodies or audio.
 */

export const COOK_BREW_TUNING = {
  /** The NPC who brews. */
  npc: 'cook',
  /** Seconds of free time before the first brew, and between later ones. */
  firstWait: [30, 60] as const,
  wait: [120, 180] as const,
  /** Seconds he works the machine (the length of the recording). */
  brew: 8,
  /** Within this (m) of a spot counts as being there. */
  reach: 0.6,
  /** A walk that has not arrived after this long (s) is abandoned. */
  walkLimit: 12,
  /** Pause (s) before another try at walking home. */
  retry: 2,
  walkSpeed: 1.05,
  /** Level and room send of the machine's recording, played from the machine. */
  sound: { gain: 0.55, reverb: 0.2 },
} as const;

type Point = { readonly x: number; readonly y: number; readonly z: number };

export interface Spot {
  readonly pos: Point;
  readonly yaw: number;
}

/** What the routine does with the body it walks about (`NpcDirector.routineBody`). */
export interface RoutineBody {
  /** Alive, and no walk, animation or offer is running. */
  free(): boolean;
  feet(): { readonly x: number; readonly z: number } | null;
  /** Walk to `pos` facing `yaw`; `onDone` when the walk finishes or is cancelled. */
  walk(pos: Point, yaw: number, speed: number, onDone: () => void): void;
  /** Stop walking where he is. */
  stop(): void;
  /** Take up a held pose. */
  pose(name: string): void;
  /** Back to standing idle. */
  rest(): void;
}

export interface CookBrewHost {
  readonly cook: RoutineBody;
  introOver(): boolean;
  /** The drop has started: no more brews. */
  over(): boolean;
  /** Jay is in the Commons with free control. */
  playerFree(): boolean;
  /** A line is audible or an overheard exchange is being said. */
  talking(): boolean;
  /** A scripted Commons scene is running. */
  sceneRunning(): boolean;
  /** The machine's recording is decoded: he never works a silent machine. */
  soundReady(): boolean;
  playSound(): LoopHandle;
}

export type BrewState = 'waiting' | 'out' | 'brewing' | 'back';

export class CookBrew {
  private readonly host: CookBrewHost;
  private readonly station: Spot;
  private readonly machine: Spot;
  private rng = new Rng('cook-brew');
  private _state: BrewState = 'waiting';
  /** Free seconds left before the next brew is due. */
  private wait: number;
  /** Seconds in the current walk or at the machine. */
  private t = 0;
  /** The current walk has ended; `trip` makes a cancelled walk's late callback harmless. */
  private walkOver = false;
  private trip = 0;
  private sound: LoopHandle | null = null;

  constructor(host: CookBrewHost, station: Spot, machine: Spot) {
    this.host = host;
    this.station = station;
    this.machine = machine;
    this.wait = this.rng.range(...COOK_BREW_TUNING.firstWait);
  }

  /** Tests and debug. */
  get state(): BrewState {
    return this._state;
  }

  /** Bram is at his station with nothing to do (the kitchen is heard only then). */
  atStation(): boolean {
    return this._state === 'waiting' && this.host.cook.free() && this.isAt(this.station);
  }

  update(dt: number): void {
    const h = this.host;
    if (this._state === 'waiting') {
      if (h.over() || !h.introOver() || !h.playerFree()) return;
      this.wait -= dt;
      if (this.wait > 0 || h.talking() || h.sceneRunning() || !h.soundReady() || !this.atStation()) return;
      this.walk('out', this.machine);
      return;
    }
    this.t += dt;
    if (this._state !== 'back' && h.over()) {
      this.goHome();
      return;
    }
    switch (this._state) {
      case 'out':
        if (this.walkOver && this.isAt(this.machine)) {
          this._state = 'brewing';
          this.t = 0;
          h.cook.pose('typing');
          this.sound = h.playSound();
        } else if (this.walkOver || this.t >= COOK_BREW_TUNING.walkLimit) {
          this.goHome();
        }
        break;
      case 'brewing':
        if (this.t >= COOK_BREW_TUNING.brew) {
          // The clip has run its length: leave its tail alone.
          this.sound = null;
          this.goHome();
        }
        break;
      case 'back':
        if (this.walkOver && this.isAt(this.station)) {
          this.finish();
        } else if (this.walkOver) {
          // Ended short (something in the way): try again after a pause.
          if (this.t >= COOK_BREW_TUNING.retry) this.walk('back', this.station);
        } else if (this.t >= COOK_BREW_TUNING.walkLimit) {
          this.trip++;
          h.cook.stop();
          this.walkOver = true;
          this.t = 0;
        }
        break;
    }
  }

  /** A script is about to command `npc`: if it is Bram, drop the trip and leave the rest to the script. */
  interrupt(npc: string): void {
    if (npc !== COOK_BREW_TUNING.npc || this._state === 'waiting') return;
    this.silence();
    this.trip++;
    this.host.cook.stop();
    this.host.cook.rest();
    this.finish();
  }

  /** New game, load, death or the title screen: the level puts Bram where he belongs. */
  reset(): void {
    this.silence();
    this.trip++;
    this._state = 'waiting';
    this.rng = new Rng('cook-brew');
    this.wait = this.rng.range(...COOK_BREW_TUNING.firstWait);
  }

  private finish(): void {
    this._state = 'waiting';
    this.wait = this.rng.range(...COOK_BREW_TUNING.wait);
  }

  private goHome(): void {
    this.silence();
    this.host.cook.stop();
    this.host.cook.rest();
    this.walk('back', this.station);
  }

  private walk(state: 'out' | 'back', to: Spot): void {
    this._state = state;
    this.t = 0;
    this.walkOver = false;
    const trip = ++this.trip;
    this.host.cook.walk(to.pos, to.yaw, COOK_BREW_TUNING.walkSpeed, () => {
      if (this.trip !== trip) return;
      this.walkOver = true;
      this.t = 0;
    });
  }

  private silence(): void {
    this.sound?.stop(0.15);
    this.sound = null;
  }

  private isAt(spot: Spot): boolean {
    const p = this.host.cook.feet();
    return !!p && Math.hypot(p.x - spot.pos.x, p.z - spot.pos.z) <= COOK_BREW_TUNING.reach;
  }
}
