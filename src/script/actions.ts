/**
 * The action set of ADR-0009: one table that holds both the JSON schema and the
 * implementation of every `do` name, so the two cannot drift apart.
 *
 * Rule for `wait`: actions return immediately unless the step says `"wait": true`
 * (`say` is the exception: it waits for the line to finish unless `"wait": false`).
 */
import {
  ValidationError,
  arr,
  bool,
  num,
  numRange,
  obj,
  oneOf,
  optional,
  record,
  scalar,
  str,
  vec3,
  type Infer,
  type Validator,
} from '../core/validate.ts';
import { DOOR_STATES } from '../data/types/level.ts';
import { LIGHT_PATTERNS } from '../render/lights.ts';
import type { ControlOverride, SequenceHost } from './host.ts';
import type { ActionStep, Flags, Running, Scalar, Step, TargetRef, Vec3Like } from './types.ts';

/** One-off logic that does not warrant a new action type (ADR-0009 `runHook`). */
export type Hook = (args: {
  host: SequenceHost;
  flags: Flags;
  seqId: string;
  args: Readonly<Record<string, Scalar>>;
}) => void | Promise<void>;

/** What an action may touch; implemented per running sequence by the runtime. */
export interface ActionContext {
  readonly host: SequenceHost;
  readonly seqId: string;
  /** Build a nested step list (used by `if` and `loop`). */
  build(steps: Step[]): Running;
  /** Apply the end state of a whole step list without playing it (skipping). */
  skipSteps(steps: Step[]): void;
  /** Subscribe to an event until the sequence ends. */
  listen(event: string, fn: (payload: unknown) => void): () => void;
  /** Push a control layer owned by this sequence (popped on end or cancel). */
  pushControl(over: ControlOverride): void;
  releaseControl(): void;
  /** Run `fn` when the sequence ends or is cancelled. */
  onEnd(fn: () => void): void;
  /** Snapshot world state, then tell the game (ADR-0009 checkpoints). */
  checkpoint(id: string, label: string | undefined): void;
  hook(name: string): Hook | undefined;
  /** Warn once that a system this action needs is not available yet. */
  missing(feature: string): void;
}

export interface ActionDef {
  validate: Validator<ActionStep>;
  start(step: ActionStep, ctx: ActionContext): Running | void;
  /**
   * Apply this step's end state instantly, for a step that has not started or is in
   * flight (ADR-0017). Without it the runtime runs `start` and drops the result, which is
   * right for instant actions (setFlag, doorState, checkpoint...).
   */
  skip?: SkipFn;
}

export type SkipFn = (step: ActionStep, ctx: ActionContext) => void;

type Shape = Parameters<typeof obj>[0];

function act<S extends Shape>(
  shape: S,
  start: (step: Infer<S>, ctx: ActionContext) => Running | void,
  check?: (step: Infer<S>, path: string) => void,
): ActionDef {
  const inner = obj({ do: str, ...shape });
  return {
    validate: (v, p) => {
      const out = inner(v, p) as unknown as Infer<S>;
      check?.(out, p);
      return out as unknown as ActionStep;
    },
    start: start as unknown as ActionDef['start'],
  };
}

// ----------------------------------------------------------------------- small runtimes

/** Finished after `seconds` of simulation time. */
export function timed(seconds: number): Running {
  let left = seconds;
  return {
    update(dt) {
      left -= dt;
      return left <= 0;
    },
  };
}

/** Finished when the promise settles (resolved or rejected). */
export function pending(p: Promise<unknown>): Running {
  let done = false;
  const fin = (): void => {
    done = true;
  };
  p.then(fin, fin);
  return { update: () => done };
}

// -------------------------------------------------------------------------- validators

const target: Validator<TargetRef> = (v, p) => (Array.isArray(v) ? vec3(v, p) : str(v, p));
const wait = optional(bool);
const control: Shape = {
  move: optional(oneOf(['free', 'slow', 'locked'] as const)),
  look: optional(oneOf(['free', 'clamped', 'locked'] as const)),
  weapons: optional(bool),
  flashlight: optional(bool),
  interact: optional(bool),
  reset: optional(bool),
};

function resolve(action: string, ref: TargetRef, ctx: ActionContext): Vec3Like | null {
  const at = ctx.host.resolve(ref);
  if (!at) ctx.host.warn(`${ctx.seqId}: ${action} cannot resolve target ${JSON.stringify(ref)}; skipped`);
  return at;
}

