import * as THREE from 'three';
import { DEFAULT_MOTOR, floorHeight, moveBody, type MotorConfig, type MotorState } from '../actors/motor.ts';
import { Humanoid, type HumanoidContext, type HumanoidSpec } from '../actors/humanoid.ts';
import { GILES, OKAFOR } from '../actors/squadLooks.ts';
import { tellsFor } from '../actors/castTells.ts';
import { InjuryExposure, injuryWeight, inView } from '../actors/injury.ts';
import { REACH_DY } from './enemy.ts';
import { inPlayerView } from './perception.ts';
import { GIVE_WAY, GiveWay, type WayEnv } from './giveWay.ts';
import type { Navigator, P3 } from './nav.ts';
import {
  COMBAT,
  KillShare,
  REVIVE,
  REVIVE_TASK,
  ReviveJob,
  SquadTask,
  TASK_ARRIVE,
  TASK_ARRIVE_CLOSE,
  TASK_DEVICE_REACH,
  TASK_GIVE_UP,
  TASK_JAY_BLOCK,
  TASK_JAY_STALL,
  TASK_THREAT,
  aimFor,
  enemyWeight,
  ladderStage,
  pickTarget,
  playerDownIsGameOver,
  type SquadEnemy,
  type SquadEnemySource,
  type SquadId,
  type TaskDevice,
  type TaskEvents,
} from './squadBrain.ts';
import { Rng } from '../core/rng.ts';

export type { SquadId, SquadEnemy, SquadEnemySource } from './squadBrain.ts';

/** A plain world point or direction in an event payload. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Events the squad raises, for barks, hints and the HUD (ADR-0012) to hook. */
export interface SquadEvents {
  'squad:reloading': { id: SquadId };
  'squad:downed': { id: SquadId };
  'squad:up': { id: SquadId; revived: boolean };
  /** Okafor finished a revive (`target` is 'player' or 'engineer'). */
  'squad:revived': { id: SquadId; target: 'player' | 'engineer' };
  /** Revive ring on Jay's screen; progress 0..1, `paused` while Okafor is being hit. */
  'squad:reviveProgress': { target: 'player' | 'engineer'; progress: number; paused: boolean };
  'squad:taskStarted': { id: SquadId; task: string; panel: string | null; progress: number };
  'squad:taskProgress': { id: SquadId; task: string; panel: string | null; progress: number };
  /** An enemy reached the worker: he stops, calls for help and defends. */
  'squad:taskPaused': { id: SquadId; task: string; panel: string | null; progress: number };
  'squad:taskResumed': { id: SquadId; task: string; panel: string | null; progress: number };
  'squad:taskDone': { id: SquadId; task: string; panel: string | null; progress: number };
  /** The medic is down: no safety net (medic icon flashes, Giles barks). */
  'squad:noSafetyNet': { downed: boolean };
  /** Jay went down while the medic was down (ADR-0011): game over. */
  'squad:gameOver': { reason: 'medicDown' };
  'squad:shoved': { id: SquadId; enemy: string };
  /**
   * One squad shot (squad-sidearms D4): `muzzle` (the hit origin), `ejectPort`, the gun's `right` and the bore's `forward` (world), read from the mate's
   * held pistol; `fromPistol` false when the body had no pistol showing, and the points fall back to 1.4 m above the mate.
   */
  'squad:fired': { id: SquadId; enemy: string; hit: boolean; killed: boolean; muzzle: Vec3; ejectPort: Vec3; right: Vec3; forward: Vec3; fromPistol: boolean; boost?: number; gain?: number };
  'squad:infectionStage': { stage: number };
  /** A tell played (cough, rub_forearm, flex_hand), for audio and barks. */
  'squad:tell': { id: SquadId; tell: string };
}

declare module '../core/events.ts' {
  interface EventMap extends SquadEvents {}
}

/** Difficulty numbers the squad reads (ADR-0008). */
export interface SquadDifficulty {
  squadDamage: number;
  squadAccuracy: number;
  medicDownedTime: number;
}

/**
 * Squad AI, follow layer (ADR-0011 steps 1-2). Giles and Okafor are humanoid bodies moved
 * through the same collision motor as the player. Each picks a target every 0.25 s:
 * - a formation slot beside/behind Jay when it is reachable in plain view,
 * - otherwise a point on Jay's breadcrumb trail (corridors, doorways),
 * - sidestepping out of Jay's aim cone (15 degrees) when they drift into it.
 * They path with the shared navgraph, keep apart from Jay and each other (everyone is solid to Jay: a
 * mate standing in his way steps aside, or out of a doorway, within half a second),
 * and catch up by teleporting when far away and out of sight. Combat, tasks and revives
 * (ADR-0011 steps 3+) layer on top of this later.
 */

/** What the squad reads from the player each step. */
export interface SquadPlayer {
  body: MotorState;
  yaw: number;
  velocity: { x: number; y: number };
  /** Unit XZ direction Jay is trying to move (zero when not moving); mates standing in his way give way. */
  wish?: { x: number; z: number };
  /** 0..1, how far into aim-down-sights Jay is. */
  aimBlend: number;
  viewDirection(out?: THREE.Vector3): THREE.Vector3;
  eyePosition(out?: THREE.Vector3): THREE.Vector3;
  /** Downed and waiting for the medic (ADR-0004); absent = never downed. */
  readonly downed?: boolean;
  /** The medic's revive finished. */
  revive?(): void;
}

export type Behaviour = 'follow' | 'combat' | 'task' | 'revive' | 'downed';

interface Role {
  id: SquadId;
  spec: Omit<HumanoidSpec, 'role'>;
  /** Slot in Jay's frame: metres to the right, metres behind. */
  slot: [right: number, back: number];
  /** Fallback distance back along the trail. */
  trail: number;
}

const ROLES: Role[] = [
  { id: 'engineer', spec: { ...GILES, transformable: true }, slot: [1.4, 1.8], trail: 2.6 },
  // The medic's slot is always behind the player (ADR-0011).
  { id: 'medic', spec: OKAFOR, slot: [-1.0, 3.2], trail: 4.2 },
];

export const SQUAD_TUNING = {
  think: 0.25,
  repath: 0.5,
  arrive: 0.7,
  /** Half-angle of Jay's aim cone that squadmates keep out of. */
  aimCone: THREE.MathUtils.degToRad(15),
  aimConeRange: 18,
  teleportDistance: 25,
  /** Keep-apart radii. */
  personalPlayer: 1.1,
  personalMate: 0.9,
  /** Within this of Jay they stop and stay put (10 ft)... */
  stopDistance: 3.0,
  /** ...until he is this far away again. */
  resumeDistance: 4.5,
  /** Only clear the line of fire when Jay is actually aiming (aim held this long). */
  aimHold: 0.35,
  walk: 1.3,
  /** Brisk walk once they fall well behind, a jog only when far behind. */
  brisk: 2.4,
  jog: 3.4,
  trailStep: 0.4,
  trailLength: 80,
} as const;

const MOTOR: MotorConfig = { ...DEFAULT_MOTOR, radius: 0.3 };

/** Quiet idle poses for the squad (no head yaw: the look-at layer already turns their heads). */
const SQUAD_FIDGETS: readonly string[] = ['idle_weight', 'idle_shift', 'look_down', 'head_tilt', 'idle_crossed'];

/** `squadRegroup`: squadmates within this distance of Jay are never moved (squad-tasks spec). */
export const REGROUP_DISTANCE = 12;

