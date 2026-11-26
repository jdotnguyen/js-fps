/**
 * Reports shader programs first compiled during play (session-loading "First-use shader compiles are reported",
 * openspec stop-midgame-shader-stalls D6). Each one stalled the frame that first drew it, so each is a gap in the
 * loading screen's warm-up.
 */

/** What the watch reads of a three.js program (`renderer.info.programs`). */
export interface ProgramEntry {
  /** Unique for the life of the renderer. */
  readonly id: number;
  /** The material's name, often empty. */
  readonly name: string;
  /** The material's type (`MeshStandardMaterial`, `ShaderMaterial`...). */
  readonly type?: string;
}

export class ProgramWatch {
  private readonly seen = new Set<number>();

  /** Take `programs` as expected: the warm-up's, and any built while the watch is not reporting. */
  accept(programs: readonly ProgramEntry[]): void {
    for (const p of programs) this.seen.add(p.id);
  }

  /** The programs not accepted or reported before. Each is returned once. */
  unexpected(programs: readonly ProgramEntry[]): ProgramEntry[] {
    const out: ProgramEntry[] = [];
    for (const p of programs) {
      if (this.seen.has(p.id)) continue;
      this.seen.add(p.id);
      out.push(p);
    }
    return out;
  }
}

/** The console line for one program compiled during play. */
export function programWarning(p: ProgramEntry): string {
  return `[shaders] compiled during play: ${p.type ?? 'program'} "${p.name}" (not prepared by the loading screen)`;
}
