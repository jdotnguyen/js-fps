import * as THREE from 'three';
import { DEFAULT_MOTOR, floorHeight, moveBody, type MotorConfig, type MotorState } from '../actors/motor.ts';
import { Humanoid, type HumanoidContext, type HumanoidSpec } from '../actors/humanoid.ts';
import { GILES, OKAFOR } from '../actors/squadLooks.ts';
import type { NavGraph, P3 } from './nav.ts';

/**
 * Squad AI, follow layer (ADR-0011 steps 1-2). Giles and Okafor are humanoid bodies moved
 * through the same collision motor as the player. Each picks a target every 0.25 s:
 * - a formation slot beside/behind Jay when it is reachable in plain view,
 * - otherwise a point on Jay's breadcrumb trail (corridors, doorways),
 * - sidestepping out of Jay's aim cone (15 degrees) when they drift into it.
 * They path with the shared navgraph, keep apart from Jay and each other (Jay can push past),
 * and catch up by teleporting when far away and out of sight. Combat, tasks and revives
 * (ADR-0011 steps 3+) layer on top of this later.
 */

export type SquadId = 'engineer' | 'medic';

/** What the squad reads from the player each step. */
export interface SquadPlayer {
  body: MotorState;
  yaw: number;
  velocity: { x: number; y: number };
  /** 0..1, how far into aim-down-sights Jay is. */
  aimBlend: number;
  viewDirection(out?: THREE.Vector3): THREE.Vector3;
  eyePosition(out?: THREE.Vector3): THREE.Vector3;
}

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

export class SquadMate {
  readonly id: SquadId;
  readonly body: Humanoid;
  readonly motor: MotorState;
  /** Debug: why the current target was chosen. */
  mode: 'slot' | 'trail' | 'aimDodge' | 'idle' = 'idle';
  readonly target = new THREE.Vector3();
  private readonly role: Role;
  private path: P3[] | null = null;
  private pathIndex = 0;
  private pathTarget = new THREE.Vector3(Infinity, 0, 0);
  private thinkT = 0;
  private repathT = 0;
  private stuckT = 0;
  private readonly lastPos = new THREE.Vector3();
  /** Side committed to while dodging out of the aim cone (0 = not dodging). */
  private dodgeSide = 0;
  /** Walking after Jay (true) or standing where they are (false). */
  private following = false;

  constructor(role: Role, ctx: HumanoidContext) {
    this.role = role;
    this.id = role.id;
    this.body = new Humanoid({ ...role.spec, role: 'npc' }, ctx);
    this.motor = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
    // Stagger the two so they don't think on the same frame.
    this.thinkT = role.id === 'medic' ? SQUAD_TUNING.think / 2 : 0;
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
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = SQUAD_TUNING.think;
      this.think(squad, player);
    }
    const me = this.position;
    const toTarget = Math.hypot(this.target.x - me.x, this.target.z - me.z);
    const desired = tmpD.set(0, 0, 0);
    let speed = 0;

    // Dodges are short hops, so they need to land precisely.
    const arrive = this.mode === 'aimDodge' ? 0.15 : SQUAD_TUNING.arrive;
    // Reaching the spot near Jay counts as stopping, even if it is just beyond 10 ft.
    if (this.following && toTarget <= arrive && Math.hypot(me.x - squad.playerFeet.x, me.z - squad.playerFeet.z) <= SQUAD_TUNING.resumeDistance) {
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
    }

    // Keep apart from Jay and each other. Jay never collides with them; they yield.
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
    push(squad.playerFeet, SQUAD_TUNING.personalPlayer);
    for (const m of squad.mates) if (m !== this) push(m.position, SQUAD_TUNING.personalMate);
    if (sep.lengthSq() > 1e-6) {
      desired.addScaledVector(sep, 2.2);
      speed = Math.max(speed, 1.0);
    }

    const vel = this.body.steer(desired.lengthSq() > 1e-6 ? desired : null, dt, { maxSpeed: speed, turnRate: 3.2, accel: 2.2 });
    moveBody(this.motor, vel.x * dt, vel.z * dt, dt, MOTOR, squad.colliders);
    this.body.group.position.set(this.motor.x, this.motor.y, this.motor.z);

    // Idle: look at Jay now and then; while moving, look where they walk.
    if (speed === 0 && this.body.speed < 0.2) {
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
  nav: NavGraph;
  player: SquadPlayer;
}

export class Squad {
  readonly group = new THREE.Group();
  readonly mates: SquadMate[];
  readonly nav: NavGraph;
  readonly playerFeet = new THREE.Vector3();
  readonly playerHead = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Seconds Jay has been aiming down sights. */
  aimHeld = 0;
  private readonly player: SquadPlayer;
  private readonly trail: THREE.Vector3[] = [];
  private placed = false;

  constructor(deps: SquadDeps) {
    this.nav = deps.nav;
    this.player = deps.player;
    this.group.name = 'squad';
    this.mates = ROLES.map((r) => new SquadMate(r, deps.ctx));
    for (const m of this.mates) this.group.add(m.body.group);
  }

  get colliders(): NavGraph['world'] {
    return this.nav.world;
  }

  mate(id: SquadId): SquadMate {
    return this.mates.find((m) => m.id === id)!;
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
      const spot = this.spawnSpot(m);
      m.place(spot, this.player.yaw);
    }
    this.placed = true;
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
      return;
    }
    this.aimHeld = this.player.aimBlend > 0.5 ? this.aimHeld + dt : 0;
    const last = this.trail.at(-1);
    if (!last || last.distanceTo(this.playerFeet) >= SQUAD_TUNING.trailStep) {
      this.trail.push(this.playerFeet.clone());
      if (this.trail.length > SQUAD_TUNING.trailLength) this.trail.shift();
    }
    for (const m of this.mates) {
      m.update(dt, this, this.player, cameraPos);
      this.catchUp(m);
    }
  }

  /** Far away and out of sight: reappear on Jay's trail behind him (ADR-0011). */
  private catchUp(m: SquadMate): void {
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
    const eye = this.playerHead;
    const to = tmpB.set(p.x - eye.x, p.y + 1.2 - eye.y, p.z - eye.z);
    if (to.x * this.forward.x + to.z * this.forward.z < 0) return false;
    return this.nav.direct({ x: eye.x, y: eye.y - 1.25, z: eye.z }, { x: p.x, y: p.y, z: p.z }, 0);
  }
}
