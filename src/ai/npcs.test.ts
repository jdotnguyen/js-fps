import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import type { GoreSystem } from '../actors/gore.ts';
import type { Interactable } from '../actors/interaction.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { SequenceManager } from '../script/runtime.ts';
import { validateSequences } from '../script/schema.ts';
import type { SequenceHost } from '../script/host.ts';
import type { Flags, SequenceDef, TargetRef } from '../script/types.ts';
import { demoRoomPlayerWorld } from '../world/demoRoomColliders.ts';
import { castSpec, CAST, CREW_LOOKS } from '../actors/castLooks.ts';
import { gridNodes, NavGraph } from './nav.ts';
import { NpcDirector, type NpcSpawn } from './npcs.ts';
import { Squad, type SquadPlayer } from './squad.ts';

const poses = new PoseLibrary(loadPoseFile(posesJson));
const ctx = { poses, gore: {} as GoreSystem };
const ANCHORS: Record<string, { pos: [number, number, number]; yaw?: number }> = {
  a: { pos: [0, 0, 4], yaw: Math.PI / 2 },
  b: { pos: [1, 0, -4] },
  offer: { pos: [0, 0, 6], yaw: 0 },
};

function setup(opts: { squad?: boolean; running?: () => boolean; obstacles?: () => Array<{ x: number; z: number; r: number }> } = {}) {
  const pw = demoRoomPlayerWorld();
  const nav = new NavGraph({ world: pw.colliders, nodes: gridNodes(pw.colliders, { minX: -2.5, maxX: 2.5, minZ: -9.5, maxZ: 9.5, maxY: 0.5 }, 1) });
  const player = {
    body: { x: 0, y: 0, z: 8, vy: 0, grounded: true },
    yaw: 0,
    aimBlend: 0,
    velocity: { x: 0, y: 0 },
    viewDirection: (o = new THREE.Vector3()) => o.set(0, 0, -1),
    eyePosition(o = new THREE.Vector3()) {
      return o.set(this.body.x, this.body.y + 1.62, this.body.z);
    },
  };
  const squad = opts.squad ? new Squad({ ctx, nav, player: player as SquadPlayer }) : null;
  const interactables: Interactable[] = [];
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const warnings: string[] = [];
  let handlers: Map<string, Set<(p: unknown) => void>> = new Map();
  const npcs = new NpcDirector({
    ctx,
    nav,
    colliders: pw.colliders,
    squad,
    player: () => ({ feet: new THREE.Vector3(player.body.x, 0, player.body.z), head: player.eyePosition() }),
    interact: (item) => {
      interactables.push(item);
      return () => interactables.splice(interactables.indexOf(item), 1);
    },
    emit: (name, payload) => {
      emitted.push({ name, payload });
      for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
    },
    warn: (m) => warnings.push(m),
    ...(opts.obstacles ? { obstacles: opts.obstacles } : {}),
    ...(opts.running ? { sequenceRunning: opts.running } : {}),
  });
  const resolveRef = (ref: TargetRef) => {
    if (Array.isArray(ref)) return { pos: { x: ref[0], y: ref[1], z: ref[2] } };
    if (ref.startsWith('anchor:')) {
      const a = ANCHORS[ref.slice(7)];
      return a ? { pos: { x: a.pos[0], y: a.pos[1], z: a.pos[2] }, yaw: a.yaw } : null;
    }
    if (ref.startsWith('npc:')) {
      const h = npcs.head(ref.slice(4));
      return h ? { pos: h } : null;
    }
    return null;
  };
  npcs.setResolver(resolveRef);
  const flags: Flags = {};
  const host: SequenceHost = {
    events: {
      on(name, fn) {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set);
        set.add(fn);
        return () => set.delete(fn);
      },
      emit(name, payload) {
        emitted.push({ name, payload });
        for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
      },
    },
    flags,
    resolve: (ref) => resolveRef(ref)?.pos ?? null,
    warn: (m) => warnings.push(m),
    npc: (action, step) => npcs.command(action, step),
  };
  const reset = () => (handlers = new Map());
  return { npcs, squad, player, interactables, emitted, warnings, host, flags, reset };
}

