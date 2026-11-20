import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { prepareBodyModel, type PreparedBodyModel } from './bodyModel.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { MAX_BONES } from './bodyMaterial.ts';
import {
  applySympatheticCoupling,
  CAST_HAND_PERSONALITIES,
  chooseHandShape,
  extractTwistY,
  FINGER_LOD_DISTANCE,
  FINGER_NAMES,
  handPersonalityFor,
  tenodesisDelta,
  type FingerBoneDef,
} from './handPhysics.ts';
import { Humanoid } from './humanoid.ts';
import { JOINTS } from './skeleton.ts';
import { GILES, OKAFOR } from './squadLooks.ts';
import { CAST } from './castLooks.ts';
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';

async function loadWithoutTextures(url: URL): Promise<THREE.Group> {
  const buf = readFileSync(url);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: unknown;
    textures?: unknown;
    samplers?: unknown;
    materials?: Array<{
      pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
      normalTexture?: unknown;
      occlusionTexture?: unknown;
      emissiveTexture?: unknown;
      extensions?: unknown;
    }>;
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
  const { createGltfLoader } = await import('../render/gltf.ts');
  const gltf = await (await createGltfLoader()).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  return gltf.scene;
}

const modelCache = new Map<string, PreparedBodyModel>();
async function loadMainCast(id: 'mechanic' | 'doctor' | 'priya' | 'hale'): Promise<PreparedBodyModel> {
  let m = modelCache.get(id);
  if (!m) {
    const url = new URL(`../../public/assets/models/squad/${id}.glb`, import.meta.url);
    m = prepareBodyModel(await loadWithoutTextures(url), { detailHands: true });
    modelCache.set(id, m);
  }
  return m;
}

function makeLib(entries: Record<string, PreparedBodyModel>): BodyModelLibrary {
  return { get: (id: string) => entries[id] } as unknown as BodyModelLibrary;
}

test('pure biomechanical helpers: tenodesis, sympathetic coupling, and Y-twist extraction', () => {
  // Tenodesis: wrist extension (+) curls fingers (+), wrist flexion (-) opens fingers (-).
  assert.ok(tenodesisDelta(0.5) > 0.1, 'wrist extension curls fingers');
  assert.ok(tenodesisDelta(-0.5) < -0.08, 'wrist flexion relaxes fingers');
  assert.equal(tenodesisDelta(0, 0), 0);

  // Sympathetic coupling: curling only ring finger gently pulls middle & pinky, leaving thumb untouched.
  const raw = new Float32Array([0.1, 0.1, 0.1, 0.9, 0.1]);
  const out = new Float32Array(5);
  applySympatheticCoupling(raw, 1, out);
  assert.ok(Math.abs(out[0]! - 0.1) < 1e-6, 'thumb stays independent');
  assert.ok(out[2]! > 0.2, `middle sympathetically follows ring (${out[2]})`);
  assert.ok(out[4]! > 0.2, `pinky sympathetically follows ring (${out[4]})`);
  assert.ok(out[3]! < 0.9, 'ring gently moderates toward neighbors');

  // Swing-twist Y extraction recovers pure Y rotation even when combined with X/Z swing.
  const qPure = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.72);
  assert.ok(Math.abs(extractTwistY(qPure) - 0.72) < 1e-5);
  const qNeg = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.95);
  assert.ok(Math.abs(extractTwistY(qNeg) + 0.95) < 1e-5);

  // Distinct main cast hand personalities exist and stay within sane ranges.
  for (const seed of ['august-giles', 'tomas-okafor', 'priya-anand', 'director-hale']) {
    assert.ok(CAST_HAND_PERSONALITIES[seed], seed);
    const p = handPersonalityFor(seed);
    assert.ok(p.tension > 0 && p.tension < 1);
    assert.ok(p.stiffness > 0.7 && p.stiffness < 1.4);
  }
  assert.ok(handPersonalityFor('director-hale').tension > handPersonalityFor('tomas-okafor').tension, 'Hale is tenser than Okafor');
});

