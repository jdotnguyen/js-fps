import * as THREE from 'three';
import { Humanoid, type HumanoidContext, type HumanoidSpec } from '../actors/humanoid.ts';
import { DEFAULT_MOTOR, moveBody, type ColliderQuery, type MotorConfig, type MotorState } from '../actors/motor.ts';
import { SLAM } from '../actors/slam.ts';
import type { Rng } from '../core/rng.ts';
import type { EnemyVariant, EnemyVariantId } from './enemyData.ts';
import type { Navigator, P3 } from './nav.ts';
import { Memory, PERCEPTION, canSee, type SenseSource } from './perception.ts';

/**
 * One enemy (ADR-0007): a Humanoid body (ADR-0006) driven by a small state machine, moved through
 * the same collision motor as the player and the squad.
 *
 * dormant (idle / wander) -> alerted (groan) -> chase (path to the target, lurch bursts)
 *   -> windup (telegraph) -> strike (swipe, bite or grab) -> recover -> chase
 * plus search (go to the last known position), grab (holding the player), stagger, playDead,
 * waking (getting up), dead. Crawl, drag, blind and bite-only come from the body's damage
 * locomotion (ADR-0006/0019) and change speed, reach and which attacks are possible.
 * Heroes (ADR-0021) never lurch and attack with the slam through `Humanoid.tryAttack`.
 *
 * Perception runs every THINK seconds, staggered across enemies; steering runs every step but
 * allocates nothing (ADR-0015).
 */

export type EnemyState =
  | 'dormant'
  | 'alerted'
  | 'chase'
  | 'search'
  | 'windup'
  | 'recover'
  | 'grab'
  | 'stagger'
  | 'playDead'
  | 'waking'
  | 'dropping'
  | 'dead';

export type AttackKind = 'swipe' | 'bite' | 'grab' | 'slam';

/** Something enemies hunt: the player or a squadmate (ADR-0011). */
export interface EnemyTarget {
  readonly id: string;
  readonly kind: 'player' | 'squad';
  /** Feet position (live). */
  feet(out: THREE.Vector3): THREE.Vector3;
  alive(): boolean;
  /** Threat weight (ADR-0007/0011): player 1.0, teammate 0.6, working teammate 0.9. */
  weight(): number;
  /** Raw enemy damage (difficulty scaling is the target's business, e.g. Vitals). */
  /** `side` is the attacker's arm that struck: set for swipes and grab ticks. */
  hurt(amount: number, from: THREE.Vector3, kind: AttackKind, side?: 'L' | 'R'): void;
  /** Push away along the normalised flat direction (dx, dz) at `speed` m/s (hero slam). */
  knock?(dx: number, dz: number, speed: number): void;
  /** Flashlight on, or otherwise easy to see. */
  lit?(): boolean;
  /** Is world point `p` inside this target's flashlight beam ("shining at enemies alerts them")? */
  inBeam?(p: THREE.Vector3): boolean;
  /** Flat view direction (play-deads wake when the player turns away). */
  view?(out: THREE.Vector3): THREE.Vector3;
  /** Grab support (the player): start a grab from `source`; false if not possible now. */
  grab?(source: THREE.Vector3): boolean;
  isGrabbed?(): boolean;
  releaseGrab?(): void;
}

/** What an enemy needs from its director. */
export interface EnemyHost {
  readonly nav: Navigator;
  readonly colliders: ColliderQuery;
  readonly rng: Rng;
  readonly targets: readonly EnemyTarget[];
  /** Bumped whenever a door opens or closes: paths are recomputed. */
  readonly navEpoch: number;
  /** Lurch interval multiplier from difficulty (ADR-0008 `enemyLurchInterval`). */
  readonly lurchScale: number;
  /** The enemy currently holding the player, if any (one at a time). */
  grabber: Enemy | null;
  blocked(a: P3, b: P3): boolean;
  onAlert(e: Enemy, source: SenseSource): void;
  onAttack(e: Enemy, target: EnemyTarget, kind: AttackKind, amount: number): void;
  onGrab(e: Enemy): void;
  onGrabEnd(e: Enemy, reason: 'escaped' | 'shot' | 'died' | 'cleared'): void;
  onDied(e: Enemy): void;
  onSlam(e: Enemy, at: THREE.Vector3): void;
  /** A dropping enemy hit the floor after falling `height` m (enemy-encounters: a heard and felt landing). */
  onLand?(e: Enemy, height: number): void;
}

