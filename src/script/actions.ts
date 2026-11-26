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
import { MUSIC_TRACKS } from '../audio/musicTracks.ts';
import scoresJson from '../data/scores.json' with { type: 'json' };

const SCORE_IDS = Object.keys(scoresJson) as [string, ...string[]];
import { DOOR_STATES } from '../data/types/level.ts';
import { LIGHT_PATTERNS } from '../render/lights.ts';

/** Limbs a script can cut off (skeleton.ts SeverableRegion). */
const SEVERABLE_REGIONS = ['head', 'upperArm_L', 'foreArm_L', 'upperArm_R', 'foreArm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] as const;
import { POWER_FLAG, type ControlOverride, type FrameOptions, type SequenceHost } from './host.ts';
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
  /** Seconds this run of the sequence has been playing. */
  readonly elapsed: number;
  /** The same object for every step of one run (per-run memory, e.g. a `say` pool's turn and cooldown). */
  readonly runToken: object;
  /** Is this sequence running or queued right now? (`if` on the flag `running:<id>`.) */
  isRunning(id: string): boolean;
  /** Stop another running or queued sequence now, as if cancelled (its control layers and scene NPCs are released). */
  cancelSequence(id: string): void;
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

/** Per run, per `say` step: whose turn it is in its pool, and when its cooldown ends. */
const sayMemos = new WeakMap<object, WeakMap<object, { next: number; freeAt: number }>>();
function sayMemo(run: object, step: object): { next: number; freeAt: number } {
  let byStep = sayMemos.get(run);
  if (!byStep) sayMemos.set(run, (byStep = new WeakMap()));
  let m = byStep.get(step);
  if (!m) byStep.set(step, (m = { next: 0, freeAt: -Infinity }));
  return m;
}

export interface ActionDef {
  validate: Validator<ActionStep>;
  start(step: ActionStep, ctx: ActionContext): Running | void;
  /**
   * Apply this step's end state instantly, for a step that has not started or is in
   * flight (intro-sequence spec). Without it the runtime runs `start` and drops the result, which is
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

/**
 * Where a `playerWalkTo` goes: `to` itself, or with `distance` that far from where Jay stands toward it, never past it
 * (a few steps after someone in a cutscene).
 */
function walkGoal(to: TargetRef, distance: number | undefined, ctx: ActionContext): Vec3Like | null {
  const at = resolve('playerWalkTo', to, ctx);
  if (!at || distance === undefined) return at;
  const me = ctx.host.resolve('player');
  if (!me) return at;
  const dx = at.x - me.x;
  const dz = at.z - me.z;
  const len = Math.hypot(dx, dz);
  if (len <= distance) return at;
  return { x: me.x + (dx / len) * distance, y: at.y, z: me.z + (dz / len) * distance };
}

/** Actions delegated to the NPC system (ADR-0006/0011). */
function npcAct(name: string, shape: Shape): ActionDef {
  // `instant`: apply the end state now (teleport, final pose), as a skipped scene does; used by
  // restore sequences that rebuild the cast after a load (ADR-0023).
  return act({ ...shape, wait, instant: optional(bool) }, (s, ctx) => {
    if (!ctx.host.npc) {
      ctx.missing(`NPC actions (${name})`);
      return;
    }
    const r = ctx.host.npc(name, s as Record<string, unknown>);
    if ((s as { wait?: boolean }).wait && r) return pending(r);
  });
}

// ------------------------------------------------------------------ conversation shots

/** Frame `ref` (an NPC subject is tracked: the shot follows them as they walk in or turn) and release the shot when the sequence ends. */
function aim(ctx: ActionContext, ref: TargetRef, duration: number, give: number, known?: Vec3Like, opts?: FrameOptions): boolean {
  const at = known ?? resolve('playerFrame', ref, ctx);
  if (!at) return false;
  const moving = typeof ref === 'string' && ref.startsWith('npc:');
  ctx.host.frame?.(at, duration, give, moving ? () => ctx.host.resolve(ref) : undefined, opts);
  ctx.onEnd(() => ctx.host.frame?.(null, 0, 0));
  return true;
}

/** The running speaker shot of each sequence (one per sequence; the next `playerFrame` step cancels it). */
const CONVERSATIONS = new WeakMap<SequenceHost, Map<string, () => void>>();

function endConversation(ctx: ActionContext): void {
  const mine = CONVERSATIONS.get(ctx.host);
  const off = mine?.get(ctx.seqId);
  if (!off) return;
  mine!.delete(ctx.seqId);
  off();
}

/** A line's `to` addressee as a shot target: a speaker id, or an NPC id the host can find. Null for Jay and nobody. */
function addresseeTarget(ctx: ActionContext, to: unknown): TargetRef | null {
  if (typeof to !== 'string' || !to || to === 'player') return null;
  const bySpeaker = ctx.host.speakerTarget?.(to);
  if (bySpeaker) return bySpeaker;
  const id = to.startsWith('npc:') ? to.slice(4) : to;
  const ref: TargetRef = `npc:${id}`;
  return ctx.host.resolve(ref) ? ref : null;
}

function beginConversation(ctx: ActionContext, duration: number, give: number): void {
  let last: TargetRef | null = null;
  const off = ctx.listen('speech:started', (payload) => {
    const { speaker, to, priority } = (payload ?? {}) as { speaker?: unknown; to?: unknown; priority?: unknown };
    // Overheard crew talk never turns the view (dialogue-channels).
    if (typeof speaker !== 'string' || priority === 'background') return;
    // A bodiless speaker (Jay) talking to someone turns the view to that addressee (intro-sequence spec).
    const who = ctx.host.speakerTarget?.(speaker) ?? addresseeTarget(ctx, to);
    if (!who || who === last) return; // Jay's unaddressed lines and unknown speakers keep the current shot
    if (aim(ctx, who, duration, give)) last = who;
  });
  let map = CONVERSATIONS.get(ctx.host);
  if (!map) CONVERSATIONS.set(ctx.host, (map = new Map()));
  map.set(ctx.seqId, off);
  ctx.onEnd(() => endConversation(ctx));
}

// ----------------------------------------------------------------------------- the table

export const ACTIONS: Record<string, ActionDef> = {
  // ---- flow
  wait: act({ s: numRange(0, 3600) }, (s) => timed(s.s)),

  /**
   * Wait for an event (or any of several). Level trigger emits also count (`trigger:fired`
   * carrying that name, with or without the `trigger:` prefix). `flag`: set to true if the event
   * came, false on timeout, so a later `if` can branch on it.
   */
  waitFor: act({ event: (v, p) => (Array.isArray(v) ? arr(str)(v, p) : str(v, p)), timeout: optional(numRange(0, 3600)), flag: optional(str), match: optional(record(scalar)), min: optional(record(num)) }, (s, ctx) => {
    let fired = false;
    let left = s.timeout ?? Infinity;
    const names = new Set(Array.isArray(s.event) ? s.event : [s.event]);
    // `match`: payload fields that must equal these; `min`: numeric payload fields that must reach these (e.g. a task's progress).
    const fits = (payload: unknown): boolean => {
      const got = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(s.match ?? {})) if (got[k] !== v) return false;
      for (const [k, v] of Object.entries(s.min ?? {})) if (!(typeof got[k] === 'number' && (got[k] as number) >= v)) return false;
      return true;
    };
    const hit = (payload?: unknown): void => {
      if (fits(payload)) fired = true;
    };
    const offs = [...names].map((n) => ctx.listen(n, hit));
    offs.push(
      ctx.listen('trigger:fired', (p) => {
        const e = (p as { event?: string } | null)?.event ?? '';
        if (names.has(e) || names.has(`trigger:${e}`)) hit(p);
      }),
    );
    const off = (): void => {
      for (const o of offs) o();
    };
    if (s.flag) ctx.host.flags[s.flag] = false;
    return {
      update(dt) {
        left -= dt;
        const done = fired || left <= 0;
        if (done) {
          off();
          if (s.flag) ctx.host.flags[s.flag] = fired;
        }
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
      const have = s.flag.startsWith('running:') ? ctx.isRunning(s.flag.slice(8)) : (ctx.host.flags[s.flag] ?? false);
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

  /** Switch Jay's flashlight on or off whatever the controls allow (the valve cutscene lights the hall for the charge). */
  playerFlashlight: act({ on: bool }, (s, ctx) => {
    if (!ctx.host.setFlashlight) return ctx.missing('playerFlashlight');
    ctx.host.setFlashlight(s.on);
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

  /**
   * Scripted shot (intro-sequence spec): the view eases onto `target` and stays there, with `give`
   * degrees (default 6) of mouse give that springs back. Released when the sequence ends.
   * `"target": "speaker"` starts a conversation shot: on each `speech:started` the view turns to
   * whoever speaks (`host.speakerTarget`), taking `duration` (default 0.6) to ease over; Jay's own
   * lines and speakers without a body keep the current shot. `initial` sets the first aim.
   * The shot runs until the sequence ends or a later `playerFrame` (any target, or `clear`) replaces it.
   * `"target": "heading"` (intro-sequence spec) faces along Jay's scripted walk instead, with `give` default 35 deg of
   * leeway that holds `hold` s (default 0.5) before settling back. `hold` and `returnTime` (the spring-back time
   * constant) also widen a normal shot into a soft nudge (`give: 35, hold: 0.5`).
   */
  playerFrame: act(
    { target: optional(target), initial: optional(target), duration: optional(numRange(0, 30)), give: optional(numRange(0, 60)), hold: optional(numRange(0, 5)), returnTime: optional(numRange(0.02, 3)), clear: optional(bool), wait },
    (s, ctx) => {
      if (!ctx.host.frame) return ctx.missing('playerFrame');
      endConversation(ctx);
      if (s.clear || !s.target) {
        ctx.host.frame(null, 0, 0);
        return;
      }
      const opts: FrameOptions = { ...(s.hold !== undefined ? { hold: s.hold } : {}), ...(s.returnTime !== undefined ? { returnTime: s.returnTime } : {}) };
      if (s.target === 'heading') {
        if (!ctx.host.frameHeading) return ctx.missing('playerFrame heading');
        const duration = s.duration ?? 0.8;
        ctx.host.frameHeading(duration, s.give ?? 35, { hold: 0.5, returnTime: 0.3, ...opts });
        ctx.onEnd(() => ctx.host.frame?.(null, 0, 0));
        if (s.wait) return timed(duration);
        return;
      }
      if (s.target === 'speaker') {
        const duration = s.duration ?? 0.6;
        const give = s.give ?? 6;
        if (s.initial !== undefined) aim(ctx, s.initial, duration, give);
        beginConversation(ctx, duration, give);
        if (s.wait) return timed(duration);
        return;
      }
      const at = resolve('playerFrame', s.target, ctx);
      if (!at) return;
      const duration = s.duration ?? 0.8;
      aim(ctx, s.target, duration, s.give ?? 6, at, opts);
      if (s.wait) return timed(duration);
    },
  ),

  /** `timeout` (with `wait`): if Jay has not arrived by then (blocked), he is placed there (the skip end state). */
  /** `via`: an authored level walk (ADR-0028) to follow on the way, as a smooth curve. */
  playerWalkTo: act({ to: target, via: optional(str), speed: optional(numRange(0.1, 10)), timeout: optional(numRange(0.5, 120)), distance: optional(numRange(0.2, 20)), wait }, (s, ctx) => {
    const at = walkGoal(s.to, s.distance, ctx);
    if (!at) return;
    if (!ctx.host.walkTo) return ctx.missing('playerWalkTo');
    const p = ctx.host.walkTo(at, s.speed, s.via);
    if (!s.wait) return;
    if (s.timeout === undefined) return pending(p);
    const arrived = pending(p);
    let left = s.timeout;
    const snap = (): void => ctx.host.placePlayer?.({ x: at.x, y: undefined, z: at.z }, undefined, undefined);
    return {
      update(dt) {
        if (arrived.update(dt)) return true;
        left -= dt;
        if (left > 0) return false;
        snap();
        return true;
      },
    };
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

  /** A room intercom (overhaul-priya-r08-death D25): `on` goes live with a click and static, `off` clicks it dead. */
  intercom: act({ id: str, state: oneOf(['on', 'off'] as const) }, (s, ctx) => {
    if (!ctx.host.intercom) return ctx.missing('intercom');
    if (!ctx.host.intercom(s.id, s.state === 'on')) ctx.host.warn(`${ctx.seqId}: intercom "${s.id}" is not in the level`);
  }),

  /**
   * Project an NPC's voice for the rest of the sequence (voice-playback: A scene can project a voice): its local lines are
   * no quieter than at `at` m. Cleared when the sequence ends, or with `at: 0`.
   */
  voiceProject: act({ npc: str, at: numRange(0, 30), clear: optional(bool) }, (s, ctx) => {
    if (!ctx.host.projectVoice) return ctx.missing('voiceProject');
    const npc = s.npc.startsWith('npc:') ? s.npc.slice(4) : s.npc;
    if (s.at <= 0) return ctx.host.projectVoice(npc, null);
    ctx.host.projectVoice(npc, s.at, s.clear === true);
    ctx.onEnd(() => ctx.host.projectVoice?.(npc, null));
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
  /** `via`: an authored level walk (ADR-0028) to follow on the way, as a smooth curve. */
  /** `whenUnseen`: move off-stage the moment Jay cannot see the NPC, even mid-walk (skipped: at once). */
  /** `settle`: a seated or leaning pose (`sit_chair`, `lean_counter`) to take on arrival, at the target's feet and facing; with `whenUnseen` it is taken the moment the NPC is placed. */
  npcMoveTo: npcAct('npcMoveTo', { npc: str, to: target, via: optional(str), speed: optional(numRange(0.1, 10)), pose: optional(str), whenUnseen: optional(bool), settle: optional(str), face: optional(target) }),
  /** `by` drags the body along on a rope (lying pose, no gait); `stop` lets go. Skipped: let go. */
  npcDrag: npcAct('npcDrag', { npc: str, by: optional(str), pose: optional(str), distance: optional(numRange(0.3, 4)), stop: optional(bool) }),
  npcAnim: npcAct('npcAnim', { npc: str, anim: str }),
  /** Cut limbs off (a door shearing its arms); the pieces fly along `dir`. */
  npcSever: npcAct('npcSever', { npc: str, regions: arr(oneOf(SEVERABLE_REGIONS)), dir: optional(vec3) }),
  /** `turn`: swing the whole body to face the target, not just the head. */
  npcLookAt: npcAct('npcLookAt', { npc: str, target, turn: optional(bool), turnRate: optional(num) }),
  npcTask: npcAct('npcTask', { npc: str, task: str, args: optional(record(scalar)) }),
  /** `stay`: hold a squadmate where he is even after the sequence ends (until a later `npcFollow`). */
  npcFollow: npcAct('npcFollow', { npc: str, target: optional(target), stop: optional(bool), stay: optional(bool) }),
  transform: npcAct('transform', { npc: str, to: num, duration: optional(numRange(0, 120)) }),
  /**
   * A scripted infected kill (infection-kills spec, data/kills.json): `kind` is the kill style (default `grownInside`).
   * `glass`: the partition she staggers to and pounds on; `lines`: beat id -> the line whose end closes that beat; `creature`:
   * the creature's look (default the style's). Emits `kill:<beat>` as each beat begins and `kill:done` at the end.
   * Skipped or restored (`instant`): the end state (torn corpse, the creature standing).
   */
  // A `mauled` kill (medbay-attack spec) names its `attacker` (an NPC already there) and the level points its beats use
  // (`marks`: e.g. { cart: 'anchor:r08_cart_top' }).
  kill: npcAct('kill', { npc: str, kind: optional(str), glass: optional(target), lines: optional(record(str)), creature: optional(str), creatureId: optional(str), attacker: optional(str), marks: optional(record(target)) }),
  spawn: npcAct('spawn', { npc: str, kind: optional(str), at: target }),
  despawn: npcAct('despawn', { npc: str }),
  attachToTrack: npcAct('attachToTrack', { npc: str, track: str, speed: optional(numRange(0.1, 20)), pose: optional(str) }),

  // ---- enemies (ADR-0007)
  /**
   * Trigger a level spawn group (points with `group` and `active: false`). With `wait` the step ends
   * when every enemy of the group is dead (`group:cleared`). Skipped: the group spawns, no wait. `from: "npc:<id>"`:
   * that NPC becomes the group's enemy, starting where it stands (infection-kills: the creature breaks out).
   */
  spawnGroup: act({ group: str, wait, from: optional(str) }, (s, ctx) => {
    if (!ctx.host.spawnGroup) return ctx.missing('spawnGroup');
    if (!ctx.host.spawnGroup(s.group, s.from)) ctx.host.warn(`${ctx.seqId}: spawnGroup: "${s.group}" is unknown or already triggered`);
    if (!s.wait) return;
    let cleared = ctx.host.groupCleared?.(s.group) ?? false;
    const off = ctx.listen('group:cleared', (p) => {
      if ((p as { group?: string } | null)?.group === s.group) cleared = true;
    });
    return {
      update: () => {
        if (cleared) off();
        return cleared;
      },
      cancel: off,
    };
  }),
  /** Remove a group's enemies and drop its queued spawns at once. */
  despawnGroup: act({ group: str }, (s, ctx) => {
    if (!ctx.host.despawnGroup) return ctx.missing('despawnGroup');
    if (!ctx.host.despawnGroup(s.group)) ctx.host.warn(`${ctx.seqId}: despawnGroup: no group "${s.group}"`);
  }),
  // ---- squad placement (squad-tasks / scene-gathering specs)
  /**
   * Bring every squadmate farther than `distance` (default 12 m) from Jay and out of his view to a
   * spot near him, behind him where possible. Instant; the first step of a squad job beat.
   */
  squadRegroup: act({ distance: optional(numRange(1, 200)) }, (s, ctx) => {
    if (!ctx.host.squadRegroup) return ctx.missing('squadRegroup');
    ctx.host.squadRegroup(s.distance);
  }),
  /**
   * Bring any squadmate outside `room` inside it without popping visibly in front of Jay
   * (morning-briefing spec): prefers an unseen spot at `at` (e.g. inside the doorway) or behind
   * Jay inside the room; leaves visible squadmates walking naturally. Instant.
   * Skipped: places any outside squadmates inside the room.
   */
  squadCatchUpIn: act({ room: str, at: optional(target), force: optional(bool) }, (s, ctx) => {
    if (!ctx.host.squadCatchUpIn) return ctx.missing('squadCatchUpIn');
    const entry = s.at !== undefined ? resolve('squadCatchUpIn', s.at, ctx) : null;
    ctx.host.squadCatchUpIn(s.room, entry, s.force === true);
  }),
  /**
   * Wait until Jay and both squadmates are inside `room` (before a scene seals the door behind them).
   * After `timeout` (default 8 s) squadmates still outside are placed inside near Jay; the step then
   * waits for Jay alone. Skipped: the squad is placed inside and the step ends.
   */
  gatherIn: act({ room: str, timeout: optional(numRange(0, 120)) }, (s, ctx) => {
    const host = ctx.host;
    if (!host.inRoom || !host.squadPlaceIn) return ctx.missing('gatherIn');
    const inRoom = host.inRoom.bind(host);
    let left = s.timeout ?? GATHER_TIMEOUT;
    let placed = false;
    const place = (): void => {
      if (placed) return;
      placed = true;
      host.squadPlaceIn!(s.room);
    };
    return {
      update: (dt) => {
        left -= dt;
        const squadIn = inRoom('giles', s.room) && inRoom('okafor', s.room);
        if (!squadIn && left <= 0) place();
        return inRoom('player', s.room) && (squadIn || placed);
      },
      skip: place,
    };
  }),
  /**
   * Wait until Jay is inside `room`, for at most `timeout` s (overhaul-priya-r08-death D23: the creature waits for him to
   * step out of the armory, but not forever). Skipped: nothing to wait for.
   */
  waitPlayerIn: act({ room: str, timeout: numRange(0, 120) }, (s, ctx) => {
    if (!ctx.host.inRoom) return ctx.missing('waitPlayerIn');
    const inRoom = ctx.host.inRoom.bind(ctx.host);
    let left = s.timeout;
    return {
      update: (dt) => {
        left -= dt;
        return left <= 0 || inRoom('player', s.room);
      },
    };
  }),
  /** Wait until every enemy of a group is dead (at once if it already is), with an optional timeout. Skipped: nothing to wait for. */
  waitGroup: act({ group: str, timeout: optional(numRange(0, 3600)) }, (s, ctx) => {
    if (!ctx.host.groupCleared) return ctx.missing('waitGroup');
    let cleared = ctx.host.groupCleared(s.group) || ctx.host.flags[`group:${s.group}`] === 'cleared';
    let left = s.timeout ?? Infinity;
    const off = ctx.listen('group:cleared', (p) => {
      if ((p as { group?: string } | null)?.group === s.group) cleared = true;
    });
    return {
      update: (dt) => {
        left -= dt;
        const done = cleared || left <= 0;
        if (done) off();
        return done;
      },
      cancel: off,
    };
  }),
  /**
   * Gore set dressing (ADR-0014 beat 5): `burst` spray, `chunks` of torn flesh, a growing floor `pool`, or a
   * `splash` (burst + pool) at `at`, thrown along `dir` (default up). `clipAxis`/`clipAt`/`clipKeep` (above|below, default above) stop the
   * spray and chunks at a plane, e.g. the bay glass, so none shows on the far side. Instant, cosmetic, skipped scenes drop it.
   */
  gore: act(
    { at: target, kind: oneOf(['burst', 'chunks', 'pool', 'splash'] as const), dir: optional(target), count: optional(numRange(1, 200)), size: optional(numRange(0.1, 6)), clipAxis: optional(oneOf(['x', 'y', 'z'] as const)), clipAt: optional(num), clipKeep: optional(oneOf(['above', 'below'] as const)) },
    (s, ctx) => {
      const at = resolve('gore', s.at, ctx);
      if (!at) return;
      const dir = s.dir !== undefined ? ctx.host.resolve(s.dir) : null;
      if (!ctx.host.gore) return ctx.missing('gore');
      const clip = s.clipAxis !== undefined && s.clipAt !== undefined ? { axis: s.clipAxis, at: s.clipAt, keep: s.clipKeep ?? 'above' } : undefined;
      ctx.host.gore(s.kind, at, dir ?? { x: at.x, y: at.y + 1, z: at.z }, s.count, s.size, clip);
    },
  ),
  /** A black title card over the game (ADR-0014 beat 8): `title`, an optional `sub`, held `s` seconds, then it fades. */
  titleCard: act({ title: str, sub: optional(str), s: optional(numRange(0.5, 60)), wait }, (s, ctx) => {
    if (!ctx.host.titleCard) return ctx.missing('titleCard');
    ctx.host.titleCard(s.title, s.sub ?? '', s.s ?? 4);
    if (s.wait) return timed(s.s ?? 4);
  }),
  /**
   * NPC hand-off (intro-sequence spec): the NPC holds `item` out and an interact prompt appears on them;
   * taking it emits `event` (default `<sequence id>:offer_taken`). Waits for that or for
   * `timeout` (then the NPC hands it over anyway) unless `"wait": false`, the exception to the
   * wait rule like `say`. Either way the item ends up with Jay: flag `held:<item>`.
   * Skip end state: handed over, the NPC back to standing.
   */
  npcOffer: act(
    { npc: str, item: str, prompt: optional(str), timeout: optional(numRange(0, 600)), event: optional(str), wait },
    (s, ctx) => {
      const event = s.event ?? `${ctx.seqId}:offer_taken`;
      if (!ctx.host.npc) ctx.missing('NPC actions (npcOffer)');
      else void ctx.host.npc('npcOffer', { ...s, event });
      let done = false;
      let left = s.timeout ?? Infinity;
      let off: () => void = () => undefined;
      const finish = (): void => {
        if (done) return;
        done = true;
        off();
        ctx.host.flags[`held:${s.item}`] = true;
        void ctx.host.npc?.('npcOfferEnd', { npc: s.npc, item: s.item });
      };
      off = ctx.listen(event, finish);
      ctx.onEnd(finish);
      if (s.wait === false) return;
      return {
        update(dt) {
          left -= dt;
          if (left <= 0) finish();
          return done;
        },
      };
    },
  ),

  // ---- world
  doorState: act({ id: str, state: oneOf(DOOR_STATES), ifAllIn: optional(str) }, (s, ctx) => {
    if (!ctx.host.setDoor) return ctx.missing('doorState');
    if (s.ifAllIn !== undefined && ctx.host.inRoom) {
      const r = s.ifAllIn;
      if (!ctx.host.inRoom('player', r) || !ctx.host.inRoom('giles', r) || !ctx.host.inRoom('okafor', r)) return;
    }
    if (!ctx.host.setDoor(s.id, s.state)) ctx.host.warn(`${ctx.seqId}: doorState: no door "${s.id}"`);
  }),

  /**
   * Force a sliding door's leaves part-open (level-kit spec): `open` 0..1 over `s` seconds, without changing its state.
   * A sealed door stays sealed while something pries it; the next `doorState` closes or opens it from there.
   */
  doorPry: act({ id: str, open: numRange(0, 1), s: optional(numRange(0, 10)) }, (s, ctx) => {
    if (!ctx.host.pryDoor) return ctx.missing('doorPry');
    if (!ctx.host.pryDoor(s.id, s.open, s.s ?? 0.6)) ctx.host.warn(`${ctx.seqId}: doorPry: no door "${s.id}"`);
  }),

  /** Knock a room's swinging lamps (a blast, the hull taking a hit): `strength` rad/s of swing, default 1.2. */
  lightJolt: act({ room: str, strength: optional(numRange(0, 4)) }, (s, ctx) => {
    if (!ctx.host.joltLights) return ctx.missing('lightJolt');
    if (!ctx.host.joltLights(s.room, s.strength ?? 1.2)) ctx.host.warn(`${ctx.seqId}: lightJolt: no swinging lamps in room "${s.room}"`);
  }),

  /**
   * `tint`: "emergency" turns the room's lights and ambient emergency red, "none" restores the
   * level's colours, or a "#rrggbb" colour (ADR-0014 beat 2).
   */
  lightState: act({ room: str, pattern: oneOf(LIGHT_PATTERNS), tint: optional(str) }, (s, ctx) => {
    if (!ctx.host.setLight) return ctx.missing('lightState');
    if (!ctx.host.setLight(s.room, s.pattern, s.tint)) ctx.host.warn(`${ctx.seqId}: lightState: no lights in room "${s.room}"`);
  }),

  /**
   * Security camera feed (ADR-0023 glimpse, ADR-0014 stinger): render the view from `from`
   * towards `lookAt` onto the mesh named `feed:<id>` with a CCTV look, or full screen. `state`
   * live | static | off. Instant (a skipped scene just applies the last state).
   */
  cameraFeed: act(
    {
      id: str,
      from: optional(target),
      lookAt: optional(target),
      state: oneOf(['live', 'static', 'off'] as const),
      fullscreen: optional(bool),
      label: optional(str),
      fov: optional(numRange(10, 120)),
      fps: optional(numRange(1, 240)),
      size: optional(obj({ w: numRange(16, 3840), h: numRange(16, 2160) })),
      look: optional(oneOf(['monitor', 'fullscreen'] as const)),
    },
    (s, ctx) => {
      const from = s.from !== undefined ? resolve('cameraFeed', s.from, ctx) : null;
      const look = s.lookAt !== undefined ? resolve('cameraFeed', s.lookAt, ctx) : null;
      // The in-world placeholder screen (security_monitor prop) follows the same state.
      ctx.host.events.emit('camera:feed', { id: s.id, state: s.state });
      if (!ctx.host.cameraFeed) return ctx.missing('cameraFeed');
      ctx.host.cameraFeed(s.id, {
        state: s.state,
        from,
        lookAt: look,
        fullscreen: s.fullscreen === true,
        ...(s.label !== undefined ? { label: s.label } : {}),
        ...(s.fov !== undefined ? { fov: s.fov } : {}),
        ...(s.fps !== undefined ? { fps: s.fps } : {}),
        ...(s.size !== undefined ? { size: { w: Math.round(s.size.w), h: Math.round(s.size.h) } } : {}),
        ...(s.look !== undefined ? { look: s.look } : {}),
      });
    },
  ),

  /** In-world radio, e.g. TAG FM in the kitchen (intro-sequence spec). Instant; on skip it simply starts. */
  radio: act({ track: optional(str), at: optional(target), stop: optional(bool) }, (s, ctx) => {
    if (!ctx.host.radio) return ctx.missing('radio');
    if (s.stop || !s.track) return ctx.host.radio(null, null);
    const at = s.at ? resolve('radio', s.at, ctx) : null;
    ctx.host.radio(s.track, at);
  }),

  /**
   * A `ceiling_vent` grate (trim-lab-wing-encounters): `open` swings it down on its hinge, `fallen` tears it loose to the
   * floor, `closed` puts it back. `instant` snaps (restores); a skip lands on the state at once.
   */
  ventState: act({ id: str, state: oneOf(['closed', 'open', 'fallen'] as const), instant: optional(bool) }, (s, ctx) => {
    if (!ctx.host.ventState) return ctx.missing('ventState');
    ctx.host.ventState(s.id, s.state, s.instant ?? false);
  }),

  glass: act({ id: str, state: oneOf(['intact', 'cracked', 'shattered'] as const) }, (s, ctx) => {
    if (!ctx.host.glass) return ctx.missing('glass');
    ctx.host.glass(s.id, s.state);
  }),

  /**
   * Station power (station-power spec): `backup` puts every room on its backup lights, `mains` restores them. Saved in
   * the `station_power` flag, which `action_restore` reapplies on load. Instant, so a skipped scene just applies it.
   */
  power: act({ state: oneOf(['mains', 'backup'] as const) }, (s, ctx) => {
    ctx.host.flags[POWER_FLAG] = s.state;
    if (!ctx.host.setPower) return ctx.missing('power');
    ctx.host.setPower(s.state);
  }),

  /** A room's standing water rises or falls to `level` (world y) over `s` seconds (standing-water spec); skip lands on `level`. */
  water: act({ room: str, level: num, s: optional(numRange(0, 600)), wait }, (s, ctx) => {
    if (!ctx.host.water) return ctx.missing('water');
    if (!ctx.host.water(s.room, s.level, s.s ?? 0)) return ctx.host.warn(`${ctx.seqId}: water: no water in room "${s.room}"`);
    if (s.wait && s.s) return timed(s.s);
  }),

  /** One named light alone (render-lighting spec): `pattern`, `tint` ("emergency", "#rrggbb" or "none"), and optional auxiliary `power` in [0, 1]. */
  light: act({ id: str, pattern: oneOf(LIGHT_PATTERNS), tint: optional(str), power: optional(numRange(0, 1)) }, (s, ctx) => {
    if (!ctx.host.light) return ctx.missing('light');
    if (!ctx.host.light(s.id, s.pattern, s.tint, s.power)) ctx.host.warn(`${ctx.seqId}: light: no light "${s.id}"`);
  }),

  /** `beat: true`: land on the score's next beat (adaptive-music spec), or play at once with no score. */
  // `relay: false`: a positioned sound that live intercoms do not carry (the medical bay monitor beep).
  sfx: act({ id: str, at: optional(target), beat: optional(bool), gain: optional(numRange(0.05, 20)), relay: optional(bool) }, (s, ctx) => {
    if (!ctx.host.sfx) return ctx.missing('sfx');
    const opts = { ...(s.beat ? { beat: true } : {}), ...(s.gain !== undefined ? { gain: s.gain } : {}), ...(s.relay === false ? { relay: false } : {}) };
    ctx.host.sfx(s.id, s.at !== undefined ? resolve('sfx', s.at, ctx) : null, Object.keys(opts).length > 0 ? opts : undefined);
  }),

  /** Adaptive score (adaptive-music spec, data/scores.json): `load` it ahead, set a `cue`, or fire a `stinger`. */
  score: act({ id: oneOf(SCORE_IDS), cue: optional(str), stinger: optional(str), load: optional(bool) }, (s, ctx) => {
    if (!ctx.host.score) return ctx.missing('score');
    ctx.host.score(s.id, { ...(s.cue !== undefined ? { cue: s.cue } : {}), ...(s.stinger !== undefined ? { stinger: s.stinger } : {}), ...(s.load ? { load: true } : {}) });
  }),

  /** `level`: how loud the track plays (default 1). A later step with the same `id` dips or restores it. */
  music: act({ id: optional(oneOf(MUSIC_TRACKS)), stop: optional(bool), level: optional(numRange(0, 1)) }, (s, ctx) => {
    if (!ctx.host.music) return ctx.missing('music');
    ctx.host.music(s.stop ? null : (s.id ?? null), s.level);
  }),

  ambience: act({ id: str }, (s, ctx) => {
    if (!ctx.host.ambience) return ctx.missing('ambience');
    ctx.host.ambience(s.id);
  }),

  // ---- story
  /**
   * Silence everything but the scene (stinger-feed-and-rise): the world's ambience and sound effects fade out and only
   * `speakers` can be heard (none when left out); music and the menu stay. `off` brings it all back. Going to the title
   * or restarting lifts it too. Instant either way.
   */
  // `keep: ["sfx"]` leaves sound effects up, so the scene's own sounds carry in the quiet (the Lab B escape in the dark).
  /**
   * Stop another sequence now (cancelled where it stands, nothing more of it plays) and, unless `speech: false`, cut every
   * line still playing. The R07 scene opens this way: stepping into the room ends the R06 aftermath talk at once.
   */
  stopSequence: act({ id: str, speech: optional(bool) }, (s, ctx) => {
    ctx.cancelSequence(s.id);
    if (s.speech !== false) ctx.host.stopSpeech?.();
  }),
  hush: act({ speakers: optional(arr(str)), off: optional(bool), s: optional(numRange(0, 10)), keep: optional(arr(oneOf(['sfx'] as const))) }, (s, ctx) => {
    if (!ctx.host.hush) return ctx.missing('hush');
    ctx.host.hush(s.off ? null : (s.speakers ?? []), s.s ?? 0.5, s.keep);
  }),
  /** `overlap`: play beside the current line instead of queuing (a PA the squad talks over). */
  /**
   * Say a line. `line` may be a pool: each time the step runs it says the next one in turn. With `cooldown`, a run of
   * the step within that many seconds of its last line says nothing (Jay's shouts as he bangs on the medbay glass).
   * `channel` names a side conversation inside the sequence (the guard scanning Ruiz while Sung talks with Jay): its
   * lines keep their own order but never queue behind the sequence's main conversation, or it behind them.
   */
  say: act({ line: (v, p) => (Array.isArray(v) ? arr(str)(v, p) : str(v, p)), wait, overlap: optional(bool), fixture: optional(str), to: optional(str), cooldown: optional(numRange(0, 60)), channel: optional(str) }, (s, ctx) => {
    if (!ctx.host.say) return ctx.missing('say');
    let line: string;
    if (Array.isArray(s.line) || s.cooldown !== undefined) {
      const pool = Array.isArray(s.line) ? s.line : [s.line];
      const memo = sayMemo(ctx.runToken, s);
      if (s.cooldown !== undefined && ctx.elapsed < memo.freeAt) return;
      line = pool[memo.next % pool.length]!;
      memo.next++;
      memo.freeAt = ctx.elapsed + (s.cooldown ?? 0);
    } else line = s.line;
    const h = ctx.host.say(line, {
      ...(s.overlap ? { overlap: true } : {}),
      ...(s.fixture !== undefined ? { fixture: s.fixture } : {}),
      ...(s.to !== undefined ? { to: s.to } : {}),
      // A sequence is one conversation (it never runs twice at once): its lines share a channel (dialogue-channels).
      // A named side conversation gets a channel of its own, scoped to the sequence so no two sequences share one.
      channel: s.channel !== undefined ? `seq:${ctx.seqId}:${s.channel}` : `seq:${ctx.seqId}`,
    });
    if (h && s.wait !== false) return { ...pending(h.done), skip: () => ctx.host.markLinePlayed?.(line) };
  }),

  setObjective: act({ id: str }, (s, ctx) => {
    // Never reopen one that is already finished (a restore or a replayed scene).
    if (ctx.host.flags[`obj:${s.id}`] === 'done') return;
    ctx.host.flags[`obj:${s.id}`] = 'active';
    ctx.host.events.emit('objective:set', { id: s.id });
  }),

  completeObjective: act({ id: str }, (s, ctx) => {
    ctx.host.flags[`obj:${s.id}`] = 'done';
    ctx.host.events.emit('objective:done', { id: s.id });
  }),

  checkpoint: act({ id: str, label: optional(str) }, (s, ctx) => ctx.checkpoint(s.id, s.label)),

  /** Give the player a key item (ADR-0024). Instant, so a skipped scene simply runs it. */
  giveItem: act({ item: str }, (s, ctx) => {
    if (!ctx.host.giveItem) return ctx.missing('giveItem');
    if (!ctx.host.giveItem(s.item)) ctx.host.warn(`${ctx.seqId}: giveItem: "${s.item}" is unknown or already held`);
  }),

  endSlice: act({}, (_s, ctx) => {
    ctx.host.events.emit('story:slice_end', {});
    ctx.host.endSlice?.();
  }),
};

// ------------------------------------------------------------------------- skipping

const NOOP: SkipFn = () => undefined;
/** `gatherIn` default: seconds the squad gets to walk in before stragglers are placed. */
export const GATHER_TIMEOUT = 8;

/**
 * End states for skipping (intro-sequence spec). Only actions that wait, play or ease need an entry;
 * instant actions (setFlag, doorState, lightState, emit, setObjective, checkpoint...) are
 * simply run, which is their end state.
 */
const SKIPS: Record<string, SkipFn> = {
  // Things that only wait for time or events have no end state of their own.
  wait: NOOP,
  waitFor: NOOP,
  // A counted loop is a repeated block (sequential steps inside a parallel, intro-sequence spec): its end state is the
  // body applied `count` times. An endless loop (`until` an event) has no end state of its own.
  loop: (s, ctx) => {
    const st = s as unknown as { steps: Step[]; count?: number; until?: string };
    if (st.count === undefined || st.until !== undefined) return;
    for (let i = 0; i < Math.min(st.count, 10); i++) ctx.skipSteps(st.steps);
  },
  cameraShake: NOOP,
  // A projection only lasts while its sequence plays; a skipped one has none to keep.
  voiceProject: NOOP,
  waitPlayerIn: NOOP,
  ventState: (s, ctx) => void ctx.host.ventState?.(s['id'] as string, s['state'] as string, true),
  // A pry in progress snaps to its forced opening.
  doorPry: (s, ctx) => void ctx.host.pryDoor?.(s['id'] as string, s['open'] as number, 0),
  timeScale: NOOP,
  // A skipped scene leaves the light as the scene set it.
  playerFlashlight: (s, ctx) => void ctx.host.setFlashlight?.(s['on'] as boolean),
  sfx: NOOP,
  gore: NOOP,
  waitGroup: NOOP,
  gatherIn: (s, ctx) => {
    ctx.host.squadPlaceIn?.(String(s['room']));
  },
  squadCatchUpIn: (s, ctx) => {
    ctx.host.squadPlaceIn?.(String(s['room']));
  },
  if: (s, ctx) => {
    const st = s as unknown as { flag: string; is?: Scalar; then: Step[]; else?: Step[] };
    const have = st.flag.startsWith('running:') ? ctx.isRunning(st.flag.slice(8)) : (ctx.host.flags[st.flag] ?? false);
    const branch = have === (st.is ?? true) ? st.then : st.else;
    if (branch) ctx.skipSteps(branch);
  },
  // A look that was easing toward its target jumps to the final view.
  playerLookAt: (s, ctx) => {
    const at = resolve('playerLookAt', s['target'] as TargetRef, ctx);
    if (at) ctx.host.lookAt?.(at, 0.01, 1);
  },
  // A shot snaps to its final aim and lets go, so control returns facing the right way.
  playerFrame: (s, ctx) => {
    endConversation(ctx);
    if (s['clear'] || !s['target'] || s['target'] === 'speaker' || s['target'] === 'heading') return ctx.host.frame?.(null, 0, 0);
    const at = resolve('playerFrame', s['target'] as TargetRef, ctx);
    if (at) ctx.host.frame?.(at, 0, (s['give'] as number | undefined) ?? 6);
    ctx.host.frame?.(null, 0, 0);
  },
  playerWalkTo: (s, ctx) => {
    const at = walkGoal(s['to'] as TargetRef, s['distance'] as number | undefined, ctx);
    if (at) ctx.host.placePlayer?.({ x: at.x, y: undefined, z: at.z }, undefined, undefined);
  },
  fade: (s, ctx) => ctx.host.fade?.(s['to'] as number, 0),
  // The card has been and gone.
  titleCard: NOOP,
  water: (s, ctx) => void ctx.host.water?.(s['room'] as string, s['level'] as number, 0),
  light: (s, ctx) => void ctx.host.light?.(s['id'] as string, s['pattern'] as string, s['tint'] as string | undefined),
  say: (s, ctx) => ctx.host.markLinePlayed?.(s['line'] as string),
  // The hand-off is over: the item is Jay's, the NPC stands normally (no event: nobody took it).
  npcOffer: (s, ctx) => {
    ctx.host.flags[`held:${String(s['item'])}`] = true;
    if (ctx.host.npc) void ctx.host.npc('npcOffer', { ...s, wait: false, instant: true });
  },
};
for (const name of ['npcMoveTo', 'npcAnim', 'npcSever', 'npcLookAt', 'npcTask', 'npcFollow', 'transform', 'kill', 'spawn', 'despawn', 'attachToTrack', 'npcDrag']) {
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
