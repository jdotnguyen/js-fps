import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditAudio, projectAuditInput } from '../../scripts/audio-audit.ts';

test('no procedural spec, recorded sample or audio file is unused', async () => {
  const result = auditAudio(await projectAuditInput());
  assert.deepEqual(result, { unreferencedSpecs: [], unusedSamples: [], unregisteredFiles: [] }, 'run npm run audio:audit for details');
});

test('the audit catches a dead entry', async () => {
  const real = await projectAuditInput();
  const planted = auditAudio({
    ...real,
    specNames: [...real.specNames, 'zzUnusedSynth'],
    samples: { ...real.samples, zzUnusedSample: 'assets/audio/zz/unused.mp3' },
    files: [...real.files, 'assets/audio/zz/stray.mp3'],
  });
  assert.deepEqual(planted.unreferencedSpecs, ['zzUnusedSynth']);
  assert.deepEqual(planted.unusedSamples, ['zzUnusedSample']);
  assert.deepEqual(planted.unregisteredFiles, ['assets/audio/zz/stray.mp3']);
});

test('a sample shadowing a used procedural spec counts as used', () => {
  const r = auditAudio({
    specNames: ['hum'],
    samples: { hum: 'assets/audio/hum.mp3' },
    sources: new Map([['src/a.ts', "engine.loop('hum')"]]),
    files: ['assets/audio/hum.mp3'],
  });
  assert.deepEqual(r, { unreferencedSpecs: [], unusedSamples: [], unregisteredFiles: [] });
});
