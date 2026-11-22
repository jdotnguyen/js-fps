import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
import { MocapLibrary, type RawMocapFile } from './mocap.ts';

const core = coreJson as unknown as RawMocapFile;

test('mocap library: the clips loaded at start stay within 2 MB', () => {
  const bytes = fs.statSync(path.resolve(import.meta.dirname, '../data/mocap-core.json')).size;
  assert.ok(bytes <= 2 * 1024 * 1024, `core library is ${(bytes / 1024).toFixed(0)} KB`);
});

test('mocap packs: a character pack is added, held by its bodies, and released with the last one', () => {
  const lib = new MocapLibrary(core);
  const pack: RawMocapFile = { version: 1, fps: 24, source: 'test', clips: { probe_idle: core.clips['idle']!, idle: core.clips['jog']! } };
  lib.addPack('probe', pack);
  assert.ok(lib.has('probe_idle'));
  assert.equal(lib.get('idle').frames, core.clips['idle']!.frames, 'a pack never replaces a core clip');
  lib.retainPack('probe');
  lib.retainPack('probe');
  lib.releasePack('probe');
  assert.ok(lib.has('probe_idle'), 'still held by one body');
  lib.releasePack('probe');
  assert.ok(!lib.has('probe_idle'), 'released with the last body');
  assert.ok(!lib.hasPack('probe'));
  assert.ok(lib.has('idle'), 'core clips stay');
  for (let i = 0; i < 20; i++) {
    lib.addPack('probe', pack);
    lib.retainPack('probe');
    lib.releasePack('probe');
  }
  assert.equal(lib.ids().length, Object.keys(core.clips).length, 'no growth over repeated loads');
});

test('mocap packs: the generated loaders are plain dynamic imports (an import attribute breaks the Vite dev server)', () => {
  // With \`{ with: { type: 'json' } }\` the browser expects a native JSON module, but Vite's dev server serves the pack as
  // JavaScript, so the pack, and the game's start-up that awaits it, fail to load. Tests add packs through static imports.
  const text = fs.readFileSync(path.resolve(import.meta.dirname, '../data/mocap/packs.ts'), 'utf8');
  for (const m of text.matchAll(/import\(([^)]*)\)/g)) assert.doesNotMatch(m[1]!, /with|assert/, `loader ${m[0]} carries an import attribute`);
});

test('mocap packs: a character built again after its pack was released (a restart) loads it again and plays its own motion', async () => {
  const { Humanoid } = await import('./humanoid.ts');
  const { CAST } = await import('./castLooks.ts');
  const { ctx } = await import('../ai/enemyTestKit.ts');
  const priyaPack = (await import('../data/mocap/priya.json', { with: { type: 'json' } })).default as unknown as RawMocapFile;
  const lib = new MocapLibrary(core);
  lib.addPack('priya', priyaPack);
  let loads = 0;
  // Node cannot run the bundler's lazy pack import, so the body gets a loader that adds the pack as the game's would.
  const loadMocapPack = async (l: MocapLibrary, name: string): Promise<void> => {
    loads++;
    l.addPack(name, priyaPack);
  };
  const make = () => new Humanoid({ ...CAST['priya']!, role: 'npc' }, { ...ctx(), mocap: lib, loadMocapPack });
  const first = make();
  assert.equal(first['animator'].motion.clips.idle, 'priya_idle', 'loaded at start: her own idle');
  first.dispose();
  assert.ok(!lib.hasPack('priya'), 'her last body went, so her pack was released');

  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(' '));
  let again: InstanceType<typeof Humanoid>;
  try {
    again = make();
    assert.equal(again['animator'].motion.clips.idle, 'idle', 'while the pack loads she plays the default');
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.warn = warn;
  }
  assert.equal(loads, 1, 'the pack was loaded again');
  assert.equal(again['animator'].motion.clips.idle, 'priya_idle', 'and she plays her own idle again');
  assert.deepEqual(warnings, [], 'no fallback warnings while it loads');
  again.dispose();
  assert.ok(!lib.hasPack('priya'), 'and it is released with her again');
});
