import type { EventBus } from '../core/events.ts';
import type { Humanoid } from '../actors/humanoid.ts';
import type { SpeechInfo } from '../dialogue/speech.ts';
import { CREW_PREFIX } from '../data/types/dialogue.ts';

/**
 * Speakers (data/dialogue/speakers.json) to the NPC that says their lines, and the glue that makes that NPC act the line
 * (ADR-0027): the mouth follows the subtitle and the hands and body follow the line's emote.
 */

/**
 * Named speakers that are cast NPCs, by NPC id. Director Hale says his office lines in person (his briefing is on the
 * radio, which is never positioned), and the dive-bay maintenance tech is the level's `maint_1`.
 */
const SPEAKER_NPC: Readonly<Record<string, string>> = {
  engineer: 'giles', medic: 'okafor', nurse: 'priya', chief: 'heins', crew_lab: 'researcher_b', director: 'hale', crew_maint: 'maint_1', crew_botanist: 'botanist_2',
};

/** Speakers voiced by whichever of several NPCs is nearest when the line starts (the hydroponics botanists). */
const SPEAKER_POOL: Readonly<Record<string, readonly string[]>> = { crew_botanist: ['botanist_1', 'botanist_2', 'botanist_3'] };

/**
 * Speakers with local lines that deliberately play centred, with no body (voice-playback: Every local speaker has a
 * body): Jay is the listener, and the mess crew member is an offscreen voice in the galley.
 */
export const DISEMBODIED: ReadonlySet<string> = new Set(['player', 'pa', 'infected', 'crew_mess']);

/** The NPC id for a speaker id, or null (the player, the PA, anonymous crew, the infected). A pool gives its first member. */
export function npcIdForSpeaker(speaker: string): string | null {
  return SPEAKER_NPC[speaker] ?? SPEAKER_POOL[speaker]?.[0] ?? (speaker.startsWith(CREW_PREFIX) ? speaker.slice(CREW_PREFIX.length) : null);
}

/** Every NPC that may say a speaker's lines: the pool, or the one mapped NPC, or none. */
export function npcCandidatesForSpeaker(speaker: string): readonly string[] {
  const pool = SPEAKER_POOL[speaker];
  if (pool) return pool;
  const id = npcIdForSpeaker(speaker);
  return id ? [id] : [];
}

/** The listen-look surface of the NPC director (npc-conversation-gaze). */
export interface ListenLook {
  has(id: string): boolean;
  lineStarted(speaker: string, addressee?: string | null): void;
  lineEnded(speaker: string): void;
}

/**
 * Turn the people nearby to whoever is speaking. `talkerOf` and `addresseeOf` give NPC ids (or 'player') for a line's
 * speaker and `to`. Background lines turn nobody (dialogue-channels: Background lines leave the mix and bystanders
 * alone): overheard talk keeps to its own conversation's gaze.
 */
export function wireListenLook(
  bus: EventBus,
  npcs: ListenLook,
  talkerOf: (speaker: string) => string | null,
  addresseeOf: (to: string | undefined) => string | null,
): () => void {
  const offA = bus.on('speech:started', (info: SpeechInfo) => {
    if (info.priority === 'background') return;
    const id = talkerOf(info.speaker);
    if (id && (id === 'player' || npcs.has(id))) npcs.lineStarted(id, addresseeOf(info.to));
  });
  const offB = bus.on('speech:ended', (e: { speaker: string }) => {
    const id = talkerOf(e.speaker);
    if (id) npcs.lineEnded(id);
  });
  return () => {
    offA();
    offB();
  };
}

/**
 * Make bodies act the lines they speak. `bodyOf` gives the body for a speaker (or null when nobody on screen says it).
 * A line that ends for any reason stops the acting, so an interrupted line closes the mouth at once.
 */
export function wireSpeechActing(bus: EventBus, bodyOf: (speaker: string) => Humanoid | null): () => void {
  const started = (info: SpeechInfo): void => {
    bodyOf(info.speaker)?.speak(info.text, info.emote, info.duration, info.id, info.loudness);
  };
  const ended = (e: { id: string; speaker: string }): void => {
    bodyOf(e.speaker)?.stopSpeaking();
  };
  const offA = bus.on('speech:started', started);
  const offB = bus.on('speech:ended', ended);
  return () => {
    offA();
    offB();
  };
}
