import * as THREE from 'three';

/**
 * The squad sidearm (squad-sidearms): an H&K USP held in Giles's and Okafor's right hand while they aim. The model is
 * `public/assets/models/weapons/squad_pistol.glb`, written by `scripts/import-squad-pistol.mjs` (design D1): barrel along -Z,
 * up +Y, right +X, the origin at the grip marker, with `slide` and `frame` meshes and `muzzle`, `ejectPort` and `grip` markers.
 *
 * The marker values and the grip's shape below are read off that file (`src/actors/squadPistol.test.ts` checks they still
 * match), so the grip solve, the aim and the shot origin work before (and without) the model loading: a held pistol is a group
 * with its markers at once, and gets its meshes when the model arrives.
 */

export const SQUAD_PISTOL_URL = 'assets/models/weapons/squad_pistol.glb';

/** Marker positions in the model's frame (m), and the grip marker's rotation (its +Y up the grip axis, -Z forward). */
export const PISTOL_MARKERS = {
  muzzle: new THREE.Vector3(0, 0.07878, -0.15392),
  ejectPort: new THREE.Vector3(0.014, 0.08148, -0.06728),
  grip: new THREE.Vector3(0, 0, 0),
  gripRotation: new THREE.Quaternion(-0.13129, 0, 0, 0.99134).normalize(),
} as const;

/** Half the frame's width (m) above the grip: the palm sits this far from the gun's centre plane, so the straight index clears the frame. */
export const PISTOL_GRIP_HALF_WIDTH = 0.0175;

/**
 * The gun's solid shape in the grip marker's frame (+Y up the grip axis, -Z forward, +X the right-hand side), as rounded boxes:
 * the grip below (magazine base included), the frame and slide above it (the trigger guard included; tall, since the slide rises
 * toward the muzzle in this tilted frame), measured from the model's vertices.
 */
export const PISTOL_SHAPE = {
  grip: { centre: new THREE.Vector3(0, -0.015, -0.0035), half: new THREE.Vector3(0.013, 0.043, 0.0285), round: 0.008 },
  upper: { centre: new THREE.Vector3(0, 0.0805, -0.057), half: new THREE.Vector3(0.016, 0.0545, 0.113), round: 0.004 },
  /** The trigger guard's loop, in front of the grip's top: the palm stays out of it. */
  triggerGuard: new THREE.Box3(new THREE.Vector3(-0.014, 0.02, -0.085), new THREE.Vector3(0.014, 0.045, -0.028)),
} as const;

/**
 * Where the grip's centre sits from the knuckle row along the fingers (m; negative = toward the wrist): the knuckles along the
 * front-right edge of the grip, so the fingers bend at the knuckle round the front strap and onto the left panel.
 */
export const PISTOL_FORWARD = -0.025;
/** How far up the gun sits in the hand (m, toward the index side): the web of the hand just under the slide's rear, not into it. */
export const PISTOL_RAISE = 0.005;

/** Signed distance (m) from a point to a rounded box (negative inside). */
export function roundBoxDistance(p: THREE.Vector3, box: { centre: THREE.Vector3; half: THREE.Vector3; round: number }): number {
  const qx = Math.abs(p.x - box.centre.x) - (box.half.x - box.round);
  const qy = Math.abs(p.y - box.centre.y) - (box.half.y - box.round);
  const qz = Math.abs(p.z - box.centre.z) - (box.half.z - box.round);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qy, qz), 0) - box.round;
}

/** Signed distance (m) from a grip-frame point to the gun's solid (negative inside). */
export function pistolDistance(p: THREE.Vector3): number {
  return Math.min(roundBoxDistance(p, PISTOL_SHAPE.grip), roundBoxDistance(p, PISTOL_SHAPE.upper));
}

// ------------------------------------------------------------------ slide kick (design D4)

