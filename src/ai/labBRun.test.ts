import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { KillEvent, KillTable } from '../data/types/kills.ts';
import { JOINT_NAMES, type JointName } from '../actors/skeleton.ts';
import { clearance, labBKill, worldCapsules, type Solid, type WorldCapsule } from './labBKillTestKit.ts';

/**
 * Voss's staged run and her collapse (voss-death-scene §4; infection-kills "Voss's staged run to the glass" and "Voss
 * collapses down the pane"), played once on the real Lab B (headless slice01) with her imported body and the blade
 * creature that comes out of her. Every frame of the run and the collapse is measured against the room's furniture.
 *
 * Her body is measured by its hit capsules, which are a little fuller than her skin: a part passes through something when
 * its bone runs more than `THROUGH` into it, and touches it when its capsule is within 5 cm of it.
 */
const THROUGH = 0.03;
const kills = JSON.parse(readFileSync(new URL('../data/kills.json', import.meta.url), 'utf8')) as KillTable;
const beatOf = (id: string) => kills['grownInside']!.beats.find((b) => b.id === id)!;
const joints = JOINT_NAMES.filter((j) => j !== 'root' && j !== 'jaw');

interface Frame {
  t: number;
  beat: string;
  beatT: number;
  hips: THREE.Vector3;
  heading: number;
  at: Map<JointName, THREE.Vector3>;
  caps: WorldCapsule[];
}

async function played() {
  const g = await labBKill({ creature: true });
  const done: Array<{ do: KillEvent['do']; t: number; beat: string }> = [];
  // Every kill event as it fires, on the kill's own clock.
  const director = g.npcs.kills as unknown as { event: (k: unknown, e: KillEvent) => void };
  const fire = director.event.bind(g.npcs.kills);
  let asked = 0;
  director.event = (k, e) => {
    done.push({ do: e.do, t: g.time() - asked, beat: g.npcs.kills.running('researcher_b')?.beatId ?? '' });
    fire(k, e);
  };
  g.start();
  g.run(1.5);
  g.ask();
  asked = g.time();
  const frames: Frame[] = [];
  const b = g.voss.body;
  g.run(15.1, () => {
    const r = g.npcs.kills.running('researcher_b');
    if (!r || !['panic', 'glass', 'arch', 'burst', 'still'].includes(r.beatId ?? '')) return;
    frames.push({ t: g.time() - asked, beat: r.beatId!, beatT: r.beatTime, hips: b.jointWorld('pelvis', new THREE.Vector3()), heading: b.heading, at: new Map(joints.map((j) => [j, b.jointWorld(j, new THREE.Vector3())])), caps: worldCapsules(b) });
  });
  const rest = b.jointWorld('pelvis', new THREE.Vector3());
  // The creature pounding on the glass, and every part of her against its feet.
  const creature = g.creature()!;
  let nearFeet = Infinity;
  const seg = new THREE.Line3();
  const p = new THREE.Vector3();
  g.run(3, () => {
    for (const f of ['foot_L', 'foot_R'] as const) {
      const foot = creature.body.jointWorld(f, new THREE.Vector3());
      for (const c of worldCapsules(b)) nearFeet = Math.min(nearFeet, seg.set(c.a, c.b).closestPointToPoint(foot, true, p).distanceTo(foot) - c.r);
    }
  });
  return { g, frames, done, rest, nearFeet, pounding: g.npcs.kills.pounding('researcher_b_creature'), solids: [...g.furniture(), g.cartHandle()] };
}

