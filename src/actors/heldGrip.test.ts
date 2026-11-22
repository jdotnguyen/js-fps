import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
// @ts-expect-error plain ES module without types
import { makeAdditive } from '../../scripts/lib/additive.mjs';
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { CAST } from './castLooks.ts';
import { loadMainCast, makeLib, type MainCastModel } from './castModelTestKit.ts';
import { gripFrameFor, makeHeldMug, MUG_IN_HAND, PALM_DEPTH } from './heldProps.ts';
import { heldGripFor } from './heldGrip.ts';
import { Humanoid, type HumanoidSpec } from './humanoid.ts';
import { MocapLibrary, type RawMocapFile } from './mocap.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import type { FingerBoneDef, HandDetailBone } from './handPhysics.ts';

/**
 * Held mugs, measured (held-props spec, change upright-mug-grip, design D1): the mug's tilt, how deep any finger goes into it,
 * how close the fingertips and thumb come, which side the thumb comes round, and whether the handle stays clear. The mug's
 * dimensions are read from its own geometry, never from the grip solver's constants.
 *
 * Measured before the fix (rotation Euler(-PI/2, 0, PI/2)): tilt 77-92° in every pose for every body; knuckles 1.5-3.9 cm inside
 * the mug for Giles, Priya and Hale.
 * After D2 (mug rotation from named axes), standing still: idle_mug 13-15°, offer_mug 20-23°, lean_back_mug 31-33°, drink 44-47°,
 * lean_back_mug_drink 57-59° for all five bodies. Over 3 s with a spoken line the worst frame reaches 24-51° (Giles, Priya, Bram)
 * and up to 94° (Okafor, Hale in lean_back_mug): gestures and idle life move the wrist, which D3's swing removes.
 */

// ------------------------------------------------------------------ the mug's shape, from its geometry

export interface MugShape {
  /** Outer radius at the bottom and at the rim, and the heights (mug-local Y) of the bottom and the rim. */
  rBottom: number;
  rTop: number;
  yBottom: number;
  yTop: number;
  /** The handle's box (mug-local): a finger point inside it is in the handle or through its loop. */
  handle: THREE.Box3;
}

let shapeCache: MugShape | null = null;

/** The mug's outer wall and handle box, read from the lathe's seam vertices (x = 0, where z = ±radius) and the handle's vertices. */
export function mugShape(): MugShape {
  if (shapeCache) return shapeCache;
  const pos = makeHeldMug().geometry.getAttribute('position');
  let yBottom = Infinity;
  let yTop = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) > 1e-6) continue;
    yBottom = Math.min(yBottom, pos.getY(i));
    yTop = Math.max(yTop, pos.getY(i));
  }
  let rBottom = 0;
  let rTop = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) > 1e-6) continue;
    if (Math.abs(pos.getY(i) - yBottom) < 1e-6) rBottom = Math.max(rBottom, Math.abs(pos.getZ(i)));
    if (Math.abs(pos.getY(i) - yTop) < 1e-6) rTop = Math.max(rTop, Math.abs(pos.getZ(i)));
  }
  const handle = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (Math.hypot(v.x, v.z) > rTop + 0.002) handle.expandByPoint(v);
  }
  shapeCache = { rBottom, rTop, yBottom, yTop, handle };
  return shapeCache;
}

/** Outer radius of the wall at mug-local height y (clamped to the mug). */
function wallRadius(s: MugShape, y: number): number {
  const t = THREE.MathUtils.clamp((y - s.yBottom) / (s.yTop - s.yBottom), 0, 1);
  return THREE.MathUtils.lerp(s.rBottom, s.rTop, t);
}

/** Half a finger's thickness: a phalanx's centre line lies this far from its skin. */
export const FINGER_HALF = 0.008;

/**
 * How far a finger point (its centre line, mug-local) reaches into the mug's solid body, skin included: positive = inside by that
 * much, negative = clear of the wall. Points above the rim or below the base are clear by their distance to it.
 */
export function depthInside(s: MugShape, p: THREE.Vector3): number {
  const radial = Math.hypot(p.x, p.z);
  const side = wallRadius(s, p.y) + FINGER_HALF - radial;
  const below = p.y - (s.yBottom - FINGER_HALF);
  const above = s.yTop + FINGER_HALF - p.y;
  return Math.min(side, below, above);
}

/** Distance from a finger point's skin to the mug's outer surface (0 when touching or inside). */
export function surfaceGap(s: MugShape, p: THREE.Vector3): number {
  const radial = Math.hypot(p.x, p.z);
  const r = wallRadius(s, p.y);
  const dy = p.y > s.yTop ? p.y - s.yTop : p.y < s.yBottom ? s.yBottom - p.y : 0;
  const dr = Math.max(0, radial - r);
  return Math.max(0, Math.hypot(dr, dy) - FINGER_HALF);
}

