import * as THREE from 'three';

/**
 * Small things a body holds in the right hand (ADR-0029): a coffee mug, or the dock guard's scanning wand
 * (dock-checkpoint spec). Which one shows follows the body's pose: mug and drink poses (`idle_mug`, `offer_mug`,
 * `drink`, `lean_back_mug_drink`, ...) hold the mug, wand poses (`idle_wand`, `wand_up`, `wand_down`) the wand, so a
 * sequence or the ambient gestures only have to pick the pose. One shared geometry and material per item.
 */

/** Radius (m) of what each held item's grip wraps around: the hand wraps it no tighter than this (no finger inside the mug). */
export const HELD_GRIP_RADIUS: Readonly<Record<HeldItem, number>> = { mug: 0.043, wand: 0.019 };

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

/**
 * The rotation that turns the mug's up axis (+Y) to `up` and its handle (+X) toward `handle`, both given in the hand's frame.
 * Built from the axes rather than an Euler string (upright-mug-grip D2: `Euler(-PI/2, 0, PI/2)` read as "up to -Z" but, with
 * XYZ order applying Z first, put the mug's up along the palm normal and laid it on its side).
 */
export function mugRotation(up: THREE.Vector3, handle: THREE.Vector3): THREE.Quaternion {
  const y = up.clone().normalize();
  const x = handle.clone().addScaledVector(y, -handle.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Where the mug sits in the right hand's local frame (canonical skeleton: the bone points -Y, palm toward -X, thumb side -Z). */
export const MUG_IN_HAND = {
  /** The mug's centre, in front of the palm. */
  position: new THREE.Vector3(-0.045, -0.075, 0.0),
  /** The mug's up axis runs along the thumb-and-index side of the hand (hand -Z): up when the thumb points up. */
  up: new THREE.Vector3(0, 0, -1),
  /** The handle points away from the palm (hand -X; the mug's centre is already on the palm side). */
  handle: new THREE.Vector3(-1, 0, 0),
};

const MUG_ROTATION = mugRotation(MUG_IN_HAND.up, MUG_IN_HAND.handle);

// ------------------------------------------------------------------ a grip frame per rig (upright-mug-grip D4)

/** Where a held mug sits in one rig's right hand (hand-rest space): its centre, up axis and handle direction, and the palm normal. */
export interface GripFrame {
  position: THREE.Vector3;
  up: THREE.Vector3;
  handle: THREE.Vector3;
  palm: THREE.Vector3;
}

/** How far a knuckle joint's centre sits behind the palm's skin (m): the mug's wall goes this much further out. */
export const PALM_DEPTH = 0.012;
/** How far toward the wrist from the knuckle row the mug's centre sits (m). Small: every millimetre lifts the knuckles off the wall. */
export const GRIP_PROXIMAL = 0.003;
/** How far the most outward knuckle's skin presses into the mug (m); the held-props spec allows up to 3 mm. */
export const GRIP_PRESS = 0.002;

interface FingerDefLike {
  kind: string;
  name: string;
  parent: string;
  offset: readonly [number, number, number] | readonly number[];
  side: string;
}

/** Rest-space positions (relative to the hand bone) of one side's finger joints, chained from the calibrated offsets. */
export function fingerRestPositions(handBones: readonly FingerDefLike[], side: 'L' | 'R' = 'R'): Map<string, THREE.Vector3> {
  const byName = new Map(handBones.filter((b) => b.kind === 'finger' && b.side === side).map((b) => [b.name, b]));
  const pos = new Map<string, THREE.Vector3>();
  const at = (name: string): THREE.Vector3 | null => {
    const hit = pos.get(name);
    if (hit) return hit;
    const d = byName.get(name);
    if (!d) return null;
    const base = d.parent.startsWith('finger_') ? at(d.parent) : new THREE.Vector3();
    if (!base) return null;
    const p = base.clone().add(new THREE.Vector3(d.offset[0] ?? 0, d.offset[1] ?? 0, d.offset[2] ?? 0));
    pos.set(name, p);
    return p;
  };
  for (const name of byName.keys()) at(name);
  return pos;
}

/**
 * The right-hand grip frame for a mug of outer radius `radius`, from a rig's calibrated finger joints: the axis runs along the
 * knuckle row toward the index (the thumb side), the centre sits in front of the palm by the radius plus the palm's depth, a little
 * toward the wrist from the knuckles, and the handle points away from the palm. Null for a hand without finger bones.
 */
export function gripFrameFor(handBones: readonly FingerDefLike[] | undefined, radius = HELD_GRIP_RADIUS.mug): GripFrame | null {
  if (!handBones || handBones.length === 0) return null;
  const p = fingerRestPositions(handBones, 'R');
  const idx = p.get('finger_R_index_1');
  const pnk = p.get('finger_R_pinky_1') ?? p.get('finger_R_ring_1');
  const m1 = p.get('finger_R_middle_1');
  const m2 = p.get('finger_R_middle_2');
  if (!idx || !pnk || !m1 || !m2) return null;
  const across = pnk.clone().sub(idx).normalize();
  const down = m2.clone().sub(m1).normalize();
  const palm = new THREE.Vector3().crossVectors(down, across).normalize();
  const up = across.clone().negate();
  up.addScaledVector(palm, -up.dot(palm)).normalize();
  // Along the knuckle row, centred between index and pinky; out from the palm, resting on whichever knuckle stands furthest out
  // (pressing its skin GRIP_PRESS into the mug, so the knuckles behind it in the hand's arch come as close as they can).
  // Along the fingers, on the knuckles' mean (so none sits off to one side of the mug, which would lift it off the wall).
  const position = idx.clone().add(pnk).multiplyScalar(0.5);
  const knuckles = ['index', 'middle', 'ring', 'pinky'].map((f) => p.get(`finger_R_${f}_1`)).filter((v): v is THREE.Vector3 => !!v);
  const out = Math.max(...knuckles.map((k) => k.dot(palm)));
  const along = knuckles.reduce((s, k) => s + k.dot(down), 0) / knuckles.length;
  position.addScaledVector(palm, out - position.dot(palm) + radius + PALM_DEPTH - GRIP_PRESS);
  position.addScaledVector(down, along - position.dot(down) - GRIP_PROXIMAL);
  // `palm` points out of the palm, toward the mug: the handle continues that way, out past the mug.
  const handle = palm.clone();
  return { position, up, handle, palm };
}

// ------------------------------------------------------------------ keeping the mug level (upright-mug-grip D3)

/** Drink poses tip the mug toward the face; every other mug pose holds it upright. */
export const DRINK_POSE = /(^|_)drink(_|$)/;
/** Tilt (degrees from vertical, toward the face) a drink pose gives the mug when it has no entry in DRINK_TILT_DEG. */
export const DEFAULT_DRINK_TILT_DEG = 45;
/** Per-pose drink tilts (degrees), set by eye in the cast motion sandbox; the held-props spec allows 30-70. */
export const DRINK_TILT_DEG: Readonly<Record<string, number>> = {};

/** How far (radians from vertical, toward the face) the held mug should lean in this pose. */
export function heldTiltFor(pose: string): number {
  if (!DRINK_POSE.test(pose)) return 0;
  return THREE.MathUtils.degToRad(DRINK_TILT_DEG[pose] ?? DEFAULT_DRINK_TILT_DEG);
}

/**
 * The mug's outer shape in its own frame (the grip centre at the origin, up +Y, handle +X), matching mugGeometry: a tapered body
 * from radius 0.040 at the base to 0.043 at the rim, 0.095 tall, and the handle loop's box on the +X side.
 */
export const MUG_SHAPE = {
  rBottom: 0.04,
  rTop: 0.043,
  yBottom: -0.048,
  yTop: 0.047,
  handleBox: new THREE.Box3(new THREE.Vector3(0.036, -0.033, -0.007), new THREE.Vector3(0.076, 0.033, 0.007)),
};

/** The mug's rim in its own frame: height above the grip centre and outer radius (mugGeometry: 0.095 tall, centred at 0.048). */
export const MUG_RIM = { y: 0.047, r: 0.043 };
/** The mouth in the head bone's frame (canonical skeleton: the face looks -Z), for a body without a jaw mesh to measure. */
export const MOUTH_IN_HEAD = { y: 0.045, z: -0.09 };

/**
 * A body's own mouth in its head bone's frame, from the mesh skinned to its jaw: the lower lip's top at the front of the face.
 * Rigs differ by several centimetres (Okafor's lip sits 3.7 cm above his head joint, Giles's 1.9 cm below), so one constant puts the
 * mug at someone's eyes. Null when the body has no jaw mesh.
 */
export function mouthFromJaw(parts: ReadonlyArray<{ bone: string; geometry: THREE.BufferGeometry }>, jawOffset: readonly number[] | undefined): { y: number; z: number } | null {
  const jaw = parts.filter((p) => p.bone === 'jaw');
  if (jaw.length === 0 || !jawOffset) return null;
  let front = Infinity;
  for (const p of jaw) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) front = Math.min(front, pos.getZ(i));
  }
  // The lip line: the highest jaw vertex within 2 cm of the front of the face.
  let lip = -Infinity;
  for (const p of jaw) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < front + 0.02) lip = Math.max(lip, pos.getY(i));
  }
  if (!Number.isFinite(front) || !Number.isFinite(lip)) return null;
  return { y: (jawOffset[1] ?? 0) + lip, z: (jawOffset[2] ?? 0) + front };
}

