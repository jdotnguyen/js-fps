import * as THREE from 'three';
import { CreatureGait, type LimbKind } from '../../actors/creature/gait.ts';
import { createJuggernautRig, JUGGERNAUT_DEF, JUGGERNAUT_POSES } from '../../actors/creature/juggernaut.ts';
import type { CreatureRig } from '../../actors/creature/rig.ts';
import { SequencePlayer } from '../../actors/creature/sequences.ts';

/**
 * The creature of the R16 finale ("Juggernaut" GLB, see CREDITS.md). It is loaded with the session and added to the
 * scene hidden, so the loading screen uploads its textures and builds its shaders; the reveal only shows and places it
 * (session-loading "Late-appearing models load with the session", openspec stop-midgame-shader-stalls D4).
 *
 * It is posed by its creature rig (openspec rig-juggernaut D9): built on the model as loaded (neutral), then set to the pose
 * the model was exported in, which the finale has always shown. The eyes, teeth and tongue are on its head (the model was
 * repaired by scripts/fix-juggernaut-glb.mjs), and the squad aims at the rig's aim point, which rides the head.
 *
 * Its entrance is a walk (openspec juggernaut-walk-and-roar D6): from the hide anchor to the reveal anchor on its gait, in about
 * 5.2 s, looking at the squad; `act` plays a key-pose sequence (its roars) over it, and each touchdown calls `onFootfall`.
 * The height is still measured in the exported pose, so its scale and the finale's framing are unchanged.
 */

export const JUGGERNAUT_URL = 'assets/models/infected/monster_juggernaut.glb';
/** The level anchors of its entrance: where it waits behind the pillar, and where it peeks out to. */
export const JUGGERNAUT_HIDE_ANCHOR = 'r16_monster_hide';
export const JUGGERNAUT_REVEAL_ANCHOR = 'r16_monster_reveal';

/** Walking speed (m/s): the 3.4 m from behind the pillar, with the start and the settle, take about 5.2 s. */
const WALK_SPEED = 0.9;
/** The squad aims this far above the head marker (m). */
const AIM_ABOVE_HEAD = 0.8;

export interface Anchor {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
}

export type ModelLoader = (url: string) => Promise<{ scene: THREE.Object3D }>;

const gltfLoader: ModelLoader = async (url) => {
  const { createGltfLoader } = await import('../gltf.ts');
  return (await createGltfLoader()).loadAsync(url);
};

export class Juggernaut {
  readonly root: THREE.Group;
  readonly rig: CreatureRig;
  readonly gait: CreatureGait;
  readonly acts: SequencePlayer;
  /** Called on each touchdown with the limb kind and the world point. */
  onFootfall: ((kind: LimbKind, at: THREE.Vector3) => void) | null = null;
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private active = false;

  constructor(scene: THREE.Object3D) {
    scene.updateMatrixWorld(true);
    this.rig = createJuggernautRig(scene);
    this.rig.setPose(JUGGERNAUT_DEF.heightPose);
    this.rig.update(0);
    // Its height is measured on the body in that pose (skinned bounds follow the current pose once recomputed).
    const box = new THREE.Box3();
    scene.traverse((c) => {
      if (!(c instanceof THREE.Mesh)) return;
      c.frustumCulled = false;
      c.castShadow = true;
      c.receiveShadow = true;
      if (Array.isArray(c.material) || c.material.name !== 'body') return;
      if (c instanceof THREE.SkinnedMesh) c.computeBoundingBox();
      box.expandByObject(c);
    });
    const scale = JUGGERNAUT_DEF.height / Math.max(0.01, box.max.y - box.min.y);
    const centre = box.getCenter(new THREE.Vector3());
    scene.scale.setScalar(scale);
    scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
    this.root = new THREE.Group();
    this.root.name = 'r16_juggernaut';
    this.root.add(scene);
    this.root.visible = false;
    // It walks in its neutral stance; the gait measures its standing places there.
    this.rig.setPose(null);
    this.rig.update(0);
    this.gait = new CreatureGait(this.rig, this.root);
    this.gait.onTouchdown = (_side, at, kind) => this.onFootfall?.(kind, at);
    this.acts = new SequencePlayer(this.rig, JUGGERNAUT_POSES);
  }

  /**
   * Show it behind the pillar and walk it out to the peek anchor, looking at `lookAt` (the squad). A missing anchor keeps
   * the last place it was given.
   */
  reveal(hide: Anchor | null, peek: Anchor | null, lookAt: THREE.Vector3 | null = null): void {
    if (hide) this.start.set(hide.pos.x, hide.pos.y, hide.pos.z);
    if (peek) this.end.set(peek.pos.x, peek.pos.y, peek.pos.z);
    const dx = this.end.x - this.start.x;
    const dz = this.end.z - this.start.z;
    const yaw = Math.hypot(dx, dz) > 1e-3 ? Math.atan2(dx, dz) : (peek?.yaw ?? this.root.rotation.y);
    this.acts.stop();
    this.rig.setPose(null);
    this.rig.setFace({ jaw: 0, tongueExtend: 0, tongueCurl: 0 });
    this.rig.setLimbWeight('arm.L', 1);
    this.rig.setLimbWeight('arm.R', 1);
    this.rig.setLookWeight(1);
    this.rig.setLookTarget(lookAt);
    this.gait.placeAt(this.start, yaw);
    if (Math.hypot(dx, dz) > 1e-3) this.gait.walk([this.start, this.end], WALK_SPEED);
    this.rig.update(0);
    this.active = true;
    this.root.visible = true;
  }

  /** Play one of its key-pose sequences (`roar_walk`, `roar_full`) over its walk or stance. */
  act(sequence: string): void {
    this.acts.play(sequence);
  }

  hide(): void {
    this.active = false;
    this.acts.stop();
    this.root.visible = false;
  }

  /** One simulation step: the sequence, the walk, then the rig. */
  update(dt: number): void {
    if (!this.active) return;
    this.acts.update(dt);
    this.gait.update(dt);
    this.rig.update(dt);
  }

  /** Where the squad aims: above the rig's aim point, which rides the head. */
  aimPoint(out: THREE.Vector3): THREE.Vector3 | null {
    this.rig.aimPoint(out);
    out.y += AIM_ABOVE_HEAD;
    return out;
  }

  /** Take it out of the scene and release its geometry, materials, textures and skeletons. */
  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const skeletons = new Set<THREE.Skeleton>();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const g of geometries) g.dispose();
    for (const s of skeletons) s.dispose();
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    this.root.removeFromParent();
  }
}

/** Load and prepare the creature, or null (with a warning) when its model cannot be loaded. */
export async function loadJuggernaut(baseUrl = '/', load: ModelLoader = gltfLoader): Promise<Juggernaut | null> {
  const url = baseUrl.replace(/\/?$/, '/') + JUGGERNAUT_URL;
  try {
    return new Juggernaut((await load(url)).scene);
  } catch (err) {
    console.warn(`[r16] failed to load ${JUGGERNAUT_URL}; the finale runs without the creature`, err);
    return null;
  }
}
