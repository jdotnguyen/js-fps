/**
 * What is happening in the story right now, for scene variants (character-motion spec: scenes can give a character extra motion).
 * The game publishes running sequences, each named character's squad task and Giles's infection stage; bodies re-resolve their
 * profile's variants when it changes. Flags are read through `flags`, checked a few times a second.
 */
export class MotionScene {
  readonly sequences = new Set<string>();
  /** Squad task per character profile id (`giles` -> `bypass`). */
  readonly tasks = new Map<string, string>();
  stage = 0;
  flags: () => Readonly<Record<string, unknown>> = () => ({});
  /** Bumped on every change; bodies compare it to decide when to re-resolve. */
  version = 0;

  startSequence(id: string): void {
    this.sequences.add(id);
    this.version++;
  }

  endSequence(id: string): void {
    if (this.sequences.delete(id)) this.version++;
  }

  setTask(profile: string, task: string | null): void {
    if (task) this.tasks.set(profile, task);
    else this.tasks.delete(profile);
    this.version++;
  }

  setStage(stage: number): void {
    if (stage === this.stage) return;
    this.stage = stage;
    this.version++;
  }

  reset(): void {
    this.sequences.clear();
    this.tasks.clear();
    this.stage = 0;
    this.version++;
  }
}

export const motionScene = new MotionScene();

declare module '../core/events.ts' {
  interface EventMap {
    /** Emitted by `script/runtime.ts` when a sequence starts (scene variants listen). */
    'sequence:started': { id: string };
  }
}
