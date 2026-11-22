import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaterBody } from '../../world/water.ts';
import { buildRippleMask, rippleGrid, stampFalloff, stepRipplesCpu, type RippleGrid } from './ripples.ts';

// standing-water spec (overhaul-flooded-tunnel D6): ripples spread, reflect off walls and fade.

/** A 12 m x 2 m channel at 5 cm texels; `wallAt` (m from the left) puts a solid strip across it. */
function channel(wallAt: number | null): { grid: RippleGrid; mask: Uint8Array } {
  const grid: RippleGrid = { width: 240, height: 40, minX: 0, minZ: 0, sizeX: 12, sizeZ: 2 };
  const mask = new Uint8Array(grid.width * grid.height).fill(255);
  if (wallAt !== null) {
    const i0 = Math.round(wallAt / 0.05);
    for (let j = 0; j < grid.height; j++) for (let i = i0; i < i0 + 4; i++) mask[j * grid.width + i] = 0;
  }
  return { grid, mask };
}

/** Stamp at x = 6; the probe's peak is taken only from step `from` on (after the outgoing ring has passed it). */
function run(wallAt: number | null, steps: number, probeX: number, from = 0): { probe: number; behind: number } {
  const { grid, mask } = channel(wallAt);
  const n = grid.width * grid.height;
  const cur = new Float32Array(n);
  const prev = new Float32Array(n);
  stepRipplesCpu(cur, prev, cur, mask, grid, [{ x: 6, z: 1, radius: 0.2, strength: -0.01 }]);
  let probeMax = 0;
  let behindMax = 0;
  for (let s = 0; s < steps; s++) {
    stepRipplesCpu(cur, prev, cur, mask, grid);
    const row = 20 * grid.width;
    if (s >= from) probeMax = Math.max(probeMax, Math.abs(cur[row + Math.round(probeX / 0.05)]!));
    if (wallAt !== null) for (let i = Math.round(wallAt / 0.05) + 6; i < grid.width; i++) behindMax = Math.max(behindMax, Math.abs(cur[row + i]!));
  }
  return { probe: probeMax, behind: behindMax };
}

test('a stamp falls off smoothly to nothing at its radius', () => {
  assert.equal(stampFalloff(0, 0.2), 1);
  assert.ok(Math.abs(stampFalloff(0.1, 0.2) - 0.5) < 1e-9);
  assert.equal(stampFalloff(0.2, 0.2), 0);
});

test('a ring spreads out from a stamp', () => {
  const { probe } = run(null, 40, 6.6);
  assert.ok(probe > 1e-4, `the ring reached 0.6 m away (${probe})`);
});

test('a ring reflects off a wall and never passes through it', () => {
  // Wall 1 m right of the stamp. Once the ring has had time to reach it (~0.5 s), open water lets the right-going
  // half carry on past x = 7, while the wall sends it back: more of the energy stays left of the wall.
  const leftEnergy = (wallAt: number | null): number => {
    const { grid, mask } = channel(wallAt);
    const n = grid.width * grid.height;
    const cur = new Float32Array(n);
    const prev = new Float32Array(n);
    stepRipplesCpu(cur, prev, cur, mask, grid, [{ x: 6, z: 1, radius: 0.2, strength: -0.01 }]);
    for (let s = 0; s < 70; s++) stepRipplesCpu(cur, prev, cur, mask, grid);
    let e = 0;
    for (let j = 0; j < grid.height; j++) for (let i = 0; i < 140; i++) e += cur[j * grid.width + i]! ** 2;
    return e;
  };
  const withWall = leftEnergy(7.0);
  const open = leftEnergy(null);
  assert.ok(withWall > open * 1.15, `the wall keeps the energy on the stamp's side: ${withWall} vs ${open}`);
  assert.equal(run(7.0, 70, 6.5).behind, 0, 'nothing behind the wall moves');
});

test('ripples fade over a few seconds', () => {
  const { grid, mask } = channel(null);
  const n = grid.width * grid.height;
  const cur = new Float32Array(n);
  const prev = new Float32Array(n);
  stepRipplesCpu(cur, prev, cur, mask, grid, [{ x: 6, z: 1, radius: 0.2, strength: -0.01 }]);
  const energy = (): number => cur.reduce((a, v) => a + v * v, 0);
  for (let s = 0; s < 30; s++) stepRipplesCpu(cur, prev, cur, mask, grid);
  const early = energy();
  for (let s = 0; s < 300; s++) stepRipplesCpu(cur, prev, cur, mask, grid);
  assert.ok(energy() < early * 0.05, `5 s later the energy is under 5% (${energy() / early})`);
});

test('the mask is water over the footprint and solid where something stands through the surface', () => {
  const body = new WaterBody({ room: 'R09', level: -0.45, floor: -1.2, cells: [{ minX: 0, maxX: 4, minZ: 0, maxZ: 4 }] });
  const grid = rippleGrid(body);
  assert.deepEqual([grid.width, grid.height], [80, 80]);
  // A support 0.4 m square at the centre of the cell.
  const mask = buildRippleMask(body, grid, (x, z) => Math.abs(x - 2) < 0.2 && Math.abs(z - 2) < 0.2);
  assert.equal(mask[40 * 80 + 40], 0, 'the support');
  assert.equal(mask[10 * 80 + 10], 255, 'open water');
});