export class SquadMate {
  readonly id: SquadId;
  readonly body: Humanoid;
  readonly motor: MotorState;
  /** Debug: why the current target was chosen. */
  mode: 'slot' | 'trail' | 'aimDodge' | 'idle' | 'task' | 'revive' | 'backoff' = 'idle';
  /** What the selector chose (ADR-0011): follow, combat, task, revive, downed. */
  behaviour: Behaviour = 'follow';
  /** A sequence drives this body (NPC actions): the AI yields completely. */
  scripted = false;
  /** Held in place on a moving train (transit ride): no follow, give-way, catch-up or regroup; only Jay's body can shove them. */
  rideLocked = false;
  /** Pre-allocated weapon-mounted dynamic flashlight (zero scene light count change). */
  flashlightOn = false;
  /**
   * The light and its target hang from `Squad.group`, never from the body: the body is hidden when far away, and a
   * hidden light drops out of the scene's light count, which recompiles every lit material (render-lighting "The set
   * of real lights stays constant during play").
   */
  readonly weaponLight: THREE.SpotLight;
  readonly weaponLightTarget: THREE.Object3D;
  private scriptedBurst: { target: THREE.Vector3; remaining: number; interval: number; t: number; boost: number; gain: number } | null = null;
  private scriptedAimGet: (() => P3 | null) | null = null;
  hp: number = REVIVE.maxHp;
  /** Seconds left lying down. */
  downedT = 0;
  /** Current panel job (Giles's bypass, Okafor's biometric lock). */
  task: SquadTask | null = null;
  /** Walking to a task's spot: the task watched, the closest he has got and how long since he got closer. */
  private approach: { task: SquadTask | null; best: number; stall: number } = { task: null, best: Infinity, stall: 0 };
  /** Smooth turn-in toward the panel/device heading on arrival or resume (no single-frame snap). */
  private taskTurn: { yaw: number; t: number } | null = null;
  /** Seconds actively working with hand IK engaged on the current device. */
  private taskWorkT = 0;
  private readonly taskLook = new THREE.Vector3();
  private readonly taskHandL = new THREE.Vector3();
  private readonly taskHandR = new THREE.Vector3();
  private readonly taskNormal = new THREE.Vector3();
  private readonly taskRight = new THREE.Vector3();
  /** Okafor's revive in progress. */
  revive: ReviveJob | null = null;
  /** Combat target id. */
  targetId: string | null = null;
  ammo: number = COMBAT.magazine;
  private fireT = 0;
  private reloadT = 0;
  private grabbedT = 0;
  private gestureT = 30;
  private gestureLeft = 0;
  private hitT = 0;
  private readonly rng: Rng;
  /** Own stream for idle fidgets, so they never shift the combat rolls on `rng`. */
  private readonly idleRng: Rng;
  private ambientT = 5;
  readonly target = new THREE.Vector3();
  private readonly role: Role;
  private path: P3[] | null = null;
  private pathIndex = 0;
  private pathTarget = new THREE.Vector3(Infinity, 0, 0);
  private thinkT = 0;
  private repathT = 0;
  private stuckT = 0;
  private readonly lastPos = new THREE.Vector3();
  /** The target's aim point this mate looks and points the pistol at. */
  private readonly aimPoint = new THREE.Vector3();
  /** Side committed to while dodging out of the aim cone (0 = not dodging). */
  private dodgeSide = 0;
  /** Walking after Jay (true) or standing where they are (false). */
  private following = false;
  /** Giving way to Jay: stepping to `way.spot`, then holding there until he has moved on. */
  private readonly way = new GiveWay();
  private wayPhase: 'out' | 'hold' | null = null;
  private wayT = 0;

  constructor(role: Role, ctx: HumanoidContext) {
    this.role = role;
    this.id = role.id;
    this.body = new Humanoid({ ...role.spec, role: 'npc' }, ctx);
    this.motor = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
    // Stagger the two so they don't think on the same frame.
    this.thinkT = role.id === 'medic' ? SQUAD_TUNING.think / 2 : 0;
    this.rng = new Rng(`squad:${role.id}`);
    this.idleRng = new Rng(`squad-idle:${role.id}`);
    this.ambientT = this.idleRng.range(3, 8);
    // Pre-allocated weapon-mounted spotlight (off by default, fixed light budget).
    this.weaponLight = new THREE.SpotLight(0xdcecff, 0, 24, Math.PI / 6.2, 0.55, 1.4);
    this.weaponLight.name = `squad_weapon_light_${role.id}`;
    this.weaponLight.castShadow = false;
    this.weaponLightTarget = new THREE.Object3D();
    this.weaponLightTarget.name = `squad_weapon_light_target_${role.id}`;
    this.weaponLight.target = this.weaponLightTarget;
  }

  /** Toggle the pre-allocated weapon-mounted dynamic flashlight. */
  setFlashlight(on: boolean): void {
    this.flashlightOn = on;
    this.updateWeaponFlashlight();
  }

  /**
   * Keep the weapon flashlight at the muzzle/hand, aimed along the gun bore (or heading), and dark while the mate is
   * hidden. Positions are world ones: `Squad.group` sits at the origin.
   */
  updateWeaponFlashlight(): void {
    const lit = this.flashlightOn && this.body.group.visible;
    this.weaponLight.intensity = lit ? 42 : 0;
    if (!lit) return;
    const gun = shotPoints(this);
    this.weaponLight.position.set(gun.muzzle.x, gun.muzzle.y, gun.muzzle.z);
    const aim = this.body.aimTarget;
    if (aim) this.weaponLightTarget.position.set(aim.x, aim.y, aim.z);
    else this.weaponLightTarget.position.set(gun.muzzle.x + gun.forward.x * 8, gun.muzzle.y + gun.forward.y * 8, gun.muzzle.z + gun.forward.z * 8);
  }

  /** Hold pistol drawn forward tracking a live world target (or null to release). */
  setScriptedAim(get: (() => P3 | null) | null): void {
    this.scriptedAimGet = get;
    if (get) {
      this.body.setPose('aim_pistol', 0.2);
      this.updateScriptedAim(0);
    } else if (!this.scriptedBurst) {
      this.body.aimTarget = null;
    }
  }

  /** Keep pistol and gaze tracking `scriptedAimGet` (runs even while `scripted` is true). */
  updateScriptedAim(dt: number): void {
    if (!this.scriptedAimGet) return;
    const t = this.scriptedAimGet();
    if (!t) return;
    const aim = this.aimPoint.set(t.x, t.y, t.z);
    this.body.lookTarget = aim;
    this.body.aimTarget = aim;
    if (this.scriptedBurst) this.scriptedBurst.target.copy(aim);
    if (this.body.idlePose !== 'aim_pistol') this.body.setPose('aim_pistol', 0.2);
    // Gently turn toward the aim target only when completely stationary, without calling setHeading() (which zeroes speed/velocity).
    if (this.body.speed < 0.005) {
      const dx = t.x - this.position.x;
      const dz = t.z - this.position.z;
      if (Math.hypot(dx, dz) > 0.05) {
        const want = Math.atan2(-dx, -dz);
        const diff = Math.atan2(Math.sin(want - this.body.heading), Math.cos(want - this.body.heading));
        if (Math.abs(diff) > 0.02) {
          this.body.heading += diff * (dt > 0 ? Math.min(1, dt * 5) : 1);
          this.body.group.rotation.y = this.body.heading;
        }
      }
    }
  }

  /** Queue timed scripted pistol bursts toward a world point (e.g. R16 surveillance finale). */
  startScriptedFire(target: P3, bursts: number, interval: number, boost: number, delay: number, gain = 1): void {
    const aim = this.aimPoint.set(target.x, target.y, target.z);
    this.body.lookTarget = aim;
    this.body.aimTarget = aim;
    this.body.setPose('aim_pistol', 0.15);
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    // Snap to the target only when standing: setHeading stops the body, and a mate backing away (npcMoveTo `face`) already faces it.
    if (Math.hypot(dx, dz) > 0.05 && this.body.speed < 0.05) this.body.setHeading(Math.atan2(-dx, -dz));
    this.scriptedBurst = { target: aim.clone(), remaining: Math.max(0, Math.round(bursts)), interval: Math.max(0.08, interval), t: Math.max(0, delay), boost, gain };
  }

  /** End any scripted bursts now, leaving the aim and the light where they are. */
  stopScriptedFire(): void {
    this.scriptedBurst = null;
  }

  /** Advance any active scripted pistol bursts (runs even while `scripted` is true). */
  updateScriptedFire(dt: number, squad: Squad): void {
    const b = this.scriptedBurst;
    if (!b) return;
    if (b.remaining <= 0) {
      this.scriptedBurst = null;
      return;
    }
    this.body.lookTarget = this.aimPoint.copy(b.target);
    this.body.aimTarget = this.aimPoint;
    b.t -= dt;
    if (b.t <= 0) {
      b.t += b.interval;
      b.remaining--;
      const gun = shotPoints(this);
      squad.emit('squad:fired', { id: this.id, enemy: 'scripted', hit: false, killed: false, boost: b.boost, ...(b.gain !== 1 ? { gain: b.gain } : {}), ...gun });
    }
  }

  get downed(): boolean {
    return this.behaviour === 'downed';
  }

