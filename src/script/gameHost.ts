/**
 * Connects the sequence interpreter (ADR-0009) to the running game. This is the only
 * script file that knows about three.js, the player, the world and the audio engine.
 */
import { npcIdForSpeaker } from '../ai/speakerBodies.ts';
import { MUSIC_TRACKS, type MusicTrack } from '../audio/musicTracks.ts';
import * as THREE from 'three';
import { PLAYER_TUNING, type Player } from '../actors/player.ts';
import type { SoundName } from '../audio/sounds.ts';
import { SAMPLE_URLS, SOUND_SPECS } from '../audio/sounds.ts';
import type { AmbienceDirector } from '../audio/ambience.ts';
import type { AudioEngine, BusName } from '../audio/engine.ts';
import type { EventBus, EventName } from '../core/events.ts';
import type { DoorState } from '../data/types/level.ts';
import type { Game } from '../game/game.ts';
import type { Inventory } from '../game/inventory.ts';
import type { LightPattern } from '../render/lights.ts';
import type { PlayerHud } from '../ui/hud/playerHud.ts';
import type { Toasts } from '../ui/toast.ts';
import type { GoreClip } from '../actors/goreClip.ts';
import type { Level } from '../world/level.ts';
import type { World } from '../world/world.ts';
import type { NpcDirector } from '../ai/npcs.ts';
import { RadioPlayer } from '../audio/radio.ts';
import { WATER_FLAG, type CameraFeedOptions, type ScriptSpeechOptions, type SequenceHost } from './host.ts';
import type { TargetRef, Vec3Like } from './types.ts';

export interface GameHostDeps {
  events: EventBus;
  /** Per-slot record of watched cutscenes (sequence `skippableAfter`). */
  saves?: { seen(slot: number): Set<string>; markSeen(slot: number, id: string): void } | undefined;
  game: Game;
  player: Player;
  world: World;
  /** Present when a data-driven level is loaded (doors, per-room lights). */
  level: Level | null;
  audio: AudioEngine;
  /** Environmental soundscape director (room beds, spatial one-shots, scripted ambience overrides). */
  ambience?: AmbienceDirector | null | undefined;
  /** Music the sequence `music` step controls (the menu theme player). */
  music?: { cue(track: MusicTrack | null): void } | null | undefined;
  /** Adaptive scores (adaptive-music spec): the `score` step, and `sfx` steps that wait for the beat. */
  score?: { load(id: string): void; cue(id: string, cue: string): void; stinger(name: string, id?: string): void; untilBeat(): number } | null | undefined;
  hud: PlayerHud;
  toasts: Toasts;
  /** Key items (ADR-0024), for `giveItem`. */
  inventory?: Inventory | undefined;
  /** Named positions of the hand-built demo room. */
  anchors?: Record<string, THREE.Vector3> | undefined;
  /** Scripted NPCs and the squad hand-over (ADR-0009/0011): `npc:<id>` targets and NPC actions. */
  npcs?: NpcDirector | null | undefined;
  /** Enemy spawn groups (ADR-0007 `spawnGroup` / `despawnGroup`). */
  enemies?: { spawnGroup(group: string, from?: { pos: { x: number; y: number; z: number }; yaw?: number }): boolean; despawnGroup(group: string): boolean; groupCleared(group: string): boolean } | null | undefined;
  /** Speech manager for `say`; without it lines are skipped with a warning. */
  speech?: { say(id: string, opts?: ScriptSpeechOptions): { done: Promise<unknown> } | null; stopAll(): void; stopChannels?(match: (channel: string) => boolean): void; onlySpeakers?(speakers: readonly string[] | null): void } | null | undefined;
  /** End-credits overlay triggered when the slice finishes; settles once it covers the screen. */
  showCredits?: (opts?: { instant?: boolean }) => void | Promise<void>;
  /** Security camera feeds (`render/cameraFeed.ts`) for the `cameraFeed` action. */
  cameraFeeds?: { apply(id: string, opts: CameraFeedOptions): void } | null | undefined;
  /** Gore particles and pools (`gore` action). */
  gore?: { burst(at: THREE.Vector3, dir: THREE.Vector3, count?: number, dark?: boolean, clip?: GoreClip): void; chunks(at: THREE.Vector3, dir: THREE.Vector3, count: number, clip?: GoreClip): void; pool(at: THREE.Vector3, size: number): void } | null | undefined;
  /** The black title card (`titleCard` action). */
  titleCard?: { show(title: string, sub: string, seconds: number): void; hide(): void } | null | undefined;
  setTimeScale(scale: number): void;
}