const seq = (steps: unknown[], skippable = true): SequenceDef => validateSequences({ 't.json': { id: 't', skippable, steps } })[0]!;

async function run(m: SequenceManager, npcs: NpcDirector, seconds: number, squad?: Squad | null): Promise<void> {
  for (let i = 0; i < seconds * 60 && m.running().length; i++) {
    m.update(1 / 60);
    squad?.update(1 / 60, null);
    npcs.update(1 / 60, null);
    if (i % 3 === 0) await Promise.resolve();
  }
}

test('cast looks: every named character and crew look builds, and unknown looks fall back to crew', () => {
  for (const id of ['priya', 'heins', 'hale', 'cook', 'bram', 'ruiz', 'sung', 'giles', 'okafor']) assert.ok(CAST[id], id);
  assert.equal(CAST['heins']!.look?.hair, '#6b3a8f', 'Katie Heins: purple hair');
  assert.equal(CAST['heins']!.look?.cropped, true, 'short');
  assert.equal(CAST['priya']!.outfit, 'medic');
  for (const id of ['botanist', 'diver', 'exec', 'maintenance', 'security', 'crew']) assert.ok(CREW_LOOKS.includes(id), id);
  const warned: string[] = [];
  assert.equal(castSpec('wizard', 'n1', (m) => warned.push(m)).outfit, 'crew');
  assert.equal(warned.length, 1);
  assert.notEqual(castSpec('crew', 'a').seed, castSpec('crew', 'b').seed, 'crew faces vary by npc id');
  const { npcs } = setup();
  const looks = [...Object.keys(CAST), ...CREW_LOOKS];
  npcs.spawnFromLevel(looks.filter((l) => !['giles', 'okafor'].includes(l)).map((look, i) => ({ id: `n_${look}`, look, pos: new THREE.Vector3(0, 0, -8 + i), yaw: 0 })));
  for (let i = 0; i < 10; i++) npcs.update(1 / 60, null);
  assert.equal(npcs.group.children.length, looks.length - 2, 'every look builds a body');
});

test('level NPCs spawn with their looks and idle poses; unknown poses warn and fall back', () => {
  const { npcs, warnings } = setup();
  const spawns: NpcSpawn[] = [
    { id: 'priya', look: 'priya', pos: new THREE.Vector3(0, 0, 2), yaw: 0 },
    { id: 'cook', look: 'cook', pos: new THREE.Vector3(1, 0, 0), yaw: 1, pose: 'idle_crossed' },
    { id: 'bot1', look: 'botanist', pos: new THREE.Vector3(-1, 0, -2), yaw: 0, pose: 'nope' },
  ];
  npcs.spawnFromLevel(spawns);
  assert.ok(npcs.has('priya') && npcs.has('cook') && npcs.has('bot1'));
  assert.equal(npcs.actor('cook')!.body.idlePose, 'idle_crossed');
  assert.equal(npcs.actor('bot1')!.body.idlePose, 'idle');
  assert.ok(warnings.some((w) => w.includes('nope')));
  assert.equal(npcs.group.children.length, 3);
  const head = npcs.head('priya')!;
  assert.ok(head.y > 1.3 && head.y < 1.8, `head height ${head.y.toFixed(2)}`);
  // Ambient: they keep standing where they were put (gestures only).
  for (let i = 0; i < 600; i++) npcs.update(1 / 60, null);
  assert.ok(npcs.actor('priya')!.position.distanceTo(spawns[0]!.pos as THREE.Vector3) < 0.05);
  // A scripted move then reset returns them to their spawn.
  void npcs.command('npcMoveTo', { npc: 'priya', to: 'anchor:b', instant: true });
  npcs.reset();
  assert.ok(npcs.actor('priya')!.position.distanceTo(spawns[0]!.pos as THREE.Vector3) < 1e-6);
});

