import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Player } from '../../actors/player.ts';
import { EventBus } from '../../core/events.ts';
import type { Input } from '../../core/input.ts';
import { GlbWeapon } from './glbWeapons.ts';
import { CUES, Viewmodel, type WeaponCue } from './viewmodel.ts';
import type { WeaponId } from './rig.ts';

/**
 * The weapon viewmodels' behaviour (swap-viewmodels-to-just-models, spec `weapon-viewmodels`): the pistol's single reload at its
 * authored length, the shotgun's one-clip shot and pump and its shell-by-shell reload, with the sound cues on the clips'
 * own times. The rigs here are hand-made (one bone, the real clip lengths), so only the state machine is under test.
 */

const DT = 1 / 60;

function weapon(id: WeaponId, clips: Record<string, number>): GlbWeapon {
  const scene = new THREE.Group();
  const bone = new THREE.Object3D();
  bone.name = 'Base';
  scene.add(bone);
  const animations = Object.entries(clips).map(
    ([name, len]) => new THREE.AnimationClip(`Armature|${name}`, len, [new THREE.VectorKeyframeTrack('Base.position', [0, len], [0, 0, 0, 0, 0, 0])]),
  );
  return new GlbWeapon(id, { scene, animations }, { url: '', scale: 0.024, ref: [0, 0, 0], bone: 'Base', muzzle: [0, 0, 0] });
}

interface Rig {
  vm: Viewmodel;
  models: Record<WeaponId, GlbWeapon>;
  events: EventBus;
  /** Seconds simulated since the rig was built. */
  now(): number;
  step(seconds: number): void;
  /** Press and release a key over two frames. */
  press(action: 'fire' | 'reload' | 'weapon1' | 'weapon2'): void;
  log: { t: number; what: string }[];
}

function rig(reducedMotion = false): Rig {
  const events = new EventBus();
  const down = new Set<string>();
  const input = { locked: true, isDown: (a: string) => down.has(a), consumeWheel: () => 0 } as unknown as Input;
  const player = { yaw: 0, pitch: 0, velocity: new THREE.Vector2(), sprinting: false, aimBlend: 0, addKick() {} } as unknown as Player;
  const models: Record<WeaponId, GlbWeapon> = {
    pistol: weapon('pistol', { Take: 0.33, Shoot: 0.33, Reload: 3.67, Hide: 0.47 }),
    shotgun: weapon('shotgun', { Take: 0.63, Shoot: 1.04, ReloadStart: 0.63, Reload: 0.71, ReloadEnd: 0.71, Hide: 0.63 }),
  };
  const vm = new Viewmodel({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    input,
    player,
    events,
    models,
    enabled: () => true,
    visible: () => true,
    reducedMotion: () => reducedMotion,
  });
  let t = 0;
  const log: Rig['log'] = [];
  events.on('weapon:fired', ({ weapon: w }) => log.push({ t, what: `fired ${w}` }));
  events.on('weapon:cue', ({ cue }) => log.push({ t, what: `cue ${cue}` }));
  events.on('weapon:shellInsert', () => log.push({ t, what: 'shell' }));
  events.on('weapon:reloadStart', ({ weapon: w }) => log.push({ t, what: `reloadStart ${w}` }));
  events.on('weapon:reloaded', ({ weapon: w }) => log.push({ t, what: `reloaded ${w}` }));
  const step = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      t += DT;
      vm.update(DT);
    }
  };
  const r: Rig = {
    vm,
    models,
    events,
    now: () => t,
    step,
    press(action) {
      down.add(action);
      step(DT);
      down.delete(action);
      step(DT);
    },
    log,
  };
  step(1.5); // the first draw and the holster lifting
  log.length = 0;
  return r;
}

const times = (r: Rig, what: string): number[] => r.log.filter((e) => e.what === what).map((e) => e.t);

/** Fire `n` shots, leaving the cooldown (and for the shotgun the pump) between them. */
function fireShots(r: Rig, n: number, gap: number): void {
  for (let i = 0; i < n; i++) {
    r.press('fire');
    r.step(gap);
  }
}

