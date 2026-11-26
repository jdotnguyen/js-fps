/**
 * Every level's data, loaded on demand (Vite glob): a `<id>.json` file, or the `<id>/<id>.level.ts` module that puts
 * a level folder together. Shared by the session and the title preload.
 */
export const LEVEL_FILES = import.meta.glob<unknown>(['../data/levels/*.json', '../data/levels/*/*.level.ts'], { import: 'default' });

const levelIdOf = (path: string): string => path.replace(/^.*\/|\.level\.ts$|\.json$/g, '');

/** The loader for `levelId`'s data, or throws with the known ids. */
export function levelFileLoader(levelId: string): () => Promise<unknown> {
  const file = Object.entries(LEVEL_FILES).find(([path]) => levelIdOf(path) === levelId);
  if (!file) throw new Error(`No level '${levelId}'. Known: ${Object.keys(LEVEL_FILES).map(levelIdOf).join(', ')}`);
  return file[1];
}
