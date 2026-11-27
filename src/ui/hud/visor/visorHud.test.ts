// visor-hud: what the panels put on the page, driven through the player, the weapon and the event bus.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Player } from '../../../actors/player.ts';
import { PLAYER_TUNING } from '../../../actors/player.ts';
import type { VitalState } from '../../../actors/vitals.ts';
import { EventBus, type EventName } from '../../../core/events.ts';
import type { AmmoPoll } from './ammoModel.ts';
import { BOOT_SECONDS, VisorHud, type VisorSettings } from './visorHud.ts';

class Classes {
  private readonly el: FakeEl;
  constructor(el: FakeEl) {
    this.el = el;
  }
  private all(): Set<string> {
    return new Set(this.el.className.split(' ').filter(Boolean));
  }
  contains(c: string): boolean {
    return this.all().has(c);
  }
  toggle(c: string, on = !this.contains(c)): void {
    const set = this.all();
    if (on) set.add(c);
    else set.delete(c);
    this.el.className = [...set].join(' ');
  }
  add(...c: string[]): void {
    for (const name of c) this.toggle(name, true);
  }
  remove(...c: string[]): void {
    for (const name of c) this.toggle(name, false);
  }
}

class FakeEl {
  hidden = false;
  textContent = '';
  className = '';
  readonly attrs: Record<string, string> = {};
  readonly style: Record<string, unknown> & { setProperty(name: string, value: string): void } = {
    setProperty(name: string, value: string) {
      (this as unknown as Record<string, string>)[name] = value;
    },
  };
  readonly classList = new Classes(this);
  children: FakeEl[] = [];
  /** Nodes put in front of this one. */
  readonly ahead: FakeEl[] = [];
  removed = false;
  append(...c: FakeEl[]): void {
    this.children.push(...c);
  }
  replaceChildren(...c: FakeEl[]): void {
    this.children = c;
  }
  before(node: FakeEl): void {
    this.ahead.push(node);
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === 'class') this.className = value;
  }
  remove(): void {
    this.removed = true;
  }
  /** Every node under this one with the class, in page order. */
  all(cls: string): FakeEl[] {
    return this.children.flatMap((c) => [...(c.classList.contains(cls) ? [c] : []), ...c.all(cls)]);
  }
  one(cls: string): FakeEl {
    const found = this.all(cls)[0];
    assert.ok(found, `no .${cls}`);
    return found;
  }
}

const STEP = 1 / 60;

function setup(t: TestContext) {
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  const make = (): FakeEl => new FakeEl();
  g.document = { createElement: make, createElementNS: make };
  t.after(() => void (g.document = prev));

  const ui = new FakeEl();
  const hud = new VisorHud(ui as unknown as HTMLElement);
  const root = ui.ahead[0]!;
  const events = new EventBus();
  const settings: VisorSettings = { reducedMotion: false, reducedFlashing: false, hudOpacity: 0.85, hudScale: 1, calmHud: true };
  const camera = { position: { x: 0, y: 1.7, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  const vitals = { hp: 100, state: 'alive' as VitalState, bleed: 0, revivesLeft: 1 as number | null };
  const body = { vitals, stamina: PLAYER_TUNING.sprintMax, isExhausted: false, sprinting: false, eyePosition: (v: { set(x: number, y: number, z: number): unknown }) => v.set(0, 1.7, 0) };
  const player = body as unknown as Player;
  let ammo: AmmoPoll | null = { name: 'pistol', loaded: 12, reserve: 36, mag: 12, reloading: false };
  hud.setAmmoSource(() => ammo);
  hud.connect({ events, camera: camera as never, settings: { get: () => settings }, reloadKey: 'T' });

  const frame = (dt = STEP): void => {
    hud.tick(dt);
    hud.update(player, dt);
  };
  const play = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) frame();
  };
  const emit = (name: EventName, payload: unknown = {}): void => events.emit(name, payload as never);
  const bio = root.one('visor-bio');
  const gun = root.one('visor-ammo');
  const text = (cls: string, within: FakeEl = root): string => within.one(cls).textContent;
  const filled = (): number => gun.all('visor-pip').filter((p) => p.classList.contains('full')).length;
  return {
    hud, ui, root, bio, gun, events, settings, camera, vitals, body, frame, play, emit, text, filled,
    hold: (poll: AmmoPoll | null): void => void (ammo = poll),
    weapon: (): AmmoPoll => ammo!,
  };
}

