import * as THREE from 'three';
import type { CasingEjection } from '../audio/casings.ts';
import type { VoiceOptions } from '../audio/engine.ts';
import type { SoundName } from '../audio/sounds.ts';
import type { EventBus } from '../core/events.ts';
import type { SquadEvents, SquadId, Vec3 } from '../ai/squad.ts';

/**
 * What a squad shot sounds and looks like (squad-sidearms D4, in-world-audio "Squad gunshots" and "Squad brass"): the squad gunshot
 * from the mate's muzzle (positional, so walls and closed doors muffle it), the pistol's slide kick, and a brass casing from its
 * ejection port through the shared casing audio, and the muzzle flash's light (D7; the body shows the flash sprite with the kick). Squad shots are never a noise the infected hear: only the player's own
 * `weapon:fired` reaches the enemy director (enemyGame.ts), and nothing here talks to it.
 */

/** Level and room of the squad gunshot; its rate varies ±RATE_JITTER per shot. */
export const SQUAD_SHOT = { gain: 0.9, reverb: 0.35 } as const;
export const RATE_JITTER = 0.04;

export interface SquadShotDeps {
  events: Pick<EventBus, 'on'>;
  audio: { play(name: SoundName, opts?: VoiceOptions): unknown };
  /** The casing audio, when the level has one (casing-drop-audio's single entry point). */
  casings: () => { eject(ej: CasingEjection): unknown } | null;
  /** The shared squad muzzle light (SquadMuzzleLight), when there is one. */
  light?: { fire(muzzle: Vec3, dir?: Vec3, boost?: number): void } | null;
  /** The firing mate's body, for the slide kick and the flash sprite. */
  body: (id: SquadId) => { kickSlide(): void } | null;
  /** Only while playing (not the title, not flying). */
  active?: () => boolean;
  random?: () => number;
}

/** Wire `squad:fired` to its sound, slide and brass. Returns the unsubscribe. */
export function wireSquadShots(d: SquadShotDeps): () => void {
  const random = d.random ?? Math.random;
  return d.events.on('squad:fired', (shot: SquadEvents['squad:fired']) => {
    if (d.active && !d.active()) return;
    const { muzzle, ejectPort, right } = shot;
    // Scripted bursts (the R16 surveillance finale) are heard through the CCTV feed, so they play in the head at full
    // level instead of fading out with distance from the player's seat in the train.
    const scripted = shot.enemy === 'scripted';
    d.audio.play('squadPistolShot', {
      bus: 'sfx',
      ...(scripted ? {} : { position: new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z) }),
      // A scripted volley can be quieter than a normal shot (the R16 finale fires under the long roar).
      gain: SQUAD_SHOT.gain * (shot.gain ?? 1),
      reverb: SQUAD_SHOT.reverb,
      rate: 1 + (random() * 2 - 1) * RATE_JITTER,
    });
    d.body(shot.id)?.kickSlide();
    d.light?.fire(muzzle, shot.forward, shot.boost);
    // The gun's horizontal right and forward (right = forward x up, so forward = (right.z, -right.x)).
    const len = Math.hypot(right.x, right.z) || 1;
    const rx = right.x / len;
    const rz = right.z / len;
    d.casings()?.eject({ kind: 'brass', x: ejectPort.x, y: ejectPort.y, z: ejectPort.z, rightX: rx, rightZ: rz, forwardX: rz, forwardZ: -rx });
  });
}
