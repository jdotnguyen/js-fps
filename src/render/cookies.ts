import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

/**
 * Projected light patterns ("cookies", shadow-rich-rooms D7). Room lights opt in with `cookie` in the level data;
 * `lens` is the flashlight's own. Generated at load into small grey textures, so there are no asset files or credits.
 * A spot light multiplies its colour by the pattern across its cone.
 */
export const COOKIE_KINDS = ['grille', 'fan', 'cracked'] as const;
export type CookieKind = (typeof COOKIE_KINDS)[number];
export type CookiePattern = CookieKind | 'lens' | 'white';

export const COOKIE_SIZE = 256;

const cache = new Map<CookiePattern, THREE.DataTexture>();

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Brightness 0..1 at (u, v) in -1..1 across the cone for each pattern. */
function sampler(kind: CookiePattern): (u: number, v: number) => number {
  switch (kind) {
    case 'white':
      return () => 1;
    case 'grille': {
      // Horizontal slats with soft edges, a dark frame at the rim.
      return (u, v) => {
        const slat = Math.abs(((v * 4.5 + 100) % 1) - 0.5) * 2; // 0 at a slat centre, 1 between
        const open = smooth(0.35, 0.55, slat);
        const frame = 1 - smooth(0.86, 0.95, Math.hypot(u, v));
        return (0.12 + 0.88 * open) * (0.15 + 0.85 * frame);
      };
    }
    case 'fan': {
      // Five blades and a hub, seen from the light side; the blades turn as the spot's shadow camera spins.
      return (u, v) => {
        const r = Math.hypot(u, v);
        const a = Math.atan2(v, u);
        const blades = 5;
        const phase = ((a / (Math.PI * 2)) * blades + 100) % 1; // 0..1 across one blade period
        const blade = 1 - smooth(0.36, 0.46, Math.abs(phase - 0.3) * 2 + r * 0.25);
        const hub = 1 - smooth(0.1, 0.14, r);
        const ring = smooth(0.84, 0.88, r) * (1 - smooth(0.92, 0.96, r));
        const shade = Math.max(blade * smooth(0.12, 0.2, r) * (1 - smooth(0.82, 0.86, r)), hub, ring);
        return 1 - 0.88 * shade;
      };
    }
    case 'cracked': {
      // A lens falloff with dark crack lines from an impact point off centre.
      const rng = new Rng('cookie-cracked');
      const segs: Array<[number, number, number, number]> = [];
      const cx = 0.18;
      const cy = -0.12;
      for (let k = 0; k < 9; k++) {
        let x = cx;
        let y = cy;
        let ang = (k / 9) * Math.PI * 2 + rng.range(-0.25, 0.25);
        for (let s = 0; s < 6; s++) {
          ang += rng.range(-0.45, 0.45);
          const len = rng.range(0.08, 0.2);
          const nx = x + Math.cos(ang) * len;
          const ny = y + Math.sin(ang) * len;
          segs.push([x, y, nx, ny]);
          x = nx;
          y = ny;
        }
      }
      const distSeg = (px: number, py: number, s: [number, number, number, number]): number => {
        const [ax, ay, bx, by] = s;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - ax - t * dx, py - ay - t * dy);
      };
      return (u, v) => {
        let d = Infinity;
        for (const s of segs) d = Math.min(d, distSeg(u, v, s));
        const crack = 1 - smooth(0.004, 0.018, d);
        const fall = 1 - 0.35 * smooth(0.2, 1, Math.hypot(u, v));
        return fall * (1 - 0.75 * crack);
      };
    }
    case 'lens': {
      // The flashlight: a brighter hot spot, a faint ring near the edge, slight smudges (player-flashlight spec).
      const rng = new Rng('cookie-lens');
      const blobs = Array.from({ length: 7 }, () => ({ x: rng.range(-0.6, 0.6), y: rng.range(-0.6, 0.6), r: rng.range(0.12, 0.3), k: rng.range(-0.05, 0.05) }));
      return (u, v) => {
        const r = Math.hypot(u, v);
        const hot = 0.78 + 0.22 * (1 - smooth(0, 0.45, r));
        const ring = 0.08 * Math.exp(-(((r - 0.78) / 0.05) ** 2));
        let smudge = 0;
        for (const b of blobs) smudge += b.k * Math.exp(-((u - b.x) ** 2 + (v - b.y) ** 2) / (b.r * b.r));
        return Math.min(1, Math.max(0, hot + ring + smudge));
      };
    }
  }
}

/** Raw luminance of a pattern, row by row (tests). */
export function cookieLuminance(kind: CookiePattern, size = COOKIE_SIZE): Uint8Array {
  const f = sampler(kind);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      out[y * size + x] = Math.round(Math.min(1, Math.max(0, f(u, v))) * 255);
    }
  }
  return out;
}

/** The shared texture for a pattern, built on first use. `white` is a 1×1 plain map for unpatterned spots. */
export function cookieTexture(kind: CookiePattern): THREE.DataTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const size = kind === 'white' ? 1 : COOKIE_SIZE;
  const lum = cookieLuminance(kind, size);
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < lum.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = lum[i]!;
    rgba[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = `cookie:${kind}`;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = size > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = size > 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cache.set(kind, tex);
  return tex;
}

/** Release every generated pattern (session teardown). */
export function disposeCookies(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
