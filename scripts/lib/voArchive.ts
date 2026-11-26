/**
 * Raw batch recordings are never overwritten (voice-playback spec, "Raw batch recordings are kept"). A bad cut can
 * only be redone from the recording it came from, and batch names repeat from run to run (`retake_player_01`).
 *
 * The newest recording keeps the plain name, so `--resplit` reads it. Earlier ones move to `older/` beside it, named
 * by their file time. `vo-trace.ts` reads only the top folder.
 */
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** Moves the recording at `path` into `older/`. Returns where it went, or null when there was nothing to move. */
export function archiveRecording(path: string): string | null {
  if (!existsSync(path)) return null;
  const dir = join(dirname(path), 'older');
  mkdirSync(dir, { recursive: true });
  const ext = extname(path);
  const stamp = statSync(path).mtime.toISOString().replace(/[:.]/g, '-');
  const stem = join(dir, `${basename(path, ext)}.${stamp}`);
  let to = `${stem}${ext}`;
  for (let n = 2; existsSync(to); n++) to = `${stem}.${n}${ext}`;
  renameSync(path, to);
  return to;
}

/** Writes a new raw recording, keeping any earlier one of the same name. */
export function writeRecording(path: string, data: Uint8Array): void {
  archiveRecording(path);
  writeFileSync(path, data);
}
