import * as THREE from 'three';

/**
 * Box with UVs in world metres (1 tile = `tile` m) and enough segments that per-vertex
 * ambient occlusion (world/kit/merge.ts) shades large faces smoothly.
 */
export function slab(w: number, h: number, d: number, tile = 1, maxSegment = 0.8): THREE.BoxGeometry {
  const seg = (v: number): number => Math.max(1, Math.min(12, Math.ceil(v / maxSegment)));
  const ws = seg(w);
  const hs = seg(h);
  const ds = seg(d);
  const g = new THREE.BoxGeometry(w, h, d, ws, hs, ds);
  const uv = g.getAttribute('uv');
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; vertices are contiguous per face.
  const faces: Array<{ su: number; sv: number; count: number }> = [
    { su: d, sv: h, count: (ds + 1) * (hs + 1) },
    { su: d, sv: h, count: (ds + 1) * (hs + 1) },
    { su: w, sv: d, count: (ws + 1) * (ds + 1) },
    { su: w, sv: d, count: (ws + 1) * (ds + 1) },
    { su: w, sv: h, count: (ws + 1) * (hs + 1) },
    { su: w, sv: h, count: (ws + 1) * (hs + 1) },
  ];
  let i = 0;
  for (const f of faces) {
    for (let k = 0; k < f.count; k++, i++) uv.setXY(i, (uv.getX(i) * f.su) / tile, (uv.getY(i) * f.sv) / tile);
  }
  return g;
}

/** Vertical cylinder standing on y = 0 at (x, z). */
export function post(radius: number, height: number, radial = 10): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, radial);
  g.translate(0, height / 2, 0);
  return g;
}

/** Lathe from (radius, y) pairs, e.g. tank caps and valve bodies. */
export function lathe(profile: Array<[number, number]>, segments = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** Flat plate extruded from a rounded rectangle with a bevel (wall plates, hatches). */
export function plate(w: number, h: number, depth: number, corner = 0.04, bevel = 0.012): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(corner, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  // Extrude UVs are in shape units (metres) already.
  return g;
}
