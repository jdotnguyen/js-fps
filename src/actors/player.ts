import * as THREE from 'three';
import type { EventBus } from '../core/events.ts';
import type { Input } from '../core/input.ts';
import type { Settings } from '../core/settings.ts';
import type { DifficultyPreset } from '../data/types/difficulty.ts';
import type { Flashlight } from '../render/flashlight.ts';
import type { Navigator, P3 } from '../ai/nav.ts';
import { PathFollower, planWalk } from '../ai/walkPath.ts';
import { clipMove, JAY_RADIUS, pushOut, removeInward, type Circle, type V2 } from './bodyPush.ts';
import { ControlStack, isOnRails } from './control.ts';
import type { Interactions } from './interaction.ts';
import { DEFAULT_MOTOR, moveBody, type ColliderQuery, type MotorState } from './motor.ts';
import { MAX_HP, Vitals, type VitalsChange } from './vitals.ts';

/** Footstep / wading surfaces (ADR-0003 `surfaces`). */
export type Surface = 'concrete' | 'metal' | 'grate' | 'rubber' | 'water';

/** What the player needs from the level. ADR-0003's loader provides both. */
export interface PlayerWorld {
  colliders: ColliderQuery;
  surfaceAt(x: number, z: number): Surface;
}

declare module '../core/events.ts' {
  interface EventMap {
    'player:footstep': { surface: Surface; x: number; y: number; z: number; sprint: boolean; landing?: boolean };
    'player:flashlight': { on: boolean };
    'player:damaged': { amount: number; hp: number };
    'player:downed': { bleedOut: number };
    'player:revived': { hp: number };
    'player:died': Record<string, never>;
    /** Shove released: enemies in the cone are pushed and staggered (ADR-0007). */
    'player:shove': { origin: [number, number, number]; dir: [number, number, number]; range: number; coneDeg: number; damage: number; push: number };
    /** The boot lands (physical-interaction "Corpses can be stomped"): `at` is the floor point under it, `dir` the view. */
    'player:stomp': { at: [number, number, number]; dir: [number, number, number] };
    'player:grabbed': Record<string, never>;
    'player:grabEscaped': Record<string, never>;
    'interact:used': { id: string };
  }
}

/**
 * Feel numbers (ADR-0004 [Assumed]). Exposed as a mutable object so the ?debug panel
 * can tune them live.
 */
export const PLAYER_TUNING = {
  eyeHeight: 1.7,
  downedEyeHeight: 0.35,
  walkSpeed: 3.2,
  sprintSpeed: 5.0,
  sprintMax: 4,
  sprintRegenDelay: 2,
  /** Stamina seconds regained per second once regen starts. */
  sprintRegenRate: 2,
  aimMoveScale: 0.5,
  wadeScale: 0.6,
  slowScale: 0.5,
  crawlSpeed: 0.6,
  accel: 18,
  decel: 22,
  bobWalk: 0.03,
  bobSprint: 0.05,
  strideWalk: 0.75,
  strideSprint: 0.95,
  aimFovScale: 0.8,
  aimTime: 0.15,
  /** Jump takeoff speed, m/s (about 0.58 m of arc at gravity 20); with the motor's air step it reaches 1.00 m tops. */
  jumpSpeed: DEFAULT_MOTOR.jumpSpeed,
  hitSlowTime: 0.3,
  hitSlowScale: 0.5,
  shoveWindup: 0.25,
  shoveCooldown: 1.2,
  shoveRange: 1.4,
  shoveConeDeg: 70,
  shoveDamage: 5,
  shovePush: 1.5,
  /** Seconds from the key to the boot landing (raise, then stomp). */
  stompWindup: 0.3,
  stompCooldown: 0.75,
};

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
/** Radians per pixel at sensitivity 1 (same as the free camera). */
const LOOK_SCALE = 0.0022;
const ARRIVE = 0.12;
/** Scripted walks re-plan this often, seconds. */
const REPATH_EVERY = 0.5;
/** ...and when blocked (moving < a quarter of the wanted speed) this long, seconds. */
const STALL_TIME = 0.4;
/** A walk anchor within this of the floor is a feet position; higher ones (camera anchors) use body.y. */
const FEET_ANCHOR_Y = 0.5;
/** Velocity into a body is removed within this of touching, metres. */
const BODY_MARGIN = 0.03;

export interface PlayerDeps {
  camera: THREE.PerspectiveCamera;
  input: Input;
  events: EventBus;
  settings: () => Readonly<Settings>;
  flashlight: Flashlight;
  interactions: Interactions;
  difficulty: () => DifficultyPreset;
  world: PlayerWorld;
}

interface LookAssist {
  target: THREE.Vector3;
  duration: number;
  weight: number;
  t: number;
}

/** A scripted shot (intro-sequence spec): the sequence owns the aim; the mouse only gets a small give. */
interface Framing {
  target: THREE.Vector3;
  /** Re-read every frame to keep the shot on a moving subject (an NPC walking in). */
  follow?: (out: THREE.Vector3) => boolean;
  /** Half-size of the give, radians. */
  give: number;
  /** Seconds to ease onto a new target. */
  duration: number;
  /** Seconds the give stays where the mouse left it before springing back (0: at once). */
  hold: number;
  /** Spring-back time constant, seconds. */
  returnTime: number;
  yaw: number;
  pitch: number;
}

