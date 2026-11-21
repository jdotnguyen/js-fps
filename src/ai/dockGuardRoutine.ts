import * as THREE from 'three';
import type { TargetRef, Vec3Like } from '../script/types.ts';
import type { P3 } from './nav.ts';
import type { NpcActor } from './npcActor.ts';

/**
 * Scripted return of the dock guard to his security booth desk (dock-guard-routine change,
 * dock-checkpoint spec): wait for Jay to clear the booth opening, walk to the desk carrying
 * the wand, transfer the wand atomically to the desktop at contact, step to the loose chair,
 * grip its backrest before it moves, pull chair + collider smoothly into working position
 * with continuous hand contact and a planted foot, step around and settle onto the seat
 * facing the keyboard and CCTV wall.
 *
 * One `applySeatedEndpoint()` function resolves normal completion, skip at any phase, and
 * post-intro checkpoint restore so the guard, wand and chair always land identically.
 */

export type GuardRoutinePhase =
  | 'idle'
  | 'wait_clear'
  | 'walk_desk'
  | 'place_wand'
  | 'step_to_chair'
  | 'reach_chair'
  | 'pull_chair'
  | 'release_turn'
  | 'sit_down'
  | 'seated';

export interface DockGuardWorld {
  resolve: (ref: TargetRef) => { pos: Vec3Like; yaw?: number | undefined } | null;
  walk: (id: string) => { points: P3[]; speed?: number } | null;
  playerFeet: () => Vec3Like;
  setPropTransform?: (id: string, pos: { x: number; y: number; z: number }, yaw: number) => boolean;
  setPropVisible?: (id: string, visible: boolean) => boolean;
  propState?: (id: string) => { pos: THREE.Vector3; yaw: number; visible: boolean } | null;
}

const DEG = Math.PI / 180;
const DEFAULT_CHAIR_START = { pos: new THREE.Vector3(5.45, 0, 4.55), yaw: 150 * DEG };
const DEFAULT_SEAT = { pos: new THREE.Vector3(6.45, 0, 4.38), yaw: Math.PI };
const DEFAULT_WAND_SPOT = new THREE.Vector3(7.02, 0.775, 5.14);
const DEFAULT_DESK_APPROACH = { pos: new THREE.Vector3(7.02, 0, 4.32), yaw: Math.PI };
const DEFAULT_CHAIR_GRIP = { pos: new THREE.Vector3(5.8, 0, 3.88), yaw: 152 * DEG };

/** Chair-local backrest top rim grip point (matches `chair` backrest top in `src/world/kit/props.ts`). */
export const CHAIR_BACK_LOCAL = { y: 1.07, z: 0.25 } as const;

/** World position of the chair's backrest top grip point for a given chair floor position and yaw. */
export function chairBackGrip(pos: Vec3Like, yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(pos.x + CHAIR_BACK_LOCAL.z * Math.sin(yaw), pos.y + CHAIR_BACK_LOCAL.y, pos.z + CHAIR_BACK_LOCAL.z * Math.cos(yaw));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

/** Smoothly sample a polyline by normalized progress `u` in [0, 1]. */
function samplePolyline(pts: readonly { x: number; z: number }[], u: number, out: THREE.Vector3, dirOut: THREE.Vector3): void {
  const lens: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
    lens.push(total);
  }
  const dist = THREE.MathUtils.clamp(u, 0, 1) * total;
  let seg = 1;
  while (seg < pts.length - 1 && lens[seg]! < dist) seg++;
  const a = pts[seg - 1]!;
  const b = pts[seg]!;
  const segLen = Math.max(1e-6, lens[seg]! - lens[seg - 1]!);
  const f = THREE.MathUtils.clamp((dist - lens[seg - 1]!) / segLen, 0, 1);
  out.set(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f);
  dirOut.set(b.x - a.x, 0, b.z - a.z);
  if (dirOut.lengthSq() > 1e-8) dirOut.normalize();
}

