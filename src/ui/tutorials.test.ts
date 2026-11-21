import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../core/storage.ts';
import { mergeSettings } from '../core/settings.ts';
import type { Action } from '../data/types/keymap.ts';
import keymap from '../data/keymap.json' with { type: 'json' };
import {
  describeHint,
  describePrompt,
  PROFILE_KEY,
  PROMPTS,
  TutorialProfile,
  TutorialQueue,
  type PromptId,
  type TutorialMode,
  type TutorialStepInput,
} from './tutorials.ts';

const bindings = (a: Action): readonly string[] => (keymap as Record<string, string[]>)[a] ?? [];
const idle: TutorialStepInput = { onRails: false, pressed: () => false, looked: false };
const press = (...actions: Action[]): TutorialStepInput => ({ ...idle, pressed: (a) => actions.includes(a) });

function setup(mode: TutorialMode = 'first', store = memoryStore()) {
  const profile = new TutorialProfile(store);
  let m = mode;
  const q = new TutorialQueue(profile, () => m, bindings);
  return { q, profile, store, setMode: (v: TutorialMode) => (m = v) };
}

/** Trigger every pop-up and dismiss each with its own action; returns the ids shown. */
function playThrough(q: TutorialQueue): string[] {
  const shown: string[] = [];
  const dismissWith: Record<PromptId, TutorialStepInput> = {
    move: press('moveForward'),
    look: { ...idle, looked: true },
    wayfinding: press('objective'),
    interact: press('interact'),
    flashlight: press('flashlight'),
    combat: press('fire'),
  };
  q.newRun();
  for (const id of ['move', 'interact', 'flashlight', 'combat'] as const) q.trigger(id);
  for (let i = 0; i < 40; i++) {
    const cur = q.current;
    const r = q.step(1 / 60, cur ? dismissWith[cur.id] : idle);
    if (r.opened) shown.push(r.opened.id);
  }
  return shown;
}

test('fresh profile: each pop-up fires once, Look follows Move, Wayfinding follows Look', () => {
  const { q } = setup();
  assert.deepEqual(playThrough(q), ['move', 'look', 'wayfinding', 'interact', 'flashlight', 'combat']);
  q.trigger('interact');
  assert.equal(q.step(0.016, idle).opened, null, 'a repeat trigger in the same run does nothing');
});

test('wayfinding spotlight prompt dismisses on click or Tab/Space, ignores Esc/pause, and marks seen', () => {
  const { q, profile } = setup();
  q.trigger('wayfinding');
  const opened = q.step(0.016, idle).opened;
  assert.equal(opened?.id, 'wayfinding');
  assert.equal(opened?.spotlight, true);
  assert.equal(q.step(0.016, press('pause')).dismissed, null, 'Esc/pause does not dismiss');
  assert.equal(q.step(0.016, { ...idle, clicked: true }).dismissed?.id, 'wayfinding');
  assert.ok(profile.has('wayfinding'));
});

test("'first': a second run (new game, same profile) shows none", () => {
  const store = memoryStore();
  playThrough(setup('first', store).q);
  // New session: profile read back from storage.
  const { q } = setup('first', store);
  assert.deepEqual(playThrough(q), []);
  assert.ok(store.get(PROFILE_KEY)?.includes('tutorialsSeen'));
});

test("'off' shows none, 'always' shows all every run", () => {
  assert.deepEqual(playThrough(setup('off').q), []);
  const store = memoryStore();
  playThrough(setup('first', store).q);
  const { q } = setup('always', store);
  const all = ['move', 'look', 'wayfinding', 'interact', 'flashlight', 'combat'];
  assert.deepEqual(playThrough(q), all);
  assert.deepEqual(playThrough(q), all);
});

