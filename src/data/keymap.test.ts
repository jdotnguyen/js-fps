import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../core/validate.ts';
import { ACTIONS, validateKeymap } from './types/keymap.ts';

test('shipped keymap.json is valid and binds every action', () => {
  const raw: unknown = JSON.parse(readFileSync(new URL('./keymap.json', import.meta.url), 'utf8'));
  const keymap = validate(validateKeymap, raw, 'data/keymap.json');
  for (const a of ACTIONS) assert.ok(keymap[a].length > 0, `${a} is unbound`);
});
