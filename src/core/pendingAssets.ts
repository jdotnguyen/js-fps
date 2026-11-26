/**
 * Loads a builder starts without waiting for them (a kit piece's model or texture): it reports each one here, and the
 * loading screen waits for them all, so none arrives during play and stalls a frame there (session-loading
 * "Late-appearing models load with the session", openspec stop-midgame-shader-stalls D4). One set per page: a world
 * built at the title reports here too.
 */

const pending = new Set<Promise<void>>();

/** Report a load in flight. A failure counts as finished; the caller warns about it. */
export function trackAsset(load: PromiseLike<unknown>): void {
  const tracked: Promise<void> = Promise.resolve(load).then(
    () => void pending.delete(tracked),
    () => void pending.delete(tracked),
  );
  pending.add(tracked);
}

/** Resolves once no reported load is in flight, including loads reported while waiting. Never rejects. */
export async function assetsSettled(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending);
}