  /** Soft push from actor separation (the director clears overlap with Jay): slides through level collision. */
  nudge(dx: number, dz: number, colliders: Navigator['world'] | null): void {
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

  /** Re-decide on the next step (a task or script just changed). */
  thinkNow(): void {
    this.thinkT = 0;
  }

  /** Working a panel right now (not walking to it, not finished). */
  get working(): boolean {
    return this.task !== null && (this.task.state === 'working' || this.task.state === 'paused');
  }

  /** Release panel hand IK, surface normals, foot pinning, and turn-in state. */
  clearTaskRig(): void {
    this.body.handTargets.L = null;
    this.body.handTargets.R = null;
    this.body.handTargetNormals.L = null;
    this.body.handTargetNormals.R = null;
    this.body.handTargetWeights.L = 1;
    this.body.handTargetWeights.R = 1;
    this.body.plantFeet = false;
    this.taskTurn = null;
    this.taskWorkT = 0;
  }

  /** Desired facing angle when working a task: aim directly at the physical device if present, else anchor yaw or spot. */
  private taskFacingYaw(t: SquadTask, me: THREE.Vector3, useSpotDirection: boolean): number {
    if (t.device) {
      const dx = t.device.pos.x - me.x;
      const dz = t.device.pos.z - me.z;
      if (Math.hypot(dx, dz) > 0.05) return Math.atan2(-dx, -dz);
    }
    if (!useSpotDirection && t.yaw !== undefined) return t.yaw;
    if (t.at) {
      const dx = t.at.x - me.x;
      const dz = t.at.z - me.z;
      if (Math.hypot(dx, dz) > 1e-3) return Math.atan2(-dx, -dz);
    }
    return t.yaw ?? this.body.heading;
  }

  /** Drive device gaze and animated vertical-wall hand IK while working a door/panel job within arm reach. */
  private updateTaskHands(dt: number, t: SquadTask, me: THREE.Vector3, aligned: boolean): void {
    const dev = t.device;
    if (!dev) {
      this.body.handTargets.L = null;
      this.body.handTargets.R = null;
      this.body.handTargetNormals.L = null;
      this.body.handTargetNormals.R = null;
      return;
    }
    this.body.lookTarget = this.taskLook.set(dev.pos.x, dev.pos.y, dev.pos.z);
    const reach = Math.hypot(dev.pos.x - me.x, dev.pos.z - me.z);
    if (!aligned || reach > TASK_DEVICE_REACH) {
      this.body.handTargets.L = null;
      this.body.handTargets.R = null;
      this.body.handTargetNormals.L = null;
      this.body.handTargetNormals.R = null;
      return;
    }
    this.taskWorkT += dt;
    const n = this.taskNormal.set(dev.normal.x, dev.normal.y, dev.normal.z).normalize();
    // Character facing -n into the wall: character's right along the wall plane is (-n) x UP = (n.z, 0, -n.x).
    const right = this.taskRight.set(n.z, 0, -n.x);
    if (right.lengthSq() > 1e-6) right.normalize();
    else right.set(1, 0, 0);

    const smooth01 = (x: number): number => {
      const c = THREE.MathUtils.clamp(x, 0, 1);
      return c * c * (3 - 2 * c);
    };
    const surfaceOff = 0.025;

    if (t.pose === 'biometric_scan') {
      // Tomas: left arm relaxed at his side; right hand taps the lower bezel briefly, then presses flat on the scanner.
      const fadeIn = smooth01(this.taskWorkT / 0.42);
      const fadeOut = 1 - smooth01((t.progress - 0.91) / 0.09);
      const w = fadeIn * fadeOut;
      const tapPhase = this.taskWorkT < 0.7;
      const tapU = tapPhase ? smooth01(this.taskWorkT / 0.35) : 1;
      const dy = tapPhase ? THREE.MathUtils.lerp(-0.055, 0, smooth01((this.taskWorkT - 0.35) / 0.35)) : Math.sin(this.taskWorkT * 1.4) * 0.004;
      const dx = tapPhase ? 0.015 * (1 - smooth01((this.taskWorkT - 0.35) / 0.35)) : Math.cos(this.taskWorkT * 0.9) * 0.004;
      const push = tapPhase ? surfaceOff + 0.025 * (1 - tapU) : surfaceOff;
      this.taskHandR.set(
        dev.pos.x + right.x * dx + n.x * push,
        dev.pos.y + dy,
        dev.pos.z + right.z * dx + n.z * push,
      );
      this.body.handTargets.L = null;
      this.body.handTargetNormals.L = null;
      this.body.handTargetWeights.L = 1;
      this.body.handTargets.R = this.taskHandR;
      this.body.handTargetNormals.R = n;
      this.body.handTargetWeights.R = w;
      return;
    }

    if (t.pose === 'panel_work') {
      // Giles: left hand steadies near the left/lower frame (damped by guardArm when injured); right hand works across points.
      const fadeIn = smooth01(this.taskWorkT / 0.36);
      const fadeOut = 1 - smooth01((t.progress - 0.95) / 0.05);
      const w = fadeIn * fadeOut;
      const hx = Math.min(dev.width * 0.38, 0.13);
      const hy = Math.min(dev.height * 0.34, 0.12);

      // Left hand: steadies on the left edge with gentle small shifts.
      const lx = -hx * 0.85 + Math.sin(this.taskWorkT * 0.8) * 0.014;
      const ly = -hy * 0.35 + Math.cos(this.taskWorkT * 0.65) * 0.016;
      this.taskHandL.set(
        dev.pos.x + right.x * lx + n.x * (surfaceOff + 0.008),
        dev.pos.y + ly,
        dev.pos.z + right.z * lx + n.z * (surfaceOff + 0.008),
      );

      // Right hand: cycles smoothly through 4 wiring/probe targets across the panel with tactile press pulses.
      const pts: readonly [number, number][] = [
        [hx * 0.7, hy * 0.55],
        [hx * 0.15, -hy * 0.15],
        [hx * 0.8, -hy * 0.5],
        [hx * 0.25, hy * 0.4],
      ];
      const seg = this.taskWorkT / 1.15;
      const i0 = Math.floor(seg) % pts.length;
      const i1 = (i0 + 1) % pts.length;
      const u = smooth01(seg - Math.floor(seg));
      const p0 = pts[i0]!;
      const p1 = pts[i1]!;
      const rx = THREE.MathUtils.lerp(p0[0], p1[0], u);
      const ry = THREE.MathUtils.lerp(p0[1], p1[1], u);
      const press = surfaceOff + 0.018 * (0.5 + 0.5 * Math.sin(this.taskWorkT * 5.2));
      this.taskHandR.set(
        dev.pos.x + right.x * rx + n.x * press,
        dev.pos.y + ry,
        dev.pos.z + right.z * rx + n.z * press,
      );

      this.body.handTargets.L = this.taskHandL;
      this.body.handTargets.R = this.taskHandR;
      this.body.handTargetNormals.L = n;
      this.body.handTargetNormals.R = n;
      this.body.handTargetWeights.L = w;
      this.body.handTargetWeights.R = w;
    }
  }

  /**
   * Behaviour selector (every think, ADR-0011): revive > task > combat > follow, with the
   * current behaviour kept unless something higher wins. Sets the movement target for the
   * non-follow behaviours (after `think` has picked the follow target).
   */
  decide(squad: Squad, player: SquadPlayer): void {
    const me = this.position;
    const enemies = squad.enemyList();
    // Revive: the medic's top priority when Jay is down; Giles when it is safe.
    if (this.id === 'medic') {
      const eng = squad.mate('engineer');
      if (player.downed) {
        if (this.revive?.target !== 'player') this.revive = new ReviveJob('player');
      } else if (this.revive?.target === 'player') {
        this.revive = null;
      }
      if (!this.revive && eng.downed && !enemies.some((e) => e.alive && e.position && Math.hypot(e.position.x - me.x, e.position.z - me.z) < REVIVE.safeRadius)) {
        this.revive = new ReviveJob('engineer');
      }
      if (this.revive?.target === 'engineer' && !eng.downed) this.revive = null;
      if (this.revive) {
        const at = this.revive.target === 'player' ? squad.playerFeet : eng.position;
        this.behaviour = 'revive';
        this.target.copy(at);
        this.mode = 'revive';
        return;
      }
    }
    if (this.task && !this.task.done) {
      this.behaviour = 'task';
      if (this.task.at && this.task.state === 'walking') {
        this.target.set(this.task.at.x, this.task.at.y, this.task.at.z);
        this.mode = 'task';
      } else {
        this.target.copy(me);
        this.mode = 'task';
      }
      return;
    }
    const target = squad.combatTarget(this);
    this.targetId = target?.id ?? null;
    this.behaviour = target ? 'combat' : 'follow';
    if (!target) {
      const rest = squad.restPose();
      if (this.body.idlePose === 'aim_pistol' && rest !== 'aim_pistol') this.body.setPose(rest, 0.5);
      else if (rest === 'idle_pistol' && this.body.idlePose === 'idle' && this.gestureLeft <= 0) this.body.setPose(rest, 0.5);
      return;
    }
    // Back off from anything too close (the medic keeps more room).
    let near: SquadEnemy | null = null;
    let nearD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - me.x, e.position.z - me.z);
      if (d < nearD) {
        nearD = d;
        near = e;
      }
    }
    if (near && nearD < COMBAT.backoff[this.id]) {
      const ax = (me.x - near.position.x) / Math.max(nearD, 0.1);
      const az = (me.z - near.position.z) / Math.max(nearD, 0.1);
      for (const k of [2.5, 1.6, 1]) {
        const t = tmpC.set(me.x + ax * k, me.y, me.z + az * k);
        if (squad.standable(t) && squad.nav.direct(me, t, 0.25)) {
          this.target.copy(t);
          this.mode = 'backoff';
          return;
        }
      }
    }
  }

  /** The revive job last published as a squad task (null: none). */
  private publishedRevive: ReviveJob | null = null;

  /**
   * Publish a revive as a squad task named `revive` for as long as the job lasts, however it ends (finished, given up, or the
   * medic knocked down), so scene variants keyed on `{ task: 'revive' }` (character-motion) apply while Okafor revives.
   * Runs at the start of each update, before anything can return early.
   */
  private publishRevive(squad: Squad): void {
    if (this.revive === this.publishedRevive) return;
    const ended = this.publishedRevive;
    if (ended) squad.emit('squad:taskDone', { id: this.id, task: REVIVE_TASK, panel: null, progress: ended.progress });
    this.publishedRevive = this.revive;
    if (this.revive) squad.emit('squad:taskStarted', { id: this.id, task: REVIVE_TASK, panel: null, progress: this.revive.progress });
  }

  /** Combat, task, revive and downed upkeep each step (after movement). */
  act(dt: number, squad: Squad, player: SquadPlayer): void {
    const me = this.position;
    this.hitT = Math.max(0, this.hitT - dt);
    const enemies = squad.enemyList();
    // Grabbed: shove it off after a moment (no struggle for NPCs).
    const grabber = enemies.find((e) => e.alive && e.grabbing === this.id);
    if (grabber) {
      this.grabbedT += dt;
      if (this.grabbedT > 0.6) {
        this.grabbedT = 0;
        squad.enemies?.shove?.(grabber.id, me);
        squad.emit('squad:shoved', { id: this.id, enemy: grabber.id });
      }
    } else this.grabbedT = 0;

    // Task progress: pauses while an enemy on his level is within 3 m of the worker; never resets. Enemies above
    // a ceiling or below a floor are no threat to the work (and could otherwise hold it paused for good).
    const t = this.task;
    if (t && !t.done) {
      if (t.state === 'walking') {
        // Walk all the way up to the panel when clear; fall back when Jay occupies the spot or after TASK_GIVE_UP s stalled.
        const ap = this.approach;
        if (ap.task !== t) {
          ap.task = t;
          ap.best = Infinity;
          ap.stall = 0;
        }
        const d = t.at ? Math.hypot(t.at.x - me.x, t.at.z - me.z) : 0;
        if (d < ap.best - 0.1) {
          ap.best = d;
          ap.stall = 0;
        } else ap.stall += dt;
        const jayOnSpot = t.at !== null && Math.hypot(squad.playerFeet.x - t.at.x, squad.playerFeet.z - t.at.z) <= TASK_JAY_BLOCK;
        const blockedByJay = jayOnSpot && d <= TASK_ARRIVE && ap.stall >= TASK_JAY_STALL;
        const gaveUp = ap.stall >= TASK_GIVE_UP;
        if (d <= TASK_ARRIVE_CLOSE || blockedByJay || gaveUp) {
          t.arrive();
          this.target.copy(me);
          this.path = null;
          const wantYaw = this.taskFacingYaw(t, me, blockedByJay || gaveUp);
          this.taskTurn = { yaw: wantYaw, t: 0 };
          this.taskWorkT = 0;
        }
      }
      const threat = enemies.some((e) => e.alive && Math.hypot(e.position.x - me.x, e.position.z - me.z) < TASK_THREAT && Math.abs(e.position.y - me.y) <= REACH_DY);
      const before = t.state;
      t.update(dt, threat, true);
      if (before === 'working' && t.state === 'paused') {
        this.clearTaskRig();
        this.body.lookTarget = null;
        this.body.setPose('aim_pistol', 0.3);
      }
      if (before === 'paused' && t.state === 'working') {
        const wantYaw = this.taskFacingYaw(t, me, false);
        this.taskTurn = { yaw: wantYaw, t: 0 };
        this.taskWorkT = 0;
      }
      if (t.state === 'working') {
        this.body.plantFeet = true;
        let aligned = true;
        if (this.taskTurn) {
          this.taskTurn.t += dt;
          const diff = Math.atan2(Math.sin(this.taskTurn.yaw - this.body.heading), Math.cos(this.taskTurn.yaw - this.body.heading));
          if (Math.abs(diff) > 0.04 && this.taskTurn.t < 0.7) {
            tmpE.set(-Math.sin(this.taskTurn.yaw), 0, -Math.cos(this.taskTurn.yaw));
            this.body.steer(tmpE, dt, { maxSpeed: 0, turnRate: 5.2 });
          } else {
            this.taskTurn = null;
          }
          aligned = Math.abs(diff) <= 0.3 || this.taskTurn === null;
        }
        if (aligned && this.body.idlePose !== t.pose) this.body.setPose(t.pose, 0.45);
        this.updateTaskHands(dt, t, me, aligned);
      }
      if (t.done) {
        this.clearTaskRig();
        this.body.lookTarget = null;
        this.body.setPose(squad.restPose(), 0.5);
        this.task = null;
      }
    }

    // Revive: kneel beside the target, 3 s, paused by hits.
    const r = this.revive;
    if (r) {
      const at = r.target === 'player' ? squad.playerFeet : squad.mate('engineer').position;
      const kneeling = Math.hypot(at.x - me.x, at.z - me.z) <= REVIVE.reach;
      if (kneeling && this.body.idlePose !== 'kneel_revive') this.body.setPose('kneel_revive', 0.4);
      const done = r.update(dt, kneeling);
      if (kneeling) squad.emit('squad:reviveProgress', { target: r.target, progress: r.progress, paused: r.paused });
      if (done) {
        this.revive = null;
        this.body.setPose(squad.restPose(), 0.5);
        if (r.target === 'player') player.revive?.();
        else squad.mate('engineer').getUp(squad, true);
        squad.emit('squad:revived', { id: this.id, target: r.target });
      }
      return; // no shooting while reviving
    }

    // Shooting (combat, or defending a paused task).
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo = COMBAT.magazine;
      return;
    }
    const canShoot = this.behaviour === 'combat' || (this.behaviour === 'task' && this.task?.state === 'paused');
    const target = canShoot ? (this.behaviour === 'combat' && this.targetId ? enemies.find((e) => e.id === this.targetId && e.alive) ?? null : squad.combatTarget(this)) : null;
    this.fireT = Math.max(0, this.fireT - dt);
    if (!target) return;
    // Face the target, then shoot.
    const face = tmpE.set(target.position.x - me.x, 0, target.position.z - me.z);
    if (face.lengthSq() > 1e-4 && this.body.speed < 0.3) this.body.steer(face.normalize(), dt, { maxSpeed: 0, turnRate: 4 });
    // Its own point (not a shared temporary): the body aims the pistol at it after the squad has updated every mate.
    this.body.lookTarget = this.aimPoint.set(target.position.x, target.position.y + 1.4, target.position.z);
    this.body.aimTarget = this.aimPoint;
    if (this.behaviour === 'combat' && this.body.speed < 0.2 && this.body.idlePose !== 'aim_pistol') this.body.setPose('aim_pistol', 0.3);
    const want = Math.atan2(-face.x, -face.z);
    const off = Math.abs(Math.atan2(Math.sin(want - this.body.heading), Math.cos(want - this.body.heading)));
    if (this.fireT > 0 || off > 0.35) return;
    this.fireT = COMBAT.fireInterval * (0.85 + this.rng.next() * 0.3);
    squad.fire(this, target);
    this.ammo--;
    if (this.ammo <= 0) {
      this.reloadT = COMBAT.reload;
      squad.emit('squad:reloading', { id: this.id });
    }
  }

  /** Take damage from an enemy. At 0 HP they go down (nobody dies in the slice). */
  hurt(amount: number, squad: Squad): void {
    if (this.downed || this.scripted) return;
    this.hitT = 0.5;
    this.revive?.hit();
    this.hp -= amount;
    if (this.hp > 0) return;
    this.hp = 0;
    this.behaviour = 'downed';
    this.revive = null;
    this.clearTaskRig();
    this.downedT = this.id === 'medic' ? squad.difficulty().medicDownedTime : REVIVE.engineerDowned;
    this.body.setPose('squad_downed', 0.25);
    this.path = null;
    squad.emit('squad:downed', { id: this.id });
    if (this.id === 'medic') squad.emit('squad:noSafetyNet', { downed: true });
  }

  /** Up again: on his own at half health, or revived. */
  getUp(squad: Squad, revived: boolean): void {
    if (!this.downed) return;
    this.behaviour = 'follow';
    this.downedT = 0;
    this.hp = REVIVE.maxHp * 0.5;
    this.body.setPose('squad_getUp_0', 0.5);
    this.gestureLeft = 0.9; // hold the half-up pose briefly, then stand
    this.gestureT = 30;
    squad.emit('squad:up', { id: this.id, revived });
    if (this.id === 'medic') squad.emit('squad:noSafetyNet', { downed: false });
  }

  private readonly injury = new InjuryExposure();
  private readonly injuryEye = new THREE.Vector3();
  private readonly injuryDir = new THREE.Vector3();
  private readonly injuryAt = new THREE.Vector3();

  /**
   * Giles's concealed injury (design D12): hidden while Jay or Okafor is watching him or he is talking, showing once he has gone
   * unwatched for a few seconds, during a ladder tell, and on arm-loading panel work from stage 2. Full at the reveal (stage 4).
   */
  private updateInjury(dt: number, squad: Squad, player: SquadPlayer): void {
    const stage = squad.infectionStage;
    this.injuryAt.copy(this.position).setY(this.position.y + 1.5);
    player.eyePosition(this.injuryEye);
    const jaySees = inView(this.injuryEye, player.viewDirection(this.injuryDir), this.injuryAt, 10, (35 * Math.PI) / 180);
    const medic = squad.mate('medic');
    const my = medic.body.group.rotation.y;
    this.injuryDir.set(-Math.sin(my), 0, -Math.cos(my));
    this.injuryEye.copy(medic.position).setY(medic.position.y + 1.6);
    const okaforSees = !medic.downed && inView(this.injuryEye, this.injuryDir, this.injuryAt, 10, (60 * Math.PI) / 180);
    const tell = this.gestureLeft > 0;
    const loaded = stage >= 2 && this.task !== null && /bypass|unlock/.test(this.task.kind);
    const exposure = this.injury.update(dt, { watched: jaySees || okaforSees, talking: this.body.speaking, spike: tell || loaded });
    this.body.setInjury(stage >= 4 ? 1 : injuryWeight(stage, exposure), 'L');
    this.body.setHandTwitchStage(stage);
  }

  /** Idle tells per the infection ladder (Giles only), and the get-up settle. */
  private idleGestures(dt: number, squad: Squad): void {
    if (this.gestureLeft > 0) {
      this.gestureLeft -= dt;
      if (this.gestureLeft <= 0) this.body.setPose(squad.restPose(), 0.6);
      return;
    }
    if (this.behaviour !== 'follow' || this.mode !== 'idle') return;
    const rung = ladderStage(squad.infectionStage);
    if (this.id === 'engineer' && rung.gestures.length) {
      this.gestureT -= dt;
      if (this.gestureT <= 0) {
        this.gestureT = rung.gestureEvery * (0.7 + this.rng.next() * 0.6);
        const tell = this.rng.pick(rung.gestures);
        const pose = tell === 'cough' ? 'cough' : tell;
        this.body.setPose(pose, 0.35);
        this.gestureLeft = tell === 'cough' ? 0.9 : 2.2;
        squad.emit('squad:tell', { id: this.id, tell });
        return;
      }
    }
    // Ambient fidgets while standing about: shift weight, look down, tilt the head. No head turns: they already watch Jay.
    this.ambientT -= dt;
    if (this.ambientT > 0 || this.body.idlePose !== 'idle' || squad.restPose() !== 'idle') return;
    this.ambientT = this.idleRng.range(5, 12);
    this.body.setPose(this.idleRng.pick(SQUAD_FIDGETS), 0.8);
    this.gestureLeft = this.idleRng.range(2, 4);
  }

  get position(): THREE.Vector3 {
    return this.body.group.position;
  }

  place(p: P3, heading: number): void {
    this.motor.x = p.x;
    this.motor.y = p.y;
    this.motor.z = p.z;
    this.motor.vy = 0;
    this.motor.grounded = true;
    this.body.group.position.set(p.x, p.y, p.z);
    this.body.setHeading(heading);
    this.path = null;
    this.pathTarget.set(Infinity, 0, 0);
    this.stuckT = 0;
    this.lastPos.copy(this.body.group.position);
  }

  /** Choose a target (formation slot, trail point or aim-cone sidestep). */
  think(squad: Squad, player: SquadPlayer): void {
    const nav = squad.nav;
    const p = squad.playerFeet;
    const fwd = squad.forward;
    const right = squad.right;
    const me = this.position;
    const view = player.viewDirection(tmpA).setY(0);
    if (view.lengthSq() > 1e-6) view.normalize();
    const side = tmpB.set(-view.z, 0, view.x);
    // A good spot: somewhere to stand, reachable, and never in Jay's line of fire.
    const ok = (t: P3, from: P3): boolean => !squad.inAimCone(t, view) && !squad.crossesAimCone(me, t, view) && squad.standable(t) && nav.direct(from, t, 0.25);

    // Out of the aim cone first: Jay must always have a clear shot.
    if (squad.aimHeld >= SQUAD_TUNING.aimHold && squad.inAimCone(me, view)) {
      // Commit to a side for the whole dodge, so a sweeping view doesn't flip it back and forth.
      const aview = view;
      if (this.dodgeSide === 0) this.dodgeSide = (me.x - p.x) * side.x + (me.z - p.z) * side.z >= 0 ? 1 : -1;
      const away = this.dodgeSide;
      const okDodge = (t: P3): boolean => !squad.inAimCone(t, aview) && squad.standable(t) && nav.direct(me, t, 0.25);
      // The smallest sidestep that clears the cone: out to its edge plus a margin, measured
      // from the line of fire at this distance; wider steps if that spot is blocked.
      const along = (me.x - p.x) * aview.x + (me.z - p.z) * aview.z;
      const footX = p.x + aview.x * along;
      const footZ = p.z + aview.z * along;
      const edge = Math.max(0.5, along) * Math.tan(SQUAD_TUNING.aimCone) + 0.6;
      for (const k of [away, -away]) {
        for (const m of [1, 1.35, 1.8, 2.4]) {
          const t = tmpC.set(footX + side.x * k * edge * m, me.y, footZ + side.z * k * edge * m);
          if (okDodge(t)) {
            this.dodgeSide = k;
            this.target.copy(t);
            this.mode = 'aimDodge';
            return;
          }
        }
      }
    }
    this.dodgeSide = 0;

    // Close enough: stop and stay put. Only start again once Jay has moved off.
    const toJay = Math.hypot(me.x - p.x, me.z - p.z);
    if (this.following && toJay <= SQUAD_TUNING.stopDistance) this.following = false;
    else if (!this.following && toJay > SQUAD_TUNING.resumeDistance) this.following = true;
    if (!this.following) {
      this.target.copy(me);
      this.mode = 'idle';
      return;
    }

    // Formation slot (or its mirror on this mate's side), if Jay can see it and it is somewhere to stand.
    const [r, b] = this.role.slot;
    for (const rr of [r, -r]) {
      const slot = tmpC.set(p.x + right.x * rr - fwd.x * b, p.y, p.z + right.z * rr - fwd.z * b);
      if (ok(slot, p)) {
        this.target.copy(slot);
        this.mode = 'slot';
        return;
      }
    }
    // Otherwise follow Jay's footsteps, unless they lead in front of him (he turned round).
    const trail = squad.trailPoint(this.role.trail);
    if (ok(trail, p) || (!squad.inAimCone(trail, view) && !squad.crossesAimCone(me, trail, view) && squad.standable(trail))) {
      this.target.copy(trail);
      this.mode = 'trail';
      return;
    }
    // Last resort: beside Jay, on this mate's side.
    const mySide = r >= 0 ? 1 : -1;
    for (const [sr, sb] of [[2, 0.5], [2, -0.5], [-2, 0.5], [3, 1.5], [-3, 1.5]] as const) {
      const t = tmpC.set(p.x + right.x * sr * mySide - fwd.x * sb, p.y, p.z + right.z * sr * mySide - fwd.z * sb);
      if (ok(t, p)) {
        this.target.copy(t);
        this.mode = 'slot';
        return;
      }
    }
    // Nowhere better: stay put (and out of the way, since nothing above put us in the cone).
    this.target.copy(me);
    this.mode = 'idle';
  }

  update(dt: number, squad: Squad, player: SquadPlayer, cameraPos: THREE.Vector3 | null): void {
    this.publishRevive(squad);
    // Riding the train: stand where placed, face Jay, move only when his body pushes them (the director's player pass).
    if (this.rideLocked) {
      this.path = null;
      this.target.copy(this.position);
      this.mode = 'idle';
      this.wayPhase = null;
      this.body.lookTarget = squad.playerHead;
      this.body.aimTarget = null;
      this.body.steer(null, dt, { maxSpeed: 0 });
      this.body.update(dt, cameraPos);
      return;
    }
    // A sequence is driving this body (npc actions): the NPC director moves and animates it.
    if (this.scripted) {
      if (this.body.handTargets.L || this.body.handTargets.R || this.body.plantFeet) this.clearTaskRig();
      return;
    }
    if (this.downed) {
      this.downedT -= dt;
      if (this.downedT <= 0) this.getUp(squad, false);
      this.body.lookTarget = null;
      this.body.aimTarget = null;
      this.body.steer(null, dt, { maxSpeed: 0 });
      this.body.update(dt, cameraPos);
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = SQUAD_TUNING.think;
      this.think(squad, player);
      this.decide(squad, player);
    }
    const me = this.position;
    const toTarget = Math.hypot(this.target.x - me.x, this.target.z - me.z);
    const desired = tmpD.set(0, 0, 0);
    let speed = 0;

    // Dodges are short hops, so they need to land precisely.
    const errand = this.mode === 'task' || this.mode === 'revive' || this.mode === 'backoff';
    const arrive = this.mode === 'aimDodge' ? 0.15 : this.mode === 'revive' ? REVIVE.reach * 0.8 : this.mode === 'task' ? 0.12 : SQUAD_TUNING.arrive;
    // Reaching the spot near Jay counts as stopping, even if it is just beyond 10 ft.
    if (!errand && this.following && toTarget <= arrive && Math.hypot(me.x - squad.playerFeet.x, me.z - squad.playerFeet.z) <= SQUAD_TUNING.resumeDistance) {
      this.following = false;
      this.target.copy(me);
      this.mode = 'idle';
    }
    if (toTarget > arrive) {
      this.repathT -= dt;
      if (!this.path || this.repathT <= 0 || this.pathTarget.distanceTo(this.target) > 0.4) {
        this.repathT = SQUAD_TUNING.repath;
        this.path = squad.nav.findPath(me, this.target, { radius: 0.25 });
        this.pathIndex = 0;
        this.pathTarget.copy(this.target);
      }
      if (this.path) {
        let wp = this.path[this.pathIndex];
        while (wp && this.pathIndex < this.path.length - 1 && Math.hypot(wp.x - me.x, wp.z - me.z) < 0.5) wp = this.path[++this.pathIndex];
        if (wp) desired.set(wp.x - me.x, 0, wp.z - me.z).normalize();
      }
      // Further behind = faster; from a walk up to just over Jay's sprint.
      // A normal walk; brisker the further behind, a jog only when well behind.
      const behind = Math.hypot(me.x - squad.playerFeet.x, me.z - squad.playerFeet.z);
      speed = behind < 6 ? SQUAD_TUNING.walk : behind < 12 ? THREE.MathUtils.lerp(SQUAD_TUNING.walk, SQUAD_TUNING.brisk, (behind - 6) / 6) : SQUAD_TUNING.jog;
      // Stepping out of the line of fire: a purposeful step, not a scramble.
      if (this.mode === 'aimDodge') speed = Math.max(speed, 1.8);
      // Errands: a jog to a downed teammate, a brisk walk to a panel (easing into the wall) or out of reach.
      if (this.mode === 'revive') speed = SQUAD_TUNING.jog;
      else if (this.mode === 'task') speed = toTarget < 1.2 ? Math.max(0.65, Math.min(SQUAD_TUNING.brisk, toTarget * 1.9)) : Math.max(speed, SQUAD_TUNING.brisk);
      else if (this.mode === 'backoff') speed = Math.max(speed, SQUAD_TUNING.brisk);
      // Moving again: drop a work or aim pose so the walk cycle shows.
      const rest = squad.restPose();
      if (this.body.idlePose !== rest && this.gestureLeft <= 0) this.body.setPose(rest, 0.3);
    }

    // Give way: Jay is solid to them, so a mate standing in his way steps out of his line (out of a
    // doorway along its normal, away from him) within ~0.5 s and comes back to the follow AI once he
    // has moved on. Combat and follow give way anywhere; panel work and revives only in a doorway.
    let yielding = false;
    let turnRate = 3.2;
    let accel = 2.2;
    const wish = player.wish;
    if (wish && (this.wayPhase || (desired.lengthSq() < 1e-6 && this.body.speed < 0.3))) {
      const env: WayEnv = {
        nav: squad.nav,
        colliders: squad.colliders,
        occupied: (x, z, r) => squad.mates.some((o) => o !== this && Math.hypot(o.motor.x - x, o.motor.z - z) < r + o.body.footprint.r),
      };
      const free = this.behaviour === 'follow' || this.behaviour === 'combat';
      if (this.way.press(dt, me, this.body.footprint.r, squad.playerFeet, wish, env, free ? 'any' : 'door')) {
        this.wayPhase = 'out';
        this.wayT = 0;
      }
      if (this.wayPhase) {
        this.wayT += dt;
        yielding = true;
        const s = this.way.spot!;
        const d = Math.hypot(s.x - me.x, s.z - me.z);
        if (this.wayPhase === 'out' && d > 0.12 && this.wayT < 2.5) {
          desired.set(s.x - me.x, 0, s.z - me.z).normalize();
          speed = GIVE_WAY.speed * Math.min(1, 0.4 + d * 2);
          turnRate = GIVE_WAY.turnRate;
          accel = GIVE_WAY.accel;
        } else {
          this.wayPhase = 'hold';
          desired.set(0, 0, 0);
          speed = 0;
          if (this.way.movedOn(dt, squad.playerFeet, wish) || this.wayT > 6) {
            this.wayPhase = null;
            this.way.reset();
            yielding = false;
          }
        }
      }
    }

    // Keep apart from Jay and each other (a softer shove than the give-way above).
    // Skip during panel tasks so Jay watching nearby never blocks the approach or slides a worker off the device.
    if (this.behaviour !== 'task') {
      const sep = tmpE.set(0, 0, 0);
      const push = (o: P3, radius: number): void => {
        const dx = me.x - o.x;
        const dz = me.z - o.z;
        const d = Math.hypot(dx, dz);
        if (d >= radius || d < 1e-4) return;
        const k = (radius - d) / radius / d;
        sep.x += dx * k;
        sep.z += dz * k;
      };
      if (!yielding) push(squad.playerFeet, SQUAD_TUNING.personalPlayer);
      for (const m of squad.mates) if (m !== this) push(m.position, SQUAD_TUNING.personalMate);
      if (sep.lengthSq() > 1e-6) {
        desired.addScaledVector(sep, 2.2);
        speed = Math.max(speed, 1.0);
      }
    }

    if (this.working && desired.lengthSq() < 1e-6) accel = 7;
    const vel = this.body.steer(desired.lengthSq() > 1e-6 ? desired : null, dt, { maxSpeed: speed, turnRate, accel });
    moveBody(this.motor, vel.x * dt, vel.z * dt, dt, MOTOR, squad.colliders);
    this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);

    // Idle: look at Jay now and then; while moving, look where they walk.
    if (this.behaviour !== 'follow') {
      this.body.lookTarget = null;
      this.body.aimTarget = null;
    } else if (speed === 0 && this.body.speed < 0.2) {
      this.mode = this.mode === 'aimDodge' ? 'aimDodge' : 'idle';
      this.body.lookTarget = squad.playerHead;
      // Turn the body toward Jay slowly when he is off to the side.
      // Turn toward Jay, slowly, only when he is well off to the side.
      const face = tmpE.set(squad.playerFeet.x - me.x, 0, squad.playerFeet.z - me.z);
      if (face.lengthSq() > 0.25) {
        const want = Math.atan2(-face.x, -face.z);
        const off = Math.abs(Math.atan2(Math.sin(want - this.body.heading), Math.cos(want - this.body.heading)));
        if (off > 0.8) this.body.steer(face.normalize(), dt, { maxSpeed: 0, turnRate: 1.0 });
      }
    } else {
      this.body.lookTarget = null;
      this.body.aimTarget = null;
    }

    // Stuck: wanted to move but barely did.
    if (speed > 0) {
      const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z);
      this.stuckT = moved < speed * dt * 0.1 ? this.stuckT + dt : Math.max(0, this.stuckT - dt);
      if (this.stuckT > 1.5) {
        this.path = null;
        this.stuckT = 0;
      }
    }
    this.lastPos.copy(me);
    this.act(dt, squad, player);
    this.idleGestures(dt, squad);
    if (this.id === 'engineer') this.updateInjury(dt, squad, player);
    this.body.update(dt, cameraPos);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpE = new THREE.Vector3();

