import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryStore } from '../core/storage.ts';
import { validate } from '../core/validate.ts';
import { validateDifficultyTable } from '../data/types/difficulty.ts';
import { formatPlayTime, parseSave, SaveStore, type SaveData } from './save.ts';

function sample(over: Partial<SaveData> = {}): SaveData {
  return {
    version: 1,
    kind: 'auto',
    slot: 0,
    savedAt: '2026-11-16T03:00:00.000Z',
    playTime: 75,
    difficulty: 'standard',
    chapter: 'slice01',
    level: 'demo-room',
    checkpoint: 'cp_start',
    location: 'Lab B',
    player: { position: [0, 1.62, 8.6], yaw: 0, pitch: 0, health: 100, flashlightOn: true },
    flags: { 'cp:cp_start': true },
    ...over,
  };
}

test('write then read round-trips', () => {
  const s = new SaveStore(memoryStore());
  s.write(sample());
  assert.deepEqual(s.read(0, 'auto').data, sample());
});

test('slot summary picks the newer of auto and manual; latest() spans slots', () => {
  const s = new SaveStore(memoryStore());
  s.write(sample({ kind: 'auto', savedAt: '2026-11-16T03:00:00.000Z' }));
  s.write(sample({ kind: 'manual', savedAt: '2026-11-16T04:00:00.000Z' }));
  s.write(sample({ slot: 2, savedAt: '2026-11-16T05:00:00.000Z' }));
  assert.equal(s.summary(0).latest?.kind, 'manual');
  assert.equal(s.latest()?.slot, 2);
  assert.equal(s.firstEmptySlot(), 1);
});

test('damaged saves are reported, not thrown', () => {
  const store = memoryStore();
  const s = new SaveStore(store);
  store.set(s.key(1, 'auto'), '{"version":1,"kind":"auto"');
  store.set(s.key(1, 'manual'), JSON.stringify({ ...sample({ slot: 1 }), difficulty: 'nightmare' }));
  const sum = s.summary(1);
  assert.match(sum.auto.error ?? '', /not valid JSON/);
  assert.match(sum.manual.error ?? '', /difficulty: unknown value "nightmare"/);
  assert.equal(sum.latest, null);
  assert.equal(sum.empty, false);
});

test('saves from a newer game version are refused', () => {
  assert.throws(() => parseSave(JSON.stringify({ ...sample(), version: 99 }), 'x'), /newer version/);
});

test('migrations run in order', () => {
  const v0 = { ...sample(), version: 0, location: undefined, place: 'Old name' };
  const migrations = {
    0: (old: Record<string, unknown>) => {
      const { place, ...rest } = old;
      return { ...rest, location: place };
    },
  };
  const out = parseSave(JSON.stringify(v0), 'x', migrations, 1);
  assert.equal(out.location, 'Old name');
  assert.equal(out.version, 1);
});

test('clearSlot empties a slot', () => {
  const s = new SaveStore(memoryStore());
  s.write(sample());
  s.clearSlot(0);
  assert.equal(s.summary(0).empty, true);
});

test('play time formatting', () => {
  assert.equal(formatPlayTime(0), '0:00');
  assert.equal(formatPlayTime(75), '1:15');
  assert.equal(formatPlayTime(3723), '1:02:03');
});

test('shipped difficulty.json is valid', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('../data/difficulty.json', import.meta.url), 'utf8'));
  const t = validate(validateDifficultyTable, raw, 'data/difficulty.json');
  assert.equal(t.story.revivesPerCheckpoint, null);
  assert.ok(t.survival.playerDamageTaken > t.story.playerDamageTaken);
});