const PHASE_DUR = {
  waitMin: 1.2,
  waitMax: 4.0,
  placeContact: 0.45,
  placeTotal: 0.85,
  reachChair: 0.45,
  pullChair: 1.0,
  release: 0.3,
  stepAround: 0.95,
  sitDown: 0.9,
} as const;

interface ActiveRun {
  actor: NpcActor;
  phase: GuardRoutinePhase;
  t: number;
  wandPlaced: boolean;
  chairStartPos: THREE.Vector3;
  chairStartYaw: number;
  seatPos: THREE.Vector3;
  seatYaw: number;
  wandSpot: THREE.Vector3;
  deskApproachPos: THREE.Vector3;
  deskApproachYaw: number;
  chairGripPos: THREE.Vector3;
  chairGripYaw: number;
  pullGuardEndPos: THREE.Vector3;
  pullGuardEndYaw: number;
  walkDone: boolean;
  generation: number;
  resolve: () => void;
}

export class DockGuardRoutine {
  private readonly world: DockGuardWorld;
  private active: ActiveRun | null = null;
  private generation = 0;
  private readonly handTarget = new THREE.Vector3();
  private readonly lookPoint = new THREE.Vector3();
  private readonly chairPos = new THREE.Vector3();
  private readonly stepPos = new THREE.Vector3();
  private readonly stepDir = new THREE.Vector3();
  private _phase: GuardRoutinePhase = 'idle';

  constructor(world: DockGuardWorld) {
    this.world = world;
  }

  /** Current phase of the guard's desk routine (for tests and diagnostics). */
  get phase(): GuardRoutinePhase {
    return this.active?.phase ?? this._phase;
  }

  /** Is the return routine currently animating? */
  get running(): boolean {
    return this.active !== null;
  }

  /** Start the guard's return to the security desk, or apply the seated endpoint immediately when `instant` is true. */
  start(actor: NpcActor, instant = false): Promise<void> {
    if (instant) {
      this.applySeatedEndpoint(actor, true);
      return Promise.resolve();
    }
    this.cancelActive();
    const gen = ++this.generation;
    const chair0 = this.world.propState?.('dock_chair');
    const chairStartPos = chair0 ? chair0.pos.clone() : DEFAULT_CHAIR_START.pos.clone();
    const chairStartYaw = chair0 ? chair0.yaw : DEFAULT_CHAIR_START.yaw;
    const seatR = this.world.resolve('anchor:guard_seat');
    const seatPos = seatR ? new THREE.Vector3(seatR.pos.x, seatR.pos.y, seatR.pos.z) : DEFAULT_SEAT.pos.clone();
    const seatYaw = seatR?.yaw ?? DEFAULT_SEAT.yaw;
    const wandR = this.world.resolve('anchor:guard_wand_spot');
    const wandSpot = wandR ? new THREE.Vector3(wandR.pos.x, wandR.pos.y, wandR.pos.z) : DEFAULT_WAND_SPOT.clone();
    const deskR = this.world.resolve('anchor:guard_desk_approach');
    const deskApproachPos = deskR ? new THREE.Vector3(deskR.pos.x, deskR.pos.y, deskR.pos.z) : DEFAULT_DESK_APPROACH.pos.clone();
    const deskApproachYaw = deskR?.yaw ?? DEFAULT_DESK_APPROACH.yaw;
    const gripR = this.world.resolve('anchor:guard_chair_grip');
    const chairGripPos = gripR ? new THREE.Vector3(gripR.pos.x, gripR.pos.y, gripR.pos.z) : DEFAULT_CHAIR_GRIP.pos.clone();
    const chairGripYaw = gripR?.yaw ?? DEFAULT_CHAIR_GRIP.yaw;

    // Keep wand explicitly held in hand through approach and walk, desk wand hidden until contact.
    actor.body.setHeldItem('wand');
    this.world.setPropVisible?.('dock_wand', false);
    this.world.setPropTransform?.('dock_chair', chairStartPos, chairStartYaw);

    return new Promise<void>((resolve) => {
      this.active = {
        actor,
        phase: 'wait_clear',
        t: 0,
        wandPlaced: false,
        chairStartPos,
        chairStartYaw,
        seatPos,
        seatYaw,
        wandSpot,
        deskApproachPos,
        deskApproachYaw,
        chairGripPos,
        chairGripYaw,
        // Small ~0.41 m weight-transfer shift behind the backrest (inside FootIkSolver's world-space pin radius so the planted foot holds).
        pullGuardEndPos: new THREE.Vector3(seatPos.x - 0.23, seatPos.y, seatPos.z - 0.56),
        pullGuardEndYaw: 175 * DEG,
        walkDone: false,
        generation: gen,
        resolve,
      };
      this._phase = 'wait_clear';
    });
  }

