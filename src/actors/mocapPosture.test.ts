import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
import type { RawMocapClip, RawMocapFile } from './mocap.ts';
import { NEUTRAL_CLIPS, sharedMotionProfiles } from './motionProfiles.ts';

/**
 * standing-posture-stability: every standing idle and talk clip a living humanoid plays keeps an upright trunk. Its pelvis,
 * averaged over the clip, is within 10 degrees of upright, and its upper back bends at most 12 degrees backwards relative to
 * its lower back, so no clip stands in a swayback (pelvis tipped forward, chest pushed out).
 *
 * Pitch and lateral tilt are measured from each segment's up vector in the pelvis's facing frame.
 * Negative is forward (skeleton.ts: -x nods forward).
 */

const PELVIS_LIMIT = 10;
const UPPER_BACK_LIMIT = 12;
const SIDE_TILT_LIMIT = 10;

const packDir = path.resolve(import.meta.dirname, '../data/mocap');
const files: RawMocapFile[] = [
  coreJson as unknown as RawMocapFile,
  ...fs
    .readdirSync(packDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(packDir, f), 'utf8')) as RawMocapFile),
];
const clips = new Map<string, RawMocapClip>();
for (const f of files) for (const [id, c] of Object.entries(f.clips)) clips.set(id, c);

/** The standing idle and talk clips characters play: the neutral ones plus every profile's and scene variant's own. */
function standingClipIds(): string[] {
  const ids = new Set<string>([NEUTRAL_CLIPS.idle, NEUTRAL_CLIPS.talk]);
  for (const p of Object.values(sharedMotionProfiles().profiles)) {
    for (const set of [p.clips, ...Object.values(p.variants ?? {}).map((v) => v.clips)]) {
      if (set?.idle) ids.add(set.idle);
      if (set?.talk) ids.add(set.talk);
    }
  }
  return [...ids].sort();
}

interface TrunkPosture {
  pelvis: number;
  spine: number;
  chest: number;
  chestRoll: number;
  headRoll: number;
  /** Lower back bend (spine segment relative to the pelvis), degrees; positive bends backwards. */
  lower: number;
  /** Upper back bend (chest segment relative to the spine segment), degrees; positive bends backwards. */
  upper: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

function measureTrunk(c: RawMocapClip): TrunkPosture {
  const q = new THREE.Quaternion();
  const t = new THREE.Quaternion();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const sum = { pelvis: 0, spine: 0, chest: 0, chestRoll: 0, headRoll: 0 };
  const track = (name: string, f: number): THREE.Quaternion => {
    const a = c.joints[name];
    return a ? t.set(a[f * 4]!, a[f * 4 + 1]!, a[f * 4 + 2]!, a[f * 4 + 3]!).normalize() : t.identity();
  };
  for (let f = 0; f < c.frames; f++) {
    q.copy(track('pelvis', f));
    fwd.copy(FWD).applyQuaternion(q).setY(0).normalize();
    right.crossVectors(UP, fwd);
    const tilt = (axis: THREE.Vector3): number => {
      up.copy(UP).applyQuaternion(q);
      return THREE.MathUtils.radToDeg(Math.atan2(up.dot(axis), up.y));
    };
    sum.pelvis += tilt(fwd);
    q.multiply(track('spine', f));
    sum.spine += tilt(fwd);
    q.multiply(track('chest', f));
    sum.chest += tilt(fwd);
    sum.chestRoll += tilt(right);
    q.multiply(track('neck', f)).multiply(track('head', f));
    sum.headRoll += tilt(right);
  }
  const pelvis = sum.pelvis / c.frames;
  const spine = sum.spine / c.frames;
  const chest = sum.chest / c.frames;
  return { pelvis, spine, chest, chestRoll: sum.chestRoll / c.frames, headRoll: sum.headRoll / c.frames, lower: spine - pelvis, upper: chest - spine };
}

test('standing idle and talk clips keep the trunk upright and the head level across the cast', () => {
  const ids = standingClipIds();
  assert.ok(ids.length >= 10, `found only ${ids.length} standing clips`);
  const bad: string[] = [];
  for (const id of ids) {
    const c = clips.get(id);
    assert.ok(c, `clip ${id} is named by a profile but missing from the library`);
    assert.ok(!c.additive, `${id} is additive; a standing idle or talk must be a full pose`);
    const p = measureTrunk(c);
    if (Math.abs(p.pelvis) > PELVIS_LIMIT || p.upper > UPPER_BACK_LIMIT) {
      bad.push(`${id}: pelvis ${p.pelvis.toFixed(1)}, lower back ${p.lower.toFixed(1)}, upper back ${p.upper.toFixed(1)} deg`);
    }
    if (Math.abs(p.chestRoll) > SIDE_TILT_LIMIT || Math.abs(p.headRoll) > SIDE_TILT_LIMIT) {
      bad.push(`${id}: average side tilt, chest ${p.chestRoll.toFixed(1)}, head ${p.headRoll.toFixed(1)} deg (limit ${SIDE_TILT_LIMIT})`);
    }
  }
  assert.deepEqual(bad, [], `standing posture outside limits:\n  ${bad.join('\n  ')}`);
});

test('Okafor keeps a quiet gaze through the whole idle and posture hold, including the loop seam', () => {
  for (const id of ['okafor_idle', 'okafor_hold']) {
    const clip = clips.get(id)!;
    assert.ok(clip.loop && clip.duration >= 7, `${id} is a ${clip.duration}s loop`);
    const head = new THREE.Quaternion();
    const local = new THREE.Quaternion();
    const neutral = new THREE.Quaternion();
    for (let f = 0; f < clip.frames; f++) {
      head.identity();
      for (const joint of ['pelvis', 'spine', 'chest', 'neck', 'head']) {
        head.multiply(local.fromArray(clip.joints[joint]!, f * 4).normalize());
      }
      const angle = THREE.MathUtils.radToDeg(head.angleTo(neutral));
      assert.ok(angle < 8, `${id} head moves ${angle.toFixed(1)}° from neutral at frame ${f}`);
    }
  }
});
