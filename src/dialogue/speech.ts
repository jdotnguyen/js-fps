/**
 * Speech manager: lines on channels, with subtitles (spec dialogue-channels).
 *
 * Each conversation speaks on its own channel (a sequence run passes its run as the channel). A channel says one
 * line at a time, in order, with a short gap; separate channels play at the same time. Within a channel the
 * priorities are story > hint > combat > idle: a higher priority interrupts, equal or lower waits. Across channels:
 * - a speaker never talks over themself: their line waits for the one they are saying elsewhere;
 * - Jay's line is dropped when the rest of its conversation is out of earshot (he answers the scene he can hear).
 *   A scene tied to a room does not rely on this: it ends whole when the player leaves (`stopChannel`, scene-presence);
 * - barks and hints wait while a story line the player can hear is playing, and a story line starting in earshot cuts
 *   off a bark or hint the player can hear.
 * `overlap: true` lines (a PA the squad talks over, a victim's voice) get a channel of their own and start at once.
 * combat/idle lines are dropped instead of waiting more than `maxWait` seconds, so stale barks never play late.
 *
 * How each line reaches the player comes from an injected `hearing` function (voice-playback: Voices carry through
 * the station); it drives the voice's gain and tone every frame and whether its subtitle shows (within 20 m and
 * audible, or always for radio and PA).
 *
 * Pure logic driven by `update(dt)`; sound goes through a `VoicePlayer`, so it is Node-testable with a fake player.
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
  /** Optional explicit addressee ('player', an NPC id, or a speaker id) for speaker gaze. */
  to?: string;
  /** Display name for the subtitle. */
  name: string;
  text: string;
  /** Tone of the line, for acting it: null when the line only has recorded audio. */
  emote: Emote | null;
  channel: Channel;
  priority: Priority;
  /** Seconds the subtitle stays up (on `subtitle:show`, the seconds left of the line). */
  duration: number;
  /** Whether the player can hear it now (dialogue-channels: Earshot). Absent means yes. */
  audible?: boolean;
}

declare module '../core/events.ts' {
  interface EventMap {
    'speech:started': SpeechInfo;
    'speech:ended': { id: string; speaker: string; reason: EndReason };
    'speech:dropped': { id: string; speaker: string; waited: number };
    /** A playing line came into or went out of earshot. */
    'speech:audible': { id: string; priority: Priority; audible: boolean };
    /** HUD contract (ADR-0012): show/hide one subtitle. */
    'subtitle:show': SpeechInfo;
    'subtitle:hide': { id: string };
  }
}

export interface SayOptions {
  /** Read at playback start for a PA fixture, or per frame for a local speaker. */
  at?: () => Vec3Like | null;
  /** Play now on a channel of its own, beside whatever is speaking, without queuing (intro-sequence spec). */
  overlap?: boolean;
  /** Override the line's addressee for speaker gaze ('player', an NPC id, or a speaker id). */
  to?: string;
  /** The conversation this line belongs to (dialogue-channels). Lines without one share the `default` channel. */
  channel?: string;
}

export interface PlayRequest {
  line: DialogueLine;
  profile: VoiceProfile;
  at: SayOptions['at'];
  /** Runtime rasp override for this speaker, or null to use the profile. */
  rasp: number | null;
  babble: boolean;
}

