import * as THREE from 'three';
import { DEFAULT_MOTOR, moveBody, type ColliderQuery, type MotorConfig, type MotorState } from '../actors/motor.ts';
import type { Humanoid } from '../actors/humanoid.ts';
import { Rng } from '../core/rng.ts';
import { GIVE_WAY, GiveWay, PLAYER_RADIUS, type WayEnv } from './giveWay.ts';
import type { Navigator, P3 } from './nav.ts';
import { PathFollower, planWalk, roundCorners } from './walkPath.ts';

/**
 * One scriptable NPC body (ADR-0009 NPC actions, intro-sequence spec, ADR-0023 crew). Wraps a
 * Humanoid and its motor state; the squad lends theirs while a sequence drives them.
 *
 * Commands replace each other per channel (move, anim, look): a new move resolves the
 * previous move's promise, so `wait` on a step that a skip overrides never hangs.
 */

/** Scripted gestures: pose to blend to, seconds to hold it (Infinity = until changed), and blend time. */
export const NPC_ANIMS: Readonly<Record<string, { pose: string; hold: number; blend?: number }>> = {
  rub_forearm: { pose: 'rub_forearm', hold: 2.4 },
  flex_hand: { pose: 'flex_hand', hold: 1.6 },
  offer_mug: { pose: 'offer_mug', hold: Infinity, blend: 0.5 },
  drink: { pose: 'drink', hold: 1.8 },
  glance: { pose: 'glance', hold: 1.3, blend: 0.3 },
  cough: { pose: 'cough', hold: 0.9, blend: 0.15 },
  gesture: { pose: 'talk_gesture', hold: 1.4 },
  typing: { pose: 'typing', hold: Infinity },
  sit_idle: { pose: 'sit_idle', hold: Infinity },
  sit_typing: { pose: 'sit_typing', hold: Infinity },
  panel_work: { pose: 'panel_work', hold: Infinity },
  biometric_scan: { pose: 'biometric_scan', hold: Infinity },
  crouchWork: { pose: 'crouchWork', hold: Infinity },
  kneel: { pose: 'kneel_revive', hold: Infinity },
  idle: { pose: 'idle', hold: 0 },
  // dock-checkpoint: a scan. The arrival holds `arms_out` while the guard shifts weight (`wand_attend`), sweeps the wand
  // in one continuous reach and pass (`wand_up` -> `wand_down`), and recovers to `idle_wand`.
  arms_out: { pose: 'arms_out', hold: Infinity, blend: 0.45 },
  idle_wand: { pose: 'idle_wand', hold: Infinity, blend: 0.5 },
  wand_attend: { pose: 'wand_attend', hold: Infinity, blend: 0.45 },
  wand_up: { pose: 'wand_up', hold: 0.55, blend: 0.45 },
  wand_down: { pose: 'wand_down', hold: 0.8, blend: 0.65 },
  // flooded-tunnel / rig-necromorph: R10 ambush door pry, timed to match `doorPry` so the blades track the leaf edges without clipping.
  pry_reach: { pose: 'pry_reach', hold: Infinity, blend: 0.18 },
  pry_clamp: { pose: 'pry_clamp', hold: Infinity, blend: 0.25 },
  pry_wrench: { pose: 'pry_wrench', hold: Infinity, blend: 1.28 },
  pry_thrust: { pose: 'pry_thrust', hold: Infinity, blend: 0.35 },
  // flooded-tunnel: squad urgent doorway-watching and panicked recoil stances.
  alarm_watch: { pose: 'alarm_watch', hold: Infinity, blend: 0.35 },
  panic_brace: { pose: 'panic_brace', hold: Infinity, blend: 0.3 },
};

/** Small ambient gestures by base pose, picked now and then while an NPC is idle. */
const AMBIENT_GESTURES: Readonly<Record<string, readonly string[]>> = {
  idle: ['idle_weight', 'idle_shift', 'glance', 'glance_other', 'talk_gesture', 'look_down', 'look_up', 'head_tilt'],
  // Placed arms stay placed: these gestures move only the head (keep-crossed-arms).
  idle_crossed: ['idle_crossed_glance', 'idle_crossed_glance_other', 'idle_crossed_look_down'],
  idle_hips: ['idle_hips_glance', 'idle_hips_glance_other', 'idle_hips_look_up'],
  idle_weight: ['glance', 'glance_other', 'idle_shift', 'look_down', 'head_tilt'],
  idle_mug: ['drink', 'glance', 'glance_other'],
  clipboard: ['glance', 'glance_other'],
  typing: ['glance', 'glance_other'],
  // ADR-0029 seated and leaning bodies: each gesture extends its base pose, so the legs stay put.
  // Drink gestures only where the base already holds a mug, so a mug never pops into an empty hand.
  sit_chair: ['sit_chair_glance', 'sit_chair_glance_other', 'sit_chair_look_down', 'sit_chair_lean', 'sit_chair_hands'],
  sit_stool: ['sit_stool_glance', 'sit_stool_glance_other', 'sit_stool_look_down'],
  sit_sofa: ['sit_sofa_glance', 'sit_sofa_glance_other', 'sit_sofa_look_down'],
  lean_wall: ['lean_wall_glance', 'lean_wall_glance_other', 'lean_wall_look_down', 'lean_wall_hands'],
  lean_counter: ['lean_counter_glance', 'lean_counter_glance_other', 'lean_counter_look_down'],
  lean_back: ['lean_back_glance', 'lean_back_glance_other', 'lean_back_look_down'],
  lean_back_mug: ['lean_back_mug_drink', 'lean_back_mug_glance', 'lean_back_mug_glance_other', 'lean_back_mug_drink', 'lean_back_mug_look_down'],
};

