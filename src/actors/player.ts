import * as THREE from 'three';
import type { EventBus } from '../core/events.ts';
import type { Input } from '../core/input.ts';
import type { Settings } from '../core/settings.ts';
import type { DifficultyPreset } from '../data/types/difficulty.ts';
import type { Flashlight } from '../render/flashlight.ts';
import { ControlStack } from './control.ts';
import type { Interactions } from './interaction.ts';
import { DEFAULT_MOTOR, moveBody, type ColliderQuery, type MotorState } from './motor.ts';
import { MAX_HP, Vitals, type VitalsChange } from './vitals.ts';

/** Footstep / wading surfaces (ADR-0003 `surfaces`). */
export type Surface = 'metal' | 'grate' | 'rubber' | 'water';

/** What the player needs from the level. ADR-0003's loader provides both. */
export interface PlayerWorld {
  colliders: ColliderQuery;
  surfaceAt(x: number, z: number): Surface;
}

declare module '../core/events.ts' {
  interface EventMap {
    'player:footstep': { surface: Surface; x: number; y: number; z: number; sprint: boolean };
    'player:flashlight': { on: boolean };
    'player:damaged': { amount: number; hp: number };
    'player:downed': { bleedOut: number };
    'player:revived': { hp: number };
    'player:died': Record<string, never>;
    /** Shove released: enemies in the cone are pushed and staggered (ADR-0007). */
    'player:shove': { origin: [number, number, number]; dir: [number, number, number]; range: number; coneDeg: number; damage: number; push: number };
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
  eyeHeight: 1.62,
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
  hitSlowTime: 0.3,
  hitSlowScale: 0.5,
  shoveWindup: 0.25,
  shoveCooldown: 1.2,
  shoveRange: 1.4,
  shoveConeDeg: 70,
  shoveDamage: 5,
  shovePush: 1.5,
};

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
/** Radians per pixel at sensitivity 1 (same as the free camera). */
const LOOK_SCALE = 0.0022;
const ARRIVE = 0.12;

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
  private assist: LookAssist | null = null;
  private clampCenter: THREE.Vector3 | null = null;
  private clampHalf = THREE.MathUtils.degToRad(20);
  private clampFallback: { yaw: number; pitch: number } | null = null;
  private walkTarget: { pos: THREE.Vector3; speed: number; done: () => void } | null = null;
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
    this.walkTarget?.done();
    this.walkTarget = null;
    this.velocity.set(0, 0);
    this.aimBlend = 0;
    this.stamina = PLAYER_TUNING.sprintMax;
    this.exhausted = false;
    this.hitSlow = this.hitPulse = this.kick = this.kickVel = 0;
    this.shoveWindup = -1;
    this.shoveCooldown = 0;
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

  /** Forced walk for scripted beats; resolves on arrival (or on reset). */
  walkTo(pos: THREE.Vector3, speed = PLAYER_TUNING.walkSpeed * 0.6): Promise<void> {
    this.walkTarget?.done();
    return new Promise((resolve) => {
      this.walkTarget = { pos: pos.clone(), speed, done: resolve };
    });
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
    this.updateMovement(dt, c.move);

    // Timers.
    this.hitSlow = Math.max(0, this.hitSlow - dt);
    this.shoveCooldown = Math.max(0, this.shoveCooldown - dt);

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
      const dx = this.walkTarget.pos.x - this.body.x;
      const dz = this.walkTarget.pos.z - this.body.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVE) {
        const done = this.walkTarget.done;
        this.walkTarget = null;
        done();
      } else {
        wx = dx / dist;
        wz = dz / dist;
        speed = Math.min(this.walkTarget.speed, dist / dt);
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

    const x0 = this.body.x;
    const z0 = this.body.z;
    const r = moveBody(this.body, this.velocity.x * dt, this.velocity.y * dt, dt, DEFAULT_MOTOR, this.world.colliders);
    const mx = this.body.x - x0;
    const mz = this.body.z - z0;
    // Walls eat the velocity that pushes into them, so we slide instead of sticking.
    if (r.blocked) this.velocity.set(mx / dt, mz / dt);
    if (r.stepUp > 0) this.stepOffset -= r.stepUp;

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
    cam.position.set(
      this.body.x + cos * bobX - sin * lunge,
      this.body.y + this.eyeHeight + this.stepOffset + bobY,
      this.body.z - sin * bobX - cos * lunge,
    );
    if (this.shoveWindup < 0) this.shoveLunge *= Math.exp(-10 * dt);
    const kickScale = reduced ? 0.3 : 1;
    const roll = this.vitals.state === 'alive' ? 0 : 0.22 * (1 - this.eyeHeight / T.eyeHeight) * (reduced ? 0.3 : 1);
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