export interface SquadDeps {
  ctx: HumanoidContext;
  nav: Navigator;
  player: SquadPlayer;
  /** Live enemies (ADR-0007); can also be set later with `setEnemies`. */
  enemies?: SquadEnemySource | null;
  difficulty?: () => SquadDifficulty;
  /** Where squad events go (barks, HUD). */
  emit?: (name: keyof SquadEvents, payload: SquadEvents[keyof SquadEvents]) => void;
  /** Giles's voice: rasp per infection stage; laugh removed at the reveal. */
  speech?: { setRasp(speaker: string, amount: number | null): void; setLaugh?(speaker: string, on: boolean): void } | null;
  /** The playthrough's flags: `giles.infectionStage` drives the reveal ladder. */
  flags?: () => Record<string, string | number | boolean>;
  /** Jay went down with the medic down: end the run (the player is killed). */
  gameOver?: () => void;
}

const STANDARD: SquadDifficulty = { squadDamage: 0.45, squadAccuracy: 0.45, medicDownedTime: 10 };

export class Squad {
  readonly group = new THREE.Group();
  readonly mates: SquadMate[];
  readonly nav: Navigator;
  readonly playerFeet = new THREE.Vector3();
  readonly playerHead = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Seconds Jay has been aiming down sights. */
  aimHeld = 0;
  /** ADR-0011 kill-share guard. */
  readonly kills = new KillShare();
  enemies: SquadEnemySource | null;
  /** ADR-0022 ladder stage (0..3, 4 = reveal). */
  infectionStage = 0;
  private readonly deps: SquadDeps;
  private readonly rng = new Rng('squad-fire');
  private wasDowned = false;
  private stageT = 0;
  private readonly player: SquadPlayer;
  private readonly trail: THREE.Vector3[] = [];
  private placed = false;

