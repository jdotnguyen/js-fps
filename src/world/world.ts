import type * as THREE from 'three';
import type { Interactions } from '../actors/interaction.ts';
import type { PlayerWorld } from '../actors/player.ts';
import type { LightController } from '../render/lights.ts';

/**
 * What a game session needs from a playable space. Implemented by the hand-built demo
 * room (world/demoRoom.ts) and by data-driven kit levels (world/level.ts, ADR-0003).
 */

export interface WorldCheckpoint {
  id: string;
  label: string;
  /** True once the player's feet are inside the checkpoint area. */
  reached(feet: THREE.Vector3): boolean;
}

export interface World {
  id: string;
  group: THREE.Group;
  lights: LightController;
  /** Eye position and yaw for a new game. */
  spawn: { position: THREE.Vector3; yaw: number };
  /** Fly-camera clamp, if any. */
  bounds: THREE.Box3 | null;
  /** Colliders and footstep surfaces for the player motor (ADR-0004). */
  playerWorld: PlayerWorld;
  checkpoints: WorldCheckpoint[];
  /** Location label for saves before any checkpoint. */
  defaultLocation: string;
  /** Register this world's doors, consoles and other usables. Returns an unregister. */
  registerInteractions(interactions: Interactions): () => void;
  /** Title-screen camera move. */
  attract(t: number, camera: THREE.PerspectiveCamera): void;
  update(t: number, dt: number, cameraPosition: THREE.Vector3, reducedFlashing: boolean): void;
}
