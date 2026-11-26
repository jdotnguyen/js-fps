import { Rng } from '../core/rng.ts';
import type { OverheardData, OverheardExchange } from '../data/types/overheard.ts';

/**
 * The overheard director (in-world-audio spec): when Jay lingers by one of the voiced Commons pairs, they say a short
 * written exchange, one line after another, as `background` speech. One exchange at a time, once each per playthrough,
 * and it gives way to everything else. The pair's conversation group keeps their gaze but stops its silent filler
 * turns meanwhile.
 *
 * Pure logic driven by `update(dt)` over a small host interface, so it runs in node tests without bodies or audio.
 */

export const OVERHEARD_TUNING = {
  /** An exchange may start with the player this close to the pair (m). */
  startRange: 5,
  /** Beyond this (m) the line being said finishes and the rest is dropped. */
  leaveRange: 8,
  /** Seconds without a higher-priority line in earshot before one may start. */
  quiet: 2,
  /** Seconds after a pair's exchange before it may start another. */
  pairGap: 20,
  /** Pause between lines, seconds. */
  lineGap: [0.35, 0.8] as const,
} as const;

export interface OverheardHost {
  /** Queue a line on a conversation channel; its end or drop comes back through `lineOver`. */
  say(lineId: string, channel: string): void;
  /** Cut off a line now. */
  stop(lineId: string): void;
  /** The line's recording is decoded, so it will not fall back to a synthesized sound. */
  ready(lineId: string): boolean;
  flag(name: string): boolean;
  setFlag(name: string): void;
  /** The room the player stands in. */
  playerRoom(): string | null;
  /** Play is running and the player is not on rails, in a cutscene or held by a tutorial. */
  freeControl(): boolean;
  /** A scripted scene belonging to this room is running. */
  sceneRunning(room: string): boolean;
  /** A line above `background` is playing within earshot. */
  higherSpeech(): boolean;
  /** Metres from the player to a chat group, and whether all its members are free to talk. Null: no such group. */
  pair(chat: string): { distance: number; free: boolean } | null;
  /** Hold or release a chat group's silent filler turns. */
  suspend(chat: string, on: boolean): void;
}

export const heardFlag = (exchangeId: string): string => `heard_${exchangeId}`;
export const overheardChannel = (exchangeId: string): string => `overheard:${exchangeId}`;

interface Running {
  readonly exchange: OverheardExchange;
  /** Index of the line being said, or just said. */
  index: number;
  /** The line asked for and not over yet. */
  line: string | null;
  /** Seconds until the next line. */
  gap: number;
  /** The audience is gone: nothing after the current line. */
  leaving: boolean;
}

export class OverheardDirector {
  private readonly data: OverheardData;
  private readonly host: OverheardHost;
  private rng = new Rng('overheard');
  private running: Running | null = null;
  private quietFor: number = OVERHEARD_TUNING.quiet;
  private readonly cooldown = new Map<string, number>();

  constructor(data: OverheardData, host: OverheardHost) {
    this.data = data;
    this.host = host;
  }

  /** The chat group speaking an exchange now (its murmur makes way), or null. */
  get speakingChat(): string | null {
    return this.running?.exchange.chat ?? null;
  }

  /** The exchange running now (tests, debug). */
  get current(): string | null {
    return this.running?.exchange.id ?? null;
  }

  /** New game, load or death: forget the running exchange and the timers. What was heard lives in the game flags. */
  reset(): void {
    if (this.running) this.end();
    this.cooldown.clear();
    this.quietFor = OVERHEARD_TUNING.quiet;
    this.rng = new Rng('overheard');
  }

  update(dt: number): void {
    const higher = this.host.higherSpeech();
    this.quietFor = higher ? 0 : this.quietFor + dt;
    for (const [chat, left] of this.cooldown) {
      if (left <= dt) this.cooldown.delete(chat);
      else this.cooldown.set(chat, left - dt);
    }
    if (this.running) this.advance(dt, higher);
    else this.tryStart();
  }

  /** A line ended or was dropped. Anything but running its course ends the exchange. */
  lineOver(lineId: string, reason: string): void {
    const r = this.running;
    if (!r || r.line !== lineId) return;
    r.line = null;
    if (reason !== 'finished' || r.leaving || r.index + 1 >= r.exchange.lines.length) {
      this.end();
      return;
    }
    r.gap = this.rng.range(...OVERHEARD_TUNING.lineGap);
  }

  private advance(dt: number, higher: boolean): void {
    const r = this.running!;
    const pair = this.host.pair(r.exchange.chat);
    // Cut at once: the drop, a higher line in earshot (also between lines), or a speaker no longer free.
    if (this.host.flag('drop_started') || higher || !pair?.free) {
      this.abort();
      return;
    }
    if (this.host.playerRoom() !== this.data.room || pair.distance > OVERHEARD_TUNING.leaveRange) r.leaving = true;
    if (r.line !== null) return;
    if (r.leaving) {
      this.end();
      return;
    }
    r.gap -= dt;
    if (r.gap > 0) return;
    r.index++;
    this.sayCurrent();
  }

  private tryStart(): void {
    const h = this.host;
    if (this.quietFor < OVERHEARD_TUNING.quiet || h.flag('drop_started')) return;
    const phase = h.flag('briefingSeen') ? 'after' : h.flag('commons_free') ? 'before' : null;
    if (!phase) return;
    if (h.playerRoom() !== this.data.room || !h.freeControl() || h.sceneRunning(this.data.room)) return;
    let best: { exchange: OverheardExchange; distance: number } | null = null;
    const tried = new Set<string>();
    for (const x of this.data.exchanges) {
      // A pair's next exchange is the first it has not been heard saying, in the order listed.
      if (x.phase !== phase || tried.has(x.chat) || h.flag(heardFlag(x.id))) continue;
      tried.add(x.chat);
      if (this.cooldown.has(x.chat)) continue;
      const pair = h.pair(x.chat);
      if (!pair?.free || pair.distance > OVERHEARD_TUNING.startRange) continue;
      if (!x.lines.every((id) => h.ready(id))) continue;
      if (!best || pair.distance < best.distance) best = { exchange: x, distance: pair.distance };
    }
    if (!best) return;
    h.setFlag(heardFlag(best.exchange.id));
    h.suspend(best.exchange.chat, true);
    this.running = { exchange: best.exchange, index: 0, line: null, gap: 0, leaving: false };
    this.sayCurrent();
  }

  private sayCurrent(): void {
    const r = this.running!;
    const id = r.exchange.lines[r.index]!;
    r.line = id;
    // The line may be dropped inside `say`, which comes straight back through `lineOver`.
    this.host.say(id, overheardChannel(r.exchange.id));
  }

  private abort(): void {
    const line = this.running?.line ?? null;
    this.end();
    if (line !== null) this.host.stop(line);
  }

  private end(): void {
    const r = this.running;
    if (!r) return;
    this.running = null;
    this.cooldown.set(r.exchange.chat, OVERHEARD_TUNING.pairGap);
    this.host.suspend(r.exchange.chat, false);
  }
}
