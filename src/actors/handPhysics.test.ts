import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAX_BONES } from './bodyMaterial.ts';
import type { PreparedBodyModel } from './bodyModel.ts';
import {
  applySympatheticCoupling,
  chooseHandShape,
  extractTwistY,
  FINGER_LOD_DISTANCE,
  FINGER_NAMES,
  HAND_SHAPE_CURLS,
  handPersonalityFor,
  phalanxCurlAngle,
  tenodesisDelta,
  type FingerBoneDef,
} from './handPhysics.ts';
import { Humanoid } from './humanoid.ts';
import { JOINTS } from './skeleton.ts';
import { GILES, OKAFOR } from './squadLooks.ts';
import { CAST } from './castLooks.ts';
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { loadMainCast, makeLib } from './castModelTestKit.ts';
import { bodyModelsJson } from '../data/bodyModelFiles.ts';

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

  // Seeded crew hands stay within sane ranges (named characters' hands live in their motion profiles).
  for (const seed of ['crew:a', 'crew:b', 'crew:c']) {
    const p = handPersonalityFor(seed);
    assert.ok(p.tension > 0 && p.tension < 1);
    assert.ok(p.stiffness > 0.7 && p.stiffness < 1.4);
  }
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

// Every named character's body (Giles mechanic, Okafor doctor, Priya, Hale, Voss office_3, and the scan bodies Bram, Heins, Ruiz and
// Sung, rigged by scripts/lib/hand-rig.mjs: per-character-motion task 5.5).
/** Scan bodies rigged by scripts/lib/hand-rig.mjs (their hands keep the scan's roll). */
const SCAN_HANDS: ReadonlySet<string> = new Set(['bram', 'heins', 'ruiz', 'sung']);

