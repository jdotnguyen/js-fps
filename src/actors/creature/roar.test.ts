import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CreatureGait } from './gait.ts';
import { JUGGERNAUT_POSES } from './juggernaut.ts';
import { limitUse, swingTwist } from './limits.ts';
import { SequencePlayer } from './sequences.ts';
import { loadJuggernaut } from './creatureTestKit.ts';
import type { CreatureRig } from './rig.ts';
import type { LimbSide } from './limbIk.ts';

// openspec juggernaut-walk-and-roar D5, spec creature-motion "The Juggernaut roars in full" and "A roar while walking".

const DT = 1 / 60;
const SIDES: LimbSide[] = ['leg.L', 'arm.R', 'leg.R', 'arm.L'];
const headPitch = (rig: CreatureRig) => THREE.MathUtils.radToDeg(Math.asin(rig.lookAt.forward(rig.joint('head_09'), new THREE.Vector3()).y));

function outside(rig: CreatureRig): string[] {
  const out: string[] = [];
  for (const j of rig.joints) {
    const u = limitUse(swingTwist(rig.delta(j).normalize(), j.limit), j.limit);
    if (u.twist > 1 + 1e-6 || u.swing > 1 + 1e-6) out.push(j.name);
  }
  return out;
}

async function standing() {
  const { scene, rig } = await loadJuggernaut();
  const root = new THREE.Group();
  root.add(scene);
  rig.update(0);
  const gait = new CreatureGait(rig, root);
  gait.placeAt(new THREE.Vector3(), Math.PI / 2);
  rig.update(0);
  const player = new SequencePlayer(rig, JUGGERNAUT_POSES);
  // Looking at a squad ahead, as in the finale.
  rig.setLookTarget(new THREE.Vector3(7, 2, 0));
  return { rig, gait, player };
}

test('the long roar: jaw at its open limit and the head 15+ degrees up at the hold, hands off the floor, inside every limit', async () => {
  const { rig, gait, player } = await standing();
  for (let i = 0; i < 30; i++) {
    gait.update(DT);
    rig.update(DT);
  }
  const startPitch = headPitch(rig);
  const handsDown = (['arm.L', 'arm.R'] as const).map((s) => rig.limb(s).contactPoint(new THREE.Vector3()).y);
  player.play('roar_full');
  const holdAt = 0.6 + 0.15 + 0.4 + 2; // mid-hold
  let t = 0;
  let checked = false;
  while (!player.finished) {
    player.update(DT);
    gait.update(DT);
    rig.update(DT);
    t += DT;
    assert.deepEqual(outside(rig), [], `inside every limit at ${t.toFixed(2)} s`);
    if (!checked && t >= holdAt) {
      checked = true;
      const lower = rig.joint('lowermouth_010');
      const u = limitUse(swingTwist(rig.delta(lower).normalize(), lower.limit), lower.limit);
      assert.ok(u.twist >= 0.995, `jaw at its open limit (${u.twist.toFixed(3)})`);
      const up = headPitch(rig) - startPitch;
      assert.ok(up >= 15, `head ${up.toFixed(1)} deg higher`);
      (['arm.L', 'arm.R'] as const).forEach((s, i) => {
        const y = rig.limb(s).contactPoint(new THREE.Vector3()).y;
        assert.ok(y - handsDown[i]! > 0.2, `${s} lifted ${(y - handsDown[i]!).toFixed(2)} m off its plant`);
      });
    }
  }
  assert.ok(checked);
  // Settled: hands back on their plants.
  for (let i = 0; i < 30; i++) {
    gait.update(DT);
    rig.update(DT);
  }
  for (const s of ['arm.L', 'arm.R'] as const) assert.ok(rig.limb(s).lastError <= 0.01, `${s} back on its plant`);
});

test('the walking roar opens the jaw and lifts the head while the walk keeps its plants', async () => {
  const runs = await Promise.all([standing(), standing()]);
  const pitches: number[] = [];
  let slide = 0;
  for (const [k, { rig, gait, player }] of runs.entries()) {
    gait.walk([new THREE.Vector3(), new THREE.Vector3(3.4, 0, 0)], 0.85);
    if (k === 1) player.play('roar_walk');
    const plantedAt = new Map<LimbSide, THREE.Vector3 | null>();
    let t = 0;
    for (; t < 1.6; t += DT) {
      player.update(DT);
      gait.update(DT);
      rig.update(DT);
      if (k === 1) {
        for (const s of SIDES) {
          const c = rig.limb(s).contactPoint(new THREE.Vector3());
          if (gait.plant(s).planted) {
            const at = plantedAt.get(s);
            if (at) slide = Math.max(slide, c.distanceTo(at));
            else plantedAt.set(s, c);
          } else plantedAt.set(s, null);
        }
      }
    }
    pitches.push(headPitch(rig));
    if (k === 1) assert.ok(rig.getFace().jaw > 0.8, `jaw open (${rig.getFace().jaw.toFixed(2)})`);
  }
  assert.ok(pitches[1]! - pitches[0]! >= 8, `head ${(pitches[1]! - pitches[0]!).toFixed(1)} deg higher than walking without the roar`);
  assert.ok(slide <= 0.02, `plants slide ${(slide * 100).toFixed(2)} cm`);
});
