import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { FootstepEvent, Humanoid } from '../humanoid.ts';
import { JOINTS } from '../skeleton.ts';
import { creatureBody, lowestPoint, stepBody } from './bladeTestKit.ts';

/** rig-necromorph tasks 5.4 / 5.4a (design D6, D6a): the creature's prowl and charge (spec "Its steps match its speed"). */

const contacts = (h: Humanoid): [number, number] => (h as unknown as { animator: { footContacts: [number, number] } }).animator.footContacts;

/** Run at `speed` for `frames`; return the worst planted-foot slide (m) and the lowest foot point (m) after the first second. */
export function footing(h: Humanoid, speed: number, frames: number, opts: { near?: boolean; each?: () => void } = {}): { slide: number; low: number; steps: number } {
  const start: [THREE.Vector3 | null, THREE.Vector3 | null] = [null, null];
  const p = new THREE.Vector3();
  let slide = 0;
  let low = Infinity;
  let steps = 0;
  stepBody(h, frames, {
    speed,
    near: opts.near ?? true,
    each: (i) => {
      opts.each?.();
      if (i < 60) return;
      (['L', 'R'] as const).forEach((s, k) => {
        const down = contacts(h)[k]! >= 0.5;
        h.jointWorld(`foot_${s}`, p);
        if (!down) {
          start[k] = null;
          return;
        }
        if (!start[k]) {
          start[k] = p.clone();
          steps++;
          return;
        }
        slide = Math.max(slide, Math.hypot(p.x - start[k]!.x, p.z - start[k]!.z));
      });
      low = Math.min(low, lowestPoint(h) - h.group.position.y);
    },
  });
  return { slide, low, steps };
}

for (const look of ['lab_creature', 'flood_elite'] as const) {
  for (const speed of [1.1, 1.35, 3.2, 7.2]) {
    test(`${look} at ${speed} m/s: planted feet hold the floor`, async () => {
      const h = await creatureBody(look);
      const f = footing(h, speed, 240);
      assert.ok(f.steps >= 4, `${f.steps} footfalls`);
      assert.ok(f.slide < 0.1, `a planted foot slid ${(f.slide * 100).toFixed(1)} cm`);
      assert.ok(f.low > -0.03, `a foot sank ${(-f.low * 100).toFixed(1)} cm`);
    });
  }
}

test('from standing to a charge and back, no joint snaps more than 30 degrees in a frame', async () => {
  const h = await creatureBody('flood_elite');
  const bones = JOINTS.map((j) => h.group.getObjectByName(j.name)!);
  // From its first drawn frame: before its first update a body's bones are at rest and never drawn.
  stepBody(h, 1);
  let prev = bones.map((b) => b.quaternion.clone());
  let worst = 0;
  const watchStep = (): void => {
    bones.forEach((b, i) => (worst = Math.max(worst, b.quaternion.angleTo(prev[i]!))));
    prev = bones.map((b) => b.quaternion.clone());
  };
  stepBody(h, 60, { each: watchStep });
  stepBody(h, 120, { speed: 3.2, each: watchStep });
  stepBody(h, 120, { speed: 0, each: watchStep });
  assert.ok(THREE.MathUtils.radToDeg(worst) <= 30, `a joint moved ${THREE.MathUtils.radToDeg(worst).toFixed(1)} degrees in one frame`);
});

// rig-necromorph 5.4a (design D6a): footing in the scenes as they drive it.
test('held in a kill and far from the camera, the creature keeps its planted feet at 3.2 m/s', async () => {
  const h = await creatureBody('lab_creature');
  h.beginKill();
  const f = footing(h, 3.2, 240, { near: false });
  assert.ok(f.steps >= 4, `${f.steps} footfalls`);
  assert.ok(f.slide < 0.1, `a planted foot slid ${(f.slide * 100).toFixed(1)} cm`);
  assert.ok(f.low > -0.03, `a foot sank ${(-f.low * 100).toFixed(1)} cm`);
});

test('a kill that slows its steps: longer strides at 7.2 m/s, planted feet still hold (spec "A kill that slows its steps")', async () => {
  const h = await creatureBody('lab_creature');
  h.beginKill();
  const anim = (h as unknown as { animator: { gaitRate: number } }).animator;
  const normal = footing(await creatureBody('lab_creature'), 7.2, 240);
  const f = footing(h, 7.2, 240, { each: () => (anim.gaitRate = 0.6) });
  assert.ok(f.slide < 0.1, `a planted foot slid ${(f.slide * 100).toFixed(1)} cm`);
  assert.ok(f.steps < normal.steps, `fewer steps at the slowed rate (${f.steps} against ${normal.steps})`);
});

