import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceGraph, type PortalState, type VoicePortal } from './voicePath.ts';
import { EARSHOT_LEVEL, GLASS_CUTOFF_HZ, OCCLUDED_CUTOFF_HZ, voiceAudibility } from './occlusion.ts';

/**
 * A row of rooms along x, 10 m each: A [0,10) B [10,20) C [20,30) D [30,40), doorways at x = 10, 20, 30.
 * A second way from A to C goes through E (a door at A/E and one at E/C), for the route-choice test.
 */
function station(states: Record<string, PortalState> = {}): VoiceGraph {
  const portal = (id: string, a: string, b: string, x: number, z = 0): VoicePortal => ({
    rooms: [a, b],
    at: { x, y: 1, z },
    state: () => states[id] ?? 'open',
  });
  return new VoiceGraph([
    portal('ab', 'A', 'B', 10),
    portal('bc', 'B', 'C', 20),
    portal('cd', 'C', 'D', 30),
    portal('ae', 'A', 'E', 8, 5),
    portal('ec', 'E', 'C', 22, 5),
  ]);
}
const at = (x: number, z = 0) => ({ x, y: 1.6, z });

test('same room: no boundaries, the straight line is the route', () => {
  const p = station().path(at(2), 'A', at(6), 'A')!;
  assert.deepEqual({ b: p.boundaries, len: p.pathLength }, { b: 0, len: 4 });
  const a = voiceAudibility(p);
  assert.equal(a.gain, 1);
  assert.equal(a.cutoffHz, Infinity);
});

test('next room through an open doorway is slightly muffled and quieter', () => {
  const p = station().path(at(8), 'A', at(12), 'B')!;
  assert.equal(p.boundaries, 1);
  assert.equal(p.closedDoors, 0);
  const a = voiceAudibility(p);
  assert.ok(a.gain < 1 && a.gain > 0.4, `gain ${a.gain}`);
  assert.ok(a.cutoffHz >= 2000, `cutoff ${a.cutoffHz}`);
  assert.ok(a.level > EARSHOT_LEVEL);
});

test('a closed door muffles like a wall and much quieter than an open one', () => {
  const open = voiceAudibility(station().path(at(8), 'A', at(12), 'B'));
  const closed = voiceAudibility(station({ ab: 'closed', ae: 'closed', ec: 'closed' }).path(at(8), 'A', at(12), 'B'));
  assert.equal(closed.cutoffHz, OCCLUDED_CUTOFF_HZ);
  assert.ok(closed.gain < open.gain * 0.5);
});

test('glass dulls only slightly', () => {
  const a = voiceAudibility(station({ ab: 'glass' }).path(at(9), 'A', at(11), 'B'));
  assert.equal(a.cutoffHz, GLASS_CUTOFF_HZ);
  assert.ok(a.gain > 0.6);
});

test('three or more boundaries away is silent', () => {
  assert.equal(station().path(at(9), 'A', at(31), 'D'), null);
  const a = voiceAudibility(null);
  assert.equal(a.gain, 0);
  assert.ok(a.level < EARSHOT_LEVEL);
});

test('a route past 30 m is silent even within two boundaries', () => {
  const p = station().path(at(0.5), 'A', at(29.5), 'C')!;
  assert.ok(p.pathLength > 28);
  const far = voiceAudibility({ ...p, pathLength: 31 });
  assert.equal(far.gain, 0);
});

test('an open way round is preferred over a closed door', () => {
  const p = station({ bc: 'closed' }).path(at(9), 'A', at(21), 'C')!;
  assert.equal(p.closedDoors, 0, 'goes A -> E -> C through open doors');
  assert.equal(p.boundaries, 2);
});

test('a door opening mid-line changes the route on the next query', () => {
  const states: Record<string, PortalState> = { ab: 'closed', ae: 'closed', ec: 'closed' };
  const g = station(states);
  assert.equal(g.path(at(8), 'A', at(12), 'B')!.closedDoors, 1);
  states.ab = 'open';
  assert.equal(g.path(at(8), 'A', at(12), 'B')!.closedDoors, 0);
});

test('a point outside every room counts as the same room', () => {
  const p = station().path(at(8), null, at(12), 'B')!;
  assert.equal(p.boundaries, 0);
});