export interface VoicePlayback {
  /** Seconds of audio, if longer than the subtitle should be (real VO files). */
  readonly duration?: number;
  /** Per frame (moves positional voices). */
  update?(): void;
  /** Per frame for a local voice: gain (0..1) and low-pass cutoff from how it reaches the player. */
  setAudibility?(gain: number, cutoffHz: number): void;
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

/**
 * How a line reaches the player right now. `everywhere`: radio, PA, Jay himself, or a voice with no position.
 * Otherwise the propagation gain and tone for the voice, the straight-line metres to the speaker, and whether it is
 * within earshot.
 */
export type Hearing = 'everywhere' | { gain: number; cutoffHz: number; distance: number; audible: boolean };

/** Local subtitles show only within this many metres of the speaker (voice-playback: Subtitles follow the player's earshot). */
export const SUBTITLE_RANGE_M = 20;

interface Entry {
  line: DialogueLine;
  profile: VoiceProfile;
  opts: SayOptions;
  channel: string;
  duration: number;
  enqueuedAt: number;
  seq: number;
  handle: SpeechHandle;
  resolve: (r: EndReason) => void;
}

interface Active extends Entry {
  playback: VoicePlayback;
  startedAt: number;
  endsAt: number;
  audible: boolean;
  shown: boolean;
}

interface Lane {
  key: string;
  current: Active | null;
  queue: Entry[];
  nextStartAt: number;
  /** The last line on this channel said by someone other than Jay (for the Jay rule). */
  lastOther: Entry | null;
  /** When the lane last had anything, for pruning idle lanes. */
  touchedAt: number;
  /** When a story line the player could hear last ended here: the conversation keeps the floor between its lines. */
  heardStoryEndedAt: number;
}

export interface SpeechOptions {
  /** Silence between consecutive lines, seconds [Assumed]. */
  gap?: number;
  /** combat/idle lines are dropped rather than wait longer than this (2 s). */
  maxWait?: number;
  /** How a line reaches the player (voice-playback). Without it every line is heard everywhere. */
  hearing?: (line: DialogueLine, at: SayOptions['at']) => Hearing;
}

/** Minimum subtitle hold for recorded VO clips so one-word barks stay readable (voice-playback spec). */
export const MIN_VO_DURATION = 0.85;

const DROPPABLE: ReadonlySet<Priority> = new Set(['combat', 'idle']);
const DEFAULT_CHANNEL = 'default';
/** After a heard story line ends, barks and hints wait this long, so they never cut in between a scene's lines. */
const CONVERSATION_HOLD_S = 0.5;
/** Idle channels are forgotten after this long. */
const LANE_IDLE_S = 60;

export class SpeechManager {
  private readonly bus: EventBus;
  private readonly library: DialogueLibrary;
  private readonly player: VoicePlayer;
  private readonly gap: number;
  private readonly maxWait: number;
  private readonly hearingFn: SpeechOptions['hearing'];
  private readonly rasp = new Map<string, number>();
  private readonly lanes = new Map<string, Lane>();
  private now = 0;
  private seq = 0;
  /** While set, only these speakers are heard (`onlySpeakers`): everyone else's lines are cut off or dropped. */
  private only: ReadonlySet<string> | null = null;
  /** Global babble setting (off by default [Assumed]); a line's own `babble` wins when set. */
  babble = false;

  constructor(bus: EventBus, library: DialogueLibrary, player: VoicePlayer, opts: SpeechOptions = {}) {
    this.bus = bus;
    this.library = library;
    this.player = player;
    this.gap = opts.gap ?? 0.15;
    this.maxWait = opts.maxWait ?? 2;
    this.hearingFn = opts.hearing;
  }

  /**
   * Let only `speakers` be heard (a scene that should carry nobody else's voice), or everyone again with `null`.
   * Lines from anyone else stop now, and new ones are dropped until it is lifted.
   */
  onlySpeakers(speakers: readonly string[] | null): void {
    this.only = speakers ? new Set(speakers) : null;
    const only = this.only;
    if (!only) return;
    for (const lane of this.lanes.values()) {
      for (const e of lane.queue.filter((q) => !only.has(q.line.speaker))) {
        lane.queue.splice(lane.queue.indexOf(e), 1);
        this.end(e, 'stopped');
      }
      if (lane.current && !only.has(lane.current.line.speaker)) this.finish(lane, 'stopped');
    }
  }

