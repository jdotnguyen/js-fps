import { COMMONS_OPEN_FLAG } from '../audio/commonsSounds.ts';
import { Rng } from '../core/rng.ts';
import type { OverheardData, OverheardExchange } from '../data/types/overheard.ts';

/**
 * Multi-room overheard director (in-world-audio spec): when Jay lingers by a voiced conversation group
 * or a working solo NPC during the quiet half, they say a short written exchange or work snippet as
 * `background` speech. One item plays at a time, once each per playthrough, and it gives way to
 * everything else. For chat groups, filler turns pause while mutual gaze continues; solo snippets act
 * on that NPC's body without pulling bystanders' gaze.
 *
 * Pure logic driven by `update(dt)` over a small host interface, so it runs in node tests without bodies or audio.
 */

export const OVERHEARD_TUNING = {
  /** An exchange or solo snippet may start with the player this close (m). */
  startRange: 5,
  /** Beyond this (m) the line being said finishes and the rest is dropped. */
  leaveRange: 8,
  /** Seconds without a higher-priority line in earshot before one may start. */
  quiet: 2,
  /** Seconds after a group or solo speaker finishes before they may start another. */
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
  /** Metres from the player to a solo NPC, and whether they are free to talk. Optional for group-only test hosts. */
  solo?(npcId: string): { distance: number; free: boolean } | null;
  /** Hold or release a chat group's silent filler turns. */
  suspend(chat: string, on: boolean): void;
}

export const heardFlag = (exchangeId: string): string => `heard_${exchangeId}`;
export const overheardChannel = (exchangeId: string): string => `overheard:${exchangeId}`;

interface Running {
  readonly exchange: OverheardExchange;
  readonly room: string;
  readonly ownerKey: string;
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

  /** The chat group speaking an exchange now (its murmur makes way), or null for none / solo snippet. */
  get speakingChat(): string | null {
    return this.running?.exchange.chat ?? null;
  }

  /** The exchange or solo snippet running now (tests, debug). */
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
    for (const [key, left] of this.cooldown) {
      if (left <= dt) this.cooldown.delete(key);
      else this.cooldown.set(key, left - dt);
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

  private roomOf(x: OverheardExchange): string {
    return x.room ?? this.data.room;
  }

  private ownerKeyOf(x: OverheardExchange): string {
    return x.chat ? `chat:${x.chat}` : `solo:${x.speaker!}`;
  }

  private targetOf(x: OverheardExchange): { distance: number; free: boolean } | null {
    if (x.chat) return this.host.pair(x.chat);
    if (x.speaker) return this.host.solo?.(x.speaker) ?? null;
    return null;
  }

  private eligibleByFlags(x: OverheardExchange): boolean {
    const h = this.host;
    const open = h.flag(COMMONS_OPEN_FLAG) || h.flag('commons_free');
    if (x.phase !== undefined) {
      const phase = h.flag('briefingSeen') ? 'after' : open ? 'before' : null;
      if (x.phase !== phase) return false;
    } else if (!open) {
      return false;
    }
    if (x.requires && !x.requires.every((f) => h.flag(f))) return false;
    if (x.unless && x.unless.some((f) => h.flag(f))) return false;
    return true;
  }

  private advance(dt: number, higher: boolean): void {
    const r = this.running!;
    const target = this.targetOf(r.exchange);
    // Cut at once: the drop, a higher line in earshot (also between lines), or a speaker no longer free.
    if (this.host.flag('drop_started') || higher || !target?.free) {
      this.abort();
      return;
    }
    if (this.host.playerRoom() !== r.room || target.distance > OVERHEARD_TUNING.leaveRange) r.leaving = true;
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
    const room = h.playerRoom();
    if (!room || !h.freeControl() || h.sceneRunning(room)) return;
    let best: { exchange: OverheardExchange; room: string; ownerKey: string; distance: number } | null = null;
    const tried = new Set<string>();
    for (const x of this.data.exchanges) {
      if (this.roomOf(x) !== room) continue;
      if (!this.eligibleByFlags(x)) continue;
      const ownerKey = this.ownerKeyOf(x);
      // An owner's next exchange is the first it has not been heard saying, in the order listed.
      if (tried.has(ownerKey) || h.flag(heardFlag(x.id))) continue;
      tried.add(ownerKey);
      if (this.cooldown.has(ownerKey)) continue;
      const target = this.targetOf(x);
      if (!target?.free || target.distance > OVERHEARD_TUNING.startRange) continue;
      if (!x.lines.every((id) => h.ready(id))) continue;
      if (!best || target.distance < best.distance) best = { exchange: x, room, ownerKey, distance: target.distance };
    }
    if (!best) return;
    h.setFlag(heardFlag(best.exchange.id));
    if (best.exchange.chat) h.suspend(best.exchange.chat, true);
    this.running = { exchange: best.exchange, room: best.room, ownerKey: best.ownerKey, index: 0, line: null, gap: 0, leaving: false };
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
    this.cooldown.set(r.ownerKey, OVERHEARD_TUNING.pairGap);
    if (r.exchange.chat) this.host.suspend(r.exchange.chat, false);
  }
}
