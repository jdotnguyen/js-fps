import type { Priority } from '../data/types/dialogue.ts';

/** How far music and ambience drop under a story line (spec audio-mix: Story ducking). */
export const STORY_DUCK_DB = 4;

interface SpeechEvents {
  on(name: 'speech:started', fn: (e: { id: string; priority: Priority }) => void): () => void;
  on(name: 'speech:ended', fn: (e: { id: string }) => void): () => void;
}

/**
 * Ducks music and ambience while at least one story line is playing. Barks (`combat`, `idle`)
 * and `hint` lines never duck. Overlapping story lines (a PA the squad talks over) keep the
 * duck until the last one ends. Lines that end without having started (dropped from the
 * queue) are ignored.
 */
export class StoryDucker {
  private readonly active = new Map<string, number>();
  private readonly audio: { setDuck(db: number): void };
  private readonly db: number;
  private readonly off: Array<() => void>;

  constructor(events: SpeechEvents, audio: { setDuck(db: number): void }, db = STORY_DUCK_DB) {
    this.audio = audio;
    this.db = db;
    this.off = [
      events.on('speech:started', (e) => {
        if (e.priority !== 'story') return;
        this.active.set(e.id, (this.active.get(e.id) ?? 0) + 1);
        this.apply();
      }),
      events.on('speech:ended', (e) => {
        const n = this.active.get(e.id);
        if (n === undefined) return;
        if (n <= 1) this.active.delete(e.id);
        else this.active.set(e.id, n - 1);
        this.apply();
      }),
    ];
  }

  get ducked(): boolean {
    return this.active.size > 0;
  }

  /** Forget every active line and restore full level (title screen, restart). */
  reset(): void {
    this.active.clear();
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