/** Actions delegated to the NPC system (ADR-0006/0011). */
function npcAct(name: string, shape: Shape): ActionDef {
  return act({ ...shape, wait }, (s, ctx) => {
    if (!ctx.host.npc) {
      ctx.missing(`NPC actions (${name})`);
      return;
    }
    const r = ctx.host.npc(name, s as Record<string, unknown>);
    if ((s as { wait?: boolean }).wait && r) return pending(r);
  });
}

// ----------------------------------------------------------------------------- the table

export const ACTIONS: Record<string, ActionDef> = {
  // ---- flow
  wait: act({ s: numRange(0, 3600) }, (s) => timed(s.s)),

  waitFor: act({ event: str, timeout: optional(numRange(0, 3600)) }, (s, ctx) => {
    let fired = false;
    let left = s.timeout ?? Infinity;
    const off = ctx.listen(s.event, () => {
      fired = true;
    });
    return {
      update(dt) {
        left -= dt;
        const done = fired || left <= 0;
        if (done) off();
        return done;
      },
      cancel: off,
    };
  }),

  setFlag: act({ flag: str, value: optional(scalar) }, (s, ctx) => {
    ctx.host.flags[s.flag] = s.value ?? true;
  }),

  if: act(
    { flag: str, is: optional(scalar), then: (v, p) => stepsV(v, p), else: optional((v, p) => stepsV(v, p)) },
    (s, ctx) => {
      const have = ctx.host.flags[s.flag] ?? false;
      const branch = have === (s.is ?? true) ? s.then : s.else;
      return branch && branch.length ? ctx.build(branch) : undefined;
    },
  ),

  emit: act({ event: str, payload: optional(record(scalar)) }, (s, ctx) => {
    ctx.host.events.emit(s.event, s.payload ?? {});
  }),

  runHook: act({ hook: str, args: optional(record(scalar)) }, (s, ctx) => {
    const hook = ctx.hook(s.hook);
    if (!hook) throw new Error(`unknown hook "${s.hook}" (register it with SequenceManager.registerHook)`);
    const r = hook({ host: ctx.host, flags: ctx.host.flags, seqId: ctx.seqId, args: s.args ?? {} });
    if (r) return pending(r);
  }),

  loop: act(
    { steps: (v, p) => stepsV(v, p), until: optional(str), count: optional(numRange(1, 10000)) },
    (s, ctx) => {
      let iterations = 0;
      let ended = false;
      let body: Running | null = null;
      const off = s.until
        ? ctx.listen(s.until, () => {
            ended = true;
          })
        : () => {};
      return {
        update(dt) {
          if (ended) {
            body?.cancel?.();
            off();
            return true;
          }
          if (!body) {
            if (s.count !== undefined && iterations >= s.count) {
              off();
              return true;
            }
            body = ctx.build(s.steps);
            iterations++;
          }
          // At most one pass per update, so an empty body cannot hang the frame.
          if (body.update(dt)) body = null;
          return false;
        },
        cancel() {
          body?.cancel?.();
          off();
        },
      };
    },
    (s, p) => {
      if (s.until === undefined && s.count === undefined) {
        throw new ValidationError(p, 'loop needs "until" (an event) or "count", otherwise it never ends');
      }
    },
  ),

  // ---- player
  playerPlace: act({ at: target, yaw: optional(num), pitch: optional(num) }, (s, ctx) => {
    const at = resolve('playerPlace', s.at, ctx);
    if (!at) return;
    if (!ctx.host.placePlayer) return ctx.missing('playerPlace');
    ctx.host.placePlayer(at, s.yaw, s.pitch);
  }),

  playerControl: act(control, (s, ctx) => {
    const { reset, ...over } = s;
    if (reset) ctx.releaseControl();
    if (Object.keys(over).length) ctx.pushControl(over);
  }),

  playerLookAt: act(
    { target, duration: optional(numRange(0, 30)), weight: optional(numRange(0, 1)), wait },
    (s, ctx) => {
      const at = resolve('playerLookAt', s.target, ctx);
      if (!at) return;
      if (!ctx.host.lookAt) return ctx.missing('playerLookAt');
      const duration = s.duration ?? 0.8;
      ctx.host.lookAt(at, duration, s.weight ?? 1);
      if (s.wait) return timed(duration);
    },
  ),

  playerClampLook: act({ target: optional(target), degrees: optional(numRange(1, 180)), clear: optional(bool) }, (s, ctx) => {
    if (!ctx.host.clampLook) return ctx.missing('playerClampLook');
    if (s.clear || !s.target) {
      ctx.host.clampLook(null, 0);
      return;
    }
    const at = resolve('playerClampLook', s.target, ctx);
    if (!at) return;
    ctx.host.clampLook(at, s.degrees ?? 40);
    // Never leave the view clamped after the sequence.
    ctx.onEnd(() => ctx.host.clampLook?.(null, 0));
  }),

  playerWalkTo: act({ to: target, speed: optional(numRange(0.1, 10)), wait }, (s, ctx) => {
    const at = resolve('playerWalkTo', s.to, ctx);
    if (!at) return;
    if (!ctx.host.walkTo) return ctx.missing('playerWalkTo');
    const p = ctx.host.walkTo(at, s.speed);
    if (s.wait) return pending(p);
  }),

  fade: act({ to: numRange(0, 1), s: optional(numRange(0, 60)), wait }, (s, ctx) => {
    if (!ctx.host.fade) return ctx.missing('fade');
    ctx.host.fade(s.to, s.s ?? 0.8);
    if (s.wait) return timed(s.s ?? 0.8);
  }),

  cameraShake: act({ amount: numRange(0, 1), s: numRange(0, 30), wait }, (s, ctx) => {
    if (!ctx.host.cameraShake) ctx.missing('cameraShake');
    else ctx.host.cameraShake(s.amount, s.s);
    if (s.wait) return timed(s.s);
  }),

  timeScale: act({ scale: numRange(0.05, 1), s: optional(numRange(0, 60)) }, (s, ctx) => {
    if (!ctx.host.setTimeScale) return ctx.missing('timeScale');
    ctx.host.setTimeScale(s.scale);
    ctx.onEnd(() => ctx.host.setTimeScale?.(1));
    if (s.s !== undefined) {
      const hold = timed(s.s);
      return {
        update: (dt) => {
          const done = hold.update(dt);
          if (done) ctx.host.setTimeScale?.(1);
          return done;
        },
      };
    }
  }),

  // ---- NPCs (ADR-0006/0011: stubs until those systems exist)
  npcMoveTo: npcAct('npcMoveTo', { npc: str, to: target, speed: optional(numRange(0.1, 10)) }),
  npcAnim: npcAct('npcAnim', { npc: str, anim: str }),
  npcLookAt: npcAct('npcLookAt', { npc: str, target }),
  npcTask: npcAct('npcTask', { npc: str, task: str, args: optional(record(scalar)) }),
  npcFollow: npcAct('npcFollow', { npc: str, target: optional(target), stop: optional(bool) }),
  transform: npcAct('transform', { npc: str, to: num, duration: optional(numRange(0, 120)) }),
  spawn: npcAct('spawn', { npc: str, kind: optional(str), at: target }),
  despawn: npcAct('despawn', { npc: str }),
  attachToTrack: npcAct('attachToTrack', { npc: str, track: str, speed: optional(numRange(0.1, 20)) }),

  // ---- world
  doorState: act({ id: str, state: oneOf(DOOR_STATES) }, (s, ctx) => {
    if (!ctx.host.setDoor) return ctx.missing('doorState');
    if (!ctx.host.setDoor(s.id, s.state)) ctx.host.warn(`${ctx.seqId}: doorState: no door "${s.id}"`);
  }),

  lightState: act({ room: str, pattern: oneOf(LIGHT_PATTERNS) }, (s, ctx) => {
    if (!ctx.host.setLight) return ctx.missing('lightState');
    if (!ctx.host.setLight(s.room, s.pattern)) ctx.host.warn(`${ctx.seqId}: lightState: no lights in room "${s.room}"`);
  }),

  glass: act({ id: str, state: oneOf(['intact', 'cracked', 'shattered'] as const) }, (s, ctx) => {
    if (!ctx.host.glass) return ctx.missing('glass');
    ctx.host.glass(s.id, s.state);
  }),

  water: act({ level: num, s: optional(numRange(0, 600)), wait }, (s, ctx) => {
    if (!ctx.host.water) return ctx.missing('water');
    ctx.host.water(s.level, s.s ?? 0);
    if (s.wait && s.s) return timed(s.s);
  }),

  sfx: act({ id: str, at: optional(target) }, (s, ctx) => {
    if (!ctx.host.sfx) return ctx.missing('sfx');
    ctx.host.sfx(s.id, s.at !== undefined ? resolve('sfx', s.at, ctx) : null);
  }),

  music: act({ id: optional(str), stop: optional(bool) }, (s, ctx) => {
    if (!ctx.host.music) return ctx.missing('music');
    ctx.host.music(s.stop ? null : (s.id ?? null));
  }),

  ambience: act({ id: str }, (s, ctx) => {
    if (!ctx.host.ambience) return ctx.missing('ambience');
    ctx.host.ambience(s.id);
  }),

  // ---- story
  say: act({ line: str, wait }, (s, ctx) => {
    if (!ctx.host.say) return ctx.missing('say');
    const h = ctx.host.say(s.line);
    if (h && s.wait !== false) return { ...pending(h.done), skip: () => ctx.host.markLinePlayed?.(s.line) };
  }),

  setObjective: act({ id: str }, (s, ctx) => {
    ctx.host.flags[`obj:${s.id}`] = 'active';
    ctx.host.events.emit('objective:set', { id: s.id });
  }),

  completeObjective: act({ id: str }, (s, ctx) => {
    ctx.host.flags[`obj:${s.id}`] = 'done';
    ctx.host.events.emit('objective:done', { id: s.id });
  }),

  checkpoint: act({ id: str, label: optional(str) }, (s, ctx) => ctx.checkpoint(s.id, s.label)),

  endSlice: act({}, (_s, ctx) => {
    ctx.host.events.emit('story:slice_end', {});
    ctx.host.endSlice?.();
  }),
};