  /** Queue or play a line by id. Resolves when it finishes, is cut off or dropped. */
  say(id: string, opts: SayOptions = {}): SpeechHandle {
    for (const lane of this.lanes.values()) {
      if (lane.current?.line.id === id) return lane.current.handle;
      const queued = lane.queue.find((e) => e.line.id === id);
      if (queued) return queued.handle;
    }

    const line = this.library.line(id);
    if (this.only && !this.only.has(line.speaker)) {
      this.bus.emit('speech:dropped', { id, speaker: line.speaker, waited: 0 });
      return { id, done: Promise.resolve('dropped') };
    }
    const profile = this.library.speaker(line.speaker);
    let resolve!: (r: EndReason) => void;
    const done = new Promise<EndReason>((r) => (resolve = r));
    const seq = this.seq++;
    const entry: Entry = {
      line, profile, opts, resolve, seq,
      channel: opts.overlap ? `overlap:${seq}` : (opts.channel ?? DEFAULT_CHANNEL),
      duration: subtitleDuration(line.text, line.minDuration),
      enqueuedAt: this.now,
      handle: { id, done },
    };
    const lane = this.lane(entry.channel);

    if (opts.overlap) {
      // A voice that must play beside everything (a PA, a victim's cries) cuts off its own speaker elsewhere.
      const elsewhere = this.speakingElsewhere(entry);
      if (elsewhere) this.finish(elsewhere, 'interrupted');
      this.start(lane, entry);
      return entry.handle;
    }

    const cur = lane.current;
    if (cur && priorityRank(line.priority) > priorityRank(cur.line.priority)) {
      this.finish(lane, 'interrupted');
      lane.queue.unshift(entry);
      this.pump();
      return entry.handle;
    }
    if (DROPPABLE.has(line.priority) && (cur || lane.queue.length > 0) && this.predictedWait(lane, entry) > this.maxWait) {
      this.drop(entry);
      return entry.handle;
    }
    lane.queue.push(entry);
    this.sortQueue(lane);
    this.pump();
    return entry.handle;
  }

  update(dt: number): void {
    this.now += dt;
    for (const lane of [...this.lanes.values()]) {
      const cur = lane.current;
      if (!cur) continue;
      cur.playback.update?.();
      this.refreshHearing(cur);
      if (this.now >= cur.endsAt) this.finish(lane, 'finished');
    }
    // Stale barks are dropped rather than played late.
    for (const lane of this.lanes.values()) {
      for (const e of [...lane.queue]) {
        if (DROPPABLE.has(e.line.priority) && this.now - e.enqueuedAt > this.maxWait) {
          lane.queue.splice(lane.queue.indexOf(e), 1);
          this.drop(e);
        }
      }
    }
    this.pump();
    for (const [key, lane] of this.lanes) {
      if (!lane.current && lane.queue.length === 0 && this.now - lane.touchedAt > LANE_IDLE_S) this.lanes.delete(key);
    }
  }

  /** Stop every line and clear every channel (pause menu, checkpoint reload, cutscene skip). */
  stopAll(): void {
    for (const lane of this.lanes.values()) {
      for (const e of lane.queue.splice(0)) this.end(e, 'stopped');
      if (lane.current) this.finish(lane, 'stopped');
    }
    this.lanes.clear();
  }

  /**
   * End a conversation on the spot (scene-presence: the player left its room): the line it is saying stops with its
   * subtitle, the lines queued behind it are dropped as stopped, and the channel is forgotten. Unknown channel: nothing.
   */
  stopChannel(channel: string): void {
    this.stopChannels((key) => key === channel);
  }

  /** `stopChannel` for every channel `match` accepts (a scene's own channel and its named side conversations). */
  stopChannels(match: (channel: string) => boolean): void {
    for (const lane of [...this.lanes.values()]) {
      if (!match(lane.key)) continue;
      for (const e of lane.queue.splice(0)) this.end(e, 'stopped');
      if (lane.current) this.finish(lane, 'stopped');
      this.lanes.delete(lane.key);
    }
  }

  /** Stop one line if it is playing or queued. */
  stop(id: string): void {
    for (const lane of this.lanes.values()) {
      if (lane.current?.line.id === id) {
        this.finish(lane, 'stopped');
        return;
      }
      const i = lane.queue.findIndex((e) => e.line.id === id);
      if (i >= 0) {
        this.end(lane.queue.splice(i, 1)[0]!, 'stopped');
        return;
      }
    }
  }

