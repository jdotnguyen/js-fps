/**
 * Sequence (scripting) data model, ADR-0009. Sequences are JSON action lists; this file
 * holds the types shared by the schema, the interpreter and the host.
 */

export type Scalar = string | number | boolean;
export type Flags = Record<string, Scalar>;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Something in the world to look at or walk to. A string `kind:id` (`npc:`, `anchor:`,
 * `door:`, `room:`, or `player`) resolved by the host, or a literal `[x, y, z]`.
 */
export type TargetRef = string | [number, number, number];

/** One step. Actions carry their own fields; `parallel` holds child steps. */
export interface ActionStep {
  do: string;
  [field: string]: unknown;
}
export interface ParallelStep {
  parallel: Step[];
}
export type Step = ActionStep | ParallelStep;

export interface SequenceTrigger {
  /** Bus event name, or a level trigger's `emit` name written as `trigger:<emit>`. */
  event: string;
  /** Only fire while this flag is set. */
  requires?: string;
  /** Never fire once this flag is set (a beat that already finished, ADR-0014). */
  unless?: string;
  /** Only fire when the event payload has these field values (e.g. `{ "requires": "card_l2" }`). */
  match?: Record<string, Scalar>;
}

export interface SequenceDef {
  id: string;
  trigger?: SequenceTrigger;
  /** The player may skip it (hold the skip key): every remaining step's end state is applied at once (intro-sequence spec). */
  skippable?: boolean;
  /**
   * Skippable only once the player has watched it to the end in this save slot (flooded-tunnel spec: the flood
   * cutscene). The record is kept per slot, outside checkpoints, so restoring an earlier checkpoint keeps it.
   */
  skippableAfter?: string;
  /** Run at most once per playthrough (remembered in the flag `seq:<id>`). */
  once?: boolean;
  /** Sequences in one group never overlap; a later one waits its turn. */
  exclusive?: string;
  /** Restart from step 0 after death if it was running and had not reached a checkpoint. */
  resumeFromCheckpoint?: boolean;
  /** `?seq=<id>`: flags to set first so the sequence can run in isolation. */
  debugSetup?: { flags?: Record<string, Scalar> };
  steps: Step[];
}

/** A running action. `update` returns true when finished. */
export interface Running {
  update(dt: number): boolean;
  cancel?(): void;
  /**
   * Stop and apply the end state of whatever is left of this step instantly (intro-sequence spec).
   * Steps that already finished are not applied again.
   */
  skip?(): void;
}