/** Tilt (degrees) of a mug's up axis from world vertical. */
export function mugTilt(mug: THREE.Object3D): number {
  const up = mugUp(mug);
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
}

function mugUp(mug: THREE.Object3D): THREE.Vector3 {
  const e = mug.matrixWorld.elements;
  return new THREE.Vector3(e[4], e[5], e[6]).normalize();
}

// ------------------------------------------------------------------ the hand, sampled

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Finger = (typeof FINGERS)[number];

/** World points along each phalanx of the right hand's fingers (joint to next joint; the last one to an estimated tip). */
export interface FingerSamples {
  points: Map<Finger, THREE.Vector3[]>;
  tips: Map<Finger, THREE.Vector3>;
}

/** The distal phalanx (joint to tip) is this share of the middle one. */
const DISTAL_SHARE = 0.85;

export function sampleFingers(group: THREE.Object3D, steps = 4): FingerSamples | null {
  const byName = new Map<string, THREE.Object3D>();
  group.traverse((o) => {
    if (o.name.startsWith('finger_R_')) byName.set(o.name, o);
  });
  if (byName.size === 0) return null;
  const points = new Map<Finger, THREE.Vector3[]>();
  const tips = new Map<Finger, THREE.Vector3>();
  for (const f of FINGERS) {
    const joints = [1, 2, 3].map((i) => byName.get(`finger_R_${f}_${i}`)?.getWorldPosition(new THREE.Vector3())).filter((v): v is THREE.Vector3 => !!v);
    if (joints.length < 2) continue;
    // The distal phalanx runs on from its joint the way the middle one ran in the rest pose, turned by its own bend.
    const distal = byName.get(`finger_R_${f}_3`) ?? byName.get(`finger_R_${f}_2`)!;
    const tip = distal.localToWorld(distal.position.clone().multiplyScalar(DISTAL_SHARE));
    const chain = [...joints, tip];
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < chain.length; i++) {
      for (let k = 0; k < steps; k++) pts.push(chain[i]!.clone().lerp(chain[i + 1]!, k / steps));
    }
    pts.push(tip);
    points.set(f, pts);
    tips.set(f, tip);
  }
  return { points, tips };
}

export interface GripReading {
  tilt: number;
  /** Deepest finger point into the mug (m, positive = inside) and which finger. */
  deepest: number;
  deepestFinger: string;
  /** Finger points inside the handle box. */
  inHandle: number;
  /** Tip-to-surface gaps (m). */
  tipGap: Partial<Record<Finger, number>>;
  /** Seen down the mug's axis: is the thumb tip on the other side of the axis-to-palm line from the middle fingertip? */
  thumbOpposed: boolean;
  /** Angle (degrees, about the mug's axis) from the palm direction to the handle; 180 = straight away from the palm. */
  handleFromPalm: number;
}

/** Measure one frame of a body holding a mug. */
export function readGrip(h: Humanoid): GripReading | null {
  let mug: THREE.Object3D | null = null;
  h.group.traverse((o) => {
    if (o.name === 'held_mug' && o.visible) mug = o;
  });
  if (!mug) return null;
  const m = mug as THREE.Object3D;
  h.group.updateMatrixWorld(true);
  const s = mugShape();
  const inv = m.matrixWorld.clone().invert();
  const local = (v: THREE.Vector3): THREE.Vector3 => v.clone().applyMatrix4(inv);
  const out: GripReading = { tilt: mugTilt(m), deepest: -Infinity, deepestFinger: '', inHandle: 0, tipGap: {}, thumbOpposed: false, handleFromPalm: NaN };

  // Palm direction (seen down the axis): from the axis toward the hand bone and middle knuckle.
  const hand = h.bones.hand_R.getWorldPosition(new THREE.Vector3());
  const knuckle = new THREE.Vector3();
  let k = 0;
  h.group.traverse((o) => {
    if (o.name === 'finger_R_middle_1') {
      o.getWorldPosition(knuckle);
      k = 1;
    }
  });
  const palm = local(k ? hand.clone().lerp(knuckle, 0.6) : hand);
  const palmAng = Math.atan2(palm.z, palm.x);
  const hc = s.handle.getCenter(new THREE.Vector3());
  out.handleFromPalm = Math.abs(THREE.MathUtils.radToDeg(THREE.MathUtils.euclideanModulo(Math.atan2(hc.z, hc.x) - palmAng + Math.PI, Math.PI * 2) - Math.PI));

  const samples = sampleFingers(h.group);
  if (!samples) return out;
  for (const [f, pts] of samples.points) {
    for (const p of pts) {
      const q = local(p);
      const d = depthInside(s, q);
      if (d > out.deepest) {
        out.deepest = d;
        out.deepestFinger = f;
      }
      if (s.handle.containsPoint(q)) out.inHandle++;
    }
  }
  for (const [f, tip] of samples.tips) out.tipGap[f] = surfaceGap(s, local(tip));
  const side = (v: THREE.Vector3): number => Math.sign(palm.x * v.z - palm.z * v.x);
  const t = samples.tips.get('thumb');
  const mid = samples.tips.get('middle');
  if (t && mid) out.thumbOpposed = side(local(t)) * side(local(mid)) < 0;
  return out;
}