test('npcMoveTo walks there and resolves for wait; it ends facing the anchor yaw; instant teleports', async () => {
  const { npcs, host } = setup();
  npcs.spawnFromLevel([{ id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -4), yaw: 0 }]);
  const m = new SequenceManager(host, [seq([{ do: 'npcMoveTo', npc: 'ruiz', to: 'anchor:a', wait: true }, { do: 'setFlag', flag: 'arrived', value: true }])]);
  m.start('t');
  await run(m, npcs, 20);
  assert.equal(host.flags['arrived'], true);
  const a = npcs.actor('ruiz')!;
  assert.ok(Math.hypot(a.position.x, a.position.z - 4) < 0.35, `arrived (${a.position.x.toFixed(2)}, ${a.position.z.toFixed(2)})`);
  for (let i = 0; i < 120; i++) npcs.update(1 / 60, null);
  assert.ok(Math.abs(Math.atan2(Math.sin(a.body.heading - Math.PI / 2), Math.cos(a.body.heading - Math.PI / 2))) < 0.1, 'turned to the anchor yaw');
  await npcs.command('npcMoveTo', { npc: 'ruiz', to: 'anchor:b', instant: true });
  assert.ok(Math.hypot(a.position.x - 1, a.position.z + 4) < 1e-6);
});

test('skipping a scene mid-walk lands every NPC at its end state (teleport, final pose)', async () => {
  const { npcs, host } = setup();
  npcs.spawnFromLevel([
    { id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -4), yaw: 0 },
    { id: 'sung', look: 'sung', pos: new THREE.Vector3(1, 0, -6), yaw: 0 },
  ]);
  const m = new SequenceManager(host, [
    seq([
      { do: 'npcMoveTo', npc: 'ruiz', to: 'anchor:a', wait: true },
      { do: 'npcAnim', npc: 'ruiz', anim: 'drink', wait: true },
      { do: 'npcMoveTo', npc: 'sung', to: 'anchor:b' },
      { do: 'npcAnim', npc: 'sung', anim: 'typing' },
      { do: 'transform', npc: 'sung', to: 2, duration: 6, wait: true },
    ]),
  ]);
  m.start('t');
  await run(m, npcs, 1);
  assert.equal(m.skip(), true);
  assert.deepEqual(m.running(), []);
  const r = npcs.actor('ruiz')!;
  const s = npcs.actor('sung')!;
  assert.ok(Math.hypot(r.position.x, r.position.z - 4) < 1e-6, 'ruiz teleported to his mark');
  assert.equal(r.body.idlePose, 'idle', 'a gesture is over after a skip');
  assert.ok(Math.hypot(s.position.x - 1, s.position.z + 4) < 1e-6);
  assert.equal(s.body.idlePose, 'typing', 'a held pose is the end state');
  assert.equal(s.body.infection, 2, 'transform jumps to its stage');
  assert.equal(r.moving, false);
});

test('npcAnim gestures time out back to the base pose; npcLookAt and npc: targets', async () => {
  const { npcs } = setup();
  npcs.spawnFromLevel([{ id: 'priya', look: 'priya', pos: new THREE.Vector3(0, 0, 2), yaw: 0 }]);
  const a = npcs.actor('priya')!;
  let done = false;
  void npcs.command('npcAnim', { npc: 'priya', anim: 'glance' }).then(() => (done = true));
  assert.equal(a.body.idlePose, 'glance');
  for (let i = 0; i < 120; i++) npcs.update(1 / 60, null);
  await Promise.resolve();
  assert.equal(done, true);
  assert.equal(a.body.idlePose, 'idle');
  void npcs.command('npcLookAt', { npc: 'priya', target: 'player' });
  npcs.update(1 / 60, null);
  assert.ok(a.body.lookTarget && Math.abs(a.body.lookTarget.z - 8) < 1e-6);
});

