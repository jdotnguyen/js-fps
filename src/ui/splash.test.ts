import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// startSplash with a minimal fake DOM, in the reduced-motion path so each card is a plain timed hold.
type Handler = (e: unknown) => void;
const keyHandlers: Handler[] = [];
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.matchMedia = () => ({ matches: true });
g.addEventListener = (type: string, h: Handler) => void (type === 'keydown' && keyHandlers.push(h));
g.removeEventListener = (type: string, h: Handler) => {
  if (type === 'keydown') keyHandlers.splice(keyHandlers.indexOf(h), 1);
};
g.MutationObserver = class {
  observe(): void {}
  disconnect(): void {}
};
g.document = { querySelector: () => null };

function fakeEl(): { hidden: boolean; classList: { add: (c: string) => void; contains: () => boolean }; textContent: string; style: Record<string, string>; remove: () => void; removed: boolean } {
  const el = { hidden: true, textContent: '', style: {} as Record<string, string>, removed: false, classList: { add: () => undefined, contains: () => false }, remove: () => void (el.removed = true) };
  return el;
}

const { startSplash } = await import('./splash.ts');

function fakeRoot(): { root: HTMLElement; engine: ReturnType<typeof fakeEl>; dev: ReturnType<typeof fakeEl>; pointerHandlers: Handler[]; rootEl: ReturnType<typeof fakeEl> } {
  const engine = fakeEl();
  const dev = fakeEl();
  const rootEl = fakeEl();
  const pointerHandlers: Handler[] = [];
  const parts: Record<string, unknown> = { '#splash-engine': engine, '#splash-dev': dev, '#splash-dev img': { style: {} } };
  const root = Object.assign(rootEl, {
    querySelector: (sel: string) => parts[sel] ?? null,
    addEventListener: (type: string, h: Handler) => void (type === 'pointerdown' && pointerHandlers.push(h)),
    removeEventListener: () => undefined,
  });
  return { root: root as unknown as HTMLElement, engine, dev, pointerHandlers, rootEl };
}

test('no key or click advances a splash card; each plays its full length', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { root, engine, dev, pointerHandlers } = fakeRoot();
    const splash = startSplash(root, '');
    assert.equal(keyHandlers.length, 0, 'the splash listens for no key press (no skip, no audio gate here)');
    assert.equal(pointerHandlers.length, 0, 'and for no click');

    const finished = splash.finish();
    await Promise.resolve();
    assert.equal(engine.hidden, false, 'the engine card is showing');

    for (const key of ['Escape', 'Enter', ' ']) for (const h of keyHandlers) h({ key, repeat: false });
    for (const h of pointerHandlers) h({});
    mock.timers.tick(3199);
    await Promise.resolve();
    assert.equal(engine.hidden, false, 'still showing 1 ms before its hold ends');

    mock.timers.tick(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(engine.hidden, true, 'the engine card ends at its full length');
    assert.equal(dev.hidden, false, 'then the developer card shows');

    mock.timers.tick(3200);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    mock.timers.tick(700); // the fade-out
    await finished;
    assert.equal(dev.hidden, true);
  } finally {
    mock.timers.reset();
  }
});

test('?nosplash still removes the splash at once', () => {
  const { root, rootEl } = fakeRoot();
  const splash = startSplash(root, '?nosplash');
  assert.equal(rootEl.removed, true);
  assert.ok(splash);
});

test('the audio-unlock prompt still waits for a key press, then the splash plays', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { root, engine } = fakeRoot();
    const splash = startSplash(root, '');
    let resumed = 0;
    const ctx = { state: 'suspended' };
    splash.attachAudio({ ctx, resume: async () => void resumed++ } as never);
    const finished = splash.finish();
    await Promise.resolve();
    assert.equal(keyHandlers.length, 1, 'the one key listener is the audio-unlock prompt');
    assert.equal(engine.hidden, true, 'no card plays before the player unlocks audio');
    keyHandlers[0]!({ key: 'a', repeat: false });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(resumed, 1);
    assert.equal(engine.hidden, false, 'the engine card plays after the unlock');
    assert.equal(keyHandlers.length, 0, 'the prompt listener is gone');
    mock.timers.tick(3200);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    mock.timers.tick(3200);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    mock.timers.tick(700);
    await finished;
  } finally {
    mock.timers.reset();
  }
});
