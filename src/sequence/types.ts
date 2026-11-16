/**
 * Sequence data format (ADR-0009, amended by ADR-0017). Sequences are JSON, so scenes
 * need no code unless they need a new action type.
 */
export type Vec3 = [number, number, number];
export type FlagValue = string | number | boolean;
export type Flags = Record<string, FlagValue>;

/** One action: `{ "do": "wait", "s": 1.5 }`. Other keys are the action's parameters. */
export interface ActionStep {
  do: string;
  [param: string]: unknown;
}
/** Runs every child at once; done when all are done. */
export interface ParallelStep {
  parallel: Step[];
}
/** Chooses a branch when it starts (or when it is skipped). */
export interface IfStep {
  if: { flag: string; equals?: FlagValue };
  then: Step[];
  else?: Step[];
}
export type Step = ActionStep | ParallelStep | IfStep;

export interface SequenceDef {
  id: string;
  steps: Step[];
  /** The player may skip this sequence (ADR-0017). Default false. */
  skippable?: boolean;
  /** Does nothing if it already ran to its end or was skipped (flag `seq:<id>`). */
  once?: boolean;
  /** Only one running sequence per group; starting a second is refused. */
  exclusive?: string;
}