/** How far the slide travels back on a shot (m). */
export const SLIDE_TRAVEL = 0.03;
/** The slide is back and closed again within this long (s); the held-props spec allows 0.15. */
export const SLIDE_CYCLE = 0.1;

/**
 * The slide's back-travel (m, along the model's +Z) `t` seconds after a shot: snaps back over the first fifth of the cycle,
 * returns on an eased spring, and rests at exactly 0 from SLIDE_CYCLE on (and before the shot).
 */
export function slideOffset(t: number): number {
  if (!(t >= 0) || t >= SLIDE_CYCLE) return 0;
  const back = SLIDE_CYCLE * 0.2;
  if (t < back) return SLIDE_TRAVEL * Math.sin((t / back) * (Math.PI / 2));
  const u = (t - back) / (SLIDE_CYCLE - back);
  return SLIDE_TRAVEL * (1 - u * u * (3 - 2 * u));
}

// ------------------------------------------------------------------ muzzle flash (squad-sidearms D7)

/** How long a squad shot's flash and its light last (s): as Jay's pistol flash. */
export const MUZZLE_FLASH_TIME = 0.055;

let flashGeometry: THREE.BufferGeometry | null = null;
let flashMaterial: THREE.Material | null = null;

/**
 * The flash sprite, in the muzzle marker's frame (bore along -Z): two crossed planes along the bore, seen from the side, and one
 * facing down it, additive and unlit like Jay's. Hidden until a shot. One shared geometry and material.
 */
function makeMuzzleFlash(): THREE.Mesh {
  if (!flashGeometry) {
    const side = new THREE.PlaneGeometry(0.05, 0.11).rotateX(-Math.PI / 2).translate(0, 0, -0.05);
    const parts = [side, side.clone().rotateZ(Math.PI / 2), new THREE.PlaneGeometry(0.06, 0.06).translate(0, 0, -0.01)].map((g) => g.toNonIndexed());
    const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.getAttribute('position').array as Float32Array, o * 3);
      o += g.getAttribute('position').count;
    }
    flashGeometry = new THREE.BufferGeometry();
    flashGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    for (const g of [side, ...parts]) g.dispose();
  }
  flashMaterial ??= new THREE.MeshBasicMaterial({ color: 0xffc47a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(flashGeometry, flashMaterial);
  mesh.name = 'muzzle_flash';
  mesh.visible = false;
  mesh.castShadow = false;
  return mesh;
}

// ------------------------------------------------------------------ the held object

let template: THREE.Object3D | null = null;
const waiting = new Set<THREE.Object3D>();

/** Give every held pistol (made already or later) the loaded model's meshes. Called once the GLB has loaded. */
export function setSquadPistolModel(scene: THREE.Object3D): void {
  template = scene;
  for (const held of waiting) fill(held);
  waiting.clear();
}

/** Has the model loaded (tests)? */
export const squadPistolModelLoaded = (): boolean => template !== null;

function fill(held: THREE.Object3D): void {
  if (!template) return;
  for (const name of ['frame', 'slide']) {
    const src = template.getObjectByName(name);
    if (!src) continue;
    const part = src.clone(true);
    part.name = `pistol_${name}`;
    part.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    (name === 'slide' ? held.userData.slide as THREE.Object3D : held).add(part);
  }
}

/** The pistol's parts a body needs at runtime. */
export interface HeldPistolParts {
  muzzle: THREE.Object3D;
  ejectPort: THREE.Object3D;
  grip: THREE.Object3D;
  /** Moves along +Z on a shot (slideOffset); holds the slide mesh. */
  slide: THREE.Object3D;
  /** The muzzle flash sprite, on the muzzle along the bore; shown for MUZZLE_FLASH_TIME after a shot. */
  flash: THREE.Object3D;
}

/** The parts of a held pistol made by makeHeldPistol. */
export function pistolParts(held: THREE.Object3D): HeldPistolParts {
  return held.userData as HeldPistolParts;
}

/**
 * A held pistol, to parent to a hand bone: its grip marker placed on `grip` (position and rotation in the hand's frame). It has
 * its markers at once; the meshes come with the model.
 */
export function makeHeldPistol(grip: { position: THREE.Vector3; quaternion: THREE.Quaternion }): THREE.Group {
  const held = new THREE.Group();
  held.name = 'held_pistol';
  const marker = (name: string, p: THREE.Vector3): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.copy(p);
    held.add(o);
    return o;
  };
  const parts: HeldPistolParts = {
    muzzle: marker('muzzle', PISTOL_MARKERS.muzzle),
    ejectPort: marker('ejectPort', PISTOL_MARKERS.ejectPort),
    grip: marker('grip', PISTOL_MARKERS.grip),
    slide: marker('slide', new THREE.Vector3()),
    flash: makeMuzzleFlash(),
  };
  parts.muzzle.add(parts.flash);
  parts.grip.quaternion.copy(PISTOL_MARKERS.gripRotation);
  Object.assign(held.userData, parts);
  // Root = grip frame x inverse(grip marker): the marker lands on the hand's grip frame.
  const frame = new THREE.Matrix4().compose(grip.position, grip.quaternion, new THREE.Vector3(1, 1, 1));
  const markerM = new THREE.Matrix4().compose(PISTOL_MARKERS.grip, PISTOL_MARKERS.gripRotation, new THREE.Vector3(1, 1, 1));
  frame.multiply(markerM.invert()).decompose(held.position, held.quaternion, held.scale);
  if (template) fill(held);
  else waiting.add(held);
  return held;
}