// ------------------------------------------------------------------ helper self-checks (synthetic mug and hand)

test('measurement helpers: depth, gap and tilt read true on a synthetic mug', () => {
  const s = mugShape();
  assert.ok(Math.abs(s.rTop - 0.043) < 1e-4 && Math.abs(s.rBottom - 0.04) < 1e-4, `mug radii from geometry (${s.rBottom}, ${s.rTop})`);
  assert.ok(s.yTop - s.yBottom > 0.09 && s.yTop - s.yBottom < 0.1, 'mug height from geometry');
  assert.ok(s.handle.min.x > s.rTop - 0.01 && s.handle.max.x > s.rTop + 0.02, 'handle box sits on the +X side');
  const mid = (s.yTop + s.yBottom) / 2;
  const r = wallRadius(s, mid);
  // A finger whose skin is 5 mm inside the wall.
  const inside = new THREE.Vector3(0, mid, -(r + FINGER_HALF - 0.005));
  assert.ok(Math.abs(depthInside(s, inside) - 0.005) < 1e-6, `5 mm inside reads 5 mm (${depthInside(s, inside)})`);
  const touching = new THREE.Vector3(0, mid, -(r + FINGER_HALF));
  assert.ok(Math.abs(depthInside(s, touching)) < 1e-6 && surfaceGap(s, touching) < 1e-6, 'skin on the wall reads 0');
  const off = new THREE.Vector3(0, mid, -(r + FINGER_HALF + 0.01));
  assert.ok(Math.abs(surfaceGap(s, off) - 0.01) < 1e-6, '1 cm off reads 1 cm');
  const mug = makeHeldMug();
  mug.rotation.set(THREE.MathUtils.degToRad(30), 0, 0);
  mug.position.set(0, 0, 0);
  const g = new THREE.Group();
  g.add(mug);
  g.updateMatrixWorld(true);
  // makeHeldMug's own rotation is overwritten above: only the 30° about X remains.
  assert.ok(Math.abs(mugTilt(mug) - 30) < 1e-4, `a mug tilted 30° reads 30° (${mugTilt(mug)})`);
});

test('mug orientation (D2): in the canonical hand the mug\'s up runs to hand -Z and its handle to hand -X', () => {
  const mug = makeHeldMug();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mug.quaternion);
  const handle = new THREE.Vector3(1, 0, 0).applyQuaternion(mug.quaternion);
  assert.ok(up.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6, `up -> ${up.toArray()}`);
  assert.ok(handle.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-6, `handle -> ${handle.toArray()}`);
  assert.ok(mug.position.equals(MUG_IN_HAND.position));
});

/** Right-hand rest-space joint positions from a rig's calibrated finger definitions (offsets chain from the hand bone). */
function restChain(handBones: readonly HandDetailBone[]): Map<string, THREE.Vector3> {
  const byName = new Map(handBones.filter((b) => b.kind === 'finger' && b.side === 'R').map((b) => [b.name, b as FingerBoneDef]));
  const pos = new Map<string, THREE.Vector3>();
  const at = (name: string): THREE.Vector3 => {
    const hit = pos.get(name);
    if (hit) return hit;
    const d = byName.get(name as FingerBoneDef['name'])!;
    const base = d.parent.startsWith('finger_') ? at(d.parent) : new THREE.Vector3();
    const p = base.clone().add(new THREE.Vector3(...d.offset));
    pos.set(name, p);
    return p;
  };
  for (const name of byName.keys()) at(name);
  return pos;
}

