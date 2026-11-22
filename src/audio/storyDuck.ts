import type { Priority } from '../data/types/dialogue.ts';

/** How far music and ambience drop under a story line (spec audio-mix: Story ducking). */
export const STORY_DUCK_DB = 4;

interface SpeechEvents {
  on(name: 'speech:started', fn: (e: { id: string; priority: Priority; audible?: boolean }) => void): () => void;
  on(name: 'speech:ended', fn: (e: { id: string }) => void): () => void;
  on(name: 'speech:audible', fn: (e: { id: string; priority: Priority; audible: boolean }) => void): () => void;
}

/**
 * Ducks music and ambience while at least one story line is playing. Barks (`combat`, `idle`)
 * and `hint` lines never duck. Overlapping story lines (a PA the squad talks over) keep the
 * duck until the last one ends. Lines that end without having started (dropped from the
 * queue) are ignored. Only story the player can hear ducks: a scene across the station leaves the music alone, and
 * ducks it once the player comes within earshot (dialogue-channels).
 */
export class StoryDucker {
  private readonly active = new Map<string, number>();
  /** Story lines playing out of earshot: they duck once heard. */
  private readonly unheard = new Set<string>();
  private readonly audio: { setDuck(db: number): void };
  private readonly db: number;
  private readonly off: Array<() => void>;

  constructor(events: SpeechEvents, audio: { setDuck(db: number): void }, db = STORY_DUCK_DB) {
    this.audio = audio;
    this.db = db;
    this.off = [
      events.on('speech:started', (e) => {
        if (e.priority !== 'story') return;
        if (e.audible === false) {
          this.unheard.add(e.id);
          return;
        }
        this.active.set(e.id, (this.active.get(e.id) ?? 0) + 1);
        this.apply();
      }),
      events.on('speech:audible', (e) => {
        if (e.priority !== 'story') return;
        if (e.audible && this.unheard.delete(e.id)) this.active.set(e.id, (this.active.get(e.id) ?? 0) + 1);
        else if (!e.audible && this.active.has(e.id)) {
          this.release(e.id);
          this.unheard.add(e.id);
        }
        this.apply();
      }),
      events.on('speech:ended', (e) => {
        this.unheard.delete(e.id);
        this.release(e.id);
        this.apply();
      }),
    ];
  }

  private release(id: string): void {
    const n = this.active.get(id);
    if (n === undefined) return;
    if (n <= 1) this.active.delete(id);
    else this.active.set(id, n - 1);
  }

  get ducked(): boolean {
    return this.active.size > 0;
  }

  /** Forget every active line and restore full level (title screen, restart). */
  reset(): void {
    this.active.clear();
    this.unheard.clear();
    this.apply();
  }

  dispose(): void {
    for (const f of this.off) f();
    this.reset();
  }

  private apply(): void {
    this.audio.setDuck(this.active.size > 0 ? this.db : 0);
  }
}