const tmp = new THREE.Vector3();

function vec(v: THREE.Vector3): Vec3Like {
  return { x: v.x, y: v.y, z: v.z };
}

export function createGameHost(d: GameHostDeps): SequenceHost {
  const v3 = (p: Vec3Like): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
  const label = (id: string): string => d.game.location || id;
  const radio = new RadioPlayer(d.audio);
  /** Spots a `pool` gore step has already marked this session (see `gore`). */
  const pooled = new Set<string>();
  let radioKey: string | null = null;
  // Back to the title: the radio stops with everything else.
  // A scene's hush (`hush` action): the world's ambience and sound effects, and every voice but the scene's own.
  const HUSHED: readonly BusName[] = ['ambience', 'sfx'];
  let hushed = false;
  const hush = (speakers: readonly string[] | null, seconds: number): void => {
    hushed = speakers !== null;
    d.audio.hush(hushed ? HUSHED : [], seconds);
    d.speech?.onlySpeakers?.(speakers);
  };
  // Back to the title: the radio stops with everything else, and a hush lifts.
  d.events.on('game:mode', ({ mode }) => {
    if (mode === 'title') {
      radio.stop();
      d.titleCard?.hide();
      if (hushed) hush(null, 1);
    }
  });
  d.events.on('game:restarted', () => {
    if (hushed) hush(null, 0.2);
  });

  // Room tests for `gatherIn`: feet raised half a metre, as checkpoints test them. No level, or an unknown room: inside.
  const roomIs = (p: Vec3Like, room: string): boolean => {
    if (!d.level?.hasRoom(room)) return true;
    return d.level.roomAt(tmp.set(p.x, p.y + 0.5, p.z))?.data.id === room;
  };
  const host: SequenceHost = {
    events: {
      on: (name, fn) => d.events.on(name as EventName, fn as never),
      emit: (name, payload) => d.events.emit(name as EventName, (payload ?? {}) as never),
    },
    get flags() {
      return d.game.flags;
    },
    seen: (id) => d.saves?.seen(d.game.slot).has(id) ?? false,
    markSeen: (id) => d.saves?.markSeen(d.game.slot, id),
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
        const at = d.anchors?.[name] ?? d.level?.anchor(name)?.pos;
        return at ? vec(at) : null;
      }
      if (kind === 'npc') {
        const at = d.npcs?.head(name, tmp);
        return at ? vec(at) : null;
      }
      return null;
    },

    // Speaker ids (dialogue/speakers.json) to the NPC that speaks them; Jay, the PA and absent NPCs give null.
    speakerTarget(speaker: string): TargetRef | null {
      const id = npcIdForSpeaker(speaker);
      return id && d.npcs?.has(id) ? `npc:${id}` : null;
    },

    pushControl: (over, owner) => d.player.control.push(over, owner),
    lookAt: (at, duration, weight) => d.player.lookAt(v3(at), { duration, weight }),
    clampLook: (at, degrees) => d.player.clampLook(at ? v3(at) : null, degrees),
    frameHeading: (duration, give, opts) => d.player.frameHeading({ duration, give, ...opts }),
    frame: (at, duration, give, follow, opts) =>
      d.player.frameView(at ? v3(at) : null, {
        duration,
        give,
        ...opts,
        ...(follow
          ? {
              follow: (out: THREE.Vector3) => {
                const p = follow();
                if (p) out.set(p.x, p.y, p.z);
                return p !== null;
              },
            }
          : {}),
      }),
    walkTo: (at, speed, via) => {
      const walk = via ? (d.level?.walk(via) ?? null) : null;
      if (via && !walk) console.warn(`playerWalkTo: no walk "${via}"`);
      return d.player.walkTo(v3(at), speed ?? walk?.speed, walk?.points);
    },
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
    pryDoor: (id, open, seconds) => d.level?.pryDoor(id, open, seconds) ?? false,
    joltLights: (room, strength) => d.level?.joltRoomLights(room, strength) ?? false,
    setLight: (room, pattern, tint) => {
      const ok = d.level?.setRoomLights(room, pattern as LightPattern) ?? false;
      if (tint !== undefined) d.level?.tintRoomLights(room, tint);
      return ok;
    },
    light: (id, pattern, tint) => d.level?.setLight(id, pattern as LightPattern, tint) ?? false,
    setPower: (state) => d.level?.setPower(state),
    cameraShake: (amount, seconds) => d.events.emit('camera:shake', { amount, seconds }),
    water: (room, level, seconds) => {
      const body = d.level?.water.room(room);
      if (!body) return false;
      body.setLevel(level, seconds);
      // Checkpoint saves carry the level as a flag (standing-water spec: water level survives checkpoints).
      d.game.flags[WATER_FLAG + room] = level;
      return true;
    },
    // Glass partitions (`glass_cracks` props listen), ADR-0014 beat 2.
    glass: (id, state) => d.events.emit('glass:set' as EventName, { id, state } as never),
    lightStates: () => d.level?.roomLightPatterns() ?? {},

    radio: (track, at) => {
      // The same track at the same spot keeps playing (a pause/resume or a restore must not restart the song).
      const key = track ? `${track}@${at ? `${at.x},${at.y},${at.z}` : ''}` : null;
      if (key !== null && key === radioKey && radio.track === track) return;
      radioKey = key;
      radio.play(track, at ? v3(at) : null);
    },
    ...(d.gore
      ? {
          gore: (kind: 'burst' | 'chunks' | 'pool' | 'splash', at: Vec3Like, to: Vec3Like, count: number | undefined, size: number | undefined, clip?: GoreClip) => {
            const from = v3(at);
            const dir = v3(to).sub(from).normalize();
            if (kind === 'burst' || kind === 'splash') d.gore!.burst(from, dir, count ?? 40, undefined, clip);
            if (kind === 'chunks') d.gore!.chunks(from, dir, count ?? 8, clip);
            if (kind === 'splash') d.gore!.pool(new THREE.Vector3(at.x, 0, at.z), size ?? 1.2);
            // A `pool` step marks a spot once: restore sequences re-run on every resume (ADR-0009), and pools stay
            // for the session (nothing clears them in the game), so a spot already pooled is left as it is.
            if (kind === 'pool') {
              const key = `${at.x.toFixed(2)},${at.z.toFixed(2)}`;
              if (!pooled.has(key)) {
                pooled.add(key);
                d.gore!.pool(new THREE.Vector3(at.x, 0, at.z), size ?? 1.2);
              }
            }
          },
        }
      : {}),
    ...(d.titleCard ? { titleCard: (title: string, sub: string, seconds: number) => d.titleCard!.show(title, sub, seconds) } : {}),
    ...(d.cameraFeeds ? { cameraFeed: (id: string, opts: CameraFeedOptions) => d.cameraFeeds!.apply(id, opts) } : {}),

    sfx(id, at, opts) {
      const play = (): void => {
        if (!(id in SOUND_SPECS) && !(id in SAMPLE_URLS)) {
          console.warn(`[seq] sfx: no sound "${id}"`);
          return;
        }
        if (!d.audio.hasSound(id as SoundName)) {
          console.warn(`[seq] sfx: sound "${id}" not ready yet`);
          return;
        }
        // Sequence sounds play as authored, never muffled by walls (in-world-audio: World sound occlusion).
        const gain = opts?.gain !== undefined ? { gain: opts.gain } : {};
        d.audio.play(id as SoundName, at ? { position: v3(at), occlude: false, ...gain } : gain);
      };
      // adaptive-music: a step that asks for the beat waits for the score's next one (at most a beat).
      const delay = opts?.beat && d.score ? d.score.untilBeat() : 0;
      if (delay > 0.005) setTimeout(play, delay * 1000);
      else play();
    },
    ...(d.ambience ? { ambience: (id: string) => d.ambience!.setOverride(id) } : {}),
    ...(d.score
      ? {
          score: (id: string, o: { cue?: string; stinger?: string; load?: boolean }) => {
            if (o.load) d.score!.load(id);
            if (o.cue !== undefined) d.score!.cue(id, o.cue);
            if (o.stinger !== undefined) d.score!.stinger(o.stinger, id);
          },
        }
      : {}),
    ...(d.music
      ? {
          music: (id: string | null) => {
            if (id !== null && !(MUSIC_TRACKS as readonly string[]).includes(id)) {
              console.warn(`[seq] music: no track "${id}"`);
              return;
            }
            d.music!.cue(id as MusicTrack | null);
          },
        }
      : {}),

    checkpoint(id, text) {
      if (d.game.flags[`cp:${id}`]) return; // already taken (a replay after death)
      d.game.reachCheckpoint(id, text ?? label(id));
    },
    // The slice is over (ADR-0014 beat 8): show the end credits with the theme song, then land on the title.
    // The screen is black (the sequence faded out): cover it with the credits at once (no fade-in for pop-ups to show
    // through) and only then go to the title underneath, so nothing shows between the last shot and the credits.
    endSlice: () => {
      d.game.flags['slice_done'] = true;
      if (!d.showCredits) {
        d.game.quitToTitle();
        d.toasts.show('End of slice', 'Thanks for playing');
        return;
      }
      const toTitle = (): void => d.game.quitToTitle();
      void Promise.resolve(d.showCredits({ instant: true })).then(toTitle, toTitle);
    },
    hush,
    giveItem: (id) => d.inventory?.give(id, 'script') ?? false,
    ...(d.enemies
      ? {
          spawnGroup: (g: string, from?: string) => {
            if (from === undefined) return d.enemies!.spawnGroup(g);
            // infection-kills: an NPC (the creature behind the glass) becomes the group's enemy where it stands.
            const id = from.startsWith('npc:') ? from.slice(4) : from;
            const a = d.npcs?.actor(id, false);
            if (!a) {
              console.warn(`[seq] spawnGroup ${g}: no NPC "${id}" to release, using the spawn points`);
              return d.enemies!.spawnGroup(g);
            }
            const ok = d.enemies!.spawnGroup(g, { pos: { x: a.position.x, y: a.position.y, z: a.position.z }, yaw: a.body.heading });
            if (ok) void d.npcs!.command('despawn', { npc: id });
            return ok;
          },
          despawnGroup: (g: string) => d.enemies!.despawnGroup(g), groupCleared: (g: string) => d.enemies!.groupCleared(g) }
      : {}),
    ...(d.npcs ? { npc: (action: string, step: Readonly<Record<string, unknown>>) => d.npcs!.command(action, step), releaseNpcs: (ids: readonly string[]) => d.npcs!.endScene(ids) } : {}),
    ...(d.npcs
      ? {
          squadRegroup: (distance?: number) => d.npcs!.regroup(distance),
          squadPlaceIn: (room: string) => d.npcs!.placeSquadIn((p) => roomIs(p, room)),
          squadCatchUpIn: (room: string, entry?: Vec3Like | null) => d.npcs!.catchUpSquadIn((p) => roomIs(p, room), entry),
          inRoom: (who: 'player' | 'giles' | 'okafor', room: string) => {
            const p = who === 'player' ? { x: d.player.body.x, y: d.player.body.y, z: d.player.body.z } : d.npcs!.squadFeet(who);
            return p ? roomIs(p, room) : true;
          },
        }
      : {}),
    ...(d.speech ? { say: (line: string, opts?: ScriptSpeechOptions) => d.speech!.say(line, opts), stopSpeech: () => d.speech!.stopAll(),
        stopSceneSpeech: (id: string) => d.speech!.stopChannels?.((c) => c === `seq:${id}` || c.startsWith(`seq:${id}:`)) } : {}),
    hasRoom: (room: string) => d.level?.hasRoom(room) ?? true,
  };
  // NPC targets: positions through the same resolver, plus an anchor's facing (Level.anchor yaw).
  d.npcs?.setResolver((ref) => {
    // NPCs walk on the floor: `npc:` and `player` resolve to heads for the camera, so use feet here.
    if (typeof ref === 'string' && ref.startsWith('npc:')) {
      const a = d.npcs?.actor(ref.slice(4), false);
      return a ? { pos: { x: a.position.x, y: a.position.y, z: a.position.z } } : null;
    }
    const pos = host.resolve(ref);
    if (!pos) return null;
    if (typeof ref === 'string' && ref.startsWith('anchor:')) {
      const a = d.level?.anchor(ref.slice(7));
      return { pos, yaw: a?.yaw };
    }
    if (ref === 'player') return { pos: { x: d.player.body.x, y: d.player.body.y, z: d.player.body.z } };
    return { pos };
  });
  return host;
}
