import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBIENT_TUNING, AmbientDirector, isAmbientEligible, poseForSpotKind, type AmbientAgent, type AmbientSpot } from './ambientLife.ts';

interface FakeAgent extends AmbientAgent {
  pos: { x: number; y: number; z: number };
  yaw: number;
  pose: string;
  free: boolean;
  walk: { target: { x: number; y: number; z: number }; yaw: number; left: number; done: () => void } | null;
  walksStarted: number;
  settles: number;
}

function makeSpot(id: string, room: string, group: string, kind: AmbientSpot['kind'], x: number, z: number): AmbientSpot {
  return { id, room, group, kind, pos: { x, y: 0, z }, yaw: 0, taken: null };
}

function makeAgent(id: string, room: string, spot: AmbientSpot | null, x: number, z: number, roam?: readonly string[]): FakeAgent {
  const a: FakeAgent = {
    id,
    room,
    ...(roam ? { roam } : {}),
    initialSpot: spot?.id ?? null,
    pos: { x, y: 0, z },
    yaw: 0,
    pose: spot?.kind ?? 'idle',
    free: true,
    walk: null,
    walksStarted: 0,
    settles: 0,
    available: () => a.free && a.walk === null,
    feet: () => a.pos,
    walkTo(pos, yaw, speed, onDone) {
      a.walksStarted++;
      const d = Math.hypot(pos.x - a.pos.x, pos.z - a.pos.z);
      a.walk = { target: { ...pos }, yaw, left: Math.max(0.2, d / speed), done: onDone };
    },
    settle(pos, yaw, pose) {
      a.pos = { ...pos };
      a.yaw = yaw;
      a.pose = pose;
      a.settles++;
    },
  };
  return a;
}

function step(dir: AmbientDirector, agents: FakeAgent[], seconds: number, eye: { x: number; y: number; z: number } | null = { x: 0, y: 1.6, z: 0 }, forward: { x: number; z: number } | null = null, each?: () => void): void {
  const dt = 0.2;
  for (let t = 0; t < seconds; t += dt) {
    for (const a of agents) {
      if (!a.walk) continue;
      a.walk.left -= dt;
      if (a.walk.left <= 0) {
        const w = a.walk;
        a.walk = null;
        a.pos = { ...w.target };
        a.yaw = w.yaw;
        w.done();
      }
    }
    dir.update(dt, { eye, forward });
    each?.();
  }
}

test('AmbientDirector moves ambient crew between free spots without double-booking and obeys the 1-in-5 cap', () => {
  const spots: AmbientSpot[] = [
    makeSpot('s0', 'R02', 't1', 'sit_chair', 0, 0),
    makeSpot('s1', 'R02', 't1', 'sit_chair', 1, 0),
    makeSpot('s2', 'R02', 't2', 'sit_chair', 4, 0),
    makeSpot('s3', 'R02', 't2', 'sit_chair', 5, 0),
    makeSpot('s4', 'R02', 'c1', 'lean_counter', 0, 4),
    makeSpot('s5', 'R02', 'c2', 'lean_counter', 4, 4),
    makeSpot('s6', 'R02', 't3', 'sit_sofa', 8, 2),
    makeSpot('s7', 'R02', 't3', 'sit_sofa', 9, 2),
  ];
  const agents = [
    makeAgent('a0', 'R02', spots[0]!, 0, 0),
    makeAgent('a1', 'R02', spots[1]!, 1, 0),
    makeAgent('a2', 'R02', spots[2]!, 4, 0),
    makeAgent('a3', 'R02', spots[3]!, 5, 0),
    makeAgent('a4', 'R02', spots[4]!, 0, 4),
  ];
  const dir = new AmbientDirector(spots, agents);
  let maxMoving = 0;
  step(dir, agents, 180, { x: 2, y: 1.6, z: 2 }, null, () => {
    maxMoving = Math.max(maxMoving, dir.movingCount('R02'));
    // No two agents ever hold/book the same spot.
    const held = agents.map((a) => dir.spotOf(a.id)?.id).filter(Boolean);
    assert.equal(new Set(held).size, held.length, 'no duplicate spot bookings');
  });
  assert.equal(maxMoving, 1, '5 agents -> at most 1 moving at once (1 in 5 cap)');
  const totalMoves = agents.reduce((n, a) => n + a.walksStarted, 0);
  const totalSettles = agents.reduce((n, a) => n + a.settles, 0);
  assert.ok(totalMoves >= 5, `expected several ambient moves, got ${totalMoves}`);
  assert.ok(totalSettles >= 4, `expected settled arrivals, got ${totalSettles}`);
});

