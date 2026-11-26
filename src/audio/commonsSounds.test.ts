import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import intro from '../data/sequences/intro_shift_change.json' with { type: 'json' };
import { COMMONS_OPEN_FLAG, COMMONS_TUNING, CommonsSounds, type CommonsFrame, type CommonsSeat } from './commonsSounds.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SampleName, SoundName } from './sounds.ts';

interface Played {
  name: SoundName;
  opts: VoiceOptions;
  at: number;
  stopped: boolean;
}

function rig(counter: THREE.Vector3 | null = new THREE.Vector3(29.2, 0.95, 10.6)) {
  const played: Played[] = [];
  const missing = new Set<SampleName>();
  let now = 0;
  const sounds = new CommonsSounds(
    {
      hasSample: (n) => !missing.has(n),
      play: (name, opts = {}) => {
        const p: Played = { name, opts, at: now, stopped: false };
        played.push(p);
        const handle: LoopHandle = { setGain: () => {}, stop: () => void (p.stopped = true) };
        return handle;
      },
    },
    { room: 'R02', counter },
  );
  const frame: CommonsFrame = {
    listener: new THREE.Vector3(24, 1.6, 14),
    over: false,
    talking: false,
    seats: [],
    introOver: false,
    cookAtStation: false,
    sceneRunning: false,
  };
  const run = (seconds: number, patch: Partial<CommonsFrame> = {}): void => {
    Object.assign(frame, patch);
    for (let t = 0; t < seconds - 1e-9; t += 0.1) {
      now += 0.1;
      sounds.update(0.1, frame);
    }
  };
  const named = (name: SoundName) => played.filter((p) => p.name === name);
  return { sounds, frame, run, played, named, missing };
}

const seat = (x: number, z: number, yaw = 0): CommonsSeat => ({ pos: { x, y: 0, z }, yaw });
const gaps = (list: readonly Played[]) => list.slice(1).map((p, i) => p.at - list[i]!.at);
const chair = (x: number, z: number, kind = 'sit_chair', room = 'R02') => ({ room, kind, pos: { x, y: 0, z } });

test('a chair scrapes from where it is, and only dining chairs in the Commons do', () => {
  const r = rig();
  r.sounds.chair(chair(20, 17));
  r.sounds.chair(chair(19, 25, 'sit_stool'));
  r.sounds.chair(chair(30, 22, 'sit_sofa'));
  r.sounds.chair(chair(15, 22, 'lean_wall'));
  r.sounds.chair(chair(22, 14, 'sit_chair', 'R05'));
  r.run(0.1);
  assert.equal(r.played.length, 1);
  const p = r.played[0]!;
  assert.equal(p.name, 'chairScrape');
  assert.deepEqual([p.opts.position!.x, p.opts.position!.y, p.opts.position!.z], [20, COMMONS_TUNING.chairHeight, 17]);
  assert.equal(p.opts.bus, 'sfx', 'the sfx bus, so walls and doors muffle it');
  r.run(5);
  assert.equal(r.played.length, 1, 'it scrapes once');
});

test('cups and cutlery come irregularly from the table in front of a seated diner', () => {
  const r = rig();
  r.run(120, { seats: [seat(20, 17, 0), seat(22, 19, Math.PI)] });
  const clinks = r.named('tableClink');
  assert.ok(clinks.length >= 11 && clinks.length <= 31, `about one every 4-10 s, got ${clinks.length} in 2 min`);
  const g = gaps(clinks);
  assert.ok(Math.min(...g) >= COMMONS_TUNING.table.every[0] - 0.11 && Math.max(...g) <= COMMONS_TUNING.table.every[1] + 0.11, `intervals ${g.join(', ')}`);
  assert.ok(new Set(g.map((v) => v.toFixed(1))).size > 3, 'not at fixed intervals');
  assert.ok(new Set(clinks.map((p) => p.opts.rate)).size > 3, 'repeats vary in pitch');
  const spots = new Set(clinks.map((p) => `${p.opts.position!.x.toFixed(2)},${p.opts.position!.y.toFixed(2)},${p.opts.position!.z.toFixed(2)}`));
  // 0.45 m ahead of the diner (yaw 0 faces -z), at table height.
  assert.deepEqual([...spots].sort(), ['20.00,0.78,16.55', '22.00,0.78,19.45']);
});

test('with nobody on a chair there is no table sound', () => {
  const r = rig();
  r.run(60);
  assert.equal(r.played.length, 0);
});