  /** The speech manager arrives after the squad is built (main.ts): Giles's rasp and laugh (ADR-0022). */
  setSpeech(speech: NonNullable<SquadDeps['speech']>): void {
    this.deps.speech = speech;
  }

  constructor(deps: SquadDeps) {
    this.nav = deps.nav;
    this.player = deps.player;
    this.deps = deps;
    this.enemies = deps.enemies ?? null;
    this.group.name = 'squad';
    this.mates = ROLES.map((r) => new SquadMate(r, deps.ctx));
    for (const m of this.mates) this.group.add(m.body.group, m.weaponLight, m.weaponLightTarget);
  }

  /**
   * Put every weapon light back on its mate. Call after anything that moves, hides or shows a mate: `update` does for
   * its own step, and the session does again once the NPC director has run.
   */
  syncWeaponLights(): void {
    for (const m of this.mates) m.updateWeaponFlashlight();
  }

  get colliders(): Navigator['world'] {
    return this.nav.world;
  }

  mate(id: SquadId): SquadMate {
    return this.mates.find((m) => m.id === id)!;
  }

  setEnemies(source: SquadEnemySource | null): void {
    this.enemies = source;
  }

  /**
   * Has the Lab B drop happened (`gunDrawn` or `drop_done`)? From then on August and Tomas keep their pistols in hand
   * and only put them away to work a door (the task pose replaces the aim pose).
   */
  get gunsDrawn(): boolean {
    const f = this.deps.flags?.();
    return !!f && (f['gunDrawn'] === true || f['drop_done'] === true);
  }