export interface EnemyInit {
  id: string;
  variant: EnemyVariantId;
  tuning: EnemyVariant;
  group: string | null;
  /** Feet position and facing. */
  pos: P3;
  yaw: number;
  spec: HumanoidSpec;
  /**
   * Spawn style: lie as a corpse until disturbed, come out of a vent / ceiling (prone, then up), or drop from the
   * spawn point to the floor at `dropTo` (world y) and get up from the landing.
   */
  start?: 'stand' | 'playDead' | 'emerge' | 'drop';
  dropTo?: number;
}

/** Fall acceleration for a dropping enemy (m/s²). */
const DROP_GRAVITY = 9.81;

/** Perception interval (s). */
export const THINK = 0.2;
/** Repath interval (ADR-0007: 0.5 s, or when a door changes). */
export const REPATH = 0.5;
const MOTOR: MotorConfig = { ...DEFAULT_MOTOR, radius: 0.3 };
const WAYPOINT_REACHED = 0.5;
/** Stand off this close to the target instead of walking into it. */
const STAND_OFF = 0.75;
/** How long an enemy may make no progress before it gives up its path and sidesteps (DoD: < 2 s stuck). */
const STUCK_TIME = 1.0;
/** Crawlers and draggers bite low and close. */
const CRAWL_REACH = 1.0;
/**
 * Most a target's feet may be above or below the enemy's for an attack to start or land: Jay on a 1 m crate is
 * in reach, anyone through a floor or ceiling (every gap in the slice is 3.2 m or more) is not.
 */
export const REACH_DY = 1.2;
/** Damage taken while holding the player that makes the grabber let go (a teammate shooting it off). */
export const GRAB_BREAK_DAMAGE = 30;
const GRAB_TICK = 0.25;
/** Limp (ADR-0019, 0.4 at the threshold up to 1) at which lurch bursts stop. */
export const LIMP_NO_LURCH = 0.7;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpEye: P3 = { x: 0, y: 0, z: 0 };
const tmpAim: P3 = { x: 0, y: 0, z: 0 };

export class Enemy {
  readonly id: string;
  readonly variant: EnemyVariantId;
  readonly tuning: EnemyVariant;
  readonly group: string | null;
  readonly body: Humanoid;
  readonly motor: MotorState;
  readonly memory = new Memory();
  state: EnemyState = 'dormant';
  /** Seconds in the current state. */
  stateT = 0;
  target: EnemyTarget | null = null;
  /** Planned feet position after steering, before separation and collision (the director fills it). */
  readonly planned = new THREE.Vector3();
  /** Seconds since death (corpse fade order). */
  deadFor = 0;
  /** Damage taken while grabbing (shot off at GRAB_BREAK_DAMAGE). */
  grabDamage = 0;
  /** Free-form debug text: why the last decision was made. */
  note = '';

  private readonly home = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly opts: { maxSpeed?: number; turnRate?: number } = {};
  private readonly desired = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly targetFeet = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private readonly pathGoal = new THREE.Vector3(Infinity, 0, 0);
  private path: P3[] | null = null;
  private pathIndex = 0;
  private pathEpoch = -1;
  private repathT = 0;
  private thinkT: number;
  private lurchT: number;
  private lurchLeft = 0;
  private attackCd = 0;
  private stuckT = 0;
  private sidestepT = 0;
  private sidestepSign = 1;
  private wanderT: number;
  private wandering = false;
  private stateDur = 0;
  private grabTick = 0;
  private strikeSide: 'L' | 'R' = 'R';
  /** Floor a dropping enemy lands on, and the height it fell from. */
  private dropTo = 0;
  private dropFrom = 0;

