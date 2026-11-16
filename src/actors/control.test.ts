import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControlStack, FREE_CONTROL } from './control.ts';
import { Vitals, type VitalsTuning } from './vitals.ts';

test('a pushed layer restricts control and releasing it restores free control', () => {
  const c = new ControlStack();
  const release = c.push({ move: 'locked', look: 'clamped', weapons: false }, 'intro');
  assert.equal(c.state.move, 'locked');
  assert.equal(c.state.look, 'clamped');
  assert.equal(c.state.flashlight, true);
  release();
  assert.deepEqual({ ...c.state }, { ...FREE_CONTROL });
  release(); // second call is harmless
  assert.deepEqual({ ...c.state }, { ...FREE_CONTROL });
});

test('layers released out of order still restore what was under them', () => {
  const c = new ControlStack();
  const a = c.push({ move: 'slow' }, 'a');
  const b = c.push({ move: 'locked', look: 'locked' }, 'b');
  a();
  assert.equal(c.state.move, 'locked');
  assert.deepEqual(c.owners(), ['b']);
  b();
  assert.equal(c.state.move, 'free');
  assert.equal(c.state.look, 'free');
});

test('set changes the base; reset drops everything', () => {
  const c = new ControlStack();
  c.set({ flashlight: false });
  const release = c.push({ move: 'locked' });
  release();
  assert.equal(c.state.flashlight, false);
  c.push({ interact: false });
  c.reset();
  assert.deepEqual({ ...c.state }, { ...FREE_CONTROL });
});

const tuning = (over: Partial<VitalsTuning> = {}): (() => VitalsTuning) => {
  const t: VitalsTuning = { playerDamageTaken: 1, bleedOutTime: 20, reviveHp: 40, revivesPerCheckpoint: 1, ...over };
  return () => t;
};

test('damage scales with difficulty and 0 hp downs the player', () => {
  const v = new Vitals(tuning({ playerDamageTaken: 0.5 }));
  assert.equal(v.damage(40), 'damaged');
  assert.equal(v.hp, 80);
  assert.equal(v.damage(1000), 'downed');
  assert.equal(v.state, 'downed');
  assert.equal(v.bleed, 20);
});

test('bleeding out kills; hits while downed drain the timer faster', () => {
  const v = new Vitals(tuning());
  v.damage(100);
  v.damage(20); // 20 * 0.15 = 3 s
  assert.ok(Math.abs(v.bleed - 17) < 1e-9, `bleed=${v.bleed}`);
  assert.equal(v.update(16.9), null);
  assert.equal(v.update(0.2), 'died');
  assert.equal(v.state, 'dead');
});

test('a revive restores reviveHp; going down past the limit is game over', () => {
  const v = new Vitals(tuning({ revivesPerCheckpoint: 1 }));
  v.damage(100);
  assert.equal(v.revive(), 'revived');
  assert.equal(v.hp, 40);
  assert.equal(v.revivesLeft, 0);
  assert.equal(v.damage(100), 'died');
  v.reset();
  v.damage(100);
  assert.equal(v.state, 'downed', 'reset refills the revive budget');
});

test('unlimited revives (story) never skip the downed state', () => {
  const v = new Vitals(tuning({ revivesPerCheckpoint: null }));
  for (let i = 0; i < 10; i++) {
    assert.equal(v.damage(500), 'downed');
    v.revive();
  }
  assert.equal(v.revivesLeft, null);
});

test('checkpoint refills revives; heal caps at max and ignores the downed', () => {
  const v = new Vitals(tuning());
  v.damage(100);
  v.revive();
  v.checkpoint();
  assert.equal(v.revivesLeft, 1);
  v.heal(500);
  assert.equal(v.hp, 100);
  v.damage(100);
  assert.equal(v.heal(10), null);
});
