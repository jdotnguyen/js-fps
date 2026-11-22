import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LIGHT_BLEED_DIST,
  PortalCuller,
  STRADDLE_MARGIN,
  makeVerticalQuad,
  quadBox,
  type FallbackLink,
  type OceanWindowPortal,
  type PortalQuad,
  type RoomLightSphere,
} from './portalCull.ts';

function cam(pos: [number, number, number], lookAt: [number, number, number], fov = 70): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 100);
  c.position.set(...pos);
  c.lookAt(...lookAt);
  c.updateMatrixWorld(true);
  return c;
}

function zPortal(
  a: string,
  b: string,
  x: number,
  z: number,
  halfWidth = 1.0,
  passable: () => boolean = () => true,
): PortalQuad {
  const verts = makeVerticalQuad(x, z, 0, -1, halfWidth, 0, 2.4);
  return { rooms: [a, b], verts, box: quadBox(verts), passable };
}

function xPortal(
  a: string,
  b: string,
  x: number,
  z: number,
  halfWidth = 1.0,
  passable: () => boolean = () => true,
): PortalQuad {
  const verts = makeVerticalQuad(x, z, 1, 0, halfWidth, 0, 2.4);
  return { rooms: [a, b], verts, box: quadBox(verts), passable };
}

test('multi-hop straight sightline draws all chained rooms through open portals', () => {
  // Four rooms lined up along -Z: A (z=0..-4) -> B (-4..-8) -> C (-8..-12) -> D (-12..-16)
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -4),
      zPortal('B', 'C', 0, -8),
      zPortal('C', 'D', 0, -12),
    ],
  });
  const vis = new Set<string>();
  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, -10]));
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C', 'D']);
});

test('closed opaque portal stops traversal along a multi-hop chain', () => {
  let bcOpen = false;
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -4),
      zPortal('B', 'C', 0, -8, 1.0, () => bcOpen),
      zPortal('C', 'D', 0, -12),
    ],
  });
  const c = cam([0, 1.6, 0], [0, 1.6, -10]);
  const vis = new Set<string>();
  culler.computeVisible('A', vis, c);
  assert.deepEqual([...vis].sort(), ['A', 'B']);

  bcOpen = true;
  culler.computeVisible('A', vis, c);
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C', 'D']);
});

test('portals behind the camera beyond LIGHT_BLEED_DIST do not draw rooms behind the player', () => {
  // Camera at z = +6 facing +Z; portal A->B is at z = -4 (10 m behind camera, > LIGHT_BLEED_DIST).
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -4),
      zPortal('B', 'C', 0, -8),
    ],
  });
  const vis = new Set<string>();
  culler.computeVisible('A', vis, cam([0, 1.6, 6], [0, 1.6, 20]));
  assert.deepEqual([...vis].sort(), ['A']);
});

test('around-the-corner portal outside the narrowed parent NDC window is culled', () => {
  // Room A -> Room B through a narrow doorway at (0, -6), halfWidth 0.8 (spans x/(-z) in [-0.133, +0.133] from z=0).
  // Room B -> Room C sits off to the right at (x=+5, z=-10), halfWidth 1.0 (spans z in [-11, -9] -> x/(-z) in [0.45, 0.56]).
  // From (0, 1.6, 0) looking straight along -Z, B is visible through the doorway, but C's portal
  // lies outside the doorway's screen-space bounds.
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -6, 0.8),
      xPortal('B', 'C', 5, -10, 1.0),
    ],
  });
  const vis = new Set<string>();
  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, -10]));
  assert.deepEqual([...vis].sort(), ['A', 'B']);

  // From (-0.8, 1.6, -5.0) looking toward (5, 1.6, -10), the sightline passes through x=+0.36 at z=-6 (inside the doorway).
  culler.computeVisible('A', vis, cam([-0.8, 1.6, -5.0], [5, 1.6, -10]));
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C']);
});

test('near-plane doorway straddling never hides the room ahead', () => {
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -4, 1.0),
      zPortal('B', 'C', 0, -8, 1.0),
    ],
  });
  const vis = new Set<string>();
  // Place camera inside STRADDLE_MARGIN of portal A->B at z=-4, looking forward and even obliquely.
  const d = STRADDLE_MARGIN * 0.5;
  culler.computeVisible('A', vis, cam([0, 1.6, -4 + d], [0, 1.6, -10]));
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C']);

  // Right on the portal plane z=-4 (within near plane of the quad): B must still draw.
  culler.computeVisible('A', vis, cam([0.2, 1.6, -4.02], [0.2, 1.6, -10]));
  assert.ok(vis.has('B'), 'straddled doorway keeps room B visible');
  assert.ok(vis.has('C'), 'straddled doorway still continues to room C');
});

