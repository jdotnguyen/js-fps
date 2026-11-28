import type * as THREE from 'three';
import type { EventBus } from '../../core/events.ts';
import type { Materials } from '../../render/materials.ts';

/**
 * What a set piece may reach in a built level (content-layout spec, design D7). Kept narrow: it grows when a piece
 * needs more, so `Level` never learns a scene's room, glass or prop names.
 */
export interface SetPieceLevel {
  /** The level's id (`slice01`). */
  readonly id: string;
  readonly materials: Materials;
  readonly events: EventBus;
  /** A room's built group, its static meshes already merged. Null when the level has no such room. */
  roomGroup(id: string): THREE.Group | null;
}

/** A set piece wired into one built level. */
export interface SetPieceInstance {
  /** New game (`level:reset`): back to the authored state. */
  reset?(): void;
  /** The level is torn down: drop listeners and references. */
  dispose(): void;
}

/** Behaviour that belongs to one scene of a level, plugged in through `setpieces/index.ts`. */
export interface SetPiece {
  /** Stable name, for errors and tests. */
  readonly id: string;
  /** Called once after every room is built and merged. Null when the level lacks what the piece needs. */
  attach(level: SetPieceLevel): SetPieceInstance | null;
}
