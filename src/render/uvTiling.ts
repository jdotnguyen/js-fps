import * as THREE from 'three';

/**
 * Texture tiling helpers. Two ways to make a texture keep its real-world size on a surface:
 *
 * 1. World-space UVs (`applyWorldUvs`) — the default for kit geometry. UVs are written in
 *    metres from the surface's world position, so one shared material tiles continuously
 *    across every wall piece, trim and corner, and pieces still merge into one draw call.
 *    The texture's own `repeat` (1 / metersPerTile for photo slots) sets the physical scale.
 *
 * 2. Per-mesh repeat (`tileTexture` / `tileMaterial`) — `texture.repeat = (width / tile,
 *    height / tile)` on a clone, for a single plane or box with ordinary 0..1 UVs (a one-off
 *    prop, an imported mesh you can't re-UV). It costs one material per surface, cannot merge,
 *    and every surface starts its pattern at its own corner, so neighbours don't line up.
 */

/** Metres covered by one repeat of `material.map` under the kit's metre-UV contract (UV 1 = 1 m). */
export function metersPerRepeat(material: THREE.Material): number {
  const map = (material as THREE.MeshStandardMaterial).map;
  const r = map?.repeat.x ?? 1;
  return r > 1e-6 ? 1 / r : 1;
}

/** `texture.repeat` for a `width` x `height` metre surface with 0..1 UVs and a `tileSize` metre texture. */
export function tileRepeat(width: number, height: number, tileSize: number): [number, number] {
  if (!(tileSize > 0)) throw new Error(`tileSize must be > 0 (got ${tileSize})`);
  return [width / tileSize, height / tileSize];
}

/**
 * Clone `base` with RepeatWrapping and repeat = (width / tileSize, height / tileSize).
 * The clone shares the image (`texture.source`), so this does not upload a second copy.
 */
export function tileTexture<T extends THREE.Texture>(base: T, width: number, height: number, tileSize: number): T {
  const t = base.clone() as T;
  const [u, v] = tileRepeat(width, height, tileSize);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(u, v);
  t.offset.set(0, 0);
  t.needsUpdate = true;
  return t;
}

const MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap'] as const;

/**
 * Clone a standard material for one `width` x `height` metre surface with 0..1 UVs, tiling
 * every texture slot by the same repeat. Slots that share one texture (the ORM map used for
 * ao/roughness/metalness) keep sharing one clone. `tileSize` defaults to the material's own
 * metres-per-repeat, so photo slots keep their authored physical size.
 */
export function tileMaterial(
  base: THREE.MeshStandardMaterial,
  width: number,
  height: number,
  tileSize = metersPerRepeat(base),
): THREE.MeshStandardMaterial {
  const m = base.clone();
  const clones = new Map<THREE.Texture, THREE.Texture>();
  for (const slot of MAP_SLOTS) {
    const tex = base[slot];
    if (!tex) continue;
    let c = clones.get(tex);
    if (!c) {
      c = tileTexture(tex, width, height, tileSize);
      clones.set(tex, c);
    }
    m[slot] = c;
  }
  m.name = `${base.name || base.type}@${width.toFixed(2)}x${height.toFixed(2)}`;
  return m;
}

/** Dispose the texture clones `tileMaterial` made (not the shared images) and the material. */
export function disposeTiledMaterial(m: THREE.MeshStandardMaterial): void {
  const seen = new Set<THREE.Texture>();
  for (const slot of MAP_SLOTS) {
    const tex = m[slot];
    if (tex && !seen.has(tex)) {
      seen.add(tex);
      tex.dispose();
    }
  }
  m.dispose();
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Box-project world-space UVs so 1 UV unit = `tileMeters` metres. Call on geometry that is
 * already in world space (after its matrix is applied). Leave `tileMeters` at 1 for photo
 * slots: their texture repeat already holds 1 / metersPerTile.
 *
 * - The projection axis is chosen once per triangle from its face normal, so bevelled edges
 *   never mix two projections inside one triangle (no smearing).
 * - U is signed by facing, so the texture reads left-to-right from in front of every face:
 *   opposite walls are not mirrored and floors read the right way up from above.
 * - Two walls meeting at a corner share the vertical edge's world coordinate, so the pattern
 *   lines up on both sides of the corner whenever the corner sits on a tile boundary, and the
 *   scale always matches.
 * - Indexed geometry (shared vertices) falls back to per-vertex normals.
 */
export function applyWorldUvs(g: THREE.BufferGeometry, tileMeters = 1): void {
  const pos = g.getAttribute('position');
  if (!pos) return;
  const nor = g.getAttribute('normal');
  let uv = g.getAttribute('uv');
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    g.setAttribute('uv', uv);
  }
  const inv = 1 / tileMeters;
  const project = (i: number, nx: number, ny: number, nz: number): void => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    if (ay >= ax && ay >= az) uv.setXY(i, x * inv, (ny >= 0 ? -z : z) * inv);
    else if (ax >= az) uv.setXY(i, (nx >= 0 ? -z : z) * inv, y * inv);
    else uv.setXY(i, (nz >= 0 ? x : -x) * inv, y * inv);
  };
  if (g.index || pos.count % 3 !== 0) {
    if (!nor) return;
    for (let i = 0; i < pos.count; i++) project(i, nor.getX(i), nor.getY(i), nor.getZ(i));
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      _a.fromBufferAttribute(pos, i);
      _b.fromBufferAttribute(pos, i + 1).sub(_a);
      _c.fromBufferAttribute(pos, i + 2).sub(_a);
      _b.cross(_c);
      if (_b.lengthSq() < 1e-14) {
        if (nor) _b.fromBufferAttribute(nor, i);
        else _b.set(0, 1, 0);
      }
      for (let k = 0; k < 3; k++) project(i + k, _b.x, _b.y, _b.z);
    }
  }
  uv.needsUpdate = true;
}
