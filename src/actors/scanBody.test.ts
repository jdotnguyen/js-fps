import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * scripts/lib/scan-body.mjs arm separation on a synthetic body (openspec imported-body-models): a closed box whose -X third is
 * labelled as the right arm, as if a sleeve were fused to the torso's side. Below the armpit the two must come apart, both
 * openings must be closed and face away from each other, and the torso must carry no arm weight.
 */
interface Body { pos: number[]; nor: number[]; uv: number[]; indices: number[] }
interface ScanBodyLib {
  splitArms(body: Body, labels: Int8Array, opts: { armpitY: { Left: number; Right: number }; torsoAxis: [number, number] }): {
    labelOf: Int8Array; pieceOf: Int8Array; armpitY: { Left: number; Right: number }; blend: number; capStart: number; capLabel: Int8Array;
  };
  skinScan(opts: Record<string, unknown>): { names: string[]; joints: Uint8Array; weights: Uint16Array };
}
const LIB = new URL('../../scripts/lib/scan-body.mjs', import.meta.url).href;
const lib = (await import(LIB)) as ScanBodyLib;

const STEP = 0.05;
const ARMPIT = 1.4;
const at = (i: number): number => +(i * STEP).toFixed(4);

/** Closed box x [-0.2, 0.2], y [0.8, 1.6], z [-0.1, 0.1] on a 5 cm grid, faces wound outward, one vertex set per face. */
function box(): Body {
  const b: Body = { pos: [], nor: [], uv: [], indices: [] };
  const span = { x: [-4, 4], y: [16, 32], z: [-2, 2] } as const;
  const axes = ['x', 'y', 'z'] as const;
  for (const n of axes) for (const sgn of [-1, 1]) {
    const [u, v] = axes.filter((a) => a !== n) as [typeof axes[number], typeof axes[number]];
    const fixed = sgn < 0 ? span[n][0] : span[n][1];
    const base = b.pos.length / 3;
    const nu = span[u][1] - span[u][0], nv = span[v][1] - span[v][0];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p = { x: 0, y: 0, z: 0 };
      p[n] = at(fixed); p[u] = at(span[u][0] + i); p[v] = at(span[v][0] + j);
      b.pos.push(p.x, p.y, p.z);
      b.nor.push(n === 'x' ? sgn : 0, n === 'y' ? sgn : 0, n === 'z' ? sgn : 0);
      b.uv.push(i / nu, j / nv);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = base + i * (nv + 1) + j, c = a + nv + 1;
      // u x v points along +n for (x: y,z), (y: x,z) flipped, (z: x,y); pick the winding that faces outward.
      const out = (n === 'y' ? -1 : 1) * sgn > 0;
      if (out) b.indices.push(a, c, c + 1, a, c + 1, a + 1); else b.indices.push(a, c + 1, c, a, a + 1, c + 1);
    }
  }
  return b;
}

const centroid = (b: Body, t: number): number[] => [0, 1, 2].map((k) => (b.pos[b.indices[t * 3]! * 3 + k]! + b.pos[b.indices[t * 3 + 1]! * 3 + k]! + b.pos[b.indices[t * 3 + 2]! * 3 + k]!) / 3);
const key = (b: Body, v: number): string => `${b.pos[v * 3]},${b.pos[v * 3 + 1]},${b.pos[v * 3 + 2]}`;

function split(armpit = ARMPIT): { b: Body; labels: Int8Array; r: ReturnType<ScanBodyLib['splitArms']> } {
  const b = box();
  const nT = b.indices.length / 3;
  const labels = new Int8Array(nT);
  for (let t = 0; t < nT; t++) labels[t] = centroid(b, t)[0]! < -0.1 ? 2 : 0;
  const r = lib.splitArms(b, labels, { armpitY: { Left: armpit, Right: armpit }, torsoAxis: [0, 0] });
  const all = Int8Array.from([...labels, ...r.capLabel]);
  return { b, labels: all, r };
}

/** Vertices below the armpit used by both arm and body triangles (the two copies at the cut share a position, not a vertex). */
function sharedBelowArmpit(b: Body, labels: Int8Array): number {
  const users = new Map<number, Set<number>>();
  for (let t = 0; t < b.indices.length / 3; t++) for (let k = 0; k < 3; k++) {
    const v = b.indices[t * 3 + k]!;
    if (b.pos[v * 3 + 1]! >= ARMPIT) continue;
    (users.get(v) ?? users.set(v, new Set()).get(v)!).add(labels[t]!);
  }
  return [...users.values()].filter((l) => l.size > 1).length;
}

