import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entryProblems, matches, readSources } from './config.ts';

const good = {
  id: 'power_box',
  source: 'power_box_01_2k.gltf/power_box_01_2k.gltf',
  licence: 'CC0',
  author: 'Rico Cilliers',
  title: 'Power Box 01',
  url: 'https://polyhaven.com/a/power_box_01',
  height: 0.5,
  triBudget: 4000,
};

test('a complete entry has no problems', () => {
  assert.deepEqual(entryProblems(good), []);
});

test('an entry missing licence, author or height is refused with its id', () => {
  const { ok, refused } = readSources({ props: [good, { ...good, id: 'bad_box', licence: '', height: undefined }, { ...good, id: 'no_author', author: undefined }] });
  assert.deepEqual(ok.map((e) => e.id), ['power_box']);
  assert.equal(refused.length, 2);
  assert.match(refused[0]!, /^bad_box: .*missing licence.*missing height/);
  assert.match(refused[1]!, /^no_author: missing author/);
});

test('duplicate ids, bad parts and bad fronts are refused', () => {
  const { refused } = readSources({
    props: [good, { ...good }, { ...good, id: 'b', front: 'up' }, { ...good, id: 'c', parts: { Door: { closed: 'yes' } } }],
  });
  assert.match(refused[0]!, /^power_box: duplicate id/);
  assert.match(refused[1]!, /^b: front must be/);
  assert.match(refused[2]!, /^c: part name "Door".*missing node.*closed must be/);
});

test('selectors match by name, prefix, material and node index', () => {
  assert.ok(matches('Door', 'Door', 3, []));
  assert.ok(!matches('Door', 'Door_2', 3, []));
  assert.ok(matches('lab_cabinet_r_door*', 'lab_cabinet_r_door_glass_0', 3, []));
  assert.ok(matches('mat:mat_biomass', '???', 3, ['mat_biomass']));
  assert.ok(matches('#7', 'anything', 7, []));
  assert.ok(!matches('#7', 'anything', 70, []));
});

test('the checked-in sources file is valid', () => {
  const raw = JSON.parse(readFileSync(new URL('../props.sources.json', import.meta.url), 'utf8'));
  const { ok, refused } = readSources(raw);
  assert.deepEqual(refused, []);
  assert.ok(ok.length >= 9, `${ok.length} entries`);
});
