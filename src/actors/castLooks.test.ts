import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSpec } from './castLooks.ts';

test('Dr. Voss is a named cast member: the same female body every run, whatever NPC id or seed places her (infection-kills spec)', () => {
  const a = castSpec('voss', 'researcher_b');
  const b = castSpec('voss', 'some_other_id');
  assert.equal(a.model, 'office3', 'the stand-in female body until a licensed lab-coat model replaces it');
  assert.equal(b.model, a.model, 'the body does not depend on the NPC id');
  assert.equal(a.seed, 'lena-voss', 'a fixed seed, so a fallback procedural body is also the same every run');
  assert.notEqual(castSpec('lab', 'researcher_b').model, undefined, 'generic lab crew still get a crew body');
});

// flooded-tunnel spec "The door seals in the creature's face" / "The elite pries its way back through" (design D13).
test('the flood elite is the hero-tier blade-armed body at the hero size, the same whatever NPC id spawns it', () => {
  const spec = castSpec('flood_elite', 'r09_flood_shambler');
  assert.equal(spec.model, 'necromorph', 'the hero tier body (data/body-models.json)');
  assert.equal(spec.height, 2.15);
  assert.equal(castSpec('flood_elite', 'other').model, spec.model);
});
