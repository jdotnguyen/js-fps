import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestByLine, readTakes, recordBatch } from './voTakes.ts';

const batch = { name: 'retake_engineer_01', speakers: ['engineer'], voices: ['Algenib'], model: 'gemini-2.5-flash-preview-tts', lines: ['sec_giles_06', 'sec_giles_07'] };

test('takes: a generated batch adds one entry naming its model; a resplit adds none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vo-takes-'));
  try {
    const path = join(dir, 'vo-takes.json');
    assert.equal(recordBatch(batch, { resplit: false, path, now: new Date('2026-11-21T12:00:00Z') }), true);
    assert.equal(recordBatch(batch, { resplit: true, path }), false);
    const entries = readTakes(path);
    assert.equal(entries.length, 1);
    const { name, ...rest } = batch;
    assert.deepEqual(entries[0], { ...rest, batch: name, at: '2026-11-21T12:00:00.000Z', source: 'generated' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('takes: each line maps to its latest batch', () => {
  const at = '2026-11-21T00:00:00.000Z';
  const latest = latestByLine([
    { batch: 'a', speakers: ['medic'], voices: ['Charon'], model: 'gemini-3.1-flash-tts-preview', lines: ['sec_okafor_01', 'sec_okafor_02'], at, source: 'traced', confidence: 'direct' },
    { batch: 'b', speakers: ['medic'], voices: ['Charon'], model: 'gemini-2.5-flash-preview-tts', lines: ['sec_okafor_01'], at, source: 'generated' },
  ]);
  assert.equal(latest.get('sec_okafor_01')!.batch, 'b');
  assert.equal(latest.get('sec_okafor_02')!.batch, 'a');
});