const run = await played();
const panic = run.frames.filter((f) => f.beat === 'panic');
const still = run.frames.filter((f) => f.beat === 'still');
const solid = (id: string): Solid => run.solids.find((s) => s.id === id)!;
const cap = (f: Frame, joint: JointName): WorldCapsule => f.caps.find((c) => c.joint === joint)!;
const anchor = (id: string): THREE.Vector3 => run.g.anchor(id);
const across = (a: THREE.Vector3, b: THREE.Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);
/** The first frame of the run, from `after` on, where `ok` holds. */
const first = (after: number, ok: (f: Frame) => boolean): Frame | undefined => panic.find((f) => f.beatT >= after && ok(f));
/** Her trunk's lean forward (deg): from her hips to her neck, against the way she faces. */
const lean = (f: Frame): number => {
  const up = f.at.get('neck')!.clone().sub(f.hips);
  const h = f.heading;
  return (Math.atan2(-(up.x * Math.sin(h)) - up.z * Math.cos(h), up.y) * 180) / Math.PI;
};
/** A touch of the panic beat and the solid its mark is on. */
const touches = (beatOf('panic').events ?? []).filter((e) => e.do === 'touch');
const ON: Record<string, string> = { labb_bench_top: 'bench', labb_bench_hip: 'bench', labb_push_off: 'bench', labb_knee_floor: 'floor', labb_cart_handle: 'cartHandle' };
const PART_CAPSULE: Record<string, JointName> = { hand_L: 'hand_L', hand_R: 'hand_R', hip_L: 'thigh_L', hip_R: 'thigh_R', knee_L: 'shin_L', knee_R: 'shin_R', chest: 'chest' };
const toSurface = (f: Frame, part: string, on: string): number => {
  const c = cap(f, PART_CAPSULE[part]!);
  if (on === 'floor') return Math.min(c.a.y, c.b.y) - c.r;
  // A hand holding the handle: her wrist on the rail (her fingers close round it, so the hand itself goes past it).
  if (on === 'cartHandle') return clearance({ ...c, b: c.a, r: 0 }, solid(on));
  return clearance(c, solid(on));
};

test('infection-kills "The actions in order": she hits the bench, sweeps it, doubles over, pushes off, stumbles, nearly goes down, recovers, grabs the cart, pulls it over and reaches the glass', () => {
  const bench = anchor('labb_bench_edge');
  const hit = first(0, (f) => toSurface(f, 'hip_L', 'bench') <= 0.05);
  const sweep = run.done.find((e) => e.do === 'sweep');
  const doubled = first(sweep?.t ?? 0, (f) => lean(f) >= 35);
  const pushOff = first(doubled?.beatT ?? 0, (f) => f.at.get('hand_L')!.distanceTo(anchor('labb_push_off')) <= 0.05);
  const stumble = first(pushOff?.beatT ?? 0, (f) => across(f.hips, bench) >= 0.4);
  const knee = first(stumble?.beatT ?? 0, (f) => toSurface(f, 'knee_R', 'floor') <= 0.05);
  const recover = first(knee?.beatT ?? 0, (f) => f.hips.y >= 0.8);
  const grab = first(recover?.beatT ?? 0, (f) => f.at.get('hand_L')!.distanceTo(anchor('labb_cart_handle')) <= 0.05);
  const tip = run.done.find((e) => e.do === 'tip' && e.t >= (grab?.t ?? Infinity));
  const stand = new THREE.Vector3(8, 0, run.g.glassZ + 0.65);
  const glass = first(tip ? tip.t : Infinity, (f) => across(f.hips, stand) <= 0.1);
  const order = { hit, sweep, doubled, pushOff, stumble, knee, recover, grab, tip, glass };
  let last = -Infinity;
  for (const [name, at] of Object.entries(order)) {
    assert.ok(at, `${name} happens (after ${last.toFixed(2)} s)`);
    assert.ok(at.t > last, `${name} at ${at.t.toFixed(2)} s comes after the action before it (${last.toFixed(2)} s)`);
    last = at.t;
  }
  assert.ok(last < 6.5, `she reaches the glass within the panic beat (${last.toFixed(2)} s)`);
  assert.equal(sweep!.beat, 'panic');
});

test('infection-kills "Contacts touch": her hip and hands on the bench, her knee near the floor and her hand on the cart handle are within 5 cm of the surface, never through it', () => {
  assert.ok(touches.length >= 5, `${touches.length} contacts`);
  for (const e of touches) {
    const on = ON[e.mark!];
    assert.ok(on, `${e.mark} is on a known surface`);
    // When the part has fully reached its mark.
    const at = first(e.t + (e.blend ?? 0.15) + 1 / 60, () => true)!;
    const d = toSurface(at, e.part!, on!);
    assert.ok(d <= 0.05, `${e.part} at ${e.t} s is ${(d * 100).toFixed(1)} cm from the ${on}`);
    assert.ok(d >= -(cap(at, PART_CAPSULE[e.part!]!).r + THROUGH), `${e.part} at ${e.t} s does not go into the ${on} (${(d * 100).toFixed(1)} cm)`);
    if (on === 'cartHandle') assert.ok(at.at.get('hand_L')!.y >= solid('cart').top - 0.03, 'her wrist is over the cart, not in it');
  }
});

