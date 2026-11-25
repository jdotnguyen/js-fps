import test from 'node:test';
import assert from 'node:assert/strict';
import { bracketArcPath, CROSSHAIR_MAX_PX, CROSSHAIR_MIN_PX, CrosshairHud, projectSpreadToPx } from './crosshairHud.ts';

class FakeClassList {
  private readonly set = new Set<string>();
  toggle(name: string, force?: boolean): boolean {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) this.set.add(name);
    else this.set.delete(name);
    return force;
  }
  remove(...names: string[]): void {
    for (const n of names) this.set.delete(n);
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
}

class FakeElement {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...nodes);
  }
}

function withFakeDocument<T>(fn: () => T): T {
  const prev = (globalThis as { document?: unknown }).document;
  (globalThis as { document: unknown }).document = {
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  };
  try {
    return fn();
  } finally {
    if (prev === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document: unknown }).document = prev;
  }
}

test('projectSpreadToPx scales with angular spread and camera FOV and clamps cleanly', () => {
  const narrow = projectSpreadToPx(0.02, 80, 1080);
  const wide = projectSpreadToPx(0.06, 80, 1080);
  assert.ok(wide > narrow * 2.5, 'wider spread yields proportionally larger pixel radius');

  // Zooming in (smaller FOV) enlarges the projected angular spread on screen.
  const zoomed = projectSpreadToPx(0.04, 60, 1080);
  const unzoomed = projectSpreadToPx(0.04, 90, 1080);
  assert.ok(zoomed > unzoomed, 'narrower FOV produces a larger projected pixel radius');

  assert.equal(projectSpreadToPx(0, 80, 1080), CROSSHAIR_MIN_PX);
  assert.equal(projectSpreadToPx(0.9, 80, 1080), CROSSHAIR_MAX_PX);
});

test('bracketArcPath emits valid SVG arc commands for left and right side brackets', () => {
  const right = bracketArcPath(20, -40, 40);
  const left = bracketArcPath(20, 140, 220);
  assert.match(right, /^M [\d.-]+ [\d.-]+ A 20\.00 20\.00 0 0 1 [\d.-]+ [\d.-]+$/);
  assert.match(left, /^M [\d.-]+ [\d.-]+ A 20\.00 20\.00 0 0 1 [\d.-]+ [\d.-]+$/);
});

test('CrosshairHud toggles focused/unarmed/suppressed classes and tracks spread without overshoot under reducedMotion', () => {
  withFakeDocument(() => {
    const root = new FakeElement('div');
    const hud = new CrosshairHud(root as unknown as HTMLElement);
    assert.equal(root.children.length, 1, 'appends SVG root');
    const svg = root.children[0]!;
    assert.equal(svg.children.length, 3, 'renders center dot + left and right curved brackets');

    hud.update({ dt: 0.016, spreadRad: 0.024, fovDeg: 80, viewportHeight: 1080, focused: false, armed: true, suppressed: false, reducedMotion: false });
    assert.equal(root.classList.contains('focused'), false);
    assert.equal(root.classList.contains('unarmed'), false);
    assert.equal(root.classList.contains('suppressed'), false);

    // Focused state tightens and sets .focused.
    hud.update({ dt: 0.016, spreadRad: 0.002, fovDeg: 64, viewportHeight: 1080, focused: true, armed: true, suppressed: false, reducedMotion: true });
    assert.equal(root.classList.contains('focused'), true);
    assert.equal(hud.radiusPx, projectSpreadToPx(0.002, 64, 1080));

    // Unarmed state sets .unarmed and does not set .suppressed.
    hud.update({ dt: 0.016, spreadRad: 0.024, fovDeg: 80, viewportHeight: 1080, focused: false, armed: false, suppressed: true, reducedMotion: true });
    assert.equal(root.classList.contains('unarmed'), true);
    assert.equal(root.classList.contains('suppressed'), false);

    // Armed + sprinting/reloading sets .suppressed.
    hud.update({ dt: 0.016, spreadRad: 0.024, fovDeg: 80, viewportHeight: 1080, focused: false, armed: true, suppressed: true, reducedMotion: true });
    assert.equal(root.classList.contains('unarmed'), false);
    assert.equal(root.classList.contains('suppressed'), true);

    hud.dispose();
    assert.equal(root.children.length, 0);
  });
});
