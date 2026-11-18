import type { LevelData } from '../data/types/level.ts';
import type { EnemyVariantId } from './enemyData.ts';

/**
 * Spawn bookkeeping (ADR-0007 "Spawning and limits"). Pure, no three.js.
 *
 * Spawn points come from level data (`rooms[].spawns`). A point spawns `count` enemies (default 1),
 * `interval` seconds apart. Points without `active: false` spawn when the level starts; the rest wait
 * for their `group` to be triggered (the `spawnGroup` sequence action, or the point's `on` event).
 * At most `maxActive` enemies are alive at once (ADR-0015: 8); further spawns wait in a queue and come
 * in as others die (R11: 14 in all, 8 at a time). A group is cleared once it has been triggered,
 * nothing of it is still queued and every enemy it spawned is dead.
 */

export interface SpawnPointData {
  id: string;
  pos: readonly [number, number, number];
  kind: string;
  group?: string | undefined;
  active?: boolean | undefined;
  variant?: EnemyVariantId | undefined;
  count?: number | undefined;
  interval?: number | undefined;
  yaw?: number | undefined;
  outfit?: string | undefined;
  infection?: number | undefined;
  on?: string | undefined;
}

export interface SpawnRequest {
  point: SpawnPointData;
  /** 0-based index of this enemy among the point's `count`. */
  index: number;
  group: string | null;
  variant: EnemyVariantId;
}

interface QueueEntry {
  point: SpawnPointData;
  next: number;
  done: number;
  total: number;
}

interface GroupState {
  triggered: boolean;
  queued: number;
  alive: number;
  cleared: boolean;
}

export const DEFAULT_MAX_ACTIVE = 8;
/** Seconds between enemies from one point when `interval` is not given. */
export const DEFAULT_INTERVAL = 1.5;

/** Variant for a point: explicit, or a play-dead for `corpse` spawns, else a shambler. */
export function variantOf(p: SpawnPointData): EnemyVariantId {
  return p.variant ?? (p.kind === 'corpse' ? 'playDead' : 'shambler');
}

export class Spawner {
  maxActive: number;
  private readonly points: SpawnPointData[];
  private readonly queue: QueueEntry[] = [];
  private readonly groups = new Map<string, GroupState>();
  private time = 0;

  constructor(points: readonly SpawnPointData[], maxActive = DEFAULT_MAX_ACTIVE) {
    this.points = [...points];
    this.maxActive = maxActive;
    for (const p of points) if (p.group) this.group(p.group);
  }

  /** Point ids and the events that trigger their groups (`on`). */
  triggers(): Array<{ event: string; group: string | null; point: SpawnPointData }> {
    return this.points.filter((p) => p.on).map((p) => ({ event: p.on!, group: p.group ?? null, point: p }));
  }

  /** Every group name the level defines. */
  groupIds(): string[] {
    return [...this.groups.keys()];
  }

  /** Fresh start (new game, checkpoint restart): queue the level-start spawns. `skipGroups` were already cleared. */
  reset(skipGroups: ReadonlySet<string> = new Set()): void {
    this.queue.length = 0;
    this.time = 0;
    for (const [id, g] of this.groups) {
      g.triggered = false;
      g.queued = 0;
      g.alive = 0;
      g.cleared = skipGroups.has(id);
      if (g.cleared) g.triggered = true;
    }
    for (const p of this.points) {
      if (p.active === false) continue;
      if (p.group && this.groups.get(p.group)?.cleared) continue;
      if (p.group) this.groups.get(p.group)!.triggered = true;
      this.enqueue(p);
    }
  }

  /** Remove everything queued and forget group progress (back to the title). */
  clear(): void {
    this.queue.length = 0;
    for (const g of this.groups.values()) Object.assign(g, { triggered: false, queued: 0, alive: 0, cleared: false });
  }

  /** Trigger a group: queue its inactive points. False if the group is unknown or already triggered. */
  trigger(group: string): boolean {
    const g = this.groups.get(group);
    if (!g || g.triggered) return false;
    g.triggered = true;
    for (const p of this.points) if (p.group === group && p.active === false) this.enqueue(p);
    return true;
  }

  /** Trigger one point outside a group (its `on` event fired). */
  triggerPoint(id: string): boolean {
    const p = this.points.find((x) => x.id === id);
    if (!p || this.queue.some((q) => q.point === p)) return false;
    if (p.group) return this.trigger(p.group);
    this.enqueue(p);
    return true;
  }

  /** Drop a group's queued spawns. The caller removes its live enemies. */
  cancel(group: string): void {
    const g = this.groups.get(group);
    if (!g) return;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.point.group === group) this.queue.splice(i, 1);
    }
    g.queued = 0;
    g.alive = 0;
    g.triggered = true;
    g.cleared = true;
  }

  isCleared(group: string): boolean {
    return this.groups.get(group)?.cleared ?? false;
  }

  /** Enemies of a group still to come (queued, not yet spawned). */
  pending(group?: string): number {
    if (group !== undefined) return this.groups.get(group)?.queued ?? 0;
    return this.queue.reduce((n, q) => n + q.total - q.done, 0);
  }

  /**
   * Advance time and spawn what the cap allows, round-robin across points so two entrances feed in
   * together. `alive` is the number of live enemies now; `spawn` creates one.
   */
  update(dt: number, alive: number, spawn: (r: SpawnRequest) => void): void {
    this.time += dt;
    let active = alive;
    // One spawn per point per step: each point then waits its interval before the next.
    {
      for (let i = 0; i < this.queue.length && active < this.maxActive; i++) {
        const q = this.queue[i]!;
        if (q.next > this.time) continue;
        const group = q.point.group ?? null;
        const index = q.done++;
        q.next = this.time + (q.point.interval ?? DEFAULT_INTERVAL);
        if (group) {
          const g = this.groups.get(group)!;
          g.queued--;
          g.alive++;
        }
        active++;
        spawn({ point: q.point, index, group, variant: variantOf(q.point) });
        if (q.done >= q.total) {
          this.queue.splice(i, 1);
          i--;
        }
      }
    }
  }

  /** An enemy of `group` died. Returns true when that cleared the group (report once). */
  died(group: string | null): boolean {
    if (!group) return false;
    const g = this.groups.get(group);
    if (!g || g.cleared) return false;
    g.alive = Math.max(0, g.alive - 1);
    if (g.triggered && g.queued === 0 && g.alive === 0) {
      g.cleared = true;
      return true;
    }
    return false;
  }

  /** An enemy was added outside the queue (debug spawn) but belongs to `group`. */
  adopt(group: string): void {
    this.group(group).alive++;
  }

  private group(id: string): GroupState {
    let g = this.groups.get(id);
    if (!g) {
      g = { triggered: false, queued: 0, alive: 0, cleared: false };
      this.groups.set(id, g);
    }
    return g;
  }

  private enqueue(p: SpawnPointData): void {
    const total = Math.max(1, Math.round(p.count ?? 1));
    this.queue.push({ point: p, next: this.time, done: 0, total });
    if (p.group) this.group(p.group).queued += total;
  }
}

/** Every enemy spawn point of a level (ADR-0003 `rooms[].spawns`). */
export function spawnPointsOf(data: LevelData): SpawnPointData[] {
  const out: SpawnPointData[] = [];
  for (const room of data.rooms) for (const s of room.spawns ?? []) out.push({ ...s, pos: [s.pos[0], s.pos[1], s.pos[2]] });
  return out;
}
