/**
 * Layout of the L-shaped corner sandbox (world/cornerTest.ts), kept free of DOM and
 * renderer imports so tests can use it. All values in metres, world space.
 */

export const CORNER_H = 3.2;
const T = 0.25;
const SLAB = 0.1;

export interface CornerBox {
  name: string;
  kind: 'wall' | 'floor' | 'ceiling';
  /** Full size (m). */
  size: [number, number, number];
  center: [number, number, number];
  /** Inward-facing normal of the surface the player sees. */
  face: [number, number, number];
  /** Visible face size (m): along the wall x height, or x by z for floors and ceilings. */
  faceSize: [number, number];
}

/** Wall run along one inner face, cut into `cuts` lengths. `axis` is the run direction. */
function run(name: string, axis: 'x' | 'z', from: number, cuts: number[], line: number, face: [number, number, number]): CornerBox[] {
  const out: CornerBox[] = [];
  let a = from;
  const behind = axis === 'x' ? -face[2] : -face[0];
  cuts.forEach((len, i) => {
    const mid = a + len / 2;
    const off = line + (behind * T) / 2;
    out.push({
      name: `${name}.${i}`,
      kind: 'wall',
      size: axis === 'x' ? [len, CORNER_H, T] : [T, CORNER_H, len],
      center: axis === 'x' ? [mid, CORNER_H / 2, off] : [off, CORNER_H / 2, mid],
      face,
      faceSize: [len, CORNER_H],
    });
    a += len;
  });
  return out;
}

function slab(name: string, kind: 'floor' | 'ceiling', x0: number, z0: number, x1: number, z1: number): CornerBox {
  const y = kind === 'floor' ? -SLAB / 2 : CORNER_H + SLAB / 2;
  return {
    name,
    kind,
    size: [x1 - x0, SLAB, z1 - z0],
    center: [(x0 + x1) / 2, y, (z0 + z1) / 2],
    face: kind === 'floor' ? [0, 1, 0] : [0, -1, 0],
    faceSize: [x1 - x0, z1 - z0],
  };
}

/** Every box of the L-room, in world space. Pure data so tests and the sandbox share it. */
export function cornerBoxes(): CornerBox[] {
  return [
    ...run('south', 'x', 0, [2.7, 3.1, 2.2], 0, [0, 0, 1]),
    ...run('eastA', 'z', 0, [1.5, 2.5], 8, [-1, 0, 0]),
    ...run('northA', 'x', 4, [1.9, 2.1], 4, [0, 0, -1]),
    ...run('eastB', 'z', 4, [3.3, 2.7], 4, [-1, 0, 0]),
    ...run('northB', 'x', 0, [4], 10, [0, 0, -1]),
    ...run('west', 'z', 0, [2.6, 4.1, 3.3], 0, [1, 0, 0]),
    slab('floorA', 'floor', 0, 0, 8, 4),
    slab('floorB', 'floor', 0, 4, 4, 10),
    slab('ceilA', 'ceiling', 0, 0, 8, 4),
    slab('ceilB', 'ceiling', 0, 4, 4, 10),
  ];
}