test('the visor sits in front of #ui, shows on its first frame and boots', (t) => {
  const v = setup(t);
  assert.equal(v.root.hidden, true);
  v.frame();
  assert.equal(v.root.hidden, false);
  assert.ok(v.root.classList.contains('booting'));
  v.play(BOOT_SECONDS + 0.1);
  assert.ok(!v.root.classList.contains('booting'));
  v.hud.boot();
  assert.ok(v.root.classList.contains('booting'), 'a load or restore boots it again');
});

test('a boot-up cut short by hiding plays again in full', (t) => {
  const v = setup(t);
  v.play(1);
  v.hud.hide();
  assert.equal(v.root.hidden, true);
  v.play(BOOT_SECONDS - 0.2);
  assert.ok(v.root.classList.contains('booting'));
  v.play(0.4);
  assert.ok(!v.root.classList.contains('booting'));
});

test('going down puts the countdown and revives in place of the bar, and a revive brings it back', (t) => {
  const v = setup(t);
  v.frame();
  const downed = v.bio.one('visor-downed');
  assert.equal(downed.hidden, true);
  Object.assign(v.vitals, { hp: 0, state: 'downed', bleed: 20 });
  v.frame();
  assert.ok(v.bio.classList.contains('downed'), 'the class that takes the bar off');
  assert.equal(downed.hidden, false);
  assert.equal(v.text('visor-bleed-num'), '20 s');
  assert.equal(v.text('visor-downed-note'), 'WAIT FOR THE MEDIC');
  assert.equal(v.text('visor-revives'), 'REVIVES LEFT 1');
  v.vitals.bleed = 12.2;
  v.frame();
  assert.equal(v.text('visor-bleed-num'), '13 s');
  Object.assign(v.vitals, { hp: 35, state: 'alive', bleed: 0, revivesLeft: 0 });
  v.frame();
  assert.ok(!v.bio.classList.contains('downed'));
  assert.equal(downed.hidden, true);
  assert.equal(v.text('visor-hp'), '35');
  assert.equal(v.text('visor-delta', v.bio), '+35');
});

test('unlimited revives show no count', (t) => {
  const v = setup(t);
  Object.assign(v.vitals, { hp: 0, state: 'downed', bleed: 20, revivesLeft: null });
  v.frame();
  assert.equal(v.bio.one('visor-revives').hidden, true);
});

test('the weapon panel and its underlay hide while no weapon is held', (t) => {
  const v = setup(t);
  v.hold(null);
  v.frame();
  assert.equal(v.gun.hidden, true);
  assert.equal(v.root.all('visor-shade')[1]!.hidden, true);
  assert.equal(v.bio.hidden, false);
  v.hold({ name: 'shotgun', loaded: 3, reserve: 15, mag: 6 });
  v.frame();
  assert.equal(v.gun.hidden, false);
  assert.equal(v.text('visor-title', v.gun), 'SHOTGUN');
  assert.equal(v.gun.all('visor-pip').length, 6);
  assert.equal(v.filled(), 3);
});

