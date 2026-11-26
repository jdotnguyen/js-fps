import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NpcActor, type NpcEnv } from '../../ai/npcActor.ts';
import { creatureBody, lowestPoint } from './bladeTestKit.ts';

/**
 * rig-necromorph task 5.4c (design D6a; spec blade-creature "Priya's death, start to finish"): the creature walks R08's route
 * through the real NPC movement (`NpcActor.moveTo`), at the kill's speeds and step rates (data/kills.json `mauled`; the attack
 * was sped up: the approach and the walk back at 7.2 m/s), held in the kill, and its planted feet hold the floor on every
 * frame: out of the surgery and along the glass to her, the carry to the cart, and the walk back. BLADE_ROUTE=1 prints where
 * a slide grows.
 */

type V3 = [number, number, number];
const marks: Record<string, V3> = {};
const want = new Set(['r08_lurk', 'r08_surgery_out', 'r08_surgery_in', 'r08_back', 'r08_lane2', 'r08_impale', 'r08_slam_spot', 'r08_slam_face']);
(function walk(o: unknown): void {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === 'object') {
    const r = o as { id?: string; pos?: V3 };
    if (r.id && r.pos && want.has(r.id)) marks[r.id] = r.pos;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(readFileSync(new URL('../../data/levels/slice01.json', import.meta.url), 'utf8')));

const KILLS = JSON.parse(readFileSync(new URL('../../data/kills.json', import.meta.url), 'utf8')) as {
  mauled: { beats: Array<{ id: string; events: Array<{ do: string; mark?: string; via?: string[]; speed?: number; gait?: number }> }> };
};
/** A kill move's speed, as the kill data gives it (the rush and walk-back caps are above every speed it uses). */
function speedOf(beat: string, verb: string): number {
  const e = KILLS.mauled.beats.find((b) => b.id === beat)!.events.find((x) => x.do === verb)!;
  return e.speed!;
}

const ROUTE = [
  { leg: 'out of the surgery and along the glass to her', to: 'r08_impale', via: ['r08_surgery_out', 'r08_surgery_in', 'r08_back', 'r08_lane2'], speed: speedOf('plead', 'haulTo'), rate: 0.6 },
  { leg: 'the carry to the cart', to: 'r08_slam_spot', via: [], speed: Math.min(1.4, speedOf('carry', 'haulTo')), rate: 1 },
  { leg: 'the walk back to the surgery', to: 'r08_surgery_out', via: ['r08_surgery_in'], speed: speedOf('still', 'walkTo'), rate: 0.6 },
];

test('R08: the creature\'s planted feet hold the floor along the whole kill route, at the kill\'s speeds', async () => {
  for (const id of want) assert.ok(marks[id], `mark ${id}`);
  assert.ok(ROUTE[0]!.speed >= 7, `the approach runs (${ROUTE[0]!.speed} m/s)`);
  const body = await creatureBody('lab_creature');
  const actor = new NpcActor('r08_thing', body);
  const at = marks['r08_lurk']!;
  actor.place({ x: at[0], y: at[1], z: at[2] }, Math.PI / 2);
  body.beginKill();
  const anim = (body as unknown as { animator: { gaitRate: number; footContacts: [number, number] } }).animator;
  const dt = 1 / 60;
  const cam = new THREE.Vector3(0, 1.6, 44); // the security office, beyond the glass
  const env: NpcEnv = { nav: null, colliders: null, playerHead: cam, playerFeet: cam.clone().setY(0), camera: cam };
  const p = new THREE.Vector3();
  const start: Array<THREE.Vector3 | null> = [null, null];
  const report: string[] = [];
  let worstSlide = 0;
  let worstSink = 0;
  let topSpeed = 0;
  for (const leg of ROUTE) {
    let slide = 0;
    let sink = 0;
    const to = marks[leg.to]!;
    void actor.moveTo({ x: to[0], y: 0, z: to[2] }, { speed: leg.speed, track: [...leg.via.map((m) => ({ x: marks[m]![0], y: 0, z: marks[m]![2] })), { x: to[0], y: 0, z: to[2] }] });
    // The move ends when the actor stops (its promise would only resolve once this loop yields). Then a second at the mark.
    let f = 0;
    let after = 60;
    for (; f < 60 * 20 && (actor.moving || after-- > 0); f++) {
      anim.gaitRate = leg.rate;
      actor.update(dt, env);
      topSpeed = Math.max(topSpeed, body.speed);
      (['L', 'R'] as const).forEach((s, k) => {
        body.jointWorld(`foot_${s}`, p);
        if (anim.footContacts[k]! < 0.5) return void (start[k] = null);
        if (!start[k]) return void (start[k] = p.clone());
        const m = Math.hypot(p.x - start[k]!.x, p.z - start[k]!.z);
        if (m > slide && process.env['BLADE_ROUTE']) console.log(`  ${leg.leg} ${s}: ${(m * 100).toFixed(1)} cm at speed ${body.speed.toFixed(2)}`);
        slide = Math.max(slide, m);
      });
      sink = Math.min(sink, lowestPoint(body) - body.group.position.y);
    }
    assert.ok(!actor.moving, `${leg.leg}: arrived`);
    report.push(`${leg.leg} (${leg.speed} m/s): slide ${(slide * 100).toFixed(1)} cm, sink ${(-sink * 100).toFixed(1)} cm`);
    worstSlide = Math.max(worstSlide, slide);
    worstSink = Math.min(worstSink, sink);
  }
  console.log(`[blade] R08 route, top speed ${topSpeed.toFixed(1)} m/s\n  ${report.join('\n  ')}`);
  assert.ok(worstSlide < 0.1, `a planted foot slid ${(worstSlide * 100).toFixed(1)} cm\n${report.join('\n')}`);
  assert.ok(worstSink > -0.03, `a foot sank ${(-worstSink * 100).toFixed(1)} cm\n${report.join('\n')}`);
});
