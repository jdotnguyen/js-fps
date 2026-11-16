import * as THREE from 'three';
import type { Player } from '../actors/player.ts';
import { PLAYER_TUNING } from '../actors/player.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { SoundName } from '../audio/sounds.ts';
import type { LineHandle, SequenceHost, WalkHandle } from '../sequence/action.ts';
import type { PlayerHud } from '../ui/hud/playerHud.ts';
import type { Toasts } from '../ui/toast.ts';

export interface HostDeps {
  player: Player;
  hud: PlayerHud;
  audio: AudioEngine;
  toasts: Toasts;
  /** Reached a scripted checkpoint: heal, autosave. */
  checkpoint: (id: string) => void;
  /** Speak a line by id. Until the speech manager is wired in (ADR-0010) a caption stands in. */
  say?: (lineId: string) => LineHandle;
}

/** Connects the sequencer's `SequenceHost` to the live game. */
export function createSequenceHost(d: HostDeps): SequenceHost {
  const vec = (v: [number, number, number]): THREE.Vector3 => new THREE.Vector3(v[0], v[1], v[2]);
  return {
    pushControl: (over, owner) => d.player.control.push(over, owner),
    say:
      d.say ??
      ((lineId): LineHandle => {
        // Stand-in: caption for 2 s. Replaced when SpeechManager is wired in.
        d.toasts.show(lineId, '', 2000);
        const endsAt = performance.now() + 2000;
        return { isDone: () => performance.now() >= endsAt, stop: () => undefined };
      }),
    markLinePlayed: () => undefined,
    fade: (level, seconds) => d.hud.setFade(level, seconds),
    playerLookAt: (target, duration, weight) => d.player.lookAt(vec(target), { duration, weight }),
    playerWalkTo: (pos, speed): WalkHandle => {
      let done = false;
      void d.player.walkTo(vec(pos), speed).then(() => {
        done = true;
      });
      return { isDone: () => done, cancel: () => d.player.cancelWalk() };
    },
    placePlayer: (pos, yaw, pitch) => {
      d.player.cancelWalk();
      d.player.placeAtEye(new THREE.Vector3(pos[0], pos[1] + PLAYER_TUNING.eyeHeight, pos[2]), yaw ?? d.player.yaw, pitch ?? d.player.pitch);
    },
    sfx: (id) => {
      try {
        d.audio.play(id as SoundName);
      } catch {
        console.warn(`[sequence] unknown sound '${id}'`);
      }
    },
    checkpoint: d.checkpoint,
  };
}