/** ADR-0029: sitting or leaning on something. Such a body never steps aside and is not shoved. */
export const PLACED_POSE = /^(sit_|lean_)/;

export const NPC_TUNING = {
  walk: 1.3,
  arrive: 0.25,
  repath: 0.6,
  /** Ambient: look at Jay inside this range when he is roughly in front. */
  noticeRange: 3.5,
  /** In a conversation (ADR-0029), Jay only draws the eye this close. */
  chatNoticeRange: 1.8,
  gestureEvery: [5, 12] as const,
  /** Bodies further than this from the camera skip animation (cheap crowds). */
  sleepDistance: 28,
  hideDistance: 45,
  turnRate: 3.2,
} as const;

/** Base poses of someone working or seated in place: never shoved off their station. */
const WORK_POSES: ReadonlySet<string> = new Set(['typing', 'sit_idle', 'sit_typing', 'sit_typing_cctv', 'panel_work', 'biometric_scan', 'crouchWork', 'kneel_revive', 'wand_place', 'chair_pull']);

const MOTOR: MotorConfig = { ...DEFAULT_MOTOR, radius: 0.3 };

export interface NpcEnv {
  nav: Navigator | null;
  colliders: ColliderQuery | null;
  playerHead: THREE.Vector3;
  playerFeet: THREE.Vector3;
  camera: THREE.Vector3 | null;
  /** Additional active camera positions (e.g. live CCTV feeds) that also keep NPCs visible and awake. */
  extraCameras?: readonly THREE.Vector3[] | undefined;
  /** Unit XZ direction Jay is trying to move this step (zero = not moving); absent = never gives way. */
  playerWish?: { x: number; z: number };
  /** Is another body standing in this circle (give-way spots)? `self` is excluded. */
  occupied?: (x: number, z: number, r: number, self: NpcActor) => boolean;
  /** Every other standing or walking body (cast and squad, not Jay), for steering round them on a walk (ADR-0028). */
  bodies?: (self: NpcActor, fn: (x: number, z: number, r: number) => void) => void;
}

interface MoveCmd {
  target: THREE.Vector3;
  /** Walking the planned route (ADR-0028): speed profile, steering point. Null = plan next frame. */
  follower: PathFollower | null;
  /** A preplanned polyline (attachToTrack refs) walked as given, corners rounded. */
  track: P3[] | null;
  /** An authored walk's control points (ADR-0028), walked as a smooth curve. */
  curve: P3[] | null;
  /** Already warned that this move has no route. */
  warned: boolean;
  speed: number;
  yaw: number | undefined;
  /** Keep facing this point while walking (backing away from it); null when it has none. */
  face: (() => P3 | null) | null;
  repathT: number;
  stuckT: number;
  /** Seconds waiting on Jay in the way (capped; the move is only given up past BLOCKED_GIVE_UP). */
  blockT: number;
  /** Side (+1/-1) committed to while steering round Jay, 0 = not steering round him. */
  avoidSide: number;
  /** Side committed to while passing another body (ADR-0028), 0 = nobody in the way. */
  passSide: number;
  usePath: boolean;
  resolve: () => void;
}

/** A body pulled along by a rope (`npcDrag`): trails `dist` behind the dragger in a held pose. */
interface Tow {
  get: () => THREE.Vector3 | null;
  dist: number;
  pose: string;
}

/** A scripted walker keeps this clear of Jay's body edge ahead of it before it slows and steers round him. */
const AVOID_RANGE = 1.2;
/** A walker starts bending round another body this far ahead of the gap between them, metres (ADR-0028). */
const PASS_RANGE = 2.0;
/** Longest a scripted walker waits on Jay in its way before giving up (s). */
const BLOCKED_GIVE_UP = 8;
/** Longest a give-way sidestep or return walk may take before it is dropped (s). */
const GIVE_WAY_TIMEOUT = 6;

