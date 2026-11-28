import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Rng } from '../core/rng.ts';
import { RADIO_REACH, RADIO_TRACKS, crackleBuffer, radioReach, saturationCurve } from './radio.ts';
import { readLevel } from '../data/levels/readLevel.ts';

test('the saturation curve is odd, monotonic and hits +/-1 at the ends', () => {
  const c = saturationCurve(2.2, 1025);
  assert.ok(Math.abs(c[0]! + 1) < 1e-6 && Math.abs(c[1024]! - 1) < 1e-6);
  assert.ok(Math.abs(c[512]!) < 1e-6);
  for (let i = 1; i < c.length; i++) assert.ok(c[i]! >= c[i - 1]!);
});

test('crackle is sparse, quiet and deterministic per seed', () => {
  const a = crackleBuffer(8000, 9, new Rng('x'));
  const b = crackleBuffer(8000, 9, new Rng('x'));
  assert.deepEqual(a, b);
  const busy = a.filter((v) => Math.abs(v) > 1e-4).length / a.length;
  assert.ok(busy < 0.02, `crackle fills ${(busy * 100).toFixed(2)} % of samples`);
  const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak < 0.5 && peak > 0.005, `peak ${peak}`);
});

test('every radio track file exists', () => {
  for (const [id, url] of Object.entries(RADIO_TRACKS)) {
    assert.ok(existsSync(new URL(`../../public/${url}`, import.meta.url)), `${id}: ${url}`);
  }
});

test('the radio fills the Commons kitchen and is silent well before the R07 to R09 door', () => {
  assert.ok(RADIO_REACH.fadeFrom >= 20 && RADIO_REACH.silentAt <= 25);
  const level = readLevel('slice01') as { rooms: Array<{ id: string; anchors?: Array<{ id: string; pos: number[] }> }> };
  const commons = level.rooms.find((r) => r.id === 'R02')!;
  const [rx, ry, rz] = commons.anchors!.find((a) => a.id === 'radio')!.pos as [number, number, number];
  const from = (x: number, z: number): number => radioReach(Math.hypot(x - rx, 1.6 - ry, z - rz));
  assert.equal(from(25.6, 13.4), 1, 'at the kitchen stand');
  assert.equal(from(6, 44), 0, 'at the R07 to R09 door');
  assert.equal(radioReach(RADIO_REACH.silentAt), 0);
  assert.ok(radioReach(22.5) > 0 && radioReach(22.5) < 1, 'fades, no hard edge');
});
