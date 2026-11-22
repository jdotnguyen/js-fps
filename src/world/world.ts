import type * as THREE from 'three';
import type { Interactions } from '../actors/interaction.ts';
import type { PlayerWorld } from '../actors/player.ts';
import type { LightController } from '../render/lights.ts';
import type { Navigator } from '../ai/nav.ts';

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
  /** Shared AI navigation (ADR-0007), built on first use. */
  navGraph(): Navigator;
  /** Register this world's doors, consoles and other usables. Returns an unregister. */
  registerInteractions(interactions: Interactions): () => void;
  /** New game: put doors, light patterns, trigger latches and pickups back as authored (data levels only). */
  resetToData?(): void;
  /** Title-screen camera move. */
  attract(t: number, camera: THREE.PerspectiveCamera): void;
  update(t: number, dt: number, cameraPosition: THREE.Vector3, reducedFlashing: boolean, camera?: THREE.Camera): void;
  /** Resize this world's light pools for a quality tier (render-lighting spec). Worlds without pools omit it. */
  setLightBudget?(budget: LightBudget): void;
}

/** Light pool sizes a quality tier gives each world (render-lighting spec, RENDER_TIERS). */
export interface LightBudget {
  fillLights: number;
  shadowLights: number;
  shadowMapSize: number;
}
