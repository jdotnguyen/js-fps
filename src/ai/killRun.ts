import type { KillBeat, KillEvent, KillStyle } from '../data/types/kills.ts';

/**
 * One scripted kill playing on one victim (infection-kills spec). Pure timing: which beat is on, when it ends (its cue
 * or its time limit, whichever comes first), which poses loop, how far each lump has travelled, and which events are
 * due. Everything it does to the world goes through `KillHooks`, so it runs the same in tests and in the game.
 */
export interface KillHooks {
  /** A beat begins (the director emits `kill:<beat>`). */
  beat(id: string, index: number): void;
  pose(name: string, blend: number): void;
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
}

/** Bulge slots a kill uses; matches the body shader's lump count. */
const BULGE_SLOTS = 4;

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
  /** The beats that ran, in order (tests, debug). */
  readonly played: string[] = [];

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
    this.loopPoses(beat);
    this.moveBulges(beat);
    if (this.ended(beat)) this.enter(this.index + 1);
  }

  /** Jump to the end state at once (a skipped or restored scene): every remaining event that changes the end state runs. */
  finishNow(): void {
    if (this.finished) return;
    for (let i = Math.max(0, this.index); i < this.style.beats.length; i++) {
      const beat = this.style.beats[i]!;
      const events = beat.events ?? [];
      const from = i === this.index ? this.fired : 0;
      for (const e of events.slice(from)) if (e.do === 'tear' || e.do === 'die' || e.do === 'creature' || e.do === 'light') this.hooks.event(e, beat);
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
    this.poseIndex = 0;
    this.played.push(beat.id);
    this.hooks.beat(beat.id, i);
    this.hooks.pose(beat.poses[0]!, beat.blend ?? 0.25);
    this.hooks.convulse(beat.convulse, beat.rate ?? 1.5);
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
    }
  }
}