test('npcOffer: Priya holds out the mug, taking it emits the event, the mug goes to Jay', async () => {
  const { npcs, host, interactables, emitted, flags } = setup();
  npcs.spawnFromLevel([{ id: 'priya', look: 'priya', pos: new THREE.Vector3(0, 0, 6), yaw: 0 }]);
  const m = new SequenceManager(host, [seq([{ do: 'npcOffer', npc: 'priya', item: 'mug', prompt: 'Take coffee', event: 'intro:coffee_taken', timeout: 6, wait: true }, { do: 'setFlag', flag: 'after', value: true }])]);
  m.start('t');
  await run(m, npcs, 0.5);
  assert.equal(npcs.offering('priya'), 'mug');
  assert.equal(npcs.actor('priya')!.body.idlePose, 'offer_mug');
  assert.equal(interactables.length, 1);
  assert.equal(interactables[0]!.prompt, 'Take coffee');
  interactables[0]!.use();
  await run(m, npcs, 0.5);
  assert.ok(emitted.some((e) => e.name === 'intro:coffee_taken'));
  assert.equal(flags['after'], true, 'the sequence moved on');
  assert.equal(flags['held:mug'], true);
  assert.equal(npcs.offering('priya'), null);
  assert.equal(interactables.length, 0, 'prompt removed');
  assert.equal(npcs.actor('priya')!.body.idlePose, 'idle');
});

test('npcOffer: ignored, it ends by itself after the timeout; skipped, it ends handed over', async () => {
  {
    const { npcs, host, flags, interactables } = setup();
    npcs.spawnFromLevel([{ id: 'priya', look: 'priya', pos: new THREE.Vector3(0, 0, 6), yaw: 0 }]);
    const m = new SequenceManager(host, [seq([{ do: 'npcOffer', npc: 'priya', item: 'mug', timeout: 2, wait: true }])]);
    m.start('t');
    await run(m, npcs, 3);
    assert.deepEqual(m.running(), []);
    assert.equal(flags['held:mug'], true);
    assert.equal(interactables.length, 0);
    assert.equal(npcs.offering('priya'), null);
  }
  {
    const { npcs, host, flags, interactables, emitted } = setup();
    npcs.spawnFromLevel([{ id: 'priya', look: 'priya', pos: new THREE.Vector3(0, 0, 6), yaw: 0 }]);
    const m = new SequenceManager(host, [seq([{ do: 'npcOffer', npc: 'priya', item: 'mug', timeout: 6, wait: true }, { do: 'npcMoveTo', npc: 'priya', to: 'anchor:b' }])]);
    m.start('t');
    await run(m, npcs, 0.5);
    m.skip();
    assert.equal(flags['held:mug'], true);
    assert.equal(npcs.offering('priya'), null);
    assert.equal(interactables.length, 0);
    assert.ok(!emitted.some((e) => e.name === 't:offer_taken'), 'nobody took it, so no taken event');
    assert.ok(Math.hypot(npcs.actor('priya')!.position.x - 1, npcs.actor('priya')!.position.z + 4) < 1e-6, 'at her exit mark');
  }
});

