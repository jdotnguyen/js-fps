import type { EventBus } from '../core/events.ts';
import type { ControlState } from '../actors/control.ts';
import type { ActionStep, Flags, Step, Vec3 } from './types.ts';

/** A line being spoken; the sequencer only needs to know when it is over. */
export interface LineHandle {
  isDone(): boolean;
  stop(): void;
}

/** A forced walk in progress. */
export interface WalkHandle {
  isDone(): boolean;
  cancel(): void;
}

/**
 * Everything a sequence may touch in the game. The game provides one implementation;
 * tests provide a fake, so the interpreter stays pure and Node-testable.
 */
export interface SequenceHost {
  /** Push a control layer; returns its release function (the player's ControlStack). */
  pushControl(over: Partial<ControlState>, owner: string): () => void;
  say(lineId: string): LineHandle;
  /** A line was skipped over: do not let ambient barks repeat it. */
  markLinePlayed(lineId: string): void;
  /** 0 = clear, 1 = black. */
  fade(level: number, seconds: number): void;
  playerLookAt(target: Vec3, duration: number, weight: number): void;
  playerWalkTo(pos: Vec3, speed: number | undefined): WalkHandle;
  /** Teleport the player (feet position) and optionally set the facing. */
  placePlayer(pos: Vec3, yaw: number | undefined, pitch: number | undefined): void;
  sfx(id: string, at: Vec3 | undefined): void;
  checkpoint(id: string): void;
}

/**
 * One step of a running sequence. Rules:
 * - `update` returns true once the step is done; it is called every simulation step.
 * - `finish` applies the step's end state instantly. It must work whether or not the
 *   step ever started, and do nothing if it already finished. Skipping a sequence is
 *   `finish()` on every step that has not completed (ADR-0017).
 * - `cancel` stops the step where it is, with no end state (death, quit to title).
 */
export interface Action {
  start(): void;
  update(dt: number): boolean;
  finish(): void;
  cancel(): void;
}

export interface RunContext {
  readonly sequenceId: string;
  readonly events: EventBus;
  readonly flags: Flags;
  readonly host: SequenceHost;
  /** Hold a control layer until the sequence ends or is cancelled. */
  hold(over: Partial<ControlState>): void;
  /** Release every layer this sequence holds (`playerControl` with `reset`). */
  releaseHolds(): void;
  build(steps: Step[]): Action;
}

export interface ActionDef {
  /** Returns a message when the step's parameters are wrong; checked when registered. */
  check(step: ActionStep): string | null;
  create(step: ActionStep, ctx: RunContext): Action;
}
