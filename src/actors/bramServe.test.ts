import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
import bramPack from '../data/mocap/bram.json' with { type: 'json' };
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { CAST } from './castLooks.ts';
import { loadMainCast, makeLib } from './castModelTestKit.ts';
import { Humanoid } from './humanoid.ts';
import { MocapLibrary, type RawMocapFile } from './mocap.ts';
import { motionScene } from './motionScene.ts';
import { resolveProfile, sharedMotionProfiles } from './motionProfiles.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';

/**
 * Bram's own motion (per-character-motion task 6.6) keeps the intro's kitchen serve and coffee hand-off: whatever he holds a mug
 * in, his own clips, holds and intro variant leave it in his hand and upright, and his offering hand where the hand-off
 * expects it.
 */

const FPS = 60;

/** The visible held mug under the right hand, and its tilt from vertical in degrees (as heldGrip.test.ts measures it). */
function heldMug(h: Humanoid): { tilt: number; inHand: boolean } | null {
  let mug: THREE.Object3D | null = null;
  h.group.traverse((o) => {
    if (o.name === 'held_mug' && o.visible) mug = o;
  });
  if (!mug) return null;
  const m = mug as THREE.Object3D;
  h.group.updateMatrixWorld(true);
  const e = m.matrixWorld.elements;
  const up = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  let inHand = false;
  for (let o: THREE.Object3D | null = m.parent; o; o = o.parent) if (o === h.bones.hand_R) inHand = true;
  return { tilt: THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1))), inHand };
}
let libs: { bodyModels: BodyModelLibrary; mocap: MocapLibrary } | null = null;
async function cast(): Promise<{ bodyModels: BodyModelLibrary; mocap: MocapLibrary }> {
  if (libs) return libs;
  const mocap = new MocapLibrary(coreJson as unknown as RawMocapFile);
  mocap.addPack('bram', bramPack as unknown as RawMocapFile);
  mocap.retainPack('bram'); // held for the whole file, so the pack outlives each test body (see mocapPacks.test.ts for release)
  libs = { bodyModels: makeLib({ bram: await loadMainCast('bram') }), mocap };
  return libs;
}

function bram(pose: string, l: { bodyModels: BodyModelLibrary; mocap: MocapLibrary }, ownMotion = true): Humanoid {
  const h = new Humanoid({ ...CAST['cook']!, role: 'npc', pose }, { ...enemyCtx(), bodyModels: l.bodyModels, mocap: l.mocap });
  if (!ownMotion) h['animator'].setMotion(resolveProfile(l.mocap, sharedMotionProfiles(), undefined, 'm'));
  return h;
}

for (const inIntro of [false, true]) {
  test(`Bram's own motion keeps the mug in his hand and upright${inIntro ? ' (intro variant)' : ''}`, async () => {
    const l = await cast();
    if (inIntro) motionScene.startSequence('intro_shift_change');
    try {
      const bad: string[] = [];
      for (const pose of ['offer_mug', 'idle_mug', 'lean_back_mug']) {
        const h = bram(pose, l);
        assert.ok(h['animator'].motion.clips.idle === 'bram_idle', 'his own clips are in use');
        if (inIntro) assert.deepEqual(h['animator'].motion.variants, ['intro']);
        let worstTilt = 0;
        for (let i = 0; i < 3 * FPS; i++) {
          h.update(1 / FPS);
          if (i < FPS / 2) continue; // settle into the pose
          const r = heldMug(h);
          if (!r || !r.inHand) {
            bad.push(`${pose}: no mug in his hand at frame ${i}`);
            break;
          }
          worstTilt = Math.max(worstTilt, r.tilt);
        }
        if (worstTilt > 10) bad.push(`${pose}: the mug tips ${worstTilt.toFixed(1)} deg`);
        h.dispose();
      }
      assert.deepEqual(bad, [], bad.join('; '));
    } finally {
      motionScene.reset();
    }
  });
}

test('the coffee hand-off: Bram\'s offering hand lands where it does on the default motion (within 3 cm)', async () => {
  const l = await cast();
  motionScene.startSequence('intro_shift_change');
  try {
    const own = bram('offer_mug', l);
    const plain = bram('offer_mug', l, false);
    let worst = 0;
    for (let i = 0; i < 3 * FPS; i++) {
      own.update(1 / FPS);
      plain.update(1 / FPS);
      if (i < FPS) continue;
      const a = own.bones.hand_R.getWorldPosition(new THREE.Vector3());
      const b = plain.bones.hand_R.getWorldPosition(new THREE.Vector3());
      worst = Math.max(worst, a.distanceTo(b));
    }
    assert.ok(worst < 0.03, `his offering hand is within ${(worst * 100).toFixed(1)} cm of the default's`);
    own.dispose();
    plain.dispose();
  } finally {
    motionScene.reset();
  }
});

test('standing between serves, Bram\'s hands rest: neither hand rises or swings on his idle loop (no remote-clicking 80_37 take)', async () => {
  const l = await cast();
  motionScene.startSequence('intro_shift_change');
  try {
    const h = bram('idle', l);
    for (let i = 0; i < 2 * FPS; i++) h.update(1 / FPS);
    const track: Record<'hand_R' | 'hand_L', THREE.Vector3[]> = { hand_R: [], hand_L: [] };
    // Two full loops of his idle, hands measured against his chest so his weight shifts don't count.
    for (let i = 0; i < 8 * FPS; i++) {
      h.update(1 / FPS);
      h.group.updateMatrixWorld(true);
      const inv = h.bones.chest.matrixWorld.clone().invert();
      for (const j of ['hand_R', 'hand_L'] as const) track[j].push(h.bones[j].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
    }
    for (const [j, pts] of Object.entries(track)) {
      const mean = pts.reduce((a, b) => a.clone().add(b)).multiplyScalar(1 / pts.length);
      const drift = Math.max(...pts.map((p) => p.distanceTo(mean)));
      assert.ok(drift < 0.03, `${j} moves ${(drift * 100).toFixed(1)} cm from where it rests (limit 3 cm)`);
    }
    h.dispose();
  } finally {
    motionScene.reset();
  }
});
