import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
import ruizPack from '../data/mocap/ruiz.json' with { type: 'json' };
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { CAST } from './castLooks.ts';
import { Humanoid } from './humanoid.ts';
import { MocapLibrary, type RawMocapFile } from './mocap.ts';
import { motionScene } from './motionScene.ts';

/**
 * Ruiz's own motion (per-character-motion task 6.7) at the dock checkpoint: in the intro her `checkpoint` variant swaps the shared
 * `arms_out` scan pose for her own, which holds her arms out for the wand while her legs and trunk keep her restless idle.
 */

const FPS = 60;

let lib: MocapLibrary | null = null;
function mocap(): MocapLibrary {
  if (lib) return lib;
  lib = new MocapLibrary(coreJson as unknown as RawMocapFile);
  lib.addPack('ruiz', ruizPack as unknown as RawMocapFile);
  lib.retainPack('ruiz'); // held for the whole file, so the pack outlives each test body
  return lib;
}

function ruiz(): Humanoid {
  return new Humanoid({ ...CAST['ruiz']!, role: 'npc' }, { ...enemyCtx(), mocap: mocap() });
}

const at = (h: Humanoid, j: 'hand_L' | 'hand_R' | 'upperArm_L' | 'upperArm_R' | 'head' | 'pelvis'): THREE.Vector3 => h.bones[j].getWorldPosition(new THREE.Vector3());

/** Hold arms_out for 3 s: the worst hand drop under its shoulder, the narrowest hand spread, and how far the head travels. */
function scan(h: Humanoid): { drop: number; spread: number; headTravel: number } {
  h.setPose('arms_out', 0.45);
  let drop = 0;
  let spread = Infinity;
  const box = new THREE.Box3();
  for (let i = 0; i < 3 * FPS; i++) {
    h.update(1 / FPS);
    if (i < FPS) continue; // settle into the pose
    h.group.updateMatrixWorld(true);
    for (const s of ['L', 'R'] as const) drop = Math.max(drop, at(h, `upperArm_${s}`).y - at(h, `hand_${s}`).y);
    spread = Math.min(spread, at(h, 'hand_L').distanceTo(at(h, 'hand_R')));
    box.expandByPoint(at(h, 'head'));
  }
  return { drop, spread, headTravel: box.getSize(new THREE.Vector3()).length() };
}

test('Ruiz at the dock checkpoint: her own arms-out pose in the intro, the shared one elsewhere', () => {
  const plain = ruiz();
  plain.setPose('arms_out', 0.45);
  assert.equal(plain.idlePose, 'arms_out', 'outside the intro she plays the shared scan pose');
  plain.dispose();
  motionScene.startSequence('intro_shift_change');
  try {
    const own = ruiz();
    assert.equal(own['animator'].motion.clips.idle, 'ruiz_idle', 'her own clips are in use');
    assert.deepEqual(own['animator'].motion.variants, ['checkpoint']);
    own.setPose('arms_out', 0.45);
    assert.equal(own.idlePose, 'ruiz_arms_out');
    own.setPose('idle', 0.4);
    assert.equal(own.idlePose, 'idle', 'the scan ends back on her idle');
    own.dispose();
  } finally {
    motionScene.reset();
  }
});

test('Ruiz\'s scan: arms stay out for the wand while she keeps moving (the shared pose holds her still)', () => {
  const still = ruiz();
  const shared = scan(still);
  still.dispose();
  motionScene.startSequence('intro_shift_change');
  try {
    const h = ruiz();
    const own = scan(h);
    h.dispose();
    assert.ok(own.drop < 0.15, `her hands stay within 15 cm under her shoulders (worst ${(own.drop * 100).toFixed(1)} cm)`);
    assert.ok(own.spread > 1.2, `her arms stay spread for the wand (narrowest ${own.spread.toFixed(2)} m)`);
    assert.ok(own.headTravel > 0.03, `restless: her head moves ${(own.headTravel * 100).toFixed(1)} cm over the scan`);
    assert.ok(own.headTravel > shared.headTravel * 2, `more than the shared pose (${(shared.headTravel * 100).toFixed(1)} cm)`);
  } finally {
    motionScene.reset();
  }
});
