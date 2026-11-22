import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedMocapLibrary } from './mocap.ts';
import {
  ACTIVITIES,
  NEUTRAL_CLIPS,
  postureFamily,
  resolveProfile,
  sharedMotionProfiles,
  validateMotionProfiles,
  type MotionProfileFile,
} from './motionProfiles.ts';
import priyaPack from '../data/mocap/priya.json' with { type: 'json' };
import vossPack from '../data/mocap/voss.json' with { type: 'json' };
import bramPack from '../data/mocap/bram.json' with { type: 'json' };
import ruizPack from '../data/mocap/ruiz.json' with { type: 'json' };
import heinsPack from '../data/mocap/heins.json' with { type: 'json' };
import halePack from '../data/mocap/hale.json' with { type: 'json' };
import sungPack from '../data/mocap/sung.json' with { type: 'json' };

// Named characters with clip packs (Priya) need them loaded, as the game does at start (loadMocapPacks). Node needs the JSON
// import attribute, which the bundler's lazy pack import cannot carry, so tests add the pack directly.
sharedMocapLibrary().addPack('priya', priyaPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('voss', vossPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('bram', bramPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('ruiz', ruizPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('heins', heinsPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('hale', halePack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
sharedMocapLibrary().addPack('sung', sungPack as unknown as Parameters<ReturnType<typeof sharedMocapLibrary>['addPack']>[1]);
for (const p of ['priya', 'voss', 'bram', 'ruiz', 'heins', 'hale', 'sung']) sharedMocapLibrary().retainPack(p); // held for the whole file: test bodies come and go

const base = (): Record<string, unknown> => ({
  defaults: { m: 'crew_m', f: 'crew_f' },
  profiles: { crew_m: { gender: 'm' }, crew_f: { gender: 'f' } },
});

function rejects(file: unknown, re: RegExp): void {
  assert.throws(() => validateMotionProfiles(file, 'profiles'), re);
}

test('motion profile table: the game table validates', () => {
  const file = sharedMotionProfiles();
  assert.equal(file.profiles[file.defaults.m]!.gender, 'm');
  assert.equal(file.profiles[file.defaults.f]!.gender, 'f');
});

test('motion profile table: malformed profiles are rejected', () => {
  const unknownActivity = base();
  (unknownActivity['profiles'] as Record<string, unknown>)['x'] = { gender: 'm', clips: { moonwalk: 'walk' } };
  rejects(unknownActivity, /unknown activity "moonwalk"/);

  const unknownFamily = base();
  (unknownFamily['profiles'] as Record<string, unknown>)['x'] = { gender: 'm', holds: { hammock: 'idle' } };
  rejects(unknownFamily, /unknown posture family "hammock"/);

  const unknownParent = base();
  (unknownParent['profiles'] as Record<string, unknown>)['x'] = { gender: 'm', inherits: 'nobody' };
  rejects(unknownParent, /unknown profile "nobody"/);

  const missingGender = base();
  (missingGender['profiles'] as Record<string, unknown>)['x'] = { clips: { walk: 'walk' } };
  rejects(missingGender, /gender/);

  const loop = base();
  Object.assign(loop['profiles'] as Record<string, unknown>, { a: { gender: 'm', inherits: 'b' }, b: { gender: 'm', inherits: 'a' } });
  rejects(loop, /inheritance loop/);

  const wrongDefault = base();
  (wrongDefault['defaults'] as Record<string, unknown>)['f'] = 'crew_m';
  rejects(wrongDefault, /gender "m"/);
});

function table(): MotionProfileFile {
  return validateMotionProfiles(
    {
      defaults: { m: 'crew_m', f: 'crew_f' },
      profiles: {
        crew_m: { gender: 'm', clips: { idle: 'idle_talk' }, style: { tempo: 1.1 } },
        crew_f: { gender: 'f', clips: { walk: 'walk_formal' } },
        hero: { gender: 'f', inherits: 'crew_f', clips: { jog: 'zombie_walk', idle: 'no_such_clip_a' }, style: { fidgetRate: 2 } },
      },
    },
    'test',
  );
}

test('profile resolution: character, then gendered default, then neutral; one warning per missing clip', () => {
  const lib = sharedMocapLibrary();
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(msg);
  try {
    const hero = resolveProfile(lib, table(), 'hero', 'm');
    assert.equal(hero.gender, 'f', "a named profile's own gender wins over the body's");
    assert.equal(hero.clips.jog, 'zombie_walk', 'own clip');
    assert.equal(hero.clips.walk, 'walk_formal', 'gendered default fills what the profile leaves out');
    assert.equal(hero.clips.idle, NEUTRAL_CLIPS.idle, 'a missing clip falls through to the neutral clip');
    assert.equal(hero.style.fidgetRate, 2);
    assert.equal(hero.style.tempo, 1, 'the masculine default does not leak into a feminine chain');
    assert.ok(hero.ownClips);
    resolveProfile(lib, table(), 'hero', 'm');
    assert.equal(warnings.filter((w) => w.includes('no_such_clip_a')).length, 1, 'one warning per missing clip');

    const crew = resolveProfile(lib, table(), undefined, 'm');
    assert.equal(crew.profile, 'crew_m');
    assert.equal(crew.clips.idle, 'idle_talk');
    assert.equal(crew.style.tempo, 1.1);
    assert.equal(crew.ownClips, false, 'defaults never count as own clips');

    const unknown = resolveProfile(lib, table(), 'ghost', 'f');
    assert.equal(unknown.profile, 'crew_f', 'an unknown profile falls back to the gendered default');
    assert.equal(warnings.filter((w) => w.includes('"ghost"')).length, 1);

    for (const a of ACTIVITIES) assert.ok(lib.has(hero.clips[a]), `${a} resolves to a clip the library has`);
  } finally {
    console.warn = warn;
  }
});

test('profile resolution: formal crew walk unless a profile names a walk (the default walk pools give way to it)', () => {
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();
  assert.equal(resolveProfile(lib, file, undefined, 'm', true).clips.walk, 'walk_formal');
  assert.equal(resolveProfile(lib, file, undefined, 'm', true, undefined, false, 0.9).clips.walk, 'walk_formal');
  assert.match(resolveProfile(lib, file, undefined, 'm', true).clips.jog, /^crew_m_jog_/, 'formal crew still run from the pool');
  assert.equal(resolveProfile(lib, file, undefined, 'm').clips.walk, 'crew_m_walk_a', 'no pick: the first take');
});

test('posture families group authored pose variants', () => {
  assert.equal(postureFamily('lean_back_mug_drink'), 'lean_back');
  assert.equal(postureFamily('sit_chair_glance_other'), 'sit_chair');
  assert.equal(postureFamily('sit_stool'), 'sit_stool');
  assert.equal(postureFamily('kneel_revive'), 'kneel');
  assert.equal(postureFamily('crouchWork'), 'crouch');
  assert.equal(postureFamily('typing'), null);
});

test('profile uniqueness: a named character with clips of its own shares its idle, talk and walk with no other named character', () => {
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();
  const defaults = new Set(Object.values(file.defaults));
  const named = Object.keys(file.profiles).filter((id) => !defaults.has(id));
  const resolved = new Map(named.map((id) => [id, resolveProfile(lib, file, id, file.profiles[id]!.gender)]));
  let landed = 0;
  for (const a of named) {
    for (const slot of ['idle', 'talk', 'walk'] as const) {
      // Own clip: a capture baked for this character (`giles_walk`) that the library has. Characters still on today's shared
      // clips (tasks 6.x) are skipped until theirs land.
      if (!resolved.get(a)!.clips[slot].startsWith(`${a}_`)) continue;
      landed++;
      for (const b of named) {
        if (b !== a) assert.notEqual(resolved.get(b)!.clips[slot], resolved.get(a)!.clips[slot], `${a} and ${b} share their ${slot} clip`);
      }
    }
  }
  assert.ok(landed >= 3, 'at least one character has an idle, talk and walk of its own');
});

test('Giles\'s scene variants: each applies only in its own scene, task or stage', () => {
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();
  const scene = (o: { sequences?: string[]; task?: string | null; stage?: number }) => ({
    sequences: new Set(o.sequences ?? []),
    task: o.task ?? null,
    stage: o.stage ?? 0,
    flag: () => false,
  });
  const at = (o: Parameters<typeof scene>[0]) => resolveProfile(lib, file, 'giles', 'm', false, scene(o));
  const everyday = at({});
  assert.deepEqual(everyday.variants, []);
  assert.equal(everyday.holds.lean_back, 'giles_hold');
  assert.equal(everyday.holds.crouch, 'giles_hold');
  assert.equal(at({ sequences: ['intro_shift_change'] }).holds.lean_back, 'giles_coffee', 'intro: the kitchen coffee hold');
  for (const task of ['bypass', 'bypass_short', 'bypass_long', 'unlock_locker']) {
    assert.equal(at({ task }).holds.crouch, 'giles_panel', `${task}: panel work`);
  }
  assert.equal(at({ task: 'power_restore' }).style.headPitch, 10, 'console: head down over the console');
  assert.equal(at({ task: 'reroute' }).variants[0], 'console');
  assert.equal(at({ task: 'biometric' }).variants.length, 0, 'someone else\'s task changes nothing');
  for (const stage of [0, 1, 2, 3]) assert.ok(!at({ stage }).variants.includes('reveal'), `no reveal at stage ${stage}`);
  const reveal = at({ stage: 4 });
  assert.deepEqual(reveal.variants, ['reveal']);
  assert.equal(reveal.holds.stand, 'giles_reveal');
  assert.ok(reveal.style.posture < 0, 'slumped at the reveal');
  // Every clip his profile and variants name is in the library (nothing falls back).
  const named = [file.profiles['giles']!, ...Object.values(file.profiles['giles']!.variants ?? {})].flatMap((l) => [
    ...Object.values(l.clips ?? {}),
    ...Object.values(l.holds ?? {}),
  ]);
  for (const id of named) assert.ok(lib.has(id), `${id} is in the library`);
});

test('a variant condition can list several tasks or sequences; an empty list is rejected', () => {
  const ok = validateMotionProfiles(
    {
      ...base(),
      profiles: { ...(base().profiles as object), p: { gender: 'm', variants: { v: { when: { task: ['a', 'b'], sequence: 's' } } } } },
    },
    'profiles',
  );
  assert.deepEqual(ok.profiles['p']!.variants!['v']!.when.task, ['a', 'b']);
  rejects({ ...base(), profiles: { ...(base().profiles as object), p: { gender: 'm', variants: { v: { when: { task: [] } } } } } }, /non-empty list/);
});

test('Okafor\'s scene variants: intro coffee, console stillness and the revive apply only in their scene or task', () => {
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();
  const scene = (o: { sequences?: string[]; task?: string | null }) => ({ sequences: new Set(o.sequences ?? []), task: o.task ?? null, stage: 0, flag: () => false });
  const at = (o: Parameters<typeof scene>[0]) => resolveProfile(lib, file, 'okafor', 'm', false, scene(o));
  const everyday = at({});
  assert.deepEqual(everyday.variants, []);
  assert.equal(everyday.holds.kneel, 'okafor_hold', 'downed or kneeling without a revive: his ordinary hold, not the revive');
  assert.equal(at({ task: 'revive' }).holds.kneel, 'okafor_revive', 'reviving: kneeling with his hands working');
  assert.equal(at({ sequences: ['intro_shift_change'] }).holds.lean_back, 'okafor_coffee');
  assert.equal(at({ task: 'biometric' }).variants[0], 'console');
  assert.equal(at({ task: 'bypass' }).variants.length, 0, 'Giles\'s tasks change nothing for Okafor');
  assert.ok(everyday.style.tempo < 1 && everyday.style.fidgetRate < 1 && everyday.style.posture > 0, 'slow, still and upright');
  for (const id of Object.values(file.profiles['okafor']!.clips ?? {})) assert.ok(lib.has(id), `${id} is in the library`);
});

test('Heins, Hale and Sung (task 6.8): their own clips, Heins stiller at her post in the briefing, Hale more nervous on rounds', () => {
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();
  const scene = (sequences: string[] = []) => ({ sequences: new Set(sequences), task: null, stage: 0, flag: () => false });
  const at = (id: string, g: 'm' | 'f', seqs?: string[]) => resolveProfile(lib, file, id, g, false, scene(seqs));
  for (const [id, g] of [['heins', 'f'], ['hale', 'm'], ['sung', 'm']] as const) {
    const everyday = at(id, g);
    assert.deepEqual(everyday.variants, [], `${id} everyday`);
    for (const slot of ['idle', 'walk', 'jog'] as const) assert.equal(everyday.clips[slot], `${id}_${slot}`, `${id} ${slot}`);
    for (const clip of Object.values(file.profiles[id]!.clips ?? {})) assert.ok(lib.has(clip), `${clip} is in the library`);
  }
  // Heins: firm and upright; in the briefing and the drop, stiller still.
  const heins = at('heins', 'f');
  const post = at('heins', 'f', ['briefing_gallery']);
  assert.deepEqual(post.variants, ['post']);
  assert.deepEqual(at('heins', 'f', ['drop']).variants, ['post']);
  assert.ok(heins.style.posture > 0.3 && post.style.fidgetRate < heins.style.fidgetRate, 'upright, and stiller on her post');
  // Hale: talks with his own capture; quicker and more restless on rounds and in the briefing.
  const hale = at('hale', 'm');
  assert.equal(hale.clips.talk, 'hale_talk');
  for (const seq of ['rounds', 'briefing_gallery']) {
    const briefing = at('hale', 'm', [seq]);
    assert.deepEqual(briefing.variants, ['briefing'], seq);
    assert.ok(briefing.style.fidgetRate > hale.style.fidgetRate && briefing.style.tempo > hale.style.tempo, `${seq}: more nervous`);
  }
  assert.deepEqual(at('hale', 'm', ['intro_shift_change']).variants, [], 'other sequences leave him as he is');
  // Sung: heavy (slow tempo, wide arm carry) and no scene variants.
  const sung = at('sung', 'm', ['intro_shift_change', 'rounds']);
  assert.deepEqual(sung.variants, []);
  assert.ok(sung.style.tempo < 0.9 && sung.style.armCarry > 1.1, 'heavy');
});

test('profile pose swaps: Okafor glances his own way everywhere; others keep the shared glance', () => {
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();
  assert.equal(resolveProfile(lib, file, 'okafor', 'm').poses['glance'], 'okafor_glance');
  assert.equal(resolveProfile(lib, file, 'okafor', 'm').poses['glance_other'], 'okafor_glance_other');
  assert.equal(resolveProfile(lib, file, 'giles', 'm').poses['glance'], undefined);
  assert.equal(resolveProfile(lib, file, undefined, 'm').poses['glance'], undefined);
});

test('dock_guard motion binding: dock_guard resolves to his own relaxed low carry while another security crew NPC keeps the crew default', async () => {
  const { castSpec } = await import('./castLooks.ts');
  const { Humanoid } = await import('./humanoid.ts');
  const { ctx } = await import('../ai/enemyTestKit.ts');
  const lib = sharedMocapLibrary();
  const file = sharedMotionProfiles();

  const guardSpec = castSpec('security', 'dock_guard');
  const otherSpec = castSpec('security', 'security_patrol_2');
  assert.equal(guardSpec.profile, 'dock_guard');
  assert.equal(otherSpec.profile, undefined);

  const guardMotion = resolveProfile(lib, file, guardSpec.profile, 'm');
  const otherMotion = resolveProfile(lib, file, otherSpec.profile, 'm');
  assert.equal(guardMotion.profile, 'dock_guard');
  assert.equal(guardMotion.poses['idle_wand'], 'dock_guard_idle_wand');
  assert.equal(otherMotion.profile, 'crew_m');
  assert.equal(otherMotion.poses['idle_wand'], undefined);

  const guardBody = new Humanoid({ ...guardSpec, height: 1.78, role: 'npc', pose: 'idle_wand' }, ctx());
  const otherBody = new Humanoid({ ...otherSpec, height: 1.78, role: 'npc', pose: 'idle_wand' }, ctx());
  guardBody.update(1 / 30);
  otherBody.update(1 / 30);
  assert.equal(guardBody.poseName, 'dock_guard_idle_wand');
  assert.equal(guardBody.holding, 'wand');
  assert.equal(otherBody.poseName, 'idle_wand');
  assert.equal(otherBody.holding, 'wand');
  // Relaxed low carry: the guard's right hand rests lower (closer to thigh) than the raised default wand pose.
  const guardHandY = guardBody.jointWorld('hand_R').y;
  const otherHandY = otherBody.jointWorld('hand_R').y;
  assert.ok(guardHandY < otherHandY - 0.08, `dock_guard hand (${guardHandY.toFixed(3)} m) rests lower than default (${otherHandY.toFixed(3)} m)`);
});
