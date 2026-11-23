import * as THREE from 'three';
import type { WeaponId } from './rig.ts';

/**
 * First-person weapon viewmodels loaded from the animated GLBs in public/assets/models/weapons/
 * (skinned arms + gun, one clip per action): "AnimatedPistol" and "Animated Shotgun" by JUST, CC BY 4.0, rebuilt by
 * `node scripts/fix-just-weapons-glb.mjs` (the Sketchfab gun meshes are out of step with their skin; the script takes the
 * gun from the author's FBX). The models face +Z with Y up and are authored about 0.024 m per unit (a hand is 8 units
 * long); `GlbWeapon.model` is scaled to metres and turned half a circle so the gun points down -Z like the rest of the
 * game, and `root` is the node the Viewmodel poses (sway, aim, sprint) in camera space.
 */

export interface WeaponModelSpec {
  url: string;
  /** Metres per model unit. One value for both weapons, so the gloves are the same size in each. */
  scale: number;
  /** Point of the model (model space, rest pose, model units) that pose positions refer to; also the pivot for pose rotations. The grip. */
  ref: [number, number, number];
  /** The bone the gun's recoil and the muzzle follow. */
  bone: string;
  /** The muzzle (model space, rest pose, model units), carried by `bone` so it follows the recoil animation. */
  muzzle: [number, number, number];
}

/** Metres per model unit: a gloved hand is 8 units (0.19 m), the shotgun 42 (1.0 m), the Colt 11 (0.26 m). */
export const MODEL_SCALE = 0.024;

export const WEAPON_MODELS: Record<WeaponId, WeaponModelSpec> = {
  pistol: { url: 'assets/models/weapons/pistol.glb', scale: MODEL_SCALE, ref: [-0.487, 29.433, 10.256], bone: 'Base', muzzle: [-0.66, 31.1, 18.3] },
  shotgun: { url: 'assets/models/weapons/shotgun.glb', scale: MODEL_SCALE, ref: [-0.776, 31.123, 6.167], bone: 'Base', muzzle: [-2.26, 31.4, 33.0] },
};

/** Clip names, with the "Armature|" prefix the export adds stripped. `Rest` is made here (see GlbWeapon). */
export type ClipName = 'Take' | 'Hide' | 'Shoot' | 'Reload' | 'ReloadStart' | 'ReloadEnd' | 'Watch' | 'Rest';

export interface PlayOptions {
  /** Cross-fade seconds from whatever is playing (0 = hard cut). */
  fade?: number;
  /** Playback speed multiplier. */
  speed?: number;
  /** Start offset in seconds. */
  from?: number;
  loop?: boolean;
}

/**
 * A clip that holds one frame of `clip` (a two-key loop of identical poses, so nothing moves). Every clip of these models
 * starts and ends on the same pose, which is `Take`'s last frame; `Take` keys every bone, the others only some.
 */
function holdFrame(clip: THREE.AnimationClip, name: string, which: 'first' | 'last'): THREE.AnimationClip {
  const tracks = clip.tracks.map((tr) => {
    const n = tr.getValueSize();
    const at = which === 'first' ? 0 : tr.values.length - n;
    const held = Array.from(tr.values.slice(at, at + n));
    const Ctor = tr.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Ctor(tr.name, [0, 0.1], [...held, ...held]);
  });
  return new THREE.AnimationClip(name, 0.1, tracks);
}

export class GlbWeapon {
  readonly id: WeaponId;
  /** Posed by the Viewmodel each frame (position + rotation about the reference point). */
  readonly root = new THREE.Group();
  /** The loaded scene, scaled to metres, turned to face -Z and shifted so the reference point is the root's origin. */
  readonly model: THREE.Object3D;
  /** Follows the gun's muzzle through the animation. */
  readonly muzzle = new THREE.Object3D();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly durations = new Map<string, number>();
  private current: THREE.AnimationAction | null = null;
  private currentName: ClipName | null = null;
  private readonly bone: THREE.Object3D;

  constructor(id: WeaponId, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, spec: WeaponModelSpec) {
    this.id = id;
    this.model = gltf.scene;
    // Scale to metres, half turn about Y (model +Z -> game -Z), then move the reference point to the origin:
    // v' = s * (-x + rx, y - ry, -z + rz).
    this.model.scale.setScalar(spec.scale);
    this.model.rotation.y = Math.PI;
    this.model.position.set(spec.ref[0] * spec.scale, -spec.ref[1] * spec.scale, spec.ref[2] * spec.scale);
    this.root.add(this.model);
    this.root.rotation.order = 'YXZ';
    this.model.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 10;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // Screen-space AO is tuned for the level (1 m radius); a gun 0.13-0.3 m from the lens sits inside it and came out
        // streaked. Flagged meshes are drawn after the AO pass and neither shaded by it nor read by it (post.ts skipsAo).
        mesh.userData['skipGtao'] = true;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const name = clip.name.replace(/^.*\|/, '');
      this.actions.set(name, this.mixer.clipAction(clip));
      this.durations.set(name, clip.duration);
    }
    // Rest pose: `Take`'s last frame (the hands on the gun), held.
    const take = gltf.animations.find((c) => c.name.endsWith('|Take'));
    if (take) {
      const rest = holdFrame(take, 'Rest', 'last');
      this.actions.set('Rest', this.mixer.clipAction(rest));
      this.durations.set('Rest', rest.duration);
    }
    this.bone = this.model.getObjectByName(spec.bone) ?? this.model;
    this.playRest(0);
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    // The muzzle is given in rest-pose model space; carry it in the bone's own space (the bone is scaled and turned).
    const muzzleWorld = this.model.localToWorld(new THREE.Vector3(...spec.muzzle));
    this.muzzle.position.copy(this.bone.worldToLocal(muzzleWorld));
    this.bone.add(this.muzzle);
  }

  /** The clip last started (null before the first). */
  get clip(): ClipName | null {
    return this.currentName;
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

/** The two models are one author's, with one pair of gloves, so the shotgun uses the pistol's glove textures. */
function shareGloveTextures(from: GlbWeapon, to: GlbWeapon): void {
  const gloveOf = (w: GlbWeapon): THREE.MeshStandardMaterial | null => {
    let found: THREE.MeshStandardMaterial | null = null;
    w.model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.name === 'glove_hardknuckle') found = m;
    });
    return found;
  };
  const a = gloveOf(from);
  const b = gloveOf(to);
  if (!a || !b) return;
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    if (!a[slot] || !b[slot] || a[slot] === b[slot]) continue;
    const spare = b[slot];
    b[slot] = a[slot];
    // roughnessMap and metalnessMap are one texture in glTF: dispose it once, after both slots are swapped.
    if (slot !== 'roughnessMap' || b.metalnessMap !== spare) spare?.dispose();
  }
  b.needsUpdate = true;
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
  shareGloveTextures(out.pistol, out.shotgun);
  return out;
}
