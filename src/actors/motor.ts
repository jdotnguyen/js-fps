/**
 * Capsule character motor (ADR-0004), approximated as a vertical cylinder against
 * axis-aligned boxes in the ADR-0003 collider shape. Pure math, no Three.js, so it
 * runs in unit tests.
 *
 * Horizontal: the footprint circle is pushed out of every box that overlaps the body
 * above step height. Pushing out from the closest point on a box rounds its corners,
 * so the player slides past door frames instead of snagging on them.
 * Vertical: the highest box top under the footprint that is within step height becomes
 * the floor. Walking onto it is a step up, walking off it snaps down.
 *
 * When ADR-0003's spatial hash lands it only has to implement `ColliderQuery`.
 */

/** ADR-0003 collider: `{ min:[x,y,z], max:[x,y,z] }`, world space. */
export interface Aabb {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface ColliderQuery {
  /** Append every box whose XZ footprint overlaps the rectangle to `out`; return `out`. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[];
}

/** Linear scan. Fine for a room or two; replaced by the ADR-0003 spatial hash. */
export class BoxColliders implements ColliderQuery {
  readonly boxes: Aabb[];

  constructor(boxes: Aabb[]) {
    this.boxes = boxes;
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[] {
    for (const b of this.boxes) {
      if (b.max[0] < minX || b.min[0] > maxX || b.max[2] < minZ || b.min[2] > maxZ) continue;
      out.push(b);
    }
    return out;
  }
}

export interface MotorConfig {
  radius: number;
  height: number;
  /** Highest ledge the body walks up without help. */
  stepHeight: number;
  /** Highest drop that keeps the body glued to the floor instead of falling. */
  snapDown: number;
  gravity: number;
}

export const DEFAULT_MOTOR: Readonly<MotorConfig> = Object.freeze({
  radius: 0.35,
  height: 1.75,
  stepHeight: 0.35,
  snapDown: 0.4,
  gravity: 20,
});

/** Feet position (x, y = soles, z) plus vertical state. Mutated in place. */
export interface MotorState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
}

export interface MoveResult {
  /** True if any wall pushed the body this move. */
  blocked: boolean;
  /** Height gained by stepping up (> 0) this move; drives camera step smoothing. */
  stepUp: number;
}

const SKIN = 1e-4;
const ITERATIONS = 4;
/** The floor probe uses a smaller circle so the body does not hover on a box edge. */
const FLOOR_PROBE = 0.6;
const LOWEST_Y = -50;

const scratch: Aabb[] = [];

/**
 * Move by (dx, dz) metres this step, then settle vertically. `dt` is only used for
 * gravity while airborne.
 */
export function moveBody(s: MotorState, dx: number, dz: number, dt: number, cfg: MotorConfig, world: ColliderQuery): MoveResult {
  const result: MoveResult = { blocked: false, stepUp: 0 };
  const dist = Math.hypot(dx, dz);
  // Sub-step so a fast move can never tunnel through a thin wall.
  const n = Math.max(1, Math.ceil(dist / (cfg.radius * 0.5)));
  for (let i = 0; i < n; i++) {
    s.x += dx / n;
    s.z += dz / n;
    if (resolveHorizontal(s, cfg, world)) result.blocked = true;
  }
  result.stepUp = settleVertical(s, dt, cfg, world);
  return result;
}

/** Push the footprint out of walls. Returns true if anything pushed. */
export function resolveHorizontal(s: MotorState, cfg: MotorConfig, world: ColliderQuery): boolean {
  const r = cfg.radius;
  let pushed = false;
  for (let it = 0; it < ITERATIONS; it++) {
    scratch.length = 0;
    const boxes = world.query(s.x - r, s.z - r, s.x + r, s.z + r, scratch);
    let moved = false;
    for (const b of boxes) {
      if (!blocksBody(b, s.y, cfg)) continue;
      const cx = clamp(s.x, b.min[0], b.max[0]);
      const cz = clamp(s.z, b.min[2], b.max[2]);
      const ex = s.x - cx;
      const ez = s.z - cz;
      const d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        const push = r - d + SKIN;
        s.x += (ex / d) * push;
        s.z += (ez / d) * push;
      } else {
        // Centre inside the box: leave by the shallowest side.
        const left = s.x - b.min[0];
        const right = b.max[0] - s.x;
        const back = s.z - b.min[2];
        const front = b.max[2] - s.z;
        const m = Math.min(left, right, back, front);
        if (m === left) s.x = b.min[0] - r - SKIN;
        else if (m === right) s.x = b.max[0] + r + SKIN;
        else if (m === back) s.z = b.min[2] - r - SKIN;
        else s.z = b.max[2] + r + SKIN;
      }
      moved = true;
      pushed = true;
    }
    if (!moved) break;
  }
  return pushed;
}

/** Highest walkable top under the footprint at or below `maxTop`, or -Infinity. */
export function floorHeight(x: number, z: number, maxTop: number, cfg: MotorConfig, world: ColliderQuery): number {
  const r = cfg.radius * FLOOR_PROBE;
  scratch.length = 0;
  const boxes = world.query(x - r, z - r, x + r, z + r, scratch);
  let best = -Infinity;
  for (const b of boxes) {
    const top = b.max[1];
    if (top > maxTop || top <= best) continue;
    const cx = clamp(x, b.min[0], b.max[0]);
    const cz = clamp(z, b.min[2], b.max[2]);
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) best = top;
  }
  return best;
}

function settleVertical(s: MotorState, dt: number, cfg: MotorConfig, world: ColliderQuery): number {
  const ground = floorHeight(s.x, s.z, s.y + cfg.stepHeight + SKIN, cfg, world);
  if (s.grounded && ground >= s.y - cfg.snapDown) {
    const up = ground - s.y;
    s.y = ground;
    s.vy = 0;
    return Math.max(0, up);
  }
  s.vy -= cfg.gravity * dt;
  s.y += s.vy * dt;
  if (s.y <= ground) {
    s.y = ground;
    s.vy = 0;
    s.grounded = true;
  } else {
    s.grounded = false;
  }
  if (s.y < LOWEST_Y) {
    s.y = LOWEST_Y;
    s.vy = 0;
  }
  return 0;
}

/** A box blocks sideways movement when it overlaps the body above step height. */
function blocksBody(b: Aabb, feetY: number, cfg: MotorConfig): boolean {
  return b.max[1] > feetY + cfg.stepHeight + SKIN && b.min[1] < feetY + cfg.height;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