  constructor(init: EnemyInit, ctx: HumanoidContext, rng: Rng, thinkOffset: number) {
    this.id = init.id;
    this.variant = init.variant;
    this.tuning = init.tuning;
    this.group = init.group;
    this.body = new Humanoid(init.spec, ctx);
    this.motor = { x: init.pos.x, y: init.pos.y, z: init.pos.z, vy: 0, grounded: true };
    this.body.group.position.set(init.pos.x, init.pos.y, init.pos.z);
    this.body.setHeading(init.yaw);
    this.body.group.updateMatrixWorld(true);
    this.home.set(init.pos.x, init.pos.y, init.pos.z);
    this.lastPos.copy(this.home);
    this.planned.copy(this.home);
    this.thinkT = thinkOffset;
    this.lurchT = rng.range(init.tuning.lurch[2], init.tuning.lurch[3]);
    this.wanderT = rng.range(1, 5);
    const start = init.start ?? 'stand';
    if (start === 'playDead') {
      this.body.playDead(rng.pick(['corpseProne', 'corpseSupine', 'corpseSide']));
      this.setState('playDead');
    } else if (start === 'emerge') {
      this.body.playDead('corpseProne');
      this.body.getUp();
      this.setState('waking');
    } else if (start === 'drop') {
      // Out of the vent belly first: falls flat, hits the deck, then gets up from the landing.
      this.body.playDead('corpseProne');
      this.dropFrom = init.pos.y;
      this.dropTo = Math.min(init.dropTo ?? init.pos.y, init.pos.y);
      this.motor.grounded = false;
      this.setState('dropping');
    }
  }

  // ---------------------------------------------------------------- queries (squad agent API)