/** Forget a held pistol still waiting for the model (its body was disposed). */
export function releaseHeldPistol(held: THREE.Object3D): void {
  waiting.delete(held);
}

/** Load the pistol model once (browser) and hand it to every held pistol. A failed load leaves the pistols empty, markers intact. */
let loading: Promise<void> | null = null;
export function loadSquadPistolModel(): Promise<void> {
  loading ??= (async () => {
    try {
      const { createGltfLoader } = await import('../render/gltf.ts');
      // From the site root, so a page under a subpath (the cast motion sandbox) finds it too.
      const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
      const gltf = await (await createGltfLoader()).loadAsync(`${base}${SQUAD_PISTOL_URL}`);
      setSquadPistolModel(gltf.scene);
    } catch (err) {
      console.warn('[squad pistol] model failed to load; mates aim empty-handed', err);
    }
  })();
  return loading;
}

// ------------------------------------------------------------------ aim (design D3)

/**
 * Largest wrist turn (radians) the aim correction makes: about the ulnar deviation a shooter's wrist gives a pistol held square in
 * the fingers (its bore points high of the forearm otherwise); the shoulder swing has done its share first.
 */
export const AIM_CLAMP = THREE.MathUtils.degToRad(30);

const qAim = new THREE.Quaternion();
const qIdentity = new THREE.Quaternion();

/**
 * The world rotation that turns the barrel direction `barrel` toward `want` (both unit vectors), by the smallest swing, limited to
 * `clamp` radians. Writes into `out`; returns the swing's angle (radians, at most `clamp`).
 */
export function aimSwing(barrel: THREE.Vector3, want: THREE.Vector3, clamp: number, out: THREE.Quaternion): number {
  qAim.setFromUnitVectors(barrel, want);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(qAim.w), 0, 1));
  if (angle <= clamp) {
    out.copy(qAim);
    return angle;
  }
  out.slerpQuaternions(qIdentity, qAim, clamp / angle);
  return clamp;
}

/** Largest shoulder swing (radians) toward the aim line (D3), before the wrist trims: enough to follow a target off to one side. */
export const ARM_AIM_CLAMP = THREE.MathUtils.degToRad(15);
/** How long (s) the shoulder swing takes to ease fully in once the pistol shows. */
export const ARM_AIM_EASE = 0.15;
