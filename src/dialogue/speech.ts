/**
 * Speech manager: one voice at a time, with subtitles.
 *
 * Priorities: story > hint > combat > idle. A higher priority interrupts the current
 * line; equal or lower waits in the queue. Lines said with `overlap: true` (a PA notice
 * the squad talks over, intro-sequence spec) skip the queue and play alongside it on their own lane.
 * combat/idle lines are dropped instead of
 * waiting more than `maxWait` seconds, so stale barks never play late.
 *
 * Pure logic driven by `update(dt)`; sound goes through a `VoicePlayer`, so it is
 * Node-testable with a fake player.
 */
import type { EventBus } from '../core/events.ts';
import { priorityRank, type Channel, type DialogueLine, type Emote, type Priority, type VoiceProfile } from '../data/types/dialogue.ts';
import { subtitleDuration, type DialogueLibrary } from './library.ts';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type EndReason = 'finished' | 'interrupted' | 'dropped' | 'stopped';

export interface SpeechInfo {
  id: string;
  speaker: string;
  /** Display name for the subtitle. */
  name: string;
  text: string;
  /** Tone of the line, for acting it: null when the line only has recorded audio. */
  emote: Emote | null;
  channel: Channel;
  priority: Priority;
  /** Seconds the subtitle stays up. */
  duration: number;
}

declare module '../core/events.ts' {
  interface EventMap {
    'speech:started': SpeechInfo;
    'speech:ended': { id: string; speaker: string; reason: EndReason };
    'speech:dropped': { id: string; speaker: string; waited: number };
    /** HUD contract (ADR-0012): show/hide one subtitle. */
    'subtitle:show': SpeechInfo;
    'subtitle:hide': { id: string };
  }
}

export interface SayOptions {
  /** World position of the speaker's head, read every frame for `local` lines. */
  at?: () => Vec3Like;
  /** Play now on the overlap lane, beside whatever is speaking, without queuing (intro-sequence spec). */
  overlap?: boolean;
}

export interface PlayRequest {
  line: DialogueLine;
  profile: VoiceProfile;
  at: (() => Vec3Like) | undefined;
  /** Runtime rasp override for this speaker, or null to use the profile. */
  rasp: number | null;
  babble: boolean;
}

export interface VoicePlayback {
  /** Seconds of audio, if longer than the subtitle should be (real VO files). */
  readonly duration?: number;
  /** Per frame (moves positional voices). */
  update?(): void;
  /** `interrupted` true = cut off; false = line ran its course. */
  stop(interrupted: boolean): void;
}

export interface VoicePlayer {
  play(req: PlayRequest): VoicePlayback;
}

export interface SpeechHandle {
  readonly id: string;
  readonly done: Promise<EndReason>;
}

interface Entry {
  line: DialogueLine;
  profile: VoiceProfile;
  opts: SayOptions;
  duration: number;
  enqueuedAt: number;
  seq: number;
  handle: SpeechHandle;
  resolve: (r: EndReason) => void;
}

interface Active extends Entry {
  playback: VoicePlayback;
  endsAt: number;
}

export interface SpeechOptions {
  /** Silence between consecutive lines, seconds [Assumed]. */
  gap?: number;
  /** combat/idle lines are dropped rather than wait longer than this (2 s). */
  maxWait?: number;
}

const DROPPABLE: ReadonlySet<Priority> = new Set(['combat', 'idle']);

export class SpeechManager {
  private readonly bus: EventBus;
  private readonly library: DialogueLibrary;
  private readonly player: VoicePlayer;
  private readonly gap: number;
  private readonly maxWait: number;
  private readonly rasp = new Map<string, number>();
  private queue: Entry[] = [];
  private current: Active | null = null;
  private overlaps: Active[] = [];
  private now = 0;
  private nextStartAt = 0;
  private seq = 0;
  /** Global babble setting (off by default [Assumed]); a line's own `babble` wins when set. */
  babble = false;

  constructor(bus: EventBus, library: DialogueLibrary, player: VoicePlayer, opts: SpeechOptions = {}) {
    this.bus = bus;
    this.library = library;
    this.player = player;
    this.gap = opts.gap ?? 0.2;
    this.maxWait = opts.maxWait ?? 2;
  }

  /** Queue or play a line by id. Resolves when it finishes, is cut off or dropped. */
  say(id: string, opts: SayOptions = {}): SpeechHandle {
    if (this.current?.line.id === id) return this.current.handle;
    const overlapping = this.overlaps.find((e) => e.line.id === id);
    if (overlapping) return overlapping.handle;
    const queued = this.queue.find((e) => e.line.id === id);
    if (queued) return queued.handle;

    const line = this.library.line(id);
    const profile = this.library.speaker(line.speaker);
    let resolve!: (r: EndReason) => void;
    const done = new Promise<EndReason>((r) => (resolve = r));
    const entry: Entry = {
      line, profile, opts, resolve,
      duration: subtitleDuration(line.text, line.minDuration),
      enqueuedAt: this.now,
      seq: this.seq++,
      handle: { id, done },
    };

    if (opts.overlap) {
      this.startOverlap(entry);
      return entry.handle;
    }

    const cur = this.current;
    if (cur && priorityRank(line.priority) > priorityRank(cur.line.priority)) {
      this.finishCurrent('interrupted');
      this.start(entry);
      return entry.handle;
    }
    if (!cur && this.queue.length === 0 && this.now >= this.nextStartAt) {
      this.start(entry);
      return entry.handle;
    }
    if (DROPPABLE.has(line.priority) && this.predictedWait(entry) > this.maxWait) {
      this.drop(entry);
      return entry.handle;
    }
    this.queue.push(entry);
    this.sortQueue();
    return entry.handle;
  }

