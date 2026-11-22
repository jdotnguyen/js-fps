import * as THREE from 'three';

/**
 * The first-person flashlight (player-flashlight spec): "Flashlight" by MAR.COS. (CC BY 4.0), held low on the left with
 * no hand drawn, so its tail always runs off the left/bottom edge of the screen and it never reads as floating.
 * `scripts/import-flashlight.mjs` bakes the GLB: lens centre at the origin, the body along +Z, LENGTH metres long.
 */

export const FLASHLIGHT_URL = 'assets/models/weapons/flashlight.glb';
export const FLASHLIGHT_LENGTH = 0.22;
/** Lens depth in front of the eye (m). */
const LENS_DEPTH = 0.3;
/** Where the lens sits on screen, in NDC (-1 left/bottom edge, 1 right/top edge). */
const LENS_NDC = { x: -0.56, y: -0.5 };
/** The lens points this far in toward the screen centre and up (radians), so the tail angles out to the corner. */
const YAW_IN = THREE.MathUtils.degToRad(6);
const PITCH_UP = THREE.MathUtils.degToRad(4);
/** Raise / lower time (s): the spec allows 0.15-0.35. */
export const RAISE_TIME = 0.25;
/** Lowered pose: this far down and tipped forward, fully below the screen. */
const LOWER_DROP = 0.24;
const LOWER_TIP = THREE.MathUtils.degToRad(35);

export interface FlashlightPose {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

/** The held pose in camera space for a vertical field of view (degrees) and an aspect ratio. */
export function flashlightPose(fovDeg: number, aspect: number): FlashlightPose {
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const tanH = tanV * aspect;
  const position = new THREE.Vector3(LENS_NDC.x * LENS_DEPTH * tanH, LENS_NDC.y * LENS_DEPTH * tanV, -LENS_DEPTH);
  // rotation.y < 0 turns the lens (-Z) toward +X (the centre) and swings the tail (+Z) out to the left.
  const rotation = new THREE.Euler(PITCH_UP, -YAW_IN, 0, 'YXZ');
  return { position, rotation };
}

/** Camera-space point at `along` metres from the lens down the body (0 = lens, LENGTH = tail end). */
export function pointAlong(pose: FlashlightPose, along: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 0, along).applyEuler(pose.rotation).add(pose.position);
}

/** NDC of a camera-space point (x, y), or null when it is behind the eye. */
export function toNdc(p: THREE.Vector3, fovDeg: number, aspect: number): { x: number; y: number } | null {
  const depth = -p.z;
  if (depth <= 1e-4) return null;
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  return { x: p.x / (depth * tanV * aspect), y: p.y / (depth * tanV) };
}

/**
 * The held flashlight: a camera-space group (child of the viewmodel group) that rises when the light is on with the
 * pistol or no weapon out, and lowers away for the shotgun or when the light goes off.
 */
export class FlashlightProp {
  readonly group = new THREE.Group();
  /** The lens, for the beam's origin. */
  readonly lens = new THREE.Object3D();
  private model: THREE.Object3D | null = null;
  private readonly glows: THREE.MeshStandardMaterial[] = [];
  /** 0 lowered, 1 held. */
  private raise = 0;

  constructor() {
    this.group.name = 'viewmodel-flashlight';
    this.group.visible = false;
    this.group.add(this.lens);
  }

  /** Attach the loaded GLB scene. Until then nothing shows and the beam stays at the chest. */
  setModel(scene: THREE.Object3D): void {
    this.model = scene;
    scene.traverse((o) => {
      o.frustumCulled = false;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.renderOrder = 10;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m instanceof THREE.MeshStandardMaterial && m.emissiveMap) this.glows.push(m);
      }
    });
    this.group.add(scene);
  }

  /** Fully up (the spec's "on screen"). */
  get held(): boolean {
    return this.model !== null && this.raise > 0.999;
  }

  /** Any part of it is up. */
  get shown(): boolean {
    return this.model !== null && this.raise > 0.001;
  }

  /**
   * Step the raise toward `wanted`, place the group for this camera with the weapon's sway (`sway`: small camera-space
   * offsets in metres and radians), and light the lens by the beam's level (0..1).
   */
  update(dt: number, wanted: boolean, camera: THREE.PerspectiveCamera, sway: { x: number; y: number; rx: number; ry: number }, glow: number): void {
    const goal = wanted && this.model ? 1 : 0;
    const step = dt / RAISE_TIME;
    this.raise = this.raise < goal ? Math.min(goal, this.raise + step) : Math.max(goal, this.raise - step);
    this.group.visible = this.shown;
    if (!this.group.visible) return;
    const pose = flashlightPose(camera.fov, camera.aspect);
    const e = this.raise * this.raise * (3 - 2 * this.raise);
    const down = 1 - e;
    this.group.position.set(pose.position.x + sway.x, pose.position.y + sway.y - LOWER_DROP * down, pose.position.z);
    this.group.rotation.set(pose.rotation.x + sway.rx - LOWER_TIP * down, pose.rotation.y + sway.ry, 0, 'YXZ');
    for (const m of this.glows) m.emissiveIntensity = glow;
  }
}
