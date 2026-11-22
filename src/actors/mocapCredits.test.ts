import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
import { ANIMATION_CREDITS, MODEL_CREDITS } from '../ui/credits.ts';
import type { RawMocapFile } from './mocap.ts';

const ACCEPTED = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'unrestricted'];
const creditsMd = fs.readFileSync(path.resolve(import.meta.dirname, '../../CREDITS.md'), 'utf8');
const inGame = [...ANIMATION_CREDITS.map((c) => `${c.role} ${c.name}`), ...MODEL_CREDITS.map((c) => `${c.asset} ${c.author}`)].join('\n');

/** Every problem with a clip file's credits (mocap-library spec: clips come only from free, credited sources). */
function creditProblems(file: RawMocapFile): string[] {
  const out: string[] = [];
  for (const [id, clip] of Object.entries(file.clips)) {
    const src = clip.source ? file.sources?.[clip.source] : undefined;
    if (!src) {
      out.push(`${id}: no source`);
      continue;
    }
    if (!ACCEPTED.includes(src.licence)) out.push(`${id}: licence "${src.licence}" not accepted`);
    if (!creditsMd.includes(src.title)) out.push(`${id}: "${src.title}" has no CREDITS.md row`);
    const who = src.author.split(/[ ,(]/)[0]!;
    if (!inGame.includes(who)) out.push(`${id}: ${src.author} is not in the in-game credits`);
  }
  return out;
}

function libraryFiles(): [string, RawMocapFile][] {
  const dir = path.resolve(import.meta.dirname, '../data/mocap');
  const packs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  return [['mocap-core.json', coreJson as unknown as RawMocapFile], ...packs.map((f): [string, RawMocapFile] => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))])];
}

test('mocap credits: every clip names a free source with a CREDITS.md row and an in-game credit', () => {
  for (const [name, file] of libraryFiles()) assert.deepEqual(creditProblems(file), [], name);
});

test('mocap credits: an uncredited or unaccepted-licence clip fails', () => {
  const core = coreJson as unknown as RawMocapFile;
  const { source: _drop, ...idle } = core.clips['idle']!;
  const bad: RawMocapFile = {
    ...core,
    sources: { ...core.sources, shady: { title: 'Ripped Pack', author: 'Nobody', licence: 'All rights reserved', url: 'x' } },
    clips: { a: idle, b: { ...idle, source: 'shady' } },
  };
  const p = creditProblems(bad);
  assert.ok(p.some((m) => m.startsWith('a: no source')));
  assert.ok(p.some((m) => m.startsWith('b: licence')));
  assert.ok(p.some((m) => m.includes('no CREDITS.md row')));
});