  /** The pose a mate returns to when nothing else holds him: low-ready pistol after the drop, otherwise idle. */
  restPose(): string {
    return this.gunsDrawn ? 'idle_pistol' : 'idle';
  }

  enemyList(): readonly SquadEnemy[] {
    return this.enemies?.list() ?? [];
  }

  difficulty(): SquadDifficulty {
    return this.deps.difficulty?.() ?? STANDARD;
  }

  emit<K extends keyof SquadEvents>(name: K, payload: SquadEvents[K]): void {
    this.deps.emit?.(name, payload);
  }

  /** Jay killed something (wire to the enemy death event): feeds the kill-share guard. */
  recordKill(by: 'player' | 'squad'): void {
    this.kills.record(by);
  }

  /** The best target for this mate, or null (role preferences, ADR-0011). */
  combatTarget(m: SquadMate): SquadEnemy | null {
    const list = this.enemyList();
    if (!list.length) return null;
    const eng = this.mate('engineer');
    return pickTarget(list, {
      me: m.position,
      role: m.id,
      player: this.playerFeet,
      medic: this.mate('medic').position,
      engineer: eng.position,
      engineerWorking: eng.working,
      current: m.targetId,
      canSee: (e) => this.nav.direct({ x: m.position.x, y: m.position.y, z: m.position.z }, e.position, 0),
    });
  }

