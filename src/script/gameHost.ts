/**
 * Connects the sequence interpreter (ADR-0009) to the running game. This is the only
 * script file that knows about three.js, the player, the world and the audio engine.
 */
import * as THREE from 'three';
import { PLAYER_TUNING, type Player } from '../actors/player.ts';
import type { SoundName } from '../audio/sounds.ts';
import { SOUND_SPECS } from '../audio/sounds.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { EventBus, EventName } from '../core/events.ts';
import type { DoorState } from '../data/types/level.ts';
import type { Game } from '../game/game.ts';
import type { LightPattern } from '../render/lights.ts';
import type { PlayerHud } from '../ui/hud/playerHud.ts';
import type { Toasts } from '../ui/toast.ts';
import type { Level } from '../world/level.ts';
import type { World } from '../world/world.ts';
import type { SequenceHost } from './host.ts';
import type { TargetRef, Vec3Like } from './types.ts';

export interface GameHostDeps {
  events: EventBus;
  game: Game;
  player: Player;
  world: World;
  /** Present when a data-driven level is loaded (doors, per-room lights). */
  level: Level | null;
  audio: AudioEngine;
  hud: PlayerHud;
  toasts: Toasts;
  /** Named positions of the hand-built demo room. */
  anchors?: Record<string, THREE.Vector3> | undefined;
  setTimeScale(scale: number): void;
}

const tmp = new THREE.Vector3();

function vec(v: THREE.Vector3): Vec3Like {
  return { x: v.x, y: v.y, z: v.z };
}

export function createGameHost(d: GameHostDeps): SequenceHost {
  const v3 = (p: Vec3Like): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
  const label = (id: string): string => d.game.location || id;

  return {
    events: {
      on: (name, fn) => d.events.on(name as EventName, fn as never),
      emit: (name, payload) => d.events.emit(name as EventName, (payload ?? {}) as never),
    },
    get flags() {
      return d.game.flags;
    },
    warn: (message) => console.warn(`[seq] ${message}`),

    resolve(target: TargetRef): Vec3Like | null {
      if (Array.isArray(target)) return { x: target[0], y: target[1], z: target[2] };
      if (target === 'player') return vec(d.player.eyePosition(tmp));
      const colon = target.indexOf(':');
      if (colon < 0) return null;
      const kind = target.slice(0, colon);
      const name = target.slice(colon + 1);
      if (kind === 'door' || kind === 'room') {
        const at = d.level?.anchorPosition(kind, name);
        return at ? vec(at) : null;
      }
      if (kind === 'anchor') {
        const at = d.anchors?.[name];
        return at ? vec(at) : null;
      }
      return null; // npc:… arrives with ADR-0007/0011
    },

    pushControl: (over, owner) => d.player.control.push(over, owner),
    lookAt: (at, duration, weight) => d.player.lookAt(v3(at), { duration, weight }),
    clampLook: (at, degrees) => d.player.clampLook(at ? v3(at) : null, degrees),
    walkTo: (at, speed) => d.player.walkTo(v3(at), speed),
    fade: (level, seconds) => d.hud.setFade(level, seconds),
    placePlayer: (at, yaw, pitch) => {
      d.player.cancelWalk();
      d.player.placeAtEye(
        new THREE.Vector3(at.x, (at.y ?? d.player.body.y) + PLAYER_TUNING.eyeHeight, at.z),
        yaw ?? d.player.yaw,
        pitch ?? d.player.pitch,
      );
    },
    setTimeScale: (scale) => d.setTimeScale(scale),

    setDoor: (id, state) => d.level?.setDoor(id, state as DoorState) ?? false,
    doorStates: () => d.level?.doorStates() ?? {},
    setLight: (room, pattern) => d.level?.setRoomLights(room, pattern as LightPattern) ?? false,
    lightStates: () => d.level?.roomLightPatterns() ?? {},

    sfx(id, at) {
      if (!(id in SOUND_SPECS)) {
        console.warn(`[seq] sfx: no sound "${id}"`);
        return;
      }
      d.audio.play(id as SoundName, at ? { position: v3(at) } : {});
    },

    checkpoint(id, text) {
      if (d.game.flags[`cp:${id}`]) return; // already taken (a replay after death)
      d.game.reachCheckpoint(id, text ?? label(id));
    },
    endSlice: () => d.toasts.show('End of slice', 'Thanks for playing'),
  };
}