  /**
   * Single seated endpoint used by normal completion, skip during any phase, and post-intro checkpoint restore.
   * Cancels pending motions first so no delayed callback can disturb the seated guard, chair, or wand.
   */
  applySeatedEndpoint(actor: NpcActor, instant = true): void {
    this.cancelActive();
    this.generation++;
    const seatR = this.world.resolve('anchor:guard_seat');
    const seatPos = seatR ? new THREE.Vector3(seatR.pos.x, seatR.pos.y, seatR.pos.z) : DEFAULT_SEAT.pos.clone();
    const seatYaw = seatR?.yaw ?? DEFAULT_SEAT.yaw;

    actor.stopMove();
    actor.lookAt(null);
    actor.body.handTargets.R = null;
    actor.body.handTargetWeights.R = 1;
    actor.body.plantFeet = false;
    actor.body.setHeldItem(null);

    this.world.setPropVisible?.('dock_wand', true);
    this.world.setPropTransform?.('dock_chair', seatPos, seatYaw);

    actor.place(seatPos, seatYaw);
    actor.basePose = 'sit_typing';
    actor.body.setPose('sit_typing', instant ? 0 : 0.35);
    this._phase = 'seated';
  }

  /** Reset for a new game / pre-intro reload (clears any active routine and returns wand carry to pose-driven). */
  reset(actor?: NpcActor | null): void {
    this.cancelActive();
    this.generation++;
    this._phase = 'idle';
    if (actor) {
      actor.body.handTargets.R = null;
      actor.body.handTargetWeights.R = 1;
      actor.body.plantFeet = false;
      actor.body.setHeldItem(undefined);
    }
  }

  private cancelActive(): void {
    const run = this.active;
    if (!run) return;
    this.active = null;
    run.actor.stopMove();
    run.actor.lookAt(null);
    run.actor.body.handTargets.R = null;
    run.actor.body.handTargetWeights.R = 1;
    run.actor.body.plantFeet = false;
    run.resolve();
  }

