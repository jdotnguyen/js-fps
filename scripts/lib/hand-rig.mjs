import { membraneCap } from './scan-body.mjs';
// Finger chains and forearm twist bones for the scan bodies (per-character-motion D7, task 5.5).
//
// The scan bodies (Bram, Heins, Ruiz, Sung) were rigged with one stub bone per hand (`<Side>Hand` -> `<Side>HandMiddle1`), so the
// hand solver had nothing to curl. After a prep script has skinned its body, `splitHands` cuts apart what the scan fused or pressed
// together (below), then `rigHands` adds, per hand:
//   - five finger chains of three bones each, Mixamo-named so bodyModel.ts maps them (`<Side>HandThumb1..3`, `<Side>HandIndex1..3`,
//     `<Side>HandMiddle1..3` reusing the existing middle stub, `<Side>HandRing1..3`, `<Side>HandPinky1..3`);
//   - a forearm twist bone halfway down the forearm (`<Side>ForeArmTwist1`), which bodyModel.ts drives with part of the wrist roll.
// Fingers are found from the hand's own vertices, in a palm frame from the wrist and the middle-knuckle stub:
//   - the palm's width axis is the main spread of the palm's vertices across the hand; its thumb side is the edge the thumb sticks
//     out from;
//   - past the knuckles, vertices are clustered into four strips across that axis (index to pinky). Separate fingers fall into
//     their own strips; fused ones (a glove, a mitten-like scan) are split into strips all the same (D7's fallback);
//   - each finger's three joints follow its own vertices from base to tip (centroids at 0, 45% and 75% of the way), so curled
//     fingers get bent chains;
//   - the thumb is the vertices sticking out past the palm's edge on the thumb side, before the knuckles, plus any patch of the
//     strips that never reaches back to the knuckles but borders it (a thumb tip lying on the index finger).
// Cutting (splitHands): where a finger touches another, the thumb, or the palm far from its knuckle, the shared vertices are
// duplicated per side and each side's opening is capped, the way scan-body.mjs's splitArms parts an arm from the torso. Without it a
// fist tears the skin between them (bodyModel.test.ts: no edge of 3 mm or more stretches past 2.5x in a fist).
// Weights: each hand vertex's hand weight (`Hand` + `HandMiddle1`) is re-split between the palm and its finger's bones (short
// blends at each knuckle and joint, the membership smoothed over the cut mesh by inverse edge length); the forearm's weight is split between the forearm and its twist bone along the forearm.
// Every other bone's weight is untouched, so the arm, the cut and the body stay as the prep left them.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (len(a) || 1));
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mean = (pts) => (pts.length ? scale(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length) : null);

/** Principal axis of points (power iteration on the 3x3 covariance). */
function mainAxis(pts) {
  const c = mean(pts);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j];
  }
  let v = [1, 0.3, 0.2];
  for (let it = 0; it < 50; it++) v = norm([C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]]);
  return v;
}

/**
 * Shortest paths over the mesh (Dijkstra on the welded neighbour sets) from `sources`, through `allowed` vertices only.
 * Returns a Map vertex -> distance (metres).
 */
function geodesic(sources, allowed, nbrs, at) {
  const dist = new Map(sources.map((w) => [w, 0]));
  const open = new Set(sources);
  while (open.size) {
    let w = -1, best = Infinity;
    for (const o of open) { const d = dist.get(o); if (d < best) { best = d; w = o; } }
    open.delete(w);
    for (const o of nbrs[w]) {
      if (!allowed.has(o)) continue;
      const d = best + len(sub(at(o), at(w)));
      if (d < (dist.get(o) ?? Infinity)) { dist.set(o, d); open.add(o); }
    }
  }
  return dist;
}

/**
 * A finger's chain from its vertices: places measured over the surface from the base (so a curled or folded finger, or one
 * touching the palm, is measured along itself), joints at the centroids of the vertices 0, 45% and 75% of the way to the tip.
 * `field` is a shared surface-distance map from the knuckle line (the four fingers: one measure, so neighbours on different strips
 * agree); without it the finger's own vertices are walked from their base (the thumb). Without neighbour sets, straight-line
 * distance from the base stands in. Returns the joints, the tip, the reach and the per-vertex distance map (`geo`).
 */
function fingerChain(idxs, base, nbrs, at, field = null, common = null) {
  if (!nbrs || idxs.length < 3) return { ...chainAlong(idxs.map(at), base), geo: null };
  const byBase = [...idxs].sort((p, q) => len(sub(at(p), base)) - len(sub(at(q), base)));
  let sources = byBase.slice(0, Math.max(3, Math.round(idxs.length * 0.06)));
  let geo = field;
  if (!geo) geo = geodesic(sources, new Set(idxs), nbrs, at);
  else sources = [...idxs].sort((p, q) => (geo.get(p) ?? Infinity) - (geo.get(q) ?? Infinity)).slice(0, sources.length);
  // Vertices cut off from the base (a separate island) take their straight-line distance.
  for (const w of idxs) if (!geo.has(w)) geo.set(w, len(sub(at(w), base)));
  const own = Math.max(...idxs.map((w) => geo.get(w))) || 1e-3;
  // Joint lines at shared places across the four fingers (`common`: the knuckle rows line up), else at the finger's own. A band
  // with no vertices falls back to the straight line from the base to the tip.
  const far = common ?? own;
  const tipW = idxs.reduce((m, w) => (geo.get(w) > geo.get(m) ? w : m), idxs[0]);
  const line = (frac) => add(mean(sources.map(at)) ?? base, scale(sub(at(tipW), mean(sources.map(at)) ?? base), frac));
  const near = (frac, band) => mean(idxs.filter((w) => Math.abs(geo.get(w) - frac * far) < band * far).map(at)) ?? line(frac);
  // The base joint: with the shared field, the per-axis median of the strip's nearest 15% to the knuckle line, so a few vertices
  // of something else there (the plate over Heins's knuckles) cannot pull it off the finger.
  let j0 = mean(sources.map(at)) ?? base;
  if (field) {
    const low = [...idxs].sort((p, q) => geo.get(p) - geo.get(q)).slice(0, Math.max(3, Math.round(idxs.length * 0.15))).map(at);
    j0 = [0, 1, 2].map((k) => low.map((p) => p[k]).sort((x, y) => x - y)[Math.floor(low.length / 2)]);
  }
  return { joints: [j0, near(0.45, 0.08), near(0.75, 0.08)], tip: at(tipW), reach: far, own, geo };
}

