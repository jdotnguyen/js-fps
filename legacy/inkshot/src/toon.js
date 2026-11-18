import * as THREE from 'three';

export const INK = 0x16141f;

// A tiny nearest-filtered ramp: this is what turns smooth lighting into bands.
function makeGradientMap(steps) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const gradientMap = makeGradientMap([80, 155, 255]);

const sharedMats = new Map();

/** Toon material. Shared per colour unless `unique` (needed for per-object flashes). */
export function toonMat(color, unique = false) {
  if (unique) return new THREE.MeshToonMaterial({ color, gradientMap });
  let mat = sharedMats.get(color);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({ color, gradientMap });
    sharedMats.set(color, mat);
  }
  return mat;
}

export const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

const outlineSize = new THREE.Vector3();

/** Inverted-hull outline: a back-face-only copy, grown by `thickness` world units per side. */
export function addOutline(mesh, thickness = 0.035) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  geo.boundingBox.getSize(outlineSize);
  const hull = new THREE.Mesh(geo, outlineMat);
  hull.scale.set(
    1 + (2 * thickness) / Math.max(outlineSize.x, 0.001),
    1 + (2 * thickness) / Math.max(outlineSize.y, 0.001),
    1 + (2 * thickness) / Math.max(outlineSize.z, 0.001),
  );
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}

const boxGeos = new Map();

export function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let geo = boxGeos.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    boxGeos.set(key, geo);
  }
  return geo;
}

/** Outlined toon box. `material` may be a colour number or a material. */
export function toonBox(w, h, d, material, { outline = 0.035, shadow = true } = {}) {
  const mat = typeof material === 'number' ? toonMat(material) : material;
  const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  if (outline) addOutline(mesh, outline);
  return mesh;
}
