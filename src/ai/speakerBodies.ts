import type { EventBus } from '../core/events.ts';
import type { Humanoid } from '../actors/humanoid.ts';
import type { SpeechInfo } from '../dialogue/speech.ts';
import { CREW_PREFIX } from '../data/types/dialogue.ts';

/**
 * Speakers (data/dialogue/speakers.json) to the NPC that says their lines, and the glue that makes that NPC act the line
 * (ADR-0027): the mouth follows the subtitle and the hands and body follow the line's emote.
 */

/** Named speakers that are cast NPCs, by NPC id. Jay, the PA and the director on the radio have no body here. */
const SPEAKER_NPC: Readonly<Record<string, string>> = { engineer: 'giles', medic: 'okafor', nurse: 'priya', chief: 'heins', crew_lab: 'researcher_b' };

/** The NPC id for a speaker id, or null (the player, the PA, anonymous crew, the infected). */
export function npcIdForSpeaker(speaker: string): string | null {
  return SPEAKER_NPC[speaker] ?? (speaker.startsWith(CREW_PREFIX) ? speaker.slice(CREW_PREFIX.length) : null);
}

/**
 * Make bodies act the lines they speak. `bodyOf` gives the body for a speaker (or null when nobody on screen says it).
 * A line that ends for any reason stops the acting, so an interrupted line closes the mouth at once.
 */
export function wireSpeechActing(bus: EventBus, bodyOf: (speaker: string) => Humanoid | null): () => void {
  const started = (info: SpeechInfo): void => {
    bodyOf(info.speaker)?.speak(info.text, info.emote, info.duration, info.id);
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
