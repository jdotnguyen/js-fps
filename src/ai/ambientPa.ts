import { Rng } from '../core/rng.ts';
import type { StationPhase } from '../audio/ambience.ts';

/**
 * Ambient Station PA director (in-world-audio & dialogue-channels specs): plays periodic, non-repeating
 * `background`-priority PA announcements from the wall `pa_speaker` grille serving the player's area.
 * Morning shift plays routine TAG corporate/operational notices (75–150 s); lockdown/blackout plays
 * sparse degraded automated warnings (120–210 s). Yields immediately to story, combat, and overheard talk.
 */

export const AMBIENT_PA_TUNING = {
  morningInterval: [75, 150] as const,
  darkInterval: [120, 210] as const,
  /** Initial delay after entering free control so an announcement does not fire instantly. */
  firstMorningDelay: [35, 75] as const,
  firstDarkDelay: [50, 95] as const,
  /** Seconds without foreground speech before an announcement may start. */
  quiet: 3,
  /** Maximum metres to the nearest wall PA grille for an ambient announcement to fire. */
  maxGrilleRange: 12,
} as const;

export const AMBIENT_PA_CHANNEL = 'ambient:pa';

export interface AmbientPaHost {
  say(lineId: string, channel: string): void;
  stop(lineId: string): void;
  ready(lineId: string): boolean;
  phase(): StationPhase;
  introOver(): boolean;
  freeControl(): boolean;
  inCombat(): boolean;
  playerRoom(): string | null;
  sceneRunning(room: string): boolean;
  higherSpeech(): boolean;
  overheardRunning(): boolean;
  /** Distance (m) to the PA speaker serving the player's area, or null if none exists. */
  grilleDistance(): number | null;
}

export interface AmbientPaPools {
  readonly morning: readonly string[];
  readonly dark: readonly string[];
}

export class AmbientPaDirector {
  private readonly pools: AmbientPaPools;
  private readonly host: AmbientPaHost;
  private rng = new Rng('ambient-pa');
  private morningDeck: string[] = [];
  private darkDeck: string[] = [];
  private lastBucket: 'morning' | 'dark' | null = null;
  private nextIn: number;
  private quietFor: number = AMBIENT_PA_TUNING.quiet;
  private activeLine: string | null = null;

  constructor(pools: AmbientPaPools, host: AmbientPaHost) {
    this.pools = pools;
    this.host = host;
    this.nextIn = this.rng.range(...AMBIENT_PA_TUNING.firstMorningDelay);
  }

  /** Line currently playing, or null (tests, debug). */
  get current(): string | null {
    return this.activeLine;
  }

  reset(): void {
    if (this.activeLine !== null) {
      const id = this.activeLine;
      this.activeLine = null;
      this.host.stop(id);
    }
    this.rng = new Rng('ambient-pa');
    this.morningDeck = [];
    this.darkDeck = [];
    this.lastBucket = null;
    this.quietFor = AMBIENT_PA_TUNING.quiet;
    this.nextIn = this.rng.range(...AMBIENT_PA_TUNING.firstMorningDelay);
  }

  lineOver(lineId: string): void {
    if (this.activeLine !== lineId) return;
    this.activeLine = null;
    this.scheduleNext(this.bucket());
  }

  update(dt: number): void {
    const higher = this.host.higherSpeech();
    this.quietFor = higher ? 0 : this.quietFor + dt;

    const bucket = this.bucket();
    if (this.lastBucket !== null && bucket !== this.lastBucket) {
      // Phase crossed the drop boundary: abort any morning notice and pace for the new mood.
      if (this.activeLine !== null) {
        const id = this.activeLine;
        this.activeLine = null;
        this.host.stop(id);
      }
      const delay = bucket === 'morning' ? AMBIENT_PA_TUNING.firstMorningDelay : AMBIENT_PA_TUNING.firstDarkDelay;
      this.nextIn = this.rng.range(delay[0], delay[1]);
    }
    this.lastBucket = bucket;

    if (this.activeLine !== null) {
      if (higher || this.host.inCombat() || !this.host.freeControl()) {
        const id = this.activeLine;
        this.activeLine = null;
        this.host.stop(id);
        this.scheduleNext(bucket);
      }
      return;
    }

    if (!this.host.introOver() || !this.host.freeControl() || this.host.inCombat()) return;

    this.nextIn -= dt;
    if (this.nextIn > 0) return;

    // Defer cleanly without thrashing if speech, a room scene, or overheard talk is active.
    const room = this.host.playerRoom();
    if (
      this.quietFor < AMBIENT_PA_TUNING.quiet ||
      this.host.overheardRunning() ||
      !room ||
      this.host.sceneRunning(room)
    ) {
      this.nextIn = 4;
      return;
    }

    const dist = this.host.grilleDistance();
    if (dist === null || dist > AMBIENT_PA_TUNING.maxGrilleRange) {
      this.nextIn = 10;
      return;
    }

    const id = this.draw(bucket);
    if (!id) {
      this.scheduleNext(bucket);
      return;
    }
    this.activeLine = id;
    this.host.say(id, AMBIENT_PA_CHANNEL);
  }

  private bucket(): 'morning' | 'dark' {
    return this.host.phase() === 'morning' ? 'morning' : 'dark';
  }

  private scheduleNext(bucket: 'morning' | 'dark'): void {
    const range = bucket === 'morning' ? AMBIENT_PA_TUNING.morningInterval : AMBIENT_PA_TUNING.darkInterval;
    this.nextIn = this.rng.range(range[0], range[1]);
  }

  private draw(bucket: 'morning' | 'dark'): string | null {
    const source = bucket === 'morning' ? this.pools.morning : this.pools.dark;
    if (source.length === 0) return null;
    const deck = bucket === 'morning' ? this.morningDeck : this.darkDeck;
    if (deck.length === 0) {
      const shuffled = [...source];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng.next() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      deck.push(...shuffled);
    }
    for (let i = 0; i < deck.length; i++) {
      const candidate = deck[i]!;
      if (this.host.ready(candidate)) {
        deck.splice(i, 1);
        return candidate;
      }
    }
    return null;
  }
}
