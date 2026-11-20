import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { prepareBodyModel } from './bodyModel.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { Humanoid } from './humanoid.ts';
import { GILES, OKAFOR } from './squadLooks.ts';
import { CAST } from './castLooks.ts';
import { CollisionWorld } from '../world/collision.ts';
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';

function pointToSegmentDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-10) return p.distanceTo(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function handKnuckleWorld(h: Humanoid, side: 'L' | 'R'): THREE.Vector3 {
  return new THREE.Vector3(0, -0.095, 0).applyMatrix4(h.bones[`hand_${side}`].matrixWorld);
}

test('seated hands never penetrate thighs across cast heights (Priya, Hale, Okafor, Giles)', () => {
  const specs = [
    { name: 'priya', spec: CAST.priya! },
    { name: 'hale', spec: CAST.hale! },
    { name: 'okafor', spec: OKAFOR },
    { name: 'giles', spec: GILES },
  ];
  for (const pose of ['sit_chair', 'sit_sofa', 'sit_stool', 'sit_chair_hands']) {
    for (const { name, spec } of specs) {
      const h = new Humanoid({ ...spec, role: 'npc', pose }, enemyCtx());
      for (let i = 0; i < 30; i++) h.update(1 / 60);
      h.group.updateMatrixWorld(true);
      for (const s of ['L', 'R'] as const) {
        const wrist = h.jointWorld(`hand_${s}`);
        const knuckle = handKnuckleWorld(h, s);
        for (const ts of ['L', 'R'] as const) {
          const thighA = new THREE.Vector3(0, 0.03, 0).applyMatrix4(h.bones[`thigh_${ts}`].matrixWorld);
          const thighB = new THREE.Vector3(0, -0.43, 0).applyMatrix4(h.bones[`thigh_${ts}`].matrixWorld);
          const dW = pointToSegmentDist(wrist, thighA, thighB);
          const dK = pointToSegmentDist(knuckle, thighA, thighB);
          // Thigh radius (~0.075 * scale) + hand probe radius (~0.03): keep clear of core thigh mesh.
          assert.ok(dW > 0.085, `${name}/${pose} hand_${s} wrist clear of thigh_${ts} (${dW.toFixed(3)} m)`);
          assert.ok(dK > 0.085, `${name}/${pose} hand_${s} knuckle clear of thigh_${ts} (${dK.toFixed(3)} m)`);
        }
      }
      h.dispose();
    }
  }
});

test('hands seated at a dining_table or bar_counter collider lift onto the tabletop instead of clipping inside', () => {
  // Dining table at origin: z in [-0.45, 0.45], tabletop at y = 0.77.
  const world = new CollisionWorld();
  const table = { min: [-0.9, 0, -0.45] as const, max: [0.9, 0.77, 0.45] as const };
  world.add(table, 'bench:dining_table', 'metal');

  // Seated character facing the table (-Z) from z = 0.78 (pelvis outside table, hands reaching over table).
  const h = new Humanoid({ ...GILES, role: 'npc', pose: 'sit_chair' }, { ...enemyCtx(), colliders: world });
  h.group.position.set(0, 0, 0.78);
  h.setHeading(0);
  for (let i = 0; i < 40; i++) h.update(1 / 60);
  h.group.updateMatrixWorld(true);

  for (const s of ['L', 'R'] as const) {
    const w = h.jointWorld(`hand_${s}`);
    const k = handKnuckleWorld(h, s);
    // If horizontally over the table footprint, neither wrist nor knuckles may dip inside the table top (0.77 m).
    if (w.z <= 0.45 && w.z >= -0.45) {
      assert.ok(w.y >= 0.77, `hand_${s} wrist above tabletop (${w.y.toFixed(3)} >= 0.77)`);
    }
    if (k.z <= 0.45 && k.z >= -0.45) {
      assert.ok(k.y >= 0.77, `hand_${s} knuckle above tabletop (${k.y.toFixed(3)} >= 0.77)`);
    }
  }

  // Now raise the table slightly (0.86 m) to guarantee active hand-vs-tabletop lift & 'world' contact!
  const highWorld = new CollisionWorld();
  highWorld.add({ min: [-0.9, 0, -0.45], max: [0.9, 0.86, 0.45] }, 'bench:high_table', 'metal');
  const h2 = new Humanoid({ ...OKAFOR, role: 'npc', pose: 'sit_chair' }, { ...enemyCtx(), colliders: highWorld });
  h2.group.position.set(0, 0, 0.72);
  h2.setHeading(0);
  for (let i = 0; i < 40; i++) h2.update(1 / 60);
  h2.group.updateMatrixWorld(true);
  const wR = h2.jointWorld('hand_R');
  const kR = handKnuckleWorld(h2, 'R');
  assert.ok(wR.y >= 0.86 && kR.y >= 0.86, `hands lifted cleanly onto 0.86 m tabletop (w=${wR.y.toFixed(3)}, k=${kR.y.toFixed(3)})`);
  assert.equal(h2.handContactKind('R'), 'world', 'reports world surface contact');
  assert.ok(h2.handContactWeight('R') > 0.4, `world contact weight active (${h2.handContactWeight('R').toFixed(2)})`);

  h.dispose();
  h2.dispose();
});

test('sofa seat collider wrapping the sitter pelvis does NOT falsely eject hands upward', () => {
  // Real slice.ts sofa collider: y in [0, 0.85], z in [-0.43, 0.43], seat spot at (0, 0, -0.04).
  const world = new CollisionWorld();
  world.add({ min: [-1.3, 0, -0.43], max: [1.3, 0.85, 0.43] }, 'bench:sofa', 'rubber');

  const h = new Humanoid({ ...OKAFOR, role: 'npc', pose: 'sit_sofa' }, { ...enemyCtx(), colliders: world });
  h.group.position.set(0, 0, -0.04);
  h.setHeading(0);
  for (let i = 0; i < 40; i++) h.update(1 / 60);
  h.group.updateMatrixWorld(true);

  const wR = h.jointWorld('hand_R');
  assert.ok(wR.y < 0.82, `sofa sitter hand stays naturally on lap instead of ejecting above 0.85 m backrest (y=${wR.y.toFixed(3)})`);
  assert.notEqual(h.handContactKind('R'), 'world', 'sofa enclosing pelvis is excluded as a hand wall');
  h.dispose();
});

test('wall collider next to a reaching character pushes the hand cleanly outside the wall', () => {
  const world = new CollisionWorld();
  // Wall directly in front of the character at z in [-0.55, -0.35].
  world.add({ min: [-2, 0, -0.55], max: [2, 2.8, -0.35] }, 'wall', 'concrete');

  const h = new Humanoid({ ...GILES, role: 'npc', pose: 'aim_pistol' }, { ...enemyCtx(), colliders: world });
  h.group.position.set(0, 0, 0);
  h.setHeading(0);
  for (let i = 0; i < 40; i++) h.update(1 / 60);
  h.group.updateMatrixWorld(true);

  const wR = h.jointWorld('hand_R');
  const kR = handKnuckleWorld(h, 'R');
  assert.ok(wR.z >= -0.35, `wrist pushed outside wall (z=${wR.z.toFixed(3)} >= -0.35)`);
  assert.ok(kR.z >= -0.36, `knuckles stay outside wall (z=${kR.z.toFixed(3)} >= -0.36)`);
  assert.equal(h.handContactKind('R'), 'world');
  h.dispose();
});

test('standing idle/walk in open space stays free of false world contacts and remains stable at 30/60/120 fps', () => {
  const world = new CollisionWorld();
  world.add({ min: [-10, -0.2, -10], max: [10, 0, 10] }, 'floor', 'concrete');
  const h = new Humanoid({ ...CAST.priya!, role: 'npc', pose: 'idle' }, { ...enemyCtx(), colliders: world });
  for (const fps of [30, 60, 120]) {
    const dt = 1 / fps;
    for (let i = 0; i < fps; i++) {
      h.update(dt);
      const p = h.jointWorld('hand_R');
      assert.ok(Number.isFinite(p.x + p.y + p.z), `finite hand position at ${fps} fps`);
    }
    assert.notEqual(h.handContactKind('R'), 'world', `no false floor contact at ${fps} fps`);
  }
  h.dispose();
});

test('scientist (botanist_1..3) crossed-arm poses clear their actual off-center lab-coat chest surface', async () => {
  const { createGltfLoader } = await import('../render/gltf.ts');
  const loader = await createGltfLoader();
  for (const file of ['botanist_1.glb', 'botanist_2.glb', 'botanist_3.glb'] as const) {
    const buf = readFileSync(new URL(`../../public/assets/models/crew/${file}`, import.meta.url));
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
      images?: unknown;
      textures?: unknown;
      samplers?: unknown;
      materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown }; normalTexture?: unknown; occlusionTexture?: unknown; emissiveTexture?: unknown; extensions?: unknown }>;
    };
    delete json.images;
    delete json.textures;
    delete json.samplers;
    for (const m of json.materials ?? []) {
      delete m.pbrMetallicRoughness?.baseColorTexture;
      delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
      delete m.normalTexture;
      delete m.occlusionTexture;
      delete m.emissiveTexture;
      delete m.extensions;
    }
    let text = Buffer.from(JSON.stringify(json));
    while (text.length % 4) text = Buffer.concat([text, Buffer.from(' ')]);
    const rest = buf.subarray(20 + jsonLen);
    const head = Buffer.alloc(20);
    head.write('glTF', 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + text.length + rest.length, 8);
    head.writeUInt32LE(text.length, 12);
    head.write('JSON', 16);
    const glb = Buffer.concat([head, text, rest]);
    const gltf = await loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
    const m = prepareBodyModel(gltf.scene);
    const chestHull = m.torsoHulls.find((t) => t.joint === 'chest');
    assert.ok(chestHull, `${file}: measured chest torsoHull`);
    const chestFrontZ = chestHull.cz - chestHull.rz; // ~ -0.233 m on scientists
    assert.ok(chestFrontZ < -0.2, `${file}: chest front sits well ahead of bone (${chestFrontZ.toFixed(3)})`);

    const lib = { get: () => m } as unknown as BodyModelLibrary;
    for (const pose of ['sit_chair_crossed', 'sit_sofa_crossed'] as const) {
      const h = new Humanoid({ seed: `sci-${file}`, outfit: 'lab', role: 'npc', pose, model: 'sci' }, { ...enemyCtx(), bodyModels: lib });
      for (let i = 0; i < 30; i++) h.update(1 / 60);
      h.group.updateMatrixWorld(true);
      for (const s of ['L', 'R'] as const) {
        const handLocal = h.bones.chest.worldToLocal(h.jointWorld(`hand_${s}`));
        const midLocal = h.bones.chest.worldToLocal(
          h.jointWorld(`foreArm_${s}`).lerp(h.jointWorld(`hand_${s}`), 0.55),
        );
        assert.ok(
          handLocal.z <= chestFrontZ + 0.015,
          `${file}/${pose} hand_${s} clears chest front (${handLocal.z.toFixed(3)} <= ${(chestFrontZ + 0.015).toFixed(3)})`,
        );
        assert.ok(
          midLocal.z <= chestFrontZ + 0.035,
          `${file}/${pose} foreArm_${s} mid clears chest front (${midLocal.z.toFixed(3)} <= ${(chestFrontZ + 0.035).toFixed(3)})`,
        );
      }
      h.dispose();
    }
  }
});