/** Joint points along a set of finger vertices from `base`: the centroids of the vertices at 0, 45% and 75% of the way to the tip. */
function chainAlong(pts, base) {
  const d = pts.map((p) => len(sub(p, base)));
  const far = Math.max(...d);
  const near = (f, band) => mean(pts.filter((_, i) => Math.abs(d[i] - f * far) < band * far)) ?? add(base, scale(norm(sub(pts[d.indexOf(far)], base)), f * far));
  return { joints: [base, near(0.45, 0.08), near(0.75, 0.08)], tip: pts[d.indexOf(far)], reach: far };
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
/** How far out from the palm's centre line, in palm half-widths, a vertex counts as thumb (the thumb itself widens the palm). */
const THUMB_OUT = 0.75;
/** Where the knuckles sit, as a share of the wrist-to-fingertip reach. */
const KNUCKLE_AT = 0.55;
/**
 * Summed finger bend (metres) against the guessed palm side beyond which the thumb side is flipped. Below it the fingers are too
 * straight to tell and the first guess stands. Flat hands can read past it the wrong way: Bram's T-pose left hand read -4.4 cm on
 * its true side and +2.0 cm flipped, so his prep pins both thumbs (`pinThumbs`, fix-bram-rig).
 */
const BEND_SURE = 0.03;
/**
 * Laplacian passes over each hand vertex's membership (palm, thumb or finger; half own, half the neighbours' average). Strips and the
 * thumb are assigned outright, so without them two neighbours on different fingers (fused fingers, the webbing, the thumb's edge)
 * tear apart in a fist.
 */
const HAND_SMOOTHING = 6;
/** Islands of a finger strip smaller than this share of its largest (or 3 vertices) are left out of its chain's fit. */
const CRUMB = 0.05;

/**
 * One hand's frame and labelling: its vertices, the palm frame, and which of them are thumb or one of the four finger strips (the
 * rest is palm), with the chains through them. Shared by splitHands (which cuts the mesh where two of these touch) and rigHands
 * (which builds the bones and weights from it). `fixed`: the plan splitHands cut with ({ palmLen, l, members }); its frame is kept
 * and every vertex keeps the member it was cut as, since the copies the cut made sit exactly where their originals sit and would
 * otherwise all fall into one strip again. `pinThumbs`: sides whose thumb side the caller knows; `thumbToward` decides it outright
 * and the bend check may not flip it.
 */
function planHand({ side, W, wPos, names, J, nbrs, thumbToward = {}, pinThumbs = [], log = console.log, fixed = null }) {
  const nW = wPos.length / 3;
  const NB = names.length;
  const at = (w) => [wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]];
  const col = new Map(names.map((n, i) => [n, i]));
  const iHand = col.get(`${side}Hand`), iMid = col.get(`${side}HandMiddle1`), iFore = col.get(`${side}ForeArm`);
  if (iHand === undefined || iMid === undefined || iFore === undefined) throw new Error(`hand-rig: ${side} needs ForeArm, Hand and HandMiddle1`);
  const wrist = J[`${side}Hand`], knuckle = J[`${side}HandMiddle1`], elbow = J[`${side}ForeArm`];
  const a = norm(sub(knuckle, wrist));
  // Hand vertices: mostly on the hand bones.
  const hand = [];
  for (let w = 0; w < nW; w++) if (W[w * NB + iHand] + W[w * NB + iMid] > 0.5) hand.push(w);
  if (hand.length < 30) throw new Error(`hand-rig: ${side} hand has only ${hand.length} vertices`);
  // The knuckle line from the hand itself: the knuckles sit about 55% of the way from the wrist to the fingertips. The prep's
  // middle stub is only a direction (Heins's sat halfway along her middle finger, so her fingers would have bent mid-finger).
  const reach = hand.map((w) => dot(sub(at(w), wrist), a)).sort((x, y) => x - y)[Math.floor(hand.length * 0.98)];
  const palmLen = fixed?.palmLen ?? KNUCKLE_AT * reach;
  const stubLen = len(sub(knuckle, wrist));
  const local = (p) => { const d = sub(p, wrist); const s = dot(d, a); return { s, q: sub(d, scale(a, s)) }; };
  // Palm width axis from the palm's vertices (between the wrist and the knuckles), perpendicular to the hand axis.
  const palmPts = hand.map(at).filter((p) => { const { s } = local(p); return s > palmLen * 0.3 && s < palmLen * 0.95; }).map((p) => local(p).q);
  let l = fixed?.l;
  if (!l) {
    l = mainAxis(palmPts);
    l = norm(sub(l, scale(a, dot(l, a))));
  }
  const latOf = (p) => dot(local(p).q, l);
  const spread = () => {
    const xs = palmPts.map((q) => dot(q, l)).sort((x, y) => x - y);
    const lo = xs[Math.floor(xs.length * 0.1)], hi = xs[Math.floor(xs.length * 0.9)];
    return { half: (hi - lo) / 2, mid: (hi + lo) / 2 };
  };
  // Thumb side (+ along the width axis): first guess toward `thumbToward[side]` (default +Z, forward: with relaxed arms the thumbs
  // point forward), or, when the width axis is nearly side-on to that, the edge more vertices stick out past (a protruding
  // thumb). The guess is then checked against the fingers' own bend (below).
  let { half, mid } = spread();
  const stick = (sign) => hand.filter((w) => { const p = at(w); const { s } = local(p); return s > 0 && s < palmLen * 0.95 && sign * (latOf(p) - mid) > half * 1.2; }).length;
  const toward = thumbToward[side] ?? [0, 0, 1];
  const facing = dot(l, norm(toward));
  const flip = () => {
    l = scale(l, -1);
    ({ half, mid } = spread());
  };
  // A pinned side's thumb side comes from `thumbToward` alone, so the width axis has to point somewhere near it.
  const thumbPinned = pinThumbs.includes(side);
  if (!fixed && thumbPinned && Math.abs(facing) < 0.25) {
    throw new Error(`hand-rig ${side}: the thumb side is pinned to thumbToward, but the palm's width axis is side-on to it (${facing.toFixed(2)})`);
  }
  if (!fixed && (Math.abs(facing) >= 0.25 ? facing < 0 : stick(-1) > stick(1))) flip();
  const fm = fixed?.members;

  /** Thumb, finger strips and chains for the current width axis (thumb side +). */
  const label = () => {
    // Thumb: past the palm's thumb edge, up to a little beyond the knuckle line (its tip can reach past it).
    const thumbList = fm ? hand.filter((w) => fm.get(w) === 1) : hand.filter((w) => { const p = at(w); const { s } = local(p); return s > -palmLen * 0.1 && s < palmLen * 1.15 && latOf(p) - mid > half * THUMB_OUT; });
    const thumbIdx = new Set(thumbList);
    // Fingers: past the knuckles, not the thumb. Four equal strips across their span (5th to 95th percentile), ascending lateral:
    // pinky .. index. Equal strips rather than clusters: fingers lying together (Bram's) pull cluster centres into the middle.
    let fingerIdx = fm ? hand.filter((w) => fm.get(w) >= 2) : hand.filter((w) => !thumbIdx.has(w) && local(at(w)).s > palmLen * 0.92);
    // A thumb reaching past the knuckle line (Heins's right thumb tip, on her index finger) leaves its tip among the fingers: a
    // patch of them that never reaches back to the knuckles but borders the thumb is the thumb's.
    if (!fm && nbrs) {
      const inF = new Set(fingerIdx);
      const seen = new Set();
      for (const w0 of fingerIdx) {
        if (seen.has(w0)) continue;
        const comp = [w0];
        seen.add(w0);
        for (let i = 0; i < comp.length; i++) for (const o of nbrs[comp[i]]) if (inF.has(o) && !seen.has(o)) { seen.add(o); comp.push(o); }
        if (comp.some((w) => local(at(w)).s < palmLen * 1.0)) continue;
        if (!comp.some((w) => [...nbrs[w]].some((o) => thumbIdx.has(o)))) continue;
        for (const w of comp) { thumbIdx.add(w); thumbList.push(w); }
      }
      fingerIdx = fingerIdx.filter((w) => !thumbIdx.has(w));
    }
    const fl = fingerIdx.map((w) => latOf(at(w))).sort((x, y) => x - y);
    const f0 = fl[Math.floor(fl.length * 0.05)], f1 = fl[Math.floor(fl.length * 0.95)];
    const centres = [0, 1, 2, 3].map((i) => f0 + ((i + 0.5) / 4) * (f1 - f0));
    const fingerOf = (w) => {
      if (fm?.get(w) >= 2) return fm.get(w) - 2;
      const x = latOf(at(w));
      let best = 0;
      for (let i = 1; i < 4; i++) if (Math.abs(x - centres[i]) < Math.abs(x - centres[best])) best = i;
      return 3 - best; // 0 index .. 3 pinky
    };
    const groups = FINGERS.map(() => []);
    for (const w of fingerIdx) groups[fingerOf(w)].push(w);
    // The chains are fitted to each strip's core: crumbs detached from the rest of the strip (a stray vertex of a plate over
    // Heins's knuckles) would drag a finger's base joint onto them. They keep their label and weights.
    const cores = groups.map((idxs) => {
      if (!nbrs) return idxs;
      const own = new Set(idxs), seen = new Set(), comps = [];
      for (const w0 of idxs) {
        if (seen.has(w0)) continue;
        const comp = [w0];
        seen.add(w0);
        for (let i = 0; i < comp.length; i++) for (const o of nbrs[comp[i]]) if (own.has(o) && !seen.has(o)) { seen.add(o); comp.push(o); }
        comps.push(comp);
      }
      const big = Math.max(0, ...comps.map((c) => c.length));
      return comps.filter((c) => c.length >= Math.max(3, big * CRUMB)).flat();
    });
    // One surface-distance field over the four fingers from the knuckle line (the strips need not follow real fingers: Bram's lie
    // together, and a walk confined to a strip detours round its edge).
    const zone = hand.filter((w) => !thumbIdx.has(w) && local(at(w)).s > palmLen * 0.75);
    const field = nbrs ? geodesic(zone.filter((w) => local(at(w)).s < palmLen * 0.95), new Set(zone), nbrs, at) : null;
    // Chains. Bases sit on the knuckle line at each strip's centre; the middle stub moves onto its own base.
    const chains = FINGERS.map((f, i) => {
      const pts = cores[i].map(at);
      const knuckleBand = pts.filter((p) => { const { s } = local(p); return s < palmLen * 1.08; });
      const base = mean(knuckleBand.length >= 3 ? knuckleBand : pts.slice(0, 3)) ?? add(knuckle, scale(l, centres[3 - i] - mid));
      return { finger: f, base, ...fingerChain(cores[i], base, nbrs, at, field), count: groups[i].length };
    });
    // Shared finger length for the joint lines: the 75th percentile of the strips' own lengths (the little finger is short).
    if (field) {
      const lens = chains.map((c) => c.own).sort((x, y) => x - y);
      const common = lens[Math.min(3, Math.round(lens.length * 0.75) - 1)] ?? lens[lens.length - 1];
      for (let i = 0; i < chains.length; i++) Object.assign(chains[i], fingerChain(cores[i], chains[i].base, nbrs, at, field, common));
    }
    const thumbPts = thumbList.map(at);
    const thumbBase = mean(thumbPts.filter((p) => local(p).s < palmLen * 0.45)) ?? add(add(wrist, scale(a, palmLen * 0.3)), scale(l, half * 0.8));
    const thumb = { finger: 'Thumb', ...(thumbList.length >= 10 ? fingerChain(thumbList, thumbBase, nbrs, at) : { ...chainAlong([thumbBase], thumbBase), geo: null }), count: thumbPts.length };
    return { thumbList, thumbIdx, fingerIdx, fingerOf, groups, chains, thumb };
  };
  /**
   * Do the fingers bend toward the palm this labelling implies? Relaxed and fisted fingers bend toward the palm, so each finger's
   * tip, off the line of its first segment, points to the palm side. The palm side follows from the labelling by the hand's
   * chirality, as bodyModel.ts derives it (left: across x down; right: down x across; across = index base -> pinky base).
   * Returns the summed bend along the implied palm normal (metres): negative when the thumb side is the wrong way round.
   */
  const bendCheck = ({ chains }) => {
    const across = sub(chains[3].joints[0], chains[0].joints[0]);
    const down = norm(sub(chains[1].joints[1], chains[1].joints[0]));
    const palm = norm(side === 'Left' ? cross(across, down) : cross(down, across));
    let k = 0;
    for (const c of chains) {
      const d0 = norm(sub(c.joints[1], c.joints[0]));
      const t = sub(c.tip, c.joints[0]);
      k += dot(sub(t, scale(d0, dot(t, d0))), palm);
    }
    return k;
  };
  let lab = label();
  if (!fixed && !thumbPinned) {
    let bend = bendCheck(lab);
    if (bend < -BEND_SURE) {
      flip();
      const was = bend, wasLab = lab;
      lab = label();
      bend = bendCheck(lab);
      if (bend < was) {
        flip();
        lab = wasLab;
      } else log(`hand-rig ${side}: the fingers bend away from the guessed palm (${(was * 100).toFixed(1)} cm), thumb side flipped (${(bend * 100).toFixed(1)} cm)`);
    }
  }
  return { side, iHand, iMid, iFore, wrist, knuckle, elbow, a, hand, palmLen, stubLen, local, l, half, mid, lab };
}

