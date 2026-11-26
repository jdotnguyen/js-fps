import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUGGERNAUT_DEF } from './juggernaut.ts';

// openspec rig-juggernaut, spec creature-rig "Creatures are posed through their own rig": the Juggernaut is not a humanoid
// body, and no humanoid motion capture plays on it.

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const MODEL_FILE = JUGGERNAUT_DEF.model.split('/').pop()!;

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

test('the body model library does not list the Juggernaut', () => {
  const lib = readFileSync(join(SRC, 'data/body-models.json'), 'utf8');
  assert.ok(!lib.includes(MODEL_FILE), 'body-models.json has no entry for it');
  assert.ok(!/juggernaut/i.test(lib));
});

test('no motion capture names the Juggernaut', () => {
  for (const f of [join(SRC, 'data/mocap-core.json'), ...files(join(SRC, 'data/mocap'), '.json')]) {
    assert.ok(!/juggernaut/i.test(readFileSync(f, 'utf8')), f);
  }
});

test('only the creature\'s own modules load its model, and they stay off the humanoid pipeline', () => {
  const rel = (f: string) => f.slice(SRC.length).replace(/\\/g, '/');
  const owners = files(SRC, '.ts').filter((f) => !f.endsWith('.test.ts') && !f.endsWith('TestKit.ts') && readFileSync(f, 'utf8').includes(MODEL_FILE)).map(rel);
  assert.deepEqual(owners.sort(), ['render/fx/juggernaut.ts']);
  const creature = [...files(join(SRC, 'actors/creature'), '.ts'), join(SRC, 'render/fx/juggernaut.ts')].filter((f) => !f.endsWith('.test.ts') && !f.endsWith('TestKit.ts'));
  for (const f of creature) {
    const imports = [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const banned of ['bodyModel', 'bodyModelLibrary', 'humanoid', 'skeleton.ts', 'mocap', 'animator']) {
      assert.ok(!imports.some((i) => i.includes(banned)), `${rel(f)} imports ${banned}`);
    }
  }
});
