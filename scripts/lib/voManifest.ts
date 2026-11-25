/**
 * What `scripts/vo-generate.ts` writes into a dialogue line's `audio` field when it syncs the manifest.
 * A line's own take (`assets/vo/<id>.mp3`) wins when the file exists. A line already wired to some other file that exists
 * (a credited scream in `scripts/vo-reactions.ts` LINE_POOLS, a shared take) is left alone: it is never nulled.
 * Returns `undefined` when the field must not change.
 */
export function manifestAudio(id: string, current: string | string[] | null, exists: (assetPath: string) => boolean): string | null | undefined {
  if (Array.isArray(current)) return undefined;
  const own = `assets/vo/${id}.mp3`;
  if (exists(own)) return current === own ? undefined : own;
  if (current !== null && exists(current)) return undefined;
  return current === null ? undefined : null;
}
