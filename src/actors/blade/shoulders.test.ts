import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Humanoid } from '../humanoid.ts';
import { creatureBody, stepBody } from './bladeTestKit.ts';

/**
 * rig-necromorph design D5: the prepared body hangs its arms and poses raise them. Within the arm envelope the creature's
 * poses keep to, no edge of 3 mm or more stretches past 2.5 times its rest length. Past it the skin behind the shoulder
 * tears: an upper arm swung forward more than about 105 degrees from hanging, or raised sideways more than about 140.
 * BLADE_SHOULDER=x,z probes other upper-arm angles (degrees), BLADE_EDGES=1 prints the stretched edges.
 */

const MM3 = 0.003;

/** Skinned world positions of every body mesh's vertices, and their triangles' edges. */
function snapshot(h: Humanoid): Array<{ pos: THREE.Vector3[]; index: ArrayLike<number>; name: string }> {
  h.group.updateMatrixWorld(true);
  const out: Array<{ pos: THREE.Vector3[]; index: ArrayLike<number>; name: string }> = [];
  h.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible || !m.geometry.index) return;
    m.skeleton.update();
    const n = m.geometry.getAttribute('position').count;
    const pos: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) pos.push(m.localToWorld(m.getVertexPosition(k, new THREE.Vector3())));
    out.push({ pos, index: m.geometry.index.array, name: m.parent?.name ?? m.name });
  });
  return out;
}

/** The worst edge stretch; edges with a vertex where `skip` holds (rest position over scale, metres) are left out. */
function worstStretch(rest: ReturnType<typeof snapshot>, posed: ReturnType<typeof snapshot>, scale: number, skip?: (v: THREE.Vector3) => boolean): number {
  let worst = 0;
  const v = new THREE.Vector3();
  rest.forEach((r, i) => {
    const p = posed[i]!;
    for (let t = 0; t + 2 < r.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = r.index[t + e]!;
        const b = r.index[t + ((e + 1) % 3)]!;
        const len = r.pos[a]!.distanceTo(r.pos[b]!);
        if (len < MM3 * scale) continue;
        if (skip && (skip(v.copy(r.pos[a]!).divideScalar(scale)) || skip(v.copy(r.pos[b]!).divideScalar(scale)))) continue;
        const k = p.pos[a]!.distanceTo(p.pos[b]!) / len;
        if (process.env['BLADE_EDGES'] && k > 2.2) console.log(`  edge ${k.toFixed(2)}x  rest ${(len / scale * 1000).toFixed(0)} mm  at ${r.pos[a]!.toArray().map((x) => (x / scale).toFixed(2))} part ${r.name}`);
        worst = Math.max(worst, k);
      }
    }
  });
  return worst;
}

// [upper arm, collar] XYZ degrees from hanging. Probe angles: BLADE_SHOULDER=x,z (degrees).
const probe = process.env['BLADE_SHOULDER']?.split(',').map(Number);
for (const [label, euler, collar] of (probe
  ? [['probe', [probe[0]!, 0, probe[1]!], [0, 0, 0]]]
  : [
      ['swung forward 100', [100, 0, 0], [0, 0, 0]],
      ['raised sideways 140', [0, 0, 140], [0, 0, 0]],
      ['forward and out', [95, 0, 35], [0, 0, 0]],
      ['the ready', [70, 0, 20], [0, 0, 0]],
    ]) as Array<[string, number[], number[]]>) {
  test(`blade creature: blades ${label}, the shoulders hold`, async () => {
    const h = await creatureBody('flood_elite');
    const scale = h.group.scale.y || 1;
    const rest = snapshot(h);
    for (const s of ['L', 'R'] as const) {
      const bone = h.group.getObjectByName(`upperArm_${s}`)!;
      const side = s === 'L' ? -1 : 1;
      bone.rotation.set(THREE.MathUtils.degToRad(euler[0]!), 0, THREE.MathUtils.degToRad(euler[2]! * side));
      h.group.getObjectByName(`shoulder_${s}`)!.rotation.set(THREE.MathUtils.degToRad(collar[0]!), 0, THREE.MathUtils.degToRad(collar[2]! * side));
    }
    const worst = worstStretch(rest, snapshot(h), scale);
    console.log(`[blade] ${label}: worst edge ${worst.toFixed(2)}x`);
    assert.ok(worst <= 2.5, `an edge stretched to ${worst.toFixed(2)}x`);
  });
}

// rig-necromorph task 5.4d: the moving body keeps its skin whole too; the blades pump and the hips roll over the pose.
// The one exception is the inner crotch seam: the thighs scissor through every stride (it reaches about 6.6x at a charge,
// with or without the body's motion, design D6b), and it is hidden between the legs from every side. It is held to 7x.
const CROTCH = (v: THREE.Vector3): boolean => Math.abs(v.x) < 0.09 && v.y > 0.8 && v.y < 1.12 && Math.abs(v.z) < 0.16;
for (const speed of [0, 1.35, 3.2, 7.2]) {
  test(`blade creature at ${speed} m/s: every edge stays within 2.5 times its length through the stride`, async () => {
    const rest = snapshot(await creatureBody('flood_elite'));
    const h = await creatureBody('flood_elite');
    const scale = h.group.scale.y || 1;
    let worst = 0;
    let seam = 0;
    stepBody(h, 150, { speed, near: true, each: (i) => {
      if (i < 60 || i % 5 !== 0) return;
      const now = snapshot(h);
      worst = Math.max(worst, worstStretch(rest, now, scale, CROTCH));
      seam = Math.max(seam, worstStretch(rest, now, scale));
    } });
    console.log(`[blade] ${speed} m/s: worst edge ${worst.toFixed(2)}x, crotch seam ${seam.toFixed(2)}x`);
    assert.ok(worst <= 2.5, `an edge stretched to ${worst.toFixed(2)}x`);
    assert.ok(seam <= 7, `the crotch seam stretched to ${seam.toFixed(2)}x`);
  });
}

// rig-necromorph task 5.1: every one of the creature's own poses keeps its skin whole, shoulders included.
test('every blade_* pose keeps every edge within 2.5 times its length', async () => {
  const file = (await import('../../data/poseFiles.ts')).posesJson as unknown as {
    poses: Record<string, { joints: Record<string, [number, number, number]>; pelvis?: [number, number, number] }>;
  };
  const names = Object.keys(file.poses).filter((n) => n.startsWith('blade_'));
  assert.ok(names.length >= 3, `${names.length} blade poses`);
  for (const name of names) {
    const h = await creatureBody('flood_elite');
    const scale = h.group.scale.y || 1;
    const rest = snapshot(h);
    for (const [joint, e] of Object.entries(file.poses[name]!.joints)) {
      h.group.getObjectByName(joint)!.rotation.set(...(e.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]), 'XYZ');
    }
    const worst = worstStretch(rest, snapshot(h), scale);
    console.log(`[blade] ${name}: worst edge ${worst.toFixed(2)}x`);
    assert.ok(worst <= 2.5, `${name}: an edge stretched to ${worst.toFixed(2)}x`);
  }
});
