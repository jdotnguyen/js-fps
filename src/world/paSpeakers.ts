import { Vector3 } from 'three';
import type { Matrix4 } from 'three';

/** Metres from the wall prop's floor pivot, centred on the front grille. */
export const PA_GRILLE_Y = 2.30;
export const PA_GRILLE_Z = -0.238;

export interface PaSpeaker {
  id: string;
  room: string;
  adjacentRoom?: string;
  position: Vector3;
}

export function grillePosition(placement: Matrix4): Vector3 {
  return new Vector3(0, PA_GRILLE_Y, PA_GRILLE_Z).applyMatrix4(placement);
}

export function selectPaSpeaker(speakers: readonly PaSpeaker[], room: string | null, listener: Vector3, id?: string): Vector3 | null {
  if (id !== undefined) return speakers.find(s => s.id === id)?.position ?? null;
  let nearest: PaSpeaker | undefined;
  for (const speaker of speakers) {
    if (speaker.room !== room && speaker.adjacentRoom !== room) continue;
    if (!nearest || speaker.position.distanceToSquared(listener) < nearest.position.distanceToSquared(listener)) nearest = speaker;
  }
  return nearest?.position ?? null;
}
