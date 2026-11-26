// game-pause: the title card and the access hint last their seconds of play, not of real time.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Interactions } from '../actors/interaction.ts';
import type { Player } from '../actors/player.ts';
import { SceneTimers } from '../core/sceneTimers.ts';
import { PlayerHud } from './hud/playerHud.ts';
import { TitleCard } from './titleCard.ts';

interface FakeEl {
  hidden: boolean;
  style: Record<string, unknown>;
  children: FakeEl[];
  [key: string]: unknown;
}

function element(): FakeEl {
  const e: FakeEl = {
    hidden: false,
    textContent: '',
    className: '',
    dataset: {},
    style: { setProperty: () => {} },
    children: [],
    classList: { toggle: () => {} },
    append: (...c: FakeEl[]) => void e.children.push(...c),
    replaceChildren: (...c: FakeEl[]) => void (e.children = c),
    setAttribute: () => {},
    remove: () => {},
  };
  return e;
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = { createElement: element, createElementNS: element, createTextNode: element };
  t.after(() => void (g.document = prev));
  const timers = new SceneTimers();
  const play = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) timers.update(1 / 60);
  };
  /** Real time with the scene frozen: no step runs. */
  const pause = (seconds: number): void => t.mock.timers.tick(seconds * 1000);
  return { timers, play, pause };
}

test('a title card keeps its remaining time through a pause', (t) => {
  const { timers, play, pause } = setup(t);
  const parent = element();
  const card = new TitleCard(parent as unknown as HTMLElement, timers);
  const root = parent.children[0]!;
  card.show('Section 07', '', 5);
  play(3);
  pause(60);
  assert.equal(root.style['opacity'], '1');
  play(1.9);
  assert.equal(root.style['opacity'], '1');
  play(0.2);
  assert.equal(root.style['opacity'], '0');
});

test('a title card goes at once when the moment is left', (t) => {
  const { timers } = setup(t);
  const parent = element();
  new TitleCard(parent as unknown as HTMLElement, timers).show('Section 07', '', 5);
  timers.clear();
  assert.equal(parent.children[0]!.style['opacity'], '0');
});

test('an access hint keeps its remaining time through a pause, and hiding the HUD does not end it', (t) => {
  const { timers, play, pause } = setup(t);
  const root = element();
  const hud = new PlayerHud(root as unknown as HTMLElement, element() as unknown as HTMLElement, 'KeyE', timers);
  const hint = root.children.find((c) => c['className'] === 'access-hint')!;
  const player = { grabProgress: null, vitals: { hp: 100 }, stamina: 1, isExhausted: false, downed: false, alive: true } as unknown as Player;
  const frame = (): void => hud.update(player, { focus: null } as unknown as Interactions);
  hud.showHint({ key: 'k', text: 'Locked', parts: [{ text: 'Locked' }] }, 4);
  play(3);
  hud.hide();
  pause(60);
  frame();
  assert.equal(hint.hidden, false, 'still there on resume');
  play(0.9);
  frame();
  assert.equal(hint.hidden, false);
  play(0.2);
  frame();
  assert.equal(hint.hidden, true);
});
