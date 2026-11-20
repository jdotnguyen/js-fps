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

import { SIM_STEP } from '../core/loop.ts';

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
  /** Takeoff speed of a jump, m/s: apex height is about jumpSpeed^2 / (2 * gravity). */
  jumpSpeed: number;
  /**
   * Highest top a jump gets the body onto, metres above the takeoff floor (player-movement spec). While `jumping`
   * the body may climb `airStep(cfg)` above its feet instead of `stepHeight`, sized so the top of the arc reaches
   * exactly this.
   */
  jumpReach: number;
}

export const DEFAULT_MOTOR: Readonly<MotorConfig> = Object.freeze({
  radius: 0.35,
  height: 1.75,
  stepHeight: 0.35,
  snapDown: 0.4,
  gravity: 20,
  jumpSpeed: 5,
  jumpReach: 1,
});

/** Feet position (x, y = soles, z) plus vertical state. Mutated in place. */
export interface MotorState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  /** Set by the jumper with `vy` when a jump starts; the motor clears it on landing. Absent means false. */
  jumping?: boolean;
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
const headScratch: Aabb[] = [];

/**
 * Frames at the top of a jump during which the full `jumpReach` holds. A body only gets onto a top once its floor
 * probe is over it, which takes about 3 frames past the edge at walking speed, so the 2 apex frames alone would only
 * let a sprint reach it (jump-reach-1m design, Decision 1).
 */
export const REACH_FRAMES = 4;

const arcCache = new Map<string, { apex: number; hold: number }>();

/** Heights of a jump as the motor integrates it at the fixed step (semi-implicit Euler, as `settleVertical`). */
function jumpArc(jumpSpeed: number, gravity: number, step: number): { apex: number; hold: number } {
  const key = `${jumpSpeed}|${gravity}|${step}`;
  const hit = arcCache.get(key);
  if (hit) return hit;
  const heights: number[] = [];
  let vy = jumpSpeed;
  let y = 0;
  for (let i = 0; i < 10000; i++) {
    vy -= gravity * step;
    y += vy * step;
    if (y <= 0) break;
    heights.push(y);
  }
  heights.sort((a, b) => b - a);
  const arc = { apex: heights[0] ?? 0, hold: heights[Math.min(REACH_FRAMES, heights.length) - 1] ?? 0 };
  arcCache.set(key, arc);
  return arc;
}

/** Highest point of a jump at the fixed step. About 4 cm under the analytic jumpSpeed^2 / 2g at 60 Hz. */
export function jumpApex(jumpSpeed: number, gravity: number, step = SIM_STEP): number {
  return jumpArc(jumpSpeed, gravity, step).apex;
}

/** Height a jump keeps for its `REACH_FRAMES` highest frames at the fixed step. */
export function jumpHold(jumpSpeed: number, gravity: number, step = SIM_STEP): number {
  return jumpArc(jumpSpeed, gravity, step).hold;
}