test('the kitchen is heard only after the intro, with Bram at his station and no scripted scene', () => {
  const r = rig();
  r.run(60, { cookAtStation: true });
  assert.equal(r.named('kitchenClatter').length, 0, 'during the intro');
  r.run(60, { introOver: true, cookAtStation: false });
  assert.equal(r.named('kitchenClatter').length, 0, 'Bram away');
  r.run(60, { cookAtStation: true, sceneRunning: true });
  assert.equal(r.named('kitchenClatter').length, 0, 'a scene is running');
  r.run(180, { sceneRunning: false });
  const k = r.named('kitchenClatter');
  assert.ok(k.length >= 8 && k.length <= 23, `about one every 8-20 s, got ${k.length} in 3 min`);
  const g = gaps(k);
  assert.ok(Math.min(...g) >= COMMONS_TUNING.kitchen.every[0] - 0.11 && Math.max(...g) <= COMMONS_TUNING.kitchen.every[1] + 0.11, `intervals ${g.join(', ')}`);
  for (const p of k) {
    assert.ok(Math.abs(p.opts.position!.x - 29.2) <= COMMONS_TUNING.counterSpread, 'along the counter');
    assert.deepEqual([p.opts.position!.y, p.opts.position!.z], [0.95, 10.6]);
  }
});

test('a level without a counter anchor has no kitchen sound', () => {
  const r = rig(null);
  r.run(60, { introOver: true, cookAtStation: true });
  assert.equal(r.played.length, 0);
});

test('sounds that start while someone is talking are half as loud', () => {
  const r = rig();
  r.sounds.chair(chair(20, 17));
  r.run(0.1);
  r.sounds.chair(chair(20, 17));
  r.run(0.1, { talking: true });
  const [quiet, talk] = r.named('chairScrape');
  assert.equal(talk!.opts.gain, quiet!.opts.gain! * COMMONS_TUNING.talkShare);
  r.run(60, { seats: [seat(20, 17)], introOver: true, cookAtStation: true });
  const later = r.played.slice(2);
  assert.ok(later.some((p) => p.name === 'tableClink') && later.some((p) => p.name === 'kitchenClatter'));
  for (const p of later) {
    const full = p.name === 'tableClink' ? COMMONS_TUNING.table.gain : COMMONS_TUNING.kitchen.gain;
    assert.equal(p.opts.gain, full * COMMONS_TUNING.talkShare, `${p.name} while talking`);
  }
});

test('nothing starts beyond 24 m', () => {
  const r = rig();
  r.frame.listener.set(60, 1.6, 17);
  r.sounds.chair(chair(20, 17));
  r.run(60, { seats: [seat(20, 17)], introOver: true, cookAtStation: true });
  assert.equal(r.played.length, 0);
});

test('a recording that has not decoded is skipped', () => {
  const r = rig();
  r.missing.add('tableClink');
  r.sounds.chair(chair(20, 17));
  r.run(60, { seats: [seat(20, 17)] });
  assert.deepEqual([...new Set(r.played.map((p) => p.name))], ['chairScrape']);
});

test('the save made as the intro ends already holds the flag that opens the kitchen and the brew', () => {
  const steps = intro.steps as ReadonlyArray<Record<string, unknown>>;
  const saved = steps.findIndex((s) => s['do'] === 'checkpoint' && s['id'] === 'cp_intro');
  const set = steps.findIndex((s) => s['do'] === 'setFlag' && s['flag'] === COMMONS_OPEN_FLAG && s['value'] === true);
  assert.ok(saved >= 0, 'the intro ends with its autosave');
  assert.ok(set >= 0 && set < saved, `${COMMONS_OPEN_FLAG} is set before the autosave`);
});

test('from the drop on there is nothing', () => {
  const r = rig();
  r.sounds.chair(chair(20, 17));
  r.run(120, { over: true, seats: [seat(20, 17)], introOver: true, cookAtStation: true });
  assert.equal(r.played.length, 0);
});

test('the title screen silences what is playing and forgets queued scrapes', () => {
  const r = rig();
  r.sounds.chair(chair(20, 17));
  r.run(0.1);
  r.sounds.chair(chair(20, 17));
  r.sounds.reset();
  assert.equal(r.played[0]!.stopped, true);
  r.run(0.1);
  assert.equal(r.played.length, 1);
});