test('the numbers always match the player and the weapon, events or none', (t) => {
  const v = setup(t);
  v.frame();
  v.vitals.hp = 21.4;
  Object.assign(v.weapon(), { loaded: 9, reserve: 30 });
  v.frame(0);
  assert.equal(v.text('visor-hp'), '22', 'even with the scene frozen');
  assert.ok(v.bio.classList.contains('low'));
  assert.equal(v.text('visor-loaded'), '9');
  assert.equal(v.text('visor-reserve'), '/ 30');
  assert.equal(v.filled(), 9);
  assert.equal(v.gun.all('visor-pip').length, 12);
  // Mid-reload the counts stay the weapon's, while the pips refill.
  Object.assign(v.weapon(), { loaded: 0, reloading: true });
  v.emit('weapon:reloadStart', { weapon: 'pistol', duration: 2 });
  v.play(1.2);
  assert.equal(v.text('visor-loaded'), '0');
  assert.ok(v.filled() > 0 && v.filled() < 12, `${v.filled()}`);
  assert.ok(v.gun.classList.contains('empty') && v.gun.classList.contains('reloading'));
  Object.assign(v.weapon(), { loaded: 12, reserve: 18, reloading: false });
  v.emit('weapon:reloaded', { weapon: 'pistol', loaded: 12, reserve: 18 });
  v.frame();
  assert.equal(v.text('visor-loaded'), '12');
  assert.equal(v.filled(), 12);
  assert.ok(!v.gun.classList.contains('reloading') && !v.gun.classList.contains('empty'));
});

test('a shot blinks its pip and a dry fire asks for the bound reload key', (t) => {
  const v = setup(t);
  v.frame();
  v.weapon().loaded = 11;
  v.emit('weapon:fired', { weapon: 'pistol' });
  v.frame();
  assert.ok(v.gun.all('visor-pip')[11]!.classList.contains('blink'));
  assert.equal(v.filled(), 11);
  v.weapon().loaded = 0;
  v.emit('weapon:dryFire', { weapon: 'pistol' });
  v.frame();
  const alert = v.gun.one('visor-alert');
  assert.equal(alert.hidden, false);
  assert.equal(alert.textContent, 'EMPTY · [T]');
  assert.ok(v.gun.one('visor-pips').classList.contains('dry'));
  v.play(2);
  assert.equal(alert.hidden, true);
});

test('picking up ammo raises the figure beside the reserve', (t) => {
  const v = setup(t);
  v.frame();
  v.weapon().reserve = 48;
  v.frame();
  assert.equal(v.text('visor-delta', v.gun), '+12');
  assert.equal(v.gun.one('visor-delta').hidden, false);
});

test('a swap switches the panel over with a glitch', (t) => {
  const v = setup(t);
  v.frame();
  v.hold({ name: 'shotgun', loaded: 6, reserve: 18, mag: 6 });
  v.emit('weapon:equipped', { weapon: 'shotgun' });
  v.frame();
  assert.ok(v.gun.classList.contains('swap') && v.gun.classList.contains('shotgun'));
  assert.equal(v.gun.all('visor-pip').length, 6);
});

test('a swipe from the left tears the biomonitor and moves it more than the weapon panel', (t) => {
  const v = setup(t);
  v.frame();
  v.vitals.hp = 80;
  v.emit('player:damaged', { amount: 20, hp: 80, kind: 'swipe', side: 'L', dir: { x: 0, y: 0 }, severity: 0.8 });
  v.play(0.05);
  assert.ok(v.bio.classList.contains('tear'));
  assert.ok(!v.gun.classList.contains('tear'));
  const x = (el: FakeEl): number => Math.abs(parseFloat(String(el.style['translate'])));
  assert.ok(x(v.bio) > 2 && x(v.gun) < x(v.bio) / 3, `${x(v.bio)} and ${x(v.gun)}`);
});

test('a hit that says nothing but its damage jolts both panels', (t) => {
  const v = setup(t);
  v.frame();
  v.emit('player:damaged', { amount: 20, hp: 80 });
  v.frame();
  assert.ok(v.bio.classList.contains('tear') && v.gun.classList.contains('tear'));
});

test('a restore shows the values at once, with no chip, delta or leftover effect', (t) => {
  const v = setup(t);
  v.frame();
  v.vitals.hp = 40;
  v.emit('player:damaged', { amount: 60, hp: 40 });
  v.play(0.1);
  v.vitals.hp = 90;
  v.weapon().reserve = 60;
  v.hud.boot();
  v.frame();
  const segs = v.bio.all('visor-seg');
  assert.equal(segs[3]!.one('visor-chip').style['transform'], segs[3]!.one('visor-fill').style['transform']);
  assert.equal(segs[3]!.one('visor-fill').style['transform'], 'scaleX(0.600)');
  assert.equal(v.bio.one('visor-delta').hidden, true);
  assert.equal(v.gun.one('visor-delta').hidden, true);
});

