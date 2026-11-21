import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadSlice01 } from './headlessSlice.ts';
import { AMBIENT } from './level.ts';
import { RENDER_TIERS } from '../render/tiers.ts';

// openspec refresh-observation-gallery: the observation gallery (R03) as a clean, dim lounge for the
// briefing and the drop (ADR-0014, ADR-0023).

const { level } = loadSlice01();
interface RoomView {
  ambient: { intensity: number };
}
const room = (id: string): RoomView => (level as unknown as { roomById: Map<string, RoomView> }).roomById.get(id)!;

test('R03 uses the dim gallery ambient, and the emergency tint still swaps it and restores it', () => {
  assert.equal(room('R03').ambient.intensity, AMBIENT.gallery.intensity);
  assert.ok(AMBIENT.gallery.intensity < AMBIENT.normal.intensity, 'darker than the default ambient');
  assert.ok(level.tintRoomLights('R03', 'emergency'));
  assert.equal(room('R03').ambient.intensity, AMBIENT.emergency.intensity);
  assert.ok(level.tintRoomLights('R03', 'none'));
  assert.equal(room('R03').ambient.intensity, AMBIENT.gallery.intensity);
});

test('R03 has 1 m of bare metal along the Lab B glass: hard footsteps there, carpet behind it', () => {
  const surfaceAt = (x: number, z: number): string | null => level.collision.surfaceAt(x, 0, z);
  for (const x of [4, 8, 12]) {
    assert.equal(surfaceAt(x, 21.3), 'metal', `strip at x ${x}`);
    assert.equal(surfaceAt(x, 20.3), 'rubber', `carpet at x ${x}`);
  }
  assert.equal(surfaceAt(8, 16), 'rubber', 'carpet in the back half');
});

/** R03 colliders between the floor and head height that overlap the box (x0..x1, z0..z1); walls and door frames sit outside these boxes. */
function blockers(x0: number, x1: number, z0: number, z1: number): string[] {
  return level.collision
    .find(x0, z0, x1, z1)
    .filter((c) => c.enabled && c.tag === 'room:R03' && c.maxY > 0.05 && c.minY < 1.8 && c.minX < x1 && c.maxX > x0 && c.minZ < z1 && c.maxZ > z0)
    .map((c) => `[${c.minX.toFixed(2)}..${c.maxX.toFixed(2)}] x [${c.minZ.toFixed(2)}..${c.maxZ.toFixed(2)}]`);
}

test('R03 keeps the door-to-door lane along the back wall clear (briefing walk-in, escape to R05 after the drop)', () => {
  assert.deepEqual(blockers(2.3, 13.7, 14.8, 17.6), []);
});

test('R03 keeps the stage between the team and the glass clear (Heins, the drop spot)', () => {
  assert.deepEqual(blockers(5.4, 10.6, 17, 20.75), []);
});

/** R03's raw light slots in index order (debug.slots lists each room's slots in order; R03 is x 2..14, z 14..22). */
const r03Slots = (): Array<{ kind: string; claimed: boolean; x: number }> =>
  level.debug.slots.filter((s) => s.pos.x > 2 && s.pos.x < 14 && s.pos.z > 14 && s.pos.z < 22 && s.pos.y > 0.5).map((s) => ({ kind: s.kind, claimed: s.claimed, x: Math.round(s.pos.x * 100) / 100 }));

test('R03 light slots: six ceilings, then the west lamp and the east pair; every fixture is claimed (no dead diffusers)', () => {
  const slots = r03Slots();
  assert.deepEqual(slots.map((s) => s.kind), ['ceiling', 'ceiling', 'ceiling', 'ceiling', 'ceiling', 'ceiling', 'pendant', 'pendant', 'pendant']);
  assert.deepEqual(slots.slice(6).map((s) => s.x), [3.9, 11.55, 12.45], 'lamp over the console, pair over the coffee table');
  assert.ok(slots.every((s) => s.claimed), 'no dead fixture in the gallery');
  // Lamps elsewhere (commons, admin) keep their static bulbs: the gallery's are the only pendant slots in slice01.
  assert.equal(level.debug.slots.filter((s) => s.kind === 'pendant').length, 3);
});

// render-lighting spec (fidelity-first-rendering): every R03 fixture is a real light, and on every tier
// R03's 9 and Lab B's 3 through the glass all light; on Medium and High the lamps and centre ceilings cast shadows.
test('R03 and Lab B stay fully lit on every tier, with shadows where the tier has them', () => {
  const real = (id: string): number => level.roomLights(id).filter((l) => l.light.light !== null).length;
  const shadowed = (id: string): number[] =>
    level.roomLights(id).flatMap((l, i) => (l.light.light instanceof THREE.SpotLight ? [i] : []));
  const at = (q: keyof typeof RENDER_TIERS): void => {
    const t = RENDER_TIERS[q];
    level.setLightBudget({ fillLights: t.fillLights, shadowLights: t.shadowLights, shadowMapSize: t.shadowMapSize });
    level.update(0, 1 / 60, new THREE.Vector3(8, 1.62, 17.4), false); // brief_jay
  };
  assert.equal(level.roomLights('R03').length, 9, 'nine lit fixtures');
  at('low');
  assert.equal(real('R03'), 9, 'Low: every gallery fixture casts real light');
  assert.equal(real('R04'), 3, 'Low: Lab B fully lit behind the glass');
  assert.deepEqual(shadowed('R03'), [], 'Low: no room shadows');
  at('high');
  assert.equal(real('R03'), 9);
  assert.equal(real('R04'), 3);
  // roomLights lists claims in data order: ceilings 0, 2, 3, 5, then 1, 4, the lamps 6, 7, and 8.
  assert.deepEqual(shadowed('R03'), [4, 5, 6, 7], 'High: both centre ceilings and both lamps over the seating cast shadows');
  at('medium');
  assert.equal(shadowed('R03').length, 2, 'Medium: the two nearest opted-in lights');
  level.setLightBudget({ fillLights: 8, shadowLights: 0, shadowMapSize: 1024 });
});

test('the drop reaches every R03 fixture, lamps and shadow lights included, with drop.json unchanged', () => {
  // drop.json drives R03 with lightState flicker, then alarm + emergency (gameHost.setLight = setRoomLights + tintRoomLights).
  const drop = JSON.stringify(JSON.parse(readFileSync(new URL('../data/sequences/drop.json', import.meta.url), 'utf8')));
  assert.ok(drop.includes('"do":"lightState","room":"R03","pattern":"flicker"'), 'drop flickers R03');
  assert.ok(drop.includes('"do":"lightState","room":"R03","pattern":"alarm","tint":"emergency"'), 'drop turns R03 to the red alarm');
  assert.ok(level.setRoomLights('R03', 'flicker'));
  assert.ok(level.roomLights('R03').every((l) => l.light.pattern === 'flicker'));
  assert.ok(level.setRoomLights('R03', 'alarm'));
  assert.ok(level.tintRoomLights('R03', 'emergency'));
  const red = new THREE.Color('#ff2a1a');
  for (const l of level.roomLights('R03')) {
    assert.equal(l.light.pattern, 'alarm', `${l.kind} follows the alarm`);
    for (const e of l.light.emissives) assert.ok(e.emissive.equals(red), `${l.kind} glows emergency red`);
  }
  level.tintRoomLights('R03', 'none');
  level.setRoomLights('R03', 'steady');
});
