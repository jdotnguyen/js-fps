import * as THREE from 'three';
import type { Player } from '../actors/player.ts';
import type { AttackKind, EnemyTarget } from './enemy.ts';
import { inBeam } from './perception.ts';

/**
 * Adapters that make the player and squadmates something enemies hunt (ADR-0007 target selection:
 * player 1.0, teammate 0.6, working teammate 0.9; ADR-0011).
 */

const eye = new THREE.Vector3();
const view = new THREE.Vector3();

/** The player: hurt through `Player.damage` (Vitals applies difficulty), grabbed through `Player.grab`. */
export function playerTarget(player: Player, flashlightOn: () => boolean): EnemyTarget {
  return {
    id: 'player',
    kind: 'player',
    feet: (out) => out.set(player.body.x, player.body.y, player.body.z),
    // Downed is still a target (damage while downed eats bleed-out, ADR-0004), at lower priority.
    alive: () => player.alive || player.downed,
    weight: () => (player.downed ? 0.5 : 1),
    hurt: (amount, from, kind, side) => player.damage(amount, from, { kind, ...(side ? { side } : {}) }),
    knock: (dx, dz, speed) => {
      player.velocity.set(dx * speed, dz * speed);
    },
    lit: flashlightOn,
    inBeam: (p) => flashlightOn() && inBeam(player.eyePosition(eye), player.viewDirection(view), p),
    view: (out) => player.viewDirection(out).setY(0).normalize(),
    grab: (source) => {
      if (!player.alive || player.isGrabbed) return false;
      player.grab(source);
      return player.isGrabbed;
    },
    isGrabbed: () => player.isGrabbed,
    releaseGrab: () => player.releaseGrab(),
  };
}

/**
 * A squadmate. The squad owns their health: hits arrive through `hurt` (and the `enemy:attack` event),
 * so the squad agent can apply them however ADR-0011 decides.
 */
export function squadTarget(opts: {
  id: string;
  position: () => THREE.Vector3;
  alive?: () => boolean;
  /** 0.6 idle, 0.9 working (ADR-0007); the medic reviving 1.0 (ADR-0011). */
  weight?: () => number;
  hurt?: (amount: number, from: THREE.Vector3, kind: AttackKind) => void;
  knock?: (dx: number, dz: number, speed: number) => void;
}): EnemyTarget {
  return {
    id: opts.id,
    kind: 'squad',
    feet: (out) => out.copy(opts.position()),
    alive: opts.alive ?? (() => true),
    weight: opts.weight ?? (() => 0.6),
    hurt: opts.hurt ?? (() => undefined),
    ...(opts.knock ? { knock: opts.knock } : {}),
  };
}