  /** Runtime voice roughness for a speaker, 0..1 (Giles's foreshadowing). null resets. */
  setRasp(speaker: string, amount: number | null): void {
    if (amount === null) this.rasp.delete(speaker);
    else this.rasp.set(speaker, Math.min(1, Math.max(0, amount)));
  }

  /**
   * What the player can hear speaking now, if anything (hints and barks check this so they never talk over story):
   * the highest-priority line within earshot, preferring a conversation over an overlap voice.
   */
  speaking(): SpeechInfo | null {
    let best: Active | null = null;
    const score = (a: Active): number => priorityRank(a.line.priority) * 2 + (a.channel.startsWith('overlap:') ? 0 : 1);
    for (const lane of this.lanes.values()) {
      const a = lane.current;
      if (!a || !a.audible) continue;
      if (!best || score(a) > score(best)) best = a;
    }
    return best ? this.info(best) : null;
  }

  queuedIds(): string[] {
    return [...this.lanes.values()].flatMap((l) => l.queue.map((e) => e.line.id));
  }

  // ---------------------------------------------------------------- internals

  private lane(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { key, current: null, queue: [], nextStartAt: 0, lastOther: null, touchedAt: this.now, heardStoryEndedAt: -Infinity };
      this.lanes.set(key, lane);
    }
    lane.touchedAt = this.now;
    return lane;
  }

  /** Start whatever each idle channel may start now. */
  private pump(): void {
    // Story first, so a story line that cuts off an audible bark gets in before barks are considered.
    const lanes = [...this.lanes.values()].sort((a, b) => headRank(b) - headRank(a));
    for (const lane of lanes) {
      while (!lane.current && lane.queue.length > 0 && this.now >= lane.nextStartAt) {
        const next = lane.queue[0]!;
        // A speaker never talks over themself; the channel keeps its order behind them.
        if (this.speakingElsewhere(next)) break;
        // Barks and hints give way to story the player can hear.
        if (next.line.priority !== 'story' && this.audibleStoryPlaying(lane)) break;
        lane.queue.shift();
        // Jay answers the conversation he can hear: elsewhere, his line is dropped and the scene carries on.
        if (next.line.speaker === 'player' && lane.lastOther && !this.audibleNow(lane.lastOther)) {
          this.drop(next);
          continue;
        }
        this.start(lane, next);
      }
    }
  }

  private start(lane: Lane, e: Entry): void {
    // A story line in earshot cuts off any bark or hint the player can hear.
    if (e.line.priority === 'story' && this.audibleNow(e)) {
      for (const other of this.lanes.values()) {
        const o = other.current;
        if (other !== lane && o && o.line.priority !== 'story' && o.audible) this.finish(other, 'interrupted');
      }
    }
    lane.current = this.begin(e);
    lane.touchedAt = this.now;
    if (e.line.speaker !== 'player') lane.lastOther = e;
  }

  private begin(e: Entry): Active {
    const playback = this.player.play({
      line: e.line,
      profile: e.profile,
      at: e.opts.at,
      rasp: this.rasp.get(e.line.speaker) ?? null,
      babble: e.line.babble ?? this.babble,
    });
    const duration = playback.duration !== undefined ? Math.max(MIN_VO_DURATION, playback.duration) : e.duration;
    const hearing = this.hearingOf(e);
    if (hearing !== 'everywhere') playback.setAudibility?.(hearing.gain, hearing.cutoffHz);
    const active: Active = {
      ...e, duration, playback, startedAt: this.now, endsAt: this.now + duration,
      audible: audibleIn(hearing), shown: subtitleIn(hearing),
    };
    const info = this.info(active);
    this.bus.emit('speech:started', active.audible ? info : { ...info, audible: false });
    if (active.shown) this.bus.emit('subtitle:show', info);
    return active;
  }