/** Where a body stands before it gave way to Jay, to come back to. */
interface Home {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Catch-up speed (m/s) of a towed body that has fallen behind the rope length. */
export const TOW_CATCHUP = 2.6;
/** Pose held while a downed body is moved by a script and no other pose is given. */
export const DRAG_POSE = 'corpseSupine';

const dirOf = (yaw: number, out: THREE.Vector3): THREE.Vector3 => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class NpcActor {
  readonly id: string;
  readonly body: Humanoid;
  readonly motor: MotorState;
  /** Base standing pose (from the level, or set by a persistent anim). */
  basePose: string;
  /** Item held out to Jay (npcOffer), if any. */
  offering: string | null = null;
  /** Ambient behaviour (look at Jay, small gestures) when no script is driving. */
  ambient = true;
  /**
   * Who this body looks at in a conversation (ADR-0029 chatter), below a script's look and Jay up close.
   * Null when not in a conversation.
   */
  socialLook: (() => THREE.Vector3 | null) | null = null;
  /**
   * Who to look at while a story line is spoken nearby (ADR-0029 listen-look): the speaker, or for the speaker the
   * person they answer. Below a script's own look, above everything ambient. Set and cleared by the NPC director.
   */
  talkLook: (() => THREE.Vector3 | null) | null = null;
  private move: MoveCmd | null = null;
  private tow: Tow | null = null;
  /** The current move set `body.carried` (cleared when it ends). */
  private moveCarried = false;
  private anim: { pose: string; left: number; resolve: () => void } | null = null;
  /** A captured clip played once over whatever the body is doing (`npcAnim` with `clip:<id>`), and how far through it is. */
  private clipAnim: { t: number; duration: number; resolve: () => void } | null = null;
  /** Placed pose (lean_ or sit_) waiting for arrival facing (`faceYaw`) to line up before leaning/sitting. */
  private pendingPlaced: { pose: string; blend: number } | null = null;
  private faceYaw: number | null = null;
  /** Turn speed (rad/s) for a scripted `turnTo`; null is the default settle rate. A hesitant turn is slower (medbay-attack). */
  private faceRate: number | null = null;
  private lookGet: (() => THREE.Vector3 | null) | null = null;
  private follow: { get: () => THREE.Vector3 | null; distance: number } | null = null;
  private readonly rng: Rng;
  private gestureT: number;
  private gesture: { pose: string; left: number } | null = null;
  private lastGesture = '';
  private lastPos = new THREE.Vector3();
  /** Give-way to Jay (an internal move that never touches scripted promises). */
  private readonly way = new GiveWay();
  private wayHome: Home | null = null;
  private wayPhase: 'out' | 'away' | 'back' | null = null;
  private wayT = 0;
  private wayPath: P3[] | null = null;
  private wayRepathT = 0;

  constructor(id: string, body: Humanoid, motor?: MotorState) {
    this.id = id;
    this.body = body;
    const p = body.group.position;
    this.motor = motor ?? { x: p.x, y: p.y, z: p.z, vy: 0, grounded: true };
    this.basePose = body.idlePose;
    this.rng = new Rng(`npc:${id}`);
    this.gestureT = this.rng.range(NPC_TUNING.gestureEvery[0], NPC_TUNING.gestureEvery[1]);
  }

  /** Held in a `mauled` attacker's hand (infection-kills spec): the kill places this body, nothing pushes it. */
  gripped = false;

  get position(): THREE.Vector3 {
    return this.body.group.position;
  }

  /** Eye height point, for `npc:<id>` targets (playerLookAt, playerFrame). */
  head(out = new THREE.Vector3()): THREE.Vector3 {
    return this.body.jointWorld('head', out).add(tmpA.set(0, 0.06, 0));
  }

  /** Busy with a scripted move, anim or follow. */
  get busy(): boolean {
    return this.move !== null || this.anim !== null || this.follow !== null || this.tow !== null;
  }

  /** Stepping aside for Jay (or back from it). */
  get givingWay(): boolean {
    return this.wayPhase !== null;
  }

  /** A script gave a command: drop any give-way (the body stays where it is). */
  private cancelWay(): void {
    this.wayPhase = null;
    this.wayHome = null;
    this.wayPath = null;
    this.way.reset();
  }

  get moving(): boolean {
    return this.move !== null;
  }

  /** Metres left to a scripted move's end point (null when not walking). */
  get goalDistance(): number | null {
    const m = this.move;
    return m ? Math.hypot(m.target.x - this.motor.x, m.target.z - this.motor.z) : null;
  }

  /**
   * Excluded from actor separation (ADR-0018): a carried or dragged body, and anyone working in place
   * (typing at a console, crouched at a panel, kneeling over a body, holding out an offer).
   */
  get separationExempt(): boolean {
    return this.body.state !== 'alive' || this.body.spec.role === 'corpse' || this.gripped || this.tow !== null || this.body.carried !== null || this.offering !== null || WORK_POSES.has(this.basePose) || PLACED_POSE.test(this.basePose);
  }

  /** Soft push from actor separation: slides the body (through level collision), never a teleport. */
  nudge(dx: number, dz: number, colliders: ColliderQuery | null): void {
    if (this.body.state !== 'alive' || this.body.spec.role === 'corpse') return;
    const x0 = this.motor.x;
    const z0 = this.motor.z;
    if (colliders) moveBody(this.motor, dx, dz, 1 / 60, MOTOR, colliders);
    else {
      this.motor.x += dx;
      this.motor.z += dz;
    }
    this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
    this.body.nudgeImpulse(this.motor.x - x0, this.motor.z - z0, 1 / 60);
  }

  place(at: P3, yaw?: number): void {
    this.cancelWay();
    this.pendingPlaced = null;
    this.body.stopPerformance();
    this.motor.x = at.x;
    this.motor.y = at.y;
    this.motor.z = at.z;
    this.motor.vy = 0;
    this.motor.grounded = true;
    this.body.group.position.set(at.x, at.y, at.z);
    if (yaw !== undefined) this.body.setHeading(yaw);
    this.faceYaw = null;
    this.lastPos.copy(this.body.group.position);
  }

  /** Walk to a point (pathing when a nav graph is present). `instant` teleports there. `face` keeps the body facing a point as it walks (backing away). */
  moveTo(at: P3, opts: { speed?: number; yaw?: number; instant?: boolean; track?: P3[]; curve?: P3[]; pose?: string; face?: () => P3 | null } = {}): Promise<void> {
    this.stopMove();
    this.pendingPlaced = null;
    this.follow = null;
    this.body.stopPerformance();
    if (PLACED_POSE.test(this.basePose)) {
      // Sitting or leaning (ADR-0029): stand up before walking off.
      this.gesture = null;
      this.basePose = 'idle';
      this.body.setPose('idle', opts.instant ? 0.01 : 0.5);
    }
    if (opts.pose && !opts.instant) {
      // A downed body being moved: hold a lying pose instead of the walking gait.
      this.body.carried = opts.pose;
      this.moveCarried = true;
    } else if (this.moveCarried) {
      this.moveCarried = false;
      if (!this.tow) this.body.carried = null;
    }
    if (opts.instant) {
      this.place(at, opts.yaw);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.move = {
        target: new THREE.Vector3(at.x, at.y, at.z),
        follower: null,
        track: opts.track ? opts.track.map((p) => ({ ...p })) : null,
        curve: opts.curve?.length ? opts.curve.map((p) => ({ ...p })) : null,
        warned: false,
        speed: opts.speed ?? NPC_TUNING.walk,
        yaw: opts.yaw,
        face: opts.face ?? null,
        repathT: 0,
        stuckT: 0,
        blockT: 0,
        avoidSide: 0,
        passSide: 0,
        usePath: !opts.track && !opts.curve?.length,
        resolve,
      };
    });
  }