/** Member codes in splitHands: side index * 8 + (0 palm, 1 thumb, 2 index, 3 middle, 4 ring, 5 pinky). */
const SIDE_STRIDE = 8;
/**
 * A palm triangle meeting a finger's triangle is a contact (a fingertip resting on the palm), not the knuckle, when the finger's
 * side lies past this share of the finger's own length from its base.
 */
const TIP_CONTACT = 0.4;
/** The same for the thumb, whose labelled vertices start at the wrist. */
const THUMB_TIP_CONTACT = 0.7;
/** Nor is the palm's own triangle reaching a finger past this many palm lengths from the wrist (a coarse triangle across a curl). */
const KNUCKLE_REACH = 1.1;

/**
 * Cuts the hands apart where the scan fused or pressed together what the finger bones must move apart (per-character-motion D7,
 * task 5.5), the way splitArms separates the arms from the torso. Call it on the skinned, welded body before rigHands, with the
 * same inputs, and hand rigHands the `plans` it returns.
 *   parts: [{ pos, nor, uv, indices, weldOf }] the body's meshes (plain arrays, mutated: copies and caps are appended), with each
 *   vertex's weld id (W's and wPos's row); every part's `weldOf` is replaced by a longer Int32Array. `skip(partIndex, triangle)`:
 *   triangles left out of the returned neighbour sets (scan-body's arm caps).
 * Each hand is labelled as rigHands labels it (palm, thumb, four finger strips) and each of its triangles takes the member most of
 * its corners have. Where triangles of two members share a vertex and the two must move apart (thumb and finger, two fingers, a
 * fingertip resting on the palm: TIP_CONTACT), that vertex is duplicated for every member but the first, unless the vertex also
 * joins one of those members to the palm at its root (the knuckles, the thumb's web): the cut stops there, so it never opens the
 * hand at the knuckle line. Each member's side of a cut is then traced into openings (a U ending at the knuckles, or a closed loop
 * round a contact patch) and closed with a zipper strip between the two halves of the opening, coloured with the texel of its rim
 * vertex nearest the middle and facing away from the member. The copies take their original's weights and position as new weld
 * rows, so the cut costs nothing until a finger bends.
 * `thumbToward` and `pinThumbs` as for rigHands.
 * Returns { W, wPos, nbrs, plans } (the widened rows, neighbour sets rebuilt over the cut mesh, and the plans for rigHands).
 */