test('a sequence borrows Giles: his AI yields, he goes back to following when the scene ends', async () => {
  let running = true;
  const { npcs, squad, host } = setup({ squad: true, running: () => running });
  squad!.update(1 / 60, null);
  const giles = squad!.mate('engineer');
  const m = new SequenceManager(host, [seq([{ do: 'npcMoveTo', npc: 'giles', to: [0, 0, -4], wait: true }])]);
  m.start('t');
  await run(m, npcs, 1, squad);
  assert.equal(giles.scripted, true);
  await run(m, npcs, 20, squad);
  assert.ok(Math.hypot(giles.position.x, giles.position.z + 4) < 0.4, 'walked where the script said, away from Jay');
  running = false;
  npcs.update(1 / 60, null);
  assert.equal(giles.scripted, false, 'released');
  assert.ok(npcs.head('okafor')!.y > 1.3, 'npc:okafor resolves to his head');
  // npcTask through the director: the squad AI runs it and the promise resolves when done.
  let done = false;
  void npcs.command('npcTask', { npc: 'giles', task: 'unlock_locker', args: { at: [1, 0, 6] } }).then(() => (done = true));
  for (let i = 0; i < 60 * 20 && !done; i++) {
    squad!.update(1 / 60, null);
    npcs.update(1 / 60, null);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.equal(done, true);
  // Skipped task: done at once, at the panel.
  await npcs.command('npcTask', { npc: 'giles', task: 'power_restore', args: { at: [-1, 0, 5] }, instant: true });
  assert.ok(Math.hypot(giles.position.x + 1, giles.position.z - 5) < 1e-6);
  assert.equal(giles.task, null);
});

test('spawn and despawn by script', async () => {
  const { npcs } = setup();
  await npcs.command('spawn', { npc: 'lab_researcher_01', kind: 'lab', at: [0, 0, -2] });
  assert.ok(npcs.has('lab_researcher_01'));
  await npcs.command('transform', { npc: 'lab_researcher_01', to: 3, instant: true });
  assert.equal(npcs.actor('lab_researcher_01')!.body.infection, 3);
  await npcs.command('despawn', { npc: 'lab_researcher_01' });
  assert.equal(npcs.has('lab_researcher_01'), false);
});

test('a body moved by script holds a lying pose, never the walking gait (npcMoveTo pose, npcDrag)', async () => {
  const { npcs, host } = setup();
  npcs.spawnFromLevel([
    { id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -4), yaw: 0 },
    { id: 'sung', look: 'sung', pos: new THREE.Vector3(1, 0, -6), yaw: 0 },
  ]);
  const r = npcs.actor('ruiz')!;
  const s = npcs.actor('sung')!;
  // A plain walker plays the walk pose.
  void npcs.command('npcMoveTo', { npc: 'sung', to: 'anchor:a' });
  for (let i = 0; i < 90; i++) npcs.update(1 / 60, null);
  assert.equal(s.body.poseName, 'walk');
  // A downed body walked with `pose` stays lying until the move ends.
  let arrived = false;
  void npcs.command('npcMoveTo', { npc: 'ruiz', to: 'anchor:a', pose: 'corpseSupine' }).then(() => (arrived = true));
  for (let i = 0; i < 90; i++) {
    npcs.update(1 / 60, null);
    assert.equal(r.body.poseName, 'corpseSupine');
    assert.equal(r.body.carried, 'corpseSupine');
  }
  for (let i = 0; i < 1200 && !arrived; i++) {
    npcs.update(1 / 60, null);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.equal(arrived, true);
  for (let i = 0; i < 5; i++) npcs.update(1 / 60, null);
  assert.equal(r.body.carried, null, 'the pose is released when the move ends');
  // Dragged on a rope: trails the dragger, lying, at most the rope length behind, letting go leaves it there.
  await npcs.command('npcMoveTo', { npc: 'ruiz', to: [0, 0, -4], instant: true });
  await npcs.command('npcMoveTo', { npc: 'sung', to: [0.5, 0, -4.5], instant: true });
  await npcs.command('npcDrag', { npc: 'ruiz', by: 'sung', distance: 1.1 });
  assert.equal(r.towed, true);
  void npcs.command('npcMoveTo', { npc: 'sung', to: 'anchor:a', speed: 1.1 });
  let maxGap = 0;
  for (let i = 0; i < 60 * 12; i++) {
    npcs.update(1 / 60, null);
    assert.equal(r.body.poseName, 'corpseSupine', 'no walking gait while dragged');
    if (i > 240) maxGap = Math.max(maxGap, r.position.distanceTo(s.position));
  }
  assert.ok(maxGap <= 1.25, `rope length held (${maxGap.toFixed(2)})`);
  assert.ok(Math.hypot(r.position.x - s.position.x, r.position.z - s.position.z) > 0.9, 'trailing behind, not on top');
  assert.ok(r.position.z > 2, `followed the dragger up the room (z ${r.position.z.toFixed(2)})`);
  await npcs.command('npcDrag', { npc: 'ruiz', stop: true });
  assert.equal(r.towed, false);
  assert.equal(r.body.carried, null);
  // Skip and reset both let go.
  await npcs.command('npcDrag', { npc: 'ruiz', by: 'sung' });
  await npcs.command('npcDrag', { npc: 'ruiz', by: 'sung', instant: true });
  assert.equal(r.towed, false);
  await npcs.command('npcDrag', { npc: 'ruiz', by: 'sung' });
  npcs.reset();
  assert.equal(r.towed, false);
  void host;
});

test('attachToTrack builds a track from anchor refs through the nav graph and the body follows it', async () => {
  const { npcs } = setup();
  npcs.spawnFromLevel([{ id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -6), yaw: 0 }]);
  const pts = npcs.trackPoints('anchor:a,anchor:b', { x: 0, y: 0, z: -6 })!;
  assert.ok(pts.length >= 2);
  assert.ok(Math.hypot(pts[pts.length - 1]!.x - 1, pts[pts.length - 1]!.z + 4) < 1e-6, 'ends on the last anchor');
  assert.ok(pts.some((p) => Math.hypot(p.x, p.z - 4) < 0.6), 'passes the first anchor');
  assert.equal(npcs.trackPoints('nope', { x: 0, y: 0, z: 0 }), null);
  assert.equal(npcs.trackPoints('anchor:missing', { x: 0, y: 0, z: 0 }), null);
  let done = false;
  void npcs.command('attachToTrack', { npc: 'ruiz', track: 'anchor:a,anchor:b', pose: 'corpseSupine', speed: 2 }).then(() => (done = true));
  const a = npcs.actor('ruiz')!;
  let passedA = false;
  for (let i = 0; i < 60 * 40 && !done; i++) {
    npcs.update(1 / 60, null);
    if (i % 3 === 0) await Promise.resolve();
    if (done || !a.moving) break;
    if (Math.hypot(a.position.x, a.position.z - 4) < 0.7) passedA = true;
    assert.equal(a.body.poseName, 'corpseSupine');
  }
  await Promise.resolve();
  assert.equal(done, true);
  assert.equal(passedA, true, 'went via the first anchor, not straight to the end');
  assert.ok(Math.hypot(a.position.x - 1, a.position.z + 4) < 0.4);
});