test('rig calibration (task 4.1): every rig\'s fingers curl toward its own palm, with the thumb on the palm side', async () => {
  for (const [who, model] of RIGGED) {
    const m = await loadMainCast(model);
    const pos = restChain(m.handBones);
    const defs = new Map(m.handBones.filter((b): b is FingerBoneDef => b.kind === 'finger' && b.side === 'R').map((b) => [b.name, b]));
    const k = (f: string, i: number): THREE.Vector3 => pos.get(`finger_R_${f}_${i}`)!;
    // The palm side, from the hand's shape alone: fingers point down the middle finger, across runs index -> pinky.
    const across = k('pinky', 1).clone().sub(k('index', 1)).normalize();
    const down = k('middle', 2).clone().sub(k('middle', 1)).normalize();
    const palm = new THREE.Vector3().crossVectors(down, across).normalize();
    const kmid = k('index', 1).clone().add(k('pinky', 1)).multiplyScalar(0.5);
    // Independent check of that side: the thumb sits in front of the knuckle plane, on the palm side.
    const t3 = k('thumb', 3);
    const thumbTip = t3.clone().add(t3.clone().sub(k('thumb', 2)).multiplyScalar(0.85));
    assert.ok(thumbTip.clone().sub(kmid).dot(palm) > 0.005, `${who}: thumb tip ${(thumbTip.clone().sub(kmid).dot(palm) * 100).toFixed(1)} cm on the palm side`);
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      const d1 = defs.get(`finger_R_${f}_1` as FingerBoneDef['name'])!;
      const p1 = k(f, 1);
      const tip = k(f, 3).clone().add(k(f, 3).clone().sub(k(f, 2)).multiplyScalar(0.85));
      const curled = tip.clone().sub(p1).applyAxisAngle(new THREE.Vector3(...d1.curlAxis).normalize(), 1.2).add(p1);
      const move = curled.clone().sub(tip);
      assert.ok(move.dot(palm) > 0.5 * move.length(), `${who} ${f}: a curl moves the tip toward the palm`);
      assert.ok(Math.abs(move.dot(across)) < 0.3 * move.length(), `${who} ${f}: a curl does not sweep the tip sideways (${(move.dot(across) * 100).toFixed(1)} cm)`);
    }
  }
});

// ------------------------------------------------------------------ the cast, holding mugs

const HOLD_POSES = ['idle_mug', 'offer_mug', 'lean_back_mug', 'lean_back_mug_glance', 'lean_back_mug_glance_other', 'lean_back_mug_look_down', 'lean_back_mug_talk'];
const DRINK_POSES = ['drink', 'lean_back_mug_drink', 'lean_counter_drink', 'sit_chair_drink', 'sit_stool_drink', 'sit_sofa_drink'];
const RIGGED: ReadonlyArray<[string, MainCastModel]> = [
  ['giles', 'mechanic'],
  ['okafor', 'doctor'],
  ['priya', 'priya'],
  ['hale', 'hale'],
];
const FPS = 60;
const SECONDS = 3;

let libs: { bodyModels: BodyModelLibrary; mocap: MocapLibrary } | null = null;
async function cast(): Promise<{ bodyModels: BodyModelLibrary; mocap: MocapLibrary }> {
  if (libs) return libs;
  const entries = Object.fromEntries(await Promise.all(RIGGED.map(async ([, model]) => [model, await loadMainCast(model)] as const)));
  entries['bram'] = await loadMainCast('bram');
  entries['ruiz'] = await loadMainCast('ruiz');
  const core = coreJson as unknown as RawMocapFile;
  const mocap = new MocapLibrary(core);
  // Giles's profile names a posture hold clip; give it one (additive, from the talk idle) so the hold layer moves his arm.
  mocap.addPack('giles', { version: 1, fps: 24, source: 'test', clips: { giles_hold: makeAdditive(JSON.parse(JSON.stringify(core.clips['idle_talk']))) } });
  libs = { bodyModels: makeLib(entries), mocap };
  return libs;
}

function body(who: string, pose: string, l: { bodyModels: BodyModelLibrary; mocap: MocapLibrary }): Humanoid {
  const spec: HumanoidSpec = who === 'crew' ? { seed: 'mug-crew', outfit: 'crew', role: 'npc', pose } : { ...CAST[who]!, role: 'npc', pose };
  return new Humanoid(spec, { ...enemyCtx(), bodyModels: l.bodyModels, mocap: l.mocap });
}

/** Run a body for `seconds` (with one spoken line in the middle when `talk`), calling `each` with every frame's reading. */
function run(h: Humanoid, seconds: number, talk: boolean, each: (r: GripReading, frame: number) => void): void {
  for (let i = 0; i < seconds * FPS; i++) {
    if (talk && i === FPS / 2) h.speak('Third quarantine this month, and nobody tells the kitchen anything.', 'neutral', 2);
    h.update(1 / FPS);
    const r = readGrip(h);
    assert.ok(r, 'the body holds a mug');
    each(r, i);
  }
}

/** The middle of the lower lip, in the world: the jaw mesh's top vertex near the front of the face, moved by the posed jaw bone. */
function lowerLip(h: Humanoid): THREE.Vector3 {
  const parts = (h['geo'] as { parts: Array<{ bone: string; geometry: THREE.BufferGeometry }> }).parts.filter((p) => p.bone === 'jaw');
  let front = Infinity;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) front = Math.min(front, pos.getZ(i));
  }
  const lip = new THREE.Vector3(0, -Infinity, 0);
  const v = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.z < front + 0.01 && Math.abs(v.x) < 0.01 && v.y > lip.y) lip.copy(v);
    }
  }
  assert.ok(Number.isFinite(lip.y), 'the body has a jaw mesh to find the lip on');
  return h.bones.jaw.localToWorld(lip);
}