export function splitHands({ parts, W, wPos, names, J, nbrs, thumbToward = {}, pinThumbs = [], sides = ['Left', 'Right'], skip, log = console.log }) {
  if (process.env.NO_HAND_RIG) return { W, wPos, nbrs, plans: null };
  const NB = names.length;
  const nW0 = wPos.length / 3;
  const at = (w) => [wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]];
  const member = new Int16Array(nW0).fill(-1);
  // Place along its own strip as a share of the strip's length, for finger vertices (fingertip vs knuckle).
  const along = new Map();
  const plans = {};
  sides.forEach((side, si) => {
    const plan = planHand({ side, W, wPos, names, J, nbrs, thumbToward, pinThumbs, log });
    plans[side] = plan;
    const { hand, lab } = plan;
    for (const w of hand) member[w] = si * SIDE_STRIDE;
    for (const w of lab.thumbIdx) member[w] = si * SIDE_STRIDE + 1;
    for (const w of lab.fingerIdx) member[w] = si * SIDE_STRIDE + 2 + lab.fingerOf(w);
    [...lab.groups, lab.thumbList].forEach((idxs, i) => {
      if (!idxs.length) return;
      const base = i < 4 ? lab.chains[i].base : lab.thumb.joints[0];
      const own = new Set(idxs);
      const src = [...idxs].sort((p, q) => len(sub(at(p), base)) - len(sub(at(q), base))).slice(0, Math.max(3, Math.round(idxs.length * 0.06)));
      const g = nbrs ? geodesic(src, own, nbrs, at) : new Map();
      for (const w of idxs) if (!g.has(w)) g.set(w, len(sub(at(w), base)));
      const far = Math.max(...g.values()) || 1e-3;
      for (const w of idxs) along.set(w, g.get(w) / far);
    });
  });
  const sideOf = (m) => Math.floor(m / SIDE_STRIDE);
  const kind = (m) => m % SIDE_STRIDE;
  // How far along finger member `m` vertex `g` lies: its own place, or (a palm vertex) its furthest neighbour's on that finger.
  const alongAt = (g, m) => {
    if (member[g] === m) return along.get(g) ?? 0;
    let best = 0;
    for (const o of nbrs[g]) if (member[o] === m) best = Math.max(best, along.get(o) ?? 0);
    return best;
  };
  /** Must members m1 and m2 move apart at weld g? */
  const contact = (g, m1, m2) => {
    if (m1 === m2 || sideOf(m1) !== sideOf(m2)) return false;
    const k1 = kind(m1), k2 = kind(m2);
    if (k1 >= 1 && k2 >= 1) return true;
    const f = k1 === 0 ? m2 : m1;
    // The thumb's root runs down the palm's edge to the wrist, so only its far end can rest on the palm.
    if (kind(f) > 1 && plans[sides[sideOf(f)]].local(at(g)).s > plans[sides[sideOf(f)]].palmLen * KNUCKLE_REACH) return true;
    return alongAt(g, f) > (kind(f) === 1 ? THUMB_TIP_CONTACT : TIP_CONTACT);
  };

  // Triangle members (-1 off the hands): the member most corners have; three different ones: the first finger of them.
  const triMember = parts.map((p) => {
    const out = new Int16Array(p.indices.length / 3).fill(-1);
    for (let t = 0; t < out.length; t++) {
      const ms = [0, 1, 2].map((k) => member[p.weldOf[p.indices[t * 3 + k]]]);
      const hm = ms.find((m) => m >= 0);
      if (hm === undefined) continue;
      const vs = ms.map((m) => (m < 0 ? sideOf(hm) * SIDE_STRIDE : m));
      out[t] = vs[0] === vs[1] || vs[0] === vs[2] ? vs[0] : vs[1] === vs[2] ? vs[1] : Math.min(...vs.filter((m) => kind(m) > 0));
    }
    return out;
  });
  const masks = new Map();
  parts.forEach((p, pi) => triMember[pi].forEach((m, t) => {
    if (m < 0) return;
    for (let k = 0; k < 3; k++) {
      const g = p.weldOf[p.indices[t * 3 + k]];
      (masks.get(g) ?? masks.set(g, new Set()).get(g)).add(m);
    }
  }));
  // Cut welds: two of their members must part. Members joined at their root there (a finger and the palm at the knuckle) stay
  // together; each such group gets one vertex, the group holding the vertex's own member keeps the original.
  const cut = new Map(); // weld -> Map(member -> its group's smallest member)
  for (const [g, ms] of masks) {
    if (ms.size < 2) continue;
    const list = [...ms].sort((x, y) => x - y);
    const root = new Map(list.map((m) => [m, m]));
    const find = (m) => { while (root.get(m) !== m) m = root.get(m); return m; };
    let apart = false;
    for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++) {
      if (contact(g, list[i], list[k])) apart = true;
      else { const x = find(list[i]), y = find(list[k]); root.set(Math.max(x, y), Math.min(x, y)); }
    }
    const groups = new Map(list.map((m) => [m, find(m)]));
    // The original stays with the group holding the vertex's own member (or the smallest when its triangles all went elsewhere).
    const keep = groups.get(member[g]) ?? Math.min(...groups.values());
    if (apart && new Set(groups.values()).size > 1) cut.set(g, { groups, keep });
  }
  // Edges between triangles, by weld (before the cut), for tracing the openings.
  const edgeKey = (x, y) => (x < y ? `${x}_${y}` : `${y}_${x}`);
  const edgeTris = new Map();
  parts.forEach((p, pi) => triMember[pi].forEach((m, t) => {
    if (m < 0) return;
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(p.weldOf[p.indices[t * 3 + k]], p.weldOf[p.indices[t * 3 + ((k + 1) % 3)]]);
      (edgeTris.get(key) ?? edgeTris.set(key, []).get(key)).push([pi, t]);
    }
  }));
  const origIndices = parts.map((p) => p.indices.slice());
  // Duplicate: every member but the keeper gets its own copy of a cut vertex (one new weld per cut weld and member).
  const rows = [];
  const newWeld = new Map();
  const weldFor = (g, m) => {
    const key = `${g}_${m}`;
    let w = newWeld.get(key);
    if (w === undefined) { w = nW0 + rows.length; rows.push([g, m]); newWeld.set(key, w); }
    return w;
  };
  const weldOf = parts.map((p) => Array.from(p.weldOf));
  let dup = 0;
  parts.forEach((p, pi) => {
    const copyOf = new Map();
    triMember[pi].forEach((m, t) => {
      if (m < 0) return;
      for (let k = 0; k < 3; k++) {
        const v = p.indices[t * 3 + k];
        const g = p.weldOf[v];
        if (!cut.has(g)) continue;
        const grp = cut.get(g).groups.get(m);
        if (grp === cut.get(g).keep) continue;
        const key = `${v}_${grp}`;
        let c = copyOf.get(key);
        if (c === undefined) {
          c = p.pos.length / 3;
          p.pos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]);
          p.nor.push(p.nor[v * 3], p.nor[v * 3 + 1], p.nor[v * 3 + 2]);
          p.uv.push(p.uv[v * 2], p.uv[v * 2 + 1]);
          weldOf[pi][c] = weldFor(g, grp);
          copyOf.set(key, c);
          dup++;
        }
        p.indices[t * 3 + k] = c;
      }
    });
  });
  // Openings, per member and the member across: edges of the member's triangles whose neighbour belongs to the other and has a
  // cut end; traced into paths (a -> b in the member's winding).
  const centroid = new Map();
  for (let g = 0; g < nW0; g++) {
    if (member[g] < 0) continue;
    const c = centroid.get(member[g]) ?? centroid.set(member[g], [0, 0, 0, 0]).get(member[g]);
    const p = at(g);
    c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; c[3]++;
  }
  const openings = new Map(); // `${m}|${m2}` -> { next: Map(g -> g'), rep: Map(g -> [part, vertex]) }
  parts.forEach((p, pi) => triMember[pi].forEach((m, t) => {
    if (m < 0) return;
    for (let k = 0; k < 3; k++) {
      const ga = p.weldOf[origIndices[pi][t * 3 + k]], gb = p.weldOf[origIndices[pi][t * 3 + ((k + 1) % 3)]];
      if (!cut.has(ga) && !cut.has(gb)) continue;
      const across = edgeTris.get(edgeKey(ga, gb));
      if (!across || across.length !== 2) continue;
      const [pj, u] = across[0][0] === pi && across[0][1] === t ? across[1] : across[0];
      const m2 = triMember[pj][u];
      if (m2 === m || !((cut.has(ga) && contact(ga, m, m2)) || (cut.has(gb) && contact(gb, m, m2)))) continue;
      const key = `${m}|${m2}`;
      const o = openings.get(key) ?? openings.set(key, { m, m2, next: new Map(), rep: new Map(), done: new Set() }).get(key);
      o.next.set(ga, gb);
      if (!o.rep.has(ga)) o.rep.set(ga, [pi, p.indices[t * 3 + k]]);
      if (!o.rep.has(gb)) o.rep.set(gb, [pi, p.indices[t * 3 + ((k + 1) % 3)]]);
    }
  }));
  // A member's own vertices per part (its triangles' corners after the cut), for the caps' texels.
  const surfaces = new Map();
  const surfaceOf = (pi, mm) => {
    const key = `${pi}_${mm}`;
    if (!surfaces.has(key)) {
      const set = new Set();
      triMember[pi].forEach((m, t) => { if (m === mm) for (let k = 0; k < 3; k++) set.add(parts[pi].indices[t * 3 + k]); });
      surfaces.set(key, [...set]);
    }
    return surfaces.get(key);
  };
  let caps = 0, capTris = 0, open = 0;
  const dist = (p, q) => len(sub(p, q));
  for (const { m, m2, next, rep, done } of openings.values()) {
    const hasIn = new Set(next.values());
    const seen = new Set();
    for (const start of [...next.keys()].filter((g) => !hasIn.has(g)).concat([...next.keys()])) {
      if (seen.has(start)) continue;
      const nodes = [];
      let g = start;
      while (g !== undefined && !seen.has(g)) { seen.add(g); nodes.push(g); g = next.get(g); }
      const closed = g === start;
      if (nodes.every((x) => done.has(x))) continue; // the other side's cap already closed it
      if (nodes.length < 3) { open++; continue; }
      const corner = nodes.map((x) => rep.get(x));
      const pts = corner.map(([pi, v]) => [parts[pi].pos[v * 3], parts[pi].pos[v * 3 + 1], parts[pi].pos[v * 3 + 2]]);
      const n = nodes.length;
      // The two halves that meet across the opening: an open U's from its two ends to its arc-length middle, a loop's between its
      // two points furthest apart (as splitArms).
      let A, B;
      if (closed) {
        let i0 = 0, i1 = 0, far = -1;
        for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const d = dist(pts[i], pts[k]); if (d > far) { far = d; i0 = i; i1 = k; } }
        A = []; for (let i = i0; ; i = (i + 1) % n) { A.push(i); if (i === i1) break; }
        B = []; for (let i = i0; ; i = (i - 1 + n) % n) { B.push(i); if (i === i1) break; }
      } else {
        const L = [0];
        for (let i = 1; i < n; i++) L.push(L[i - 1] + dist(pts[i - 1], pts[i]));
        let iMid = 0;
        L.forEach((x, i) => { if (Math.abs(x - L[n - 1] / 2) < Math.abs(L[iMid] - L[n - 1] / 2)) iMid = i; });
        A = []; for (let i = 0; i <= iMid; i++) A.push(i);
        B = []; for (let i = n - 1; i >= iMid; i--) B.push(i);
      }
      const rungs = [[0, 0]];
      let i = 0, j = 0;
      while (i < A.length - 1 || j < B.length - 1) {
        if (j >= B.length - 1) i++;
        else if (i >= A.length - 1) j++;
        else if (dist(pts[A[i + 1]], pts[B[j]]) <= dist(pts[A[i]], pts[B[j + 1]])) i++;
        else j++;
        rungs.push([i, j]);
      }
      // No interior points: the strip only spans a finger's thickness.
      const cap = membraneCap(pts, rungs.map(([x, y]) => [A[x], B[y]]), { h: Infinity, openFirst: !closed });
      // Both sides of a cut get the same strip (the other side's a mirror over its own rim vertices), so the two share every edge,
      // the closing one across the knuckles included, and the surface stays closed. Each goes in the part most of its rim is in,
      // coloured with that part's rim texel nearest the middle, and faces away from its own member.
      const cen = mean(pts);
      const emit = (corner, mm) => {
        const tally = new Map();
        for (const [q] of corner) tally.set(q, (tally.get(q) ?? 0) + 1);
        const pi = [...tally].sort((x, y) => y[1] - x[1])[0][0];
        const p = parts[pi];
        // The texel: the member's own surface 5 mm or more from the cut, nearest the cap's middle. The rim itself runs along the
        // crease between fingers, which the scan textures shade dark, so a rim texel made each cap a dark fin once the fingers parted.
        const at3 = (u) => [p.pos[u * 3], p.pos[u * 3 + 1], p.pos[u * 3 + 2]];
        const rimTexel = corner.filter(([q]) => q === pi).map(([, v]) => v).reduce((best, v) => (dist(at3(v), cen) < dist(at3(best), cen) ? v : best));
        let texel = rimTexel, bestD = Infinity;
        for (const v of surfaceOf(pi, mm)) {
          const q = at3(v);
          const d = dist(q, cen);
          if (d < bestD && d < 0.03 && Math.min(...pts.map((r) => dist(q, r))) >= 0.005) { bestD = d; texel = v; }
        }
        const c = centroid.get(mm);
        const out = norm(sub(cen, [c[0] / c[3], c[1] / c[3], c[2] / c[3]]));
        const vid = corner.map(([q, v], k) => {
          const u = p.pos.length / 3;
          p.pos.push(...pts[k]);
          p.nor.push(...out);
          p.uv.push(p.uv[texel * 2], p.uv[texel * 2 + 1]);
          weldOf[pi][u] = weldOf[q][v];
          return u;
        });
        // Wound one way round; flipped as a whole if it faces into the member (per-triangle tests fail on thin strips).
        let facing = 0;
        for (const [x, y, z] of cap.tris) facing += dot(cross(sub(pts[y], pts[x]), sub(pts[z], pts[x])), out);
        for (const [x, y, z] of cap.tris) {
          if (facing < 0) p.indices.push(vid[x], vid[z], vid[y]); else p.indices.push(vid[x], vid[y], vid[z]);
          capTris++;
        }
        caps++;
      };
      emit(corner, m);
      const twin = openings.get(`${m2}|${m}`);
      if (twin && nodes.every((x) => twin.rep.has(x))) {
        emit(nodes.map((x) => twin.rep.get(x)), m2);
        for (const x of nodes) twin.done.add(x);
      }
    }
  }
  // New weld rows: the copies' weights and positions are their originals'.
  const nW = nW0 + rows.length;
  const W2 = new Float32Array(nW * NB);
  W2.set(W.subarray(0, nW0 * NB));
  const wPos2 = new Float32Array(nW * 3);
  wPos2.set(wPos.subarray(0, nW0 * 3));
  rows.forEach(([g, m], k) => {
    W2.set(W.subarray(g * NB, (g + 1) * NB), (nW0 + k) * NB);
    wPos2.set(wPos.subarray(g * 3, g * 3 + 3), (nW0 + k) * 3);
  });
  parts.forEach((p, pi) => { p.weldOf = Int32Array.from(weldOf[pi]); });
  const nbrs2 = Array.from({ length: nW }, () => new Set());
  parts.forEach((p, pi) => {
    for (let t = 0; t < p.indices.length; t += 3) {
      if (skip?.(pi, t / 3)) continue;
      const x = p.weldOf[p.indices[t]], y = p.weldOf[p.indices[t + 1]], z = p.weldOf[p.indices[t + 2]];
      nbrs2[x].add(y).add(z); nbrs2[y].add(x).add(z); nbrs2[z].add(x).add(y);
    }
  });
  // What rigHands reuses: each side's frame, every hand vertex's member (copies: the member they were made for), and the palm's
  // side of each contact (kept on the palm: rigHands would otherwise ease palm vertices near the knuckles onto the nearest strip).
  const fixed = {};
  sides.forEach((side, si) => {
    const members = new Map();
    const pinned = new Set();
    // A vertex whose triangles all went to other members (the majority vote) moves with them.
    for (let g = 0; g < nW0; g++) {
      if (member[g] < 0 || sideOf(member[g]) !== si) continue;
      const ms = masks.get(g);
      members.set(g, kind(!ms || ms.has(member[g]) ? member[g] : Math.min(...ms)));
    }
    rows.forEach(([g, m], k) => { if (sideOf(m) === si) members.set(nW0 + k, kind(m)); });
    // A cut vertex's original stays with the group holding its smallest member, and takes that member's label.
    for (const [g, { groups, keep }] of cut) {
      if (sideOf(keep) !== si) continue;
      const own = groups.get(member[g]) === keep ? member[g] : keep;
      members.set(g, kind(own));
      if (kind(own) === 0) pinned.add(g);
    }
    rows.forEach(([, m], k) => { if (sideOf(m) === si && kind(m) === 0) pinned.add(nW0 + k); });
    fixed[side] = { palmLen: plans[side].palmLen, l: plans[side].l, members, pinned };
  });
  log(`hand split: ${cut.size} welded vertices cut, ${dup} vertices duplicated, ${caps} openings capped with ${capTris} triangles${open ? `, ${open} short edge runs left open` : ''}`);
  return { W: W2, wPos: wPos2, nbrs: nbrs2, plans: fixed };
}

