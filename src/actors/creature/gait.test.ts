import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CreatureGait } from './gait.ts';
import { loadJuggernaut } from './creatureTestKit.ts';
import type { LimbSide } from './limbIk.ts';

// openspec juggernaut-walk-and-roar D1-D4, spec creature-motion: the walk.

const SIDES: LimbSide[] = ['leg.L', 'arm.R', 'leg.R', 'arm.L'];
const DT = 1 / 60;

async function walker() {
  const { scene, rig } = await loadJuggernaut();
  const root = new THREE.Group();
  root.add(scene);
  rig.update(0);
  const gait = new CreatureGait(rig, root);
  gait.placeAt(new THREE.Vector3(0, 0, 0), Math.PI / 2);
  rig.update(0);
  const step = () => {
    gait.update(DT);
    rig.update(DT);
  };
  return { rig, root, gait, step };
}

test('a 3.4 m walk: ends within 5 cm facing along the path, plants hold, limbs land in diagonal order once each', async () => {
  const { rig, root, gait, step } = await walker();
  const landings: Array<{ side: LimbSide; point: THREE.Vector3; kind: string }> = [];
  gait.onTouchdown = (side, point, kind) => landings.push({ side, point, kind });
  gait.walk([new THREE.Vector3(0, 0, 0), new THREE.Vector3(3.4, 0, 0)], 0.7);
  const plantedAt = new Map<LimbSide, THREE.Vector3 | null>();
  let worstSlide = 0;
  let worstClear = Infinity;
  let worstLand = 0;
  const groundY = 0;
  const prevSwing = new Map<LimbSide, boolean>(SIDES.map((s) => [s, false]));
  const plantHeight = new Map<LimbSide, number>();
  for (const s of SIDES) plantHeight.set(s, rig.limb(s).contactPoint(new THREE.Vector3()).y);
  let transitions = 0;
  for (let f = 0; f < 60 * 20 && !gait.standing; f++) {
    step();
    for (const side of SIDES) {
      const contact = rig.limb(side).contactPoint(new THREE.Vector3());
      const { planted } = gait.plant(side);
      if (planted) {
        const at = plantedAt.get(side);
        if (!at) plantedAt.set(side, contact.clone());
        else worstSlide = Math.max(worstSlide, contact.distanceTo(at));
        if (prevSwing.get(side)) {
          transitions++;
          const target = side.startsWith('leg') ? groundY : plantHeight.get(side)!;
          worstLand = Math.max(worstLand, Math.abs(contact.y - target));
        }
      } else {
        plantedAt.set(side, null);
        const swing = gait as unknown as { limbs: Array<{ side: LimbSide; swingT: number }> };
        const t = swing.limbs.find((l) => l.side === side)!.swingT;
        if (Math.abs(t - 0.5) < 0.05) worstClear = Math.min(worstClear, contact.y - plantHeight.get(side)!);
      }
      prevSwing.set(side, !planted);
    }
  }
  assert.ok(gait.standing, 'the walk ends standing');
  const end = new THREE.Vector3(root.position.x, 0, root.position.z);
  assert.ok(end.distanceTo(new THREE.Vector3(3.4, 0, 0)) <= 0.05, `ends ${(end.distanceTo(new THREE.Vector3(3.4, 0, 0)) * 100).toFixed(1)} cm from the path's end`);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
  facing.y = 0;
  const off = THREE.MathUtils.radToDeg(facing.normalize().angleTo(new THREE.Vector3(1, 0, 0)));
  assert.ok(off <= 5, `faces ${off.toFixed(1)} deg off the path`);
  assert.ok(worstSlide <= 0.02, `planted limbs slide ${(worstSlide * 100).toFixed(2)} cm`);
  assert.ok(worstClear >= 0.1, `mid-swing clearance ${(worstClear * 100).toFixed(1)} cm`);
  assert.ok(worstLand <= 0.02, `landings ${(worstLand * 100).toFixed(2)} cm off the ground`);
  assert.ok(landings.length >= 8, `${landings.length} landings`);
  assert.equal(landings.length, transitions, 'one report per landing');
  // Diagonal order through the walk (settling steps excepted: they come last, in the same order).
  const walkLandings = landings.slice(0, 8).map((l) => l.side);
  for (let i = 0; i < walkLandings.length; i++) assert.equal(walkLandings[i], SIDES[i % 4], `landing ${i}`);
  for (const l of landings) assert.equal(l.kind, l.side.startsWith('leg') ? 'foot' : 'hand');
});

test('it settles near its standing places and then stays still; it bobs while walking and not while standing', async () => {
  const { rig, root, gait, step } = await walker();
  gait.walk([new THREE.Vector3(0, 0, 0), new THREE.Vector3(3.4, 0, 0)], 0.7);
  let lo = Infinity;
  let hi = -Infinity;
  for (let f = 0; f < 60 * 20 && !gait.standing; f++) {
    step();
    if (gait.distance > 0.6 && gait.distance < 1.8) {
      lo = Math.min(lo, root.position.y);
      hi = Math.max(hi, root.position.y);
    }
  }
  const bob = hi - lo;
  assert.ok(bob >= 0.03 && bob <= 0.15, `bob ${(bob * 100).toFixed(1)} cm over a cycle`);
  assert.ok(gait.standing);
  const home = new THREE.Vector3();
  for (const side of SIDES) {
    const { point } = gait.plant(side);
    gait.homeWorld(side, home);
    const gap = Math.hypot(point.x - home.x, point.z - home.z);
    assert.ok(gap <= 0.15, `${side} ${(gap * 100).toFixed(1)} cm from its standing place`);
  }
  const before = SIDES.map((s) => rig.limb(s).contactPoint(new THREE.Vector3()));
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let f = 0; f < 60; f++) {
    step();
    y0 = Math.min(y0, root.position.y);
    y1 = Math.max(y1, root.position.y);
  }
  assert.ok(y1 - y0 < 0.005, `standing bob ${((y1 - y0) * 1000).toFixed(2)} mm`);
  SIDES.forEach((s, i) => assert.ok(rig.limb(s).contactPoint(new THREE.Vector3()).distanceTo(before[i]!) < 0.001, `${s} still`));
});
