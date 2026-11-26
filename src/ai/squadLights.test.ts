import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { demoRoomPlayerWorld } from '../world/demoRoomColliders.ts';
import { gridNodes, NavGraph } from './nav.ts';
import { NpcDirector } from './npcs.ts';
import { Squad, type SquadPlayer } from './squad.ts';

// render-lighting "The set of real lights stays constant during play" (openspec stop-midgame-shader-stalls D2): the
// count of visible lights is part of every lit material's program, so hiding a squadmate must not change it.

function setup() {
  const pw = demoRoomPlayerWorld();
  const nav = new NavGraph({ world: pw.colliders, nodes: gridNodes(pw.colliders, { minX: -2.5, maxX: 2.5, minZ: -9.5, maxZ: 9.5, maxY: 0.5 }, 1) });
  const player = {
    body: { x: 0, y: 0, z: 8, vy: 0, grounded: true },
    yaw: 0,
    aimBlend: 0,
    velocity: { x: 0, y: 0 },
    viewDirection: (o = new THREE.Vector3()) => o.set(0, 0, -1),
    eyePosition(o = new THREE.Vector3()) {
      return o.set(this.body.x, this.body.y + 1.62, this.body.z);
    },
  };
  const ctx = { poses: new PoseLibrary(loadPoseFile(posesJson)), gore: {} as GoreSystem };
  const squad = new Squad({ ctx, nav, player: player as SquadPlayer });
  const npcs = new NpcDirector({
    ctx,
    nav,
    colliders: pw.colliders,
    squad,
    player: () => ({ feet: new THREE.Vector3(player.body.x, 0, player.body.z), head: player.eyePosition() }),
    interact: () => () => undefined,
    emit: () => undefined,
  });
  const scene = new THREE.Scene();
  scene.add(squad.group, npcs.group, npcs.fx);
  squad.update(1 / 60, null);
  // A scene takes both on: only a held mate runs through the director, which hides bodies out of range.
  for (const m of squad.mates) void npcs.command('spawn', { npc: m.id === 'engineer' ? 'giles' : 'okafor', at: m.position.toArray() });
  return { squad, npcs, scene };
}

/** The lights three counts for a program: visible ones, by kind, shadow and projected pattern. */
function lightSet(scene: THREE.Scene): string[] {
  const out: string[] = [];
  scene.traverseVisible((o) => {
    if (!(o instanceof THREE.Light)) return;
    out.push(`${o.type}|shadow:${o.castShadow}|map:${o instanceof THREE.SpotLight && o.map !== null}`);
  });
  return out.sort();
}

test('the scene counts the same lights with the squad near, far, split and with weapon lights on', () => {
  const { squad, npcs, scene } = setup();
  const [a, b] = squad.mates;
  const near = a!.position.clone();
  const far = near.clone().add(new THREE.Vector3(500, 0, 0));
  const look = (camera: THREE.Vector3): void => {
    npcs.update(1 / 60, camera);
    squad.syncWeaponLights();
  };
  const hidden = (): number => squad.mates.filter((m) => !m.body.group.visible).length;

  look(near);
  assert.equal(hidden(), 0);
  const expected = lightSet(scene);
  assert.equal(expected.filter((k) => k.startsWith('SpotLight')).length, 3, 'two weapon lights and the kill key light');

  for (const on of [false, true]) {
    squad.setFlashlight(undefined, on);
    look(far);
    assert.equal(hidden(), 2, 'both far: hidden');
    assert.deepEqual(lightSet(scene), expected, `both far, weapon lights ${on}`);
    for (const m of squad.mates) assert.equal(m.weaponLight.intensity, 0, 'a hidden mate lights nothing');

    b!.place({ x: near.x + 200, y: near.y, z: near.z }, 0);
    look(near);
    assert.equal(hidden(), 1, 'split: one hidden');
    assert.deepEqual(lightSet(scene), expected, `split, weapon lights ${on}`);
    assert.equal(a!.weaponLight.intensity > 0, on);
    assert.equal(b!.weaponLight.intensity, 0);

    b!.place(near, 0);
    look(near);
    assert.equal(hidden(), 0);
    assert.deepEqual(lightSet(scene), expected, `near again, weapon lights ${on}`);
    assert.equal(b!.weaponLight.intensity > 0, on);
  }
});
