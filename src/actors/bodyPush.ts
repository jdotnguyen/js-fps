/**
 * Pure circle maths for Jay vs people (XZ plane): swept clipping so a fast step cannot tunnel
 * through a body, push-out for overlaps, and removing the velocity that points into a body so
 * Jay slides around people instead of jittering. No Three.js, so it runs in unit tests.
 */

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface V2 {
  x: number;
  z: number;
}

/** Jay's footprint radius against bodies (same as the NPC separation PLAYER_RADIUS and the motor). */
export const JAY_RADIUS = 0.35;
/** Gap left when clipping a move to a body, metres. */
const CLIP_SKIN = 1e-3;

/**
 * Clip the planned move (dx, dz) from (px, pz) so a circle of `radius` never enters any body.
 * On contact the rest of the move is slid along the body (the inward part is dropped), up to a
 * few times so two bodies side by side still work. Bodies already overlapping at the start are
 * skipped here; `pushOut` deals with them. Writes the allowed move into `out`.
 */
export function clipMove(px: number, pz: number, dx: number, dz: number, bodies: readonly Circle[], radius: number, out: V2): V2 {
  let x = px;
  let z = pz;
  let rx = dx;
  let rz = dz;
  for (let it = 0; it < 3; it++) {
    const a = rx * rx + rz * rz;
    if (a < 1e-12) break;
    let bestT = Infinity;
    let bi = -1;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const sep = b.r + radius;
      const fx = x - b.x;
      const fz = z - b.z;
      const c = fx * fx + fz * fz - sep * sep;
      if (c < 0) continue; // already inside
      const bb = 2 * (fx * rx + fz * rz);
      if (bb >= 0) continue; // moving away
      const disc = bb * bb - 4 * a * c;
      if (disc < 0) continue;
      const t = (-bb - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > 1) continue;
      if (t < bestT) {
        bestT = t;
        bi = i;
      }
    }
    if (bi < 0) {
      x += rx;
      z += rz;
      rx = rz = 0;
      break;
    }
    const len = Math.sqrt(a);
    const t = Math.max(0, bestT - CLIP_SKIN / len);
    x += rx * t;
    z += rz * t;
    const b = bodies[bi]!;
    const nx = x - b.x;
    const nz = z - b.z;
    const nl = Math.hypot(nx, nz) || 1;
    // Slide: keep only the tangential part of what is left of the move.
    let sx = rx * (1 - t);
    let sz = rz * (1 - t);
    const inward = (sx * nx + sz * nz) / nl;
    if (inward < 0) {
      sx -= (nx / nl) * inward;
      sz -= (nz / nl) * inward;
    }
    rx = sx;
    rz = sz;
  }
  out.x = x - px;
  out.z = z - pz;
  return out;
}

/**
 * Vector that moves a circle of `radius` at (px, pz) out of `body` to the minimum separation
 * (zero when apart). Coincident centres push along (fx, fz), or +X when that is zero too.
 */
export function pushOut(px: number, pz: number, body: Circle, radius: number, fx: number, fz: number, out: V2): V2 {
  const sep = body.r + radius;
  const dx = px - body.x;
  const dz = pz - body.z;
  const d = Math.hypot(dx, dz);
  out.x = out.z = 0;
  if (d >= sep) return out;
  if (d > 1e-6) {
    const k = (sep - d) / d;
    out.x = dx * k;
    out.z = dz * k;
  } else {
    const fl = Math.hypot(fx, fz);
    out.x = (fl > 1e-6 ? fx / fl : 1) * sep;
    out.z = (fl > 1e-6 ? fz / fl : 0) * sep;
  }
  return out;
}

/**
 * Remove from (vx, vz) the part pointing into any body within `margin` of touching.
 * Writes the result into `out`.
 */
export function removeInward(vx: number, vz: number, px: number, pz: number, bodies: readonly Circle[], radius: number, margin: number, out: V2): V2 {
  let x = vx;
  let z = vz;
  for (const b of bodies) {
    const dx = px - b.x;
    const dz = pz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6 || d > b.r + radius + margin) continue;
    const vn = (x * dx + z * dz) / d;
    if (vn < 0) {
      x -= (dx / d) * vn;
      z -= (dz / d) * vn;
    }
  }
  out.x = x;
  out.z = z;
  return out;
}
