/**
 * adopt-physics-engine Block 0 trial panel for the actors sandbox (`/sandbox/actors.html?physics`).
 *
 *   [J] throw a severed limb at the east wall      [K] chest-shoot a shambler standing on the stairs
 *   [L] spawn a powered shambler, then shove it    [B] bench: 6 ragdolls + 24 limbs, step time over 3 s
 *   [X] clear
 *
 * Uses procedural shamblers (no imported body models): the trial ragdoll assumes the procedural rig's rest pose.
 * Loaded lazily, so the sandbox without `?physics` never fetches the engine.
 */
import * as THREE from 'three';
import { Humanoid, type HumanoidContext } from '../actors/humanoid.ts';
import type { Materials } from '../render/materials.ts';
import type { BodyHandle, PhysicsEngine } from '../physics/engine.ts';
import { createRapierEngine } from '../physics/rapierAdapter.ts';
import { TrialRagdoll } from '../physics/trialRagdoll.ts';

const STEP = 1 / 60;
const MAX_LIMBS = 24;
/** World-space pose drive for the powered case (see `trialRagdoll.test.ts`). */
const DRIVE = { stiffness: 1600, damping: 70 };
/** Stairs: four 0.2 m steps rising toward +x against the east wall, 2 m wide (z 2..4). */
const STAIRS = { x0: 4.3, run: 0.6, rise: 0.2, z0: 2, z1: 4, steps: 4 };

interface Limb {
  body: BodyHandle;
  mesh: THREE.Mesh;
}

interface Ragdoll {
  h: Humanoid;
  r: TrialRagdoll;
  powered: boolean;
  born: number;
  settledAt: number | null;
  /** Powered: distance from the animated pose, measured after the step and before the bones take the physics pose. */
  poseError: number;
}

export interface PhysicsTrial {
  /** Fixed-step update (call once per sim step). */
  update(dt: number): void;
  hud(): string[];
  /** Handle a key; true if the trial used it. */
  key(code: string, camera: THREE.Camera): boolean;
}