  get position(): THREE.Vector3 {
    return this.body.group.position;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  /** Holding the player (teammates should shoot its arms: ADR-0007/0011). */
  get grabbing(): boolean {
    return this.state === 'grab';
  }

  get hero(): boolean {
    return this.body.spec.hero === true;
  }

  /** Moves under its own steering (separation pushes it); play-deads and corpses are immovable. */
  get mobile(): boolean {
    const s = this.body.state;
    return this.state !== 'dead' && this.state !== 'playDead' && this.state !== 'dropping' && (s === 'alive' || s === 'falling' || s === 'gettingUp');
  }

  /** Awake and hunting (counts as "in combat"). */
  get engaged(): boolean {
    return this.state === 'chase' || this.state === 'windup' || this.state === 'recover' || this.state === 'grab' || this.state === 'alerted' || this.state === 'stagger';
  }

  // ---------------------------------------------------------------- control

  setState(s: EnemyState, duration = 0): void {
    this.state = s;
    this.stateT = 0;
    this.stateDur = duration;
  }

  /** Hear or be told about something at `p` (noise, an ally's alert, a script). */
  sense(p: P3, source: SenseSource, targetId: string | null, host: EnemyHost): void {
    if (this.state === 'dead') return;
    if (this.state === 'playDead') {
      // Only gunfire close by or being shot wakes a play-dead; distant noise does not.
      if (source !== 'touch') return;
      this.wake();
      return;
    }
    this.memory.sense(p, source, targetId);
    if (targetId) this.target = host.targets.find((t) => t.id === targetId) ?? this.target;
    if (this.state === 'dormant' || this.state === 'search') this.alert(host, source);
  }

  /** Stagger (shove, shotgun blast, lost limb): stop, no attack, then back to the chase. */
  stagger(seconds: number, host: EnemyHost): void {
    if (this.state === 'dead' || this.state === 'playDead' || this.state === 'waking' || this.state === 'dropping') return;
    this.body.stagger(seconds);
    if (this.state === 'grab') this.endGrab(host, 'shot');
    this.setState('stagger', seconds);
    this.body.charge = 0;
  }

  /** Get up from playing dead (player close, turned away, shot, or scripted). */
  wake(): void {
    if (this.state !== 'playDead') return;
    if (this.body.state === 'playingDead') {
      if (this.body.locomotion.mode === 'walk') this.body.getUp();
      else this.body.state = 'alive';
    }
    this.setState('waking');
  }

  /** Took damage from a weapon (the director calls this after Humanoid.applyHit). */
  onDamaged(amount: number, from: P3 | null, by: string | null, host: EnemyHost): void {
    if (this.state === 'dead') return;
    if (this.state === 'grab') {
      this.grabDamage += amount;
      const loc = this.body.locomotion;
      if (this.grabDamage >= GRAB_BREAK_DAMAGE || !loc.canGrabL || !loc.canGrabR) this.stagger(this.tuning.stagger, host);
    }
    if (this.state === 'playDead') this.wake();
    if (from && (this.state === 'dormant' || this.state === 'search')) this.sense(from, 'sound', by, host);
  }

  // ---------------------------------------------------------------- per step

  /**
   * Decide and steer. Fills `planned` with where the body wants to be after this step; the director
   * then separates bodies and calls `commit`.
   */
  step(dt: number, host: EnemyHost): void {
    const body = this.body;
    this.stateT += dt;
    this.memory.update(dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.state !== 'dead' && !body.alive) this.die(host);
    if (this.state === 'dead') {
      this.deadFor += dt;
      this.planned.copy(body.group.position);
      body.steer(null, dt);
      return;
    }
    if (this.state === 'dropping') {
      this.fall(dt, host);
      this.planned.copy(body.group.position);
      body.steer(null, dt);
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT += THINK;
      this.think(host);
    }
    const loc = body.locomotion;
    let desired: THREE.Vector3 | null = null;
    let maxSpeed: number | undefined;
    let turnRate: number | undefined;
    body.lookTarget = null;
    body.speedScale = 1;
    if (this.state !== 'windup' && this.state !== 'chase') body.charge = 0;

    const t = this.target;
    const haveTarget = t !== null && t.alive();
    if (haveTarget) t.feet(this.targetFeet);
    const toX = this.targetFeet.x - this.motor.x;
    const toZ = this.targetFeet.z - this.motor.z;
    const dist = haveTarget ? Math.hypot(toX, toZ) : Infinity;

    switch (this.state) {
      case 'playDead':
        break;
      case 'waking':
        if (body.state === 'alive') {
          // Comes up hunting, with a fast first lurch (ADR-0007).
          this.lurchT = 0;
          this.alert(host, 'touch', 0.15);
        }
        break;
      case 'dormant':
        desired = this.wander(dt, host);
        maxSpeed = 0.45;
        break;
      case 'alerted':
        // Groan and turn toward the disturbance.
        if (haveTarget || this.memory.fresh) {
          this.desired.set(this.memory.last.x - this.motor.x, 0, this.memory.last.z - this.motor.z);
          desired = this.desired;
          maxSpeed = 0;
          turnRate = 2.5;
        }
        if (this.stateT >= this.stateDur) this.setState('chase');
        break;
      case 'search':
        this.goal.set(this.memory.last.x, this.memory.last.y, this.memory.last.z);
        if (Math.hypot(this.goal.x - this.motor.x, this.goal.z - this.motor.z) < 1.0) {
          // Arrived: stand and listen, then give up.
          if (this.stateT > 4 || this.memory.forgotten) {
            this.memory.clear();
            this.target = null;
            this.home.copy(this.position);
            this.setState('dormant');
          }
        } else {
          desired = this.follow(dt, host);
          maxSpeed = 0.8;
        }
        if (this.memory.forgotten) this.setState('dormant');
        break;
      case 'chase': {
        const recent = this.memory.age < 1.0 && haveTarget && this.memory.targetId === t!.id;
        if (!recent && !this.memory.fresh) {
          this.setState('search');
          break;
        }
        if (recent) this.goal.copy(this.targetFeet);
        else this.goal.set(this.memory.last.x, this.memory.last.y, this.memory.last.z);
        if (recent) {
          body.lookTarget = this.look.copy(this.targetFeet).setY(this.targetFeet.y + 1.5);
        }
        if (this.hero) {
          desired = this.heroChase(dt, host, dist, recent);
          break;
        }
        // Lurch bursts: 2.4 m/s for 0.6 s every 4-7 s (scaled by difficulty), walking bodies only.
        this.lurchT -= dt;
        if (this.lurchT <= 0) {
          this.lurchT = host.rng.range(this.tuning.lurch[2], this.tuning.lurch[3]) * host.lurchScale;
          // A badly limping leg (ADR-0019) cannot take a lurch; a light limp lurches shorter.
          if (loc.mode === 'walk' && loc.limp < LIMP_NO_LURCH && dist > 1.6 && dist < 12) this.lurchLeft = this.tuning.lurch[1] * (1 - loc.limp * 0.5);
        }
        this.lurchLeft -= dt;
        if (this.lurchLeft > 0) body.speedScale = this.tuning.lurch[0] / this.tuning.walk;
        body.charge = recent && !loc.blind && dist < 2.6 ? 1 : 0;
        const reach = this.reach();
        if (recent && dist <= reach && this.sameLevel() && this.canStartAttack(toX, toZ)) {
          this.setState('windup', this.tuning.attack.windup);
          this.strikeSide = loc.canGrabR ? (loc.canGrabL && host.rng.chance(0.5) ? 'L' : 'R') : 'L';
          break;
        }
        if (recent && dist < STAND_OFF) {
          // Close: face it, don't walk into it.
          this.desired.set(toX, 0, toZ);
          desired = this.desired;
          maxSpeed = 0;
          turnRate = 3;
        } else {
          desired = this.follow(dt, host);
        }
        break;
      }
      case 'windup': {
        // Telegraph: arms up, jaw wide, tracking the target slowly (ADR-0007: 0.8 s).
        body.charge = 1;
        body.windupSide = this.strikeSide;
        body.grabbing = false;
        if (body.staggered) {
          body.windupSide = null;
          this.setState('stagger', 0.35);
          break;
        }
        if (haveTarget) {
          this.desired.set(toX, 0, toZ);
          desired = this.desired;
          maxSpeed = 0;
          turnRate = 1.6;
          body.lookTarget = this.look.copy(this.targetFeet).setY(this.targetFeet.y + 1.5);
        }
        if (this.stateT >= this.stateDur) this.strike(host, dist, toX, toZ);
        break;
      }
      case 'recover':
        body.windupSide = null;
        body.grabbing = false;
        if (this.stateT >= this.stateDur) this.setState('chase');
        break;
      case 'grab': {
        const tgt = this.target;
        if (!tgt || !tgt.alive() || !(tgt.isGrabbed?.() ?? false)) {
          body.grabbing = false;
          this.endGrab(host, 'escaped');
          this.stagger(1.0, host);
          break;
        }
        this.desired.set(toX, 0, toZ);
        desired = this.desired;
        maxSpeed = 0;
        turnRate = 3;
        body.charge = 1;
        body.windupSide = null;
        body.grabbing = true;
        body.lookTarget = this.look.copy(this.targetFeet).setY(this.targetFeet.y + 1.5);
        this.grabTick += dt;
        if (this.grabTick >= GRAB_TICK) {
          this.grabTick -= GRAB_TICK;
          const amount = this.tuning.attack.grabDps * GRAB_TICK * loc.grabMul;
          if (amount > 0) {
            tgt.hurt(amount, this.headPos(tmpB), 'grab', this.strikeSide);
            host.onAttack(this, tgt, 'grab', amount);
          }
        }
        break;
      }
      case 'stagger':
        if (this.stateT >= this.stateDur && !body.staggered) this.setState(this.memory.fresh ? 'chase' : 'search');
        break;
    }

    // Planned move: steering (which may pivot a crawler round its hands) plus this step's velocity.
    const opts = this.opts;
    if (maxSpeed !== undefined) opts.maxSpeed = maxSpeed;
    else delete opts.maxSpeed;
    if (turnRate !== undefined) opts.turnRate = turnRate;
    else delete opts.turnRate;
    const vel = body.steer(desired, dt, opts);
    this.planned.copy(body.group.position).addScaledVector(vel, dt);
    this.trackStuck(dt, desired !== null && (maxSpeed === undefined || maxSpeed > 0));
  }

  /** Apply the separated planned position through the collision motor, then animate. */
  commit(dt: number, x: number, z: number, cameraPos: THREE.Vector3 | null, host: EnemyHost): void {
    const body = this.body;
    if (this.mobile) {
      moveBody(this.motor, x - this.motor.x, z - this.motor.z, dt, MOTOR, host.colliders);
      body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
    } else {
      // Bodies that do not walk still settle onto the floor.
      body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
    }
    body.update(dt, cameraPos);
    const impact = body.consumeSlamImpact();
    if (impact) host.onSlam(this, impact);
  }

  /** Push the body (shove, slam) through the motor. */
  push(dx: number, dz: number, host: EnemyHost): void {
    if (!this.mobile) return;
    const x0 = this.motor.x;
    const z0 = this.motor.z;
    moveBody(this.motor, dx, dz, 1 / 60, MOTOR, host.colliders);
    this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);
    this.body.nudgeImpulse(this.motor.x - x0, this.motor.z - z0, 1 / 60);
  }

