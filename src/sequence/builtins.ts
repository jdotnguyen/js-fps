import type { EventName } from '../core/events.ts';
import type { ControlState } from '../actors/control.ts';
import type { Action, ActionDef, LineHandle, RunContext, WalkHandle } from './action.ts';
import type { ActionStep, FlagValue, Vec3 } from './types.ts';

// ----------------------------------------------------------------------- helpers

/** Runs once, whenever it is started, updated or finished first; blocks for nothing. */
class InstantAction implements Action {
  private ran = false;
  private readonly fn: () => void;
  constructor(fn: () => void) {
    this.fn = fn;
  }
  start(): void {
    this.run();
  }
  update(): boolean {
    this.run();
    return true;
  }
  finish(): void {
    this.run();
  }
  cancel(): void {}
  private run(): void {
    if (this.ran) return;
    this.ran = true;
    this.fn();
  }
}

/** Timers finish within a microsecond of zero, so 10 x 0.1 s really is 1 s. */
const EPS = 1e-6;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);
const optNum = (v: unknown): boolean => v === undefined || isNum(v);

// ----------------------------------------------------------------------- flow

class WaitAction implements Action {
  private left: number;
  private done = false;
  constructor(seconds: number) {
    this.left = seconds;
  }
  start(): void {}
  update(dt: number): boolean {
    if (this.done) return true;
    this.left -= dt;
    this.done = this.left <= EPS;
    return this.done;
  }
  finish(): void {
    this.done = true;
  }
  cancel(): void {}
}

class WaitForAction implements Action {
  private fired = false;
  private left: number;
  private off: (() => void) | null = null;
  private readonly ctx: RunContext;
  private readonly event: string;
  constructor(ctx: RunContext, event: string, timeout: number) {
    this.ctx = ctx;
    this.event = event;
    this.left = timeout;
  }
  start(): void {
    if (this.fired || this.off) return;
    // Sequence events are plain strings; the bus is typed for code-defined events.
    this.off = this.ctx.events.on(this.event as EventName, () => {
      this.fired = true;
      this.stop();
    });
  }
  update(dt: number): boolean {
    if (this.fired) return true;
    this.left -= dt;
    if (this.left <= EPS) {
      this.fired = true;
      this.stop();
    }
    return this.fired;
  }
  finish(): void {
    this.fired = true;
    this.stop();
  }
  cancel(): void {
    this.stop();
  }
  private stop(): void {
    this.off?.();
    this.off = null;
  }
}

// ----------------------------------------------------------------------- game-facing

class SayAction implements Action {
  private handle: LineHandle | null = null;
  private done = false;
  private readonly ctx: RunContext;
  private readonly line: string;
  private readonly wait: boolean;
  constructor(ctx: RunContext, line: string, wait: boolean) {
    this.ctx = ctx;
    this.line = line;
    this.wait = wait;
  }
  start(): void {
    if (this.done || this.handle) return;
    this.handle = this.ctx.host.say(this.line);
  }
  update(): boolean {
    if (this.done) return true;
    this.done = !this.wait || (this.handle?.isDone() ?? true);
    return this.done;
  }
  finish(): void {
    if (this.done && !this.handle) return;
    this.handle?.stop();
    this.handle = null;
    if (!this.done) this.ctx.host.markLinePlayed(this.line);
    this.done = true;
  }
  cancel(): void {
    this.handle?.stop();
    this.handle = null;
    this.done = true;
  }
}

class FadeAction implements Action {
  private left = 0;
  private started = false;
  private done = false;
  private readonly ctx: RunContext;
  private readonly level: number;
  private readonly seconds: number;
  private readonly wait: boolean;
  constructor(ctx: RunContext, level: number, seconds: number, wait: boolean) {
    this.ctx = ctx;
    this.level = level;
    this.seconds = seconds;
    this.wait = wait;
  }
  start(): void {
    if (this.started || this.done) return;
    this.started = true;
    this.left = this.wait ? this.seconds : 0;
    this.ctx.host.fade(this.level, this.seconds);
  }
  update(dt: number): boolean {
    if (this.done) return true;
    this.left -= dt;
    this.done = this.left <= EPS;
    return this.done;
  }
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.ctx.host.fade(this.level, 0);
  }
  cancel(): void {}
}

class WalkAction implements Action {
  private handle: WalkHandle | null = null;
  private done = false;
  private readonly ctx: RunContext;
  private readonly pos: Vec3;
  private readonly speed: number | undefined;
  constructor(ctx: RunContext, pos: Vec3, speed: number | undefined) {
    this.ctx = ctx;
    this.pos = pos;
    this.speed = speed;
  }
  start(): void {
    if (this.done || this.handle) return;
    this.handle = this.ctx.host.playerWalkTo(this.pos, this.speed);
  }
  update(): boolean {
    if (this.done) return true;
    this.done = this.handle?.isDone() ?? true;
    return this.done;
  }
  finish(): void {
    if (this.done) return;
    this.handle?.cancel();
    this.handle = null;
    this.done = true;
    this.ctx.host.placePlayer(this.pos, undefined, undefined);
  }
  cancel(): void {
    this.handle?.cancel();
    this.handle = null;
    this.done = true;
  }
}