// rig-necromorph 5.4b (design D6a): stepped turns, starts and stops.
const yawOf = (o: THREE.Object3D): number => {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  return Math.atan2(f.x, f.z);
};

test('turning 90 degrees to stare: each foot steps round, and no planted foot twists more than 30 degrees (spec "Turning to stare")', async () => {
  const h = await creatureBody('lab_creature');
  stepBody(h, 60, { speed: 0 });
  const dt = 1 / 60;
  const side = new THREE.Vector3(1, 0, 0);
  const feet = (['L', 'R'] as const).map((s) => h.group.getObjectByName(`foot_${s}`)!);
  const landings = [0, 0];
  const plantedYaw: Array<number | null> = [null, null];
  let twist = 0;
  const start = h.heading;
  let t = 0;
  for (; t < 3; t += dt) {
    h.steer(side, dt, { maxSpeed: 0 });
    h.update(dt, h.group.position.clone().add(new THREE.Vector3(0, 1.6, 3)));
    h.group.updateMatrixWorld(true);
    [0, 1].forEach((k) => {
      const down = contacts(h)[k]! >= 0.5;
      if (!down) return void (plantedYaw[k] = null);
      const y = yawOf(feet[k]!);
      if (plantedYaw[k] === null) {
        plantedYaw[k] = y;
        landings[k]!++;
        return;
      }
      let d = Math.abs(y - plantedYaw[k]!);
      if (d > Math.PI) d = 2 * Math.PI - d;
      twist = Math.max(twist, d);
    });
    if (Math.abs(Math.abs(h.heading - start) - Math.PI / 2) < 0.02) break;
  }
  assert.ok(Math.abs(Math.abs(h.heading - start) - Math.PI / 2) < 0.05, `turned ${THREE.MathUtils.radToDeg(h.heading - start).toFixed(0)} degrees`);
  assert.ok(landings[0]! >= 2 && landings[1]! >= 2, `landings during the turn: ${landings.map((n) => n - 1).join(', ')}`);
  assert.ok(THREE.MathUtils.radToDeg(twist) <= 30, `a planted foot twisted ${THREE.MathUtils.radToDeg(twist).toFixed(0)} degrees`);
});

test('stopping from a 3.2 m/s charge: at least one settling step, then both feet planted (spec "Stopping from a charge")', async () => {
  const h = await creatureBody('flood_elite');
  stepBody(h, 150, { speed: 3.2 });
  const anim = (h as unknown as { animator: { footfall: boolean } }).animator;
  let falls = 0;
  let stoppedAt = -1;
  stepBody(h, 150, {
    speed: 0,
    each: (i) => {
      if (anim.footfall) falls++;
      if (stoppedAt < 0 && h.speed < 0.02) stoppedAt = i;
    },
  });
  assert.ok(stoppedAt >= 0, 'it stopped');
  assert.ok(falls >= 1, `${falls} settling steps`);
  assert.deepEqual(contacts(h).map((c) => c >= 0.99), [true, true], 'both feet down');
  const low = lowestPoint(h) - h.group.position.y;
  assert.ok(Math.abs(low) < 0.03, `feet ${low.toFixed(3)} m from the floor`);
});

// rig-necromorph task 7.5a (design D6c): the creature reports stomps and lifts from its foot contacts with speed-scaled splash.
test('charging emits heavy stomp landings and lift events with splash growing with speed', async () => {
  const prowlSteps: FootstepEvent[] = [];
  const chargeSteps: FootstepEvent[] = [];
  const p = await creatureBody('flood_elite', 'idle', { onFootstep: (s) => prowlSteps.push(s) });
  stepBody(p, 180, { speed: 1.35 });
  const c = await creatureBody('flood_elite', 'idle', { onFootstep: (s) => chargeSteps.push(s) });
  stepBody(c, 180, { speed: 3.2 });
  const cLand = chargeSteps.filter((s) => s.kind === 'heavy');
  const cLift = chargeSteps.filter((s) => s.kind === 'lift');
  const pLand = prowlSteps.filter((s) => s.kind === 'heavy');
  assert.ok(cLand.length >= 4 && cLift.length >= 4, `charge emitted ${cLand.length} landings and ${cLift.length} lifts`);
  assert.ok(cLand.every((s) => (s.splash ?? 0) > 0.7), 'charge landings carry large splash');
  assert.ok(cLift.every((s) => (s.splash ?? 0) > 0.7), 'charge lifts carry large splash');
  assert.ok(pLand.length >= 2 && (cLand.at(-1)!.splash ?? 0) > (pLand.at(-1)!.splash ?? 0), 'splash grows with speed');
});