  /**
   * Count it dead without a kill (the director removing an enemy that can't reach anyone): lets go of any grab
   * and reports `onDied` like any death, so its spawn group can clear. The caller removes the body.
   */
  cull(host: EnemyHost): void {
    if (this.state === 'dead') return;
    this.die(host);
  }

  /** Remove from the scene and free GPU resources. */
  dispose(): void {
    this.body.group.removeFromParent();
    this.body.dispose();
  }

  // ---------------------------------------------------------------- internals

  /** One step of a drop: fall under gravity, and on reaching the floor land and start getting up. */
  private fall(dt: number, host: EnemyHost): void {
    const m = this.motor;
    m.vy -= DROP_GRAVITY * dt;
    m.y += m.vy * dt;
    if (m.y > this.dropTo) return;
    m.y = this.dropTo;
    m.vy = 0;
    m.grounded = true;
    this.body.group.position.y = m.y;
    this.body.getUp();
    this.setState('waking');
    host.onLand?.(this, this.dropFrom - this.dropTo);
  }

  private think(host: EnemyHost): void {
    const body = this.body;
    if (this.state === 'dead' || this.state === 'waking' || this.state === 'dropping') return;
    const eye = this.eyePos(tmpEye);
    if (this.state === 'playDead') {
      // Wake when a target comes within reach, or walks past close by and looks away (ADR-0007).
      for (const t of host.targets) {
        if (!t.alive()) continue;
        t.feet(tmpA);
        const d = Math.hypot(tmpA.x - this.motor.x, tmpA.z - this.motor.z);
        const wakeR = this.tuning.wakeRadius ?? 3;
        let wake = d <= wakeR;
        if (!wake && t.view && d <= (this.tuning.wakeBehind ?? 0)) {
          const v = t.view(tmpB);
          // Looking away: the enemy is behind the target's view.
          wake = (this.motor.x - tmpA.x) * v.x + (this.motor.z - tmpA.z) * v.z < -0.2 * d;
        }
        if (wake) {
          this.memory.sense(tmpA, 'touch', t.id);
          this.target = t;
          this.wake();
          return;
        }
      }
      return;
    }
    const blind = body.locomotion.blind;
    let best: EnemyTarget | null = null;
    let bestScore = -Infinity;
    let how: SenseSource = 'sight';
    for (const t of host.targets) {
      if (!t.alive()) continue;
      t.feet(tmpA);
      tmpAim.x = tmpA.x;
      tmpAim.y = tmpA.y + 1.3;
      tmpAim.z = tmpA.z;
      const d = Math.hypot(tmpA.x - eye.x, tmpA.z - eye.z);
      let seen = false;
      let src: SenseSource = 'sight';
      if (blind) {
        seen = d <= PERCEPTION.touch;
        src = 'touch';
      } else {
        const beam = t.inBeam ? t.inBeam(this.chest(tmpB)) : false;
        seen = canSee({ eye, heading: body.heading, target: tmpAim, lit: t.lit?.() ?? false, inBeam: beam, blocked: (a, b) => host.blocked(a, b) });
      }
      if (!seen) continue;
      const score = t.weight() / Math.max(1, d);
      if (score > bestScore) {
        bestScore = score;
        best = t;
        how = src;
      }
    }
    if (best) {
      best.feet(tmpA);
      this.memory.sense(tmpA, how, best.id);
      this.target = best;
      if (this.state === 'dormant' || this.state === 'search') this.alert(host, how);
    }
  }