test('infection-kills "Nothing walked through": at every frame of the run, no part of her passes through the bench, the gurney, the cart or the glass', () => {
  const grip = touches.find((e) => e.mark === 'labb_cart_handle')!;
  const gripEnds = grip.t + 2 * (grip.blend ?? 0.15) + (grip.hold ?? 0.3);
  const worst: Record<string, { d: number; at: string }> = {};
  for (const f of panic) {
    for (const s of run.solids) {
      if (s.id === 'chair' || s.id === 'sill' || s.id === 'mullion') continue;
      for (const c of f.caps) {
        // Her hand holds the cart's handle while it is on it.
        if (s.id === 'cart' && (c.joint === 'hand_L' || c.joint === 'foreArm_L') && f.beatT <= gripEnds) continue;
        const d = -clearance(c, s) - c.r;
        const key = `${s.id}:${c.joint}`;
        if (d > (worst[key]?.d ?? -Infinity)) worst[key] = { d, at: f.beatT.toFixed(2) };
      }
    }
    for (const [j, p] of f.at) assert.ok(p.z >= run.g.glassZ, `${j} crosses the pane at ${f.beatT.toFixed(2)} s`);
  }
  for (const [key, w] of Object.entries(worst)) assert.ok(w.d <= THROUGH, `${key}: its bone ${(w.d * 100).toFixed(1)} cm inside at ${w.at} s`);
  assert.ok(panic.length > 250, `${panic.length} frames sampled`);
});

test('infection-kills "Down the pane": her chest or shoulder stays within 5 cm of the pane as she slides down it, and no joint of hers crosses it', () => {
  // Her chest's front is about 13 cm in front of its joint; her shoulder's outside about 5 cm.
  const front = (f: Frame): number => Math.min(f.at.get('chest')!.z - run.g.glassZ - 0.128, f.at.get('shoulder_L')!.z - run.g.glassZ - 0.05, f.at.get('shoulder_R')!.z - run.g.glassZ - 0.05);
  const sliding = still.filter((f) => f.beatT >= 0.4 && f.beatT <= 1.2);
  assert.ok(sliding.length > 40, `${sliding.length} frames of the slide`);
  const far = Math.max(...sliding.map(front));
  assert.ok(far <= 0.05 + 1e-3, `at most ${(far * 100).toFixed(1)} cm off the pane`);
  const down = sliding[0]!.hips.y - sliding[sliding.length - 1]!.hips.y;
  assert.ok(down >= 0.25, `she slides down it (${down.toFixed(2)} m)`);
  for (const f of still) for (const [j, p] of f.at) assert.ok(p.z >= run.g.glassZ, `${j} crosses the pane at ${f.beatT.toFixed(2)} s`);
  // She ends on the floor beside the glass.
  assert.ok(run.rest.y < 0.3 && run.rest.z - run.g.glassZ < 0.7, `hips at ${run.rest.y.toFixed(2)} m, ${(run.rest.z - run.g.glassZ).toFixed(2)} m from the pane`);
});

test('infection-kills "Room for the creature": while the creature pounds on the glass, no part of her is within 0.3 m of its feet', () => {
  assert.ok(run.pounding, 'it is pounding');
  assert.ok(run.nearFeet >= 0.3, `${run.nearFeet.toFixed(2)} m from its feet`);
});

test('infection-kills "Restored in place": a kill restored from a checkpoint leaves her where the played kill does, her hips within 5 cm', async () => {
  const g = await labBKill({});
  g.start(true);
  g.run(0.2);
  const hips = g.voss.body.jointWorld('pelvis', new THREE.Vector3());
  assert.equal(g.voss.body.alive, false);
  assert.ok(hips.distanceTo(run.rest) <= 0.05, `${(hips.distanceTo(run.rest) * 100).toFixed(1)} cm from where she falls`);
  assert.ok(across(g.voss.position, anchor('voss_rest')) < 1e-6, 'on her rest mark');
});
