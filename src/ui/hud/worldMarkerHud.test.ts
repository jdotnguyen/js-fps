import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WorldMarkerHud } from './worldMarkerHud.ts';
import type { WorldMarkerResult } from '../wayfinding.ts';

interface Stub {
  hidden: boolean;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: Stub[];
  append: (...c: Stub[]) => void;
  setAttribute: (k: string, v: string) => void;
}

function stub(): Stub {
  const n: Stub = {
    hidden: false,
    className: '',
    textContent: '',
    style: {},
    children: [],
    append(...c) {
      n.children.push(...c);
    },
    setAttribute(k, v) {
      if (k === 'hidden') n.hidden = true;
      if (k === 'class') n.className = v;
    },
  };
  return n;
}

function withDom<T>(fn: () => T): T {
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  g.document = { createElement: () => stub() };
  try {
    return fn();
  } finally {
    g.document = prev;
  }
}

function marker(id: string, z: number, distance: number): WorldMarkerResult {
  return { id, required: true, kind: 'target', pos: { x: 0, y: 0, z }, distance };
}

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
  cam.updateMatrixWorld(true);
  return cam; // looks down -Z
}

test('a completed objective hides only its own marker', () => {
  withDom(() => {
    const parent = stub();
    const hud = new WorldMarkerHud(parent as unknown as HTMLElement);
    const cam = camera();
    hud.update(true, cam, [marker('a', -2, 2), marker('b', -6, 6)]);
    const slots = (hud.el as unknown as Stub).children;
    assert.deepEqual(slots.map((s) => s.hidden), [false, false]);
    hud.update(true, cam, [marker('b', -6, 6)]);
    assert.deepEqual(slots.map((s) => s.hidden), [false, true]);
  });
});

test('a marker behind the camera hides, and returns with a fresh distance', () => {
  withDom(() => {
    const hud = new WorldMarkerHud(stub() as unknown as HTMLElement);
    const cam = camera();
    hud.update(true, cam, [marker('a', -8, 8)]);
    const slot = (hud.el as unknown as Stub).children[0]!;
    assert.equal(slot.hidden, false);
    assert.equal(slot.children[1]!.textContent, '8m');
    hud.update(true, cam, [marker('a', 4, 12)]);
    assert.equal(slot.hidden, true);
    hud.update(true, cam, [marker('a', -4, 4)]);
    assert.equal(slot.hidden, false);
    assert.equal(slot.children[1]!.textContent, '4m');
  });
});

test('hud.css gives every toggled marker element a [hidden] rule (display must not defeat hidden)', () => {
  const css = readFileSync(new URL('../styles/hud.css', import.meta.url), 'utf8');
  assert.match(css, /\.world-markers\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.world-marker\[hidden\]\s*\{\s*display:\s*none/);
});

test('hud.css gives the compass marks a [hidden] rule too (they set display: grid)', () => {
  const css = readFileSync(new URL('../styles/hud.css', import.meta.url), 'utf8');
  assert.match(css, /\.compass-mark\[hidden\]\s*\{\s*display:\s*none/);
});
