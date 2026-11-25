import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_CREDITS,
  HEADLINE_CREDITS,
  LIKENESS_CREDITS,
  MODEL_CREDITS,
  MUSIC_CREDITS,
  TEXTURE_CREDITS,
} from './credits.ts';

test('only the opening headline cards credit Justin Nguyen', () => {
  assert.ok(HEADLINE_CREDITS.length >= 2);
  const nonTitleHeadlines = HEADLINE_CREDITS.slice(1);
  for (const card of nonTitleHeadlines) {
    assert.equal(card.title, 'JUSTIN NGUYEN');
  }
});

test('music credits list all original tracks and scores', () => {
  const names = MUSIC_CREDITS.map((c) => c.name);
  assert.deepEqual(names, ['"Pressure"', '"Lab B"', '"Medical Bay"', '"TAG FM"']);
  const musicCard = HEADLINE_CREDITS.find((c) => c.eyebrow === 'MUSIC & SOUND DESIGN');
  assert.ok(musicCard?.subtitle);
  for (const title of ['PRESSURE', 'LAB B', 'MEDICAL BAY', 'TAG FM']) {
    assert.ok(musicCard.subtitle.includes(title), `expected ${title} in ${musicCard.subtitle}`);
  }
});

test('likeness credits include Katie Heins and August Giles', () => {
  const names = LIKENESS_CREDITS.map((c) => c.name);
  assert.deepEqual(names, ['Katie Heins', 'August Giles']);
});

test('model, texture, and audio credits cover third-party assets from CREDITS.md', () => {
  assert.equal(MODEL_CREDITS.length, 26);
  for (const m of MODEL_CREDITS) {
    assert.ok(m.asset.length > 0);
    assert.ok(m.author.length > 0);
    assert.ok(/^CC( |0$)/.test(m.licence), m.licence);
    assert.ok(m.usedAs.length > 0);
  }
  assert.equal(TEXTURE_CREDITS.length, 3);
  assert.equal(AUDIO_CREDITS.length, 1);
});
