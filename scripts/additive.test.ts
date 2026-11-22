import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
// @ts-expect-error plain ES module without types
import { makeAdditive, meanQuat } from './lib/additive.mjs';
import mocapJson from '../src/data/mocap-core.json' with { type: 'json' };

type Clip = { frames: number; pelvis: number[]; joints: Record<string, number[]>; additive?: boolean };

test('additive holds: the baked offsets average to no offset, and keep the clip\'s motion', () => {
  const src = (mocapJson as unknown as { clips: Record<string, Clip> }).clips['idle_talk']!;
  const clip: Clip = JSON.parse(JSON.stringify(src));
  makeAdditive(clip);
  assert.equal(clip.additive, true);
  for (const [j, arr] of Object.entries(clip.joints)) {
    const mean = meanQuat(arr, clip.frames) as THREE.Quaternion;
    const deg = mean.angleTo(new THREE.Quaternion()) * (180 / Math.PI);
    assert.ok(deg < 0.5, `${j}: mean offset ${deg.toFixed(2)} deg`);
  }
  for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let f = 0; f < clip.frames; f++) m += clip.pelvis[f * 3 + c]! / clip.frames;
    assert.ok(Math.abs(m) < 0.002, `pelvis mean offset ${m}`);
  }
  // The motion survives: frame-to-frame change is the same as in the source.
  const step = (c: Clip, f: number): number => {
    const a = c.joints['chest']!;
    return new THREE.Quaternion(a[f * 4], a[f * 4 + 1], a[f * 4 + 2], a[f * 4 + 3]).normalize().angleTo(new THREE.Quaternion(a[f * 4 + 4], a[f * 4 + 5], a[f * 4 + 6], a[f * 4 + 7]).normalize());
  };
  assert.ok(Math.abs(step(clip, 10) - step(src, 10)) < 0.01);
});

test('additive scale: a scaled hold keeps the motion\'s shape at a fraction of its size', () => {
  const clip = (): { frames: number; joints: Record<string, number[]>; pelvis: number[] } => {
    const frames = 24;
    const joints: Record<string, number[]> = { chest: [] };
    const pelvis: number[] = [];
    for (let f = 0; f < frames; f++) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3 * Math.sin((f / frames) * Math.PI * 2));
      joints['chest']!.push(q.x, q.y, q.z, q.w);
      pelvis.push(0.1 * Math.sin((f / frames) * Math.PI * 2), 0, 0);
    }
    return { frames, joints, pelvis };
  };
  const full = makeAdditive(clip());
  const half = makeAdditive(clip(), 0.5);
  // From the vector part: baked quaternions are rounded to 3 decimals, which makes an angle taken from w unreliable near zero.
  const angle = (c: typeof full, f: number): number => {
    const [x, y, z] = c.joints['chest']!.slice(f * 4, f * 4 + 3) as [number, number, number];
    return 2 * Math.asin(Math.min(1, Math.hypot(x, y, z)));
  };
  for (const f of [3, 6, 9]) {
    assert.ok(Math.abs(angle(half, f) - angle(full, f) / 2) < 0.003, `joint offset halves at frame ${f}`);
    assert.ok(Math.abs(half.pelvis[f * 3] - full.pelvis[f * 3] / 2) < 0.002, `pelvis offset halves at frame ${f}`);
  }
});
