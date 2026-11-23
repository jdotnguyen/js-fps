/** Every level's JSON, loaded on demand (Vite glob). Shared by the session and the title preload. */
export const LEVEL_FILES = import.meta.glob<unknown>('../data/levels/*.json', { import: 'default' });

/** The loader for `levelId`'s JSON, or throws with the known ids. */
export function levelFileLoader(levelId: string): () => Promise<unknown> {
  const file = Object.entries(LEVEL_FILES).find(([path]) => path.endsWith(`/${levelId}.json`));
  if (!file) throw new Error(`No level '${levelId}'. Known: ${Object.keys(LEVEL_FILES).map((f) => f.replace(/^.*\/|\.json$/g, '')).join(', ')}`);
  return file[1];
}
