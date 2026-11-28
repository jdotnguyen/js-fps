import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { posesJson } from '../data/poseFiles.ts';
import speakersJson from '../data/dialogue/speakers.json' with { type: 'json' };
import { INFECTION_LADDER, REVIVE_TASK, TASKS } from '../ai/squadBrain.ts';
import { CAST } from './castLooks.ts';
import { GILES, OKAFOR } from './squadLooks.ts';
import { sharedMotionProfiles, type MotionProfileFile } from './motionProfiles.ts';
import { checkCoverage, gatherRequests, needFor, type MotionRequest } from './castMotionCoverage.ts';
import { readLevel } from '../data/levels/readLevel.ts';

/** Named characters (everyone with a name) by look id -> profile id. `cook` is Bram's level look. */
const NAMED: Record<string, string | undefined> = { giles: GILES.profile, okafor: OKAFOR.profile };
// Creatures are not named characters: they have no motion profile of their own.
const CREATURES = new Set(['lab_creature', 'flood_elite']);
for (const [look, c] of Object.entries(CAST)) if (!CREATURES.has(look)) NAMED[look] = c.profile;

/**
 * Characters whose own motion has landed (tasks 6.x): every request of theirs must be covered by their own profile.
 * Add each character here as their motion lands.
 */
const OWN_MOTION_LANDED = new Set<string>(['giles', 'okafor', 'priya', 'voss', 'cook', 'bram', 'ruiz', 'heins', 'hale', 'sung']);

const SQUAD_LOOKS = { engineer: 'giles', medic: 'okafor' };

function sequences(): Record<string, unknown> {
  const dir = path.resolve(import.meta.dirname, '../data/sequences');
  const out: Record<string, unknown> = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
}

const poses = (posesJson as { poses: Record<string, unknown> }).poses;
const poseExists = (p: string): boolean => p in poses;

