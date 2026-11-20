import * as THREE from 'three';
import type { HumanoidContext, HumanoidSpec, BodyHit } from '../actors/humanoid.ts';
import type { HitResult } from '../actors/damage.ts';
import { OUTFITS, type Outfit } from '../actors/bodyGeometry.ts';
import type { ColliderQuery } from '../actors/motor.ts';
import { separate, type SepBody } from '../actors/separation.ts';
import { SLAM, slamFalloff } from '../actors/slam.ts';
import type { EventBus } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { Enemy, type AttackKind, type EnemyHost, type EnemyState, type EnemyTarget } from './enemy.ts';
import type { EnemyTable, EnemyVariantId } from './enemyData.ts';
import { segmentHit, type Navigator, type P3 } from './nav.ts';
import { hears, PERCEPTION, type NoiseKind, type SenseSource } from './perception.ts';
import { Spawner, type SpawnPointData, type SpawnRequest } from './spawner.ts';
import { fireShot, WEAPON_HITS, type ShotReport } from '../actors/shots.ts';

/**
 * Runs every enemy (ADR-0007): spawning and limits, perception events (noise, alert sharing),
 * separation (ADR-0018), grabs, hero slams and the events sequences and other systems listen to.
 *
 * For the squad (ADR-0011): `list` holds every enemy (`position`, `alive`, `grabbing`, `target`,
 * `body`), `grabber` is the one holding the player, `raycast` / `applyHit` let a teammate shoot one,
 * and `addTarget` makes a squadmate something enemies hunt. `enemy:attack` reports hits on anyone.
 */

declare module '../core/events.ts' {
  interface EventMap {
    'enemy:spawned': { id: string; variant: EnemyVariantId; group: string | null; x: number; y: number; z: number };
    'enemy:alerted': { id: string; target: string | null; source: SenseSource; x: number; y: number; z: number };
    'enemy:died': { id: string; variant: EnemyVariantId; group: string | null; x: number; y: number; z: number; by: string | null };
    /** An enemy hurt a target (`target` is a target id: 'player', 'engineer', 'medic'). Raw damage. */
    'enemy:attack': { id: string; target: string; kind: AttackKind; amount: number };
    'enemy:grab': { id: string; target: string };
    'enemy:grabReleased': { id: string; reason: 'escaped' | 'shot' | 'died' | 'cleared' };
    'enemy:slam': { id: string; x: number; y: number; z: number };
    /** A weapon hit an enemy (`by`: 'player' or a squad id). */
    'enemy:hit': { id: string; region: string; amount: number; severed: string | null; killed: boolean; weakSpot: boolean; by: string };
    /** Every enemy a spawn group produced is dead (sequences `waitFor` it; also `group:cleared:<group>`). */
    'group:cleared': { group: string };
  }
}

export interface EnemyDirectorDeps {
  ctx: HumanoidContext;
  nav: Navigator;
  colliders: ColliderQuery;
  events: EventBus;
  table: EnemyTable;
  /** ADR-0008 multipliers, read at spawn (HP) and per lurch. */
  difficulty: () => { enemyHp: number; enemyLurchInterval: number };
  seed?: string;
  /** Other bodies enemies must not walk through (squadmates): immovable for enemies. */
  obstacles?: () => Iterable<{ x: number; z: number; r: number }>;
}

/** Corpses kept before the oldest is removed (ADR-0007: 16). */
export const MAX_CORPSES = 16;
const PLAYER_RADIUS = 0.35;
/** Hero tier body (data/body-models.json): the necromorph slasher. If it fails to load the sculpted procedural hero is used. */
const HERO_MODEL = 'necromorph';

const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();

export class EnemyDirector implements EnemyHost {
  readonly group = new THREE.Group();
  readonly list: Enemy[] = [];
  readonly targets: EnemyTarget[] = [];
  readonly nav: Navigator;
  readonly colliders: ColliderQuery;
  readonly rng: Rng;
  navEpoch = 0;
  grabber: Enemy | null = null;
  /** Debug: stop thinking and moving (bodies still animate). */
  frozen = false;
  /** Debug: enemies ignore the player (sight, sound and wake checks). */
  ignorePlayer = false;
  spawner: Spawner;
  private readonly d: EnemyDirectorDeps;
  private counter = 0;
  private combatStarted = false;
  private readonly sep: SepBody[] = [];
  private readonly sepOwner: Array<Enemy | null> = [];
  private readonly offs: Array<() => void> = [];
  private readonly allTargets: EnemyTarget[] = [];

