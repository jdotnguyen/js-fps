import { clipSpeedAt, type KillBeat, type KillEvent, type KillStyle } from '../data/types/kills.ts';

/**
 * One scripted kill playing on one victim (infection-kills spec). Pure timing: which beat is on, when it ends (its cue
 * or its time limit, whichever comes first), which poses loop, how far each lump has travelled, and which events are
 * due. Everything it does to the world goes through `KillHooks`, so it runs the same in tests and in the game.
 */
export interface KillHooks {
  /** A beat begins (the director emits `kill:<beat>`). */
  beat(id: string, index: number): void;
  pose(name: string, blend: number): void;
  /**
   * A beat's captured clip starts on the victim, blending in over `blend` s. Returns the clip's length in seconds, or
   * null when the body has no such clip (the beat then plays its poses). A later `pose` stops the clip.
   */
  clip?(id: string, blend: number): number | null;
  /** How far through the playing clip the victim is (0..1); the clip holds its last frame at 1. */
  clipPhase?(u: number): void;
  convulse(target: number, rate: number): void;
  /** Lump `i` at `t` (0..1) along `path`; radius 0 clears it. */
  bulge(i: number, path: readonly string[], t: number, radius: number, amp: number): void;
  /** A timed beat event. */
  event(e: KillEvent, beat: KillBeat): void;
  /** Is the victim standing at a glass partition (for `needsGlass` beats)? */
  facesGlass(): boolean;
  /** `until: arrive`: has the victim reached the glass? */
  arrived(): boolean;
  /** `until: creature`: has the creature finished getting up? */
  creatureReady(): boolean;
  /** The last beat ended. */
  done(): void;
  /** `mauled`: the victim says a line (a beat's `lines`). */
  say?(line: string): void;
  /** `mauled`: whatever the victim is saying stops now (an impact). */
  cutVoice?(): void;
  /** `startWhen: inReach`: is the attacker within `reach` m of her now (and free to take hold)? */
  inReach?(beat: KillBeat): boolean;
  /** `startWhen: inReach`: the beat before ran out of time; walk the attacker the rest of the way (never place it). */
  closeIn?(beat: KillBeat): void;
}

/** Bulge slots a kill uses; matches the body shader's lump count. */
const BULGE_SLOTS = 4;
/**
 * `startWhen: inReach`: after the beat before has run out of time, the attacker is walked in for at most this long
 * before the beat starts anyway (a body stuck behind furniture must not hang the scene).
 */
export const CLOSE_IN_MAX_S = 6;

export class KillRun {
  readonly style: KillStyle;
  /** Beat id -> dialogue line whose end closes that beat (`until: line`). */
  private readonly cues: Readonly<Record<string, string>>;
  private readonly hooks: KillHooks;
  private index = -1;
  private t = 0;
  private fired = 0;
  private poseIndex = 0;
  private started = false;
  private finished = false;
  /** Lines that have ended since the kill began (a line may end before its beat starts listening). */
  private readonly endedLines = new Set<string>();
  /** Slam impacts landed in the current beat (`until: impacts`). */
  private impacts = 0;
  /** The current beat's clip: its length (s) and progress (0..1); null when the beat has none or the body lacks it. */
  private clip: { duration: number; u: number } | null = null;
  /** Warned once per missing clip id. */
  private readonly missingClips = new Set<string>();
  /** Where a missing clip is reported (default `console.warn`). */
  warn: (message: string) => void = (m) => console.warn(`[kill] ${m}`);
  /** The beats that ran, in order (tests, debug). */
  readonly played: string[] = [];
  /** The current beat is over but the next waits for the attacker to reach her (`startWhen: inReach`). */
  private waiting = false;
  private closing = false;

  constructor(style: KillStyle, cues: Readonly<Record<string, string>>, hooks: KillHooks) {
    this.style = style;
    this.cues = cues;
    this.hooks = hooks;
  }

  get beatId(): string | null {
    return this.style.beats[this.index]?.id ?? null;
  }

  get over(): boolean {
    return this.finished;
  }

  /** A dialogue line finished playing (`speech:ended`). */
  lineEnded(id: string): void {
    this.endedLines.add(id);
  }

  /** Seconds into the current beat. */
  get beatTime(): number {
    return this.t;
  }

  /** The current beat (null before the first update and after the last). */
  get beat(): KillBeat | null {
    return this.style.beats[this.index] ?? null;
  }

  /** The current beat has ended and holds until the attacker is in reach (tests, debug). */
  get holding(): boolean {
    return this.waiting;
  }

  /** Impacts landed in the current beat. */
  get impactCount(): number {
    return this.impacts;
  }

  /** Progress through the current beat's clip (0..1), or null when no clip plays. */
  get clipProgress(): number | null {
    return this.clip?.u ?? null;
  }

  /**
   * A slam impact landed on the victim (`mauled`). Her voice is cut, the beat's next line (if any) plays, and an
   * `until: impacts` beat ends once its count is reached (checked on the next update).
   */
  impact(): number {
    if (this.finished) return this.impacts;
    const beat = this.style.beats[this.index];
    this.impacts++;
    this.hooks.cutVoice?.();
    const line = beat?.lines?.[this.impacts];
    if (line) this.hooks.say?.(line);
    return this.impacts;
  }

  /** Advance. The first call starts the first beat, so listeners set up in the same frame hear it. */
  update(dt: number): void {
    if (this.finished) return;
    if (!this.started) {
      this.started = true;
      this.enter(0);
      return;
    }
    const beat = this.style.beats[this.index];
    if (!beat) return;
    this.t += dt;
    this.fire(beat);
    if (this.clip) this.advanceClip(beat, dt);
    else this.loopPoses(beat);
    this.moveBulges(beat);
    if (this.ended(beat) && this.reached(beat)) this.enter(this.index + 1);
  }