const deg = (v: number): string => `${v.toFixed(0)}°`;
const cm = (v: number): string => `${(v * 100).toFixed(1)} cm`;

// ------------------------------------------------------------------ the wrap solve (D5), per rig in rest space

test('wrap solve (task 5.1): every phalanx clear of the mug, index to pinky tips touching, solved once per rig', async () => {
  for (const [who, model] of RIGGED) {
    const hb = (await loadMainCast(model)).handBones;
    const g = heldGripFor(hb)!;
    assert.ok(g, `${who}: a grip is solved`);
    assert.equal(heldGripFor(hb), g, `${who}: the solve is cached per rig`);
    for (const f of FINGERS) {
      const c = g.clearanceAt(f, g.contact[f], g.splay[f]);
      assert.ok(c >= -0.0016, `${who} ${f}: ${cm(c)} past the skin margin`);
    }
    for (const f of ['index', 'middle', 'ring'] as const) {
      const pts = g.pointsAt(f, g.contact[f], g.splay[f]);
      const gap = surfaceGap(mugShape(), pts[pts.length - 1]!);
      assert.ok(gap <= 0.01, `${who} ${f}: tip ${cm(gap)} off the mug`);
    }
  }
});

test('thumb opposition (task 5.2): each rig\'s thumb tip within 1 cm of the mug', async () => {
  for (const [who, model] of RIGGED) {
    const g = heldGripFor((await loadMainCast(model)).handBones)!;
    const pts = g.pointsAt('thumb', g.contact.thumb, g.splay.thumb);
    const gap = surfaceGap(mugShape(), pts[pts.length - 1]!);
    assert.ok(gap <= 0.01, `${who}: thumb tip ${cm(gap)} off the mug`);
    assert.ok(g.clearanceAt('thumb', g.contact.thumb, g.splay.thumb) >= -0.0016, `${who}: thumb clear of the mug`);
  }
});

test('handle (task 5.3): turned into the opening of the grip, clear of every finger point', async () => {
  for (const [who, model] of RIGGED) {
    const g = heldGripFor((await loadMainCast(model)).handBones)!;
    const box = mugShape().handle.clone().expandByScalar(FINGER_HALF);
    for (const f of FINGERS) {
      const pts = g.pointsAt(f, g.contact[f], g.splay[f]);
      for (let i = 0; i + 1 < pts.length; i++) {
        for (let s = 0; s <= 4; s++) assert.ok(!box.containsPoint(pts[i]!.clone().lerp(pts[i + 1]!, s / 4)), `${who} ${f}: a finger passes through the handle`);
      }
    }
    // The palm is on the mug's far side from the handle (+X).
    assert.ok(g.palm.x < 0, `${who}: the handle points away from the palm`);
  }
});

test('A held mug stands upright: within 10° of vertical in hold and offer poses, every frame, every body', async () => {
  const l = await cast();
  const worst: string[] = [];
  for (const who of [...RIGGED.map(([w]) => w), 'bram', 'crew']) {
    for (const pose of HOLD_POSES) {
      let max = 0;
      run(body(who, pose, l), SECONDS, true, (r) => {
        max = Math.max(max, r.tilt);
      });
      if (max > 10) worst.push(`${who}/${pose} ${deg(max)}`);
    }
  }
  assert.deepEqual(worst, [], `mugs tilted past 10°: ${worst.join(', ')}`);
});

