/**
 * Draws the boot splash's zombie act (timeline in splashSequence.ts) on a canvas over the splash.
 *
 * The logo is redrawn piece by piece so blasts can tear letters off. Each blast also leaves wounds on
 * what is still attached (stains and drips that run down the letters), sprays blood, flashes, shakes
 * the screen and splatters the "lens". Torn-off pieces fly, tumble and bounce on the floor.
 */
import {
  ACT_LENGTH,
  attachedAt,
  LOGO_H,
  LOGO_W,
  PIECES,
  poseAt,
  pumpTimes,
  SHOTS,
  VOICE_AT,
  type Piece,
  type Pose,
  type Shot,
} from './splashSequence.ts';

/** The sounds the act asks for; the caller plays them (and may play nothing if audio is locked). */
export interface ActSounds {
  voice(): void;
  shot(): void;
  pump(): void;
}

export interface Act {
  /** Resolves when the act has played out, or after `stop()`. */
  finished: Promise<void>;
  stop(): void;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
}

interface Wound {
  host: string;
  x: number;
  y: number;
  r: number;
  t0: number;
  drips: Array<{ dx: number; max: number; speed: number }>;
  dots: Array<{ x: number; y: number; r: number }>;
}

interface Flying {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  bleedUntil: number;
}

interface LensSplat {
  x: number;
  y: number;
  t0: number;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const BLOOD = ['#3a0509', '#47060b', '#55070d', '#650910', '#760b13'];
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const pieceCenter = (p: Piece): { x: number; y: number } => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });


/**
 * A realistic splatter: an irregular core, tapered spikes thrown outward, a drop at the end of most
 * spikes (stretched along the spike) and a scatter of tiny satellites. `R` is the core radius.
 */
function drawSplat(g: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  g.fillStyle = pick(BLOOD);
  const n = 26;
  let rs = Array.from({ length: n }, () => R * rnd(0.5, 1));
  for (let pass = 0; pass < 2; pass++) rs = rs.map((r, i) => (rs[(i + n - 1) % n]! + 2 * r + rs[(i + 1) % n]!) / 4);
  const pt = (i: number): [number, number] => {
    const a = (Math.PI * 2 * (i % n)) / n;
    return [cx + Math.cos(a) * rs[i % n]!, cy + Math.sin(a) * rs[i % n]!];
  };
  g.beginPath();
  const [sx, sy] = [(pt(n - 1)[0] + pt(0)[0]) / 2, (pt(n - 1)[1] + pt(0)[1]) / 2];
  g.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [px, py] = pt(i);
    const [qx, qy] = pt(i + 1);
    g.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
  }
  g.fill();
  const spikes = 8 + Math.floor(Math.random() * 8);
  for (let i = 0; i < spikes; i++) {
    const a = Math.random() * Math.PI * 2;
    const len = R * (Math.random() < 0.25 ? rnd(1.5, 2.3) : rnd(0.85, 1.5));
    const w = R * rnd(0.08, 0.22);
    const [dx, dy] = [Math.cos(a), Math.sin(a)];
    const [bx, by] = [cx + dx * R * 0.5, cy + dy * R * 0.5];
    g.beginPath();
    g.moveTo(bx - dy * w, by + dx * w);
    g.quadraticCurveTo(cx + dx * len * 0.55 - dy * w * 0.35, cy + dy * len * 0.55 + dx * w * 0.35, cx + dx * len, cy + dy * len);
    g.quadraticCurveTo(cx + dx * len * 0.55 + dy * w * 0.35, cy + dy * len * 0.55 - dx * w * 0.35, bx + dy * w, by - dx * w);
    g.closePath();
    g.fill();
    if (Math.random() < 0.7) {
      const d = len * rnd(1.08, 1.5);
      const r = w * rnd(0.5, 1.1);
      g.beginPath();
      g.ellipse(cx + dx * d, cy + dy * d, r * 1.8, r, a, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = R * rnd(1.2, 3.6);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rnd(0.015, 0.055), 0, Math.PI * 2);
    g.fill();
  }
}