const vAxis = new THREE.Vector3();
const vWant = new THREE.Vector3();
const qSwing = new THREE.Quaternion();
const qHand = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Turn `hand` (in world space, by the smallest swing) so the `held` item's up axis points `tilt` radians from vertical toward
 * `toward` (a world direction; only its horizontal part counts). The fingers and the item turn with the hand, so the grip is
 * unchanged. Returns the swing's angle (radians).
 */
export function levelHeld(hand: THREE.Object3D, held: THREE.Object3D, tilt: number, toward: THREE.Vector3): number {
  if (!hand.parent) return 0;
  held.updateWorldMatrix(true, false);
  const e = held.matrixWorld.elements;
  vAxis.set(e[4]!, e[5]!, e[6]!).normalize();
  vWant.set(toward.x, 0, toward.z);
  if (tilt > 1e-4 && vWant.lengthSq() > 1e-8) {
    vWant.normalize().multiplyScalar(Math.sin(tilt)).addScaledVector(WORLD_UP, Math.cos(tilt));
  } else {
    vWant.copy(WORLD_UP);
  }
  qSwing.setFromUnitVectors(vAxis, vWant.normalize());
  hand.getWorldQuaternion(qHand).premultiply(qSwing);
  hand.parent.getWorldQuaternion(qParent).invert();
  hand.quaternion.copy(qParent.multiply(qHand));
  hand.updateMatrixWorld(true);
  return 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(qSwing.w), 0, 1));
}

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

/** A mug mesh, parented to a hand bone and placed in its palm: in the rig's own grip frame when it has one (D4). */
export function makeHeldMug(grip: GripFrame | null = null): THREE.Mesh {
  const mesh = new THREE.Mesh(mugGeometry(), mugMaterial());
  mesh.name = 'held_mug';
  if (grip) {
    mesh.position.copy(grip.position);
    mesh.quaternion.copy(mugRotation(grip.up, grip.handle));
  } else {
    mesh.position.copy(MUG_IN_HAND.position);
    mesh.quaternion.copy(MUG_ROTATION);
  }
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

/** A fresh mesh for a held item; a mug uses the rig's grip frame when given one. */
export function makeHeld(item: HeldItem, grip: GripFrame | null = null): THREE.Mesh {
  return item === 'mug' ? makeHeldMug(grip) : makeHeldWand();
}