test("every named character's body carries 30 calibrated finger bones and valid skinning", async () => {
  // Ruiz and Sung keep their scans' own hands: fused fists and gloves the finger rig shreds (per-character-motion design, task 5.5).
  for (const id of ['mechanic', 'doctor', 'priya', 'hale', 'office_3', 'bram', 'heins'] as const) {
    const m = await loadMainCast(id);
    const fingers = m.handBones.filter((b): b is FingerBoneDef => b.kind === 'finger');
    const twists = m.handBones.filter((b) => b.kind === 'twist');
    assert.equal(fingers.length, 30, `${id}: 30 finger bones (5 fingers x 3 phalanges x 2 hands)`);
    if (id !== 'mechanic' && id !== 'office_3') {
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
          if (!SCAN_HANDS.has(id)) {
            // Rotating downward finger +30 deg around curlAxis must move tip inward toward body (+inwardX).
            const rotated = down.clone().applyAxisAngle(ax, 0.5);
            assert.ok(rotated.x * inwardX > 0.35, `${id} ${f1.name}: +curl moves inward (x=${rotated.x.toFixed(2)}, inward=${inwardX})`);
          } else {
            // Scan bodies keep their scan's hand roll once straightened (Ruiz's left swings palm-back), so "inward" is not the test:
            // the curl must carry the finger toward its own palm, which the finger layout gives by the hand's chirality.
            const at = (b: FingerBoneDef) => new THREE.Vector3(...b.offset);
            const pinky1 = fingers.find((b) => b.side === s && b.finger === 'pinky' && b.phalanx === 1)!;
            const mid2 = fingers.find((b) => b.side === s && b.finger === 'middle' && b.phalanx === 2)!;
            const across = at(pinky1).sub(at(fingers.find((b) => b.side === s && b.finger === 'index' && b.phalanx === 1)!));
            const fdown = at(mid2).normalize();
            const palm = (s === 'L' ? across.clone().cross(fdown) : fdown.clone().cross(across)).normalize();
            const seg = at(f2).normalize();
            const moved = seg.clone().applyAxisAngle(ax, 0.5).sub(seg);
            assert.ok(moved.dot(palm) > 0.1, `${id} ${f1.name}: +curl moves toward the palm (${moved.dot(palm).toFixed(2)})`);
          }
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
  // His own idle (CMU) records no fingers, so the cascade comes from the hand solver's rest shape alone.
  assert.ok(pnkCurl > idxCurl + 0.04, `natural resting cascade: pinky (${pnkCurl.toFixed(2)}) > index (${idxCurl.toFixed(2)})`);

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

test('the body models enable handRig on Phase 1 main cast (mechanic, doctor, priya, hale) and keeps crowd rigs lean', () => {
  const table = bodyModelsJson as Record<string, { handRig?: boolean }>;
  for (const id of ['mechanic', 'doctor', 'priya', 'hale', 'office3']) {
    assert.equal(table[id]?.handRig, true, `${id} has handRig: true`);
  }
  for (const id of ['necromorphCrowd', 'gameChar', 'necromorph']) {
    assert.ok(!table[id]?.handRig, `crowd/enemy ${id} stays lean without handRig`);
  }
});

test('vertical wall IK normal aligns Okafor biometric palm flush against -normal and picks panel_work/biometric_scan shapes', async () => {
  const doctor = await loadMainCast('doctor');
  const bodyModels = makeLib({ doctor });
  const baseCtx = { ...enemyCtx(), bodyModels };
  const okafor = new Humanoid({ ...OKAFOR, role: 'npc' }, baseCtx);
  assert.equal(chooseHandShape('R', 'biometric_scan', null, 0, 'R', true, 0, false, true, false), 'surface');
  assert.equal(chooseHandShape('L', 'biometric_scan', null, 0, 'R', false, 0, false, true, false), 'relaxed');
  assert.equal(chooseHandShape('R', 'panel_work', null, 0, 'R', true, 0, false, true, false), 'pinch');
  const wallNormal = new THREE.Vector3(0, 0, 1); // wall in front of body (-Z) with outward normal +Z
  okafor.setPose('biometric_scan', 0.01);
  okafor.handTargets.R = new THREE.Vector3(0.12, 1.48, -0.5);
  okafor.handTargetNormals.R = wallNormal;
  for (let i = 0; i < 45; i++) okafor.update(1 / 60);
  assert.ok(okafor.fingerCurl('R', 'index') < 0.45, 'biometric scan opens right palm fingers flat onto vertical screen');
  const palmLocal = (okafor['handPhysics'] as unknown as { sides: { R: { palmNormal: THREE.Vector3 } } }).sides.R.palmNormal;
  const handQ = okafor.bones.hand_R.getWorldQuaternion(new THREE.Quaternion());
  const palmWorld = palmLocal.clone().applyQuaternion(handQ).normalize();
  const wantPalm = wallNormal.clone().negate().normalize();
  assert.ok(palmWorld.dot(wantPalm) > 0.65, `vertical wall normal aligns right palm toward -normal (dot=${palmWorld.dot(wantPalm).toFixed(2)})`);
  okafor.dispose();
});

test('finger tracks and grips: a clip\'s finger motion moves the fingers; a thinner grip wraps tighter; empty hands rest loosely', async () => {
  const { MocapLibrary } = await import('./mocap.ts');
  const { wrapCurl } = await import('./handPhysics.ts');
  const core = (await import('../data/mocap-core.json', { with: { type: 'json' } })).default as unknown as import('./mocap.ts').RawMocapFile;
  const mechanic = await loadMainCast('mechanic');
  const bodyModels = makeLib({ mechanic });
  const noFingers = { ...core, clips: Object.fromEntries(Object.entries(core.clips).map(([k, c]) => { const { fingers: _f, ...rest } = c; return [k, rest]; })) };
  const track = (mocap: InstanceType<typeof MocapLibrary>): number[] => {
    // The mechanic body on the default profile: its talk clip (Quaternius) records fingers; Giles's own (CMU) does not.
    const { profile: _own, ...plain } = GILES;
    const g = new Humanoid({ ...plain, seed: 'finger-probe', role: 'npc', pose: 'idle' }, { ...enemyCtx(), bodyModels, mocap });
    g.speak('Third quarantine this month, and nobody tells the kitchen anything.', null, 3);
    const out: number[] = [];
    for (let i = 0; i < 150; i++) {
      g.update(1 / 60);
      out.push(g.fingerCurl('R', 'index'));
    }
    return out;
  };
  const withClip = track(new MocapLibrary(core));
  const without = track(new MocapLibrary(noFingers as never));
  const diff = Math.max(...withClip.map((v, i) => Math.abs(v - without[i]!)));
  assert.ok(diff > 0.01, `the clip's finger track moves the fingers (${diff.toFixed(3)})`);

  // A thin held item (the wand, radius 1.9 cm) wraps tighter than a wide one. The mug's wrap is measured in heldGrip.test.ts.
  for (let fi = 1; fi < 5; fi++) assert.ok(wrapCurl(fi, 0.019) > wrapCurl(fi, 0.043), 'a thinner grip wraps tighter');
  const idle = new Humanoid({ ...GILES, role: 'npc', pose: 'idle' }, { ...enemyCtx(), bodyModels });
  for (let i = 0; i < 90; i++) idle.update(1 / 60);
  const rest = idle.fingerCurl('R', 'middle');
  assert.ok(rest > 0.15 && rest < 0.8, `empty hands rest in a loose curl (${rest.toFixed(2)})`);
});

test('severing a finger-rigged forearm: the piece carries the hand and fingers in their last pose; the stump has no finger geometry left', async () => {
  const mechanic = await loadMainCast('mechanic');
  const bodyModels = makeLib({ mechanic });
  const pieces: THREE.Object3D[] = [];
  const gore = { ...enemyCtx().gore, mode: 'full', addDebris: (o: THREE.Object3D) => pieces.push(o) } as unknown as ReturnType<typeof enemyCtx>['gore'];
  const g = new Humanoid({ ...GILES, role: 'enemy', infection: 2 }, { ...enemyCtx(), gore, bodyModels });
  g.update(1 / 60);
  const fingerBones = [...(g['extras'] as Map<string, THREE.Bone>).entries()].filter(([n]) => n.startsWith('finger_L_'));
  assert.ok(fingerBones.length >= 10, 'left hand has finger bones');
  const arm = g.bones.foreArm_L.localToWorld(new THREE.Vector3(0, -0.12, 0));
  const from = arm.clone().add(new THREE.Vector3(-2, 0, 0));
  const hit = g.raycast(from, arm.clone().sub(from).normalize());
  assert.ok(hit);
  for (let i = 0; i < 25 && pieces.length === 0; i++) g.applyHit(hit!, 40, new THREE.Vector3(1, 0, 0));
  assert.equal(pieces.length, 1, 'one severed piece');
  const piece = pieces[0]!;
  const box = new THREE.Box3().setFromObject(piece);
  // The piece reaches past the wrist: hand and fingers are in it (forearm 0.26 m + hand and fingers ~0.18 m).
  assert.ok(box.getSize(new THREE.Vector3()).length() > 0.3, `piece spans ${box.getSize(new THREE.Vector3()).length().toFixed(2)} m`);
  g.update(1 / 60);
  for (const [name, b] of fingerBones) {
    const sc = b.getWorldScale(new THREE.Vector3());
    assert.ok(sc.length() < 1e-3, `${name} collapsed with the severed hand on the body`);
  }
  g.dispose();
});

test("Voss's body (office3) carries a working finger rig", async () => {
  const office3 = await loadMainCast('office_3');
  const { CAST } = await import('./castLooks.ts');
  const voss = new Humanoid({ ...CAST['voss']!, role: 'npc', pose: 'idle' }, { ...enemyCtx(), bodyModels: makeLib({ office3 }) });
  assert.equal(voss.hasFingerRig, true, 'finger bones bound');
  for (let i = 0; i < 60; i++) voss.update(1 / 60);
  const c = voss.fingerCurl('R', 'middle');
  assert.ok(c > 0.1 && c < 1, `fingers rest curled (${c.toFixed(2)})`);
  voss.dispose();
});

test('?detail=0 turns the detail pass off and back on', async () => {
  const { detailPass, readDetailFlag } = await import('./detailPass.ts');
  const mechanic = await loadMainCast('mechanic');
  const g = new Humanoid({ ...GILES, role: 'npc', pose: 'flex_hand' }, { ...enemyCtx(), bodyModels: makeLib({ mechanic }) });
  readDetailFlag('?detail=0');
  assert.equal(detailPass.enabled, false);
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  const frozen = g.fingerCurl('R', 'middle');
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  assert.equal(g.fingerCurl('R', 'middle'), frozen, 'fingers not solved while off');
  readDetailFlag('?detail=1');
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  assert.notEqual(g.fingerCurl('R', 'middle'), frozen, 'solved again when on');
  g.dispose();
});

/** Each prepared vertex in the rest frame, its skin influences, and the triangles' vertex indices. */
function restSkin(m: PreparedBodyModel): { p: THREE.Vector3[]; skin: Array<Array<[number, number]>>; tris: number[] } {
  const world = {} as Record<string, THREE.Vector3>;
  for (const j of JOINTS) world[j.name] = (j.parent ? world[j.parent]!.clone() : new THREE.Vector3()).add(new THREE.Vector3(...m.jointOffsets[j.name]));
  const p: THREE.Vector3[] = [];
  const skin: Array<Array<[number, number]>> = [];
  const tris: number[] = [];
  for (const part of m.parts) {
    const pos = part.geometry.getAttribute('position');
    const si = part.geometry.getAttribute('skinIndex');
    const sw = part.geometry.getAttribute('skinWeight');
    const base = p.length;
    for (let i = 0; i < pos.count; i++) {
      p.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(world[part.joint]!));
      const s: Array<[number, number]> = [];
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0) s.push([si.getComponent(i, k), sw.getComponent(i, k)]);
      skin.push(s);
    }
    for (const x of Array.from(part.geometry.getIndex()!.array)) tris.push(base + x);
  }
  return { p, skin, tris };
}

// openspec per-character-motion (imported-body-models): every named character's hands carry skin on each of their finger bones.
// mechanic.glb paints no finger weights at all and models the fingers in a relaxed curl away from its straight finger bones, so
// prepareBodyModel re-traces its finger chains through the skin and auto-skins them; the other three rigs are measured as a yardstick.
test('main cast hands: every finger bone of all four rigs carries its own strip of skin', async () => {
  for (const id of ['mechanic', 'doctor', 'priya', 'hale'] as const) {
    const m = await loadMainCast(id);
    const { skin } = restSkin(m);
    const count = new Map<number, number>();
    for (const s of skin) for (const [slot, w] of s) if (w > 0.3) count.set(slot, (count.get(slot) ?? 0) + 1);
    for (const side of ['L', 'R'] as const) {
      const bones = m.handBones.flatMap((b, k) => (b.kind === 'finger' && b.side === side ? [{ name: b.name, slot: JOINTS.length + k }] : []));
      assert.equal(bones.length, 15, `${id} ${side}: 15 finger bones`);
      const per = bones.map((b) => ({ name: b.name, n: count.get(b.slot) ?? 0 }));
      const thin = per.filter((b) => b.n < 3);
      assert.deepEqual(thin, [], `${id} ${side}: finger bones with under 3 vertices weighted over 0.3`);
      const total = per.reduce((a, b) => a + b.n, 0);
      assert.ok(total >= 250, `${id} ${side}: ${total} vertices weighted over 0.3 to finger bones`);
    }
  }
});

// The same requirement's fused-finger scenario: curling the fingers never tears the skin (mechanic.glb's fingers are joined by webs
// and its thumb lies against the palm). Every hand shape the solver poses (with its sympathetic coupling), and each finger curled
// alone halfway with the rest straight, is applied by linear blend skinning in the rest frame; no edge of 3 mm or longer may stretch
// past 2.5x.
test('Giles\'s auto-skinned hands curl through every hand shape, and one finger at a time, without tearing', async () => {
  const m = await loadMainCast('mechanic');
  const { p, skin, tris } = restSkin(m);
  const poses: Array<[string, Float32Array]> = Object.entries(HAND_SHAPE_CURLS).map(([shape, curl]) => {
    const coupled = new Float32Array(5);
    applySympatheticCoupling(curl, 1, coupled);
    return [shape, coupled];
  });
  FINGER_NAMES.forEach((fn, i) => poses.push([`${fn} alone`, Float32Array.from(FINGER_NAMES, (_, k) => (k === i ? 0.5 : 0))]));
  for (const [shape, coupled] of poses) {
    // Each bone's skinning matrix: its parent's, then a turn about its own joint.
    const mats: THREE.Matrix4[] = JOINTS.map(() => new THREE.Matrix4());
    const jointWorld = new Map<string, THREE.Vector3>();
    for (const j of JOINTS) jointWorld.set(j.name, (j.parent ? jointWorld.get(j.parent)!.clone() : new THREE.Vector3()).add(new THREE.Vector3(...m.jointOffsets[j.name])));
    const matOf = new Map<string, THREE.Matrix4>();
    for (const b of m.handBones) {
      const at = jointWorld.get(b.parent)!.clone().add(new THREE.Vector3(...b.offset));
      jointWorld.set(b.name, at);
      const parent = matOf.get(b.parent) ?? new THREE.Matrix4();
      let local = new THREE.Matrix4();
      if (b.kind === 'finger') {
        const angle = phalanxCurlAngle(b, coupled[FINGER_NAMES.indexOf(b.finger)]!);
        local = new THREE.Matrix4()
          .makeTranslation(at.x, at.y, at.z)
          .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...b.curlAxis).normalize(), angle))
          .multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));
      }
      const mat = parent.clone().multiply(local);
      matOf.set(b.name, mat);
      mats.push(mat);
    }
    const posed = p.map((v, i) => {
      const out = new THREE.Vector3();
      for (const [slot, w] of skin[i]!) out.addScaledVector(v.clone().applyMatrix4(mats[slot]!), w);
      return out;
    });
    let worst = 0;
    let at = '';
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k]!;
        const b = tris[t + ((k + 1) % 3)]!;
        const rest = p[a]!.distanceTo(p[b]!);
        if (rest < 0.003) continue;
        const stretch = posed[a]!.distanceTo(posed[b]!) / rest;
        if (stretch > worst) [worst, at] = [stretch, p[a]!.toArray().map((x) => x.toFixed(3)).join(', ')];
      }
    }
    assert.ok(worst <= 2.5, `mechanic ${shape}: an edge at (${at}) stretches ${worst.toFixed(2)}x`);
  }
});