/** A splatter on its own canvas (core radius `R` css px), ready to stamp. `squash` flattens it for the floor. */
function splatCanvas(R: number, dpr: number, squash = 1): { canvas: HTMLCanvasElement; w: number; h: number } {
  const w = Math.ceil(R * 7);
  const h = Math.ceil(R * 7 * squash);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr * squash);
  drawSplat(g, w / 2, (h / squash) / 2, R);
  return { canvas, w, h };
}

interface WallSplat {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  x: number;
  y: number;
  t0: number;
  R: number;
  drips: Array<{ dx: number; max: number; speed: number; width: number }>;
}

export function playAct(root: HTMLElement, logo: HTMLImageElement, sounds: ActSounds, shots: readonly Shot[] = SHOTS): Act {
  const W = root.clientWidth;
  const H = root.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = logo.getBoundingClientRect();
  const u = rect.width / LOGO_W; // css px per logo unit (before the pose's scale)
  const pivot = { x: rect.left + rect.width / 2, y: rect.top + rect.height };
  const floorY = Math.min(H - 8, rect.bottom + rect.height * 0.75);
  const S = Math.max(W, H) / 1000;
  const gravity = H * 2.4;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return { finished: Promise.resolve(), stop: () => undefined };
  }

  // The logo's own layer, in logo space: pieces, then wounds on top, clipped to the letters.
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(rect.width * dpr));
  layer.height = Math.max(1, Math.round(rect.height * dpr));
  const lctx = layer.getContext('2d')!;
  const k = layer.width / LOGO_W; // layer px per logo unit
  const nat = { w: logo.naturalWidth || LOGO_W, h: logo.naturalHeight || LOGO_H };

  /** A piece of the logo on its own canvas, with a raw red edge where it was torn off. */
  const cutPiece = (p: Piece, scale: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    const pxPerUnit = u * scale * dpr;
    c.width = Math.max(1, Math.round(p.w * pxPerUnit));
    c.height = Math.max(1, Math.round(p.h * pxPerUnit));
    const g = c.getContext('2d')!;
    g.drawImage(logo, (p.x * nat.w) / LOGO_W, (p.y * nat.h) / LOGO_H, (p.w * nat.w) / LOGO_W, (p.h * nat.h) / LOGO_H, 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 5; i++) {
      const gx = Math.random() * c.width;
      const gy = Math.random() * c.height;
      const r = Math.max(c.width, c.height) * rnd(0.15, 0.4);
      const grad = g.createRadialGradient(gx, gy, 0, gx, gy, r);
      grad.addColorStop(0, 'rgba(60,4,7,0.95)');
      grad.addColorStop(1, 'rgba(60,4,7,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  };

  const drops: Drop[] = [];
  const wounds: Wound[] = [];
  const flying: Flying[] = [];
  const lens: LensSplat[] = [];
  const walls: WallSplat[] = [];
  const S2 = Math.max(0.8, S);
  const poolArt = splatCanvas(110, dpr, 0.22);
  const decals = document.createElement('canvas');
  decals.width = canvas.width;
  decals.height = canvas.height;
  const dctx = decals.getContext('2d')!;
  dctx.scale(dpr, dpr);
  let pool = 0;
  let poolTarget = 0;

  const splatOnFloor = (x: number, r: number): void => {
    const sp = splatCanvas(Math.max(1.5, r * rnd(0.9, 1.6)), dpr, rnd(0.3, 0.5));
    dctx.globalAlpha = rnd(0.7, 1);
    dctx.drawImage(sp.canvas, x - sp.w / 2, floorY - sp.h / 2 + rnd(-3, 5), sp.w, sp.h);
    dctx.globalAlpha = 1;
  };

  /** Blood thrown against the backdrop: a splatter with a few drips that start running down. */
  const wallSplat = (x: number, y: number, R: number, t: number): void => {
    const sp = splatCanvas(R, dpr);
    walls.push({
      canvas: sp.canvas,
      w: sp.w,
      h: sp.h,
      x,
      y,
      t0: t,
      R,
      drips: Array.from({ length: 2 + Math.floor(R / 22) }, () => ({ dx: rnd(-0.6, 0.6) * R, max: rnd(0.8, 3.2) * R, speed: rnd(20, 60) * S2, width: rnd(1.5, 3.4) * Math.max(0.8, R / 40) })),
    });
  };

  const spray = (x: number, y: number, n: number, speed: number, up = 0.5): void => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * S * rnd(0.2, 1);
      drops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up * speed * S * 0.5, r: rnd(1.2, 4.2) * Math.max(0.7, S), age: 0, life: rnd(0.6, 1.8) });
    }
  };

  /** Where a point of the logo is on screen under `pose`. */
  const toScreen = (pose: Pose, lx: number, ly: number): { x: number; y: number } => {
    let px = (lx - LOGO_W / 2) * u * pose.scale;
    let py = (ly - LOGO_H) * u * pose.scale;
    px += pose.skew * py;
    const c = Math.cos(pose.rot);
    const s = Math.sin(pose.rot);
    return { x: pivot.x + pose.x * rect.width + px * c - py * s, y: pivot.y + pose.y * rect.height + px * s + py * c };
  };

  let fired = 0;
  let pumped = 0;
  let voiced = false;
  let shakeAt = -10;
  let shakeForce = 0;
  let flashAt = -10;
  const pumps = pumpTimes(shots);

  const blast = (shot: Shot, t: number): void => {
    sounds.shot();
    shakeAt = t;
    shakeForce = shot.force;
    flashAt = t;
    const before = poseAt(t - 1e-3, shots);
    const stillOn = attachedAt(t, shots);
    for (const id of shot.removes) {
      const piece = PIECES.find((p) => p.id === id)!;
      const c = pieceCenter(piece);
      const at = toScreen(before, c.x, c.y);
      const away = Math.atan2(at.y - H, at.x - W / 2); // straight away from the shooter at the bottom of the screen
      const v = rnd(500, 900) * S * (0.8 + shot.force * 0.35);
      flying.push({
        canvas: cutPiece(piece, before.scale),
        w: piece.w * u * before.scale,
        h: piece.h * u * before.scale,
        x: at.x,
        y: at.y,
        vx: Math.cos(away) * v * 0.6 + rnd(-200, 200) * S,
        vy: Math.sin(away) * v * 0.7 - rnd(150, 450) * S,
        rot: before.rot,
        vrot: rnd(-9, 9),
        bleedUntil: t + 1.4,
      });
      spray(at.x, at.y, shot.final ? 55 : 80, 1100);
      // Wounds on the nearest piece still attached: the stump this one was torn from.
      let host: Piece | null = null;
      let best = Infinity;
      for (const p of PIECES) {
        if (!stillOn.has(p.id)) continue;
        const pc = pieceCenter(p);
        const d = Math.hypot(pc.x - c.x, pc.y - c.y);
        if (d < best) {
          best = d;
          host = p;
        }
      }
      if (host) {
        const near = { x: (c.x + pieceCenter(host).x) / 2, y: c.y };
        wounds.push({
          host: host.id,
          x: near.x,
          y: near.y,
          r: rnd(16, 26),
          t0: t,
          drips: Array.from({ length: 4 }, () => ({ dx: rnd(-20, 20), max: rnd(20, 70), speed: rnd(14, 34) })),
          dots: Array.from({ length: 12 }, () => ({ x: near.x + rnd(-48, 48), y: near.y + rnd(-40, 40), r: rnd(1.5, 3.4) })),
        });
      }
    }
    // Blood against the backdrop where the pieces were hit; the last blast throws it across the whole screen.
    if (shot.final) {
      for (let i = 0; i < 6; i++) wallSplat(pivot.x + rnd(-1, 1) * rect.width * 0.7, rect.top + rnd(-0.6, 1.1) * rect.height, rnd(26, 60) * S2, t);
      wallSplat(pivot.x + rnd(-0.25, 0.25) * rect.width, rect.top + rect.height * 0.4, rnd(75, 100) * S2, t);
    } else {
      for (const id of shot.removes) {
        const c = pieceCenter(PIECES.find((p) => p.id === id)!);
        const at = toScreen(before, c.x, c.y);
        wallSplat(at.x + rnd(-30, 30) * S2, at.y + rnd(-20, 20) * S2, rnd(18, 34) * S2, t);
      }
    }
    // Blood on the lens, more for the last blast.
    for (let i = 0; i < (shot.final ? 3 : 1); i++) {
      const sp = splatCanvas(rnd(14, 34) * S2, dpr);
      lens.push({ x: rnd(W * 0.12, W * 0.88), y: rnd(H * 0.15, H * 0.7), t0: t, canvas: sp.canvas, w: sp.w, h: sp.h });
    }
    poolTarget += shot.final ? 0.65 : 0.12;
  };

  const drawLayer = (t: number, pose: Pose): void => {
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.globalCompositeOperation = 'source-over';
    const on = attachedAt(t, shots);
    for (const p of PIECES) {
      if (!on.has(p.id)) continue;
      lctx.drawImage(logo, (p.x * nat.w) / LOGO_W, (p.y * nat.h) / LOGO_H, (p.w * nat.w) / LOGO_W, (p.h * nat.h) / LOGO_H, p.x * k, p.y * k, p.w * k, p.h * k);
    }
    // Everything below only lands on pixels the letters already cover.
    lctx.globalCompositeOperation = 'source-atop';
    for (const w of wounds) {
      if (!on.has(w.host)) continue;
      const age = t - w.t0;
      lctx.fillStyle = '#3d050a';
      lctx.beginPath();
      lctx.ellipse(w.x * k, w.y * k, w.r * k, w.r * 0.8 * k, 0.3, 0, Math.PI * 2);
      lctx.fill();
      lctx.fillStyle = '#5a0710';
      lctx.beginPath();
      lctx.ellipse((w.x - 3) * k, (w.y - 2) * k, w.r * 0.45 * k, w.r * 0.35 * k, 0.3, 0, Math.PI * 2);
      lctx.fill();
      for (const d of w.dots) {
        lctx.fillStyle = '#44060a';
        lctx.beginPath();
        lctx.arc(d.x * k, d.y * k, d.r * k, 0, Math.PI * 2);
        lctx.fill();
      }
      lctx.strokeStyle = '#44060a';
      lctx.lineCap = 'round';
      lctx.lineWidth = 2.6 * k;
      for (const d of w.drips) {
        const len = Math.min(d.max, age * d.speed);
        lctx.beginPath();
        lctx.moveTo((w.x + d.dx) * k, w.y * k);
        lctx.lineTo((w.x + d.dx) * k, (w.y + len) * k);
        lctx.stroke();
      }
    }
    if (pose.flash > 0) {
      lctx.fillStyle = `rgba(255,${Math.round(120 + 100 * pose.flash)},${Math.round(90 + 100 * pose.flash)},${(0.55 * pose.flash).toFixed(3)})`;
      lctx.fillRect(0, 0, layer.width, layer.height);
    }
    lctx.globalCompositeOperation = 'source-over';
  };

  const update = (t: number, dt: number): void => {
    // Wounds keep bleeding for a while after each blast: pulsing spurts, then a drip.
    for (const w of wounds) {
      const age = t - w.t0;
      if (age > 1.5 || attachedAt(t, shots).has(w.host) === false) continue;
      const pose = poseAt(t, shots);
      const at = toScreen(pose, w.x, w.y);
      const pulse = 0.55 + 0.45 * Math.sin(age * 11);
      const n = Math.random() < (1 - age / 1.5) * 38 * pulse * dt ? 3 : 0;
      for (let i = 0; i < n; i++) {
        const a = rnd(-Math.PI * 0.9, -Math.PI * 0.1);
        const v = rnd(120, 420) * S * (1 - age / 2);
        drops.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rnd(1.4, 3.6) * Math.max(0.7, S), age: 0, life: 1.4 });
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]!;
      d.age += dt;
      d.vy += gravity * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y >= floorY) {
        splatOnFloor(d.x, d.r * 0.9);
        drops.splice(i, 1);
      } else if (d.age > d.life + 1.2 || d.x < -20 || d.x > W + 20) drops.splice(i, 1);
    }
    for (const f of flying) {
      f.vy += gravity * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vrot * dt;
      const floor = floorY - f.h * 0.25;
      if (f.y > floor) {
        f.y = floor;
        if (Math.abs(f.vy) > 140 * S) splatOnFloor(f.x, f.h * 0.12);
        f.vy *= -0.32;
        f.vx *= 0.7;
        f.vrot *= 0.5;
        if (Math.abs(f.vy) < 60 * S) f.vy = 0;
      }
      if (f.x < f.w * 0.5 || f.x > W - f.w * 0.5) f.vx *= -0.5;
      f.x = Math.min(W - f.w * 0.5, Math.max(f.w * 0.5, f.x));
      if (t < f.bleedUntil && Math.random() < 30 * dt) spray(f.x + rnd(-f.w, f.w) * 0.3, f.y, 1, 220, 0);
    }
    pool += (poolTarget - pool) * Math.min(1, dt * 1.6);
  };

  const render = (t: number): void => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const shake = Math.max(0, 1 - (t - shakeAt) / 0.28) * shakeForce * 11 * Math.max(0.6, S);
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake), rnd(-shake, shake));

    // Backdrop splatters (they pop in on impact), then the floor: blood pool, then splats.
    for (const w of walls) {
      const age = t - w.t0;
      const pop = 0.55 + 0.45 * Math.min(1, age / 0.08);
      ctx.drawImage(w.canvas, w.x - (w.w * pop) / 2, w.y - (w.h * pop) / 2, w.w * pop, w.h * pop);
      ctx.strokeStyle = '#47060b';
      ctx.fillStyle = '#47060b';
      ctx.lineCap = 'round';
      for (const d of w.drips) {
        const len = Math.min(d.max, Math.max(0, age - 0.15) * d.speed);
        if (len <= 0) continue;
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(w.x + d.dx, w.y + w.R * 0.3);
        ctx.lineTo(w.x + d.dx, w.y + w.R * 0.3 + len);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w.x + d.dx, w.y + w.R * 0.3 + len, d.width * 0.95, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (pool > 0.01) {
      const pw = Math.min(W * 0.85, rect.width * 1.7) * Math.min(1, pool);
      const ph = pw * (poolArt.h / poolArt.w);
      ctx.globalAlpha = Math.min(1, pool * 2);
      ctx.drawImage(poolArt.canvas, pivot.x - pw / 2, floorY - ph / 2 + 4, pw, ph);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(decals, 0, 0, W, H);

    for (const f of flying) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.drawImage(f.canvas, -f.w / 2, -f.h / 2, f.w, f.h);
      ctx.restore();
    }

    if (t < shots[shots.length - 1]!.at) {
      const pose = poseAt(t, shots);
      drawLayer(t, pose);
      ctx.save();
      ctx.translate(pivot.x + pose.x * rect.width, pivot.y + pose.y * rect.height);
      ctx.rotate(pose.rot);
      ctx.transform(1, 0, pose.skew, 1, 0, 0);
      ctx.scale(pose.scale, pose.scale);
      ctx.drawImage(layer, -rect.width / 2, -rect.height, rect.width, rect.height);
      ctx.restore();
    }

    for (const d of drops) {
      ctx.strokeStyle = BLOOD[(Math.floor(d.x) + Math.floor(d.y)) % BLOOD.length]!;
      ctx.lineWidth = d.r * 1.6;
      ctx.lineCap = 'round';
      ctx.globalAlpha = Math.min(1, (d.life + 1.2 - d.age) / 0.6);
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.vx * 0.022, d.y - d.vy * 0.022);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Muzzle flash from the bottom of the screen, then blood on the lens.
    const fl = 1 - (t - flashAt) / 0.14;
    if (fl > 0) {
      const g = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 1.15);
      g.addColorStop(0, `rgba(255,236,190,${(0.6 * fl).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255,150,60,${(0.22 * fl).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    for (const s of lens) {
      const a = 0.9 * Math.max(0, 1 - (t - s.t0) / 3.4);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(s.canvas, s.x - s.w / 2, s.y - s.h / 2 + (t - s.t0) * 9, s.w, s.h);
    }
    ctx.globalAlpha = 1;
  };

  let raf = 0;
  let stopped = false;
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const begin = performance.now();
  let last = begin;
  render(0); // paint the logo before hiding the <img>, so there is no blank frame
  logo.style.visibility = 'hidden';

  const frame = (now: number): void => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - begin) / 1000;
    if (!voiced && t >= VOICE_AT) {
      voiced = true;
      sounds.voice();
    }
    while (fired < shots.length && t >= shots[fired]!.at) blast(shots[fired++]!, t);
    while (pumped < pumps.length && t >= pumps[pumped]!) {
      pumped++;
      sounds.pump();
    }
    update(t, dt);
    render(t);
    if (t >= ACT_LENGTH) {
      stopped = true;
      done();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    finished,
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      done();
    },
  };
}
