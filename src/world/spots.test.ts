import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSlice01 } from './headlessSlice.ts';

/** ADR-0029 activity spots: kit props emit one per seat, facing the right way; level NPCs claim them. */
const { level } = loadSlice01();

test('the Commons emits a spot for every dining seat, bar stool and sofa cushion', () => {
  const spots = level.spots('R02');
  const count = (kind: string): number => spots.filter((s) => s.kind === kind).length;
  assert.equal(count('sit_chair'), 7 * 6, 'seven tables of six');
  assert.equal(count('sit_stool'), 6, 'the window bar');
  assert.equal(count('sit_sofa'), 4 + 1 + 1, 'the sofa and two armchairs');
  assert.ok(count('lean_counter') >= 4, 'servery, drink station, and vending machine emit lean spots');
  assert.ok(level.spots('R14d').some((s) => s.kind === 'lean_counter'), 'boardroom credenza emits a coffee spot');
  assert.equal(new Set(spots.map((s) => s.id)).size, spots.length, 'ids are unique');
});

test('a seat faces its table or counter, and its feet are beside it', () => {
  const spots = level.spots('R02');
  const byGroup = new Map<string, typeof spots>();
  for (const s of spots) byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
  for (const [group, seats] of byGroup) {
    if (seats[0]!.kind === 'sit_sofa' || !seats[0]!.kind.startsWith('sit_')) continue; // sofas face out; lean spots are standing counters
    const cx = seats.reduce((a, s) => a + s.pos.x, 0) / seats.length;
    const cz = seats.reduce((a, s) => a + s.pos.z, 0) / seats.length;
    for (const s of seats) {
      // Facing (0 = -Z): (-sin, -cos). A table's centre is ahead; a bar's stools all face the counter (+Z here).
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      if (s.kind === 'sit_stool') {
        assert.ok(fz > 0.99, `${s.id} faces the window bar`);
        continue;
      }
      const dx = cx - s.pos.x;
      const dz = cz - s.pos.z;
      const d = Math.hypot(dx, dz);
      assert.ok((dx * fx + dz * fz) / d > 0.3, `${s.id} (${group}) faces its table`);
      assert.ok(s.seat !== undefined && s.seat > 0.4 && s.seat < 0.6, `${s.id} has a chair-height seat`);
    }
  }
});

test('every Commons NPC that asks for a seat gets its own', () => {
  const data = level.npcSpawns().filter((n) => n.room === 'R02');
  const seated = data.filter((n) => n.pose?.startsWith('sit_'));
  assert.ok(seated.length >= 8, `most of the room sits (${seated.length})`);
  for (const n of seated) assert.ok(n.spot, `${n.id} got a spot`);
  const taken = seated.map((n) => n.spot);
  assert.equal(new Set(taken).size, taken.length, 'no two NPCs share a seat');
  for (const n of seated) {
    const s = level.spots('R02').find((x) => x.id === n.spot)!;
    assert.equal(s.taken, n.id);
    assert.ok(Math.hypot(s.pos.x - n.pos.x, s.pos.z - n.pos.z) < 1e-6, `${n.id} sits on it`);
  }
});

test('conversations in the Commons have at least two people', () => {
  const groups = new Map<string, string[]>();
  for (const n of level.npcSpawns()) if (n.chat) groups.set(n.chat, [...(groups.get(n.chat) ?? []), n.id]);
  assert.ok(groups.size >= 3);
  for (const [id, members] of groups) assert.ok(members.length >= 2, `${id}: ${members.join(', ')}`);
});