test('only the named action dismisses (Esc / pause and other keys do not)', () => {
  const { q } = setup();
  q.trigger('flashlight');
  assert.equal(q.step(0.016, idle).opened?.id, 'flashlight');
  for (const other of ['pause', 'interact', 'fire', 'moveForward', 'skipCutscene'] as const) {
    assert.equal(q.step(0.016, press(other)).dismissed, null, `${other} must not dismiss`);
  }
  assert.equal(q.step(0.016, { ...idle, looked: true }).dismissed, null);
  assert.ok(q.blocking);
  assert.equal(q.step(0.016, press('flashlight')).dismissed?.id, 'flashlight');
  assert.ok(!q.blocking);
});

test('the dismissing step opens nothing, so the press reaches the game', () => {
  const { q } = setup();
  q.trigger('move');
  q.step(0.016, idle);
  const r = q.step(0.016, press('moveLeft'));
  assert.equal(r.dismissed?.id, 'move');
  assert.equal(r.opened, null);
  assert.ok(!q.blocking);
  assert.equal(q.step(0.016, idle).opened?.id, 'look');
});

test('queued while on rails, shown once control returns', () => {
  const { q } = setup();
  q.trigger('interact');
  for (let i = 0; i < 30; i++) assert.equal(q.step(0.016, { ...idle, onRails: true }).opened, null);
  assert.ok(!q.blocking);
  assert.equal(q.step(0.016, idle).opened?.id, 'interact');
});

test('a pop-up is not marked seen until dismissed; reset forgets seen', () => {
  const store = memoryStore();
  const a = setup('first', store);
  a.q.trigger('combat');
  a.q.step(0.016, idle);
  assert.ok(!a.profile.has('combat'));
  a.q.step(0.016, press('reload'));
  assert.ok(a.profile.has('combat'), 'reload also dismisses Fire / Reload');
  a.q.reset();
  const b = setup('first', store);
  assert.ok(!b.profile.has('combat'));
  b.q.trigger('combat');
  assert.equal(b.q.step(0.016, idle).opened?.id, 'combat');
});

test('text uses the current binding, never a hardcoded key', () => {
  const remapped = (a: Action): readonly string[] => (a === 'interact' ? ['KeyG'] : a === 'fire' ? ['Mouse0'] : bindings(a));
  assert.equal(describePrompt(PROMPTS.interact, remapped).sentence, 'Interact. Press G to use what you are looking at.');
  assert.deepEqual(describePrompt(PROMPTS.move, bindings).groups[0]?.keys, ['W', 'A', 'S', 'D']);
  assert.equal(describePrompt(PROMPTS.look, bindings).groups[0]?.text, 'Move the mouse to look around.');
  assert.equal(describePrompt(PROMPTS.combat, remapped).sentence, 'Fire / Reload. Press LMB to fire. Press R to reload.');
});

test('hints do not block, hide after use, and skip unbound actions', () => {
  const { q } = setup();
  assert.ok(q.triggerHint('sprint'));
  assert.ok(!q.triggerHint('crouch'), 'no crouch binding yet');
  assert.ok(!q.triggerHint('nonsense'));
  assert.equal(q.step(0.016, { ...idle, onRails: true }).hintShown, null);
  assert.equal(q.step(0.016, idle).hintShown?.action, 'sprint');
  assert.ok(!q.blocking);
  assert.equal(q.step(0.016, press('sprint')).hintHidden?.action, 'sprint');
  assert.equal(describeHint({ id: 'hint:sprint', action: 'sprint', title: 'Sprint', verb: 'sprint', hold: true }, bindings)?.text, 'Hold Shift to sprint.');
});

test('setting tutorialPrompts defaults to first and rejects unknown values', () => {
  assert.equal(mergeSettings({}).tutorialPrompts, 'first');
  assert.equal(mergeSettings({ tutorialPrompts: 'always' }).tutorialPrompts, 'always');
  assert.equal(mergeSettings({ tutorialPrompts: 'sometimes' }).tutorialPrompts, 'first');
});

test('a damaged profile shows tutorials again instead of failing', () => {
  const store = memoryStore();
  store.set(PROFILE_KEY, '{nope');
  const { q } = setup('first', store);
  q.trigger('move');
  assert.equal(q.step(0.016, idle).opened?.id, 'move');
});
