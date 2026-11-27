/**
 * Combining authored data files that each hold one owner's part of a table (spec `content-layout`: a character, a creature or
 * a pose family each edit their own file). A name two files define is an error that names both.
 */

/** One authored file: its path under src/ (for error messages) and its parsed content. */
export type DataFile<T> = readonly [path: string, content: T];

type Table = Readonly<Record<string, unknown>>;

export function mergeTables(files: ReadonlyArray<DataFile<Table>>, what: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const owner = new Map<string, string>();
  for (const [path, table] of files) {
    for (const [name, value] of Object.entries(table)) {
      const first = owner.get(name);
      if (first !== undefined) throw new Error(`${what} "${name}" is defined in both ${first} and ${path}`);
      owner.set(name, path);
      out[name] = value;
    }
  }
  return out;
}

/** The pose files as one pose file (`data/types/poses.ts` validates the result, so `extends` may cross files). */
export function mergePoseFiles(files: ReadonlyArray<DataFile<{ poses: Table; sequences: Table }>>): {
  poses: Record<string, unknown>;
  sequences: Record<string, unknown>;
} {
  return {
    poses: mergeTables(files.map(([path, f]) => [path, f.poses]), 'pose'),
    sequences: mergeTables(files.map(([path, f]) => [path, f.sequences]), 'pose sequence'),
  };
}
