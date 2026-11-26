import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCreaturePoses } from '../../data/types/creatures.ts';
import { SequencePlayer } from './sequences.ts';
import { JUGGERNAUT_POSES } from './juggernaut.ts';
import { loadJuggernaut } from './creatureTestKit.ts';

// openspec juggernaut-walk-and-roar D5, spec creature-motion "Key-pose sequences play over the walk".

test('a sequence of 0.5+1 s and 0.3+0.2 s steps finishes 2.0 s after it starts, within one frame', async () => {
  const { rig } = await loadJuggernaut();
  const file = {
    poses: JUGGERNAUT_POSES.poses,
    sequences: { probe: [{ pose: 'jaw_open', blend: 0.5, hold: 1, jaw: 1 }, { pose: null, blend: 0.3, hold: 0.2, jaw: 0, tremble: 2 }] },
  };
  const player = new SequencePlayer(rig, validateCreaturePoses(file, 'probe'));
  assert.equal(player.duration('probe'), 2);
  player.play('probe');
  const dt = 1 / 60;
  let t = 0;
  while (!player.finished && t < 5) {
    player.update(dt);
    rig.update(dt);
    t += dt;
  }
  assert.ok(Math.abs(t - 2) <= dt + 1e-9, `finished at ${t.toFixed(3)} s`);
  assert.equal(player.playing, null);
  assert.equal(rig.getFace().jaw, 0, 'the last step\'s face stays');
  assert.equal(rig.getAdjustment('head_09'), null, 'the tremble stops');
});

test('the face ramps over the blend and the tremble shakes the head while it holds', async () => {
  const { rig } = await loadJuggernaut();
  const file = validateCreaturePoses({ poses: JUGGERNAUT_POSES.poses, sequences: { s: [{ pose: null, blend: 1, hold: 1, jaw: 1, tremble: 3 }] } }, 's');
  const player = new SequencePlayer(rig, file);
  player.play('s');
  player.update(0.5);
  const half = rig.getFace().jaw;
  assert.ok(half > 0.2 && half < 0.8, `jaw part-way at the middle of the blend (${half.toFixed(2)})`);
  player.update(0.6);
  const a = rig.getAdjustment('head_09')!.angleTo(rig.getAdjustment('head_09')!.clone().identity());
  player.update(0.05);
  const b = rig.getAdjustment('head_09')!;
  assert.ok(a > 0, 'the head trembles');
  assert.ok(b.angleTo(b.clone().identity()) * (180 / Math.PI) <= 3 * 3 + 1e-6, 'within a few times its amplitude');
});

test('one player plays sequence after sequence, each from its own start', async () => {
  const { rig } = await loadJuggernaut();
  const player = new SequencePlayer(rig, JUGGERNAUT_POSES);
  const dt = 1 / 60;
  for (const name of ['roar_walk', 'roar_full', 'roar_full']) {
    player.play(name);
    const jaws: number[] = [];
    let t = 0;
    while (!player.finished && t < 10) {
      player.update(dt);
      rig.update(dt);
      jaws.push(rig.getFace().jaw);
      t += dt;
    }
    assert.ok(Math.abs(t - player.duration(name)) <= dt + 1e-9, `${name} took ${t.toFixed(2)} s, not ${player.duration(name).toFixed(2)} s`);
    assert.ok(Math.max(...jaws) > 0.9, `${name} opens the jaw`);
    if (name === 'roar_full') assert.ok(jaws[Math.round(0.7 / dt)]! < 0.4, `${name}'s windup keeps the jaw mostly shut (${jaws[Math.round(0.7 / dt)]!.toFixed(2)})`);
  }
});

test('a sequence naming an unknown pose fails to load, naming the sequence and the pose', () => {
  assert.throws(
    () => validateCreaturePoses({ poses: { a: { joints: {} } }, sequences: { roar_full: [{ pose: 'rear_up', blend: 0.2, hold: 1 }] } }, 'juggernaut.poses.json'),
    /roar_full.*unknown pose "rear_up"/,
  );
});
