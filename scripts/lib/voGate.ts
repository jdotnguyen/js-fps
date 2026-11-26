/**
 * New clips wait in a staging folder until their words check out (voice-playback spec, "New takes are checked before
 * they ship"). A held clip stays there with a note of what was heard, and the shipped clip is left alone. The author
 * ships it by accepting its line id after listening.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compareWords } from './voCompare.ts';
import type { Transcriber } from './voStt.ts';
import { recordBatch } from './voTakes.ts';

/** Where new clips wait (gitignored). */
export const STAGING_DIR = join(resolve(import.meta.dirname, '../..'), 'previews/vo-staging');

/** The batch a staged clip came from, so an accepted clip is recorded in `vo-takes.json` like any other. */
export interface StagedTake {
  name: string;
  speakers: string[];
  voices: string[];
  model: string;
  /** ISO time the batch was generated. */
  at: string;
  resplit: boolean;
}

export interface HeldNote {
  id: string;
  text: string;
  heard: string;
  reasons: string[];
  take: StagedTake | null;
}

export interface GateInput {
  id: string;
  /** The line's subtitle. */
  text: string;
  /** Subtitles of the lines recorded just before and after it, when it was cut from a batch. */
  previous?: string | undefined;
  next?: string | undefined;
  /** False for a gasp, scream or bracketed sound, which has no words to compare. */
  verbal: boolean;
  staged: string;
  shipped: string;
  take: StagedTake | null;
  /** Null on a machine without speech-to-text: the clip ships and is reported as unchecked. */
  transcribe: Transcriber | null;
}

export type GateResult =
  | { status: 'passed' | 'unchecked' | 'nonverbal' }
  | { status: 'held'; heard: string; reasons: string[] };

export const stagedClip = (stagingDir: string, id: string): string => join(stagingDir, `${id}.mp3`);
const noteFor = (staged: string): string => staged.replace(/\.mp3$/, '.json');

function ship(staged: string, shipped: string): void {
  mkdirSync(dirname(shipped), { recursive: true });
  renameSync(staged, shipped);
  rmSync(noteFor(staged), { force: true });
}

export function gateClip(input: GateInput): GateResult {
  const { id, text, staged, shipped, take, transcribe } = input;
  if (!input.verbal) {
    ship(staged, shipped);
    return { status: 'nonverbal' };
  }
  if (!transcribe) {
    ship(staged, shipped);
    return { status: 'unchecked' };
  }
  let heard = '';
  let reasons: string[];
  try {
    heard = transcribe(staged);
    reasons = compareWords({ text, heard, previous: input.previous, next: input.next });
  } catch (err) {
    // A transcriber that fails on one clip must not let it through.
    reasons = [`could not be transcribed: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (reasons.length === 0) {
    ship(staged, shipped);
    return { status: 'passed' };
  }
  const note: HeldNote = { id, text, heard, reasons, take };
  writeFileSync(noteFor(staged), `${JSON.stringify(note, null, 2)}\n`, 'utf8');
  return { status: 'held', heard, reasons };
}

/** Ships held clips the author has listened to. Throws before moving anything if an id has no staged clip. */
export function acceptClips(ids: readonly string[], stagingDir: string, outDir: string): HeldNote[] {
  const missing = ids.filter((id) => !existsSync(stagedClip(stagingDir, id)) || !existsSync(noteFor(stagedClip(stagingDir, id))));
  if (missing.length > 0) throw new Error(`No held clip for: ${missing.join(', ')} (held clips are in ${stagingDir})`);
  return ids.map((id) => {
    const staged = stagedClip(stagingDir, id);
    const note = JSON.parse(readFileSync(noteFor(staged), 'utf8')) as HeldNote;
    ship(staged, join(outDir, `${id}.mp3`));
    return note;
  });
}

/** Records accepted clips in `vo-takes.json` against the batch that made them (voice-playback spec, traceable clips). */
export function recordAccepted(notes: readonly HeldNote[], path?: string): void {
  const batches = new Map<string, { take: StagedTake; lines: string[] }>();
  for (const { id, take } of notes) {
    // A re-cut of old audio has no new take: the clip keeps the record it already has.
    if (!take) continue;
    const key = `${take.name}@${take.at}`;
    const batch = batches.get(key) ?? { take, lines: [] };
    batch.lines.push(id);
    batches.set(key, batch);
  }
  for (const { take, lines } of batches.values()) {
    recordBatch(
      { name: take.name, speakers: take.speakers, voices: take.voices, model: take.model, lines },
      { resplit: take.resplit, now: new Date(take.at), ...(path !== undefined ? { path } : {}) },
    );
  }
}

/** One line per held clip: what it should say and what was heard. */
export function describeHeld(id: string, text: string, heard: string, reasons: readonly string[]): string {
  return `  - ${id}: ${reasons.join('; ')}\n      expected: ${text}\n      heard:    ${heard || '(nothing)'}`;
}
