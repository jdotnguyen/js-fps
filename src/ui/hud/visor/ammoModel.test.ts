// visor-hud: rounds as pips, firing and dry fire, and the reload refill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_SECONDS, AmmoModel, isLow, RELOAD_GRACE, type AmmoPoll } from './ammoModel.ts';

const STEP = 1 / 60;

const pistol = (over: Partial<AmmoPoll> = {}): AmmoPoll => ({ name: 'pistol', loaded: 12, reserve: 36, mag: 12, ...over });
const shotgun = (over: Partial<AmmoPoll> = {}): AmmoPoll => ({ name: 'shotgun', loaded: 6, reserve: 18, mag: 6, ...over });

function holding(poll: AmmoPoll): AmmoModel {
  const m = new AmmoModel();
  m.snap(poll);
  return m;
}

function play(m: AmmoModel, poll: AmmoPoll, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) m.step(poll, STEP);
}

test('three shots from a full pistol leave 9 filled pips', () => {
  const m = holding(pistol());
  for (let loaded = 11; loaded >= 9; loaded--) {
    assert.equal(m.fired(), loaded, 'the pip that blinks out');
    m.step(pistol({ loaded }), STEP);
  }
  assert.equal(m.shown, 9);
});

test('the pips follow the weapon when an event is missed', () => {
  const m = holding(pistol());
  m.step(pistol({ loaded: 4 }), STEP);
  assert.equal(m.shown, 4);
});

test('low is a quarter of the magazine or less, and empty is not low', () => {
  assert.deepEqual([4, 3, 1, 0].map((n) => isLow(n, 12)), [false, true, true, false]);
  assert.deepEqual([3, 2, 1, 0].map((n) => isLow(n, 6)), [false, true, true, false]);
});

test('a dry fire raises the alert for a moment', () => {
  const empty = pistol({ loaded: 0 });
  const m = holding(empty);
  m.dryFire();
  assert.ok(m.alert > 0);
  play(m, empty, ALERT_SECONDS + 0.1);
  assert.equal(m.alert, 0);
});

test('starting a reload takes the alert down', () => {
  const m = holding(pistol({ loaded: 0 }));
  m.dryFire();
  m.reloadStart(2);
  assert.equal(m.alert, 0);
});

test('a pistol reload clears the pips, then refills them over its length', () => {
  const during = pistol({ loaded: 9, reloading: true });
  const m = holding(pistol({ loaded: 9 }));
  m.reloadStart(2);
  play(m, during, 0.15);
  assert.ok(m.shown > 0 && m.shown < 9, `clearing: ${m.shown}`);
  play(m, during, 0.15);
  assert.equal(m.shown, 0, 'the magazine is out at 15%');
  play(m, during, 0.85);
  assert.ok(m.shown >= 5 && m.shown <= 7, `half refilled: ${m.shown}`);
  play(m, during, 0.9);
  assert.equal(m.shown, 12);
  m.reloaded(12);
  m.step(pistol({ loaded: 12, reserve: 33 }), STEP);
  assert.equal(m.shown, 12);
  assert.equal(m.reload, 'none');
});

test('the refill stops at what the reserve can give', () => {
  const during = pistol({ loaded: 2, reserve: 3, reloading: true });
  const m = holding(pistol({ loaded: 2, reserve: 3 }));
  m.reloadStart(2);
  play(m, during, 2.2);
  assert.equal(m.shown, 5);
});

test('the pips hold full while the weapon still reports the old count', () => {
  const during = pistol({ loaded: 0, reloading: true });
  const m = holding(pistol({ loaded: 0 }));
  m.reloadStart(2);
  play(m, during, 2.1);
  assert.equal(m.shown, 12, 'no flash back to empty before the weapon says it is done');
  play(m, during, RELOAD_GRACE);
  assert.equal(m.shown, 0, 'but a reload that never ends gives the weapon the last word');
});

test('a frozen scene freezes the refill', () => {
  const during = pistol({ loaded: 0, reloading: true });
  const m = holding(pistol({ loaded: 0 }));
  m.reloadStart(2);
  play(m, during, 1);
  const shown = m.shown;
  for (let i = 0; i < 600; i++) m.step(during, 0);
  assert.equal(m.shown, shown);
});

test('a reload the weapon drops snaps back to its counts', () => {
  const m = holding(pistol({ loaded: 3 }));
  m.reloadStart(2);
  play(m, pistol({ loaded: 3, reloading: true }), 1);
  m.step(pistol({ loaded: 3, reloading: false }), STEP);
  assert.equal(m.shown, 3);
  assert.equal(m.reload, 'none');
});

test('a reload cancelled by a swap shows the other weapon, and the first one as it was on the way back', () => {
  const m = holding(pistol({ loaded: 3 }));
  m.reloadStart(2);
  play(m, pistol({ loaded: 3, reloading: true }), 1);
  m.equipped();
  m.step(shotgun({ loaded: 4 }), STEP);
  assert.equal(m.shown, 4);
  assert.equal(m.reload, 'none');
  m.equipped();
  m.step(pistol({ loaded: 3 }), STEP);
  assert.equal(m.shown, 3);
});

test('a shotgun reload fills one shell with each insert', () => {
  const m = holding(shotgun({ loaded: 2 }));
  m.reloadStart();
  m.step(shotgun({ loaded: 2, reloading: true }), STEP);
  assert.equal(m.shown, 2);
  for (let loaded = 3; loaded <= 6; loaded++) {
    assert.equal(m.shellInsert(), loaded - 1, 'the shell that fills');
    m.step(shotgun({ loaded, reserve: 18 - (loaded - 2), reloading: true }), STEP);
    assert.equal(m.shown, loaded);
  }
  m.reloaded(6);
  assert.equal(m.shown, 6);
});

test('firing breaks a shotgun reload off and counts from what was loaded', () => {
  const m = holding(shotgun({ loaded: 2 }));
  m.reloadStart();
  m.shellInsert();
  m.reloaded(3);
  assert.equal(m.fired(), 2);
  m.step(shotgun({ loaded: 2, reserve: 17 }), STEP);
  assert.equal(m.shown, 2);
});

test('a rise in the reserve is a pickup; a reload and a swap are not', () => {
  const m = holding(pistol({ loaded: 5 }));
  assert.equal(m.step(pistol({ loaded: 5, reserve: 48 }), STEP), 12);
  assert.equal(m.step(pistol({ loaded: 12, reserve: 41 }), STEP), 0);
  assert.equal(m.step(shotgun({ reserve: 50 }), STEP), 0);
});