test('pistol: a part-full reload takes the authored 3.7 s, with its sounds on the magazine moves, and fills the magazine', () => {
  const r = rig();
  fireShots(r, 4, 0.3);
  assert.equal(r.vm.ammoOf('pistol').loaded, 8);
  r.log.length = 0;
  const t0 = r.now();
  r.press('reload');
  r.step(4);
  const at = (what: string): number => (times(r, what)[0] ?? NaN) - t0;
  assert.ok(Math.abs(at('cue magOut') - CUES.pistol.magOut) < 0.06, `magOut ${at('cue magOut')}`);
  assert.ok(Math.abs(at('cue magIn') - CUES.pistol.magIn) < 0.06, `magIn ${at('cue magIn')}`);
  assert.ok(Math.abs(at('cue slide') - CUES.pistol.slide) < 0.06, `slide ${at('cue slide')}`);
  assert.ok(Math.abs(at('reloaded pistol') - 3.67) < 0.06, `reloaded at ${at('reloaded pistol')}`);
  assert.equal(r.vm.ammoOf('pistol').loaded, 12);
  assert.equal(times(r, 'cue slide').length, 1, 'one slide sound, not a second soft one');
});

test('given no time (a frozen scene, game-pause) a reload neither moves on nor sounds, then carries on', () => {
  const r = rig();
  fireShots(r, 4, 0.3);
  r.log.length = 0;
  const t0 = r.now();
  r.press('reload');
  r.step(1);
  const heard = r.log.length;
  for (let i = 0; i < 600; i++) r.vm.update(0);
  assert.equal(r.log.length, heard, 'no cue while frozen');
  assert.equal(r.vm.reloading, true);
  assert.equal(r.vm.ammoOf('pistol').loaded, 8);
  r.step(3);
  assert.ok(Math.abs((times(r, 'reloaded pistol')[0] ?? NaN) - t0 - 3.67) < 0.06, 'after the same 3.67 s of play');
});

test('pistol: an empty magazine reloads with the same animation at the same speed', () => {
  const r = rig();
  fireShots(r, 12, 0.3);
  assert.equal(r.vm.ammoOf('pistol').loaded, 0);
  r.log.length = 0;
  const t0 = r.now();
  r.press('reload');
  r.step(4);
  assert.ok(Math.abs((times(r, 'reloaded pistol')[0] ?? NaN) - t0 - 3.67) < 0.06);
  assert.equal(r.vm.ammoOf('pistol').loaded, 12);
});

test('pistol: no shot during the reload, and switching away cancels it without adding rounds', () => {
  const r = rig();
  fireShots(r, 4, 0.3);
  r.log.length = 0;
  r.press('reload');
  r.step(1);
  r.press('fire');
  assert.deepEqual(times(r, 'fired pistol'), [], 'the trigger does nothing mid-reload');
  r.press('weapon2');
  r.step(3);
  assert.equal(r.vm.ammoOf('pistol').loaded, 8, 'no rounds added');
  assert.deepEqual(times(r, 'reloaded pistol'), [], 'the reload never finished');
  assert.equal(r.vm.weapon, 'shotgun');
});

function toShotgun(r: Rig): void {
  r.press('weapon2');
  r.step(2);
  assert.equal(r.vm.weapon, 'shotgun');
  r.log.length = 0;
}

test('shotgun: a shot is one motion, the pump sound and hull come 0.58 s in, and the next shot waits for the pump to be home', () => {
  const r = rig();
  toShotgun(r);
  const t0 = r.now();
  r.press('fire');
  r.step(0.5);
  r.press('fire');
  assert.equal(times(r, 'fired shotgun').length, 1, 'too soon for a second shot');
  r.step(0.5);
  const pump = (times(r, 'cue pump')[0] ?? NaN) - t0;
  assert.ok(Math.abs(pump - CUES.shotgun.pump) < 0.06, `pump cue at ${pump}`);
  assert.equal(times(r, 'cue pump').length, 1);
  r.press('fire');
  assert.equal(times(r, 'fired shotgun').length, 2, 'ready again by 0.85 s');
});

test('shotgun: a reload is an opening, one loading motion per shell, then a closing motion that racks the pump', () => {
  const r = rig();
  toShotgun(r);
  fireShots(r, 3, 0.95);
  assert.equal(r.vm.ammoOf('shotgun').loaded, 3);
  r.log.length = 0;
  const t0 = r.now();
  r.press('reload');
  r.step(4);
  const shells = times(r, 'shell').map((t) => +(t - t0).toFixed(2));
  assert.equal(shells.length, 3, 'three shells go in');
  assert.ok(Math.abs(shells[0]! - (0.63 + CUES.shotgun.shell)) < 0.06, `first shell at ${shells[0]}`);
  assert.ok(Math.abs(shells[1]! - shells[0]! - 0.71) < 0.06, 'one shell per 0.71 s motion');
  const pump = (times(r, 'cue pump')[0] ?? NaN) - t0;
  assert.ok(Math.abs(pump - (0.63 + 3 * 0.71 + CUES.shotgun.pumpEnd)) < 0.08, `closing rack at ${pump}`);
  assert.ok(Math.abs((times(r, 'reloaded shotgun')[0] ?? NaN) - t0 - (0.63 + 3 * 0.71 + 0.71)) < 0.08);
  assert.equal(r.vm.ammoOf('shotgun').loaded, 6);
});

