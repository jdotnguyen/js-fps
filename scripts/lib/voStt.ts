/**
 * Local speech-to-text for checking voice clips (voice-playback spec, "New takes are checked before they ship").
 * Uses ffmpeg's `whisper` filter with a whisper.cpp model file on this machine, so no audio is sent anywhere and no
 * npm package is needed. Setup: docs/voice-casting-standard.md §8.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
export const DEFAULT_MODEL = join(ROOT, 'previews/models/ggml-base.en.bin');

/** Turns an audio file into the words heard in it. */
export type Transcriber = (audioPath: string) => string;

export type SttSetup = { transcribe: Transcriber; model: string } | { transcribe: null; reason: string };

/**
 * Silence added around a clip before transcribing, in seconds. The small model drops or invents words on a clip that
 * starts or ends right on speech.
 */
const LEAD_S = 0.5;
const TAIL_S = 0.8;

function hasWhisperFilter(): boolean {
  try {
    return /\bwhisper\b/.test(execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return false;
  }
}

/** The transcriber, or why this machine has none. `VO_STT_MODEL` names a model file other than the default. */
export function sttSetup(model = process.env.VO_STT_MODEL || DEFAULT_MODEL): SttSetup {
  const path = resolve(model);
  if (!existsSync(path)) return { transcribe: null, reason: `no speech model at ${path}` };
  if (!hasWhisperFilter()) return { transcribe: null, reason: 'ffmpeg is missing or was built without the whisper filter' };
  let n = 0;
  return {
    model: path,
    transcribe: (audioPath) => {
      // Windows drive colons cannot go in a filter argument, so ffmpeg runs beside the model and both files are bare names.
      const out = `heard-${process.pid}-${n++}.txt`;
      const filter = [
        `adelay=${Math.round(LEAD_S * 1000)}`,
        `apad=pad_dur=${TAIL_S}`,
        'aresample=16000',
        `whisper=model=${basename(path)}:language=en:queue=30:use_gpu=false:format=text:destination=${out}`,
      ].join(',');
      const written = join(dirname(path), out);
      try {
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', resolve(audioPath), '-af', filter, '-f', 'null', '-'], {
          cwd: dirname(path),
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 120_000,
        });
        return existsSync(written) ? readFileSync(written, 'utf8').replace(/\s+/g, ' ').trim() : '';
      } finally {
        rmSync(written, { force: true });
      }
    },
  };
}