interface WalkTarget {
  pos: THREE.Vector3;
  speed: number;
  done: () => void;
  /** The planned walk (ADR-0028): speed profile and steering point; null = plan this frame. */
  follower: PathFollower | null;
  /** An authored walk's control points (ADR-0028), walked as a smooth curve; null = nav route. */
  curve: P3[] | null;
  warned: boolean;
  sinceRepath: number;
  stalled: number;
}

/** Spring-back time constant for the give, seconds (~0.4 s to settle). */
const GIVE_RETURN = 0.12;
/** How far ahead along the walk heading the heading shot aims, metres. */
const HEADING_AHEAD = 4;
/** Scripted turns ease this much slower with reduced motion (intro-sequence spec). */
const REDUCED_TURN_SCALE = 1.6;
/** Roll sway on scripted walks, radians (~0.25 deg). */
const WALK_SWAY = 0.0045;

interface Grab {
  source: THREE.Vector3;
  presses: number;
  needed: number;
  release: () => void;
}

/**
 * First-person security officer (ADR-0004): heavy grounded movement, aim mode, flashlight,
 * interact, shove, health with a Downed state, and the control API sequences use.
 *
 * `update(dt)` runs per fixed step; `look(frameDt)` and `applyCamera(frameDt)` per
 * rendered frame so mouse look stays smooth at any refresh rate.
 */
export class Player {
  readonly control = new ControlStack();
  readonly vitals: Vitals;
  readonly body: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  readonly velocity = new THREE.Vector2();
  yaw = 0;
  pitch = 0;
  /** 0..1, eased; weapons read it for spread and the laser sight. */
  aimBlend = 0;
  stamina = PLAYER_TUNING.sprintMax;
  sprinting = false;
  /** 0..1 strength for the grade pass damage uniform (red edge + desaturation). */
  damageFx = 0;
  private readonly d: PlayerDeps;
  private world: PlayerWorld;
  private exhausted = false;
  /** True from running out of stamina until a second of it is back (sprint is locked meanwhile). */
  get isExhausted(): boolean {
    return this.exhausted;
  }
  private sinceSprint = 99;
  private eyeHeight = PLAYER_TUNING.eyeHeight;
  private stepOffset = 0;
  private stride = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private hitSlow = 0;
  private hitPulse = 0;
  private kick = 0;
  private kickVel = 0;
  private shoveWindup = -1;
  private shoveCooldown = 0;
  private shoveLunge = 0;
  /** The stomp is part of physical interaction: off (the key does nothing) unless its switch is on (adopt-physics-engine D9). */
  stompEnabled = false;
  private stompWindup = -1;
  private stompCooldown = 0;
  /** View dip of a stomp, 0..1: the camera follows the boot down. */
  private stompDip = 0;
  private assist: LookAssist | null = null;
  private clampCenter: THREE.Vector3 | null = null;
  private clampHalf = THREE.MathUtils.degToRad(20);
  private clampFallback: { yaw: number; pitch: number } | null = null;
  private framing: Framing | null = null;
  /** Direction of the current (or last) scripted walk, as a view yaw; the heading shot faces it. */
  private headingYaw: number | null = null;
  /** Seconds since the mouse last pushed the give. */
  private sinceGive = Infinity;
  private giveYaw = 0;
  private givePitch = 0;
  private walkTarget: WalkTarget | null = null;
  private nav: Navigator | null = null;
  private bodies: (() => Iterable<Circle>) | null = null;
  private readonly bodyList: Circle[] = [];
  private readonly wishDir = { x: 0, z: 0 };
  private readonly v2: V2 = { x: 0, z: 0 };
  private grabbed: Grab | null = null;
  private stateLayer: (() => void) | null = null;
  private lastFov = 0;
  private time = 0;
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(deps: PlayerDeps) {
    this.d = deps;
    this.world = deps.world;
    this.vitals = new Vitals(() => deps.difficulty());
    deps.camera.rotation.order = 'YXZ';
  }

  /** Cannot move on their own: locked, or on a scripted walk (the cutscene bars, intro-sequence spec). */
  get onRails(): boolean {
    return isOnRails(this.control.state, this.walkTarget !== null);
  }

  get alive(): boolean {
    return this.vitals.state === 'alive';
  }

  /** Camera kick from weapon fire: positive pitches the view up (same spring as damage kick). */
  addKick(amount: number): void {
    this.kickVel += amount;
  }

  get downed(): boolean {
    return this.vitals.state === 'downed';
  }

  get isGrabbed(): boolean {
    return this.grabbed !== null;
  }

  /** 0..1 progress of the "Mash E" struggle, or null when not grabbed. */
  get grabProgress(): number | null {
    return this.grabbed ? Math.min(1, this.grabbed.presses / this.grabbed.needed) : null;
  }

