import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { StationPhase } from '../audio/ambience.ts';
import { AMBIENT_PA_CHANNEL, AmbientPaDirector, type AmbientPaHost } from './ambientPa.ts';

const paJson = JSON.parse(readFileSync(new URL('../data/dialogue/ambient_pa.json', import.meta.url), 'utf8')) as {
  lines: Array<{ id: string; priority: string; channel: string }>;
};
const MORNING = paJson.lines.filter((l) => l.id.startsWith('amb_pa_morning_')).map((l) => l.id);
const DARK = paJson.lines.filter((l) => l.id.startsWith('amb_pa_dark_')).map((l) => l.id);

function setup(init: { phase?: StationPhase; grilleDist?: number | null } = {}) {
  const state = {
    phase: (init.phase ?? 'morning') as StationPhase,
    introOver: true,
    free: true,
    combat: false,
    room: 'R14b' as string | null,
    scene: false,
    higher: false,
    overheard: false,
    grilleDist: init.grilleDist === undefined ? 5 : init.grilleDist,
  };
  const said: Array<[string, string]> = [];
  const stopped: string[] = [];
  const host: AmbientPaHost = {
    say: (id, ch) => void said.push([id, ch]),
    stop: (id) => void stopped.push(id),
    ready: () => true,
    phase: () => state.phase,
    introOver: () => state.introOver,
    freeControl: () => state.free,
    inCombat: () => state.combat,
    playerRoom: () => state.room,
    sceneRunning: () => state.scene,
    higherSpeech: () => state.higher,
    overheardRunning: () => state.overheard,
    grilleDistance: () => state.grilleDist,
  };
  const dir = new AmbientPaDirector({ morning: MORNING, dark: DARK }, host);
  return { dir, state, said, stopped };
}

test('ambient_pa.json uses background priority on the pa channel', () => {
  assert.ok(MORNING.length >= 8);
  assert.ok(DARK.length >= 6);
  for (const l of paJson.lines) {
    assert.equal(l.channel, 'pa');
    assert.equal(l.priority, 'background');
  }
});

test('AmbientPaDirector plays non-repeating morning notices near a grille and switches to dark notices after drop', () => {
  const g = setup();
  for (let i = 0; i < 80; i++) g.dir.update(1);
  assert.equal(g.said.length, 1);
  assert.equal(g.said[0]![1], AMBIENT_PA_CHANNEL);
  assert.ok(MORNING.includes(g.said[0]![0]));
  g.dir.lineOver(g.said[0]![0]);

  // Next firing picks a different morning notice.
  for (let i = 0; i < 160; i++) g.dir.update(1);
  assert.equal(g.said.length, 2);
  assert.notEqual(g.said[1]![0], g.said[0]![0]);

  // Crossing into blackout stops any active morning line and switches exclusively to dark pool.
  g.state.phase = 'blackout';
  g.dir.update(1);
  assert.equal(g.stopped.length, 1);
  for (let i = 0; i < 110; i++) g.dir.update(1);
  assert.equal(g.said.length, 3);
  assert.ok(DARK.includes(g.said[2]![0]), 'post-drop draws only from degraded automated warnings');
});

test('AmbientPaDirector skips when no PA grille is nearby and cuts off on higher speech or combat', () => {
  const far = setup({ grilleDist: 20 });
  for (let i = 0; i < 120; i++) far.dir.update(1);
  assert.equal(far.said.length, 0, 'skips when beyond 12 m of any PA grille');

  const g = setup();
  for (let i = 0; i < 80; i++) g.dir.update(1);
  assert.ok(g.dir.current !== null);
  g.state.higher = true;
  g.dir.update(0.1);
  assert.equal(g.dir.current, null);
  assert.equal(g.stopped.length, 1);
});
