import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DialogueLibrary } from '../library.ts';
import { buildVoCatalog, filterCatalog, inferSpeakerForVoFile } from './voCatalog.ts';

function loadDiskData(): {
  library: DialogueLibrary;
  chapters: Record<string, unknown>;
  voFiles: string[];
  zombieFiles: string[];
} {
  const dlgDir = join(process.cwd(), 'src/data/dialogue');
  const rawSpeakers: unknown = JSON.parse(readFileSync(join(dlgDir, 'speakers.json'), 'utf8'));
  const chapters: Record<string, unknown> = {};
  for (const file of readdirSync(dlgDir).sort()) {
    if (!file.endsWith('.json') || file === 'speakers.json' || file === 'ui.json') continue;
    chapters[`data/dialogue/${file}`] = JSON.parse(readFileSync(join(dlgDir, file), 'utf8'));
  }
  const library = new DialogueLibrary(rawSpeakers, chapters);
  const voDir = join(process.cwd(), 'public/assets/vo');
  const voFiles = existsSync(voDir)
    ? readdirSync(voDir)
        .filter((f) => f.endsWith('.mp3'))
        .sort()
        .map((f) => `assets/vo/${f}`)
    : [];
  const zDir = join(process.cwd(), 'public/assets/audio/zombies');
  const zombieFiles = existsSync(zDir)
    ? readdirSync(zDir)
        .filter((f) => f.endsWith('.mp3'))
        .sort()
        .map((f) => `assets/audio/zombies/${f}`)
    : [];
  return { library, chapters, voFiles, zombieFiles };
}

describe('voCatalog', () => {
  it('includes every dialogue line and every MP3 in public/assets/vo and zombies, grouped by character', () => {
    const { library, chapters, voFiles, zombieFiles } = loadDiskData();
    const catalog = buildVoCatalog(chapters, library, voFiles, zombieFiles);

    assert.equal(catalog.totalDialogueLines, library.allLines().length);
    assert.ok(catalog.groups.length >= 20, `expected >= 20 character groups, got ${catalog.groups.length}`);

    // Every file on disk in public/assets/vo/ and zombies/ must appear in at least one entry.
    const catalogClips = new Set<string>();
    for (const g of catalog.groups) {
      for (const e of g.entries) {
        for (const c of e.clips) catalogClips.add(c);
      }
    }
    for (const f of [...voFiles, ...zombieFiles]) {
      assert.ok(catalogClips.has(f), `VO file "${f}" missing from voices.html catalog`);
    }

    // No disk VO file should fall into the 'unassigned' bucket.
    const unassigned = catalog.groups.find((g) => g.speaker === 'unassigned');
    assert.equal(unassigned, undefined, `unexpected unassigned VO files: ${unassigned?.entries.map((e) => e.id).join(', ')}`);

    // Named crew speakers should NOT all be collapsed under generic "Crew".
    const voss = catalog.groups.find((g) => g.speaker === 'crew_lab');
    assert.ok(voss, 'expected Dr. Lena Voss (crew_lab) group');
    assert.equal(voss.displayName, 'Dr. Lena Voss');
    assert.ok(voss.entries.some((e) => e.sourceKind === 'sfx' && e.id === 'react_voss_panic_01'));

    const infected = catalog.groups.find((g) => g.speaker === 'infected');
    assert.ok(infected, 'expected Infected group');
    assert.equal(infected.entries.length, zombieFiles.length);
  });

  it('infers character speaker IDs for unreferenced VO filenames', () => {
    assert.equal(inferSpeakerForVoFile('assets/vo/react_giles_cry_01.mp3'), 'engineer');
    assert.equal(inferSpeakerForVoFile('assets/vo/stinger_priya_04.mp3'), 'nurse');
    assert.equal(inferSpeakerForVoFile('assets/vo/react_voss_panic_02.mp3'), 'crew_lab');
    assert.equal(inferSpeakerForVoFile('assets/vo/unknown_clip.mp3'), 'unassigned');
  });

  it('filters by speaker, chapter, channel, and search text', () => {
    const { library, chapters, voFiles, zombieFiles } = loadDiskData();
    const catalog = buildVoCatalog(chapters, library, voFiles, zombieFiles);

    const onlyGiles = filterCatalog(catalog.groups, { query: '', chapter: 'all', channel: 'all', speaker: 'engineer' });
    assert.equal(onlyGiles.length, 1);
    assert.equal(onlyGiles[0]!.speaker, 'engineer');

    const onlyUnref = filterCatalog(catalog.groups, { query: '', chapter: 'unreferenced', channel: 'all', speaker: 'all' });
    assert.ok(onlyUnref.length >= 1);
    for (const g of onlyUnref) {
      for (const e of g.entries) assert.equal(e.chapter, 'unreferenced');
    }

    const searchByName = filterCatalog(catalog.groups, { query: 'priya', chapter: 'all', channel: 'all', speaker: 'all' });
    assert.ok(searchByName.some((g) => g.speaker === 'nurse'));
  });
});