const MOVES = ['free', 'slow', 'locked'];
const LOOKS = ['free', 'clamped', 'locked'];

function controlOverride(step: ActionStep): Partial<ControlState> {
  const over: Partial<ControlState> = {};
  if (step['move'] === 'free' || step['move'] === 'slow' || step['move'] === 'locked') over.move = step['move'];
  if (step['look'] === 'free' || step['look'] === 'clamped' || step['look'] === 'locked') over.look = step['look'];
  for (const key of ['weapons', 'flashlight', 'interact'] as const) {
    const v = step[key];
    if (typeof v === 'boolean') over[key] = v;
  }
  return over;
}

// ----------------------------------------------------------------------- registry

export const BUILTIN_ACTIONS: Record<string, ActionDef> = {
  wait: {
    check: (s) => (isNum(s['s']) && s['s'] >= 0 ? null : '"s" must be a number of seconds'),
    create: (s) => new WaitAction(s['s'] as number),
  },
  waitFor: {
    check: (s) => (isStr(s['event']) ? (optNum(s['timeout']) ? null : '"timeout" must be a number') : '"event" must be a string'),
    create: (s, ctx) => new WaitForAction(ctx, s['event'] as string, isNum(s['timeout']) ? s['timeout'] : Infinity),
  },
  setFlag: {
    check: (s) => (isStr(s['flag']) ? null : '"flag" must be a string'),
    create: (s, ctx) => {
      const value: FlagValue = typeof s['value'] === 'string' || typeof s['value'] === 'number' ? s['value'] : s['value'] !== false;
      return new InstantAction(() => {
        ctx.flags[s['flag'] as string] = value;
      });
    },
  },
  emit: {
    check: (s) => (isStr(s['event']) ? null : '"event" must be a string'),
    create: (s, ctx) =>
      new InstantAction(() => {
        (ctx.events.emit as (name: string, payload: unknown) => void)(s['event'] as string, s['payload'] ?? {});
      }),
  },
  playerControl: {
    check: (s) => {
      if (s['move'] !== undefined && !MOVES.includes(s['move'] as string)) return '"move" must be free, slow or locked';
      if (s['look'] !== undefined && !LOOKS.includes(s['look'] as string)) return '"look" must be free, clamped or locked';
      return null;
    },
    create: (s, ctx) =>
      new InstantAction(() => {
        if (s['reset'] === true) ctx.releaseHolds();
        else ctx.hold(controlOverride(s));
      }),
  },
  playerLookAt: {
    check: (s) => (isVec3(s['target']) ? null : '"target" must be [x, y, z]'),
    create: (s, ctx) =>
      new InstantAction(() => {
        ctx.host.playerLookAt(s['target'] as Vec3, isNum(s['duration']) ? s['duration'] : 0.8, isNum(s['weight']) ? s['weight'] : 0.85);
      }),
  },
  playerWalkTo: {
    check: (s) => (isVec3(s['pos']) ? (optNum(s['speed']) ? null : '"speed" must be a number') : '"pos" must be [x, y, z]'),
    create: (s, ctx) => new WalkAction(ctx, s['pos'] as Vec3, isNum(s['speed']) ? s['speed'] : undefined),
  },
  playerPlace: {
    check: (s) => (isVec3(s['pos']) ? null : '"pos" must be [x, y, z]'),
    create: (s, ctx) =>
      new InstantAction(() => {
        ctx.host.placePlayer(s['pos'] as Vec3, isNum(s['yaw']) ? s['yaw'] : undefined, isNum(s['pitch']) ? s['pitch'] : undefined);
      }),
  },
  say: {
    check: (s) => (isStr(s['line']) ? null : '"line" must be a dialogue line id'),
    create: (s, ctx) => new SayAction(ctx, s['line'] as string, s['wait'] !== false),
  },
  fade: {
    check: (s) => (isNum(s['to']) && s['to'] >= 0 && s['to'] <= 1 ? (optNum(s['s']) ? null : '"s" must be a number') : '"to" must be 0 to 1'),
    create: (s, ctx) => new FadeAction(ctx, s['to'] as number, isNum(s['s']) ? s['s'] : 0.8, s['wait'] !== false),
  },
  sfx: {
    check: (s) => (isStr(s['id']) ? null : '"id" must be a sound id'),
    create: (s, ctx) =>
      new InstantAction(() => {
        ctx.host.sfx(s['id'] as string, isVec3(s['at']) ? s['at'] : undefined);
      }),
  },
  checkpoint: {
    check: (s) => (isStr(s['id']) ? null : '"id" must be a checkpoint id'),
    create: (s, ctx) =>
      new InstantAction(() => {
        ctx.host.checkpoint(s['id'] as string);
      }),
  },
};