test('calm mode dims after six quiet seconds, and every listed event wakes it', (t) => {
  const v = setup(t);
  const calm = (): boolean => v.root.classList.contains('calm');
  v.frame();
  v.play(5.8);
  assert.equal(calm(), false);
  v.play(0.4);
  assert.equal(calm(), true);
  const wakes: Array<[EventName, unknown]> = [
    ['player:damaged', { amount: 0, hp: 100 }],
    ['weapon:fired', { weapon: 'pistol' }],
    ['weapon:dryFire', { weapon: 'pistol' }],
    ['weapon:reloadStart', { weapon: 'pistol' }],
    ['weapon:equipped', { weapon: 'pistol' }],
    ['pickup:taken', { kind: 'ammo_pistol', amount: 12 }],
  ];
  for (const [name, payload] of wakes) {
    v.emit(name, payload);
    v.frame();
    assert.equal(calm(), false, name);
    // The frames above leave a pip short; the weapon is full again, so the quiet can start over.
    v.weapon().loaded = 12;
    v.play(6.2);
    assert.equal(calm(), true, `dims again after ${name}`);
  }
});

test('calm mode stays awake while anything is below full or Jay sprints', (t) => {
  const v = setup(t);
  const cases: Array<[string, () => void, () => void]> = [
    ['health', () => (v.vitals.hp = 99), () => (v.vitals.hp = 100)],
    ['stamina', () => (v.body.stamina = 1), () => (v.body.stamina = PLAYER_TUNING.sprintMax)],
    ['magazine', () => (v.weapon().loaded = 11), () => (v.weapon().loaded = 12)],
    ['sprint', () => (v.body.sprinting = true), () => (v.body.sprinting = false)],
  ];
  v.frame();
  for (const [what, spend, restore] of cases) {
    v.play(7);
    assert.ok(v.root.classList.contains('calm'), `quiet before ${what}`);
    spend();
    v.frame();
    assert.ok(!v.root.classList.contains('calm'), `${what} wakes it at once`);
    v.play(8);
    assert.ok(!v.root.classList.contains('calm'), `${what} keeps it awake`);
    restore();
  }
});

test('with calm mode off the panels never dim', (t) => {
  const v = setup(t);
  v.settings.calmHud = false;
  v.play(10);
  assert.ok(!v.root.classList.contains('calm'));
});

test('the settings reach the page at once', (t) => {
  const v = setup(t);
  v.frame();
  assert.equal(v.root.style['--hud-scale'], '1');
  Object.assign(v.settings, { hudScale: 1.25, hudOpacity: 0.5, reducedFlashing: true, reducedMotion: true });
  v.frame();
  for (const el of [v.root, v.ui]) {
    assert.equal(el.style['--hud-scale'], '1.25');
    assert.equal(el.style['--hud-opacity'], '0.5');
  }
  assert.ok(v.root.classList.contains('reduced-flashing') && v.root.classList.contains('reduced-motion'));
  v.camera.rotation.y = -1;
  v.frame();
  assert.equal(v.bio.style['translate'], '0.0px 0.0px');
});

test('the panels lag behind a turn of the view', (t) => {
  const v = setup(t);
  v.frame();
  v.frame();
  v.camera.rotation.y = -0.1;
  v.frame();
  assert.ok(parseFloat(String(v.bio.style['translate'])) < 0);
});

test('disposing takes the visor off the page and stops it listening', (t) => {
  const v = setup(t);
  v.frame();
  v.hud.dispose();
  assert.equal(v.root.removed, true);
  v.emit('player:damaged', { amount: 20, hp: 80 });
  assert.ok(!v.bio.classList.contains('tear'));
});
