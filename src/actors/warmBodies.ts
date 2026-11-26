import * as THREE from 'three';
import { Humanoid, type HumanoidContext } from './humanoid.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { HELD_GRIP_RADIUS, makeHeld, type HeldItem } from './heldProps.ts';
import { releaseHeldPistol } from './squadPistol.ts';

/**
 * One sample of every body play can show, for the loading screen to build their shaders from (session-loading "No
 * shader program is first compiled during play", openspec stop-midgame-shader-stalls D3). Samples are real bodies, so
 * their programs cannot drift from the ones play uses. three.js destroys a program with the last material using it, so
 * after the warm-up the sample materials stay alive for the whole session: removing the last enemy or corpse of a kind
 * never costs a recompile. The held items are sampled too (a body makes its mug, wand or pistol, with its muzzle
 * flash, the first time it shows one); their materials are shared ones that outlive the session.
 */
export class WarmBodies {
  /** Add to the scene for the compile and the warm frames; `release` takes it out. */
  readonly group = new THREE.Group();
  private bodies: Humanoid[] = [];
  private materials: THREE.Material[] = [];
  private held: THREE.Object3D[] = [];

  constructor(ctx: HumanoidContext, models: BodyModelLibrary) {
    this.group.name = 'warm-bodies';
    // The procedural body, then every imported model that loaded.
    const ids = [null, ...Object.keys(models.table).filter((id) => models.get(id))];
    for (const id of ids) {
      const body = new Humanoid({ role: 'enemy', seed: `warm-${id ?? 'procedural'}`, outfit: 'crew', transformable: true, ...(id ? { model: id } : {}) }, ctx);
      body.toWarmSample();
      this.group.add(body.group);
      this.bodies.push(body);
    }
    for (const item of Object.keys(HELD_GRIP_RADIUS) as HeldItem[]) {
      const object = makeHeld(item);
      this.group.add(object);
      this.held.push(object);
    }
  }

  /** The warm-up is over: free the samples' geometry and take them out of the scene. Their materials stay. */
  release(): void {
    for (const body of this.bodies) this.materials.push(...body.releaseAllButMaterials());
    this.bodies = [];
    for (const object of this.held) {
      releaseHeldPistol(object);
      object.removeFromParent();
    }
    this.held = [];
    this.group.removeFromParent();
  }

  /** Session teardown: release the materials, and with them their programs. */
  dispose(): void {
    this.release();
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }
}