  /** One shot: accuracy and damage from difficulty, halved by the kill-share guard. */
  fire(m: SquadMate, e: SquadEnemy): void {
    const diff = this.difficulty();
    const hit = this.rng.next() < diff.squadAccuracy;
    const gun = shotPoints(m);
    let killed = false;
    if (hit && this.enemies) {
      const damage = COMBAT.playerDamage * diff.squadDamage * this.kills.factor;
      killed = this.enemies.shoot(e.id, aimFor(m.id, e), damage, gun.muzzle);
      if (killed) this.kills.record('squad');
    }
    this.emit('squad:fired', { id: m.id, enemy: e.id, hit, killed, ...gun });
  }

  /** An enemy hit a squadmate (the enemy AI calls this). */
  damageMate(id: SquadId, amount: number): void {
    this.mate(id).hurt(amount, this);
  }

  /**
   * Start a panel job (sequence `npcTask`): Giles's bypass/power, Okafor's biometric lock.
   * Replaces any job the mate had. The returned task resolves `whenDone`.
   */
  startTask(id: SquadId, kind: string, opts: { at?: P3 | null; yaw?: number; panel?: string | null; device?: TaskDevice | null; duration?: number } = {}): SquadTask {
    const m = this.mate(id);
    m.clearTaskRig();
    const payload = (t: SquadTask): SquadEvents['squad:taskProgress'] => ({ id, task: t.kind, panel: t.panel, progress: t.progress });
    const ev: TaskEvents = {
      progress: (t) => this.emit('squad:taskProgress', payload(t)),
      paused: (t) => this.emit('squad:taskPaused', payload(t)),
      resumed: (t) => this.emit('squad:taskResumed', payload(t)),
      done: (t) => this.emit('squad:taskDone', payload(t)),
    };
    const task = new SquadTask(kind, { ...opts, who: id }, ev);
    m.task = task;
    m.thinkNow();
    this.emit('squad:taskStarted', payload(task));
    return task;
  }

  /** Enemy target weights (ADR-0011) for the enemy AI: the player is 1.0 on its side. */
  weights(): Array<{ id: SquadId; position: THREE.Vector3; weight: number }> {
    return this.mates.map((m) => ({
      id: m.id,
      position: m.position,
      weight: enemyWeight(m.id, { reviving: m.revive !== null, working: m.working, downed: m.downed }),
    }));
  }

  /** Giles's visible tells (ADR-0022): bandage once `giles.bandaged`, veins and sweat from stage 3. Restored with the flags. */
  applyTells(bandaged: boolean): void {
    this.mate('engineer').body.setTells(tellsFor(this.infectionStage, bandaged));
  }

  /** ADR-0022 ladder: rasp and laugh follow the stage; idle tells follow it too. */
  setInfectionStage(stage: number): void {
    if (stage === this.infectionStage) return;
    this.infectionStage = stage;
    const rung = ladderStage(stage);
    this.deps.speech?.setRasp('engineer', rung.rasp > 0 ? rung.rasp : null);
    this.deps.speech?.setLaugh?.('engineer', rung.laugh);
    this.emit('squad:infectionStage', { stage });
  }

  /** Somewhere a body can stand: floor under it within a step, nothing at body height. */
  standable(p: P3): boolean {
    const floor = floorHeight(p.x, p.z, p.y + MOTOR.stepHeight, MOTOR, this.nav.world);
    if (!(floor > p.y - 0.4)) return false;
    return this.nav.direct({ x: p.x, y: p.y, z: p.z + 0.001 }, { x: p.x + 0.001, y: p.y, z: p.z }, 0.3);
  }

