import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCreaturePoses, validateCreatureDef, validateCreaturePoses, type CreatureDef } from './creatures.ts';

// openspec rig-juggernaut D5: creature definitions and poses are data, checked when they load.

const ball = { kind: 'ball', twist: [-10, 10], cone: [20, 20] };
const hinge = { kind: 'hinge', axis: [1, 0, 0], range: [0, 90], play: 2 };

function def(): Record<string, unknown> {
  const chains: Record<string, string[]> = {
    spine: ['s1'],
    neck: ['n'],
    head: ['h'],
    jaw: ['j'],
    tongue: ['t'],
    eyes: ['e.L', 'e.R'],
    'arm.L': ['shL', 'uaL', 'faL', 'haL'],
    'arm.R': ['shR', 'uaR', 'faR', 'haR'],
    'leg.L': ['thL', 'snL', 'mtL', 'ftL'],
    'leg.R': ['thR', 'snR', 'mtR', 'ftR'],
  };
  const limits: Record<string, unknown> = {};
  for (const js of Object.values(chains)) for (const j of js) limits[j] = /fa|sn|mt/.test(j) ? hinge : ball;
  return {
    model: 'assets/models/x.glb',
    height: 5,
    heightPose: 'rest',
    forward: [0, 0, 1],
    aimMarker: 'marker',
    chains,
    limits,
    ik: { 'arm.L': { pole: [0, 0, -1] }, 'arm.R': { pole: [0, 0, -1] }, 'leg.L': { pole: [0, 0, 1], hock: 30 }, 'leg.R': { pole: [0, 0, 1], hock: 30 } },
    lookNeckShare: 0.4,
    face: { jawOpen: 'jaw', tongueExtend: 'tx', tongueCurl: 'tc' },
  };
}

const poses = (extra: Record<string, unknown> = {}) => ({
  poses: { rest: { joints: { h: [0, 30, 0] }, scales: { t: [1.2, 1.2, 1.2] } }, jaw: { joints: { j: [20, 0, 0] } }, tx: { joints: {} }, tc: { joints: {} }, ...extra },
});

test('a complete creature and its poses validate', () => {
  const d = validateCreatureDef(def(), 'juggernaut.json');
  assert.equal(d.limits['faL']!.kind, 'hinge');
  checkCreaturePoses(d, validateCreaturePoses(poses(), 'juggernaut.poses.json'), 'juggernaut.poses.json');
});

test('a pose naming a joint the rig does not have is rejected, naming the pose and the joint', () => {
  const d = validateCreatureDef(def(), 'juggernaut.json') as CreatureDef;
  const file = validateCreaturePoses(poses({ roar: { joints: { tail_07: [1, 2, 3] } } }), 'p.json');
  assert.throws(() => checkCreaturePoses(d, file, 'p.json'), /roar.*tail_07/);
});

test('a limit or chain naming an unknown joint is rejected', () => {
  const d = def();
  (d.limits as Record<string, unknown>)['wing_02'] = ball;
  assert.throws(() => validateCreatureDef(d, 'x'), /limits > wing_02: unknown joint/);
  const e = def();
  delete (e.limits as Record<string, unknown>)['n'];
  assert.throws(() => validateCreatureDef(e, 'x'), /chains > neck: joint "n" has no limit/);
});

test('a missing solver role or a short limb chain is rejected', () => {
  const d = def();
  delete (d.chains as Record<string, unknown>)['leg.R'];
  assert.throws(() => validateCreatureDef(d, 'x'), /chains > leg\.R: missing role/);
  const e = def();
  (e.chains as Record<string, string[]>)['arm.L'] = ['shL', 'uaL', 'haL'];
  assert.throws(() => validateCreatureDef(e, 'x'), /chains > arm\.L: expected 4 joints/);
});

test('a limit whose minimum is greater than its maximum is rejected', () => {
  const d = def();
  (d.limits as Record<string, unknown>)['faL'] = { ...hinge, range: [100, 10] };
  assert.throws(() => validateCreatureDef(d, 'x'), /limits > faL > range: min 100 is greater than max 10/);
  const e = def();
  (e.limits as Record<string, unknown>)['h'] = { ...ball, twist: [5, -5] };
  assert.throws(() => validateCreatureDef(e, 'x'), /limits > h > twist: min 5 is greater than max -5/);
});

test('a pose the creature names must exist', () => {
  const d = validateCreatureDef(def(), 'x') as CreatureDef;
  const file = validateCreaturePoses({ poses: { rest: { joints: {} } } }, 'p.json');
  assert.throws(() => checkCreaturePoses(d, file, 'p.json'), /missing pose "jaw"/);
});