  constructor(deps: EnemyDirectorDeps) {
    this.d = deps;
    this.nav = deps.nav;
    this.colliders = deps.colliders;
    this.rng = new Rng(deps.seed ?? 'enemies');
    this.group.name = 'enemies';
    this.spawner = new Spawner([]);
    // Doors change the graph: everyone repaths (ADR-0007).
    this.offs.push(deps.events.on('door:state' as never, (() => this.navEpoch++) as never));
  }

  get lurchScale(): number {
    return this.d.difficulty().enemyLurchInterval;
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  /** True once any enemy has engaged a target this session. */
  get inCombat(): boolean {
    return this.list.some((e) => e.engaged);
  }

  // ---------------------------------------------------------------- setup

  addTarget(t: EnemyTarget): () => void {
    this.allTargets.push(t);
    this.syncTargets();
    return () => {
      const i = this.allTargets.indexOf(t);
      if (i >= 0) this.allTargets.splice(i, 1);
      this.syncTargets();
    };
  }

  /** Level spawn points (ADR-0003 `rooms[].spawns`). Points with `on` trigger when that event fires. */
  setSpawns(points: readonly SpawnPointData[]): void {
    for (const off of this.offs.splice(1)) off();
    this.spawner = new Spawner(points);
    for (const t of this.spawner.triggers()) {
      this.offs.push(this.d.events.on(t.event as never, (() => this.spawner.triggerPoint(t.point.id)) as never));
    }
  }

  /** New game or checkpoint restart: remove everyone and queue the level-start spawns again. */
  reset(clearedGroups: ReadonlySet<string> = new Set()): void {
    this.clear();
    this.combatStarted = false;
    this.spawner.reset(clearedGroups);
  }

  /** Remove every enemy and anything queued (back to the title). */
  clear(): void {
    if (this.grabber) this.grabber.target?.releaseGrab?.();
    this.grabber = null;
    for (const e of this.list) e.dispose();
    this.list.length = 0;
    this.spawner.clear();
  }

  /** Sequence action `spawnGroup` (ADR-0009). False if unknown or already triggered. */
  spawnGroup(group: string): boolean {
    return this.spawner.trigger(group);
  }

  /** Has this group been cleared (every enemy it spawned dead)? */
  groupCleared(group: string): boolean {
    return this.spawner.isCleared(group);
  }

  /** Sequence action `despawnGroup`: drop queued spawns and remove the group's enemies at once. */
  despawnGroup(group: string): boolean {
    if (!this.spawner.groupIds().includes(group)) return false;
    this.spawner.cancel(group);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]!;
      if (e.group !== group) continue;
      if (this.grabber === e) this.onGrabEnd(e, 'cleared');
      e.dispose();
      this.list.splice(i, 1);
    }
    return true;
  }

  /** Spawn one enemy now (debug, scripts). Feet position. */
  spawn(variant: EnemyVariantId, pos: P3, yaw = 0, opts: { group?: string | null; outfit?: string; infection?: number; start?: 'stand' | 'playDead' | 'emerge'; id?: string; model?: string | null } = {}): Enemy {
    const table = this.d.table;
    const tuning = table[variant];
    const id = opts.id ?? `${variant}-${++this.counter}`;
    const rng = this.rng.fork(id);
    const hero = variant === 'hero';
    const outfit: Outfit = (OUTFITS as readonly string[]).includes(opts.outfit ?? '') ? (opts.outfit as Outfit) : hero ? 'lab' : rng.pick(['crew', 'lab', 'security', 'medic', 'engineer'] as const);
    const spec: HumanoidSpec = {
      seed: id,
      outfit,
      role: 'enemy',
      infection: opts.infection ?? (hero ? 2 : rng.range(1.2, 3)),
      baseHp: tuning.baseHp * this.d.difficulty().enemyHp,
      ...(hero ? { hero: true, height: 2.15, build: 1.25, pose: 'hulk' } : {}),
    };
    // Imported bodies for the crowd only (ADR-0026). Own rng fork, so procedural spawns stay as they were.
    const model = opts.model !== undefined ? opts.model : hero ? (this.d.ctx.bodyModels?.get(HERO_MODEL) ? HERO_MODEL : null) : (this.d.ctx.bodyModels?.pick(variant, rng.fork('model')) ?? null);
    if (model) spec.model = model;
    const start = opts.start ?? (variant === 'playDead' ? 'playDead' : 'stand');
    const e = new Enemy({ id, variant, tuning, group: opts.group ?? null, pos, yaw, spec, start }, this.d.ctx, rng, (this.list.length * 0.037) % 0.2);
    this.list.push(e);
    this.group.add(e.body.group);
    if (start === 'emerge') {
      // Out of a vent or through the ceiling: it comes out already hunting the player.
      const p = this.targets.find((t) => t.kind === 'player');
      if (p) {
        p.feet(tmpV);
        e.memory.sense(tmpV, 'sound', p.id);
        e.target = p;
      }
    }
    this.d.events.emit('enemy:spawned', { id, variant, group: e.group, x: pos.x, y: pos.y, z: pos.z });
    return e;
  }

  // ---------------------------------------------------------------- per step

  update(dt: number, cameraPos: THREE.Vector3 | null): void {
    this.syncTargets();
    this.spawner.update(dt, this.aliveCount, (r) => this.spawnFrom(r));
    if (this.frozen) {
      for (const e of this.list) e.body.update(dt, cameraPos);
      return;
    }
    for (const e of this.list) e.step(dt, this);
    // Separation after steering, before level collision (ADR-0018).
    const sep = this.sep;
    const owner = this.sepOwner;
    this.sepN = 0;
    for (const e of this.list) {
      const fp = e.body.footprint;
      this.put(e.planned.x, e.planned.z, fp.r, e.mobile ? fp.mass : Infinity, e.mobile ? e : null);
    }
    for (const t of this.targets) {
      if (t.kind !== 'player' || !t.alive()) continue;
      t.feet(tmpV);
      this.put(tmpV.x, tmpV.z, PLAYER_RADIUS, Infinity, null);
    }
    if (this.d.obstacles) for (const o of this.d.obstacles()) this.put(o.x, o.z, o.r, Infinity, null);
    const n = this.sepN;
    sep.length = n;
    owner.length = n;
    if (n > 1) separate(sep);
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i]!;
      const b = sep[i]!;
      e.commit(dt, b.x, b.z, cameraPos, this);
    }
    this.fadeCorpses();
  }

  private sepN = 0;
  private put(x: number, z: number, r: number, mass: number, e: Enemy | null): void {
    let b = this.sep[this.sepN];
    if (!b) {
      b = { x: 0, z: 0, r: 0, mass: 1 };
      this.sep[this.sepN] = b;
    }
    b.x = x;
    b.z = z;
    b.r = r;
    b.mass = mass;
    this.sepOwner[this.sepN] = e;
    this.sepN++;
  }

  // ---------------------------------------------------------------- noise and hits

  /** A sound at a point (ADR-0007 hearing): gunshots 25 m, impacts 8 m, footsteps 4 m (sprint 8 m). */
  noise(kind: NoiseKind, at: P3, source: string | null): void {
    if (source === 'player' && this.ignorePlayer) return;
    const radius = PERCEPTION.hear[kind];
    for (const e of this.list) {
      if (!e.alive || e.state === 'playDead') {
        // A gunshot right beside a play-dead wakes it.
        if (e.state === 'playDead' && kind === 'gunshot' && Math.hypot(e.motor.x - at.x, e.motor.z - at.z) < 2.5) e.wake();
        continue;
      }
      if (Math.hypot(e.motor.x - at.x, e.motor.z - at.z) > radius) continue;
      // Already chasing what it can see: nothing new.
      if (e.memory.age < 0.5) continue;
      if (!hears(kind, at, e.motor, (a, b) => this.nav.direct(a, b, 0), (a, b) => routeLength(this.nav, a, b))) continue;
      e.sense(at, 'sound', source, this);
    }
  }

  /** Nearest enemy body hit along a ray (normalised `dir`), within `maxDist`. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = Infinity): BodyHit | null {
    let best: BodyHit | null = null;
    for (const e of this.list) {
      const hit = e.body.raycast(origin, dir, best ? best.distance : maxDist);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  /** The enemy that owns a body hit. */
  enemyOf(hit: BodyHit): Enemy | null {
    return this.list.find((e) => e.body === hit.humanoid) ?? null;
  }

  /** Apply weapon damage (player or squad) to the hit body: gore, severing, stagger, waking, alerting. */
  applyHit(hit: BodyHit, amount: number, dir: THREE.Vector3, by: string): HitResult | null {
    const e = this.enemyOf(hit);
    if (!e || !e.alive) {
      // Shooting a corpse still makes it bleed.
      return hit.humanoid.applyHit(hit, amount, dir);
    }
    const result = hit.humanoid.applyHit(hit, amount, dir);
    const shooter = this.targets.find((t) => t.id === by) ?? null;
    if (shooter) shooter.feet(tmpW);
    e.onDamaged(result.applied, shooter ? tmpW : null, shooter ? by : null, this);
    if (result.newLimb && !result.killed) e.stagger(e.tuning.stagger, this);
    this.d.events.emit('enemy:hit', { id: e.id, region: result.region, amount: result.applied, severed: result.severed, killed: result.killed, weakSpot: result.weakSpot, by });
    return result;
  }

  /**
   * The player fired (`weapon:fired`): hitscan against the level and enemy bodies (ADR-0005), a
   * shotgun blast of 3+ pellets knocks a body back, and the shot is heard 25 m away.
   */
  playerShot(weapon: 'pistol' | 'shotgun', origin: THREE.Vector3, view: THREE.Vector3, aimBlend: number, random: () => number = Math.random): ShotReport {
    const spec = WEAPON_HITS[weapon];
    const report = fireShot(spec, origin, view, aimBlend, this.colliders, this, random, 'player');
    for (const [body, pellets] of report.perBody) {
      if (pellets < spec.staggerPellets) continue;
      const e = this.list.find((x) => x.body === body);
      if (e?.alive) this.staggerEnemy(e, e.hero ? 0.3 : e.tuning.stagger, view.x, view.z, e.hero ? 0 : 0.25);
    }
    this.noise('gunshot', origin, 'player');
    return report;
  }

  /** Stagger an enemy (shotgun blast, shove), optionally pushing it `push` m along (dx, dz). */
  staggerEnemy(e: Enemy, seconds: number, dx = 0, dz = 0, push = 0): void {
    e.stagger(seconds, this);
    if (push > 0) e.push(dx * push, dz * push, this);
  }

  /** Player shove (ADR-0004 `player:shove`): enemies in the cone are pushed, staggered and hurt a little. */
  shove(origin: readonly number[], dir: readonly number[], range: number, coneDeg: number, damage: number, push: number): number {
    const cos = Math.cos(((coneDeg / 2) * Math.PI) / 180);
    const dl = Math.hypot(dir[0]!, dir[2]!) || 1;
    const fx = dir[0]! / dl;
    const fz = dir[2]! / dl;
    let n = 0;
    for (const e of this.list) {
      if (!e.mobile) continue;
      const dx = e.motor.x - origin[0]!;
      const dz = e.motor.z - origin[2]!;
      const d = Math.hypot(dx, dz);
      if (d > range + e.body.footprint.r || (d > 0.3 && (dx * fx + dz * fz) / d < cos)) continue;
      // Heroes barely budge (ADR-0018 masses).
      const k = 1 / e.body.footprint.mass;
      e.body.hurt('torso', damage);
      this.staggerEnemy(e, e.tuning.stagger * (e.hero ? 0.4 : 1), fx, fz, push * 0.4 * k);
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- EnemyHost

  blocked(a: P3, b: P3): boolean {
    return segmentHit(this.colliders, a.x, a.y, a.z, b.x, b.y, b.z) !== null;
  }

  onAlert(e: Enemy, source: SenseSource): void {
    const at = e.memory.last;
    this.d.events.emit('enemy:alerted', { id: e.id, target: e.memory.targetId, source, x: e.motor.x, y: e.motor.y, z: e.motor.z });
    if (!this.combatStarted && e.memory.targetId !== null) {
      this.combatStarted = true;
      this.d.events.emit('combat:first', {});
    }
    // Alert spreads to dormant enemies within 6 m (ADR-0007).
    if (source === 'ally') return;
    for (const o of this.list) {
      if (o === e || !o.alive || (o.state !== 'dormant' && o.state !== 'search')) continue;
      if (Math.hypot(o.motor.x - e.motor.x, o.motor.z - e.motor.z) > PERCEPTION.share) continue;
      o.sense(at, 'ally', e.memory.targetId, this);
    }
  }

  onAttack(e: Enemy, target: EnemyTarget, kind: AttackKind, amount: number): void {
    this.d.events.emit('enemy:attack', { id: e.id, target: target.id, kind, amount });
  }

  onGrab(e: Enemy): void {
    this.d.events.emit('enemy:grab', { id: e.id, target: e.target?.id ?? 'player' });
  }

  onGrabEnd(e: Enemy, reason: 'escaped' | 'shot' | 'died' | 'cleared'): void {
    if (this.grabber === e) this.grabber = null;
    this.d.events.emit('enemy:grabReleased', { id: e.id, reason });
  }

  onDied(e: Enemy): void {
    this.d.events.emit('enemy:died', { id: e.id, variant: e.variant, group: e.group, x: e.motor.x, y: e.motor.y, z: e.motor.z, by: null });
    if (e.group && this.spawner.died(e.group)) {
      this.d.events.emit('group:cleared', { group: e.group });
      // Name-qualified copy, so a sequence can `waitFor` one particular group.
      (this.d.events.emit as (n: string, p: unknown) => void)(`group:cleared:${e.group}`, { group: e.group });
    }
  }

  /** Hero slam landed: falloff damage and knockback to every target, and crowd bodies stagger (ADR-0021). */
  onSlam(e: Enemy, at: THREE.Vector3): void {
    this.d.events.emit('enemy:slam', { id: e.id, x: at.x, y: at.y, z: at.z });
    const knock = e.tuning.knockback ?? 0;
    for (const t of this.targets) {
      if (!t.alive()) continue;
      t.feet(tmpV);
      const dx = tmpV.x - at.x;
      const dz = tmpV.z - at.z;
      const d = Math.hypot(dx, dz);
      const f = slamFalloff(d);
      if (f <= 0) continue;
      const amount = SLAM.damage * f;
      tmpW.set(at.x, at.y + 1, at.z);
      t.hurt(amount, tmpW, 'slam');
      this.onAttack(e, t, 'slam', amount);
      if (knock > 0 && t.knock) {
        const nx = d > 1e-3 ? dx / d : -Math.sin(e.body.heading);
        const nz = d > 1e-3 ? dz / d : -Math.cos(e.body.heading);
        t.knock(nx, nz, knock * f);
      }
    }
    for (const o of this.list) {
      if (o === e || !o.mobile || o.hero) continue;
      const dx = o.motor.x - at.x;
      const dz = o.motor.z - at.z;
      const d = Math.hypot(dx, dz);
      const f = slamFalloff(d);
      if (f <= 0) continue;
      this.staggerEnemy(o, 0.6, d > 1e-3 ? dx / d : 0, d > 1e-3 ? dz / d : 0, 0.5 * f);
    }
  }

  // ---------------------------------------------------------------- internals

  /** The working target list: what is registered, minus the player when debug says ignore. */
  private syncTargets(): void {
    this.targets.length = 0;
    for (const t of this.allTargets) if (!(this.ignorePlayer && t.kind === 'player')) this.targets.push(t);
  }

  private spawnFrom(r: SpawnRequest): void {
    const p = r.point;
    // Several enemies from one point come out a little apart.
    const off = r.index === 0 ? 0 : 0.35;
    const a = r.index * 2.4;
    const pos = { x: p.pos[0] + Math.sin(a) * off, y: p.pos[1], z: p.pos[2] + Math.cos(a) * off };
    const start = r.variant === 'playDead' ? 'playDead' : p.kind === 'vent' || p.kind === 'ceiling' ? 'emerge' : 'stand';
    const opts: Parameters<EnemyDirector['spawn']>[3] = { group: r.group, start, id: r.index === 0 ? p.id : `${p.id}.${r.index}` };
    if (p.outfit !== undefined) opts.outfit = p.outfit;
    if (p.infection !== undefined) opts.infection = p.infection;
    const e = this.spawn(r.variant, pos, ((p.yaw ?? 0) * Math.PI) / 180, opts);
    // Door and vent spawns arrive hunting; floor and corpse spawns wait to notice someone.
    if (p.kind === 'door' && e.state === 'dormant') {
      const pl = this.targets.find((t) => t.kind === 'player');
      if (pl) e.sense(pl.feet(tmpV), 'sound', pl.id, this);
    }
  }

  /** Keep at most MAX_CORPSES dead bodies: the oldest go first (ADR-0007). */
  private fadeCorpses(): void {
    let dead = 0;
    for (const e of this.list) if (!e.alive) dead++;
    while (dead > MAX_CORPSES) {
      let oldest = -1;
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i]!;
        if (!e.alive && (oldest < 0 || e.deadFor > this.list[oldest]!.deadFor)) oldest = i;
      }
      if (oldest < 0) break;
      this.list[oldest]!.dispose();
      this.list.splice(oldest, 1);
      dead--;
    }
  }

  /** Counts per state (debug HUD). */
  stateCounts(): Partial<Record<EnemyState, number>> {
    const out: Partial<Record<EnemyState, number>> = {};
    for (const e of this.list) out[e.state] = (out[e.state] ?? 0) + 1;
    return out;
  }

  dispose(): void {
    this.clear();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}

/** Walking route length a -> b through the navgraph (open doors only), or Infinity. */
export function routeLength(nav: Navigator, a: P3, b: P3): number {
  const path = nav.findPath(a, b, { radius: 0 });
  if (!path) return Infinity;
  let len = 0;
  let px = a.x;
  let pz = a.z;
  for (const p of path) {
    len += Math.hypot(p.x - px, p.z - pz);
    px = p.x;
    pz = p.z;
  }
  return len;
}