/** Captured clips a look's body can play: the shared core library plus its own character pack (mocap-library spec). */
const coreClips = new Set<string>(Object.keys((JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/mocap-core.json'), 'utf8')) as { clips: Record<string, unknown> }).clips));
function packClips(look: string): Set<string> {
  const p = path.resolve(import.meta.dirname, `../data/cast/${look}/mocap.json`);
  if (!fs.existsSync(p)) return new Set();
  const clips = (JSON.parse(fs.readFileSync(p, 'utf8')) as { clips: Record<string, unknown> | Array<{ id: string }> }).clips;
  return new Set(Array.isArray(clips) ? clips.map((c) => c.id) : Object.keys(clips));
}
const clipExists = (look: string, clip: string): boolean => coreClips.has(clip) || packClips(look).has(clip);

/** Dialogue line id -> the named look that speaks it (speaker "Director Hale" -> profile `hale` -> look `hale`). */
function speakerLooks(): Map<string, string> {
  const lookOfProfile = new Map<string, string>();
  for (const [look, profile] of Object.entries(NAMED)) if (profile && !lookOfProfile.has(profile)) lookOfProfile.set(profile, look);
  const speakers = speakersJson as Record<string, { name?: string }>;
  const dir = path.resolve(import.meta.dirname, '../data/dialogue');
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const file = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { lines?: { id: string; speaker: string }[] };
    for (const line of file.lines ?? []) {
      const profile = speakers[line.speaker]?.name?.split(' ').pop()?.toLowerCase();
      const look = profile && lookOfProfile.get(profile);
      if (look) out.set(line.id, look);
    }
  }
  return out;
}

/**
 * What squad behaviour (src/ai/squad.ts) gives the two squadmates outside tasks: Okafor kneels to revive, both can be downed,
 * and Giles plays the infection ladder's tells.
 */
const SQUAD_BEHAVIOURS: MotionRequest[] = [
  { look: 'okafor', source: `task:${REVIVE_TASK}`, pose: 'kneel_revive' },
  { look: 'okafor', source: 'squad:downed', pose: 'squad_downed' },
  { look: 'giles', source: 'squad:downed', pose: 'squad_downed' },
  ...[...new Set(INFECTION_LADDER.flatMap((rung) => rung.gestures))].map((pose) => ({ look: 'giles', source: 'squad:tell', pose })),
];

/** The scene variants design D11 gives each named character. A landed character must have every one of its own. */
const SCENE_VARIANTS: Record<string, readonly string[]> = {
  giles: ['intro', 'panel', 'console', 'reveal'],
  okafor: ['intro', 'console', 'revive'],
  priya: ['intro'], // her `r08` and `downed` variants land with task 6.4, after the R08 death-scene rewrite
  cook: ['intro'],
  ruiz: ['checkpoint'],
  heins: ['post'],
  hale: ['briefing'],
  voss: ['labb'],
};

/** Design D11's table, row by row: what each scene, task or placement asks of each named character. */
const D11_ROWS: readonly (readonly [look: string, source: string, poses: readonly string[]])[] = [
  ['giles', 'sequence:intro_shift_change', ['walk', 'lean_back', 'lean_back_mug', 'drink']],
  ['giles', 'task:bypass', ['panel_work']],
  ['giles', 'task:bypass_short', ['panel_work']],
  ['giles', 'task:power_restore', ['typing']],
  ['okafor', 'sequence:intro_shift_change', ['lean_back', 'lean_back_mug', 'drink']],
  ['okafor', 'task:biometric', ['biometric_scan']],
  ['okafor', `task:${REVIVE_TASK}`, ['kneel_revive']],
  ['okafor', 'sequence:briefing_gallery', ['glance']],
  ['okafor', 'sequence:action_tunnel', ['glance']],
  ['priya', 'sequence:intro_shift_change', ['walk', 'offer_mug']],
  // Priya's R08 rows (action_security, action_restore, action_climax) are pinned with task 6.4, once her death scene is rewritten.
  ['cook', 'sequence:intro_shift_change', ['walk', 'typing', 'offer_mug']],
  ['cook', 'sequence:quiet_restore', ['walk']],
  ['ruiz', 'sequence:intro_shift_change', ['walk', 'arms_out', 'idle']],
  ['sung', 'sequence:intro_shift_change', ['walk']],
  ['sung', 'sequence:rounds', ['walk']],
  ['heins', 'level:R03', ['idle_crossed']],
  ['hale', 'sequence:rounds', ['talk_gesture', 'idle_hips']],
  ['voss', 'level:R04', ['typing']],
];

function requests(): MotionRequest[] {
  const speakers = speakerLooks();
  return gatherRequests(readLevel('slice01') as never, sequences(), TASKS, new Set(Object.keys(NAMED)), SQUAD_LOOKS, {
    speakerOf: (line) => speakers.get(line),
    behaviours: SQUAD_BEHAVIOURS,
  });
}

test('cast motion coverage: every named character has a profile and every request names a real pose', () => {
  const problems = checkCoverage(sharedMotionProfiles(), NAMED, requests(), poseExists, OWN_MOTION_LANDED, SCENE_VARIANTS, clipExists);
  assert.deepEqual(problems, []);
});

// overhaul-priya-r08-death task 11.2: Priya's panicked run (her `jog` during `sec_glass`, whose opening cutscene is her run
// since task 20.1) and her one-shot stumble.
test('Priya has her own panicked run for the R06 run and a one-shot stumble clip', () => {
  const file = sharedMotionProfiles();
  const priya = file.profiles['priya']!;
  assert.equal(priya.variants?.['run']?.clips?.jog, 'priya_run');
  assert.deepEqual(priya.variants?.['run']?.when, { sequence: 'sec_glass' });
  assert.ok(clipExists('priya', 'priya_run'), 'the run is in her pack');
  assert.ok(clipExists('priya', 'priya_stumble'), 'the stumble is in her pack');
  const req = requests().filter((r) => r.look === 'priya' && r.pose === 'clip:priya_stumble');
  assert.ok(req.length >= 1 && req.every((r) => r.source === 'sequence:action_security'), 'the sec_glass run asks for the stumble');
  assert.equal(checkCoverage(file, NAMED, req, poseExists, OWN_MOTION_LANDED, {}, clipExists).length, 0);
  assert.equal(checkCoverage(file, NAMED, [{ ...req[0]!, pose: 'clip:nope' }], poseExists, OWN_MOTION_LANDED, {}, clipExists).length, 1, 'a missing clip is reported');
});

test('cast motion coverage: every pose a profile or scene variant swaps in is an authored pose', () => {
  const missing: string[] = [];
  for (const [id, prof] of Object.entries(sharedMotionProfiles().profiles)) {
    const layers = [['', prof.poses], ...Object.entries(prof.variants ?? {}).map(([vid, v]) => [`:${vid}`, v.poses] as const)] as const;
    for (const [where, poses] of layers) {
      for (const [from, to] of Object.entries(poses ?? {})) {
        if (!poseExists(from)) missing.push(`${id}${where}: swaps unknown pose "${from}"`);
        if (!poseExists(to)) missing.push(`${id}${where}: swaps in unknown pose "${to}"`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('cast motion coverage: every row of the D11 scene table is gathered, with spoken lines and no corpse poses', () => {
  const reqs = requests();
  const has = (look: string, source: string, pose: string): boolean => reqs.some((r) => r.look === look && r.source === source && r.pose === pose);
  for (const [look, source, poses] of D11_ROWS) for (const pose of poses) assert.ok(has(look, source, pose), `${source} asks ${look} for ${pose}`);
  for (const look of ['giles', 'okafor', 'priya', 'hale', 'cook']) assert.ok(reqs.some((r) => r.look === look && r.pose === 'talk'), `${look} speaks in a sequence`);
  assert.ok(!reqs.some((r) => r.pose.startsWith('corpse')), 'corpse poses are not living motion');
});

test('cast motion coverage: a landed character fails when one of its D11 scene variants is removed', () => {
  const base = sharedMotionProfiles();
  const clips = { idle: 'idle', talk: 'idle_talk', walk: 'walk', work: 'kneel_fix', drink: 'idle', aimPistol: 'pistol_idle' };
  const holds = { stand: 'idle', lean_back: 'idle', crouch: 'idle', kneel: 'idle' };
  const variants = Object.fromEntries(
    SCENE_VARIANTS['giles']!.map((id) => [id, { when: id === 'reveal' ? { stage: [4, 4] as [number, number] } : { flag: id } }]),
  );
  const giles = { ...base.profiles['giles']!, clips, holds, variants };
  const landed: MotionProfileFile = { ...base, profiles: { ...base.profiles, giles } };
  const reqs = requests().filter((r) => r.look === 'giles');
  const own = new Set(['giles']);
  assert.deepEqual(checkCoverage(landed, NAMED, reqs, poseExists, own, SCENE_VARIANTS), []);
  for (const id of SCENE_VARIANTS['giles']!) {
    const { [id]: _drop, ...rest } = variants;
    const without: MotionProfileFile = { ...landed, profiles: { ...landed.profiles, giles: { ...giles, variants: rest } } };
    const problems = checkCoverage(without, NAMED, reqs, poseExists, own, SCENE_VARIANTS);
    assert.ok(problems.some((p) => p.look === 'giles' && p.message.includes(`"${id}" scene variant`)), `removing ${id} fails`);
  }
});

test('cast motion coverage: the slice asks something of every named character', () => {
  const asked = new Set(requests().map((r) => r.look));
  for (const look of Object.keys(NAMED)) {
    if (look === 'bram') continue; // Bram appears through his level look `cook`
    assert.ok(asked.has(look), `${look} is asked to do something`);
  }
  const giles = requests().filter((r) => r.look === 'giles').map((r) => r.pose);
  for (const p of ['rub_forearm', 'lean_back_mug', 'panel_work', 'typing', 'walk']) assert.ok(giles.includes(p), `Giles is asked for ${p}`);
});

test('cast motion coverage: a named character without a profile fails and is named', () => {
  const file = sharedMotionProfiles();
  const { priya: _drop, ...profiles } = file.profiles;
  const without: MotionProfileFile = { ...file, profiles };
  const problems = checkCoverage(without, NAMED, requests(), poseExists, OWN_MOTION_LANDED);
  assert.ok(problems.some((p) => p.look === 'priya' && /no motion profile/.test(p.message)));
});

test('cast motion coverage: a landed character must cover every request with its own profile', () => {
  const file = sharedMotionProfiles();
  const { clips: _c, holds: _h, style: _s, variants: _v, ...plain } = file.profiles['hale']!;
  const bare: MotionProfileFile = { ...file, profiles: { ...file.profiles, hale: plain } };
  const problems = checkCoverage(bare, NAMED, requests(), poseExists, new Set(['hale']), undefined, clipExists);
  assert.ok(problems.length > 0 && problems.every((p) => p.look === 'hale'), 'with no clips of his own, Hale\'s requests fall through');
  assert.deepEqual(needFor('lean_back_mug_drink'), { kind: 'activity', activity: 'drink' });
  assert.deepEqual(needFor('sit_chair_glance'), { kind: 'hold', family: 'sit_chair' });
  assert.deepEqual(needFor('rub_forearm'), { kind: 'pose', pose: 'rub_forearm' });
});

test('cast motion coverage: scene variants count where their sequence or task asks', () => {
  const base = sharedMotionProfiles();
  const reqs = requests().filter((r) => r.look === 'ruiz');
  const covered: MotionProfileFile = {
    ...base,
    profiles: {
      ...base.profiles,
      ruiz: {
        // No holds: a stand hold would cover the plain `arms_out` pose on its own.
        gender: 'f',
        inherits: 'crew_f',
        clips: { idle: 'idle', walk: 'walk', talk: 'idle_talk' },
        variants: { checkpoint: { when: { sequence: 'intro_shift_change' }, poses: { arms_out: 'arms_out' } } },
      },
    },
  };
  assert.deepEqual(checkCoverage(covered, NAMED, reqs, poseExists, new Set(['ruiz'])), [], 'everyday clips plus the checkpoint variant cover Ruiz');
  const { checkpoint: _drop, ...noVariant } = covered.profiles['ruiz']!.variants!;
  const without: MotionProfileFile = { ...covered, profiles: { ...covered.profiles, ruiz: { ...covered.profiles['ruiz']!, variants: noVariant } } };
  const problems = checkCoverage(without, NAMED, reqs, poseExists, new Set(['ruiz']));
  assert.ok(problems.some((p) => p.message.includes('"arms_out"')), 'removing the variant fails on the pose it covered');
});
