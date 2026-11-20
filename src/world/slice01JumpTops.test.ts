/**
 * jump-reach-1m: every top in slice01 that Jay can now jump onto but could not walk onto, grouped by room, for a
 * one-time design review (are any of these out of bounds, past a trigger, or a fight cheese spot?). A top counts if it
 * is between the step height and the jump reach above the deck floor and some spot on it has standing headroom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airStep, ceilingHeight, DEFAULT_MOTOR, jumpApex } from '../actors/motor.ts';
import { loadSlice01 } from './headlessSlice.ts';

const FLOOR_Y = 0;
const SKIN = 1e-4;
/** Highest top a jump can mount: the arc's apex plus the air step (~1.006 m). */
const PEAK = jumpApex(DEFAULT_MOTOR.jumpSpeed, DEFAULT_MOTOR.gravity) + airStep(DEFAULT_MOTOR);
const GRID = 0.25;

test('slice01: tops reachable by jump but not by walking (review list)', (t) => {
  const { level } = loadSlice01();
  const world = level.collision;
  const byRoom = new Map<string, string[]>();
  let count = 0;
  for (const c of world.colliders) {
    if (!c.enabled) continue;
    const top = c.maxY - FLOOR_Y;
    if (c.minY > FLOOR_Y + DEFAULT_MOTOR.stepHeight || top <= DEFAULT_MOTOR.stepHeight + SKIN || top > PEAK + SKIN) continue;
    // Some spot on the top must have room to stand (nothing low over it).
    let standable = 0;
    let spots = 0;
    for (let x = c.minX + GRID / 2; x < c.maxX; x += GRID) {
      for (let z = c.minZ + GRID / 2; z < c.maxZ; z += GRID) {
        spots++;
        if (ceilingHeight(x, z, c.maxY + SKIN, c.maxY + DEFAULT_MOTOR.height, DEFAULT_MOTOR, world) === Infinity) standable++;
      }
    }
    if (spots === 0) {
      spots = 1;
      const x = (c.minX + c.maxX) / 2;
      const z = (c.minZ + c.maxZ) / 2;
      if (ceilingHeight(x, z, c.maxY + SKIN, c.maxY + DEFAULT_MOTOR.height, DEFAULT_MOTOR, world) === Infinity) standable = 1;
    }
    if (standable === 0) continue;
    count++;
    const room = c.tag;
    const line =
      `top ${top.toFixed(2)} m at (${((c.minX + c.maxX) / 2).toFixed(1)}, ${((c.minZ + c.maxZ) / 2).toFixed(1)}), ` +
      `${(c.maxX - c.minX).toFixed(2)} x ${(c.maxZ - c.minZ).toFixed(2)} m` +
      (standable < spots ? `, headroom over ${Math.round((100 * standable) / spots)}%` : '');
    const list = byRoom.get(room) ?? [];
    list.push(line);
    byRoom.set(room, list);
  }
  t.diagnostic(`${count} jump-only tops (step ${DEFAULT_MOTOR.stepHeight} m < top <= ${PEAK.toFixed(3)} m, with headroom)`);
  for (const [room, lines] of [...byRoom].sort((a, b) => a[0].localeCompare(b[0]))) {
    t.diagnostic(`${room}: ${lines.length}`);
    for (const l of lines) t.diagnostic(`  ${l}`);
  }
  assert.ok(Number.isFinite(PEAK) && PEAK > 1 && PEAK < 1.02, `peak reach ${PEAK}`);
});
