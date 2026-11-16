/** Analytic ray vs capsule (ADR-0006: no mesh raycasts). Pure, no three.js. */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function raySphere(ox: number, oy: number, oz: number, d: V3, r: number): number {
  // Origin relative to the sphere centre.
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/**
 * Distance along the ray to the first hit on the capsule [a, b] with radius r, or -1.
 * `d` must be normalised. Rays starting inside the capsule count as a miss.
 * After Inigo Quilez's capsule intersection.
 */
export function rayCapsule(o: V3, d: V3, a: V3, b: V3, r: number): number {
  const ba = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const oa = { x: o.x - a.x, y: o.y - a.y, z: o.z - a.z };
  const baba = dot(ba, ba);
  const bard = dot(ba, d);
  const baoa = dot(ba, oa);
  const rdoa = dot(d, oa);
  const oaoa = dot(oa, oa);
  const qa = baba - bard * bard;
  if (baba < 1e-12) return raySphere(oa.x, oa.y, oa.z, d, r);
  if (Math.abs(qa) > 1e-9) {
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - r * r * baba;
    const h = qb * qb - qa * qc;
    if (h < 0) return -1;
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    const oc = y <= 0 ? oa : { x: o.x - b.x, y: o.y - b.y, z: o.z - b.z };
    return raySphere(oc.x, oc.y, oc.z, d, r);
  }
  // Ray parallel to the axis: only the end spheres can be hit first.
  const ta = raySphere(oa.x, oa.y, oa.z, d, r);
  const tb = raySphere(o.x - b.x, o.y - b.y, o.z - b.z, d, r);
  if (ta < 0) return tb;
  if (tb < 0) return ta;
  return Math.min(ta, tb);
}