/** How far above its feet a jumping body may climb: for the top `REACH_FRAMES` of the arc this reaches `jumpReach`. */
export function airStep(cfg: MotorConfig): number {
  return Math.max(cfg.stepHeight, cfg.jumpReach - jumpHold(cfg.jumpSpeed, cfg.gravity));
}

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
  const climb = climbLimit(s, cfg);
  let pushed = false;
  for (let it = 0; it < ITERATIONS; it++) {
    scratch.length = 0;
    const boxes = world.query(s.x - r, s.z - r, s.x + r, s.z + r, scratch);
    let moved = false;
    for (const b of boxes) {
      if (!blocksBody(b, s, climb, cfg, world)) continue;
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

/** Lowest underside between `fromY` and `toY` (the head's path this step) under the footprint, or Infinity. */
export function ceilingHeight(x: number, z: number, fromY: number, toY: number, cfg: MotorConfig, world: ColliderQuery): number {
  const r = cfg.radius * FLOOR_PROBE;
  scratch.length = 0;
  const boxes = world.query(x - r, z - r, x + r, z + r, scratch);
  let best = Infinity;
  for (const b of boxes) {
    const bottom = b.min[1];
    if (bottom < fromY || bottom > toY || bottom >= best) continue;
    const cx = clamp(x, b.min[0], b.max[0]);
    const cz = clamp(z, b.min[2], b.max[2]);
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) best = bottom;
  }
  return best;
}

function settleVertical(s: MotorState, dt: number, cfg: MotorConfig, world: ColliderQuery): number {
  const ground = standHeight(s, s.y + climbLimit(s, cfg) + SKIN, cfg, world);
  if (s.grounded && ground >= s.y - cfg.snapDown) {
    const up = ground - s.y;
    s.y = ground;
    s.vy = 0;
    if (s.jumping) s.jumping = false;
    return Math.max(0, up);
  }
  const feetBefore = s.y;
  s.vy -= cfg.gravity * dt;
  const headBefore = s.y + cfg.height;
  s.y += s.vy * dt;
  if (s.vy > 0) {
    // Rising: a ceiling above the head stops the jump instead of letting it pass through.
    const ceiling = ceilingHeight(s.x, s.z, headBefore - SKIN, s.y + cfg.height, cfg, world);
    if (ceiling < s.y + cfg.height) {
      s.y = ceiling - cfg.height - SKIN;
      s.vy = 0;
    }
  }
  if (s.y <= ground) {
    // Landing on a top above the feet (a jump onto a counter) is a step up the camera can ease, like a walking step.
    const up = ground - Math.max(feetBefore, s.y);
    s.y = ground;
    s.vy = 0;
    s.grounded = true;
    if (s.jumping) s.jumping = false;
    return Math.max(0, up);
  } else {
    s.grounded = false;
  }
  if (s.y < LOWEST_Y) {
    s.y = LOWEST_Y;
    s.vy = 0;
  }
  return 0;
}

/** How far above its feet the body may climb this step: the jump's air step while jumping, else the step height. */
function climbLimit(s: MotorState, cfg: MotorConfig): number {
  return s.jumping ? airStep(cfg) : cfg.stepHeight;
}

/**
 * A box blocks sideways movement when it overlaps the body above what it can climb, or when it is low enough to
 * climb but there is no room to stand on it (a counter under a wall cabinet).
 */
function blocksBody(b: Aabb, s: MotorState, climb: number, cfg: MotorConfig, world: ColliderQuery): boolean {
  if (b.min[1] >= s.y + cfg.height) return false;
  const top = b.max[1];
  if (top > s.y + climb + SKIN) return true;
  return top > s.y + SKIN && !hasHeadroom(b, s.x, s.z, cfg, world);
}

/**
 * True if nothing has its underside within a standing height above `b`'s top, over the part of `b` under the body's
 * footprint. Boxes that rise from below the top (a wall beside a counter) are not undersides.
 */
function hasHeadroom(b: Aabb, x: number, z: number, cfg: MotorConfig, world: ColliderQuery): boolean {
  const r = cfg.radius;
  const top = b.max[1];
  const minX = Math.max(b.min[0], x - r);
  const maxX = Math.min(b.max[0], x + r);
  const minZ = Math.max(b.min[2], z - r);
  const maxZ = Math.min(b.max[2], z + r);
  headScratch.length = 0;
  const boxes = world.query(minX, minZ, maxX, maxZ, headScratch);
  for (const o of boxes) {
    if (o === b) continue;
    const bottom = o.min[1];
    if (bottom <= top + SKIN || bottom >= top + cfg.height) continue;
    if (o.max[0] <= minX + SKIN || o.min[0] >= maxX - SKIN || o.max[2] <= minZ + SKIN || o.min[2] >= maxZ - SKIN) continue;
    return false;
  }
  return true;
}

/** `floorHeight` for this body: tops above its feet only count if it has room to stand on them. */
/**
 * The highest walkable top at or below the body's feet, or -Infinity when there is none. Unlike the step-up
 * search it never looks above the feet, so a body placed just under a ceiling slab finds the floor, not the slab.
 */
export function floorBelow(s: MotorState, world: ColliderQuery, cfg: MotorConfig = DEFAULT_MOTOR): number {
  return standHeight(s, s.y + SKIN, cfg, world);
}

function standHeight(s: MotorState, maxTop: number, cfg: MotorConfig, world: ColliderQuery): number {
  const r = cfg.radius * FLOOR_PROBE;
  scratch.length = 0;
  const boxes = world.query(s.x - r, s.z - r, s.x + r, s.z + r, scratch);
  let best = -Infinity;
  for (const b of boxes) {
    const top = b.max[1];
    if (top > maxTop || top <= best) continue;
    const cx = clamp(s.x, b.min[0], b.max[0]);
    const cz = clamp(s.z, b.min[2], b.max[2]);
    if ((s.x - cx) ** 2 + (s.z - cz) ** 2 >= r * r) continue;
    if (top > s.y + SKIN && !hasHeadroom(b, s.x, s.z, cfg, world)) continue;
    best = top;
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
