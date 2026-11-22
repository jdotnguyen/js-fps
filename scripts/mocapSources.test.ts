import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ES module without types
import { ACCEPTED_LICENCES, DEFAULT_MANIFEST, ROOT, loadManifest } from './lib/mocapSources.mjs';

const manifest = (): Record<string, any> => JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8'));

function writeTmp(m: unknown): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mocap-')), 'sources.json');
  fs.writeFileSync(f, JSON.stringify(m));
  return f;
}

test('mocap bake list: validates, every source has an accepted licence and credit fields', () => {
  const m = loadManifest();
  for (const [id, s] of Object.entries<any>(m.sources)) {
    assert.ok(ACCEPTED_LICENCES.includes(s.licence), `${id} licence`);
    assert.ok(s.title && s.author && s.url, `${id} credit`);
  }
  assert.ok(m.clips.length >= 10);
});

test('mocap bake list: sources outside previews/sources, unaccepted licences and unknown sources are rejected', () => {
  const outside = manifest();
  outside.sources['quaternius-ual'].path = '../elsewhere/ual.gltf';
  assert.throws(() => loadManifest(writeTmp(outside)), /must be under previews\/sources/);

  const scratch = manifest();
  scratch.sources['cmu'].dir = 'C:/Users/someone/scratch';
  assert.throws(() => loadManifest(writeTmp(scratch)), /must be under previews\/sources/);

  const licence = manifest();
  licence.sources['cmu'].licence = 'All rights reserved';
  assert.throws(() => loadManifest(writeTmp(licence)), /licence "All rights reserved"/);

  const unknown = manifest();
  unknown.clips.push({ id: 'x', source: 'nowhere', take: 'y' });
  assert.throws(() => loadManifest(writeTmp(unknown)), /unknown source "nowhere"/);
});

test('mocap bake: a missing source stops the bake, names the file and where to get it, and writes nothing', () => {
  const m = manifest();
  m.clips.push({ id: 'cmu_probe', source: 'cmu', take: '999_99', loop: true, loco: false });
  const f = writeTmp(m);
  const out = path.join(path.dirname(f), 'out.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/bake-mocap.mjs'), '--manifest', f, '--out', out], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /previews\/sources\/mocap\/cmu\/999_99\.bvh/);
  assert.match(r.stderr, /raw\.githubusercontent\.com\/una-dinosauria\/cmu-mocap\/master\/data\/999\/999_99\.bvh/);
  assert.ok(!fs.existsSync(out), 'nothing written');
});

test('mocap bake: --check passes on the committed bake list', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/bake-mocap.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
});