export async function createPhysicsTrial(scene: THREE.Scene, ctx: HumanoidContext, mats: Materials): Promise<PhysicsTrial> {
  const engine: PhysicsEngine = await createRapierEngine();
  const group = new THREE.Group();
  group.name = 'physics-trial';
  scene.add(group);

  // ---------------------------------------------------------------- static world (matches the sandbox room)
  const fixedBox = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
    engine.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: hx, y: hy, z: hz } }, offset: { x, y, z }, friction: 0.9 }, null);
  };
  fixedBox(8, 0.1, 8, 0, -0.1, 0);
  fixedBox(8, 1.7, 0.1, 0, 1.7, -8.1);
  fixedBox(0.1, 1.7, 8, -7.1, 1.7, 0);
  fixedBox(0.1, 1.7, 8, 7.1, 1.7, 0);
  fixedBox(8, 1.7, 0.1, 0, 1.7, 8.1);
  const stairMat = mats.paintBone;
  for (let i = 0; i < STAIRS.steps; i++) {
    const top = STAIRS.rise * (i + 1);
    const x = STAIRS.x0 + STAIRS.run * i + STAIRS.run / 2;
    const zc = (STAIRS.z0 + STAIRS.z1) / 2;
    const hz = (STAIRS.z1 - STAIRS.z0) / 2;
    fixedBox(STAIRS.run / 2, top / 2, hz, x, top / 2, zc);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(STAIRS.run, top, hz * 2), stairMat);
    mesh.position.set(x, top / 2, zc);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  const limbs: Limb[] = [];
  const ragdolls: Ragdoll[] = [];
  const limbGeo = new THREE.CapsuleGeometry(0.045, 0.26, 4, 10);
  const limbMat = new THREE.MeshStandardMaterial({ color: 0x6d4a42, roughness: 0.7 });
  let time = 0;
  let nextGroup = 1;
  let status = 'Physics trial ready.';
  let bench: { steps: number; total: number; peak: number; samples: number[] } | null = null;
  const stepMs: number[] = [];

  const removeLimb = (l: Limb): void => {
    engine.destroyBody(l.body);
    group.remove(l.mesh);
  };
  const throwLimb = (from: THREE.Vector3, dir: THREE.Vector3, speed: number): void => {
    if (limbs.length >= MAX_LIMBS) removeLimb(limbs.shift()!);
    const v = dir.clone().normalize().multiplyScalar(speed);
    const body = engine.createBody({
      kind: 'dynamic',
      position: { x: from.x, y: from.y, z: from.z },
      linvel: { x: v.x, y: v.y, z: v.z },
      angvel: { x: 4, y: 9, z: 2 },
      ccd: true,
      angularDamping: 0.3,
    });
    engine.createCollider({ shape: { kind: 'capsule', halfHeight: 0.13, radius: 0.045 }, density: 1050, friction: 0.8, contactEvents: true }, body);
    const mesh = new THREE.Mesh(limbGeo, limbMat);
    mesh.castShadow = true;
    group.add(mesh);
    limbs.push({ body, mesh });
  };

  const spawnShambler = (x: number, y: number, z: number, heading: number): Humanoid => {
    // No body-model library in the context: always the procedural rig.
    const h = new Humanoid({ seed: `trial-${nextGroup}-${ragdolls.length}`, outfit: 'crew', role: 'enemy', infection: 1 }, { poses: ctx.poses, gore: ctx.gore });
    h.group.position.set(x, y, z);
    h.setHeading(heading);
    h.update(STEP, null);
    h.group.updateMatrixWorld(true);
    group.add(h.group);
    return h;
  };
  const addRagdoll = (h: Humanoid, powered: boolean): Ragdoll => {
    const r = new TrialRagdoll(engine, h.bones, { group: nextGroup, kinematicPelvis: powered });
    nextGroup = (nextGroup % 15) + 1;
    const d: Ragdoll = { h, r, powered, born: time, settledAt: null, poseError: 0 };
    ragdolls.push(d);
    return d;
  };
  const removeRagdoll = (d: Ragdoll): void => {
    d.r.destroy();
    group.remove(d.h.group);
    d.h.dispose();
  };
  const clear = (): void => {
    for (const l of limbs) removeLimb(l);
    limbs.length = 0;
    for (const d of ragdolls) removeRagdoll(d);
    ragdolls.length = 0;
    bench = null;
    engine.drainContacts();
  };

  const horizontal = (camera: THREE.Camera): THREE.Vector3 => {
    const f = camera.getWorldDirection(new THREE.Vector3());
    f.y = 0;
    return f.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, -1) : f.normalize();
  };

  return {
    update(dt) {
      time += dt;
      for (const d of ragdolls) {
        d.h.update(dt, null);
        d.h.group.updateMatrixWorld(true);
        if (d.powered) d.r.driveToBonesWorld(DRIVE.stiffness, DRIVE.damping, dt);
      }
      const t0 = performance.now();
      engine.step(dt);
      const ms = performance.now() - t0;
      stepMs.push(ms);
      if (stepMs.length > 120) stepMs.shift();
      if (bench) {
        bench.steps++;
        bench.total += ms;
        bench.peak = Math.max(bench.peak, ms);
        if (bench.steps === 180) {
          status = `BENCH 6 ragdolls + 24 limbs: step avg ${(bench.total / bench.steps).toFixed(2)} ms, peak ${bench.peak.toFixed(2)} ms (budget 1.5 / 3)`;
          console.info(`[physics-trial] ${status}`);
          bench = null;
        }
      }
      for (const d of ragdolls) {
        if (d.powered) d.poseError = d.r.poseError();
        d.r.writeBones();
        if (!d.powered && d.settledAt === null && time - d.born > 0.5 && d.r.maxSpeed() < 0.05) {
          d.settledAt = time - d.born;
          status = `Ragdoll settled after ${d.settledAt.toFixed(2)} s.`;
        }
      }
      for (const l of limbs) {
        const t = engine.transform(l.body);
        l.mesh.position.set(t.position.x, t.position.y, t.position.z);
        l.mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      }
      for (const c of engine.drainContacts()) {
        if (c.point.x > 6.8) status = `Limb hit the east wall at x ${c.point.x.toFixed(2)} (face at 7.00); no tunnelling if it stays west of it.`;
      }
    },

    hud() {
      const avg = stepMs.length ? stepMs.reduce((a, b) => a + b, 0) / stepMs.length : 0;
      const peak = stepMs.length ? Math.max(...stepMs) : 0;
      const counts = engine.liveCounts();
      const powered = ragdolls.find((d) => d.powered);
      return [
        ``,
        `PHYSICS TRIAL · ${engine.name}   [J] limb  [K] stairs kill  [L] powered/shove  [B] bench  [X] clear`,
        `step ${avg.toFixed(2)} ms avg, ${peak.toFixed(2)} ms peak (2 s)   bodies ${counts.bodies}  joints ${counts.joints}  limbs ${limbs.length}`,
        powered ? `powered pose error ${(powered.poseError * 100).toFixed(1)} cm` : '',
        status,
      ];
    },

    key(code, camera) {
      if (code === 'KeyJ') {
        const from = camera.position.clone().add(new THREE.Vector3(0, -0.3, 0));
        const toWall = new THREE.Vector3(7, 1.0, from.z - 1).sub(from);
        throwLimb(from, toWall, 30);
        status = 'Limb thrown at the east wall at 30 m/s.';
        return true;
      }
      if (code === 'KeyK') {
        // Third step, facing down the stairs (-x); shot along the camera's horizontal direction.
        const x = STAIRS.x0 + STAIRS.run * 2.5;
        const h = spawnShambler(x, STAIRS.rise * 3, (STAIRS.z0 + STAIRS.z1) / 2, Math.PI / 2);
        const d = addRagdoll(h, false);
        const shot = horizontal(camera).multiplyScalar(35);
        engine.applyImpulse(d.r.body('chest')!, { x: shot.x, y: 0, z: shot.z });
        status = 'Shambler shot in the chest on the stairs.';
        return true;
      }
      if (code === 'KeyL') {
        const existing = ragdolls.find((d) => d.powered);
        if (!existing) {
          const h = spawnShambler(2.5, 0, 0.5, Math.atan2(camera.position.x - 2.5, camera.position.z - 0.5));
          addRagdoll(h, true);
          status = 'Powered shambler: press [L] again to shove its right shoulder.';
        } else {
          const shove = horizontal(camera).multiplyScalar(60);
          engine.applyImpulse(existing.r.body('upperArm_R')!, { x: shove.x, y: 0, z: shove.z });
          engine.applyImpulse(existing.r.body('chest')!, { x: shove.x, y: 0, z: shove.z });
          status = 'Shoved the powered shambler.';
        }
        return true;
      }
      if (code === 'KeyB') {
        clear();
        for (let i = 0; i < 6; i++) {
          const h = spawnShambler(-3 + i * 1.1, 0.3, 1.5 + (i % 2) * 0.6, i * 0.9);
          addRagdoll(h, false);
        }
        for (let i = 0; i < MAX_LIMBS; i++) throwLimb(new THREE.Vector3(-2 + (i % 6) * 0.7, 1.4 + Math.floor(i / 6) * 0.3, 3.5), new THREE.Vector3(1, 0.1, -0.2 + (i % 5) * 0.1), 12 + (i % 4) * 4);
        bench = { steps: 0, total: 0, peak: 0, samples: [] };
        status = 'Bench running for 3 s...';
        return true;
      }
      if (code === 'KeyX') {
        clear();
        status = 'Cleared.';
        return true;
      }
      return false;
    },
  };
}
