import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_VERSION, SaveStore, type SaveData } from '../game/save.ts';
import { isScratchSession, persistentStore } from './storage.ts';

function fakeLocalStorage(seed: Record<string, string>): { calls: string[]; data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  const calls: string[] = [];
  const ls = {
    getItem: (k: string) => (calls.push(`get ${k}`), data.get(k) ?? null),
    setItem: (k: string, v: string) => (calls.push(`set ${k}`), void data.set(k, v)),
    removeItem: (k: string) => (calls.push(`remove ${k}`), void data.delete(k)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  return { calls, data };
}

const save: SaveData = {
  version: SAVE_VERSION,
  kind: 'auto',
  slot: 2,
  savedAt: '2026-11-20T19:00:00.000Z',
  playTime: 30,
  difficulty: 'standard',
  chapter: 'slice01',
  level: 'slice01',
  checkpoint: 'cp_first_contact',
  location: 'Commons',
  player: { position: [0, 1.62, 0], yaw: 0, pitch: 0, health: 100, flashlightOn: true },
  flags: {},
  items: [],
  map: {},
};

test('?slot=scratch turns on a scratch session; other values do not', () => {
  assert.equal(isScratchSession('?slot=scratch'), true);
  assert.equal(isScratchSession('?debug&slot=scratch&memprobe'), true);
  for (const s of ['', '?slot=1', '?scratch', '?slot=Scratch']) assert.equal(isScratchSession(s), false, s);
});

test('a scratch session never reads or writes localStorage, and existing slots stay as they were', () => {
  const seed = { 'js-fps:save:slot2:auto': '{"player":"theirs"}', 'js-fps:save:lastSlot': '2' };
  const ls = fakeLocalStorage(seed);
  try {
    const saves = new SaveStore(persistentStore(true));
    assert.equal(saves.read(2, 'auto').data, null, 'scratch starts empty');
    saves.write(save);
    saves.clearSlot(1);
    assert.equal(saves.read(2, 'auto').data?.checkpoint, 'cp_first_contact');
    assert.deepEqual(ls.calls, []);
    assert.deepEqual(Object.fromEntries(ls.data), seed);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('a normal session still persists to localStorage', () => {
  const ls = fakeLocalStorage({});
  try {
    new SaveStore(persistentStore(false)).write(save);
    assert.ok(ls.calls.includes('set js-fps:save:slot2:auto'));
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
