/**
 * Standing water (standing-water spec, overhaul-flooded-tunnel D1): one body per room that has a `water` block. It owns
 * the water's level (and its scripted rise or fall), the room's footprint, and the depth query that movement, audio,
 * splashes, gore and the water renderer all read, so they can never disagree about where the surface is.
 */

/** One 4 m grid cell of the footprint, in world metres. */
export interface WaterCell {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WaterBodyInit {
  room: string;
  /** Surface height (world y, m). */
  level: number;
  /** Bottom of the water (world y, m): the room's sunken floor. */
  floor: number;
  cells: readonly WaterCell[];
}

/** One push on the surface (standing-water spec: the water ripples from what disturbs it). */
export interface WaterStamp {
  x: number;
  z: number;
  /** Radius of the push (m). */
  radius: number;
  /** Height pushed (m): negative pushes the surface down (a foot, a body), positive lifts it. */
  strength: number;
}

/** How far (m) the water stops short of a wall edge of its footprint (walls are 0.25 m thick, inward). */
export const WALL_INSET = 0.2;

/** Stamps kept per body between frames; the ripple simulation takes them all each step. */
export const MAX_STAMPS = 64;

/** A smooth start and stop for scripted level changes. */
const ease = (u: number): number => u * u * (3 - 2 * u);

export class WaterBody {
  readonly room: string;
  readonly floor: number;
  readonly cells: readonly WaterCell[];
  /** World-space bounding box of the footprint (the ripple simulation and murk cover this). */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private current: number;
  private from: number;
  private target: number;
  private duration = 0;
  /** Disturbances since the simulation last took them (oldest dropped past MAX_STAMPS). */
  readonly pending: WaterStamp[] = [];
  /** A whole-surface shudder (hull groans) still to apply, 0..1. */
  shudder = 0;
  private elapsed = 0;

  constructor(init: WaterBodyInit) {
    this.room = init.room;
    this.floor = init.floor;
    this.cells = init.cells;
    this.current = this.from = this.target = init.level;
    this.bounds = {
      minX: Math.min(...init.cells.map((c) => c.minX)),
      maxX: Math.max(...init.cells.map((c) => c.maxX)),
      minZ: Math.min(...init.cells.map((c) => c.minZ)),
      maxZ: Math.max(...init.cells.map((c) => c.maxZ)),
    };
  }

  /** Current surface height (world y). */
  get level(): number {
    return this.current;
  }

  /** The level a running change is heading for (the current level when none runs). */
  get targetLevel(): number {
    return this.target;
  }

  /** Is a scripted rise or fall still running? */
  get changing(): boolean {
    return this.elapsed < this.duration;
  }

  /** Move the surface to `level`, at once (`seconds` 0) or smoothly over `seconds`. */
  setLevel(level: number, seconds = 0): void {
    if (seconds <= 0) {
      this.current = this.from = this.target = level;
      this.duration = this.elapsed = 0;
      return;
    }
    this.from = this.current;
    this.target = level;
    this.duration = seconds;
    this.elapsed = 0;
  }

  update(dt: number): void {
    if (!this.changing) return;
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    this.current = this.from + (this.target - this.from) * ease(this.elapsed / this.duration);
  }

  /** Push the surface at (x, z). Ignored outside the footprint. */
  disturb(x: number, z: number, radius: number, strength: number): void {
    if (!this.contains(x, z)) return;
    if (this.pending.length >= MAX_STAMPS) this.pending.shift();
    this.pending.push({ x, z, radius, strength });
  }

  /** Take (and clear) the pending disturbances. */
  takeStamps(): WaterStamp[] {
    return this.pending.splice(0);
  }

  /**
   * The footprint cells pulled in by `inset` m on every side that is not shared with another water cell: the water
   * stops inside the walls, so neither its surface nor its murk shows on the far side of a wall or partition that
   * belongs to this room (R10 looking at the overlook's frame). The room's own wall faces (0.25 m in) stay inside.
   */
  interior(inset = WALL_INSET): WaterCell[] {
    const shares = (c: WaterCell, side: 'minX' | 'maxX' | 'minZ' | 'maxZ'): boolean =>
      this.cells.some((o) => {
        if (o === c) return false;
        if (side === 'minX') return o.maxX === c.minX && o.minZ < c.maxZ && o.maxZ > c.minZ;
        if (side === 'maxX') return o.minX === c.maxX && o.minZ < c.maxZ && o.maxZ > c.minZ;
        if (side === 'minZ') return o.maxZ === c.minZ && o.minX < c.maxX && o.maxX > c.minX;
        return o.minZ === c.maxZ && o.minX < c.maxX && o.maxX > c.minX;
      });
    return this.cells.map((c) => ({
      minX: c.minX + (shares(c, 'minX') ? 0 : inset),
      maxX: c.maxX - (shares(c, 'maxX') ? 0 : inset),
      minZ: c.minZ + (shares(c, 'minZ') ? 0 : inset),
      maxZ: c.maxZ - (shares(c, 'maxZ') ? 0 : inset),
    }));
  }

  /** Is (x, z) over this water's footprint? */
  contains(x: number, z: number): boolean {
    for (const c of this.cells) if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
    return false;
  }

  /**
   * How deep (m) a body whose feet are at `feetY` stands in this water at (x, z): 0 when dry, outside the footprint, or
   * standing on something that reaches above the surface (a landing, a step, the top of a case).
   */
  depthAt(x: number, feetY: number, z: number): number {
    if (!this.contains(x, z)) return 0;
    return Math.max(0, this.current - feetY);
  }
}

/** Every water body of a level, with the lookups the rest of the game uses. */
export class WaterBodies {
  private readonly list: WaterBody[] = [];
  private readonly byRoom = new Map<string, WaterBody>();

  add(body: WaterBody): void {
    this.list.push(body);
    this.byRoom.set(body.room, body);
  }

  all(): readonly WaterBody[] {
    return this.list;
  }

  room(id: string): WaterBody | null {
    return this.byRoom.get(id) ?? null;
  }

  /** The water whose footprint is under (x, z), if any. */
  at(x: number, z: number): WaterBody | null {
    for (const b of this.list) if (b.contains(x, z)) return b;
    return null;
  }

  /** Depth of water at a body's feet (0 when dry). */
  depthAt(x: number, feetY: number, z: number): number {
    return this.at(x, z)?.depthAt(x, feetY, z) ?? 0;
  }

  update(dt: number): void {
    for (const b of this.list) b.update(dt);
  }

  /** Current levels by room, for checkpoint saves. */
  levels(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.list) out[b.room] = b.targetLevel;
    return out;
  }
}
