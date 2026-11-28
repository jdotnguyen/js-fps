import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { EventBus } from '../../core/events.ts';
import { levelFileIds, readLevel } from '../../data/levels/readLevel.ts';
import type { Materials } from '../../render/materials.ts';
import { SET_PIECES, type SetPiece } from './index.ts';

const DIR = new URL('./', import.meta.url);
const LEVEL_SRC = readFileSync(new URL('../level.ts', import.meta.url), 'utf8');
const SEQUENCES = readdirSync(new URL('../../data/sequences/', import.meta.url))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length));

/** Every `id` string anywhere in a level's data: rooms, doors, props, glass, anchors, NPCs, walks, triggers... */
function contentIds(data: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(data)) for (const v of data) contentIds(v, out);
  else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id' && typeof v === 'string') out.add(v);
      else contentIds(v, out);
    }
  }
  return out;
}

/** Text of every quoted string literal in `src`. */
const literals = (src: string): Set<string> => new Set([...src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\$]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? ''));

test('level.ts names no room, scene or content of any level (content-layout spec: scene behaviour in set pieces)', () => {
  const rooms = [...LEVEL_SRC.matchAll(/(?<![A-Za-z0-9])R\d{2}[a-z]?(?![A-Za-z0-9])/g)].map((m) => m[0]);
  assert.deepEqual(rooms, [], 'room ids, in code or comments');
  const strings = literals(LEVEL_SRC);
  const named = new Set([...SEQUENCES, ...SET_PIECES.map((p) => p.id), ...levelFileIds().flatMap((id) => [...contentIds(readLevel(id))])]);
  assert.deepEqual([...strings].filter((s) => named.has(s)), [], 'string literals naming a sequence, set piece or level content id');
});

test('the set-piece index lists every set-piece module once', async () => {
  const listed = new Set<SetPiece>(SET_PIECES);
  assert.equal(listed.size, SET_PIECES.length, 'a set piece listed twice');
  assert.equal(new Set(SET_PIECES.map((p) => p.id)).size, SET_PIECES.length, 'two set pieces share an id');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts' && f !== 'types.ts');
  for (const file of files) {
    const mod = (await import(new URL(file, DIR).href)) as Record<string, unknown>;
    const pieces = Object.values(mod).filter((v): v is SetPiece => !!v && typeof v === 'object' && typeof (v as SetPiece).attach === 'function');
    assert.ok(pieces.length > 0, `${file} exports no set piece`);
    for (const p of pieces) assert.ok(listed.has(p), `${file}: ${p.id} is missing from setpieces/index.ts`);
  }
});

test('a set piece whose room the level lacks attaches nothing', () => {
  const handle = { id: 'kit_test', materials: {} as Materials, events: new EventBus(), roomGroup: (): THREE.Group | null => null };
  for (const piece of SET_PIECES) assert.equal(piece.attach(handle), null, piece.id);
});