  private alert(host: EnemyHost, source: SenseSource, delay?: number): void {
    const [lo, hi] = this.tuning.alertDelay;
    this.setState('alerted', delay ?? host.rng.range(lo, hi));
    this.path = null;
    host.onAlert(this, source);
  }

  private reach(): number {
    const loc = this.body.locomotion;
    if (loc.mode !== 'walk') return CRAWL_REACH;
    return this.tuning.attack.range;
  }

  private canStartAttack(toX: number, toZ: number): boolean {
    const body = this.body;
    if (this.attackCd > 0 || body.staggered || body.state !== 'alive') return false;
    let diff = Math.atan2(-toX, -toZ) - body.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.abs(diff) < 0.7;
  }

  /** End of the windup: swipe, bite, or grab the player (35% with both arms, ADR-0007). */
  /** The target's feet (as last read this step) are within REACH_DY of this body's feet. */
  private sameLevel(): boolean {
    return Math.abs(this.targetFeet.y - this.motor.y) <= REACH_DY;
  }

  private strike(host: EnemyHost, dist: number, toX: number, toZ: number): void {
    const body = this.body;
    const loc = body.locomotion;
    const t = this.target;
    this.attackCd = this.tuning.attack.cooldown;
    let diff = Math.atan2(-toX, -toZ) - body.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const connects = t !== null && t.alive() && dist <= this.reach() * 1.2 && this.sameLevel() && Math.abs(diff) < 1.0;
    const canGrab = loc.mode === 'walk' && loc.canGrabL && loc.canGrabR && !loc.biteOnly && host.grabber === null && t?.grab !== undefined && !(t.isGrabbed?.() ?? false);
    if (connects && canGrab && host.rng.chance(this.tuning.attack.grabChance) && t!.grab!(this.headPos(tmpB))) {
      this.setState('grab');
      this.grabDamage = 0;
      this.grabTick = 0;
      host.grabber = this;
      host.onGrab(this);
      return;
    }
    const bite = loc.biteOnly || loc.mode !== 'walk';
    if (!bite) body.strike(this.strikeSide);
    if (connects) {
      const amount = bite ? this.tuning.attack.biteDamage : this.tuning.attack.damage;
      t!.hurt(amount, this.headPos(tmpB), bite ? 'bite' : 'swipe', bite ? undefined : this.strikeSide);
      host.onAttack(this, t!, bite ? 'bite' : 'swipe', amount);
    }
    this.setState('recover', this.tuning.attack.recover);
  }