  /** Plan the route for a move from the feet `me` (ADR-0028): nav route, authored curve or track, rounded. */
  private planMove(m: MoveCmd, me: P3, env: NpcEnv): PathFollower {
    const v0 = m.follower?.speed ?? Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z) * 60;
    const target = { x: m.target.x, y: m.target.y, z: m.target.z };
    let points: P3[];
    if (m.track) points = roundCorners(me, m.track, env.colliders ? { world: env.colliders, radius: MOTOR.radius } : {});
    else {
      const plan = planWalk(me, target, { nav: env.nav, world: env.colliders, radius: MOTOR.radius }, m.curve ?? undefined);
      points = plan.points;
      if (!plan.routed && env.nav && !m.warned) {
        m.warned = true;
        console.warn(`[nav] ${this.id}: no route from ${me.x.toFixed(1)},${me.z.toFixed(1)} to ${target.x.toFixed(1)},${target.z.toFixed(1)}; walking straight`);
      }
    }
    return new PathFollower(points, { speed: m.speed, v0: Math.min(m.speed, v0) });
  }

  /** Be pulled along behind `get()` (a dragger), `dist` m back, in a lying pose. */
  towBehind(get: () => THREE.Vector3 | null, opts: { dist?: number; pose?: string } = {}): void {
    this.stopMove();
    this.follow = null;
    this.tow = { get, dist: opts.dist ?? 1.1, pose: opts.pose ?? DRAG_POSE };
    this.body.carried = this.tow.pose;
  }

  /** Let go of the rope: the body stays where it lies. */
  untow(): void {
    if (!this.tow) return;
    this.tow = null;
    this.body.carried = null;
  }

  get towed(): boolean {
    return this.tow !== null;
  }

  stopMove(): void {
    this.cancelWay();
    const m = this.move;
    this.move = null;
    m?.resolve();
  }

  /** Play a named gesture (NPC_ANIMS), creature performance (`scream`, design D8), or any pose by name. Resolves when it ends (held poses resolve at once). */
  playAnim(name: string, opts: { instant?: boolean; has?: (pose: string) => boolean; hold?: number } = {}): Promise<void> {
    // `clip:<id>` plays a captured one-shot clip from this body's library or character pack once, without stopping a
    // move in progress (overhaul-priya-r08-death task 11.2: Priya stumbles mid-run). Skipped or missing: nothing.
    if (name.startsWith('clip:')) {
      if (opts.instant) return Promise.resolve();
      const duration = this.body.playKillClip(name.slice(5), 0.12);
      if (duration === null || duration <= 0) return Promise.resolve();
      this.clipAnim?.resolve();
      return new Promise<void>((resolve) => {
        this.clipAnim = { t: 0, duration, resolve };
      });
    }
    if (this.body.hasPerformance(name) || name === 'scream') {
      this.cancelWay();
      this.endAnim();
      this.pendingPlaced = null;
      this.gesture = null;
      if (opts.instant) {
        this.body.stopPerformance();
        this.body.setPose(this.basePose, 0.01);
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        if (!this.body.playPerformance(name, { ...(opts.hold !== undefined ? { hold: opts.hold } : {}), onDone: resolve })) resolve();
      });
    }
    const base = NPC_ANIMS[name] ?? (opts.has?.(name) ? { pose: name, hold: Infinity } : null);
    if (!base) return Promise.resolve();
    // A timed gesture on a seated or leaning body uses that base's own version (`drink` on `lean_back_mug` is
    // `lean_back_mug_drink`), so the legs stay put and a held mug stays in the hand (ADR-0029).
    const variant = base.hold !== Infinity && base.hold !== 0 ? `${this.basePose}_${base.pose}` : '';
    const def = variant && opts.has?.(variant) ? { ...base, pose: variant } : base;
    this.cancelWay();
    this.endAnim();
    this.pendingPlaced = null;
    this.gesture = null;
    if (def.hold === Infinity || def.hold === 0) {
      // A persistent pose becomes the base pose (typing at a console, holding out a mug).
      this.basePose = def.pose;
      const blend = opts.instant ? 0.01 : (def.blend ?? 0.4);
      if (!opts.instant && PLACED_POSE.test(def.pose) && this.faceYaw !== null) {
        const diff = Math.abs(Math.atan2(Math.sin(this.faceYaw - this.body.heading), Math.cos(this.faceYaw - this.body.heading)));
        if (diff > 0.35) {
          this.pendingPlaced = { pose: def.pose, blend };
          return Promise.resolve();
        }
      }
      this.body.setPose(def.pose, blend);
      return Promise.resolve();
    }
    if (opts.instant) {
      // Skipped: the gesture is over, back to the base pose.
      this.body.setPose(this.basePose, 0.01);
      return Promise.resolve();
    }
    this.body.setPose(def.pose, def.blend ?? 0.35);
    return new Promise<void>((resolve) => {
      this.anim = { pose: def.pose, left: def.hold, resolve };
    });
  }

  private endAnim(): void {
    const a = this.anim;
    this.anim = null;
    a?.resolve();
  }

  /** Back to standing (cancels anims and the held pose). */
  resetPose(pose = 'idle'): void {
    this.cancelWay();
    this.endAnim();
    this.pendingPlaced = null;
    this.basePose = pose;
    this.body.setPose(pose, 0.4);
  }

  /** Smoothly settle into an activity spot (ADR-0029 phase 2): align feet/facing and blend into the seated/leaning pose. */
  settleAt(at: P3, yaw: number, pose: string, blend = 0.75): void {
    this.cancelWay();
    this.endAnim();
    this.pendingPlaced = null;
    this.gesture = null;
    this.motor.x = at.x;
    this.motor.y = at.y;
    this.motor.z = at.z;
    this.motor.vy = 0;
    this.motor.grounded = true;
    this.body.group.position.set(at.x, at.y, at.z);
    this.body.setHeading(yaw);
    this.faceYaw = null;
    this.lastPos.copy(this.body.group.position);
    this.basePose = pose;
    this.body.setPose(pose, blend);
  }

  lookAt(get: (() => THREE.Vector3 | null) | null): void {
    this.lookGet = get;
  }

  /** Keep within `distance` of a moving target (npcFollow). Null stops. */
  followTarget(get: (() => THREE.Vector3 | null) | null, distance = 1.6): void {
    this.stopMove();
    this.follow = get ? { get, distance } : null;
  }

  turnTo(yaw: number | null, rate: number | null = null): void {
    this.cancelWay();
    this.faceYaw = yaw;
    this.faceRate = yaw === null ? null : rate;
  }

  update(dt: number, env: NpcEnv): void {
    const me = this.position;
    let camD = env.camera ? me.distanceTo(env.camera) : 0;
    if (env.extraCameras && env.extraCameras.length > 0) {
      for (const c of env.extraCameras) {
        const d = me.distanceTo(c);
        if (d < camD) camD = d;
      }
    }
    this.body.group.visible = camD < NPC_TUNING.hideDistance || this.body.killing;
    let speed = 0;
    const desired = tmpB.set(0, 0, 0);

    // Static dead corpses: zero AI, zero gaze, zero steering, zero movement unless explicitly dragged/scripted.
    if (this.body.state !== 'alive' || this.body.spec.role === 'corpse') {
      this.body.lookTarget = null;
      if (this.wayPhase) this.cancelWay();
      if (!this.tow && !this.move && !this.clipAnim && !this.body.killing) {
        if (camD < NPC_TUNING.sleepDistance || !env.camera) this.body.update(dt, env.camera);
        return;
      }
    }

    // Follow: walk toward the target when it gets away.
    if (this.follow && !this.move) {
      const f = this.follow;
      const t = f.get();
      const d = t ? Math.hypot(t.x - me.x, t.z - me.z) : 0;
      if (t && d > f.distance + 1.2) {
        // Walk to a point `distance` short of the target, then keep following (moveTo clears it).
        const k = (d - f.distance) / d;
        void this.moveTo({ x: me.x + (t.x - me.x) * k, y: t.y, z: me.z + (t.z - me.z) * k });
        this.follow = f;
      }
    }

    // Towed: the rope drags the body after the dragger, never faster than the catch-up speed.
    const rope = this.tow;
    if (rope) {
      const t = rope.get();
      if (t) {
        const dx = t.x - me.x;
        const dz = t.z - me.z;
        const d = Math.hypot(dx, dz);
        if (d > rope.dist + 1e-3) {
          const step = Math.min(d - rope.dist, TOW_CATCHUP * dt);
          this.motor.x = me.x + (dx / d) * step;
          this.motor.z = me.z + (dz / d) * step;
          this.motor.y = me.y;
          this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
          this.body.setHeading(Math.atan2(-dx, -dz));
        }
        this.body.carried = rope.pose;
      }
    }

    const m = this.move;
    if (m && this.body.spec.role === 'corpse') {
      // Dead bodies dragged by script slide smoothly in their frozen corpse pose without gait or nav detours.
      const dx = m.target.x - me.x;
      const dz = m.target.z - me.z;
      const toEnd = Math.hypot(dx, dz);
      this.body.carried = this.basePose;
      if (toEnd <= 0.05) {
        this.motor.x = m.target.x;
        this.motor.z = m.target.z;
        this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
        this.move = null;
        this.lastPos.copy(this.body.group.position);
        m.resolve();
      } else {
        const step = Math.min(toEnd, Math.max(0.1, m.speed) * dt);
        this.motor.x = me.x + (dx / toEnd) * step;
        this.motor.z = me.z + (dz / toEnd) * step;
        this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
        this.lastPos.copy(this.body.group.position);
      }
      return;
    }
    if (m) {
      if (m.usePath) m.repathT -= dt;
      if (!m.follower || (m.usePath && m.repathT <= 0)) {
        m.repathT = NPC_TUNING.repath;
        m.follower = this.planMove(m, me, env);
      }
      const st = m.follower.update(me.x, me.z, dt);
      const toEnd = Math.hypot(m.target.x - me.x, m.target.z - me.z);
      // Arrived: on the spot, or as close as the body gets to one in a nook or by furniture (ADR-0028).
      if ((toEnd <= NPC_TUNING.arrive && st.remaining < 0.35) || (st.done && toEnd < 1.6) || (m.stuckT > 0.6 && st.remaining < 1 && toEnd < 1.6)) {
        this.move = null;
        if (m.yaw !== undefined) {
          this.faceYaw = m.yaw;
          this.faceRate = null;
        }
        m.resolve();
      } else {
        desired.set(st.tx - me.x, 0, st.tz - me.z);
        if (desired.lengthSq() > 1e-6) desired.normalize();
        // The follower eases into turns, doorways and the arrival (ADR-0028); keep a crawl so the spot is reached.
        speed = Math.max(st.speed, Math.min(0.2, toEnd));
        // Jay in the way: slow down, steer round him, and wait if there is no room (never shove or walk through him).
        const jay = this.avoidJay(m, desired, env);
        speed *= jay.scale;
        // Other people in the way: bend round the nearest one ahead and ease off, keeping to one side (ADR-0028).
        if (!jay.near) speed *= this.avoidOthers(m, desired, env);
        const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
        if (jay.near) {
          m.stuckT = Math.max(0, m.stuckT - dt);
          m.blockT = jay.blocked ? m.blockT + dt : Math.max(0, m.blockT - dt);
        } else {
          m.blockT = Math.max(0, m.blockT - dt);
          m.stuckT = moved < speed * dt * 0.1 ? m.stuckT + dt : Math.max(0, m.stuckT - dt);
        }
        // Hopelessly stuck (closed door, crowd): give up and stand there, so a `wait` never hangs.
        if (m.stuckT > 4 || m.blockT > BLOCKED_GIVE_UP) {
          this.move = null;
          m.resolve();
        } else if (m.stuckT > 1.2) {
          // Off the authored line or blocked: route straight to the spot from here.
          m.curve = null;
          m.track = null;
          m.usePath = true;
          m.follower = null;
        }
      }
    }
    this.lastPos.copy(me);
    // Standing: step aside when Jay walks into us, and come back once he has moved on.
    let steerOpts: { turnRate: number; accel: number } = { turnRate: NPC_TUNING.turnRate, accel: 2.4 };
    if (!this.move) {
      const g = this.giveWay(dt, env, desired);
      if (g > 0) {
        speed = g;
        steerOpts = { turnRate: GIVE_WAY.turnRate, accel: GIVE_WAY.accel };
      }
    } else if (this.wayPhase) this.cancelWay();
    if (!this.move && this.moveCarried) {
      this.moveCarried = false;
      if (!this.tow) this.body.carried = null;
    }

    if (speed > 0) {
      // Backing away: keep facing the move's face point while walking (openspec juggernaut-walk-and-roar, the R16 retreat).
      const facePoint = this.move?.face?.() ?? null;
      const faceHeading = facePoint ? Math.atan2(-(facePoint.x - me.x), -(facePoint.z - me.z)) : undefined;
      const vel = this.body.steer(desired, dt, { maxSpeed: speed, ...steerOpts, ...(faceHeading !== undefined ? { face: faceHeading } : {}) });
      if (env.colliders) moveBody(this.motor, vel.x * dt, vel.z * dt, dt, MOTOR, env.colliders);
      else {
        this.motor.x += vel.x * dt;
        this.motor.z += vel.z * dt;
      }
      this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
    } else {
      // Settle: decelerate crisply in place, then turn to the scripted facing.
      const face = this.faceYaw !== null ? dirOf(this.faceYaw, tmpA) : null;
      const vel = this.body.steer(face, dt, { maxSpeed: 0, turnRate: this.faceRate ?? 3.4, accel: 7 });
      if (vel.lengthSq() > 1e-6 && env.colliders) {
        moveBody(this.motor, vel.x * dt, vel.z * dt, dt, MOTOR, env.colliders);
        this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
      }
      if (this.faceYaw !== null) {
        const diff = Math.abs(Math.atan2(Math.sin(this.faceYaw - this.body.heading), Math.cos(this.faceYaw - this.body.heading)));
        if (this.pendingPlaced && diff <= 0.35) {
          this.body.setPose(this.pendingPlaced.pose, this.pendingPlaced.blend);
          this.pendingPlaced = null;
        }
        if (diff < 0.03) {
          this.faceYaw = null;
          this.faceRate = null;
        }
      } else if (this.pendingPlaced) {
        this.body.setPose(this.pendingPlaced.pose, this.pendingPlaced.blend);
        this.pendingPlaced = null;
      }
    }

    // A one-shot clip: move it on, then hand the body back to its base pose (and its locomotion).
    if (this.clipAnim) {
      const c = this.clipAnim;
      c.t += dt;
      this.body.killClipPhase(Math.min(1, c.t / c.duration));
      if (c.t >= c.duration) {
        this.clipAnim = null;
        this.body.setPose(this.basePose, 0.25);
        c.resolve();
      }
    }

    // Timed gesture.
    if (this.anim) {
      this.anim.left -= dt;
      if (this.anim.left <= 0) {
        this.endAnim();
        this.body.setPose(this.basePose, 0.4);
      }
    }

    // Head: script look wins, then Jay up close, then the conversation (ADR-0029), then ambient notice of Jay.
    const dead = this.body.state !== 'alive' || this.body.spec.role === 'corpse';
    const scripted = dead ? null : (this.lookGet?.() ?? null);
    const talk = !dead && !scripted && !this.tow ? (this.talkLook?.() ?? null) : null;
    if (dead) this.body.lookTarget = null;
    else if (scripted) this.body.lookTarget = scripted;
    else if (talk) this.body.lookTarget = talk;
    else if (this.ambient && !this.move && !this.tow) {
      const social = this.socialLook?.() ?? null;
      if (social) this.body.lookTarget = this.notices(env, NPC_TUNING.chatNoticeRange) ? env.playerHead : social;
      else this.body.lookTarget = this.notices(env) ? env.playerHead : null;
    } else this.body.lookTarget = null;

    if (!dead && this.ambient && !this.busy && !this.offering) this.ambientGesture(dt);

    // A body in a scripted kill never sleeps: it may be on a camera feed far from Jay (the stinger's surgery feed).
    if (camD < NPC_TUNING.sleepDistance || !env.camera || this.body.killing) this.body.update(dt, env.camera);
  }

  /**
   * A scripted walker meets Jay: within AVOID_RANGE of his body edge and heading at him it eases off
   * (stopping short of touching) and bends its path round him on a committed side. `blocked` when
   * it has stopped short with him right ahead (the caller extends the stuck timer).
   */
  /**
   * Steer a walk round the nearest other body ahead (ADR-0028): bend away from it, committing to a
   * side until it is passed (head-on, both walkers bend to the same hand so they part), and ease
   * off when close. A body standing on our goal is left to the arrival. Returns a speed scale.
   */
  private avoidOthers(m: MoveCmd, desired: THREE.Vector3, env: NpcEnv): number {
    if (!env.bodies || desired.lengthSq() < 1e-6) {
      m.passSide = 0;
      return 1;
    }
    const me = this.position;
    const r = this.body.footprint.r;
    let bx = 0;
    let bz = 0;
    let bestGap = Infinity;
    const range = m.curve ? 0.35 : PASS_RANGE;
    const minAhead = m.curve ? 0.55 : 0.3;
    env.bodies(this, (x, z, br) => {
      const dx = x - me.x;
      const dz = z - me.z;
      const d = Math.hypot(dx, dz);
      const gap = d - (r + br);
      const ahead = d > 1e-4 ? (desired.x * dx + desired.z * dz) / d : 0;
      if (gap > range || ahead < minAhead) return;
      if (Math.hypot(x - m.target.x, z - m.target.z) < br + 0.25) return;
      if (gap < bestGap) {
        bestGap = gap;
        bx = dx;
        bz = dz;
      }
    });
    if (bestGap === Infinity) {
      m.passSide = 0;
      return 1;
    }
    const cross = desired.x * bz - desired.z * bx;
    if (m.passSide === 0) m.passSide = Math.abs(cross) > 0.15 ? Math.sign(cross) : 1;
    const t = Math.max(0, Math.min(1, bestGap / range));
    // Gentle from afar, firm up close: people start drifting aside well before they'd meet.
    const bend = 1.4 * (1 - t * t);
    const dx = desired.x;
    const dz = desired.z;
    desired.x = dx + m.passSide * dz * bend;
    desired.z = dz - m.passSide * dx * bend;
    desired.normalize();
    return 0.55 + 0.45 * Math.max(0, Math.min(1, bestGap / 0.6));
  }

  private avoidJay(m: MoveCmd, desired: THREE.Vector3, env: NpcEnv): { near: boolean; blocked: boolean; scale: number } {
    const me = this.position;
    const jx = env.playerFeet.x - me.x;
    const jz = env.playerFeet.z - me.z;
    const dj = Math.hypot(jx, jz);
    const minD = this.body.footprint.r + PLAYER_RADIUS;
    const gap = dj - minD;
    const ahead = dj > 1e-4 ? (desired.x * jx + desired.z * jz) / dj : 0;
    if (gap > AVOID_RANGE || ahead < 0.2 || Math.abs(env.playerFeet.y - me.y) > 1.2 || desired.lengthSq() < 1e-6) {
      m.avoidSide = 0;
      return { near: false, blocked: false, scale: 1 };
    }
    // Jay sits on the +perp side when cross > 0, so we bend the other way.
    const cross = desired.x * jz - desired.z * jx;
    if (m.avoidSide === 0) m.avoidSide = Math.abs(cross) > 0.02 ? Math.sign(cross) : 1;
    const t = Math.max(0, Math.min(1, gap / AVOID_RANGE));
    const bend = 1.6 * (1 - t);
    const dx = desired.x;
    const dz = desired.z;
    desired.x = dx + m.avoidSide * dz * bend;
    desired.z = dz - m.avoidSide * dx * bend;
    desired.normalize();
    const close = Math.max(0, Math.min(1, (gap - 0.04) / 0.9));
    const k = ahead >= 0.5 ? 1 : (ahead - 0.2) / 0.3;
    return { near: true, blocked: gap < 0.2 && ahead > 0.7, scale: 1 - (1 - close) * k };
  }

  /**
   * Give way to Jay (standing bodies only): once his wish has pointed at us from inside contact range for
   * GIVE_WAY.press seconds, walk to a spot ~1 m aside (or out of a doorway, away from him) on an internal
   * channel (never resolves or replaces a scripted move), wait until he has moved on, then walk back to the
   * original spot and facing. Any script command drops it (`cancelWay`). Returns the walking speed, 0 when
   * standing. Held up by towing, carrying and offers; work poses only give way inside a doorway.
   */
  private giveWay(dt: number, env: NpcEnv, desired: THREE.Vector3): number {
    const me = this.position;
    const wish = env.playerWish;
    if (this.body.state !== 'alive' || this.body.spec.role === 'corpse' || this.tow || this.body.carried !== null || this.offering !== null || !this.body.group.visible || PLACED_POSE.test(this.basePose)) {
      if (this.wayPhase) this.cancelWay();
      return 0;
    }
    const mode = WORK_POSES.has(this.basePose) ? 'door' : 'any';
    const r = this.body.footprint.r;
    const wayEnv: WayEnv = { nav: env.nav, colliders: env.colliders, occupied: env.occupied ? (x, z, rr) => env.occupied!(x, z, rr, this) : undefined };
    if (this.way.press(dt, me, r, env.playerFeet, wish, wayEnv, mode)) {
      this.wayHome ??= { x: me.x, y: me.y, z: me.z, yaw: this.body.heading };
      this.wayPhase = 'out';
      this.wayT = 0;
      this.wayPath = null;
    }
    const phase = this.wayPhase;
    if (!phase) return 0;
    this.wayT += dt;
    const home = this.wayHome!;
    if (phase === 'out') {
      const s = this.way.spot!;
      const d = Math.hypot(s.x - me.x, s.z - me.z);
      if (d < 0.12 || this.wayT > 2.5) {
        this.wayPhase = 'away';
        this.wayT = 0;
        return 0;
      }
      desired.set(s.x - me.x, 0, s.z - me.z).normalize();
      return Math.min(GIVE_WAY.speed, 0.5 + d * 3);
    }
    if (phase === 'away') {
      if (this.way.movedOn(dt, env.playerFeet, wish)) {
        this.wayPhase = 'back';
        this.wayT = 0;
        this.wayPath = null;
        this.wayRepathT = 0;
      }
      return 0;
    }
    // Back to the original spot and facing.
    const toHome = Math.hypot(home.x - me.x, home.z - me.z);
    if (toHome < 0.12 || this.wayT > GIVE_WAY_TIMEOUT) {
      if (toHome < 0.5) {
        // Land exactly on the old spot and facing.
        this.motor.x = home.x;
        this.motor.z = home.z;
        this.body.group.position.set(home.x, this.motor.y, home.z);
        this.faceYaw = home.yaw;
      }
      this.cancelWay();
      return 0;
    }
    this.wayRepathT -= dt;
    if (!this.wayPath || this.wayRepathT <= 0) {
      this.wayRepathT = NPC_TUNING.repath;
      this.wayPath = env.nav?.findPath(me, home, { radius: 0.2 }) ?? [{ x: home.x, y: home.y, z: home.z }];
    }
    let wp = this.wayPath[0];
    while (wp && this.wayPath.length > 1 && Math.hypot(wp.x - me.x, wp.z - me.z) < 0.3) {
      this.wayPath.shift();
      wp = this.wayPath[0];
    }
    if (!wp) wp = home;
    desired.set(wp.x - me.x, 0, wp.z - me.z);
    if (desired.lengthSq() < 1e-6) return 0;
    desired.normalize();
    return Math.min(GIVE_WAY.speed, 0.3 + toHome * 1.5);
  }

  private notices(env: NpcEnv, range: number = NPC_TUNING.noticeRange): boolean {
    const me = this.position;
    const dx = env.playerFeet.x - me.x;
    const dz = env.playerFeet.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d < 0.2) return false;
    const f = dirOf(this.body.heading, tmpA);
    return (dx * f.x + dz * f.z) / d > -0.2; // not behind them
  }

  private ambientGesture(dt: number): void {
    if (this.gesture) {
      this.gesture.left -= dt;
      if (this.gesture.left <= 0) {
        this.gesture = null;
        this.body.setPose(this.basePose, 0.6);
      }
      return;
    }
    this.gestureT -= dt;
    if (this.gestureT > 0) return;
    this.gestureT = this.rng.range(NPC_TUNING.gestureEvery[0], NPC_TUNING.gestureEvery[1]);
    const options = AMBIENT_GESTURES[this.basePose];
    if (!options?.length) return;
    const fresh = options.filter((o) => o !== this.lastGesture);
    const pose = this.rng.pick(fresh.length ? fresh : options);
    this.lastGesture = pose;
    this.gesture = { pose, left: this.rng.range(1.4, 3.2) };
    this.body.setPose(pose, 0.6);
  }
}
