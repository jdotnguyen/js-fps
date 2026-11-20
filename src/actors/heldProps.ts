import * as THREE from 'three';

/**
 * Small things a body holds in the right hand (ADR-0029): a coffee mug, or the dock guard's scanning wand
 * (dock-checkpoint spec). Which one shows follows the body's pose: mug and drink poses (`idle_mug`, `offer_mug`,
 * `drink`, `lean_back_mug_drink`, ...) hold the mug, wand poses (`idle_wand`, `wand_up`, `wand_down`) the wand, so a
 * sequence or the ambient gestures only have to pick the pose. One shared geometry and material per item.
 */

/** Poses that have a mug in the right hand. */
export const MUG_POSE = /(^|_)(mug|drink)(_|$)/;
/** Poses that have the scanning wand in the right hand. */
export const WAND_POSE = /(^|_)wand(_|$)/;

export type HeldItem = 'mug' | 'wand';

/** The item a pose holds in the right hand, if any. */
export function heldItemFor(pose: string): HeldItem | null {
  if (MUG_POSE.test(pose)) return 'mug';
  if (WAND_POSE.test(pose)) return 'wand';
  return null;
}

/** Where the mug sits in the right hand's local frame (canonical skeleton: the bone points -Y, palm toward -X). */
export const MUG_IN_HAND = {
  position: new THREE.Vector3(-0.045, -0.075, 0.0),
  /** The mug's up axis (+Y) turned to the hand's -Z: up when the forearm is held out level. */
  rotation: new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2),
};

let geometry: THREE.BufferGeometry | null = null;
let material: THREE.Material | null = null;

function mugGeometry(): THREE.BufferGeometry {
  if (geometry) return geometry;
  const body = new THREE.LatheGeometry(
    [new THREE.Vector2(0, 0), new THREE.Vector2(0.04, 0), new THREE.Vector2(0.043, 0.095), new THREE.Vector2(0.038, 0.095), new THREE.Vector2(0.035, 0.012), new THREE.Vector2(0, 0.012)],
    14,
  );
  const handle = new THREE.TorusGeometry(0.026, 0.007, 6, 12, Math.PI);
  handle.rotateZ(-Math.PI / 2);
  handle.translate(0.043, 0.048, 0);
  // Merge by hand (no BufferGeometryUtils import): both are non-indexed after toNonIndexed().
  const parts = [body.toNonIndexed(), handle.toNonIndexed()];
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  // Centre on the grip: the hand holds the mug's middle.
  geometry.translate(0, -0.048, 0);
  for (const g of [body, handle, ...parts]) g.dispose();
  return geometry;
}

function mugMaterial(): THREE.Material {
  material ??= new THREE.MeshStandardMaterial({ color: 0xe7e2d8, roughness: 0.45, metalness: 0 });
  return material;
}

/** A mug mesh, parented to a hand bone and placed in its palm. */
export function makeHeldMug(): THREE.Mesh {
  const mesh = new THREE.Mesh(mugGeometry(), mugMaterial());
  mesh.name = 'held_mug';
  mesh.position.copy(MUG_IN_HAND.position);
  mesh.rotation.copy(MUG_IN_HAND.rotation);
  mesh.castShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ wand

/** The wand runs along the hand bone (-Y, the way the fingers point), its grip in the palm. */
export const WAND_IN_HAND = {
  position: new THREE.Vector3(-0.03, -0.06, 0.0),
  rotation: new THREE.Euler(0, 0, 0),
};

let wandGeometry: THREE.BufferGeometry | null = null;
let wandMaterial: THREE.Material | null = null;

function makeWandGeometry(): THREE.BufferGeometry {
  if (wandGeometry) return wandGeometry;
  const grip = new THREE.CylinderGeometry(0.017, 0.019, 0.16, 10);
  grip.translate(0, -0.02, 0);
  const neck = new THREE.CylinderGeometry(0.014, 0.017, 0.05, 10);
  neck.translate(0, -0.125, 0);
  const paddle = new THREE.BoxGeometry(0.075, 0.2, 0.022);
  paddle.translate(0, -0.25, 0);
  const parts = [grip.toNonIndexed(), neck.toNonIndexed(), paddle.toNonIndexed()];
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  wandGeometry = new THREE.BufferGeometry();
  wandGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  wandGeometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  for (const g of [grip, neck, paddle, ...parts]) g.dispose();
  return wandGeometry;
}

function makeWandMaterial(): THREE.Material {
  wandMaterial ??= new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.55, metalness: 0.1 });
  return wandMaterial;
}

/** A scanning wand mesh, parented to a hand bone with its grip in the palm. */
export function makeHeldWand(): THREE.Mesh {
  const mesh = new THREE.Mesh(makeWandGeometry(), makeWandMaterial());
  mesh.name = 'held_wand';
  mesh.position.copy(WAND_IN_HAND.position);
  mesh.rotation.copy(WAND_IN_HAND.rotation);
  mesh.castShadow = true;
  return mesh;
}

/** A fresh mesh for a held item. */
export function makeHeld(item: HeldItem): THREE.Mesh {
  return item === 'mug' ? makeHeldMug() : makeHeldWand();
}