test('shotgun: firing mid-reload ends it at once with the shells already loaded kept', () => {
  const r = rig();
  toShotgun(r);
  fireShots(r, 3, 0.95);
  r.log.length = 0;
  r.press('reload');
  r.step(0.63 + CUES.shotgun.shell + 0.1);
  assert.equal(times(r, 'shell').length, 1);
  assert.equal(r.vm.ammoOf('shotgun').loaded, 4);
  r.press('fire');
  assert.equal(times(r, 'fired shotgun').length, 1, 'the shot is fired');
  assert.equal(times(r, 'reloaded shotgun').length, 1, 'and the reload ended');
  assert.equal(r.vm.ammoOf('shotgun').loaded, 3, 'one loaded, one fired: the other shells stay');
  r.step(3);
  assert.equal(times(r, 'shell').length, 1, 'no more shells go in');
});

test('shotgun: with no shell loaded yet, firing mid-reload does nothing', () => {
  const r = rig();
  toShotgun(r);
  fireShots(r, 6, 0.95);
  assert.equal(r.vm.ammoOf('shotgun').loaded, 0);
  r.log.length = 0;
  r.press('reload');
  r.step(0.2);
  r.press('fire');
  assert.deepEqual(times(r, 'fired shotgun'), []);
  r.step(1);
  assert.ok(times(r, 'shell').length >= 1, 'the reload carries on');
});

const cuesIn = (r: Rig): `cue ${WeaponCue}`[] => r.log.filter((e) => e.what.startsWith('cue ')).map((e) => e.what as `cue ${WeaponCue}`);
/** From pressing the pistol's key with the shotgun out to its slide sound: Hide, Take, then the rack up to the cue. */
const PISTOL_RACK_AT = 0.63 + 0.33 + (CUES.pistol.slide - CUES.pistol.rackFrom);

test('the draw racks the shotgun pump, and the pistol draw ends in a slide rack with one sound', () => {
  const r = rig();
  r.press('weapon2');
  r.step(2);
  assert.deepEqual(cuesIn(r), ['cue pump'], 'the shotgun racks as it comes up');
  r.log.length = 0;
  const loaded = r.vm.ammoOf('pistol').loaded;
  const t0 = r.now();
  r.press('weapon1');
  r.step(1.1);
  assert.equal(r.models.pistol.clip, 'Reload', 'the rack is the end of the reload motion');
  assert.equal(r.vm.reloading, false, 'but it is not a reload');
  r.step(2);
  assert.deepEqual(cuesIn(r), ['cue slide']);
  assert.ok(Math.abs((times(r, 'cue slide')[0] ?? NaN) - t0 - PISTOL_RACK_AT) < 0.08, `slide at ${(times(r, 'cue slide')[0] ?? NaN) - t0}`);
  assert.equal(r.models.pistol.clip, 'Rest', 'then it settles');
  assert.deepEqual(times(r, 'reloaded pistol'), []);
  assert.equal(r.vm.ammoOf('pistol').loaded, loaded);
});

test('pistol: a shot cuts the draw rack short, without its sound', () => {
  const r = rig();
  toShotgun(r);
  r.press('weapon1');
  r.step(0.63 + 0.33 + 0.2);
  r.press('fire');
  assert.equal(times(r, 'fired pistol').length, 1, 'the rack does not hold the trigger');
  r.step(2);
  assert.deepEqual(cuesIn(r), []);
  assert.equal(r.models.pistol.clip, 'Rest');
});

test('the rest pose breathes: the weapon is never perfectly still, and the drift is small', () => {
  const r = rig();
  const root = r.models.pistol.root;
  const seen = new Set<string>();
  let maxY = -Infinity;
  let minY = Infinity;
  for (let i = 0; i < 300; i++) {
    r.step(DT);
    seen.add(root.position.y.toFixed(6));
    maxY = Math.max(maxY, root.position.y);
    minY = Math.min(minY, root.position.y);
  }
  assert.ok(seen.size > 20, 'the position keeps changing over 5 s');
  assert.ok(maxY - minY < 0.0045, `a few millimetres at most, not ${((maxY - minY) * 1000).toFixed(1)} mm`);
});

test('with reduced motion the weapon does not breathe', () => {
  const r = rig(true);
  const root = r.models.pistol.root;
  const first = root.position.toArray();
  const rot = root.rotation.toArray();
  r.step(5);
  assert.deepEqual(root.position.toArray(), first);
  assert.deepEqual(root.rotation.toArray(), rot);
});
