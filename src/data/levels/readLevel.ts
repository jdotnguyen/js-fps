/**
 * Level data from disk, for tests and tools (split-level-data D2). The game's browser reader is each level folder's
 * `<id>.level.ts`. A level is either one `<id>.json` file or an `<id>/` folder of part files.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { assembleLevel, levelPartsFromFiles, type LevelParts } from './assembleLevel.ts';

const LEVELS = new URL('./', import.meta.url);

const parse = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));

/** The part files of the level folder `<id>/`. */
export function readLevelParts(id: string): LevelParts {
  const folder = new URL(`${id}/`, LEVELS);
  const files = ['', 'rooms/'].flatMap((dir) =>
    readdirSync(new URL(dir, folder))
      .filter((f) => f.endsWith('.json'))
      .map((f) => `${dir}${f}`),
  );
  return levelPartsFromFiles(Object.fromEntries(files.map((f) => [f, parse(new URL(f, folder))])));
}

/** A level's data as the game loads it, unvalidated: its `<id>.json`, or its folder's parts put together. */
export function readLevel(id: string): unknown {
  return existsSync(new URL(`${id}/level.json`, LEVELS)) ? assembleLevel(readLevelParts(id)) : parse(new URL(`${id}.json`, LEVELS));
}

/** Every level id under `data/levels/` (`slice01`, `kit_test`, ...). */
export function levelFileIds(): string[] {
  return readdirSync(LEVELS, { withFileTypes: true })
    .flatMap((e) => {
      if (e.isDirectory()) return existsSync(new URL(`${e.name}/level.json`, LEVELS)) ? [e.name] : [];
      return e.name.endsWith('.json') ? [e.name.slice(0, -'.json'.length)] : [];
    })
    .sort();
}
