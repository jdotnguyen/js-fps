import { test } from 'node:test';
import assert from 'node:assert/strict';

type FakeEl = {
  id: string;
  className: string;
  hidden: boolean;
  innerHTML: string;
  width: number;
  height: number;
  children: FakeEl[];
  attrs: Record<string, string>;
  removed: boolean;
  appendChild: (c: FakeEl) => FakeEl;
  setAttribute: (k: string, v: string) => void;
  remove: () => void;
  getContext: () => Record<string, unknown>;
};

function makeFakeDoc() {
  let fillCalls = 0;
  const noop = (): void => undefined;
  const fakeCtx = {
    setTransform: noop,
    clearRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    fillRect: () => {
      fillCalls++;
    },
    beginPath: noop,
    arc: noop,
    stroke: noop,
    fill: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
  const createEl = (): FakeEl => {
    const el: FakeEl = {
      id: '',
      className: '',
      hidden: false,
      innerHTML: '',
      width: 0,
      height: 0,
      children: [],
      attrs: {},
      removed: false,
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      remove() {
        this.removed = true;
      },
      getContext: () => fakeCtx,
    };
    return el;
  };
  return {
    parent: createEl(),
    document: { createElement: () => createEl() },
    getFillCalls: () => fillCalls,
  };
}

test('TitleBackdrop2D starts, stops, and stays static under reduced motion', async () => {
  const { parent, document: fakeDoc, getFillCalls } = makeFakeDoc();
  const prevDoc = (globalThis as { document?: unknown }).document;
  const prevRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  const prevCancel = (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;

  let rafCount = 0;
  let cancelCount = 0;
  (globalThis as { document?: unknown }).document = fakeDoc;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => ++rafCount;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {
    cancelCount++;
  };

  try {
    const { TitleBackdrop2D } = await import('./titleBackdrop.ts');
    let reduced = true;
    const backdrop = new TitleBackdrop2D(parent as unknown as HTMLElement, {
      reducedMotion: () => reduced,
      reducedFlashing: () => false,
    });

    assert.equal(backdrop.element.hidden, true);
    assert.equal(backdrop.active, false);

    // Reduced motion renders a single static frame with zero RAF scheduling.
    backdrop.start();
    assert.equal(backdrop.element.hidden, false);
    assert.equal(backdrop.active, true);
    assert.equal(rafCount, 0, 'reduced motion does not start an animation loop');
    assert.ok(getFillCalls() > 0, 'static frame drawn');

    // Turning reduced motion off starts RAF; stop() cancels it and hides backdrop.
    reduced = false;
    backdrop.refresh();
    assert.equal(rafCount, 1);

    backdrop.stop();
    assert.equal(backdrop.active, false);
    assert.equal(backdrop.element.hidden, true);
    assert.equal(cancelCount, 1);

    backdrop.dispose();
    assert.equal((backdrop.element as unknown as FakeEl).removed, true);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = prevRaf;
    (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = prevCancel;
  }
});
