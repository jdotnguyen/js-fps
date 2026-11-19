import * as THREE from 'three';
import type { WeaponId } from './rig.ts';

/**
 * First-person weapon viewmodels loaded from the animated GLBs in public/assets/models/weapons/
 * (skinned arms + gun, one clip per action). The models face +Z with Y up and sit about the origin of
 * their own "camera"; `GlbWeapon.model` is turned half a circle so the gun points down -Z like the rest
 * of the game, and `root` is the node the Viewmodel poses (sway, aim, sprint) in camera space.
 *
 * The shotgun file ships with a gun mesh 10,000x too large, facing backwards and upside down; run
 * `node scripts/fix-weapon-glb.mjs` once on a fresh export (the committed file is already fixed).
 */

export interface WeaponModelSpec {
  url: string;
  /** Point of the model (model space, metres) that pose positions refer to; also the pivot for pose rotations. */
  ref: [number, number, number];
  /** Muzzle in the local space of the `weapon_039` bone, so it follows the recoil animation. */
  muzzle: [number, number, number];
  /** Looping clip played while nothing else is; null = hold the first frame of the Fire clip. */
  idle: string | null;
}

export const WEAPON_MODELS: Record<WeaponId, WeaponModelSpec> = {
  pistol: { url: 'assets/models/weapons/pistol.glb', ref: [0, 0.1, 0.35], muzzle: [0, 0.181, 0.285], idle: 'Idle' },
  shotgun: { url: 'assets/models/weapons/shotgun.glb', ref: [0, 0, 0], muzzle: [0, 1.119, 0.027], idle: null },
};

/** Clip names, with the "Armature|" prefix the export adds stripped. */
export type ClipName = 'Fire' | 'PostFire' | 'Hide' | 'Unhide' | 'Weild' | 'Idle' | 'ReloadClip' | 'EmptyClipReload' | 'PriorToReload' | 'ReloadOne' | 'ReloadLastOne' | 'Rest';

export interface PlayOptions {
  /** Cross-fade seconds from whatever is playing (0 = hard cut). */
  fade?: number;
  /** Playback speed multiplier. */
  speed?: number;
  /** Start offset in seconds. */
  from?: number;
  loop?: boolean;
}

/** A clip that holds the first frame of `clip` (a two-key loop of identical poses, so nothing moves). */
function holdFirstFrame(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const tracks = clip.tracks.map((tr) => {
    const n = tr.getValueSize();
    const first = Array.from(tr.values.slice(0, n));
    const Ctor = tr.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Ctor(tr.name, [0, 0.1], [...first, ...first]);
  });
  return new THREE.AnimationClip(name, 0.1, tracks);
}

export class GlbWeapon {
  readonly id: WeaponId;
  /** Posed by the Viewmodel each frame (position + rotation about the reference point). */
  readonly root = new THREE.Group();
  /** The loaded scene, turned to face -Z and shifted so the reference point is the root's origin. */
  readonly model: THREE.Object3D;
  /** Follows the gun's muzzle through the animation. */
  readonly muzzle = new THREE.Object3D();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly durations = new Map<string, number>();
  private current: THREE.AnimationAction | null = null;
  private currentName: ClipName | null = null;
  private readonly bone: THREE.Object3D;
  private readonly restPos = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor(id: WeaponId, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, spec: WeaponModelSpec) {
    this.id = id;
    this.model = gltf.scene;
    // Half turn about Y (model +Z -> game -Z), then move the reference point to the origin: v' = (-x + rx, y - ry, -z + rz).
    this.model.rotation.y = Math.PI;
    this.model.position.set(spec.ref[0], -spec.ref[1], spec.ref[2]);
    this.root.add(this.model);
    this.root.rotation.order = 'YXZ';
    this.model.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 10;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const name = clip.name.replace(/^.*\|/, '');
      this.actions.set(name, this.mixer.clipAction(clip));
      this.durations.set(name, clip.duration);
    }
    // Rest pose: the looping idle if the model has one, otherwise the first frame of Fire held still.
    const idleClip = spec.idle ? gltf.animations.find((c) => c.name.endsWith(`|${spec.idle}`)) : undefined;
    const fire = gltf.animations.find((c) => c.name.endsWith('|Fire'));
    const rest = idleClip ?? (fire ? holdFirstFrame(fire, 'Rest') : undefined);
    if (rest) {
      this.actions.set('Rest', this.mixer.clipAction(rest));
      this.durations.set('Rest', rest.duration);
    }
    this.bone = this.model.getObjectByName('weapon_039') ?? this.model;
    this.muzzle.position.set(...spec.muzzle);
    this.bone.add(this.muzzle);
    this.playRest(0);
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    this.restPos.copy(this.bone.getWorldPosition(this.scratch));
    this.model.worldToLocal(this.restPos);
  }

  /** The clip last started (null before the first). */
  get clip(): ClipName | null {
    return this.currentName;
  }

  /**
   * How far the gun bone has moved from its rest pose, in game camera axes (X right, Y up, -Z forward).
   * Fire and PostFire throw the whole rig back by a third of a metre; the Viewmodel cancels part of that
   * so the gun does not fly into the player's face.
   */
  recoilDelta(out: THREE.Vector3): THREE.Vector3 {
    this.model.updateMatrixWorld(true);
    this.bone.getWorldPosition(out);
    this.model.worldToLocal(out);
    out.sub(this.restPos);
    // Model space faces +Z; the root turns it half a circle about Y.
    out.set(-out.x, out.y, -out.z);
    return out;
  }

  has(name: ClipName): boolean {
    return this.actions.has(name);
  }

  /** Clip length in seconds (0 if the model lacks the clip). */
  duration(name: ClipName): number {
    return this.durations.get(name) ?? 0;
  }

  play(name: ClipName, opts: PlayOptions = {}): void {
    const next = this.actions.get(name);
    if (!next) return;
    const { fade = 0.05, speed = 1, from = 0, loop = false } = opts;
    const prev = this.current;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = true;
    next.timeScale = speed;
    next.time = from;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) {
      if (fade > 0) prev.crossFadeTo(next, fade, false);
      else prev.stop();
    }
    this.current = next;
    this.currentName = name;
  }

  playRest(fade = 0.1): void {
    this.play('Rest', { fade, loop: true });
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}

/** Load both weapon models (the GLTF loader is split out of the main bundle). */
export async function loadWeaponModels(): Promise<Record<WeaponId, GlbWeapon>> {
  const { createGltfLoader } = await import('../gltf.ts');
  const loader = await createGltfLoader();
  const ids = Object.keys(WEAPON_MODELS) as WeaponId[];
  const gltfs = await Promise.all(ids.map((id) => loader.loadAsync(WEAPON_MODELS[id].url)));
  const out = {} as Record<WeaponId, GlbWeapon>;
  ids.forEach((id, i) => {
    out[id] = new GlbWeapon(id, gltfs[i]!, WEAPON_MODELS[id]);
  });
  return out;
}
