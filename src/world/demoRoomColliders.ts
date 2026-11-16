import { BoxColliders, type Aabb } from '../actors/motor.ts';
import type { PlayerWorld, Surface } from '../actors/player.ts';

/**
 * Hand-placed collision for the Lab B demo corridor (src/world/demoRoom.ts), until
 * ADR-0003 kit pieces supply colliders and surfaces themselves. Numbers mirror the
 * geometry in demoRoom.ts; keep them in step if that layout changes.
 */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
});

const H = 3.2;

export const DEMO_COLLIDERS: Aabb[] = [
  box(-3.4, -0.3, -10.4, 3.4, 0, 10.4), // floor (plate centre, gratings over the trenches)
  box(-3.4, H, -10.4, 3.4, H + 0.3, 10.4), // ceiling
  box(-3.4, 0, -10.4, -2.94, H, 10.4), // left wall panels
  box(2.94, 0, -10.4, 3.4, H, 10.4), // right wall panels + observation window
  box(-3.4, 0, 10, 3.4, H, 10.4), // start wall
  box(-3.4, 0, -10.4, 3.4, H, -9.92), // pressure door leaves
  box(-1.42, 0, -10, -1.1, 2.8, -9.7), // door frame pillars
  box(1.1, 0, -10, 1.42, 2.8, -9.7),
  box(-3, 0, -7.1, -2.075, 0.9, -5.4), // console desk
  box(-2.95, 0, 3.3, -2.45, 2.0, 4.2), // locker
  box(-3, 0.9, 7.69, -2.77, 1.78, 8.31), // save station
  box(1.84, 0, -7.08, 2.8, 0.92, -6.12), // crates (right side)
  box(1.95, 0.9, -6.88, 2.61, 1.52, -6.22),
  box(1.87, 0, -5.78, 2.63, 0.72, -5.02),
];

/** Boxes the interact ray hits (slightly proud of the visible faces). */
export const DEMO_INTERACT_BOXES = {
  saveStation: box(-2.95, 0.96, 7.72, -2.75, 1.74, 8.28),
  locker: box(-2.5, 0.3, 3.32, -2.4, 1.95, 4.18),
  console: box(-2.95, 0.88, -6.8, -2.6, 1.72, -5.7),
  doorPanel: box(1.5, 1.05, -10, 2.1, 1.75, -9.84),
};

export function demoRoomPlayerWorld(): PlayerWorld {
  return {
    colliders: new BoxColliders(DEMO_COLLIDERS),
    // Diamond plate down the middle, grating over the side trenches.
    surfaceAt: (x: number): Surface => (Math.abs(x) > 1.8 ? 'grate' : 'metal'),
  };
}