  /** The next beat may start: it does not wait for the attacker, or the attacker has reached her (design D17). */
  private reached(beat: KillBeat): boolean {
    const next = this.style.beats[this.index + 1];
    if (!next || next.startWhen !== 'inReach' || !this.hooks.inReach || this.hooks.inReach(next)) {
      this.waiting = false;
      return true;
    }
    this.waiting = true;
    // Out of time and still not there: walk it in (once), and give up waiting after CLOSE_IN_MAX_S.
    if (this.t >= beat.max) {
      if (!this.closing) {
        this.closing = true;
        this.hooks.closeIn?.(next);
      }
      if (this.t >= beat.max + CLOSE_IN_MAX_S) {
        this.warn(`beat "${next.id}": the attacker never reached her; starting anyway`);
        this.waiting = false;
        return true;
      }
    }
    return false;
  }

  /** Jump to the end state at once (a skipped or restored scene): every remaining event that changes the end state runs. */
  finishNow(): void {
    if (this.finished) return;
    for (let i = Math.max(0, this.index); i < this.style.beats.length; i++) {
      const beat = this.style.beats[i]!;
      const events = beat.events ?? [];
      const from = i === this.index ? this.fired : 0;
      for (const e of events.slice(from)) if (e.do === 'tear' || e.do === 'die' || e.do === 'creature' || e.do === 'light' || e.do === 'infect' || e.do === 'face' || e.do === 'layout') this.hooks.event(e, beat);
    }
    const last = this.style.beats[this.style.beats.length - 1];
    if (last) this.hooks.pose(last.poses[0]!, 0.01);
    this.hooks.convulse(0, 100);
    for (let i = 0; i < BULGE_SLOTS; i++) this.hooks.bulge(i, [], 0, 0, 0);
    this.finished = true;
    this.hooks.done();
  }

  private enter(i: number): void {
    // Glass beats only play when she is at the glass.
    while (i < this.style.beats.length && this.style.beats[i]!.needsGlass && !this.hooks.facesGlass()) i++;
    for (let k = 0; k < BULGE_SLOTS; k++) this.hooks.bulge(k, [], 0, 0, 0);
    const beat = this.style.beats[i];
    if (!beat) {
      this.index = this.style.beats.length;
      this.finished = true;
      this.hooks.done();
      return;
    }
    this.index = i;
    this.t = 0;
    this.fired = 0;
    this.waiting = false;
    this.closing = false;
    this.poseIndex = 0;
    this.impacts = 0;
    this.clip = null;
    this.played.push(beat.id);
    this.hooks.beat(beat.id, i);
    this.hooks.pose(beat.poses[0]!, beat.blend ?? 0.25);
    if (beat.clip !== undefined) this.startClip(beat, beat.clip);
    this.hooks.convulse(beat.convulse, beat.rate ?? 1.5);
    const line = beat.lines?.[0];
    if (line) this.hooks.say?.(line);
    this.fire(beat);
    this.moveBulges(beat);
  }

  private fire(beat: KillBeat): void {
    const events = beat.events ?? [];
    while (this.fired < events.length && events[this.fired]!.t <= this.t + 1e-9) {
      this.hooks.event(events[this.fired]!, beat);
      this.fired++;
    }
  }

  /** Start the beat's clip; without one on the body, warn once and leave the beat to its poses. */
  private startClip(beat: KillBeat, id: string): void {
    const duration = this.hooks.clip?.(id, beat.blend ?? 0.3) ?? null;
    if (duration === null || !(duration > 0)) {
      if (!this.missingClips.has(id)) {
        this.missingClips.add(id);
        this.warn(`beat "${beat.id}": the victim has no clip "${id}"; playing its poses instead`);
      }
      return;
    }
    this.clip = { duration, u: 0 };
    this.hooks.clipPhase?.(0);
  }

  /** Move the clip on at the beat's speed for this moment of the beat. */
  private advanceClip(beat: KillBeat, dt: number): void {
    const c = this.clip!;
    c.u = Math.min(1, c.u + (dt * clipSpeedAt(beat.speed, this.t)) / c.duration);
    this.hooks.clipPhase?.(c.u);
  }

  private loopPoses(beat: KillBeat): void {
    if (beat.poses.length < 2) return;
    const period = beat.period ?? 0.4;
    const k = Math.floor(this.t / period);
    if (k === this.poseIndex) return;
    this.poseIndex = k;
    this.hooks.pose(beat.poses[k % beat.poses.length]!, beat.blend ?? Math.min(0.25, period * 0.6));
  }

  private moveBulges(beat: KillBeat): void {
    const len = beat.s ?? beat.max;
    const t = len > 0 ? Math.min(1, this.t / len) : 1;
    (beat.bulges ?? []).slice(0, BULGE_SLOTS).forEach((b, i) => this.hooks.bulge(i, b.path, t, b.radius, b.amp));
  }

  private ended(beat: KillBeat): boolean {
    if (this.t >= beat.max) return true;
    switch (beat.until) {
      case 'time':
        return this.t >= (beat.s ?? beat.max);
      case 'line': {
        const line = this.cues[beat.id];
        return line !== undefined && this.endedLines.has(line);
      }
      case 'arrive':
        return this.hooks.arrived();
      case 'creature':
        return this.hooks.creatureReady();
      case 'impacts':
        return this.impacts >= (beat.impacts ?? 1);
      case 'clip':
        // A missing clip falls back to the poses, which then run for the beat's `s` (else its time limit).
        return this.clip ? this.clip.u >= 1 : this.t >= (beat.s ?? beat.max);
    }
  }
}
