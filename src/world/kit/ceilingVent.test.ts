import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { KitRegistry } from '../registry.ts';
import type { PropSoundEvent } from './types.ts';

// The ceiling vent the Lab B creature escapes through and drops out of (trim-lab-wing-encounters design D5).

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;
const reg = new KitRegistry({ glb: {} });

function vent(params: Record<string, unknown> = {}) {
  const out = reg.create('ceiling_vent', { id: 'v', ceiling: 4, ...params }, new Rng(1), mats);
  const sounds: PropSoundEvent[] = [];
  out.onSound?.((e) => sounds.push(e));
  const grate = out.object.getObjectByName('vent-grate')!;
  const send = (event: string, payload: unknown): void => {
    for (const l of out.listeners ?? []) if (l.event === event) l.fn(payload);
  };
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) out.tick?.(t, 1 / 60);
  };
  return { out, grate, sounds, send, run };
}

test('closed: the grate sits flush under the ceiling; the vent has no colliders', () => {
  const { out, grate } = vent();
  assert.ok(Math.abs(grate.position.y - 3.988) < 1e-6, `grate at ${grate.position.y}`);
  assert.equal(grate.rotation.z, 0);
  assert.equal(out.colliders.length, 0, 'nothing to bump into, open, closed or fallen');
  assert.ok(grate.userData.dynamic, 'the grate moves, so it is not merged into the room');
});

test('open swings the grate down on its hinge and leaves it hanging; other ids are ignored', () => {
  const { grate, send, run } = vent();
  send('ventGrate:set', { id: 'other', state: 'open' });
  run(1);
  assert.equal(grate.rotation.z, 0, 'another vent');
  send('ventGrate:set', { id: 'v', state: 'open' });
  run(4);
  assert.ok(grate.rotation.z < -1.4, `hangs down (${grate.rotation.z.toFixed(2)} rad)`);
  assert.ok(grate.position.y > 3.9, 'still on its hinge at the ceiling');
});

test('fallen drops the grate to the floor, bounces once, clatters once and lies flat', () => {
  const { grate, sounds, send, run } = vent();
  send('ventGrate:set', { id: 'v', state: 'fallen' });
  run(0.3);
  assert.ok(grate.position.y < 3.988 && grate.position.y > 0.5, `falling (${grate.position.y.toFixed(2)})`);
  run(3);
  assert.ok(Math.abs(grate.position.y - 0.012) < 1e-6, `on the floor (${grate.position.y})`);
  assert.equal(grate.rotation.z, 0, 'flat');
  assert.deepEqual(sounds.map((s) => s.sound), ['grateClatter']);
  assert.ok(sounds[0]!.pos[1] < 0.2, 'heard at the floor');
});

test('instant snaps to the state (restores and skips), and a level reset closes it', () => {
  const { grate, sounds, send } = vent();
  send('ventGrate:set', { id: 'v', state: 'fallen', instant: true });
  assert.ok(Math.abs(grate.position.y - 0.012) < 1e-6);
  assert.equal(sounds.length, 0, 'no clatter on a restore');
  send('ventGrate:set', { id: 'v', state: 'open', instant: true });
  assert.ok(grate.rotation.z < -1.4);
  send('level:reset', undefined);
  assert.equal(grate.rotation.z, 0);
  assert.ok(Math.abs(grate.position.y - 3.988) < 1e-6);
});