test('1-hop light-bleed guard keeps a nearby adjacent room active when panning away, without cascading to depth 2+', () => {
  // Camera at z = -2 facing +Z (completely away from A->B at z = -4, distance = 2 m <= LIGHT_BLEED_DIST).
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -4),
      zPortal('B', 'C', 0, -8),
    ],
  });
  const vis = new Set<string>();
  assert.ok(2 < LIGHT_BLEED_DIST);
  culler.computeVisible('A', vis, cam([0, 1.6, -2], [0, 1.6, 10]));
  assert.deepEqual([...vis].sort(), ['A', 'B'], '1-hop B stays lit by proximity guard, 2-hop C stays culled');
});

test('1-hop light-bleed guard activates when an adjacent room light sphere intersects the frustum', () => {
  // Portal A->B is at z = -6 (6 m away > LIGHT_BLEED_DIST), camera faces +X so portal is out of view,
  // but B has a wide active light whose range sphere reaches into the camera frustum.
  let lightOn = true;
  const roomLights = new Map<string, readonly RoomLightSphere[]>([
    ['B', [{ position: new THREE.Vector3(0, 2.5, -7), range: 12, active: () => lightOn }]],
  ]);
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -6, 0.8),
      zPortal('B', 'C', 0, -10, 0.8),
    ],
    roomLights,
  });
  const c = cam([0, 1.6, 0], [10, 1.6, 0]);
  const vis = new Set<string>();
  culler.computeVisible('A', vis, c);
  assert.deepEqual([...vis].sort(), ['A', 'B'], 'active spilling light keeps 1-hop B visible, not 2-hop C');

  lightOn = false;
  culler.computeVisible('A', vis, c);
  assert.deepEqual([...vis].sort(), ['A'], 'inactive light does not keep out-of-frustum B visible');
});

test('non-adjacent AABB fallback links follow the camera frustum', () => {
  const fallbacks: FallbackLink[] = [
    {
      from: 'A',
      to: 'FAR',
      targetBox: new THREE.Box3(new THREE.Vector3(-2, 0, -14), new THREE.Vector3(2, 3, -10)),
    },
  ];
  const culler = new PortalCuller({ portals: [], fallbacks });
  const vis = new Set<string>();

  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, -12]));
  assert.deepEqual([...vis].sort(), ['A', 'FAR']);

  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, 12]));
  assert.deepEqual([...vis].sort(), ['A']);
});

test('ocean window portals pull cross-water rooms only when the window is in view and do not cascade', () => {
  const winVerts = makeVerticalQuad(0, -6, 0, -1, 1.9, 0.4, 2.4);
  const farWinVerts = makeVerticalQuad(0, -24, 0, -1, 1.9, 0.4, 2.4);
  const oceanWindows: OceanWindowPortal[] = [
    { room: 'A', verts: winVerts, box: quadBox(winVerts), targets: ['ACROSS'] },
    { room: 'ACROSS', verts: farWinVerts, box: quadBox(farWinVerts), targets: ['UNRELATED'] },
  ];
  const culler = new PortalCuller({ portals: [], oceanWindows });
  const vis = new Set<string>();

  // Looking at the window: ACROSS is pulled in, UNRELATED is not cascaded.
  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, -10]));
  assert.deepEqual([...vis].sort(), ['A', 'ACROSS']);

  // Looking away from the window: ACROSS is culled.
  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, 10]));
  assert.deepEqual([...vis].sort(), ['A']);
});

test('no-camera headless mode falls back to 360-degree transitive BFS over passable portals', () => {
  let closedDoor = false;
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', 0, -4),
      zPortal('B', 'C', 0, -8),
      zPortal('C', 'SEALED', 0, -12, 1.0, () => closedDoor),
    ],
  });
  const vis = new Set<string>();
  culler.computeVisible('A', vis);
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C']);

  closedDoor = true;
  culler.computeVisible('A', vis);
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C', 'SEALED']);
});

test('cyclic room graph terminates cleanly and expands visibility across multiple portals', () => {
  // Loop: A <-> B <-> C <-> A, with two sibling portals between A and B.
  const culler = new PortalCuller({
    portals: [
      zPortal('A', 'B', -1.5, -4, 0.8),
      zPortal('A', 'B', 1.5, -4, 0.8),
      zPortal('B', 'C', 0, -8, 1.0),
      zPortal('C', 'A', 4, -2, 1.0),
    ],
  });
  const vis = new Set<string>();
  culler.computeVisible('A', vis, cam([0, 1.6, 0], [0, 1.6, -10]));
  assert.deepEqual([...vis].sort(), ['A', 'B', 'C']);
});