test('A drinking pose tips the mug toward the mouth: 30-70°, toward the face, rim within 6 cm of the mouth', async () => {
  const l = await cast();
  const bad: string[] = [];
  for (const [who] of RIGGED) {
    for (const pose of DRINK_POSES) {
      const h = body(who, pose, l);
      for (let i = 0; i < 1.5 * FPS; i++) h.update(1 / FPS);
      const r = readGrip(h)!;
      let mug: THREE.Object3D | null = null;
      h.group.traverse((o) => {
        if (o.name === 'held_mug') mug = o;
      });
      const m = mug as unknown as THREE.Object3D;
      const up = mugUp(m);
      const mugPos = m.getWorldPosition(new THREE.Vector3());
      const mouth = lowerLip(h);
      const toFace = mouth.clone().sub(mugPos).setY(0).normalize();
      const towardFace = up.clone().setY(0).dot(toFace) > 0;
      // Nearest point of the rim circle to the mouth.
      const s = mugShape();
      let rim = Infinity;
      for (let a = 0; a < 32; a++) {
        const p = m.localToWorld(new THREE.Vector3(Math.cos((a / 32) * Math.PI * 2) * s.rTop, s.yTop, Math.sin((a / 32) * Math.PI * 2) * s.rTop));
        rim = Math.min(rim, p.distanceTo(mouth));
      }
      if (r.tilt < 30 || r.tilt > 70 || !towardFace || rim > 0.06) bad.push(`${who}/${pose} tilt ${deg(r.tilt)} ${towardFace ? 'toward' : 'away from'} face, rim ${cm(rim)} from mouth`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('Lowering the mug: from lean_back_mug_drink to lean_back_mug the tilt moves at most 15° a frame and ends upright', async () => {
  const l = await cast();
  for (const [who] of RIGGED) {
    const h = body(who, 'lean_back_mug_drink', l);
    for (let i = 0; i < FPS; i++) h.update(1 / FPS);
    let prev = readGrip(h)!.tilt;
    h.setPose('lean_back_mug');
    let jump = 0;
    run(h, 2, false, (r) => {
      jump = Math.max(jump, Math.abs(r.tilt - prev));
      prev = r.tilt;
    });
    assert.ok(jump <= 15, `${who}: tilt jumps ${deg(jump)} in one frame`);
    assert.ok(prev <= 10, `${who}: ends ${deg(prev)} from vertical`);
  }
});

/**
 * How far (degrees) a rig's own grip axis is rolled from the canonical hand's (D4): a hand that sits rolled in its model's rest pose
 * needs that much extra turn to hold the mug level, whatever the shared pose does (Okafor about 42°, Giles 15°, Hale 18°).
 */
async function rigRoll(who: string): Promise<number> {
  const model = RIGGED.find(([w]) => w === who)?.[1];
  if (!model) return 0;
  const g = gripFrameFor((await loadMainCast(model)).handBones);
  return g ? THREE.MathUtils.radToDeg(g.up.angleTo(MUG_IN_HAND.up)) : 0;
}

test('grip frame (D4, task 4.2): each rig\'s mug rests against its own knuckle row; unrigged bodies keep the canonical placement', async () => {
  const l = await cast();
  const s = mugShape();
  for (const [who] of RIGGED) {
    const h = body(who, 'lean_back_mug', l);
    for (let i = 0; i < 30; i++) h.update(1 / FPS);
    let mug: THREE.Object3D | null = null;
    const knuckles: THREE.Vector3[] = [];
    h.group.traverse((o) => {
      if (o.name === 'held_mug') mug = o;
      if (/^finger_R_(index|middle|ring)_1$/.test(o.name)) knuckles.push(o.getWorldPosition(new THREE.Vector3()));
    });
    const inv = (mug as unknown as THREE.Object3D).matrixWorld.clone().invert();
    for (const k of knuckles) {
      const q = k.clone().applyMatrix4(inv);
      // The knuckle joint sits PALM_DEPTH behind the skin; the skin should rest on the wall (within 1 cm, never 3 mm into it).
      const gap = Math.hypot(q.x, q.z) - wallRadius(s, q.y) - PALM_DEPTH;
      assert.ok(gap > -0.003 && gap < 0.01, `${who}: knuckle skin ${cm(gap)} from the mug wall`);
    }
  }
  // Ruiz keeps her scan's own hands (no finger bones), so she stands in for unrigged bodies.
  const ruiz = body('ruiz', 'lean_back_mug', l);
  ruiz.update(1 / FPS);
  let mug: THREE.Object3D | null = null;
  ruiz.group.traverse((o) => {
    if (o.name === 'held_mug') mug = o;
  });
  assert.ok((mug as unknown as THREE.Object3D).position.equals(MUG_IN_HAND.position), 'an unrigged hand keeps the canonical mug placement');
});

test('Authored hold poses already hold the mug near level: the leveling swing standing still is under 15° beyond the rig\'s own roll (D3, task 3.1)', async () => {
  const l = await cast();
  const bad: string[] = [];
  for (const who of [...RIGGED.map(([w]) => w), 'bram']) {
    for (const pose of ['idle_mug', 'offer_mug', 'lean_back_mug']) {
      const h = body(who, pose, l);
      for (let i = 0; i < FPS; i++) h.update(1 / FPS);
      const s = THREE.MathUtils.radToDeg(h.heldSwing);
      const roll = await rigRoll(who);
      if (s >= 15 + roll) bad.push(`${who}/${pose} ${deg(s)} (rig roll ${deg(roll)})`);
    }
  }
  assert.deepEqual(bad, [], `hold poses needing a large swing: ${bad.join(', ')}`);
});

test('While the right hand holds a mug, speech gestures use the left hand and the mug hand barely moves (D3b)', async () => {
  const l = await cast();
  for (const pose of [...HOLD_POSES, ...DRINK_POSES]) {
    const h = body('okafor', pose, l);
    h.update(1 / FPS);
    h.speak('Third quarantine this month, and nobody tells the kitchen anything.', 'urgent', 2);
    h.update(1 / FPS);
    assert.equal(h['animator'].speechPrimarySide, 'L', `${pose}: gestures with the free hand`);
  }
  const free = body('okafor', 'idle', l);
  free.speak('Third quarantine this month, and nobody tells the kitchen anything.', 'urgent', 2);
  free.update(1 / FPS);
  assert.equal(free['animator'].speechPrimarySide, 'R', 'empty hands keep their usual gesturing hand');
  for (const [who] of RIGGED) {
    const h = body(who, 'lean_back_mug', l);
    let max = 0;
    run(h, SECONDS, true, () => {
      max = Math.max(max, h.heldSwing);
    });
    const roll = await rigRoll(who);
    assert.ok(THREE.MathUtils.radToDeg(max) < 25 + roll, `${who}: the leveling swing reaches ${deg(THREE.MathUtils.radToDeg(max))} over a spoken line (rig roll ${deg(roll)})`);
  }
});

test('A calm line with a mug in the right hand gestures from the free left elbow; the mug arm gets nothing (speech-acting)', async () => {
  const l = await cast();
  const quiet = body('okafor', 'lean_back_mug', l);
  const loud = body('okafor', 'lean_back_mug', l);
  for (let i = 0; i < FPS / 2; i++) {
    quiet.update(1 / FPS);
    loud.update(1 / FPS);
  }
  loud.speak('Right, so the pump feeds the loop, and the loop feeds the bay.', 'neutral', 3, 'mug-calm');
  const peak = { upperL: 0, foreL: 0, upperR: 0, foreR: 0, tilt: 0 };
  for (let i = 0; i < 3 * FPS; i++) {
    quiet.update(1 / FPS);
    loud.update(1 / FPS);
    const d = (j: 'upperArm_L' | 'foreArm_L' | 'upperArm_R' | 'foreArm_R'): number =>
      THREE.MathUtils.radToDeg(loud.bones[j].quaternion.angleTo(quiet.bones[j].quaternion));
    peak.upperL = Math.max(peak.upperL, d('upperArm_L'));
    peak.foreL = Math.max(peak.foreL, d('foreArm_L'));
    peak.upperR = Math.max(peak.upperR, d('upperArm_R'));
    peak.foreR = Math.max(peak.foreR, d('foreArm_R'));
    peak.tilt = Math.max(peak.tilt, readGrip(loud)!.tilt);
  }
  assert.equal(loud['animator'].speechPrimarySide, 'L', 'the free hand gestures');
  assert.ok(peak.foreL > 8, `the left forearm lifts from the elbow (${deg(peak.foreL)})`);
  assert.ok(peak.upperL <= 6, `the left upper arm stays near its idle (${peak.upperL.toFixed(2)}°)`);
  assert.ok(peak.upperR < 1 && peak.foreR < 1, `the mug arm gets no speech gesture (${peak.upperR.toFixed(2)}°, ${peak.foreR.toFixed(2)}°)`);
  assert.ok(peak.tilt < 10, `the mug stays upright (${deg(peak.tilt)})`);
  quiet.dispose();
  loud.dispose();
});

test('Fingers wrap a held mug without entering it: no phalanx more than 3 mm inside, none in the handle', async () => {
  const l = await cast();
  const bad: string[] = [];
  for (const [who] of RIGGED) {
    for (const pose of [...HOLD_POSES, ...DRINK_POSES]) {
      let deepest = -Infinity;
      let finger = '';
      let handle = 0;
      run(body(who, pose, l), SECONDS, true, (r) => {
        if (r.deepest > deepest) {
          deepest = r.deepest;
          finger = r.deepestFinger;
        }
        handle = Math.max(handle, r.inHandle);
      });
      if (deepest > 0.003 || handle > 0) bad.push(`${who}/${pose} ${finger} ${cm(deepest)} inside, ${handle} points in the handle`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('Fidgeting hands never enter the mug (Hale; Giles at infection stage 3)', async () => {
  const l = await cast();
  for (const [who, stage] of [['hale', 0], ['giles', 3]] as const) {
    const h = body(who, 'lean_back_mug', l);
    h.setHandTwitchStage(stage);
    let deepest = -Infinity;
    run(h, SECONDS, false, (r) => {
      deepest = Math.max(deepest, r.deepest);
    });
    assert.ok(deepest <= 0.003, `${who}: a finger goes ${cm(deepest)} into the mug`);
  }
});

test('Fingers and thumb touch a held mug: index, middle, ring and thumb tips within 1 cm', async () => {
  const l = await cast();
  const bad: string[] = [];
  for (const [who] of RIGGED) {
    const h = body(who, 'lean_back_mug', l);
    for (let i = 0; i < FPS; i++) h.update(1 / FPS);
    const r = readGrip(h)!;
    for (const f of ['index', 'middle', 'ring', 'thumb'] as const) {
      const g = r.tipGap[f] ?? Infinity;
      if (g > 0.01) bad.push(`${who} ${f} tip ${cm(g)} off`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

// Priya's thumb root sits beside her index on the fingers' side, and no clear pose within its curl and opposition range brings it
// round the far side, so the spec lets it rest along the mug by the index, tip at the rim (held-props: thumb on the rim).
test('Thumb opposed: Giles, Okafor and Hale come round the mug from the opposite side to the fingers', async () => {
  const l = await cast();
  const bad: string[] = [];
  for (const who of ['giles', 'okafor', 'hale']) {
    const h = body(who, 'lean_back_mug', l);
    for (let i = 0; i < FPS; i++) h.update(1 / FPS);
    if (!readGrip(h)!.thumbOpposed) bad.push(`${who} thumb on the fingers' side`);
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('Thumb on the rim: Priya\'s thumb tip rests at the rim\'s height, on the mug', async () => {
  const l = await cast();
  const h = body('priya', 'lean_back_mug', l);
  for (let i = 0; i < FPS; i++) h.update(1 / FPS);
  let mug: THREE.Object3D | null = null;
  h.group.traverse((o) => {
    if (o.name === 'held_mug') mug = o;
  });
  const inv = (mug as unknown as THREE.Object3D).matrixWorld.clone().invert();
  const tip = sampleFingers(h.group)!.tips.get('thumb')!.clone().applyMatrix4(inv);
  const s = mugShape();
  assert.ok(Math.abs(tip.y - s.yTop) <= 0.015, `thumb tip ${cm(tip.y - s.yTop)} from the rim's height`);
  assert.ok(surfaceGap(s, tip) <= 0.01, `thumb tip ${cm(surfaceGap(s, tip))} off the mug`);
});

test('Picking up and putting down: the grip eases over at least 0.1 s', async () => {
  const l = await cast();
  for (const [who] of RIGGED) {
    for (const [from, to] of [['lean_back', 'lean_back_mug'], ['lean_back_mug', 'lean_back']] as const) {
      const h = body(who, from, l);
      for (let i = 0; i < FPS; i++) h.update(1 / FPS);
      // Every phalanx of the hand (a single finger's held and relaxed curls can happen to match).
      const curls = (): number[] => FINGERS.flatMap((f) => h.fingerPhalanxCurls('R', f));
      const dist = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0);
      const before = curls();
      h.setPose(to);
      h.update(1 / FPS);
      const firstCurls = curls();
      for (let i = 0; i < FPS; i++) h.update(1 / FPS);
      const after = curls();
      const total = dist(after, before);
      const first = dist(firstCurls, before);
      assert.ok(total > 0.02, `${who} ${from} -> ${to}: the grip changes (${total.toFixed(3)})`);
      // In one frame of 1/60 s, an ease of 0.1 s or longer covers well under half the change.
      assert.ok(first < total * 0.5, `${who} ${from} -> ${to}: the grip snaps (${first.toFixed(3)} of ${total.toFixed(3)} in one frame)`);
    }
  }
});

test('The mug sits in each character\'s own hand: Giles and Okafor (8.6 and 12.6 cm hands) both pass the grip checks', async () => {
  const l = await cast();
  for (const who of ['giles', 'okafor']) {
    const h = body(who, 'lean_back_mug', l);
    for (let i = 0; i < FPS; i++) h.update(1 / FPS);
    const r = readGrip(h)!;
    assert.ok(r.deepest <= 0.003, `${who}: ${r.deepestFinger} ${cm(r.deepest)} inside the mug`);
    const near = (['index', 'middle', 'ring'] as const).filter((f) => (r.tipGap[f] ?? Infinity) <= 0.02).length;
    assert.ok(near >= 2, `${who}: the mug is not against the palm (fingertip gaps ${JSON.stringify(r.tipGap)})`);
  }
});

test('The mug\'s handle points away from the grip, never into the palm', async () => {
  const l = await cast();
  const bad: string[] = [];
  for (const who of [...RIGGED.map(([w]) => w), 'bram']) {
    for (const pose of ['idle_mug', 'lean_back_mug', 'offer_mug']) {
      const h = body(who, pose, l);
      for (let i = 0; i < FPS; i++) h.update(1 / FPS);
      const r = readGrip(h)!;
      if (r.handleFromPalm < 90 || r.inHandle > 0) bad.push(`${who}/${pose} handle ${deg(r.handleFromPalm)} from the palm, ${r.inHandle} finger points in it`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});
