import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { SAMPLE_URLS, SOUND_SPECS, type SoundName } from './sounds.ts';

interface Area {
  specs?: Readonly<Record<string, unknown>>;
  samples?: Readonly<Record<string, unknown>>;
}

const DIR = new URL('./sounds/', import.meta.url);

/** Every area file on disk, so one left out of the index is still checked. */
const areas = await Promise.all(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map(async (file) => ({ file, area: (await import(new URL(file, DIR).href)) as Area })),
);

test('no sound name is defined in two area files', () => {
  const files = new Map<string, string[]>();
  for (const { file, area } of areas) {
    // A spec and its recorded sample share a name within one file.
    for (const name of new Set([...Object.keys(area.specs ?? {}), ...Object.keys(area.samples ?? {})])) {
      files.set(name, [...(files.get(name) ?? []), file]);
    }
  }
  const twice = [...files].filter(([, f]) => f.length > 1).map(([name, f]) => `${name}: ${f.join(', ')}`);
  assert.deepEqual(twice, []);
});

test('the index lists every area file', () => {
  const specs: Readonly<Record<string, unknown>> = SOUND_SPECS;
  const samples: Readonly<Record<string, unknown>> = SAMPLE_URLS;
  for (const { file, area } of areas) {
    for (const [name, spec] of Object.entries(area.specs ?? {})) assert.equal(specs[name], spec, `${file} specs.${name}`);
    for (const [name, urls] of Object.entries(area.samples ?? {})) assert.equal(samples[name], urls, `${file} samples.${name}`);
  }
});

test('SoundName rejects a name no area file defines', () => {
  const known: SoundName = 'pistolShot';
  // @ts-expect-error no area file defines this name, so `npm run typecheck` fails without this line
  const typo: SoundName = 'pistolShoot';
  assert.ok(known in SOUND_SPECS);
  assert.ok(!(typo in SOUND_SPECS) && !(typo in SAMPLE_URLS));
});