// ------------------------------------------------------------------------- skipping

const NOOP: SkipFn = () => undefined;

/**
 * End states for ADR-0017 skipping. Only actions that wait, play or ease need an entry;
 * instant actions (setFlag, doorState, lightState, emit, setObjective, checkpoint...) are
 * simply run, which is their end state.
 */
const SKIPS: Record<string, SkipFn> = {
  // Things that only wait for time or events have no end state of their own.
  wait: NOOP,
  waitFor: NOOP,
  loop: NOOP,
  cameraShake: NOOP,
  timeScale: NOOP,
  sfx: NOOP,
  if: (s, ctx) => {
    const st = s as unknown as { flag: string; is?: Scalar; then: Step[]; else?: Step[] };
    const branch = (ctx.host.flags[st.flag] ?? false) === (st.is ?? true) ? st.then : st.else;
    if (branch) ctx.skipSteps(branch);
  },
  // A look that was easing toward its target jumps to the final view.
  playerLookAt: (s, ctx) => {
    const at = resolve('playerLookAt', s['target'] as TargetRef, ctx);
    if (at) ctx.host.lookAt?.(at, 0.01, 1);
  },
  playerWalkTo: (s, ctx) => {
    const at = resolve('playerWalkTo', s['to'] as TargetRef, ctx);
    if (at) ctx.host.placePlayer?.({ x: at.x, y: undefined, z: at.z }, undefined, undefined);
  },
  fade: (s, ctx) => ctx.host.fade?.(s['to'] as number, 0),
  water: (s, ctx) => ctx.host.water?.(s['level'] as number, 0),
  say: (s, ctx) => ctx.host.markLinePlayed?.(s['line'] as string),
};
for (const name of ['npcMoveTo', 'npcAnim', 'npcLookAt', 'npcTask', 'npcFollow', 'transform', 'spawn', 'despawn', 'attachToTrack']) {
  SKIPS[name] = (s, ctx) => {
    if (ctx.host.npc) void ctx.host.npc(name, { ...s, wait: false, instant: true });
  };
}
for (const [name, fn] of Object.entries(SKIPS)) {
  const def = ACTIONS[name];
  if (!def) throw new Error(`SKIPS names unknown action "${name}"`);
  def.skip = fn;
}

// ---------------------------------------------------------------------------- step schema

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function stepV(v: unknown, p: string): Step {
  if (!isObject(v)) throw new ValidationError(p, 'expected a step object');
  if ('parallel' in v) {
    const extra = Object.keys(v).filter((k) => k !== 'parallel');
    if (extra.length) throw new ValidationError(`${p} > ${extra[0]}`, 'unknown field (a parallel block has only "parallel")');
    return { parallel: stepsV(v.parallel, `${p} > parallel`) };
  }
  const name = str(v.do, `${p} > do`);
  const def = ACTIONS[name];
  if (!def) throw new ValidationError(`${p} > do`, `unknown action "${name}", expected one of: ${Object.keys(ACTIONS).join(', ')}`);
  return def.validate(v, p);
}

export const stepsV: Validator<Step[]> = (v, p) => arr(stepV)(v, p);

export function isParallel(step: Step): step is { parallel: Step[] } {
  return 'parallel' in step;
}
