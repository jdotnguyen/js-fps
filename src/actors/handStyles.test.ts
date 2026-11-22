import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctx } from '../ai/enemyTestKit.ts';
import { CAST } from './castLooks.ts';
import { Humanoid } from './humanoid.ts';
import { HandPhysicsSolver } from './handPhysics.ts';
import { sharedMotionProfiles } from './motionProfiles.ts';
import { GILES, OKAFOR } from './squadLooks.ts';

const NAMED = ['giles', 'okafor', 'priya', 'voss', 'bram', 'ruiz', 'heins', 'hale', 'sung'];

test('hands: every named character has hands of their own, and no two share them', () => {
  const file = sharedMotionProfiles();
  const seen = new Map<string, string>();
  for (const id of NAMED) {
    const h = file.profiles[id]?.hands;
    assert.ok(h, `${id} has hands`);
    const key = JSON.stringify([h.tension, h.stiffness, h.fidget, h.restCurl]);
    assert.ok(!seen.has(key), `${id} shares hands with ${seen.get(key)}`);
    seen.set(key, id);
  }
  // The four that existed before move over unchanged.
  assert.deepEqual(file.profiles['okafor']!.hands, { tension: 0.24, stiffness: 0.92, fidget: 0.18, restCurl: 0.42 });
  assert.equal(file.profiles['hale']!.hands!.fidget, 0.68);
});

test('hands: bodies use their profile hands; Hale fidgets more and rests tighter than Okafor', () => {
  const solver = (h: Humanoid): HandPhysicsSolver => h['handPhysics'];
  const hale = new Humanoid({ ...CAST['hale']!, role: 'npc' }, ctx());
  const okafor = new Humanoid({ ...OKAFOR, role: 'npc' }, ctx());
  assert.ok(solver(hale).personality.fidget > solver(okafor).personality.fidget);
  assert.ok(solver(hale).personality.restCurl > solver(okafor).personality.restCurl);
});

test("hands: Giles's twitch rises with each stage", () => {
  // Drive the solver's twitch through a short window per stage and count sharp finger jerks in its curl targets.
  const twitchAt = (stage: number): number => {
    const s = new HandPhysicsSolver('august-giles', [], new Map(), { tension: 0.58, stiffness: 1.08, fidget: 0.48, restCurl: 0.56, twitch: 1 });
    s.twitchStage = stage;
    const p = s.personality;
    let sum = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      for (let fi = 0; fi < 5; fi++) {
        const rate = (0.9 + fi * 0.37) * (1 + stage * 0.6);
        const tw = (p.twitch ?? 0) * Math.min(1, stage / 3);
        sum += Math.pow(Math.max(0, Math.sin(t * rate + fi * 2.9)), 10 + stage * 6) * 0.32 * tw;
      }
    }
    return sum;
  };
  assert.equal(twitchAt(0), 0, 'no twitch at stage 0');
  assert.ok(twitchAt(2) > twitchAt(1) && twitchAt(3) > twitchAt(2) * 0.9, 'more twitch each stage');
  const giles = new Humanoid({ ...GILES, role: 'npc' }, ctx());
  giles.setHandTwitchStage(3);
  assert.equal((giles['handPhysics'] as HandPhysicsSolver).twitchStage, 3);
  assert.equal((giles['handPhysics'] as HandPhysicsSolver).personality.twitch, 1);
});
