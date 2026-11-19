import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_CREDITS,
  DEVELOPMENT_CREDITS,
  HEADLINE_CREDITS,
  LIKENESS_CREDITS,
  MODEL_CREDITS,
  TEXTURE_CREDITS,
} from './credits.ts';

test('headline and development credits attribute all roles to Justin Nguyen', () => {
  assert.ok(HEADLINE_CREDITS.length >= 2);
  const nonTitleHeadlines = HEADLINE_CREDITS.slice(1);
  for (const card of nonTitleHeadlines) {
    assert.equal(card.title, 'JUSTIN NGUYEN');
  }
  assert.ok(DEVELOPMENT_CREDITS.length > 0);
  for (const entry of DEVELOPMENT_CREDITS) {
    assert.equal(entry.name, 'Justin Nguyen');
  }
});

test('likeness credits include Katie Heins and August Giles', () => {
  const names = LIKENESS_CREDITS.map((c) => c.name);
  assert.deepEqual(names, ['Katie Heins', 'August Giles']);
});

test('model, texture, and audio credits cover third-party assets from CREDITS.md', () => {
  assert.equal(MODEL_CREDITS.length, 19);
  for (const m of MODEL_CREDITS) {
    assert.ok(m.asset.length > 0);
    assert.ok(m.author.length > 0);
    assert.ok(m.licence.startsWith('CC '));
    assert.ok(m.usedAs.length > 0);
  }
  assert.equal(TEXTURE_CREDITS.length, 3);
  assert.equal(AUDIO_CREDITS.length, 1);
});