const gap = (a: { position: THREE.Vector3; body: { footprint: { r: number } } }, b: { position: THREE.Vector3; body: { footprint: { r: number } } }): number =>
  Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) - a.body.footprint.r - b.body.footprint.r;

test('actor separation: overlapping NPCs ease apart, the player and enemies are not moved, work poses stay put', async () => {
  const enemy = { x: 1.5, z: -4, r: 0.3 };
  const { npcs } = setup({ obstacles: () => [enemy] });
  npcs.spawnFromLevel([
    { id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -4), yaw: 0 },
    { id: 'sung', look: 'sung', pos: new THREE.Vector3(0.05, 0, -4), yaw: 0 },
    { id: 'bram', look: 'bram', pos: new THREE.Vector3(1.4, 0, -4), yaw: 0 },
  ]);
  const [r, s, b] = [npcs.actor('ruiz')!, npcs.actor('sung')!, npcs.actor('bram')!];
  void npcs.command('npcAnim', { npc: 'bram', anim: 'typing' });
  const bramX = b.position.x;
  for (let i = 0; i < 180; i++) npcs.update(1 / 60, null);
  assert.ok(gap(r, s) > -0.05, `ruiz/sung apart (${gap(r, s).toFixed(2)})`);
  assert.equal(b.position.x, bramX, 'a typist is not shoved off the console, even by an enemy');
  assert.equal(enemy.x, 1.5);
});

