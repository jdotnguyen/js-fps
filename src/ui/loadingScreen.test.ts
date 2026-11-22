import { test } from 'node:test';
import assert from 'node:assert/strict';

interface StubNode {
  tagName: string;
  id: string;
  className: string;
  hidden: boolean;
  textContent: string;
  innerHTML: string;
  type: string;
  style: Record<string, string>;
  attrs: Record<string, string>;
  classes: Set<string>;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    contains: (c: string) => boolean;
  };
  listeners: Record<string, Array<() => void>>;
  children: StubNode[];
  appendChild: (c: StubNode) => StubNode;
  setAttribute: (k: string, v: string) => void;
  addEventListener: (ev: string, fn: () => void) => void;
  focus: () => void;
}

function makeStubNode(tag = 'div'): StubNode {
  const classes = new Set<string>();
  const listeners: Record<string, Array<() => void>> = {};
  const node: StubNode = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    type: '',
    style: {},
    attrs: {},
    classes,
    classList: {
      add: (c) => void classes.add(c),
      remove: (c) => void classes.delete(c),
      contains: (c) => classes.has(c),
    },
    listeners,
    children: [],
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener(ev, fn) {
      (listeners[ev] ??= []).push(fn);
    },
    focus() {},
  };
  return node;
}

test('LoadingScreen enforces monotonic progress, updates stage labels, fades out, and handles errors', async () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => makeStubNode(tag) };

  try {
    const { LoadingScreen } = await import('./loadingScreen.ts');
    const parent = makeStubNode('body');
    const screen = new LoadingScreen(parent as unknown as HTMLElement, { reducedMotion: () => true });

    assert.equal(screen.visible, false);
    screen.show('SECTION 07');
    assert.equal(screen.visible, true);
    assert.equal(screen.fraction, 0);

    screen.setProgress(0.35, 'Building Docking Ring…');
    assert.equal(screen.fraction, 0.35);
    assert.equal(screen.stage, 'Building Docking Ring…');

    // Out-of-order smaller fraction never moves bar backward.
    screen.setProgress(0.15, 'Still building…');
    assert.equal(screen.fraction, 0.35);
    assert.equal(screen.stage, 'Still building…');

    // Clamps above 1.
    screen.setProgress(1.5, 'Ready');
    assert.equal(screen.fraction, 1);

    await screen.hide(0);
    assert.equal(screen.visible, false);

    let backed = 0;
    screen.showError('Missing level file', () => backed++);
    assert.equal(screen.visible, true);
    assert.equal(screen.stage, 'Load failed');

    // Find back button and click it.
    const findBtn = (n: StubNode): StubNode | null => {
      if (n.tagName === 'BUTTON') return n;
      for (const c of n.children) {
        const hit = findBtn(c);
        if (hit) return hit;
      }
      return null;
    };
    const btn = findBtn(screen.element as unknown as StubNode);
    assert.ok(btn);
    for (const fn of btn.listeners['click'] ?? []) fn();
    assert.equal(backed, 1);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});
