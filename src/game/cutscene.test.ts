import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneTimers } from '../core/sceneTimers.ts';
import { CutsceneController, type CutsceneDeps } from './cutscene.ts';

function setup() {
  const timers = new SceneTimers();
  const log: string[] = [];
  const noop = () => {};
  const input = { held: false, isDown: () => input.held, wasPressed: () => false };
  const cutscene = new CutsceneController({
    sequences: () => ({ skippable: true, skip: () => log.push('skip'), cancelAll: noop }),
    input,
    settings: { get: () => ({ skipHoldSeconds: 0.5, skipAssist: false, reducedMotion: false }) },
    player: { onRails: true, cancelWalk: noop },
    hud: { setFade: (v: number) => log.push(`fade:${v}`) },
    ui: { onActivity: () => noop, announce: noop, setBars: noop, setSkip: noop },
    skipKeyLabel: () => 'Space',
    timers,
  } as unknown as CutsceneDeps);
  /** One step of play as the session runs it; nothing steps while frozen. */
  const play = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      timers.update(1 / 60);
      cutscene.update(1 / 60);
    }
  };
  /** Hold the skip key until the fade out starts. */
  const holdSkip = (): void => {
    input.held = true;
    for (let i = 0; i < 120 && !log.includes('fade:1'); i++) play(1 / 60);
    input.held = false;
  };
  return { cutscene, log, play, holdSkip };
}

test('a skip counts play time: nothing happens while no step runs, and it finishes after', () => {
  const { log, play, holdSkip } = setup();
  holdSkip();
  play(0.2);
  assert.deepEqual(log, ['fade:1']);
  // Paused here: no steps, however long. Then play carries on.
  play(0.2);
  assert.deepEqual(log, ['fade:1'], '0.4 s into the 0.45 s fade out');
  play(0.1);
  assert.deepEqual(log, ['fade:1', 'skip', 'fade:0']);
});

test('cancelling the cutscene cancels a skip under way', () => {
  const { cutscene, log, play, holdSkip } = setup();
  holdSkip();
  cutscene.cancel();
  play(1);
  assert.deepEqual(log, ['fade:1']);
});
