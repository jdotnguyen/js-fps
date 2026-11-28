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
  /** The creature's head, once it is out. */
  creatureHead: THREE.Vector3 | null;
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
    const c = g.creature();
    frames.push({ t: g.time() - asked, beat: r.beatId!, beatT: r.beatTime, hips: b.jointWorld('pelvis', new THREE.Vector3()), heading: b.heading, at: new Map(joints.map((j) => [j, b.jointWorld(j, new THREE.Vector3())])), caps: worldCapsules(b), creatureHead: c ? c.body.jointWorld('head', new THREE.Vector3()) : null });
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
const ON: Record<string, string> = { labb_bench_top: 'bench', labb_bench_hip: 'bench', labb_push_off: 'bench', labb_cart_hip: 'cart' };
const PART_CAPSULE: Record<string, JointName> = { hand_L: 'hand_L', hand_R: 'hand_R', hip_L: 'thigh_L', hip_R: 'thigh_R', knee_L: 'shin_L', knee_R: 'shin_R', chest: 'chest' };
const toSurface = (f: Frame, part: string, on: string): number => {
  const c = cap(f, PART_CAPSULE[part]!);
  return clearance(c, solid(on));
};

test('infection-kills "The actions in order": she hits the bench, sweeps it, doubles over, pushes off, crouch-walks holding her stomach, lurches hip-first into the cart, knocks it over and reaches the glass', () => {
  const hit = first(0, (f) => toSurface(f, 'hip_L', 'bench') <= 0.05);
  const sweep = run.done.find((e) => e.do === 'sweep');
  const doubled = first(sweep?.t ?? 0, (f) => lean(f) >= 35);
  const pushOff = first(doubled?.beatT ?? 0, (f) => f.at.get('hand_L')!.distanceTo(anchor('labb_push_off')) <= 0.05);
  const cart = first(pushOff?.beatT ?? 0, (f) => toSurface(f, 'hip_L', 'cart') <= 0.05);
  const tip = run.done.find((e) => e.do === 'tip' && e.t >= (cart?.t ?? Infinity));
  const stand = new THREE.Vector3(8, 0, run.g.glassZ + 0.65);
  const glass = first(tip ? tip.t : Infinity, (f) => across(f.hips, stand) <= 0.1);
  const order = { hit, sweep, doubled, pushOff, cart, tip, glass };
  let last = -Infinity;
  for (const [name, at] of Object.entries(order)) {
    assert.ok(at, `${name} happens (after ${last.toFixed(2)} s)`);
    assert.ok(at.t > last, `${name} at ${at.t.toFixed(2)} s comes after the action before it (${last.toFixed(2)} s)`);
    last = at.t;
  }
  assert.ok(last < 6.5, `she reaches the glass within the panic beat (${last.toFixed(2)} s)`);
  assert.equal(sweep!.beat, 'panic');
});

test('infection-kills "Crouched to the glass": from the bench to the glass she walks bent low, hunched over, with both hands on her stomach', () => {
  const walk = panic.filter((f) => f.beatT >= 2.6 && f.beatT <= 6.0);
  assert.ok(walk.length > 100, `${walk.length} frames of the walk`);
  const med = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[xs.length >> 1]!;
  const standing = run.frames.find((f) => f.beat === 'panic')!.hips.y;
  const hips = med(walk.map((f) => f.hips.y));
  assert.ok(hips <= standing - 0.12, `her hips are low (${hips.toFixed(2)} m, ${standing.toFixed(2)} m as she starts)`);
  const bent = med(walk.map(lean));
  assert.ok(bent >= 28, `she is hunched over (${bent.toFixed(0)} deg)`);
  for (const side of ['L', 'R'] as const) {
    const off = med(walk.map((f) => f.at.get(`hand_${side}` as JointName)!.distanceTo(f.at.get('spine')!)));
    assert.ok(off <= 0.3, `her ${side} hand stays at her stomach (${(off * 100).toFixed(0)} cm from her spine)`);
  }
});

test('infection-kills "Contacts touch": her hip and hands on the bench and her hip against the cart are within 5 cm of the surface, never through it', () => {
  assert.ok(touches.length >= 4, `${touches.length} contacts`);
  for (const e of touches) {
    const on = ON[e.mark!];
    assert.ok(on, `${e.mark} is on a known surface`);
    // When the part has fully reached its mark.
    const at = first(e.t + (e.blend ?? 0.15) + 1 / 60, () => true)!;
    const d = toSurface(at, e.part!, on!);
    assert.ok(d <= 0.05, `${e.part} at ${e.t} s is ${(d * 100).toFixed(1)} cm from the ${on}`);
    assert.ok(d >= -(cap(at, PART_CAPSULE[e.part!]!).r + THROUGH), `${e.part} at ${e.t} s does not go into the ${on} (${(d * 100).toFixed(1)} cm)`);
  }
});