  /** Advance the active routine by `dt` seconds. Called from `NpcDirector.update` before actor updates. */
  update(dt: number): void {
    const run = this.active;
    if (!run) return;
    run.t += dt;
    const { actor } = run;

    switch (run.phase) {
      case 'wait_clear': {
        const jay = this.world.playerFeet();
        const jayClearedBooth = jay.x > 8.1 || jay.z < 2.2 || jay.z > 5.8;
        if ((run.t >= PHASE_DUR.waitMin && jayClearedBooth) || run.t >= PHASE_DUR.waitMax) {
          this.enterWalkDesk(run);
        }
        break;
      }

      case 'walk_desk': {
        // Keep wand firmly in hand throughout the approach walk.
        if (actor.body.holding !== 'wand') actor.body.setHeldItem('wand');
        if (run.walkDone) {
          this.enterPlaceWand(run);
        }
        break;
      }

      case 'place_wand': {
        const t = run.t;
        this.handTarget.set(run.wandSpot.x, run.wandSpot.y + 0.03, run.wandSpot.z);
        actor.body.handTargets.R = this.handTarget;
        if (t < PHASE_DUR.placeContact) {
          actor.body.handTargetWeights.R = smoothstep(0, PHASE_DUR.placeContact, t);
        } else {
          if (!run.wandPlaced) {
            // Atomic contact transfer: hide hand wand and show desk wand in the same frame.
            run.wandPlaced = true;
            actor.body.setHeldItem(null);
            this.world.setPropVisible?.('dock_wand', true);
            actor.basePose = 'idle';
            actor.body.setPose('idle', 0.4);
          }
          actor.body.handTargetWeights.R = 1 - smoothstep(PHASE_DUR.placeContact, PHASE_DUR.placeTotal, t);
        }
        if (t >= PHASE_DUR.placeTotal) {
          actor.body.handTargets.R = null;
          actor.body.handTargetWeights.R = 1;
          actor.lookAt(null);
          this.enterStepToChair(run);
        }
        break;
      }

      case 'step_to_chair': {
        if (run.walkDone) {
          this.enterReachChair(run);
        }
        break;
      }

      case 'reach_chair': {
        const u = smoothstep(0, PHASE_DUR.reachChair, run.t);
        // Chair does not move until hand reaches the backrest.
        chairBackGrip(run.chairStartPos, run.chairStartYaw, this.handTarget);
        actor.body.handTargets.R = this.handTarget;
        actor.body.handTargetWeights.R = u;
        this.lookPoint.copy(this.handTarget);
        if (run.t >= PHASE_DUR.reachChair) {
          run.phase = 'pull_chair';
          run.t = 0;
          this._phase = 'pull_chair';
        }
        break;
      }

      case 'pull_chair': {
        const u = smoothstep(0, PHASE_DUR.pullChair, run.t);
        this.chairPos.lerpVectors(run.chairStartPos, run.seatPos, u);
        const chairYaw = lerpAngle(run.chairStartYaw, run.seatYaw, u);
        this.world.setPropTransform?.('dock_chair', this.chairPos, chairYaw);

        // Shift weight cleanly over planted foot (<= 0.42 m FootIk pin radius) while pulling the chair.
        const gx = THREE.MathUtils.lerp(run.chairGripPos.x, run.pullGuardEndPos.x, u);
        const gz = THREE.MathUtils.lerp(run.chairGripPos.z, run.pullGuardEndPos.z, u);
        const gyaw = lerpAngle(run.chairGripYaw, run.pullGuardEndYaw, u);
        this.setBodyPoseDirect(actor, gx, run.chairGripPos.y, gz, gyaw, 0);

        chairBackGrip(this.chairPos, chairYaw, this.handTarget);
        actor.body.handTargets.R = this.handTarget;
        actor.body.handTargetWeights.R = 1;
        this.lookPoint.copy(this.handTarget);

        if (run.t >= PHASE_DUR.pullChair) {
          this.world.setPropTransform?.('dock_chair', run.seatPos, run.seatYaw);
          run.phase = 'release_turn';
          run.t = 0;
          this._phase = 'release_turn';
          actor.basePose = 'idle';
          actor.body.setPose('idle', 0.35);
          actor.lookAt(null);
        }
        break;
      }

      case 'release_turn': {
        const t = run.t;
        if (t < PHASE_DUR.release) {
          chairBackGrip(run.seatPos, run.seatYaw, this.handTarget);
          actor.body.handTargets.R = this.handTarget;
          actor.body.handTargetWeights.R = 1 - smoothstep(0, PHASE_DUR.release, t);
          break;
        }
        actor.body.handTargets.R = null;
        actor.body.handTargetWeights.R = 1;
        const stepT = t - PHASE_DUR.release;
        const u = smoothstep(0, PHASE_DUR.stepAround, stepT);
        // Step cleanly around the east side of the chair to stand in front of the seat facing the keyboard.
        const pts = [
          { x: run.pullGuardEndPos.x, z: run.pullGuardEndPos.z },
          { x: run.seatPos.x + 0.52, z: run.seatPos.z - 0.24 },
          { x: run.seatPos.x + 0.44, z: run.seatPos.z + 0.14 },
          { x: run.seatPos.x, z: run.seatPos.z + 0.1 },
        ];
        samplePolyline(pts, u, this.stepPos, this.stepDir);
        const moveYaw = Math.atan2(-this.stepDir.x, -this.stepDir.z);
        const yawBlend = smoothstep(0.55, 1, u);
        const yaw = lerpAngle(moveYaw, run.seatYaw, yawBlend);
        const moveSpeed = u > 0.05 && u < 0.92 ? 0.95 : 0;
        this.setBodyPoseDirect(actor, this.stepPos.x, run.seatPos.y, this.stepPos.z, yaw, moveSpeed);

        if (stepT >= PHASE_DUR.stepAround) {
          this.setBodyPoseDirect(actor, run.seatPos.x, run.seatPos.y, run.seatPos.z + 0.1, run.seatYaw, 0);
          run.phase = 'sit_down';
          run.t = 0;
          this._phase = 'sit_down';
          actor.basePose = 'sit_typing';
          actor.body.setPose('sit_typing', 0.8);
        }
        break;
      }

      case 'sit_down': {
        const u = smoothstep(0, PHASE_DUR.sitDown, run.t);
        const z = THREE.MathUtils.lerp(run.seatPos.z + 0.1, run.seatPos.z, u);
        this.setBodyPoseDirect(actor, run.seatPos.x, run.seatPos.y, z, run.seatYaw, 0);
        if (run.t >= PHASE_DUR.sitDown) {
          this.applySeatedEndpoint(actor, false);
        }
        break;
      }

      default:
        break;
    }
  }