  update(dt: number): void {
    this.now += dt;
    const cur = this.current;
    if (cur) {
      cur.playback.update?.();
      if (this.now >= cur.endsAt) this.finishCurrent('finished');
    }
    for (const o of [...this.overlaps]) {
      o.playback.update?.();
      if (this.now >= o.endsAt) this.finishOverlap(o, 'finished');
    }
    // Stale barks are dropped rather than played late.
    for (const e of [...this.queue]) {
      if (DROPPABLE.has(e.line.priority) && this.now - e.enqueuedAt > this.maxWait) {
        this.queue.splice(this.queue.indexOf(e), 1);
        this.drop(e);
      }
    }
    if (!this.current && this.now >= this.nextStartAt) {
      const next = this.queue.shift();
      if (next) this.start(next);
    }
  }

  /** Stop the current line and clear the queue (pause menu, checkpoint reload, cutscene skip). */
  stopAll(): void {
    for (const e of this.queue.splice(0)) this.end(e, 'stopped');
    for (const o of [...this.overlaps]) this.finishOverlap(o, 'stopped');
    if (this.current) this.finishCurrent('stopped');
  }

  /** Stop one line if it is playing or queued. */
  stop(id: string): void {
    if (this.current?.line.id === id) {
      this.finishCurrent('stopped');
      return;
    }
    const o = this.overlaps.find((e) => e.line.id === id);
    if (o) {
      this.finishOverlap(o, 'stopped');
      return;
    }
    const i = this.queue.findIndex((e) => e.line.id === id);
    if (i >= 0) this.end(this.queue.splice(i, 1)[0]!, 'stopped');
  }

  /** Runtime voice roughness for a speaker, 0..1 (Giles's foreshadowing). null resets. */
  setRasp(speaker: string, amount: number | null): void {
    if (amount === null) this.rasp.delete(speaker);
    else this.rasp.set(speaker, Math.min(1, Math.max(0, amount)));
  }

  /** What is speaking now, if anything (hints check this so they never talk over story). */
  speaking(): SpeechInfo | null {
    return this.current ? this.info(this.current) : null;
  }

  queuedIds(): string[] {
    return this.queue.map((e) => e.line.id);
  }

  // ---------------------------------------------------------------- internals

  private start(e: Entry): void {
    const active = this.begin(e);
    this.current = active;
  }

  /** Overlap lane: plays at once, never waits, never blocks the queue. */
  private startOverlap(e: Entry): void {
    this.overlaps.push(this.begin(e));
  }

  private finishOverlap(o: Active, reason: EndReason): void {
    const i = this.overlaps.indexOf(o);
    if (i < 0) return;
    this.overlaps.splice(i, 1);
    o.playback.stop(reason !== 'finished');
    this.bus.emit('subtitle:hide', { id: o.line.id });
    this.end(o, reason);
  }

  private begin(e: Entry): Active {
    const playback = this.player.play({
      line: e.line,
      profile: e.profile,
      at: e.opts.at,
      rasp: this.rasp.get(e.line.speaker) ?? null,
      babble: e.line.babble ?? this.babble,
    });
    const duration = Math.max(e.duration, playback.duration ?? 0);
    const active: Active = { ...e, duration, playback, endsAt: this.now + duration };
    const info = this.info(active);
    this.bus.emit('speech:started', info);
    this.bus.emit('subtitle:show', info);
    return active;
  }

  private finishCurrent(reason: EndReason): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    cur.playback.stop(reason !== 'finished');
    this.bus.emit('subtitle:hide', { id: cur.line.id });
    this.end(cur, reason);
    this.nextStartAt = reason === 'interrupted' ? this.now : this.now + this.gap;
  }

  private drop(e: Entry): void {
    this.bus.emit('speech:dropped', { id: e.line.id, speaker: e.line.speaker, waited: this.now - e.enqueuedAt });
    e.resolve('dropped');
  }

  private end(e: Entry, reason: EndReason): void {
    this.bus.emit('speech:ended', { id: e.line.id, speaker: e.line.speaker, reason });
    e.resolve(reason);
  }

  /** Seconds until `e` would start if appended now. */
  private predictedWait(e: Entry): number {
    const rank = priorityRank(e.line.priority);
    let wait = this.current ? this.current.endsAt - this.now + this.gap : Math.max(0, this.nextStartAt - this.now);
    for (const q of this.queue) if (priorityRank(q.line.priority) >= rank) wait += q.duration + this.gap;
    return wait;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => priorityRank(b.line.priority) - priorityRank(a.line.priority) || a.seq - b.seq);
  }

  private info(e: Entry): SpeechInfo {
    return {
      id: e.line.id,
      speaker: e.line.speaker,
      name: e.profile.name,
      text: e.line.text,
      emote: e.line.emote,
      channel: e.line.channel,
      priority: e.line.priority,
      duration: e.duration,
    };
  }
}
