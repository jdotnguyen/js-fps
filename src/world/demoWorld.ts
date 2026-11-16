import * as THREE from 'three';
import { demoRoomPlayerWorld } from './demoRoomColliders.ts';
import type { DemoRoom } from './demoRoom.ts';
import type { World } from './world.ts';

/** The hand-built Lab B demo corridor as a World, the interface kit levels also implement. */
export function demoRoomWorld(room: DemoRoom): World {
  return {
    id: 'demo-room',
    group: room.group,
    lights: room.lights,
    spawn: room.spawn,
    bounds: room.bounds,
    playerWorld: demoRoomPlayerWorld(),
    checkpoints: room.anchors.checkpoints.map((cp) => ({ id: cp.id, label: cp.label, reached: (feet: THREE.Vector3) => feet.z < cp.zBelow })),
    defaultLocation: 'Section 07',
    // Demo interactables need game state (save menu, toasts), so main.ts registers them.
    registerInteractions: () => () => {},
    attract(t, cam) {
      // A slow drift down the corridor behind the title menu.
      cam.position.set(Math.sin(t * 0.11) * 0.9, 1.7 + Math.sin(t * 0.07) * 0.08, 7.5 - 3 * (1 - Math.cos(t * 0.05)));
      cam.lookAt(Math.sin(t * 0.13) * 1.2, 1.3, -10);
    },
    update: (t, dt, p, reduced) => room.update(t, dt, p, reduced),
  };
}