  private enterWalkDesk(run: ActiveRun): void {
    run.phase = 'walk_desk';
    run.t = 0;
    run.walkDone = false;
    this._phase = 'walk_desk';
    const w = this.world.walk('guard_return_desk');
    const gen = run.generation;
    void run.actor
      .moveTo(run.deskApproachPos, {
        yaw: run.deskApproachYaw,
        speed: w?.speed ?? 1.25,
        ...(w ? { curve: w.points } : {}),
      })
      .then(() => {
        if (this.active === run && run.generation === gen) run.walkDone = true;
      });
  }

  private enterPlaceWand(run: ActiveRun): void {
    run.phase = 'place_wand';
    run.t = 0;
    this._phase = 'place_wand';
    run.actor.place(run.deskApproachPos, run.deskApproachYaw);
    run.actor.basePose = 'wand_place';
    run.actor.body.setPose('wand_place', 0.4);
    this.lookPoint.copy(run.wandSpot);
    run.actor.lookAt(() => this.lookPoint);
  }

  private enterStepToChair(run: ActiveRun): void {
    run.phase = 'step_to_chair';
    run.t = 0;
    run.walkDone = false;
    this._phase = 'step_to_chair';
    const gen = run.generation;
    void run.actor
      .moveTo(run.chairGripPos, { yaw: run.chairGripYaw, speed: 1.1 })
      .then(() => {
        if (this.active === run && run.generation === gen) run.walkDone = true;
      });
  }

  private enterReachChair(run: ActiveRun): void {
    run.phase = 'reach_chair';
    run.t = 0;
    this._phase = 'reach_chair';
    run.actor.place(run.chairGripPos, run.chairGripYaw);
    run.actor.basePose = 'chair_pull';
    run.actor.body.setPose('chair_pull', 0.4);
    chairBackGrip(run.chairStartPos, run.chairStartYaw, this.lookPoint);
    run.actor.lookAt(() => this.lookPoint);
  }

  /** Place actor position/heading directly without resetting foot-IK pins (used for planted-foot pull and smooth sit settle). */
  private setBodyPoseDirect(actor: NpcActor, x: number, y: number, z: number, yaw: number, speed: number): void {
    actor.motor.x = x;
    actor.motor.y = y;
    actor.motor.z = z;
    actor.motor.vy = 0;
    actor.motor.grounded = true;
    actor.body.group.position.set(x, y, z);
    actor.body.heading = yaw;
    actor.body.group.rotation.y = yaw;
    actor.body.speed = speed;
  }
}