  /** Per frame: push gain and tone to the voice, and show or hide its subtitle as the player moves. */
  private refreshHearing(a: Active): void {
    const hearing = this.hearingOf(a);
    if (hearing !== 'everywhere') a.playback.setAudibility?.(hearing.gain, hearing.cutoffHz);
    const audible = audibleIn(hearing);
    if (audible !== a.audible) {
      a.audible = audible;
      this.bus.emit('speech:audible', { id: a.line.id, priority: a.line.priority, audible });
    }
    const shown = subtitleIn(hearing);
    if (shown === a.shown) return;
    a.shown = shown;
    if (shown) this.bus.emit('subtitle:show', { ...this.info(a), duration: Math.max(0, a.endsAt - this.now) });
    else this.bus.emit('subtitle:hide', { id: a.line.id });
  }

  private finish(lane: Lane, reason: EndReason): void {
    const cur = lane.current;
    if (!cur) return;
    lane.current = null;
    lane.touchedAt = this.now;
    cur.playback.stop(reason !== 'finished');
    if (cur.shown) this.bus.emit('subtitle:hide', { id: cur.line.id });
    this.end(cur, reason);
    lane.nextStartAt = reason === 'interrupted' ? this.now : this.now + this.gap;
    if (reason === 'finished' && cur.audible && cur.line.priority === 'story') lane.heardStoryEndedAt = this.now;
    if (lane.key.startsWith('overlap:') && lane.queue.length === 0) this.lanes.delete(lane.key);
  }

  /** The channel where `e`'s speaker is saying another line, if any. */
  private speakingElsewhere(e: Entry): Lane | null {
    for (const lane of this.lanes.values()) {
      if (lane.key !== e.channel && lane.current && lane.current.line.speaker === e.line.speaker) return lane;
    }
    return null;
  }

  /** A story line the player can hear is playing, or one just ended and its conversation is between lines. */
  private audibleStoryPlaying(except: Lane): boolean {
    for (const lane of this.lanes.values()) {
      if (lane === except) continue;
      if (lane.current?.line.priority === 'story' && lane.current.audible) return true;
      if (!lane.current && this.now - lane.heardStoryEndedAt < CONVERSATION_HOLD_S) return true;
    }
    return false;
  }

  private hearingOf(e: Entry): Hearing {
    return this.hearingFn ? this.hearingFn(e.line, e.opts.at) : 'everywhere';
  }

  private audibleNow(e: Entry): boolean {
    return audibleIn(this.hearingOf(e));
  }

  private drop(e: Entry): void {
    this.bus.emit('speech:dropped', { id: e.line.id, speaker: e.line.speaker, waited: this.now - e.enqueuedAt });
    e.resolve('dropped');
  }

  private end(e: Entry, reason: EndReason): void {
    this.bus.emit('speech:ended', { id: e.line.id, speaker: e.line.speaker, reason });
    e.resolve(reason);
  }

  /** Seconds until `e` would start if appended to `lane` now. */
  private predictedWait(lane: Lane, e: Entry): number {
    const rank = priorityRank(e.line.priority);
    let wait = lane.current ? lane.current.endsAt - this.now + this.gap : Math.max(0, lane.nextStartAt - this.now);
    for (const q of lane.queue) if (priorityRank(q.line.priority) >= rank) wait += q.duration + this.gap;
    return wait;
  }

  private sortQueue(lane: Lane): void {
    lane.queue.sort((a, b) => priorityRank(b.line.priority) - priorityRank(a.line.priority) || a.seq - b.seq);
  }

  private info(e: Entry): SpeechInfo {
    const to = e.opts.to ?? e.line.to;
    return {
      id: e.line.id,
      speaker: e.line.speaker,
      ...(to !== undefined ? { to } : {}),
      name: e.profile.name,
      text: e.line.text,
      emote: e.line.emote,
      channel: e.line.channel,
      priority: e.line.priority,
      duration: e.duration,
    };
  }
}

const audibleIn = (h: Hearing): boolean => h === 'everywhere' || h.audible;
const subtitleIn = (h: Hearing): boolean => h === 'everywhere' || (h.audible && h.distance <= SUBTITLE_RANGE_M);
const headRank = (lane: Lane): number => (lane.queue[0] ? priorityRank(lane.queue[0].line.priority) : -1);