test('AmbientDirector defers faraway rooms and releases spots cleanly when interrupted by a sequence', () => {
  const spots = [
    makeSpot('s0', 'R02', 't1', 'sit_chair', 0, 0),
    makeSpot('s1', 'R02', 't2', 'lean_counter', 4, 0),
    makeSpot('s2', 'R02', 't3', 'sit_sofa', 0, 4),
  ];
  const agents = [
    makeAgent('a0', 'R02', spots[0]!, 0, 0),
    makeAgent('a1', 'R02', spots[1]!, 4, 0),
  ];
  const dir = new AmbientDirector(spots, agents);
  // Camera far away (> activeRange): no walks start.
  step(dir, agents, 80, { x: 100, y: 1.6, z: 100 });
  assert.equal(agents[0]!.walksStarted + agents[1]!.walksStarted, 0, 'far rooms stay quiet');

  // Camera arrives: a walk starts; interrupting releases its booked spot immediately.
  step(dir, agents, 60, { x: 2, y: 1.6, z: 2 });
  assert.ok(agents[0]!.walksStarted + agents[1]!.walksStarted >= 1);
  dir.interrupt('a0');
  assert.equal(dir.spotOf('a0'), null);
  dir.reset();
  assert.equal(dir.spotOf('a0')?.id, 's0', 'reset restores initial spot');
  assert.equal(dir.spotOf('a1')?.id, 's1');
});

test('isAmbientEligible protects story NPCs and desk workers', () => {
  assert.equal(isAmbientEligible('priya', 'idle'), false);
  assert.equal(isAmbientEligible('hale', 'idle_hips'), false);
  assert.equal(isAmbientEligible('cook', 'idle'), false);
  assert.equal(isAmbientEligible('dock_guard', 'idle_wand'), false, 'the dock guard holds his post (dock-checkpoint)');
  assert.equal(isAmbientEligible('assistant', 'sit_typing'), false);
  assert.equal(isAmbientEligible('exec_2', 'sit_typing'), false);
  assert.equal(isAmbientEligible('diner_1', 'sit_chair'), true);
  assert.equal(isAmbientEligible('board_1', 'sit_chair'), true);
  assert.equal(isAmbientEligible('botanist_1', 'crouchWork', ['R12b', 'R12d']), true, 'explicit roam opts work-pose botanist in');
  assert.equal(isAmbientEligible('botanist_3', 'typing', ['R12c']), true, 'explicit roam opts Seed Lab botanist in');
  assert.equal(isAmbientEligible('exec_2', 'sit_typing'), false, 'seated office desk typists stay locked');
  assert.equal(poseForSpotKind('work_crouch'), 'crouchWork');
  assert.equal(poseForSpotKind('work_clipboard'), 'clipboard');
  assert.equal(poseForSpotKind('work_bench'), 'typing');
  assert.ok(AMBIENT_TUNING.maxMovingRatio <= 0.25);
});

test('AmbientDirector supports single-NPC work rooms (R12c) and multi-room roaming (R12b+R12d) without double-booking', () => {
  const spots: AmbientSpot[] = [
    makeSpot('b1', 'R12b', 'rack1', 'work_crouch', 41, 16.7),
    makeSpot('b2', 'R12b', 'rack2', 'work_clipboard', 46.8, 18.5),
    makeSpot('b3', 'R12b', 'ws', 'work_bench', 44.5, 15.7),
    makeSpot('d1', 'R12d', 'tank1', 'work_clipboard', 43.8, 27.6),
    makeSpot('d2', 'R12d', 'dehum', 'work_clipboard', 43.8, 27.1),
    makeSpot('c1', 'R12c', 'bench', 'work_bench', 52.4, 19.5),
    makeSpot('c2', 'R12c', 'germ', 'work_clipboard', 52.0, 15.6),
    makeSpot('c3', 'R12c', 'vault', 'work_clipboard', 52.2, 20.5),
  ];
  const bot1 = makeAgent('botanist_1', 'R12b', null, 43.8, 17.8, ['R12b', 'R12d']);
  const bot2 = makeAgent('botanist_2', 'R12b', null, 44.2, 22.4, ['R12b']);
  const bot3 = makeAgent('botanist_3', 'R12c', null, 52.35, 19.5, ['R12c']);
  const agents = [bot1, bot2, bot3];
  const dir = new AmbientDirector(spots, agents);

  const bot1Rooms = new Set<string>();
  const bot2Rooms = new Set<string>();
  const bot3Rooms = new Set<string>();
  step(dir, agents, 220, { x: 44, y: 1.6, z: 20 }, null, () => {
    const held = agents.map((a) => dir.spotOf(a.id)?.id).filter(Boolean);
    assert.equal(new Set(held).size, held.length, 'no duplicate work-spot bookings');
    const s1 = dir.spotOf('botanist_1');
    const s2 = dir.spotOf('botanist_2');
    const s3 = dir.spotOf('botanist_3');
    if (s1) bot1Rooms.add(s1.room);
    if (s2) bot2Rooms.add(s2.room);
    if (s3) bot3Rooms.add(s3.room);
  });

  assert.ok(bot1.walksStarted >= 2 && bot2.walksStarted >= 2 && bot3.walksStarted >= 2, 'all three botanists move actively');
  assert.ok(bot1Rooms.has('R12b') && bot1Rooms.has('R12d'), `botanist_1 visits both R12b and R12d (saw ${[...bot1Rooms].join(',')})`);
  assert.deepEqual([...bot2Rooms], ['R12b'], 'botanist_2 (Wen) stays in R12b');
  assert.deepEqual([...bot3Rooms], ['R12c'], 'botanist_3 stays in R12c');
  assert.ok(['crouchWork', 'clipboard', 'typing'].includes(bot1.pose), `botanist_1 settles in work pose (${bot1.pose})`);
});

