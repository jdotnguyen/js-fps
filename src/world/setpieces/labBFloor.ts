import * as THREE from 'three';
import type { EventName } from '../../core/events.ts';
import { withVertexColors } from '../kit/merge.ts';
import type { SetPiece } from './types.ts';

/** The Lab B outbreak: room R04's floor breaks when the glass partition `labb` cracks (drop.json). */
const ROOM = 'R04';
const GLASS = 'labb';

/**
 * Lab B outbreak (the `glass labb cracked` beat of the drop sequence): the merged floor swaps from clean `labTile` to
 * `tileBroken` (same tile grid, tiles missing). A new game restores it.
 */
export const labBFloor: SetPiece = {
  id: 'labBFloor',
  attach(level) {
    const room = level.roomGroup(ROOM);
    if (!room) return null;
    const { labTile, tileBroken } = level.materials;
    const floor: THREE.Mesh[] = [];
    room.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material === labTile || o.material === withVertexColors(labTile))) floor.push(o);
    });
    const set = (broken: boolean): void => {
      const to = broken ? tileBroken : labTile;
      for (const mesh of floor) {
        const baked = mesh.material !== labTile && mesh.material !== tileBroken;
        mesh.material = baked ? withVertexColors(to) : to;
      }
    };
    const off = level.events.on('glass:set' as EventName, ((e: { id?: string; state?: string } | undefined) => {
      if (e?.id === GLASS && (e.state === 'cracked' || e.state === 'shattered')) set(true);
    }) as never);
    return {
      reset: () => set(false),
      dispose: () => {
        off();
        floor.length = 0;
      },
    };
  },
};