test('hand shape selector maps poses, speech emotes, IK, and infection to distinct shapes', () => {
  assert.equal(chooseHandShape('R', 'aim_pistol', null, 0, 'R', false, 0, false, true, false), 'grip');
  assert.equal(chooseHandShape('L', 'aim_pistol', null, 0, 'R', false, 0, false, true, false), 'cup');
  assert.equal(chooseHandShape('R', 'typing', null, 0, 'R', false, 0, false, true, false), 'typing');
  assert.equal(chooseHandShape('R', 'flex_hand', null, 0, 'R', false, 0, false, true, false), 'flex');
  assert.equal(chooseHandShape('R', 'idle', 'urgent', 0.9, 'R', false, 0, false, true, false), 'point');
  assert.equal(chooseHandShape('R', 'idle', 'question', 0.9, 'R', false, 0, false, true, false), 'open');
  assert.equal(chooseHandShape('L', 'idle', null, 0, 'R', true, 0, false, true, false), 'surface');
  assert.equal(chooseHandShape('R', 'shamble', null, 0, 'R', false, 0.8, true, true, false), 'claw');
  assert.equal(chooseHandShape('R', 'corpseSupine', null, 0, 'R', false, 0, false, false, false), 'slack');
});

test('all 4 Phase 1 main cast GLBs (Giles, Okafor, Priya, Hale) preserve 30 calibrated finger bones and valid skinning', async () => {
  for (const id of ['mechanic', 'doctor', 'priya', 'hale'] as const) {
    const m = await loadMainCast(id);
    const fingers = m.handBones.filter((b): b is FingerBoneDef => b.kind === 'finger');
    const twists = m.handBones.filter((b) => b.kind === 'twist');
    assert.equal(fingers.length, 30, `${id}: 30 finger bones (5 fingers x 3 phalanges x 2 hands)`);
    if (id !== 'mechanic') {
      assert.ok(twists.length >= 2, `${id}: preserves forearm twist bones (${twists.length})`);
    }
    // Total bones (21 joints + detail hand bones + 9 stumps) must fit inside MAX_BONES shader cap.
    assert.ok(JOINTS.length + m.handBones.length + 9 <= MAX_BONES, `${id}: fits MAX_BONES (${JOINTS.length + m.handBones.length + 9} <= ${MAX_BONES})`);

    // Verify curlAxis sweeps each finger inward into the palm (+X on L, -X on R) in canonical rest pose!
    const down = new THREE.Vector3(0, -1, 0);
    for (const s of ['L', 'R'] as const) {
      const inwardX = s === 'L' ? 1 : -1;
      for (const fn of FINGER_NAMES) {
        const f1 = fingers.find((b) => b.side === s && b.finger === fn && b.phalanx === 1);
        const f2 = fingers.find((b) => b.side === s && b.finger === fn && b.phalanx === 2);
        const f3 = fingers.find((b) => b.side === s && b.finger === fn && b.phalanx === 3);
        assert.ok(f1 && f2 && f3, `${id}: ${s} ${fn} has all 3 phalanges`);
        assert.equal(f1.parent, `hand_${s}`);
        assert.equal(f2.parent, f1.name);
        assert.equal(f3.parent, f2.name);
        if (fn !== 'thumb') {
          const ax = new THREE.Vector3(...f1.curlAxis);
          assert.ok(Math.abs(ax.length() - 1) < 1e-4, `${id} ${f1.name}: unit curlAxis`);
          // Rotating downward finger +30 deg around curlAxis must move tip inward toward body (+inwardX).
          const rotated = down.clone().applyAxisAngle(ax, 0.5);
          assert.ok(rotated.x * inwardX > 0.35, `${id} ${f1.name}: +curl moves inward (x=${rotated.x.toFixed(2)}, inward=${inwardX})`);
        }
      }
      // Specifically verify mechanic.glb's Ring1 metacarpal was folded into hand so ring_1 sits at knuckle depth!
      if (id === 'mechanic') {
        const mid1 = fingers.find((b) => b.side === s && b.finger === 'middle' && b.phalanx === 1)!;
        const ring1 = fingers.find((b) => b.side === s && b.finger === 'ring' && b.phalanx === 1)!;
        const distMid = Math.hypot(...mid1.offset);
        const distRing = Math.hypot(...ring1.offset);
        assert.ok(distRing > distMid * 0.7, `mechanic ${s}: ring_1 is at knuckle depth (${distRing.toFixed(3)} vs mid ${distMid.toFixed(3)})`);
      }
    }

    // Verify every vertex's skinIndex is in range and skinWeights sum to 1.
    const maxSlot = JOINTS.length + m.handBones.length;
    let fingerWeightedVerts = 0;
    for (const p of m.parts) {
      const si = p.geometry.getAttribute('skinIndex');
      const sw = p.geometry.getAttribute('skinWeight');
      for (let v = 0; v < si.count; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const slot = si.getComponent(v, k);
          const w = sw.getComponent(v, k);
          assert.ok(slot < maxSlot, `${id}: skinIndex ${slot} < ${maxSlot}`);
          if (slot >= JOINTS.length && w > 0.25) fingerWeightedVerts++;
          sum += w;
        }
        assert.ok(Math.abs(sum - 1) < 1e-3, `${id}: weights sum to ${sum}`);
      }
    }
    assert.ok(fingerWeightedVerts > 100, `${id}: mesh vertices actively skinned to detail hand bones (${fingerWeightedVerts})`);
  }
});