test('actor separation: a walking NPC still arrives where a standing one blocks the goal, and an instant placement is exact', async () => {
  const { npcs, host } = setup();
  npcs.spawnFromLevel([
    { id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -4), yaw: 0 },
    { id: 'sung', look: 'sung', pos: new THREE.Vector3(0.1, 0, 3.8), yaw: 0 },
  ]);
  const m = new SequenceManager(host, [seq([{ do: 'npcMoveTo', npc: 'ruiz', to: 'anchor:a', wait: true }, { do: 'setFlag', flag: 'arrived', value: true }])]);
  m.start('t');
  await run(m, npcs, 30);
  assert.equal(host.flags['arrived'], true, 'the move resolved');
  const r = npcs.actor('ruiz')!;
  const s = npcs.actor('sung')!;
  assert.ok(Math.hypot(r.position.x, r.position.z - 4) < 0.35, 'walker stands on the anchor');
  for (let i = 0; i < 240; i++) npcs.update(1 / 60, null);
  assert.ok(gap(r, s) > -0.05, `the standing one made room (${gap(r, s).toFixed(2)})`);
  // Teleport lands exactly; it only eases apart afterwards, never snaps on the same step.
  await npcs.command('npcMoveTo', { npc: 'ruiz', to: [0.1, 0, 3.8], instant: true });
  assert.ok(Math.hypot(r.position.x - 0.1, r.position.z - 3.8) < 1e-6);
});

test('actor separation: a dragged body is excluded, a lent squadmate is pushed off the player but not into a wall of other bodies', async () => {
  const { npcs, squad, player } = setup({ squad: true });
  squad!.update(1 / 60, null);
  await npcs.command('npcMoveTo', { npc: 'giles', to: [player.body.x, 0, player.body.z], instant: true });
  const giles = squad!.mate('engineer');
  for (let i = 0; i < 120; i++) npcs.update(1 / 60, null);
  assert.ok(Math.hypot(giles.position.x - player.body.x, giles.position.z - player.body.z) > 0.5, 'stepped off the player');
  npcs.spawnFromLevel([{ id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -4), yaw: 0 }, { id: 'sung', look: 'sung', pos: new THREE.Vector3(0, 0, -4), yaw: 0 }]);
  await npcs.command('npcDrag', { npc: 'ruiz', by: 'sung', distance: 0.1 });
  const r = npcs.actor('ruiz')!;
  const before = r.position.clone();
  for (let i = 0; i < 30; i++) npcs.update(1 / 60, null);
  assert.ok(r.towed);
  assert.ok(r.position.distanceTo(before) < 0.2, 'a towed body is moved by the rope only');
});

test('two people walking head-on pass each other without bumping, and both arrive (ADR-0028)', async () => {
  const { npcs } = setup();
  npcs.spawnFromLevel([
    { id: 'ruiz', look: 'ruiz', pos: new THREE.Vector3(0, 0, -5), yaw: 0 },
    { id: 'sung', look: 'sung', pos: new THREE.Vector3(0.1, 0, 5), yaw: Math.PI },
  ]);
  let done = 0;
  void npcs.command('npcMoveTo', { npc: 'ruiz', to: [0, 0, 5] }).then(() => done++);
  void npcs.command('npcMoveTo', { npc: 'sung', to: [0.1, 0, -5] }).then(() => done++);
  const a = npcs.actor('ruiz')!;
  const b = npcs.actor('sung')!;
  const touch = a.body.footprint.r + b.body.footprint.r;
  let minGap = Infinity;
  for (let i = 0; i < 60 * 25 && done < 2; i++) {
    npcs.update(1 / 60, null);
    minGap = Math.min(minGap, Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) - touch);
    if (i % 3 === 0) await Promise.resolve();
  }
  assert.equal(done, 2, 'both arrived');
  assert.ok(minGap > 0.05, `kept apart while passing (closest gap ${minGap.toFixed(2)} m)`);
  assert.ok(Math.hypot(a.position.x, a.position.z - 5) < 0.4 && Math.hypot(b.position.x - 0.1, b.position.z + 5) < 0.4, 'each at its spot');
});
