import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptClips, gateClip, recordAccepted, stagedClip, type GateInput, type StagedTake } from './voGate.ts';
import { manifestAudio } from './voManifest.ts';

const LINE = "They're powdered, Giles. You ask every single morning.";
const TAKE: StagedTake = { name: 'retake_player_01', speakers: ['player'], voices: ['Orus'], model: 'gemini-3.1-flash-tts-preview', at: '2026-11-25T00:00:00.000Z', resplit: false };

interface Dirs {
  staging: string;
  out: string;
  /** A freshly cut clip waiting in staging. */
  stage: (id: string, bytes?: string) => string;
}

function inTempDirs(run: (d: Dirs) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'vo-gate-'));
  const staging = join(root, 'staging');
  const out = join(root, 'vo');
  mkdirSync(staging);
  mkdirSync(out);
  try {
    run({
      staging,
      out,
      stage: (id, bytes = 'new take') => {
        const path = stagedClip(staging, id);
        writeFileSync(path, bytes);
        return path;
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const input = (d: Dirs, heard: string, over: Partial<GateInput> = {}): GateInput => ({
  id: 'intro_jay_05',
  text: LINE,
  next: "What's in it?",
  verbal: true,
  staged: d.stage('intro_jay_05'),
  shipped: join(d.out, 'intro_jay_05.mp3'),
  take: TAKE,
  transcribe: () => heard,
  ...over,
});

test('gate: a clip with the next line on its end is held, and the shipped clip and dialogue entry stay as they are', () => {
  inTempDirs((d) => {
    const shipped = join(d.out, 'intro_jay_05.mp3');
    writeFileSync(shipped, 'shipped take');
    const result = gateClip(input(d, "They're powder, Giles. You ask every single morning. What's in it?"));
    assert.equal(result.status, 'held');
    assert.match((result as { reasons: string[] }).reasons.join(), /next line/);
    assert.equal(readFileSync(shipped, 'utf8'), 'shipped take');
    // What the manifest sync would write for a line wired to that shipped clip: nothing.
    assert.equal(manifestAudio('intro_jay_05', 'assets/vo/intro_jay_05.mp3', () => existsSync(shipped)), undefined);
    const note = JSON.parse(readFileSync(join(d.staging, 'intro_jay_05.json'), 'utf8'));
    assert.equal(note.text, LINE);
    assert.match(note.heard, /What's in it/);
    assert.deepEqual(note.take, TAKE);
  });
});

test('gate: a held clip for a new line is not wired', () => {
  inTempDirs((d) => {
    gateClip(input(d, 'Everything all right, Director?'));
    const shipped = join(d.out, 'intro_jay_05.mp3');
    assert.equal(manifestAudio('intro_jay_05', null, () => existsSync(shipped)), undefined);
  });
});

test('gate: a clip that says its line ships, and clears an earlier held note', () => {
  inTempDirs((d) => {
    gateClip(input(d, 'Something else entirely.'));
    const result = gateClip(input(d, "They're powdered, Giles. You ask every single morning."));
    assert.equal(result.status, 'passed');
    assert.equal(readFileSync(join(d.out, 'intro_jay_05.mp3'), 'utf8'), 'new take');
    assert.ok(!existsSync(stagedClip(d.staging, 'intro_jay_05')));
    assert.ok(!existsSync(join(d.staging, 'intro_jay_05.json')));
  });
});

test('gate: without speech-to-text the clip ships as unchecked, never as passed', () => {
  inTempDirs((d) => {
    assert.equal(gateClip(input(d, '', { transcribe: null })).status, 'unchecked');
    assert.ok(existsSync(join(d.out, 'intro_jay_05.mp3')));
  });
});

test('gate: a non-verbal line is not compared with its text', () => {
  inTempDirs((d) => {
    const result = gateClip(input(d, '', { verbal: false, transcribe: () => assert.fail('must not transcribe') }));
    assert.equal(result.status, 'nonverbal');
    assert.ok(existsSync(join(d.out, 'intro_jay_05.mp3')));
  });
});

test('gate: a transcriber that fails holds the clip', () => {
  inTempDirs((d) => {
    const result = gateClip(input(d, '', { transcribe: () => { throw new Error('ffmpeg died'); } }));
    assert.equal(result.status, 'held');
    assert.ok(!existsSync(join(d.out, 'intro_jay_05.mp3')));
  });
});

test('gate: accepting a held clip by id ships it and hands back its batch', () => {
  inTempDirs((d) => {
    gateClip(input(d, 'A misheard line.'));
    const notes = acceptClips(['intro_jay_05'], d.staging, d.out);
    assert.deepEqual(notes.map((n) => n.take), [TAKE]);
    assert.equal(readFileSync(join(d.out, 'intro_jay_05.mp3'), 'utf8'), 'new take');
    assert.ok(!existsSync(join(d.staging, 'intro_jay_05.json')));
  });
});

test('gate: accepted clips are recorded against their batch; re-cuts and re-splits add no record', () => {
  inTempDirs((d) => {
    const takes = join(d.staging, 'takes.json');
    const note = (id: string, take: StagedTake | null) => ({ id, text: '', heard: '', reasons: [], take });
    recordAccepted([note('a', TAKE), note('b', TAKE), note('c', null), note('e', { ...TAKE, name: 'other', resplit: true })], takes);
    const written = JSON.parse(readFileSync(takes, 'utf8'));
    assert.equal(written.length, 1);
    assert.deepEqual([written[0].batch, written[0].lines, written[0].at], ['retake_player_01', ['a', 'b'], TAKE.at]);
  });
});

test('gate: accepting an id with no held clip moves nothing', () => {
  inTempDirs((d) => {
    gateClip(input(d, 'A misheard line.'));
    assert.throws(() => acceptClips(['intro_jay_05', 'intro_jay_08'], d.staging, d.out), /intro_jay_08/);
    assert.ok(!existsSync(join(d.out, 'intro_jay_05.mp3')));
  });
});