test('main cast Humanoids animate wrists, forearm twists, and individual fingers smoothly across poses, speech, IK, LOD, and severing', async () => {
  const [mechanic, doctor, priya, hale] = await Promise.all([
    loadMainCast('mechanic'),
    loadMainCast('doctor'),
    loadMainCast('priya'),
    loadMainCast('hale'),
  ]);
  const bodyModels = makeLib({ mechanic, doctor, priya, hale });
  const baseCtx = { ...enemyCtx(), bodyModels };

  // 1. Giles (mechanic): relaxed natural cascade (pinky curls more than index), flex_hand oscillates, typing moves fingers.
  const giles = new Humanoid({ ...GILES, role: 'npc' }, baseCtx);
  assert.equal(giles.hasFingerRig, true, 'Giles has full finger rig');
  for (let i = 0; i < 60; i++) giles.update(1 / 60);
  const idxCurl = giles.fingerCurl('R', 'index');
  const pnkCurl = giles.fingerCurl('R', 'pinky');
  assert.ok(pnkCurl > idxCurl + 0.08, `natural resting cascade: pinky (${pnkCurl.toFixed(2)}) > index (${idxCurl.toFixed(2)})`);

  // Switch to aim_pistol: ring/pinky grip firmly while index stays lighter on the trigger.
  giles.setPose('aim_pistol', 0.15);
  for (let i = 0; i < 50; i++) giles.update(1 / 60);
  assert.ok(giles.fingerCurl('R', 'ring') > giles.fingerCurl('R', 'index') + 0.25, 'pistol grip keeps trigger finger lighter than grip fingers');

  // Switch to flex_hand: right-hand fingers visibly open and close over time with staggered phalanges.
  giles.setPose('flex_hand', 0.1);
  let minFlex = 1;
  let maxFlex = 0;
  for (let i = 0; i < 180; i++) {
    giles.update(1 / 60);
    const c = giles.fingerCurl('R', 'middle');
    minFlex = Math.min(minFlex, c);
    maxFlex = Math.max(maxFlex, c);
  }
  assert.ok(maxFlex - minFlex > 0.35, `flex_hand opens and clenches smoothly (${minFlex.toFixed(2)}..${maxFlex.toFixed(2)})`);

  // Distance LOD: beyond FINGER_LOD_DISTANCE, finger springs pause cleanly.
  const farCam = new THREE.Vector3(0, 1.6, FINGER_LOD_DISTANCE + 8);
  const curlBeforeLod = giles.fingerCurl('R', 'middle');
  for (let i = 0; i < 30; i++) giles.update(1 / 60, farCam);
  assert.equal(giles.fingerCurl('R', 'middle'), curlBeforeLod, 'finger springs pause beyond LOD distance');

  // 2. Okafor (doctor): preserves forearm twist bones + speech gestures open palm on 'question' vs point on 'urgent'.
  const okafor = new Humanoid({ ...OKAFOR, role: 'npc' }, baseCtx);
  assert.equal(okafor.hasFingerRig, true);
  assert.equal(okafor.hasForeArmTwists, true, 'Okafor has forearm twist bones');
  okafor.speak('Are you sure about this reading?', 'question', 2.0, 'ok_q');
  for (let i = 0; i < 45; i++) okafor.update(1 / 60);
  const qMiddle = Math.min(okafor.fingerCurl('R', 'middle'), okafor.fingerCurl('L', 'middle'));
  okafor.speak('Get back behind the bulkhead now!', 'urgent', 2.0, 'ok_u');
  for (let i = 0; i < 45; i++) okafor.update(1 / 60);
  const uMaxMiddle = Math.max(okafor.fingerCurl('R', 'middle'), okafor.fingerCurl('L', 'middle'));
  const uMinIndex = Math.min(okafor.fingerCurl('R', 'index'), okafor.fingerCurl('L', 'index'));
  assert.ok(qMiddle < 0.35, `question opens palm (middle curl ${qMiddle.toFixed(2)})`);
  assert.ok(uMaxMiddle > uMinIndex + 0.25, `urgent extends index (${uMinIndex.toFixed(2)}) vs curled middle (${uMaxMiddle.toFixed(2)})`);

  // 3. Priya & Hale: IK hand target aligns wrist & conforms fingers to surface, and wrist springs react to movement.
  const priyaBody = new Humanoid({ ...CAST.priya!, role: 'npc' }, baseCtx);
  const haleBody = new Humanoid({ ...CAST.hale!, role: 'npc' }, baseCtx);
  assert.equal(priyaBody.hasFingerRig, true);
  assert.equal(priyaBody.hasForeArmTwists, true);
  assert.equal(haleBody.hasFingerRig, true);
  assert.equal(haleBody.hasForeArmTwists, true);

  priyaBody.handTargets.R = new THREE.Vector3(0.25, 1.05, -0.45);
  for (let i = 0; i < 40; i++) priyaBody.update(1 / 60);
  assert.ok(priyaBody.fingerCurl('R', 'index') < 0.45, 'IK surface conformation relaxes fingers cleanly onto console');

  // Walking + abrupt strike/movement excites inertial wrist springs smoothly at 30/60/120 fps.
  let peakWrist = 0;
  for (const fps of [30, 60, 120]) {
    const dt = 1 / fps;
    haleBody.strike('R', 0.9);
    for (let i = 0; i < Math.round(fps * 0.6); i++) {
      haleBody.move(new THREE.Vector3(0, 0, -1), dt);
      haleBody.update(dt);
      const mag = haleBody.wristSpringMagnitude('R');
      assert.ok(Number.isFinite(mag), `finite wrist spring at ${fps} fps`);
      peakWrist = Math.max(peakWrist, mag);
    }
  }
  assert.ok(peakWrist > 0.04, `inertial wrist spring reacts visibly (${peakWrist.toFixed(3)} rad)`);

  // 4. Non-finger models (procedural / 24-joint rigs) still get inertial wrist springs with zero errors.
  const plain = new Humanoid({ seed: 'plain-wrist-test', outfit: 'crew', role: 'npc' }, enemyCtx());
  assert.equal(plain.hasFingerRig, false);
  plain.strike('L', 0.8);
  let plainWrist = 0;
  for (let i = 0; i < 30; i++) {
    plain.update(1 / 60);
    plainWrist = Math.max(plainWrist, plain.wristSpringMagnitude('L'));
  }
  assert.ok(plainWrist > 0.03, `non-finger models still get inertial wrist physics (${plainWrist.toFixed(3)} rad)`);

  // 5. Severing a forearm on a finger-rigged model cleanly detaches hand + fingers without error.
  const severTarget = new Humanoid({ ...GILES, role: 'enemy', infection: 2 }, baseCtx);
  severTarget.update(1 / 60);
  const arm = severTarget.bones.foreArm_L.localToWorld(new THREE.Vector3(0, -0.12, 0));
  const from = arm.clone().add(new THREE.Vector3(-2, 0, 0));
  const hit = severTarget.raycast(from, arm.clone().sub(from).normalize());
  assert.ok(hit, 'forearm hit');
  let severed = false;
  for (let i = 0; i < 25 && !severed; i++) {
    severed = severTarget.applyHit(hit, 40, new THREE.Vector3(1, 0, 0)).severed !== null;
  }
  assert.ok(severed, 'finger-rigged forearm severs cleanly');
  for (let i = 0; i < 10; i++) severTarget.update(1 / 60);

  for (const b of [giles, okafor, priyaBody, haleBody, plain, severTarget]) b.dispose();
});

test('body-models.json enables handRig on Phase 1 main cast (mechanic, doctor, priya, hale) and keeps crowd rigs lean', () => {
  const table = JSON.parse(readFileSync(new URL('../data/body-models.json', import.meta.url), 'utf8')) as Record<string, { handRig?: boolean }>;
  for (const id of ['mechanic', 'doctor', 'priya', 'hale']) {
    assert.equal(table[id]?.handRig, true, `${id} has handRig: true`);
  }
  for (const id of ['zombieWalk', 'necromorphCrowd', 'gameChar', 'necromorph']) {
    assert.ok(!table[id]?.handRig, `crowd/enemy ${id} stays lean without handRig`);
  }
});
