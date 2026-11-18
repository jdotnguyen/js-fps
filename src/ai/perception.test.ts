import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSee, hears, inBeam, inCone, Memory, PERCEPTION, pickTarget } from './perception.ts';
import { routeLength } from './enemyDirector.ts';
import { room } from './enemyTestKit.ts';
import { segmentHit, type P3 } from './nav.ts';

const eye = { x: 0, y: 1.55, z: 0 };
const never = (): boolean => false;

test('sight cone is 110 degrees around the heading (0 faces -Z)', () => {
  assert.ok(inCone(0, 0, -5));
  assert.ok(inCone(0, Math.sin(0.9), -Math.cos(0.9))); // 52 deg off
  assert.ok(!inCone(0, Math.sin(1.05), -Math.cos(1.05))); // 60 deg off
  assert.ok(!inCone(0, 0, 5)); // behind
  assert.ok(inCone(Math.PI / 2, -5, 0)); // heading +90 faces -X
});

test('sight range: 18 m lit or in the beam, 8 m dark; touch range ignores the cone', () => {
  const at = (z: number): P3 => ({ x: 0, y: 1.3, z: -z });
  assert.ok(canSee({ eye, heading: 0, target: at(15), lit: true, inBeam: false, blocked: never }));
  assert.ok(!canSee({ eye, heading: 0, target: at(15), lit: false, inBeam: false, blocked: never }));
  assert.ok(canSee({ eye, heading: 0, target: at(15), lit: false, inBeam: true, blocked: never }));
  assert.ok(canSee({ eye, heading: 0, target: at(7), lit: false, inBeam: false, blocked: never }));
  assert.ok(!canSee({ eye, heading: 0, target: at(19), lit: true, inBeam: false, blocked: never }));
  // Behind, but close enough to feel.
  assert.ok(canSee({ eye, heading: Math.PI, target: at(1.2), lit: false, inBeam: false, blocked: never }));
  assert.ok(!canSee({ eye, heading: Math.PI, target: at(3), lit: true, inBeam: false, blocked: never }));
  assert.ok(!canSee({ eye, heading: 0, target: at(5), lit: true, inBeam: false, blocked: () => true }));
  assert.ok(!canSee({ eye, heading: 0, target: at(5), lit: true, inBeam: false, blocked: never, blind: true }));
});

test('line of sight is blocked by colliders', () => {
  const w = room([{ min: [-3, 0, -3.2], max: [3, 3, -3] }]);
  const blocked = (a: P3, b: P3): boolean => segmentHit(w.colliders, a.x, a.y, a.z, b.x, b.y, b.z) !== null;
  assert.ok(!canSee({ eye, heading: 0, target: { x: 0, y: 1.3, z: -6 }, lit: true, inBeam: false, blocked }));
  assert.ok(canSee({ eye, heading: 0, target: { x: 0, y: 1.3, z: -2 }, lit: true, inBeam: false, blocked }));
});

test('flashlight beam test', () => {
  const o = { x: 0, y: 1.6, z: 0 };
  const d = { x: 0, y: 0, z: -1 };
  assert.ok(inBeam(o, d, { x: 0.5, y: 1.4, z: -6 }));
  assert.ok(!inBeam(o, d, { x: 4, y: 1.4, z: -6 }));
  assert.ok(!inBeam(o, d, { x: 0, y: 1.6, z: -30 }));
});

test('hearing: radius by kind, through open space or a short enough route only', () => {
  const w = room([{ min: [-10, 0, -0.1], max: [8, 3, 0.1] }]); // a wall with a gap at x 8..10
  const clear = (a: P3, b: P3): boolean => w.nav.direct(a, b, 0);
  const route = (a: P3, b: P3): number => routeLength(w.nav, a, b);
  const shooter = { x: 0, y: 0, z: 3 };
  assert.ok(hears('gunshot', shooter, { x: 0, y: 0, z: 9 }, clear, route));
  assert.ok(!hears('footstep', shooter, { x: 0, y: 0, z: 8 }, clear, route));
  assert.ok(hears('footstep', shooter, { x: 0, y: 0, z: 6 }, clear, route));
  assert.ok(hears('sprint', shooter, { x: 0, y: 0, z: 9 }, clear, route));
  // Through the wall: 6 m straight but the way round is ~20 m.
  const behind = { x: 0, y: 0, z: -3 };
  assert.ok(!hears('impact', shooter, behind, clear, route));
  assert.ok(hears('gunshot', shooter, behind, clear, route));
  assert.equal(PERCEPTION.hear.gunshot, 25);
});

test('memory: fresh, then stale, then forgotten', () => {
  const m = new Memory();
  assert.ok(!m.fresh);
  m.sense({ x: 1, y: 0, z: 2 }, 'sight', 'player');
  assert.ok(m.fresh);
  assert.equal(m.targetId, 'player');
  m.update(PERCEPTION.memory + 0.1);
  assert.ok(!m.fresh && !m.forgotten);
  m.update(PERCEPTION.forget);
  assert.ok(m.forgotten);
  assert.deepEqual(m.last, { x: 1, y: 0, z: 2 });
});

test('target choice: weight over distance', () => {
  const from = { x: 0, y: 0, z: 0 };
  const player = { id: 'p', weight: 1, x: 6, z: 0 };
  const mate = { id: 'm', weight: 0.6, x: 2, z: 0 };
  assert.equal(pickTarget(from, [player, mate])!.id, 'm');
  const working = { id: 'w', weight: 0.9, x: 5, z: 0 };
  assert.equal(pickTarget(from, [player, working])!.id, 'w');
  assert.equal(pickTarget(from, []), null);
});