  /** Eye position in world space (feet + eye height, no bob). */
  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.body.x, this.body.y + this.eyeHeight, this.body.z);
  }

  /** View direction from yaw/pitch (-Z forward, ADR-0001). */
  viewDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  setWorld(world: PlayerWorld): void {
    this.world = world;
  }

  /** Nav graph scripted walks path through (null: straight lines). */
  setNav(nav: Navigator | null): void {
    this.nav = nav;
    if (this.walkTarget) this.walkTarget.follower = null;
  }

  /** Solid circles (people) Jay cannot walk through; read every step. null: none. */
  setBodies(fn: (() => Iterable<Circle>) | null): void {
    this.bodies = fn;
  }

  /**
   * Unit XZ direction Jay is trying to move this step (input or scripted walk); zero when idle,
   * locked or dead. It is the intent, so it stays non-zero while a body or wall blocks him.
   */
  get wish(): Readonly<{ x: number; z: number }> {
    return this.wishDir;
  }

  /** Place the player from an eye position (spawns and saves store the eye). */
  placeAtEye(eye: THREE.Vector3, yaw: number, pitch = 0): void {
    this.body.x = eye.x;
    this.body.z = eye.z;
    this.body.y = eye.y - PLAYER_TUNING.eyeHeight;
    this.body.vy = 0;
    this.body.grounded = true;
    // Settle onto whatever floor is below (spawn eye heights are approximate).
    moveBody(this.body, 0, 0, 1 / 60, { ...DEFAULT_MOTOR, snapDown: 3 }, this.world.colliders);
    this.yaw = yaw;
    this.pitch = pitch;
    this.velocity.set(0, 0);
    this.stepOffset = 0;
    this.applyCamera(0);
  }

  /** Fresh life: full control, given health, no assists. */
  reset(hp = MAX_HP): void {
    this.vitals.reset(hp);
    this.control.reset();
    this.stateLayer = null;
    this.grabbed = null;
    this.assist = null;
    this.clampCenter = null;
    this.clampFallback = null;
    this.framing = null;
    this.giveYaw = this.givePitch = 0;
    this.walkTarget?.done();
    this.walkTarget = null;
    this.velocity.set(0, 0);
    this.wishDir.x = this.wishDir.z = 0;
    this.aimBlend = 0;
    this.stamina = PLAYER_TUNING.sprintMax;
    this.exhausted = false;
    this.hitSlow = this.hitPulse = this.kick = this.kickVel = 0;
    this.shoveWindup = -1;
    this.shoveCooldown = 0;
    this.stompWindup = -1;
    this.stompCooldown = 0;
    this.stompDip = 0;
    this.eyeHeight = PLAYER_TUNING.eyeHeight;
    this.damageFx = 0;
  }

  // ------------------------------------------------------------------ control API

  /** Ease the view toward `target`; the player can push against it. */
  lookAt(target: THREE.Vector3, opts: { duration?: number; weight?: number } = {}): void {
    this.assist = { target: target.clone(), duration: opts.duration ?? 0.8, weight: opts.weight ?? 0.85, t: 0 };
  }

  /**
   * Cone (total degrees) the view is held inside while control.look is 'clamped'.
   * `center` null = the view direction when the clamp starts.
   */
  clampLook(center: THREE.Vector3 | null, degrees = 40): void {
    this.clampCenter = center ? center.clone() : null;
    this.clampHalf = THREE.MathUtils.degToRad(degrees / 2);
    this.clampFallback = null;
  }

  /**
   * Scripted shot (intro-sequence spec): ease the view onto `target` and hold it there; the mouse can
   * push it `give` degrees off and it springs back. Overrides look assist and clamp while
   * set. `duration` 0 snaps at once. null releases the view where it is.
   */
  frameView(target: THREE.Vector3 | null, opts: { duration?: number; give?: number; hold?: number; returnTime?: number; follow?: (out: THREE.Vector3) => boolean } = {}): void {
    if (!target) {
      this.framing = null;
      this.giveYaw = this.givePitch = 0;
      return;
    }
    const duration = opts.duration ?? 0.8;
    const give = THREE.MathUtils.degToRad(opts.give ?? 6);
    const prev = this.framing;
    this.framing = {
      target: target.clone(),
      ...(opts.follow ? { follow: opts.follow } : {}),
      give,
      duration,
      hold: Math.max(0, opts.hold ?? 0),
      returnTime: Math.max(0.02, opts.returnTime ?? GIVE_RETURN),
      // Start from the current base aim, or from the current view on the first shot.
      yaw: prev ? prev.yaw : this.yaw - this.giveYaw,
      pitch: prev ? prev.pitch : this.pitch - this.givePitch,
    };
    if (duration <= 0) {
      const [ty, tp] = anglesTo(this.eyePosition(this.eye), this.framing.target);
      this.framing.yaw = ty;
      this.framing.pitch = tp;
      this.giveYaw = this.givePitch = 0;
      this.yaw = wrapAngle(ty);
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, tp));
    }
  }

  /**
   * Heading shot (intro-sequence spec): a scripted shot aimed a few metres ahead along Jay's scripted walk at eye
   * height, so the view faces where the rails go and turns with the route; `give` (default 35 deg) is the mouse
   * leeway, which holds `hold` s (default 0.5) before settling back. With no walk running it keeps the last heading
   * (the current view when the shot starts).
   */
  frameHeading(opts: { duration?: number; give?: number; hold?: number; returnTime?: number } = {}): void {
    if (!this.walkTarget || this.headingYaw === null) this.headingYaw = this.yaw - this.giveYaw;
    const follow = (out: THREE.Vector3): boolean => {
      const eye = this.eyePosition(this.eye);
      const yaw = this.headingYaw ?? this.yaw;
      out.set(eye.x - Math.sin(yaw) * HEADING_AHEAD, eye.y, eye.z - Math.cos(yaw) * HEADING_AHEAD);
      return true;
    };
    const start = new THREE.Vector3();
    follow(start);
    this.frameView(start, { duration: opts.duration ?? 0.8, give: opts.give ?? 35, hold: opts.hold ?? 0.5, returnTime: opts.returnTime ?? 0.3, follow });
  }

  /** True while a scripted shot holds the view. */
  get framed(): boolean {
    return this.framing !== null;
  }

  /** Forced walk for scripted beats; resolves on arrival (or on reset). */
  walkTo(pos: THREE.Vector3, speed = PLAYER_TUNING.walkSpeed * 0.6, curve?: P3[]): Promise<void> {
    this.walkTarget?.done();
    return new Promise((resolve) => {
      this.walkTarget = { pos: pos.clone(), speed, done: resolve, follower: null, curve: curve?.length ? curve.map((p) => ({ ...p })) : null, warned: false, sinceRepath: 0, stalled: 0 };
    });
  }

  /** Stop a forced walk where it is (a skipped scene teleports the player instead). */
  cancelWalk(): void {
    const w = this.walkTarget;
    this.walkTarget = null;
    w?.done();
  }

  // ------------------------------------------------------------------ combat hooks

  /** Raw damage from an enemy or hazard (difficulty scaling happens in Vitals). */
  damage(amount: number, from?: THREE.Vector3): void {
    const before = this.vitals.hp;
    const change = this.vitals.damage(amount);
    if (!change) return;
    this.hitPulse = 1;
    this.hitSlow = PLAYER_TUNING.hitSlowTime;
    // Camera kick up, plus a nudge away from the hit side.
    this.kickVel += 2.2;
    if (from) {
      this.tmp.subVectors(from, this.eyePosition(this.eye));
      const side = Math.sign(this.tmp.x * Math.cos(this.yaw) - this.tmp.z * Math.sin(this.yaw));
      this.yaw += side * 0.015;
    }
    this.d.events.emit('player:damaged', { amount: before - this.vitals.hp, hp: this.vitals.hp });
    this.onVitals(change);
  }

  heal(amount: number): void {
    this.vitals.heal(amount);
  }

  /** The medic finished reviving the player. */
  revive(): void {
    this.onVitals(this.vitals.revive());
  }

  /** An enemy grabbed the player: view turns to it, "Mash E" to break free. */
  grab(source: THREE.Vector3): void {
    if (this.grabbed || !this.alive) return;
    const release = this.control.push({ move: 'locked', look: 'locked', weapons: false, interact: false }, 'grab');
    this.grabbed = { source: source.clone(), presses: 0, needed: this.d.difficulty().grabMashCount, release };
    this.lookAt(source, { duration: 0.25, weight: 1 });
    this.d.events.emit('player:grabbed', {});
  }

  /** Grab ended from outside (teammate shot the enemy off, enemy died). */
  releaseGrab(): void {
    if (!this.grabbed) return;
    this.grabbed.release();
    this.grabbed = null;
  }

  // ------------------------------------------------------------------ per fixed step

  update(dt: number): void {
    const { input, events, flashlight } = this.d;
    const T = PLAYER_TUNING;
    this.time += dt;
    this.onVitals(this.vitals.update(dt));
    const c = this.control.state;
    const alive = this.alive;

    if (input.wasPressed('flashlight') && c.flashlight && this.vitals.state !== 'dead') {
      flashlight.toggle();
      events.emit('player:flashlight', { on: flashlight.on });
    }

    // Aim: RMB held, weapons allowed, standing.
    const wantAim = alive && c.weapons && !this.grabbed && input.isDown('aim');
    this.aimBlend = approach(this.aimBlend, wantAim ? 1 : 0, dt / T.aimTime);

    this.updateGrab(input.wasPressed('interact'));
    this.updateShove(dt, input.wasPressed('shove') && (c.weapons || this.grabbed !== null) && alive);
    this.updateStomp(dt, this.stompEnabled && input.wasPressed('stomp') && alive && !this.grabbed && this.body.grounded);
    this.updateMovement(dt, c.move);

    // Timers.
    this.hitSlow = Math.max(0, this.hitSlow - dt);
    this.shoveCooldown = Math.max(0, this.shoveCooldown - dt);
    this.stompCooldown = Math.max(0, this.stompCooldown - dt);

    // Interaction ray from the eye.
    this.eyePosition(this.eye);
    this.viewDirection(this.dir);
    const used = this.d.interactions.update(
      dt,
      this.eye,
      this.dir,
      input.wasPressed('interact'),
      input.isDown('interact'),
      c.interact && alive && !this.grabbed,
    );
    if (used) events.emit('interact:used', { id: used.id });
  }

  private updateMovement(dt: number, mode: 'free' | 'slow' | 'locked'): void {
    const T = PLAYER_TUNING;
    const { input } = this.d;
    const dead = this.vitals.state === 'dead';
    const surface = this.world.surfaceAt(this.body.x, this.body.z);
    const wading = surface === 'water';

    // Wish direction in world space.
    let wx = 0;
    let wz = 0;
    let speed = 0;
    if (this.walkTarget) {
      const w = this.walkTarget;
      const dx = w.pos.x - this.body.x;
      const dz = w.pos.z - this.body.z;
      const dist = Math.hypot(dx, dz);
      // As close as the body gets counts too (a spot by furniture, ADR-0028): the follower ran out of route, or stalled at its end.
      const nearEnd = w.follower !== null && w.follower.length - w.follower.progress < 0.6 && dist < 1.6;
      if (dist < ARRIVE || (nearEnd && w.stalled > STALL_TIME)) {
        this.walkTarget = null;
        w.done();
      } else {
        const st = this.followPath(w, dt);
        // Steer at the follower's point a little ahead on the route (ADR-0028).
        const tx = st.tx;
        const tz = st.tz;
        const sx = tx - this.body.x;
        const sz = tz - this.body.z;
        const sd = Math.hypot(sx, sz);
        if (sd > 1e-6) {
          wx = sx / sd;
          wz = sz / sd;
        }
        // The heading shot faces along the route; ignore the last few centimetres, where the steering point sits on the body.
        if (sd > 0.25) this.headingYaw = Math.atan2(-sx, -sz);
        speed = Math.min(Math.max(st.speed, 0.2), dist / dt);
      }
    } else if (mode !== 'locked' && !dead) {
      const f = input.axis('moveBack', 'moveForward');
      const s = input.axis('moveLeft', 'moveRight');
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      wx = -sin * f + cos * s;
      wz = -cos * f - sin * s;
      const len = Math.hypot(wx, wz);
      if (len > 0) {
        wx /= len;
        wz /= len;
      }
      const moving = len > 0;
      // Sprint: forward-ish, standing, not aiming, not wading, stamina left.
      const canSprint = this.alive && moving && f > 0 && this.aimBlend < 0.5 && !wading && mode === 'free' && !this.exhausted;
      this.sprinting = canSprint && input.isDown('sprint');
      if (this.downed) speed = moving ? T.crawlSpeed : 0;
      else if (moving) speed = this.sprinting ? T.sprintSpeed : T.walkSpeed;
      if (!this.downed) {
        speed *= 1 - (1 - T.aimMoveScale) * this.aimBlend;
        if (wading) speed *= T.wadeScale;
        if (mode === 'slow') speed *= T.slowScale;
        if (this.hitSlow > 0) speed *= T.hitSlowScale;
      }
    }
    if (!this.walkTarget && (mode === 'locked' || dead)) this.sprinting = false;
    this.updateStamina(dt);

    // Jump (Space): only from the ground, and never on rails, downed, dead, wading or on a scripted walk.
    const wasAirborne = !this.body.grounded;
    if (mode !== 'locked' && !dead && !this.downed && !this.walkTarget && !wading && this.body.grounded && input.wasPressed('jump')) {
      this.body.vy = T.jumpSpeed;
      this.body.grounded = false;
      // While jumping the motor lets Jay climb onto tops up to its jumpReach (player-movement spec).
      this.body.jumping = true;
    }

    // Accelerate toward the wish velocity (decelerate faster than we speed up).
    const tx = wx * speed;
    const tz = wz * speed;
    const ex = tx - this.velocity.x;
    const ez = tz - this.velocity.y;
    const err = Math.hypot(ex, ez);
    if (err > 0) {
      const speeding = tx * this.velocity.x + tz * this.velocity.y >= 0 && Math.hypot(tx, tz) > 0.01;
      const rate = (speeding ? T.accel : T.decel) * dt;
      const k = Math.min(1, rate / err);
      this.velocity.x += ex * k;
      this.velocity.y += ez * k;
    }

    this.wishDir.x = speed > 0 ? wx : 0;
    this.wishDir.z = speed > 0 ? wz : 0;

    const bodies = this.collectBodies();
    const x0 = this.body.x;
    const z0 = this.body.z;
    let stepX = this.velocity.x * dt;
    let stepZ = this.velocity.y * dt;
    // Sweep against people first so a fast step cannot tunnel through one.
    if (bodies.length > 0) {
      clipMove(x0, z0, stepX, stepZ, bodies, JAY_RADIUS, this.v2);
      stepX = this.v2.x;
      stepZ = this.v2.z;
    }
    const r = moveBody(this.body, stepX, stepZ, dt, { ...DEFAULT_MOTOR, jumpSpeed: T.jumpSpeed }, this.world.colliders);
    if (wasAirborne && this.body.grounded) this.d.events.emit('player:footstep', { surface, x: this.body.x, y: this.body.y, z: this.body.z, sprint: false, landing: true });
    let mx = this.body.x - x0;
    let mz = this.body.z - z0;
    // Walls eat the velocity that pushes into them, so we slide instead of sticking.
    if (r.blocked) this.velocity.set(mx / dt, mz / dt);
    if (r.stepUp > 0) this.stepOffset -= r.stepUp;
    if (bodies.length > 0) {
      this.resolveBodies(bodies);
      // Slide round people: drop the velocity that still points into one.
      removeInward(this.velocity.x, this.velocity.y, this.body.x, this.body.z, bodies, JAY_RADIUS, BODY_MARGIN, this.v2);
      this.velocity.set(this.v2.x, this.v2.z);
      mx = this.body.x - x0;
      mz = this.body.z - z0;
    }
    if (this.walkTarget) this.walkTarget.stalled = Math.hypot(mx, mz) < dt * this.walkTarget.speed * 0.25 ? this.walkTarget.stalled + dt : 0;

    // Head bob + footsteps from distance travelled on the ground.
    const moved = Math.hypot(mx, mz);
    const groundSpeed = moved / dt;
    const reduced = this.d.settings().reducedMotion;
    const ampGoal = this.downed || !this.body.grounded ? 0 : (this.sprinting ? T.bobSprint : T.bobWalk) * Math.min(1, groundSpeed / T.walkSpeed);
    this.bobAmp = approach(this.bobAmp, reduced ? 0 : ampGoal, dt * 0.3);
    if (this.body.grounded && !this.downed && moved > 0) {
      const strideLen = this.sprinting ? T.strideSprint : T.strideWalk;
      this.stride += moved;
      this.bobPhase += (moved / strideLen) * Math.PI;
      if (this.stride >= strideLen) {
        this.stride -= strideLen;
        this.d.events.emit('player:footstep', { surface, x: this.body.x, y: this.body.y, z: this.body.z, sprint: this.sprinting });
      }
    }
    if (groundSpeed < 0.2) this.stride = Math.min(this.stride, PLAYER_TUNING.strideWalk * 0.5);
  }

  /** This step's body circles (reused array). */
  private collectBodies(): Circle[] {
    const out = this.bodyList;
    out.length = 0;
    if (this.bodies) for (const b of this.bodies()) out.push(b);
    return out;
  }

  /**
   * Push Jay out of any person he overlaps, through moveBody so a correction can never put him
   * inside a wall. A few passes so two bodies side by side both get honoured.
   */
  private resolveBodies(bodies: readonly Circle[]): void {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of bodies) {
        // Coincident centres leave against the wish (or along +X).
        pushOut(this.body.x, this.body.z, b, JAY_RADIUS, -this.wishDir.x, -this.wishDir.z, this.v2);
        if (this.v2.x === 0 && this.v2.z === 0) continue;
        // dt 0: pushing out of a person must not integrate gravity a second time in the same frame.
        moveBody(this.body, this.v2.x, this.v2.z, 0, DEFAULT_MOTOR, this.world.colliders);
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Keep a scripted walk's route fresh (ADR-0028): plan, re-plan nav routes on a timer, and re-route on a stall. */
  private followPath(w: WalkTarget, dt: number): ReturnType<PathFollower['update']> {
    w.sinceRepath += dt;
    const stalled = w.stalled > STALL_TIME;
    if (!w.follower || stalled || (!w.curve && w.sinceRepath >= REPATH_EVERY)) {
      // Stuck on an authored line (Jay was shoved off it): route straight to the spot instead.
      if (stalled) w.curve = null;
      w.sinceRepath = 0;
      w.stalled = 0;
      const y = this.body.y;
      const toY = Math.abs(w.pos.y - y) < FEET_ANCHOR_Y ? w.pos.y : y;
      const from = { x: this.body.x, y, z: this.body.z };
      const plan = planWalk(from, { x: w.pos.x, y: toY, z: w.pos.z }, { nav: this.nav, world: this.world.colliders, radius: DEFAULT_MOTOR.radius }, w.curve ?? undefined);
      if (!plan.routed && this.nav && !w.warned) {
        w.warned = true;
        console.warn(`[nav] Jay: no route from ${from.x.toFixed(1)},${from.z.toFixed(1)} to ${w.pos.x.toFixed(1)},${w.pos.z.toFixed(1)}; walking straight`);
      }
      w.follower = new PathFollower(plan.points, { speed: w.speed, v0: w.follower?.speed ?? 0 });
    }
    return w.follower.update(this.body.x, this.body.z, dt);
  }

  private updateStamina(dt: number): void {
    const T = PLAYER_TUNING;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt);
      this.sinceSprint = 0;
      if (this.stamina === 0) {
        this.exhausted = true;
        this.sprinting = false;
      }
    } else {
      this.sinceSprint += dt;
      if (this.sinceSprint >= T.sprintRegenDelay) this.stamina = Math.min(T.sprintMax, this.stamina + T.sprintRegenRate * dt);
      // Need a second of stamina back before sprinting again (no stutter-sprinting).
      if (this.exhausted && this.stamina >= 1) this.exhausted = false;
    }
  }

  private updateShove(dt: number, pressed: boolean): void {
    const T = PLAYER_TUNING;
    if (pressed && this.shoveWindup < 0 && this.shoveCooldown <= 0) {
      this.shoveWindup = 0;
      this.shoveCooldown = T.shoveCooldown;
      // Shoving while grabbed counts double toward breaking free.
      if (this.grabbed) this.grabbed.presses += 2;
    }
    if (this.shoveWindup < 0) return;
    this.shoveWindup += dt;
    this.shoveLunge = Math.sin(Math.min(1, this.shoveWindup / T.shoveWindup) * Math.PI * 0.5);
    if (this.shoveWindup >= T.shoveWindup) {
      this.shoveWindup = -1;
      const o = this.eyePosition(this.eye);
      const d = this.viewDirection(this.dir);
      this.d.events.emit('player:shove', {
        origin: [o.x, o.y, o.z],
        dir: [d.x, d.y, d.z],
        range: T.shoveRange,
        coneDeg: T.shoveConeDeg,
        damage: T.shoveDamage,
        push: T.shovePush,
      });
      this.kickVel -= 1.2;
    }
  }

  /** Stomp (adopt-physics-engine Block 5): lift the view a touch, then bring it down with the boot and report where it lands. */
  private updateStomp(dt: number, pressed: boolean): void {
    const T = PLAYER_TUNING;
    if (pressed && this.stompWindup < 0 && this.stompCooldown <= 0) {
      this.stompWindup = 0;
      this.stompCooldown = T.stompCooldown;
    }
    if (this.stompWindup < 0) return;
    this.stompWindup += dt;
    const k = Math.min(1, this.stompWindup / T.stompWindup);
    // Up a little while the knee lifts (first 60%), then down fast onto the boot.
    this.stompDip = k < 0.6 ? -0.35 * Math.sin((k / 0.6) * Math.PI * 0.5) : -0.35 + 1.35 * ((k - 0.6) / 0.4) ** 2;
    if (this.stompWindup >= T.stompWindup) {
      this.stompWindup = -1;
      const d = this.viewDirection(this.dir);
      this.d.events.emit('player:stomp', { at: [this.body.x, this.body.y, this.body.z], dir: [d.x, d.y, d.z] });
      this.kickVel -= 0.8;
    }
  }

  private updateGrab(mashed: boolean): void {
    const g = this.grabbed;
    if (!g) return;
    if (mashed) g.presses++;
    if (g.presses >= g.needed) {
      this.releaseGrab();
      // Stagger back out of the grab.
      this.tmp.set(this.body.x - g.source.x, 0, this.body.z - g.source.z).normalize();
      this.velocity.set(this.tmp.x * 3, this.tmp.z * 3);
      this.d.events.emit('player:grabEscaped', {});
    }
  }

  private onVitals(change: VitalsChange): void {
    if (!change) return;
    const ev = this.d.events;
    if (change === 'downed') {
      this.releaseGrab();
      this.stateLayer?.();
      this.stateLayer = this.control.push({ interact: false, flashlight: true }, 'downed');
      ev.emit('player:downed', { bleedOut: this.vitals.bleed });
    } else if (change === 'revived') {
      this.stateLayer?.();
      this.stateLayer = null;
      ev.emit('player:revived', { hp: this.vitals.hp });
    } else if (change === 'died') {
      this.releaseGrab();
      this.stateLayer?.();
      this.stateLayer = this.control.push(
        { move: 'locked', look: 'locked', weapons: false, interact: false, flashlight: false },
        'dead',
      );
      ev.emit('player:died', {});
    }
  }

  // ------------------------------------------------------------------ per rendered frame

  /** Mouse look, look assist and look clamp. Call once per rendered frame. */
  look(frameDt: number): void {
    const { x, y } = this.d.input.consumeLook();
    const mode = this.control.state.look;
    const s = this.d.settings();
    if (this.framing && !this.grabbed) {
      this.lookFramed(this.framing, x, y, frameDt, mode !== 'locked', s);
      return;
    }
    if (mode !== 'locked') {
      const k = LOOK_SCALE * s.mouseSensitivity * (1 - 0.35 * this.aimBlend);
      this.yaw -= x * k;
      this.pitch -= y * k * (s.invertY ? -1 : 1);
    }

    const eye = this.eyePosition(this.eye);
    if (this.assist) {
      const a = this.assist;
      a.t += frameDt;
      const [ty, tp] = anglesTo(eye, a.target);
      // Pull a share of the remaining error each frame: reaches the target in about
      // `duration` if the player does not fight it.
      const pull = (1 - Math.exp((-5 * frameDt) / a.duration)) * a.weight;
      this.yaw += wrapAngle(ty - this.yaw) * pull;
      this.pitch += (tp - this.pitch) * pull;
      if (a.t >= a.duration && !this.grabbed) this.assist = null;
    }
    if (this.grabbed) {
      // Keep facing whatever holds us.
      const [ty, tp] = anglesTo(eye, this.grabbed.source);
      const pull = 1 - Math.exp(-12 * frameDt);
      this.yaw += wrapAngle(ty - this.yaw) * pull;
      this.pitch += (tp - this.pitch) * pull;
    }

    if (mode === 'clamped') {
      let cy: number;
      let cp: number;
      if (this.clampCenter) [cy, cp] = anglesTo(eye, this.clampCenter);
      else {
        this.clampFallback ??= { yaw: this.yaw, pitch: this.pitch };
        cy = this.clampFallback.yaw;
        cp = this.clampFallback.pitch;
      }
      // Elliptical clamp around the centre.
      const dy = wrapAngle(this.yaw - cy);
      const dp = this.pitch - cp;
      const half = this.clampHalf;
      const e = Math.hypot(dy / half, dp / (half * 0.75));
      if (e > 1) {
        this.yaw = cy + dy / e;
        this.pitch = cp + dp / e;
      }
    } else {
      this.clampFallback = null;
    }
    this.yaw = wrapAngle(this.yaw);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  private lookFramed(f: Framing, x: number, y: number, frameDt: number, mouse: boolean, s: Readonly<Settings>): void {
    if (f.follow) f.follow(f.target);
    const [ty, tp] = anglesTo(this.eyePosition(this.eye), f.target);
    const duration = f.duration * (s.reducedMotion ? REDUCED_TURN_SCALE : 1);
    const pull = duration <= 0 ? 1 : 1 - Math.exp((-5 * frameDt) / duration);
    f.yaw = wrapAngle(f.yaw + wrapAngle(ty - f.yaw) * pull);
    f.pitch += (tp - f.pitch) * pull;

    const pushed = mouse && (x !== 0 || y !== 0);
    if (pushed) {
      const k = LOOK_SCALE * s.mouseSensitivity;
      this.giveYaw -= x * k;
      this.givePitch -= y * k * (s.invertY ? -1 : 1);
      this.sinceGive = 0;
    } else {
      // Spring back to the scripted aim once the mouse has been still for the shot's hold time.
      this.sinceGive += frameDt;
      if (this.sinceGive >= f.hold) {
        const decay = Math.exp(-frameDt / f.returnTime);
        this.giveYaw *= decay;
        this.givePitch *= decay;
      }
    }
    // Elliptical limit, a little tighter vertically (same shape as the look clamp).
    const e = Math.hypot(this.giveYaw / f.give, this.givePitch / (f.give * 0.75));
    if (e > 1) {
      this.giveYaw /= e;
      this.givePitch /= e;
    }
    this.yaw = wrapAngle(f.yaw + this.giveYaw);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, f.pitch + this.givePitch));
  }

  /** Put the camera at the eye with bob, step smoothing, kick and aim FOV. */
  applyCamera(frameDt: number): void {
    const T = PLAYER_TUNING;
    const cam = this.d.camera;
    const dt = Math.min(frameDt, 1 / 20);
    const reduced = this.d.settings().reducedMotion;

    const eyeGoal = this.vitals.state === 'alive' ? T.eyeHeight : T.downedEyeHeight;
    this.eyeHeight += (eyeGoal - this.eyeHeight) * Math.min(1, dt * (eyeGoal < this.eyeHeight ? 5 : 3));
    this.stepOffset *= Math.exp(-14 * dt);

    // Kick: damped spring back to zero.
    this.kickVel += (-60 * this.kick - 9 * this.kickVel) * dt;
    this.kick += this.kickVel * dt;

    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.6;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const lunge = this.shoveLunge * (reduced ? 0.05 : 0.12);
    const dip = this.stompDip * (reduced ? 0.03 : 0.09);
    cam.position.set(
      this.body.x + cos * bobX - sin * lunge,
      this.body.y + this.eyeHeight + this.stepOffset + bobY - dip,
      this.body.z - sin * bobX - cos * lunge,
    );
    if (this.shoveWindup < 0) this.shoveLunge *= Math.exp(-10 * dt);
    if (this.stompWindup < 0) this.stompDip *= Math.exp(-9 * dt);
    const kickScale = reduced ? 0.3 : 1;
    // Scripted walks get a faint roll sway so they read as walking, not a dolly (intro-sequence spec).
    const sway = this.walkTarget && !reduced ? Math.sin(this.bobPhase) * WALK_SWAY * Math.min(1, this.bobAmp / T.bobWalk) : 0;
    const roll = (this.vitals.state === 'alive' ? 0 : 0.22 * (1 - this.eyeHeight / T.eyeHeight) * (reduced ? 0.3 : 1)) + sway;
    cam.rotation.set(this.pitch + this.kick * 0.06 * kickScale, this.yaw, roll);

    const fov = this.d.settings().fov * (1 - (1 - T.aimFovScale) * smooth(this.aimBlend));
    if (Math.abs(fov - this.lastFov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      this.lastFov = fov;
    }

    // Damage grade: hit flash, low-health pulse, downed/dead darkening.
    this.hitPulse *= Math.exp(-3.5 * dt);
    let fx = this.hitPulse * 0.9;
    if (this.vitals.low) fx = Math.max(fx, 0.28 + 0.08 * Math.max(0, Math.sin(this.time * 7.5)));
    if (this.downed) fx = Math.max(fx, 0.75);
    if (this.vitals.state === 'dead') fx = 1;
    this.damageFx = fx;
  }
}

function approach(v: number, goal: number, step: number): number {
  return v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** [yaw, pitch] that point the view from `from` at `to`. */
function anglesTo(from: THREE.Vector3, to: THREE.Vector3): [number, number] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}