  private endGrab(host: EnemyHost, reason: 'escaped' | 'shot' | 'died' | 'cleared'): void {
    this.body.grabbing = false;
    if (host.grabber === this) host.grabber = null;
    if (this.target?.isGrabbed?.()) this.target.releaseGrab?.();
    if (this.state === 'grab') this.setState('recover', 0.3);
    host.onGrabEnd(this, reason);
  }

  /** Hero chase: walk in to slam range, slam, and keep tracking while winding up (ADR-0021). */
  private heroChase(dt: number, host: EnemyHost, dist: number, recent: boolean): THREE.Vector3 | null {
    const body = this.body;
    const slam = body.slam;
    if (slam?.busy) {
      this.note = `slam ${slam.phase}`;
      this.desired.set(this.targetFeet.x - this.motor.x, 0, this.targetFeet.z - this.motor.z);
      return this.desired;
    }
    if (recent && dist <= SLAM.range) {
      body.tryAttack(this.targetFeet);
      if (dist < SLAM.range * 0.75) {
        this.desired.set(this.targetFeet.x - this.motor.x, 0, this.targetFeet.z - this.motor.z);
        return this.desired;
      }
    }
    return this.follow(dt, host);
  }

  /** Direction along the current path toward `goal`, repathing every REPATH s or on door changes. */
  private follow(dt: number, host: EnemyHost): THREE.Vector3 | null {
    const me = this.motor;
    if (this.sidestepT > 0) {
      // Unsticking: a short step to one side of the way we wanted to go.
      this.sidestepT -= dt;
      const h = this.body.heading + this.sidestepSign * Math.PI * 0.5;
      return this.desired.set(-Math.sin(h), 0, -Math.cos(h));
    }
    this.repathT -= dt;
    const moved = Math.hypot(this.pathGoal.x - this.goal.x, this.pathGoal.z - this.goal.z);
    // No path (a closed door): try again every REPATH s, not every step.
    if ((!this.path && this.repathT <= 0) || this.pathEpoch !== host.navEpoch || (this.repathT <= 0 && moved > 0.4)) {
      this.repathT = REPATH;
      this.pathEpoch = host.navEpoch;
      this.pathGoal.copy(this.goal);
      this.path = host.nav.findPath(me, this.goal, { radius: 0.25 });
      this.pathIndex = 0;
      this.note = this.path ? `path ${this.path.length}` : 'no path';
    }
    const path = this.path;
    if (!path) return null;
    let wp = path[this.pathIndex];
    while (wp && this.pathIndex < path.length - 1 && Math.hypot(wp.x - me.x, wp.z - me.z) < WAYPOINT_REACHED) wp = path[++this.pathIndex];
    if (!wp) return null;
    const dx = wp.x - me.x;
    const dz = wp.z - me.z;
    if (dx * dx + dz * dz < 0.01) return null;
    return this.desired.set(dx, 0, dz).normalize();
  }