test('infection-kills "Nothing walked through": at every frame of the run, no part of her passes through the bench, the gurney, the cart or the glass', () => {
  const worst: Record<string, { d: number; at: string }> = {};
  for (const f of panic) {
    for (const s of run.solids) {
      if (s.id === 'chair' || s.id === 'sill' || s.id === 'mullion') continue;
      for (const c of f.caps) {
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

const burst = run.frames.filter((f) => f.beat === 'burst');
/** From the burst to the end of the still beat. */
const fall = [...burst, ...still];

test('infection-kills "Falls back from the glass": from the burst on her hips only move away from the pane, over a metre, through nothing, and she rests face up with her head away from it', () => {
  assert.ok(burst.length > 30 && still.length > 100, `${burst.length} burst and ${still.length} still frames`);
  const off = (f: Frame): number => f.hips.z - run.g.glassZ;
  let far = off(fall[0]!);
  for (const f of fall) {
    assert.ok(off(f) >= far - 0.02, `her hips come back toward the pane in ${f.beat} at ${f.beatT.toFixed(2)} s (${off(f).toFixed(2)} m, ${far.toFixed(2)} m before)`);
    far = Math.max(far, off(f));
    for (const [j, p] of f.at) assert.ok(p.z >= run.g.glassZ, `${j} crosses the pane in ${f.beat} at ${f.beatT.toFixed(2)} s`);
    for (const s of run.solids) {
      if (s.id === 'chair' || s.id === 'sill' || s.id === 'mullion') continue;
      for (const c of f.caps) assert.ok(-clearance(c, s) - c.r <= THROUGH, `${s.id}:${c.joint} inside in ${f.beat} at ${f.beatT.toFixed(2)} s`);
    }
  }
  const back = run.rest.z - fall[0]!.hips.z;
  assert.ok(back >= 1.0, `she falls back ${back.toFixed(2)} m from where the burst finds her`);
  // At rest on the floor, her head beyond her hips from the pane, and face up: lying head away from the pane, her right
  // arm is on her right as she faced the glass (+x), where face down would put it on the left.
  const last = still[still.length - 1]!;
  const head = last.at.get('head')!;
  assert.ok(run.rest.y < 0.3 && last.at.get('chest')!.y < 0.3, `on the floor (hips ${run.rest.y.toFixed(2)} m, chest ${last.at.get('chest')!.y.toFixed(2)} m up)`);
  assert.ok(head.z - run.rest.z >= 0.3, `her head is ${(head.z - run.rest.z).toFixed(2)} m beyond her hips from the pane`);
  const across = last.at.get('upperArm_R')!.x - last.at.get('upperArm_L')!.x;
  assert.ok(across >= 0.2, `face up (her right upper arm ${across.toFixed(2)} m to the right of her left)`);
});

test('infection-kills "Out of her front": the creature first shows at the front of her torso, and the gap opens as she falls back from it', () => {
  const out = fall.filter((f) => f.creatureHead);
  assert.ok(out.length > 0 && out[0]!.beat === 'burst', 'it comes out in the burst');
  // How far the creature's head is ahead of her chest joint, toward the pane.
  const ahead = (f: Frame): number => f.at.get('chest')!.z - f.creatureHead!.z;
  const first = out[0]!;
  const c = first.creatureHead!;
  assert.ok(Math.abs(c.x - first.at.get('chest')!.x) <= 0.15, `in line with her chest, not beside it (${(c.x - first.at.get('chest')!.x).toFixed(2)} m)`);
  // (The burst arches her back, her head below her chest: her chest is the torso's height.)
  const chestY = first.at.get('chest')!.y;
  assert.ok(Math.abs(c.y - chestY) <= 0.2 && c.y >= first.hips.y, `at her torso's height (${c.y.toFixed(2)} m, her chest ${chestY.toFixed(2)} m and hips ${first.hips.y.toFixed(2)} m)`);
  assert.ok(ahead(first) >= 0, `at her front (${ahead(first).toFixed(2)} m ahead of her chest joint)`);
  // She never comes back in front of it, as she did when she fell toward the pane.
  for (const f of out) assert.ok(ahead(f) >= -0.02, `her chest passes its head toward the pane in ${f.beat} at ${f.beatT.toFixed(2)} s`);
  const end = burst[burst.length - 1]!;
  assert.ok(ahead(end) >= 0.4, `by the fall it stands ${ahead(end).toFixed(2)} m clear in front of her`);
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
