import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchPlan } from './launch.ts';
import { SessionCoordinator, type SessionLifecycleHost } from './coordinator.ts';
import type { PlaySession } from './session.ts';
import { SAVE_VERSION, type SaveData } from '../game/save.ts';

test('parseLaunchPlan stays on title menu by default and auto-loads on debug/sandbox URLs', () => {
  const plain = parseLaunchPlan('');
  assert.equal(plain.autoLoad, null);
  assert.equal(plain.vmlab, false);
  assert.equal(plain.scratch, false);

  const memScratch = parseLaunchPlan('?slot=scratch&memprobe&nosplash');
  assert.equal(memScratch.autoLoad, null, 'scratch/memprobe/nosplash stay on title screen for cold-boot tests');
  assert.equal(memScratch.scratch, true);
  assert.equal(memScratch.memprobe, true);

  const jump = parseLaunchPlan('?level=slice01&debug&jump=r11');
  assert.ok(jump.autoLoad);
  assert.equal(jump.autoLoad.levelParam, 'slice01');
  assert.equal(jump.autoLoad.jump, 'r11');

  const sandbox = parseLaunchPlan('?level=lab');
  assert.ok(sandbox.autoLoad);
  assert.equal(sandbox.autoLoad.levelParam, 'lab');

  const enemies = parseLaunchPlan('?enemies=shambler:2');
  assert.ok(enemies.autoLoad);
  assert.equal(enemies.autoLoad.enemies, 'shambler:2');

  const vmlab = parseLaunchPlan('?vmlab');
  assert.equal(vmlab.vmlab, true);
});

test('SessionCoordinator manages title -> load -> play -> quit-to-title disposal and error recovery', async () => {
  const log: string[] = [];
  let sessionSeq = 0;
  let shouldFail = false;

  const host: SessionLifecycleHost = {
    showTitleBackdrop: () => log.push('backdrop:show'),
    hideTitleBackdrop: () => log.push('backdrop:hide'),
    showTitleMenu: () => log.push('menu:title'),
    hideMenu: () => log.push('menu:hide'),
    showLoading: (title) => log.push(`loading:show:${title}`),
    hideLoading: async () => {
      log.push('loading:hide');
    },
    showLoadError: (msg, onBack) => {
      log.push(`loading:error:${msg}`);
      onBack();
    },
    setTitleMusic: () => log.push('music:title'),
    createSession: async (intent) => {
      if (shouldFail) throw new Error('missing level');
      const id = ++sessionSeq;
      log.push(`session:create:${id}:${intent.kind}`);
      const fake: PlaySession = {
        levelId: 'slice01',
        game: {
          slot: 0,
          difficulty: 'standard',
          playTime: 0,
          location: 'Docking Ring',
          newGame: () => undefined,
          load: () => log.push(`session:${id}:inplace-load`),
          resume: () => undefined,
          setDifficulty: () => undefined,
          manualSave: () => undefined,
          quitToTitle: () => coordinator.enterTitle(),
        } as unknown as PlaySession['game'],
        resetTutorials: () => undefined,
        dispose: () => log.push(`session:dispose:${id}`),
      };
      return fake;
    },
  };

  const coordinator = new SessionCoordinator(host);
  coordinator.enterTitle();
  assert.equal(coordinator.active, null);

  // Start New Game -> session 1 created.
  const ok1 = await coordinator.start({ kind: 'newGame', slot: 0, difficulty: 'standard' });
  assert.equal(ok1, true);
  assert.ok(coordinator.active);

  // Loading a save on the same active level restores in place without rebuilding.
  const sampleSave: SaveData = {
    version: SAVE_VERSION,
    kind: 'auto',
    slot: 0,
    savedAt: '2026-11-22T00:00:00.000Z',
    playTime: 30,
    difficulty: 'standard',
    chapter: 'slice01',
    level: 'slice01',
    checkpoint: 'cp_valve',
    location: 'Valve Room',
    player: { position: [0, 1.6, 0], yaw: 0, pitch: 0, health: 100, flashlightOn: false },
    flags: {},
    items: [],
    map: {},
  };
  await coordinator.start({ kind: 'load', save: sampleSave });
  assert.ok(log.includes('session:1:inplace-load'));

  // Quit to title disposes session 1 and restores title backdrop & menu.
  coordinator.menuAdapter().quitToTitle();
  assert.equal(coordinator.active, null);
  assert.ok(log.includes('session:dispose:1'));

  // Second New Game creates fresh session 2.
  const ok2 = await coordinator.start({ kind: 'newGame', slot: 1, difficulty: 'survival' });
  assert.equal(ok2, true);
  assert.ok(log.includes('session:create:2:newGame'));

  // Quit to title disposes session 2, then a failed load recovers back to title.
  coordinator.enterTitle();
  assert.ok(log.includes('session:dispose:2'));
  shouldFail = true;
  const ok3 = await coordinator.start({ kind: 'newGame', slot: 0, difficulty: 'standard' });
  assert.equal(ok3, false);
  assert.equal(coordinator.active, null);
  assert.ok(log.some((e) => e.startsWith('loading:error:missing level')));
});
