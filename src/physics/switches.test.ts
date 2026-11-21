import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_OFF } from '../core/settings.ts';
import { anyPhysics, resolvePhysicsSwitches } from './switches.ts';

// adopt-physics-engine design D9 / physics-world "Each physics feature has its own switch".

const stored = { debris: true, ragdoll: false, powered: false, interact: true };

test('without a URL flag the stored switches apply', () => {
  const r = resolvePhysicsSwitches(stored, '?level=slice01');
  assert.deepEqual(r.switches, stored);
  assert.equal(r.source, 'settings');
});

test('?physics=off turns every feature off, whatever is stored', () => {
  for (const v of ['off', 'none', '0', 'OFF']) assert.deepEqual(resolvePhysicsSwitches(stored, `?physics=${v}`).switches, PHYSICS_OFF, v);
});

test('a bare ?physics (or on/all) turns every feature on', () => {
  for (const search of ['?physics', '?physics=', '?physics=on', '?physics=all']) {
    const r = resolvePhysicsSwitches(PHYSICS_OFF, search);
    assert.deepEqual(r.switches, { debris: true, ragdoll: true, powered: true, interact: true }, search);
    assert.equal(r.source, 'url');
  }
});

test('a feature list turns exactly those on and reports unknown names', () => {
  const r = resolvePhysicsSwitches(stored, '?physics=ragdoll,%20powered,cloth');
  assert.deepEqual(r.switches, { debris: false, ragdoll: true, powered: true, interact: false });
  assert.deepEqual(r.unknown, ['cloth']);
});

test('anyPhysics is false only when every feature is off', () => {
  assert.equal(anyPhysics(PHYSICS_OFF), false);
  assert.equal(anyPhysics({ ...PHYSICS_OFF, interact: true }), true);
});