/**
 * Add finger chains and forearm twist bones to a skinned scan body.
 *   W: Float32Array of nW x names.length weights (rows sum to 1), wPos: Float32Array of nW x 3 positions (metres, Y up),
 *   names: bone names (W's columns), J: joint positions by name (must hold <Side>ForeArm, <Side>Hand, <Side>HandMiddle1),
 *   parentOf: name -> parent name. `thumbToward`: per side, a rough world direction the thumb points in the scan (default +Z).
 *   `pinThumbs`: sides whose thumbs point that way for certain: the fingers' bend may not flip them (planHand).
 *   nbrs: per welded vertex, the Set of its neighbours over the mesh's edges; the hand's new weights are smoothed over them.
 *   plans: splitHands' result, when the hands were cut first (its frames and labels are kept).
 * Returns { W, names, J, parentOf } with the new bones appended (W widened), and logs what it found per hand.
 */
export function rigHands({ W, wPos, names, J, parentOf, nbrs, smoothing = HAND_SMOOTHING, sides = ['Left', 'Right'], thumbToward = {}, pinThumbs = [], plans = null, log = console.log }) {
  // NO_HAND_RIG=1 rebuilds a body without the hand rig (to compare against).
  if (process.env.NO_HAND_RIG) return { W, names, J, parentOf, added: [] };
  const nW = wPos.length / 3;
  const NB = names.length;
  const added = [];
  const at = (w) => [wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]];
  const col = new Map(names.map((n, i) => [n, i]));
  // New columns, filled per vertex below: name -> Float32Array(nW).
  const extra = new Map();
  const newCol = (name, parent, pos) => {
    if (col.has(name) || extra.has(name)) throw new Error(`hand-rig: bone ${name} already exists`);
    extra.set(name, new Float32Array(nW));
    added.push({ name, parent, pos });
    return extra.get(name);
  };
  // Existing-bone weight changes are written straight into W.
  for (const side of sides) {
    const plan = planHand({ side, W, wPos, names, J, nbrs, thumbToward, pinThumbs, log, fixed: plans?.[side] });
    const { iHand, iMid, iFore, wrist, elbow, hand, palmLen, stubLen, local, half, lab } = plan;
    const pinned = plans?.[side]?.pinned;
    const { thumbIdx, fingerIdx, fingerOf, chains, thumb } = lab;

    // Bones. Middle1 already exists (the stub): it moves to the middle finger's base.
    const boneCols = {};
    for (const c of [thumb, ...chains]) {
      boneCols[c.finger] = c.joints.map((p, k) => {
        const name = `${side}Hand${c.finger}${k + 1}`;
        const parent = k === 0 ? `${side}Hand` : `${side}Hand${c.finger}${k}`;
        if (name === `${side}HandMiddle1`) {
          J[name] = p.map((x) => +x.toFixed(4));
          return { name, existing: iMid };
        }
        newCol(name, parent, p.map((x) => +x.toFixed(4)));
        return { name, existing: null };
      });
    }
    const colOf = (b) => (b.existing !== null ? null : extra.get(b.name));

    // Weights. Each hand vertex first gets a membership: the palm, the thumb or one finger (its strip), with a short blend from the
    // palm onto each finger at the knuckle line. Memberships are smoothed over the mesh within the hand (neighbours on different
    // strips, the webbing and the thumb's edge must not tear apart). Then each finger's share is split over its three phalanges by
    // the vertex's own place along that finger's bent chain, so neighbours at the same place along their fingers move alike.
    const MEMBERS = ['Thumb', ...FINGERS]; // membership k + 1; 0 is the palm
    const fingerSet = new Map();
    for (const w of thumbIdx) fingerSet.set(w, -1);
    fingerIdx.forEach((w) => fingerSet.set(w, fingerOf(w)));
    // Vertices near the knuckles but not yet past them still join the nearest strip, so the blend into the palm is smooth.
    for (const w of hand) if (!fingerSet.has(w) && !pinned?.has(w) && local(at(w)).s > palmLen * 0.8) fingerSet.set(w, fingerOf(w));
    const chainOf = (k) => (k === 0 ? thumb : chains[k - 1]);
    const member = new Map();
    for (const w of hand) {
      const row = new Float32Array(MEMBERS.length + 1);
      const f = fingerSet.get(w);
      if (f === undefined) row[0] = 1;
      else {
        const k = f === -1 ? 1 : f + 2;
        const band = Math.max(0.004, chainOf(k - 1).reach * 0.08);
        const on = f === -1 ? 1 : smooth(-band, band, local(at(w)).s - local(chainOf(k - 1).joints[0]).s);
        row[k] = on;
        row[0] = 1 - on;
      }
      member.set(w, row);
    }
    if (nbrs && smoothing > 0) {
      for (let it = 0; it < smoothing; it++) {
        const next = new Map();
        for (const w of hand) {
          // Neighbours count by inverse edge length (a decimated hand has edges from the wrist to the thumb tip); those off the hand
          // (the wrist) count as palm.
          const ns = [...nbrs[w]];
          if (!ns.length) continue;
          const wt = ns.map((o) => 1 / Math.max(0.002, len(sub(at(o), at(w)))));
          const sum = wt.reduce((x, y) => x + y, 0);
          const own = member.get(w);
          const row = own.map((v, k) => 0.5 * v + (0.5 * ns.reduce((acc, o, i) => acc + wt[i] * (member.get(o)?.[k] ?? (k === 0 ? 1 : 0)), 0)) / sum);
          next.set(w, row);
        }
        for (const [w, row] of next) member.set(w, row);
      }
    }
    /** Place along a chain (0 at its base), measured along the bent polyline base -> joint 2 -> joint 3 -> tip. */
    const along = (chain, p) => {
      const pts = [...chain.joints, chain.tip];
      let best = Infinity, at0 = 0, run = 0;
      for (let i = 0; i < 3; i++) {
        const seg = sub(pts[i + 1], pts[i]);
        const L = len(seg) || 1e-6;
        const t = Math.max(0, Math.min(1, dot(sub(p, pts[i]), seg) / (L * L)));
        const d = len(sub(p, add(pts[i], scale(seg, t))));
        if (d < best) { best = d; at0 = run + t * L; }
        run += L;
      }
      return { u: at0, j2: len(sub(pts[1], pts[0])), j3: len(sub(pts[1], pts[0])) + len(sub(pts[2], pts[1])), reach: run };
    };
    /**
     * A vertex's place along a chain: its distance over the finger's surface (or, for a vertex at the finger's edge that is not
     * one of its own, its nearest own neighbour's plus the step; further off, the base), with the joints' places from the same
     * measure.
     */
    const placeOn = (chain, w) => {
      if (!chain.geo) return along(chain, at(w));
      const g = chain.geo;
      const far = chain.reach;
      let u = g.get(w);
      if (u === undefined) {
        let best = Infinity;
        // The step is capped: a decimated hand's long edges (wrist to thumb) would otherwise put the vertex past the fingertip.
        for (const o of nbrs[w]) if (g.has(o)) best = Math.min(best, g.get(o) + Math.min(0.005, len(sub(at(o), at(w)))));
        // Off the finger and not beside it: a palm vertex that the smoothing gave a little of this finger; it sits at the base.
        u = Number.isFinite(best) ? best : 0;
      }
      return { u, j2: 0.45 * far, j3: 0.75 * far, reach: far };
    };
    let moved = 0;
    for (const w of hand) {
      const hw = W[w * NB + iHand] + W[w * NB + iMid];
      const row = member.get(w);
      const total = row.reduce((x, y) => x + y, 0) || 1;
      W[w * NB + iHand] = (hw * row[0]) / total;
      W[w * NB + iMid] = 0;
      if (row[0] < total - 1e-6) moved++;
      for (let k = 1; k <= MEMBERS.length; k++) {
        if (row[k] < 1e-5) continue;
        const chain = chainOf(k - 1);
        const bones = boneCols[chain.finger];
        const { u, j2, j3, reach } = placeOn(chain, w);
        const band = Math.max(0.004, reach * 0.08);
        const w2 = smooth(j2 - band, j2 + band, u), w3 = smooth(j3 - band, j3 + band, u);
        const share = [1 - w2, w2 - w3, w3];
        bones.forEach((b, i) => {
          const v = (hw * row[k] * share[i]) / total;
          if (b.existing !== null) W[w * NB + b.existing] += v;
          else colOf(b)[w] += v;
        });
      }
    }

    // Forearm twist: halfway down the forearm; it carries the wrist half of the forearm's weight.
    const tw = newCol(`${side}ForeArmTwist1`, `${side}ForeArm`, add(elbow, scale(sub(wrist, elbow), 0.5)).map((x) => +x.toFixed(4)));
    const fa = sub(wrist, elbow), faLen2 = dot(fa, fa) || 1;
    let twisted = 0;
    for (let w = 0; w < nW; w++) {
      const f = W[w * NB + iFore];
      if (f < 1e-4) continue;
      const t = dot(sub(at(w), elbow), fa) / faLen2;
      const k = smooth(0.25, 0.9, t);
      tw[w] = f * k;
      W[w * NB + iFore] = f * (1 - k);
      if (k > 0.5) twisted++;
    }
    log(`hand-rig ${side}: ${hand.length} hand vertices, palm ${(palmLen * 100).toFixed(1)} cm (stub ${(stubLen * 100).toFixed(1)}) x ${(half * 200).toFixed(1)} cm; thumb ${thumb.count} vertices (reach ${(thumb.reach * 100).toFixed(1)} cm); fingers ${chains.map((c) => `${c.finger.toLowerCase()} ${c.count} (${(c.reach * 100).toFixed(1)} cm)`).join(', ')}; ${moved} re-weighted; twist carries ${twisted}`);
  }

  // Widen W with the new columns.
  const names2 = [...names, ...added.map((b) => b.name)];
  const NB2 = names2.length;
  const W2 = new Float32Array(nW * NB2);
  const cols = added.map((b) => extra.get(b.name));
  for (let w = 0; w < nW; w++) {
    for (let b = 0; b < NB; b++) W2[w * NB2 + b] = W[w * NB + b];
    cols.forEach((c, k) => { W2[w * NB2 + NB + k] = c[w]; });
  }
  const J2 = { ...J };
  const parentOf2 = { ...parentOf };
  for (const b of added) {
    J2[b.name] = b.pos;
    parentOf2[b.name] = b.parent;
  }
  return { W: W2, names: names2, J: J2, parentOf: parentOf2, added: added.map((b) => b.name) };
}
