import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapDoor } from './mapModel.ts';
import { buildRoomAdjacency, computeCompass, relativeBearing, resolveWorldMarker } from './wayfinding.ts';

function door(id: string, a: string, b: string, x: number, z: number, deck = 0): MapDoor {
  return { id, rooms: [a, b], deck, gap: { a: [x, z], b: [x, z] }, center: [x, z], gate: null, state: 'closed' };
}

test('compass displays only N/E/S/W cardinals and computes signed left/right bearings accurately', () => {
  // Facing North (yaw = 0): N is dead ahead (0), E is +90 deg (+right), W is -90 deg (-left), S is behind (not visible).
  const north = computeCompass({ x: 0, y: 0, z: 0 }, 0, []);
  const labels = north.cardinals.map((c) => c.label);
  assert.deepEqual(new Set(labels), new Set(['N', 'E', 'W']));
  assert.ok(!labels.some((l) => l.length > 1), 'no intercardinal clutter');
  const byLabel = Object.fromEntries(north.cardinals.map((c) => [c.label, c.x]));
  assert.ok(Math.abs(byLabel['N']!) < 1e-6, 'N centered when facing North');
  assert.ok(byLabel['E']! > 0.8 && byLabel['E']! < 1.0, 'E to the right of N');
  assert.ok(byLabel['W']! < -0.8 && byLabel['W']! > -1.0, 'W to the left of N');

  // Facing West (yaw = +PI/2): W is centered, N is to the right, S is to the left.
  const west = computeCompass({ x: 0, y: 0, z: 0 }, Math.PI / 2, []);
  const westMap = Object.fromEntries(west.cardinals.map((c) => [c.label, c.x]));
  assert.ok(Math.abs(westMap['W']!) < 1e-6, 'W centered when facing West');
  assert.ok(westMap['N']! > 0.8, 'N to the right when facing West');
  assert.ok(westMap['S']! < -0.8, 'S to the left when facing West');
  assert.ok(Math.abs(relativeBearing(Math.PI, 0, 1)) < 1e-6, 'South bearing when yaw=PI');
});

test('compass objective markers report distance and clamp when behind the player', () => {
  const res = computeCompass(
    { x: 10, y: 0, z: 10 },
    0, // facing North (-Z)
    [
      { id: 'ahead', pos: { x: 10, y: 0, z: 0 }, required: true },
      { id: 'behindRight', pos: { x: 15, y: 0, z: 22 }, required: false },
      { id: 'behindLeft', pos: { x: 5, y: 0, z: 22 }, required: true },
    ],
  );
  const byId = Object.fromEntries(res.objectives.map((m) => [m.id, m]));
  assert.equal(byId['ahead']!.distance, 10);
  assert.equal(byId['ahead']!.clamped, false);
  assert.ok(Math.abs(byId['ahead']!.x) < 1e-6);

  assert.equal(byId['behindRight']!.distance, 13);
  assert.equal(byId['behindRight']!.clamped, true);
  assert.equal(byId['behindRight']!.x, 1, 'clamped to right edge');

  assert.equal(byId['behindLeft']!.clamped, true);
  assert.equal(byId['behindLeft']!.x, -1, 'clamped to left edge');
});

test('room-adjacency world marker: same room -> target, 1 hop -> nearest connecting door, 2+ hops -> null', () => {
  const doors = [
    door('D_R02_R03', 'R02', 'R03', 14, 16),
    door('D_R02_R14a', 'R02', 'R14a', 34, 16),
    door('D_R14a_R14b', 'R14a', 'R14b', 42, 16),
    door('D_R02_R03_south', 'R02', 'R03', 14, 20),
  ];
  const adj = buildRoomAdjacency(doors);

  // Same room (0 hops): points directly at target (lifted to chest height from y=0).
  const same = resolveWorldMarker('obj_briefing', true, 'R03', { x: 12, y: 0, z: 16 }, ['R03'], { x: 8, y: 0, z: 17.4 }, adj);
  assert.ok(same);
  assert.equal(same!.kind, 'target');
  assert.equal(same!.pos.x, 8);
  assert.equal(same!.pos.y, 1.25);
  assert.equal(same!.distance, 4);

  // Adjacent room (1 hop): points at the nearest connecting door.
  const nearNorth = resolveWorldMarker('obj_briefing', true, 'R02', { x: 20, y: 0, z: 15 }, ['R03'], { x: 8, y: 0, z: 17.4 }, adj);
  assert.ok(nearNorth);
  assert.equal(nearNorth!.kind, 'door');
  assert.equal(nearNorth!.doorId, 'D_R02_R03');
  assert.equal(nearNorth!.pos.x, 14);
  assert.equal(nearNorth!.pos.z, 16);

  const nearSouth = resolveWorldMarker('obj_briefing', true, 'R02', { x: 20, y: 0, z: 21 }, ['R03'], { x: 8, y: 0, z: 17.4 }, adj);
  assert.equal(nearSouth!.doorId, 'D_R02_R03_south', 'picks nearest connecting door');

  // 2 rooms away (R03 -> R02 -> R14a): marks the first door on the route.
  const far = resolveWorldMarker('round_hydro', true, 'R03', { x: 8, y: 0, z: 17 }, ['R14a'], { x: 38, y: 0, z: 16 }, adj);
  assert.equal(far!.kind, 'door');
  assert.ok(far!.doorId === 'D_R02_R03' || far!.doorId === 'D_R02_R03_south');

  // 3 rooms away (R03 -> R02 -> R14a -> R14b): still the first door on the route.
  const veryFar = resolveWorldMarker('round_hydro', true, 'R03', { x: 8, y: 0, z: 17 }, ['R14b'], { x: 46, y: 0, z: 16 }, adj);
  assert.equal(veryFar!.kind, 'door');
  assert.ok(veryFar!.doorId === 'D_R02_R03' || veryFar!.doorId === 'D_R02_R03_south');

  // From R02 the route to R14b goes through the R14a door, not back toward R03.
  const mid = resolveWorldMarker('round_hydro', true, 'R02', { x: 20, y: 0, z: 15 }, ['R14b'], { x: 46, y: 0, z: 16 }, adj);
  assert.equal(mid!.doorId, 'D_R02_R14a');

  // Disconnected target: no marker.
  const none = resolveWorldMarker('x', true, 'R03', { x: 8, y: 0, z: 17 }, ['R99'], { x: 0, y: 0, z: 0 }, adj);
  assert.equal(none, null);
});