  /** Idle wandering around the spawn point (ADR-0007 dormant). */
  private wander(dt: number, host: EnemyHost): THREE.Vector3 | null {
    const r = this.tuning.wanderRadius;
    if (r <= 0) return null;
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = host.rng.range(4, 9);
      this.wandering = false;
      const a = host.rng.range(0, Math.PI * 2);
      const d = host.rng.range(r * 0.3, r);
      this.goal.set(this.home.x + Math.sin(a) * d, this.home.y, this.home.z + Math.cos(a) * d);
      if (host.rng.chance(0.6) && host.nav.direct(this.motor, this.goal, 0.3)) this.wandering = true;
    }
    if (!this.wandering) return null;
    const dx = this.goal.x - this.motor.x;
    const dz = this.goal.z - this.motor.z;
    if (dx * dx + dz * dz < 0.25) {
      this.wandering = false;
      return null;
    }
    return this.desired.set(dx, 0, dz).normalize();
  }

  private trackStuck(dt: number, wantsToMove: boolean): void {
    const p = this.position;
    if (wantsToMove && this.mobile && this.body.speed > 0.05 && this.sidestepT <= 0) {
      const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      this.stuckT = moved < this.body.speed * dt * 0.15 ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 0.5);
      if (this.stuckT > STUCK_TIME) {
        this.stuckT = 0;
        this.path = null;
        this.sidestepT = 0.6;
        this.sidestepSign = -this.sidestepSign;
      }
    } else if (!wantsToMove) {
      this.stuckT = 0;
    }
    this.lastPos.copy(p);
  }

  private die(host: EnemyHost): void {
    if (this.state === 'grab' || host.grabber === this) this.endGrab(host, 'died');
    this.setState('dead');
    this.body.charge = 0;
    this.body.windupSide = null;
    this.body.grabbing = false;
    this.body.lookTarget = null;
    host.onDied(this);
  }

  private eyePos(out: P3): P3 {
    out.x = this.motor.x;
    out.y = this.motor.y + (this.body.locomotion.mode === 'walk' ? PERCEPTION.eyeHeight * (this.hero ? 1.15 : 1) : 0.5);
    out.z = this.motor.z;
    return out;
  }

  private chest(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.motor.x, this.motor.y + 1.2, this.motor.z);
  }

  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.motor.x, this.motor.y + (this.body.locomotion.mode === 'walk' ? 1.6 : 0.5), this.motor.z);
  }
}