  /** Is p inside Jay's aim cone (horizontal), within range? `view` is his flat, normalised view. */
  inAimCone(p: P3, view: THREE.Vector3): boolean {
    const dx = p.x - this.playerFeet.x;
    const dz = p.z - this.playerFeet.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3 || d > SQUAD_TUNING.aimConeRange) return false;
    return (dx * view.x + dz * view.z) / d > Math.cos(SQUAD_TUNING.aimCone);
  }

  /** Does walking straight from a to b pass through Jay's aim cone? */
  crossesAimCone(a: P3, b: P3, view: THREE.Vector3): boolean {
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      if (this.inAimCone({ x: a.x + (b.x - a.x) * t, y: a.y, z: a.z + (b.z - a.z) * t }, view)) return true;
    }
    return false;
  }

  /** The point `dist` metres back along Jay's footsteps (or Jay's feet if the trail is short). */
  trailPoint(dist: number): THREE.Vector3 {
    let left = dist;
    let prev = this.playerFeet;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i]!;
      const d = prev.distanceTo(p);
      if (d >= left) return tmpC.copy(prev).lerp(p, left / d);
      left -= d;
      prev = p;
    }
    return tmpC.copy(prev);
  }

  /** Put both squadmates near Jay, behind him and out of view where possible. */
  placeNearPlayer(): void {
    this.readPlayer();
    this.trail.length = 0;
    for (const m of this.mates) {
      if (m.scripted || m.rideLocked) continue; // a sequence (or the train ride) has placed them
      const spot = this.spawnSpot(m);
      m.place(spot, this.player.yaw);
    }
    this.placed = true;
  }

  /**
   * A load or checkpoint restart happened (checkpoint-restore spec): the next update puts every
   * squadmate no restore scene holds next to Jay, instead of relying on the jump check.
   */
  requestPlacement(): void {
    this.placed = false;
  }

  /**
   * Scene step `squadRegroup` (squad-tasks spec): a squadmate more than `distance` from Jay and out
   * of his view moves to a spot near him, behind him where possible. Held squadmates count too: the
   * step runs at the start of a beat, often while the previous scene still holds them. Returns the
   * ids moved.
   */
  regroup(distance = REGROUP_DISTANCE): SquadId[] {
    this.readPlayer();
    const moved: SquadId[] = [];
    for (const m of this.mates) {
      if (m.downed || m.rideLocked) continue;
      if (m.position.distanceTo(this.playerFeet) <= distance || this.canSee(m.position)) continue;
      m.place(this.spawnSpot(m), this.player.yaw);
      moved.push(m.id);
    }
    return moved;
  }

  /**
   * Scene step `gatherIn` timed out (scene-gathering spec): each squadmate `inside` says is outside
   * the room moves to a spot near Jay, who is in it. Held or not, visible or not: the scene waited.
   */
  placeIn(inside: (p: P3) => boolean): SquadId[] {
    this.readPlayer();
    const moved: SquadId[] = [];
    for (const m of this.mates) {
      if (m.rideLocked || inside(m.position)) continue;
      const spot = this.spawnSpot(m);
      m.place(spot, this.player.yaw);
      moved.push(m.id);
    }
    return moved;
  }

  /**
   * Scene step `squadCatchUpIn` (morning-briefing spec): move any squadmate outside `inside` into
   * the room ONLY when they are out of Jay's view, landing at an unseen spot (preferring `entry`
   * just inside the doorway, or a spot behind Jay inside the room). Never pops visibly in view.
   */
  /**
   * Bring squadmates outside the room inside it, unseen. `force` (a scene on rails, the view held elsewhere): every
   * mate goes to the entry spots, wherever he is and whether or not Jay could see him, so none is left in a doorway
   * that is about to seal (overhaul-priya-r08-death D41).
   */
  catchUpIn(inside: (p: P3) => boolean, entry?: P3 | null, force = false): SquadId[] {
    this.readPlayer();
    const moved: SquadId[] = [];
    const unseen = (p: P3): boolean => force || !this.canSee(tmpA.set(p.x, p.y, p.z));
    for (const m of this.mates) {
      if (m.downed || m.rideLocked || (!force && (inside(m.position) || this.canSee(m.position)))) continue;
      let spot: P3 | null = null;
      if (entry && inside(entry) && unseen(entry) && this.standable(entry)) {
        const off = m.id === 'engineer' ? -0.45 : 0.45;
        const alt = { x: entry.x, y: entry.y, z: entry.z + off };
        spot = inside(alt) && this.standable(alt) && unseen(alt) ? alt : entry;
      }
      if (!spot) {
        const behind = this.spawnSpot(m);
        if (inside(behind) && unseen(behind)) spot = behind;
      }
      if (!spot) continue;
      m.place(spot, this.player.yaw);
      moved.push(m.id);
    }
    return moved;
  }

  private spawnSpot(m: SquadMate): P3 {
    const p = this.playerFeet;
    const role = ROLES.find((r) => r.id === m.id)!;
    const [r, b] = role.slot;
    const slot = { x: p.x + this.right.x * r - this.forward.x * b, y: p.y, z: p.z + this.right.z * r - this.forward.z * b };
    if (this.standable(slot) && this.nav.direct(p, slot, 0.3)) return slot;
    // Nearest nav node behind Jay that he can walk to.
    let best: P3 | null = null;
    let bestScore = Infinity;
    for (const n of this.nav.nodes) {
      const dx = n.x - p.x;
      const dz = n.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2 || d > 8 || Math.abs(n.y - p.y) > 0.5) continue;
      const behind = -(dx * this.forward.x + dz * this.forward.z) / d;
      const score = Math.abs(d - b) - behind * 2 + (this.mates.some((o) => o !== m && o.position.distanceTo(tmpA.set(n.x, n.y, n.z)) < 1) ? 5 : 0);
      if (score < bestScore && this.nav.direct(p, n, 0.25)) {
        bestScore = score;
        best = n;
      }
    }
    return best ?? { x: p.x, y: p.y, z: p.z };
  }

  private readPlayer(): void {
    const b = this.player.body;
    this.playerFeet.set(b.x, b.y, b.z);
    this.player.eyePosition(this.playerHead);
    const yaw = this.player.yaw;
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  update(dt: number, cameraPos: THREE.Vector3 | null): void {
    const before = this.playerFeet.clone();
    this.readPlayer();
    // A respawn, load or checkpoint restart moves Jay far in one step: bring the squad along.
    if (!this.placed || before.distanceTo(this.playerFeet) > 4) {
      this.placeNearPlayer();
      this.syncWeaponLights();
      return;
    }
    this.aimHeld = this.player.aimBlend > 0.5 ? this.aimHeld + dt : 0;
    // Reveal ladder from the flags (sequences set `giles.infectionStage`).
    this.stageT -= dt;
    if (this.stageT <= 0 && this.deps.flags) {
      this.stageT = 0.5;
      const flags = this.deps.flags();
      const v = flags['giles.infectionStage'];
      // A missing flag is stage 0 (a restart or load from before the first tell clears the ladder).
      this.setInfectionStage(typeof v === 'number' ? v : 0);
      this.applyTells(flags['giles.bandaged'] === true);
    }
    // Jay goes down: game over if the medic is already down (ADR-0011), else Okafor comes.
    const downed = this.player.downed === true;
    if (downed && !this.wasDowned && playerDownIsGameOver(this.mate('medic').downed)) {
      this.emit('squad:gameOver', { reason: 'medicDown' });
      this.deps.gameOver?.();
    }
    this.wasDowned = downed;
    this.kills.update(dt, this.mates.some((m) => m.behaviour === 'combat'));
    const last = this.trail.at(-1);
    if (!last || last.distanceTo(this.playerFeet) >= SQUAD_TUNING.trailStep) {
      this.trail.push(this.playerFeet.clone());
      if (this.trail.length > SQUAD_TUNING.trailLength) this.trail.shift();
    }
    for (const m of this.mates) {
      m.update(dt, this, this.player, cameraPos);
      m.updateScriptedAim(dt);
      m.updateScriptedFire(dt, this);
      this.catchUp(m);
    }
    this.syncWeaponLights();
  }

  /** Aim named squadmates' pistols and weapon flashlights at a live world target (or null to clear). */
  setAim(ids: readonly string[] | undefined, get: (() => P3 | null) | null): void {
    const targets = ids?.length ? ids : ['engineer', 'medic'];
    for (const raw of targets) {
      const sid: SquadId | null = raw === 'giles' || raw === 'engineer' ? 'engineer' : raw === 'okafor' || raw === 'medic' ? 'medic' : null;
      if (sid) this.mate(sid).setScriptedAim(get);
    }
  }

  /** Toggle weapon-mounted dynamic flashlights for the named squadmates (`giles`/`okafor` or `engineer`/`medic`). */
  setFlashlight(ids: readonly string[] | undefined, on: boolean): void {
    const targets = ids?.length ? ids : ['engineer', 'medic'];
    for (const raw of targets) {
      const sid: SquadId | null = raw === 'giles' || raw === 'engineer' ? 'engineer' : raw === 'okafor' || raw === 'medic' ? 'medic' : null;
      if (sid) this.mate(sid).setFlashlight(on);
    }
  }

  /**
   * Fire timed scripted pistol bursts toward a world point with boosted CCTV-readable muzzle flashes. `bursts: 0` stops any
   * volley in progress and leaves the mates aiming where they are (openspec juggernaut-walk-and-roar D7).
   */
  scriptedFire(opts: { ids?: readonly string[]; target?: P3; bursts?: number; interval?: number; boost?: number; gain?: number }): void {
    const targets = opts.ids?.length ? opts.ids : ['engineer', 'medic'];
    if (opts.bursts === 0 || !opts.target) {
      for (const raw of targets) {
        const sid: SquadId | null = raw === 'giles' || raw === 'engineer' ? 'engineer' : raw === 'okafor' || raw === 'medic' ? 'medic' : null;
        if (sid) this.mate(sid).stopScriptedFire();
      }
      return;
    }
    const target = opts.target;
    const bursts = opts.bursts ?? 6;
    const interval = opts.interval ?? 0.24;
    const boost = opts.boost ?? 3.2;
    let idx = 0;
    for (const raw of targets) {
      const sid: SquadId | null = raw === 'giles' || raw === 'engineer' ? 'engineer' : raw === 'okafor' || raw === 'medic' ? 'medic' : null;
      if (!sid) continue;
      this.mate(sid).startScriptedFire(target, bursts, interval, boost, idx * (interval * 0.45), opts.gain ?? 1);
      idx++;
    }
  }

  /** Far away and out of sight: reappear on Jay's trail behind him (ADR-0011). */
  private catchUp(m: SquadMate): void {
    if (m.scripted || m.rideLocked || m.downed || m.behaviour === 'task' || m.behaviour === 'revive') return;
    const d = m.position.distanceTo(this.playerFeet);
    if (d < SQUAD_TUNING.teleportDistance || this.canSee(m.position)) return;
    for (const back of [5, 7, 9, 4]) {
      const t = this.trailPoint(back);
      const behind = (t.x - this.playerFeet.x) * this.forward.x + (t.z - this.playerFeet.z) * this.forward.z < 0;
      if (behind && !this.canSee(t) && this.standable(t)) {
        m.place(t, this.player.yaw);
        return;
      }
    }
  }

  /** Is a point in front of Jay with a clear line from his eyes? */
  canSee(p: THREE.Vector3): boolean {
    return inPlayerView(this.playerHead, this.forward, p, (a, b) => this.nav.direct(a, b, 0));
  }

  /** Dispose both squadmates' humanoid bodies and clear the group (session teardown). */
  dispose(): void {
    for (const m of this.mates) {
      m.setFlashlight(false);
      m.weaponLight.dispose();
      m.body.dispose();
    }
    this.group.clear();
  }
}

const shotTmp = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const xyz = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

/**
 * Where a mate's shot comes from (squad-sidearms D4): the held pistol's muzzle and ejection port and the gun's right vector, in
 * world space, or, with no pistol showing (the body not loaded, or out of the aim pose), the old point 1.4 m above the mate, with
 * the ejection there too and the body's right.
 */
export function shotPoints(m: { position: THREE.Vector3; body: Humanoid }): { muzzle: Vec3; ejectPort: Vec3; right: Vec3; forward: Vec3; fromPistol: boolean } {
  const gun = m.body.pistol;
  if (gun) {
    m.body.group.updateMatrixWorld(true);
    gun.muzzle.getWorldQuaternion(shotTmp.q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(shotTmp.q);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(shotTmp.q);
    return { muzzle: xyz(gun.muzzle.getWorldPosition(shotTmp.p)), ejectPort: xyz(gun.ejectPort.getWorldPosition(shotTmp.p)), right: xyz(right), forward: xyz(forward), fromPistol: true };
  }
  const at = { x: m.position.x, y: m.position.y + 1.4, z: m.position.z };
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(m.body.group.quaternion);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(m.body.group.quaternion);
  return { muzzle: at, ejectPort: { ...at }, right: xyz(right), forward: xyz(forward), fromPistol: false };
}
