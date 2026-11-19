/**
 * The boot splash's zombie act, as pure data and maths (rendering is in splashAct.ts).
 *
 * After the logo has been shown for a few seconds it comes alive: it shambles toward the viewer,
 * gets shot with the shotgun, loses pieces with every blast (the last "0" and the "K", then the icon and the "8"),
 * staggers back each time and carries on, bleeding, until the final blast tears off what is left
 * and the letters rain down.
 * Times are seconds from the start of the act.
 */

/** Logo size in its own units (the SVG's viewBox). */
export const LOGO_W = 611;
export const LOGO_H = 168;

/** A part of the logo that can be blown off: a rectangle of the logo, in logo units. */
export interface Piece {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Letter columns measured from j00k80-logo.svg (J, 0, 0, K, 8, 0) with a little slack either side. */
const ROW = { y: 0, h: 124 };
export const PIECES: readonly Piece[] = [
  { id: 'mark', x: 0, y: 0, w: 176, h: LOGO_H },
  { id: 'J', x: 212, ...ROW, w: 66 },
  { id: '0a', x: 278, ...ROW, w: 66 },
  { id: '0b', x: 344, ...ROW, w: 68 },
  { id: 'K', x: 412, ...ROW, w: 68 },
  { id: '8', x: 480, ...ROW, w: 62 },
  { id: '0c', x: 542, ...ROW, w: 69 },
  { id: 'tag', x: 212, y: 124, w: 399, h: LOGO_H - 124 },
];

export interface Shot {
  /** When the blast goes off. */
  at: number;
  /** Pieces torn off by this blast. */
  removes: readonly string[];
  /** How hard it knocks the logo back, 0..1. */
  force: number;
  /** The last blast: what is left of the logo drops. */
  final: boolean;
}

/** Shamble in, then three blasts a pump-action apart: the logo dies on the third. */
export const SHOTS: readonly Shot[] = [
  { at: 3.4, removes: ['0c', 'K'], force: 0.8, final: false },
  { at: 5.0, removes: ['mark', '8'], force: 1, final: false },
  { at: 6.5, removes: ['J', '0a', '0b', 'tag'], force: 1.3, final: true },
];

/** The shotgun is pumped this long after each blast that is not the last (the pump sample is 0.56 s). */
export const PUMP_DELAY = 0.7;
/** The infected's voice starts with the shamble. */
export const VOICE_AT = 0;
/** After the last blast the letters fall and the blood settles; then the splash fades. */
export const COLLAPSE = 1.5;
export const ACT_LENGTH = SHOTS[SHOTS.length - 1]!.at + COLLAPSE + 0.8;

export interface Pose {
  /** Offset from the logo's resting spot, as fractions of its own width / height. */
  x: number;
  y: number;
  /** Radians, about the feet. */
  rot: number;
  skew: number;
  scale: number;
  /** 0..1 red-white hit flash. */
  flash: number;
}

/** A damped spring kicked by a hit: 1 at the blast, swinging back through 0 and settling. */
export function kick(since: number, hz = 2.2, damping = 3.2): number {
  if (since < 0) return 0;
  return Math.exp(-damping * since) * Math.cos(2 * Math.PI * hz * since);
}

/** How far through the lurch (0..1) the logo has got by `t`; it never gets all the way before the last blast. */
export function approach(t: number): number {
  const end = SHOTS[SHOTS.length - 1]!.at;
  return Math.min(1, Math.max(0, t / end));
}

/** The logo's pose at time `t`: the shamble and its hit reactions (nothing is left to pose after the last blast). */
export function poseAt(t: number, shots: readonly Shot[] = SHOTS): Pose {
  const walking = t >= 0;
  const final = shots[shots.length - 1]!;
  const dead = t >= final.at;
  // One step every 1.1 s, dragging the second foot: a slow, uneven lurch.
  const phase = (walking ? t : 0) / 1.1;
  const step = phase % 1;
  const lurch = Math.pow(Math.sin(Math.PI * step), 2);
  const side = Math.sin(2 * Math.PI * (phase / 2)); // which foot is down
  const live = dead ? 0 : 1;

  let x = side * 0.012 * live;
  let y = -lurch * 0.045 * live;
  let rot = (side * 0.05 + 0.035) * live;
  let skew = side * 0.06 * live;
  // Closing in: the logo grows as it nears.
  let scale = 1 + approach(t) * 0.55;
  let flash = 0;

  for (const s of shots) {
    const since = t - s.at;
    if (since < 0) continue;
    const k = kick(since) * s.force;
    // Blown back and up, head snapping over, then it keeps coming.
    rot -= k * 0.22;
    y -= Math.abs(k) * 0.06 * (k > 0 ? 1 : 0.4);
    x += k * 0.05 * (s.at % 2 > 1 ? 1 : -1);
    scale -= Math.max(0, k) * 0.12;
    skew += k * 0.18;
    flash = Math.max(flash, Math.max(0, 1 - since / 0.16));
  }

  return { x, y, rot, skew, scale, flash };
}

/** Which pieces are still attached at time `t`. */
export function attachedAt(t: number, shots: readonly Shot[] = SHOTS): Set<string> {
  const gone = new Set<string>();
  for (const s of shots) if (t >= s.at) for (const id of s.removes) gone.add(id);
  return new Set(PIECES.map((p) => p.id).filter((id) => !gone.has(id)));
}

/** Times at which the shotgun is pumped (every blast but the last). */
export function pumpTimes(shots: readonly Shot[] = SHOTS): number[] {
  return shots.filter((s) => !s.final).map((s) => s.at + PUMP_DELAY);
}