test('AmbientDirector reports an agent getting up from a spot and sitting on the next, and stays silent otherwise', () => {
  const spots = [
    makeSpot('s0', 'R02', 't1', 'sit_chair', 0, 0),
    makeSpot('s1', 'R02', 't2', 'sit_chair', 4, 0),
    makeSpot('s2', 'R02', 't3', 'sit_chair', 8, 0),
    makeSpot('s3', 'R02', 't4', 'sit_chair', 12, 0),
  ];
  const agents = [makeAgent('a0', 'R02', spots[0]!, 0, 0), makeAgent('a1', 'R02', spots[1]!, 4, 0)];
  const dir = new AmbientDirector(spots, agents);
  const events: string[] = [];
  dir.watch((event, spot) => events.push(`${event} ${spot.id}`));
  const before = new Map(agents.map((a) => [a.id, dir.spotOf(a.id)!.id]));
  // Until the first move starts: the one event is that agent leaving its seat.
  for (let t = 0; t < 120 && events.length === 0; t += 0.2) step(dir, agents, 0.2, { x: 4, y: 1.6, z: 2 });
  const mover = agents.find((a) => a.walksStarted === 1)!;
  const dest = dir.spotOf(mover.id)!.id;
  assert.deepEqual(events, [`leave ${before.get(mover.id)}`]);
  // It arrives: the second event is it settling where it was headed.
  for (let t = 0; t < 30 && mover.settles === 0; t += 0.2) step(dir, agents, 0.2, { x: 4, y: 1.6, z: 2 });
  assert.deepEqual(events.slice(0, 2), [`leave ${before.get(mover.id)}`, `settle ${dest}`]);

  const quiet = events.length;
  dir.interrupt('a0');
  dir.interrupt('a1');
  dir.reset();
  assert.equal(events.length, quiet, 'a script taking over and a reset report nothing');
});

test('AmbientDirector lists the spots of a kind that free agents are settled on', () => {
  const spots = [
    makeSpot('c0', 'R02', 't1', 'sit_chair', 0, 0),
    makeSpot('c1', 'R02', 't1', 'sit_chair', 1, 0),
    makeSpot('t0', 'R02', 'b1', 'sit_stool', 4, 0),
    makeSpot('x0', 'R05', 't9', 'sit_chair', 40, 0),
  ];
  const agents = [
    makeAgent('a0', 'R02', spots[0]!, 0, 0),
    makeAgent('a1', 'R02', spots[1]!, 1, 0),
    makeAgent('a2', 'R02', spots[2]!, 4, 0),
    makeAgent('a3', 'R05', spots[3]!, 40, 0),
  ];
  const dir = new AmbientDirector(spots, agents);
  const ids = () => dir.seated('R02', 'sit_chair').map((s) => s.id);
  assert.deepEqual(ids(), ['c0', 'c1'], 'chairs in the room asked for, not stools or other rooms');
  agents[1]!.free = false;
  assert.deepEqual(ids(), ['c0'], 'an agent held by a script is not counted');
  dir.interrupt('a0');
  assert.deepEqual(ids(), [], 'nor is one whose spot was released');
});