test('scan-body splitArms: below the armpit no vertex is shared by the arm and the body', () => {
  // Control: with the armpit below the box nothing is cut, and the seam is shared.
  const uncut = split(0);
  assert.ok(sharedBelowArmpit(uncut.b, uncut.labels) > 0, 'an uncut seam shares vertices');
  const { b, labels } = split();
  const shared = sharedBelowArmpit(b, labels);
  assert.equal(shared, 0, `${shared} vertices below the armpit are used by both the arm and the body`);
  // ... and the two sides really were joined there before: the cut duplicated the seam.
  const before = box();
  assert.ok(b.pos.length > before.pos.length, 'the split added vertices');
});

test('scan-body splitArms: both pieces are closed below the armpit and the caps face away from each other', () => {
  const { b, labels, r } = split();
  for (const piece of [0, 2]) {
    const edges = new Map<string, number>();
    for (let t = 0; t < b.indices.length / 3; t++) {
      if (labels[t] !== piece) continue;
      for (let k = 0; k < 3; k++) {
        const a = key(b, b.indices[t * 3 + k]!), c = key(b, b.indices[t * 3 + ((k + 1) % 3)]!);
        edges.set(`${a}|${c}`, (edges.get(`${a}|${c}`) ?? 0) + 1);
      }
    }
    const open = [...edges.keys()].filter((e) => {
      const [a, c] = e.split('|');
      if (edges.has(`${c}|${a}`)) return false;
      return Math.max(Number(a!.split(',')[1]), Number(c!.split(',')[1])) < ARMPIT - 1e-9;
    });
    assert.equal(open.length, 0, `piece ${piece}: ${open.length} open edges below the armpit`);
  }
  assert.ok(r.capLabel.length > 0, 'caps were added');
  for (let i = 0; i < r.capLabel.length; i++) {
    const t = r.capStart + i;
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((a) => b.pos[b.indices[t * 3 + k]! * 3 + a]!));
    const u = [0, 1, 2].map((a) => p[1]![a]! - p[0]![a]!), w = [0, 1, 2].map((a) => p[2]![a]! - p[0]![a]!);
    const nx = u[1]! * w[2]! - u[2]! * w[1]!;
    // The arm sits at -X: the body's cap faces it (-X), the arm's cap faces the torso (+X).
    if (Math.abs(nx) < 1e-9) continue;
    assert.ok(r.capLabel[i] === 0 ? nx < 0 : nx > 0, `cap triangle ${i} (piece ${r.capLabel[i]}) faces the wrong way`);
  }
});

test('scan-body skinScan: below the armpit the body carries no arm weight and the arm only arm weight', () => {
  const { b, r } = split();
  const J: Record<string, number[]> = {
    Hips: [0, 0.9, 0], Spine: [0, 1.1, 0], Spine1: [0, 1.3, 0], Neck: [0, 1.55, 0], Head: [0, 1.65, 0], HeadTop: [0, 1.9, 0],
    RightShoulder: [-0.05, 1.5, 0], RightArm: [-0.15, 1.45, 0], RightForeArm: [-0.15, 1.15, 0], RightHand: [-0.15, 0.9, 0], RightHandEnd: [-0.15, 0.8, 0],
  };
  const BONES: Record<string, [string | null, string | null, number]> = {
    Hips: [null, 'Spine', 0.18], Spine: ['Hips', 'Spine1', 0.18], Spine1: ['Spine', 'Neck', 0.18], Neck: ['Spine1', 'Head', 0.07], Head: ['Neck', 'HeadTop', 0.14],
    RightShoulder: ['Spine1', 'RightArm', 0.07], RightArm: ['RightShoulder', 'RightForeArm', 0.08], RightForeArm: ['RightArm', 'RightHand', 0.07],
    RightHand: ['RightForeArm', 'RightHandEnd', 0.06], RightHandEnd: ['RightHand', null, 0.04],
  };
  const skin = lib.skinScan({ pos: b.pos, indices: b.indices, J, BONES, arms: r });
  const arm = new Set(['RightArm', 'RightForeArm', 'RightHand'].map((n) => skin.names.indexOf(n)));
  const used = new Set(b.indices);
  let bodyVerts = 0, armVerts = 0;
  for (const v of used) {
    // Hard mask below the blend band (splitArms' default 4 cm eases into the shoulder blend just under the armpit).
    if (b.pos[v * 3 + 1]! >= ARMPIT - r.blend) continue;
    let w = 0;
    for (let k = 0; k < 4; k++) if (arm.has(skin.joints[v * 4 + k]!)) w += skin.weights[v * 4 + k]! / 65535;
    if (r.labelOf[v] === 0) { bodyVerts++; assert.ok(w < 1e-4, `body vertex ${v} at y ${b.pos[v * 3 + 1]} has arm weight ${w}`); }
    else { armVerts++; assert.ok(w > 1 - 1e-4, `arm vertex ${v} at y ${b.pos[v * 3 + 1]} has only ${w} arm weight`); }
  }
  assert.ok(bodyVerts > 50 && armVerts > 50, `${bodyVerts} body and ${armVerts} arm vertices checked`);
});
