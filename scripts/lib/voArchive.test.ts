import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveRecording, writeRecording } from './voArchive.ts';

function inTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'vo-archive-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('archive: a second recording under one name keeps both, and the newer has the plain name', () => {
  inTempDir((dir) => {
    const wav = join(dir, 'retake_player_01.wav');
    writeRecording(wav, Buffer.from('first take'));
    writeRecording(wav, Buffer.from('second take'));
    assert.equal(readFileSync(wav, 'utf8'), 'second take');
    const older = readdirSync(join(dir, 'older'));
    assert.equal(older.length, 1);
    assert.match(older[0]!, /^retake_player_01\.\d{4}-\d\d-\d\dT[\d-]+Z\.wav$/);
    assert.equal(readFileSync(join(dir, 'older', older[0]!), 'utf8'), 'first take');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.wav')), ['retake_player_01.wav'], 'vo-trace reads only the top folder');
  });
});

test('archive: recordings with the same file time do not overwrite each other', () => {
  inTempDir((dir) => {
    const wav = join(dir, 'vo_chief_01.wav');
    const at = new Date('2026-11-20T04:00:16.100Z');
    for (const take of ['a', 'b', 'c']) {
      writeRecording(wav, Buffer.from(take));
      utimesSync(wav, at, at);
    }
    const older = readdirSync(join(dir, 'older')).sort();
    assert.equal(older.length, 2);
    assert.deepEqual(older.map((f) => readFileSync(join(dir, 'older', f), 'utf8')).sort(), ['a', 'b']);
  });
});

test('archive: nothing to move is not an error', () => {
  inTempDir((dir) => {
    assert.equal(archiveRecording(join(dir, 'missing.wav')), null);
    assert.deepEqual(readdirSync(dir), []);
  });
});
