import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { clearOfBand, clipCoord, sameClip, type ClearBand, type GoreClip } from './goreClip.ts';
import { floorDebris, type DebrisBackend, type DebrisImpact, type DebrisPiece } from './debrisBackend.ts';
import { ManualCaster, RigidCaster, shadowCasters } from '../render/shadowCasters.ts';

/**
 * Severing effects (ADR-0006): rigid debris, fluid spurts and floor pools. One instance per
 * scene, shared by every humanoid. Budgets from ADR-0015: 24 debris, decals kept well
 * under the 64 total.
 */

export type GoreMode = 'full' | 'reduced';

export const MAX_DEBRIS = 24;
export const MAX_POOLS = 28;
/** Blood clouds under standing water at once, and how long one takes to spread and fade (s). */
export const MAX_CLOUDS = 12;
export const CLOUD_LIFE = 20;

/** Soft round falloff with a few lobes, so a cloud is not a perfect disc. Built once. */
let cloudTex: THREE.Texture | null | undefined;
function cloudTexture(): THREE.Texture | null {
  if (cloudTex !== undefined) return cloudTex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n - 0.5;
      const y = (j + 0.5) / n - 0.5;
      const a = Math.atan2(y, x);
      const r = Math.hypot(x, y) / (0.42 + 0.06 * Math.sin(a * 3) + 0.04 * Math.sin(a * 5 + 1.3));
      const v = Math.max(0, 1 - r) ** 1.6;
      data.set([255, 255, 255, Math.round(v * 255)], (j * n + i) * 4);
    }
  }
  cloudTex = new THREE.DataTexture(data, n, n);
  cloudTex.needsUpdate = true;
  return cloudTex;
}
export const MAX_CHUNKS = 64;
/** Marks on glass panes (hand smears, splats, running streaks), ring-buffered. */
export const MAX_GLASS_MARKS = 20;
const MAX_PARTICLES = 1400;
const GRAVITY = 9.8;
const FADE_TIME = 0.6;
const MAX_CLIPS = 16;
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
/** A piece must strike a surface at least this fast (m/s) to leave a mark where it lands. */
const IMPACT_MARK_SPEED = 1.5;
/** Splats from pieces striking walls, ring-buffered apart from the glass marks. */
export const MAX_IMPACT_MARKS = 12;

export interface Emitter {
  /** Object the spurt is attached to (a stump bone or a debris piece). */
  anchor: THREE.Object3D;
  /** Local point and direction on the anchor. */
  point: THREE.Vector3;
  dir: THREE.Vector3;
  duration: number;
  age: number;
  rate: number;
  speed: number;
  dark: boolean;
  /** Index into the clip registry (-1 none): its blood stays on one side of a plane (a glass pane). */
  clip: number;
}

interface Pool {
  mesh: THREE.Mesh;
  target: number;
  grow: number;
}

/** Marks on a glass pane: a palm print, a blood splat, a streak that runs, and an impact crack (a star of fractures). */
export type GlassMarkKind = 'print' | 'splat' | 'streak' | 'crack';

/** Crack decal variants (drawn once each); a crack picks one and a random rotation. */
const CRACK_VARIANTS = 3;

interface GlassMark {
  mesh: THREE.Mesh;
  kind: GlassMarkKind;
  /** Streaks: full length (m) and seconds to run down; others grow in quickly. */
  length: number;
  run: number;
  age: number;
}

/** Vertical runs of blood from a top edge (a streak's alpha), generated once. */
function streakTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const rng = new Rng('blood-streak');
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(w / 2, 34, w * 0.42, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const x = rng.range(w * 0.12, w * 0.88);
    const len = rng.range(h * 0.35, h * 0.97);
    const rw = rng.range(3, 9);
    const g = ctx.createLinearGradient(0, 30, 0, len);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rw / 2, 30, rw, len - 30);
    ctx.beginPath();
    ctx.arc(x, len - 4, rw * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A soft, irregular pool texture, generated once. */
/** A star crack radiating from the centre, white on clear: long rays with branches and a few concentric rings. */
function crackTexture(variant: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const rng = new Rng(`glass-crack-${variant}`);
  const mid = size / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  const rays = 9 + Math.floor(rng.range(0, 5));
  const ends: Array<[number, number, number]> = [];
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + rng.range(-0.2, 0.2);
    let x = mid;
    let y = mid;
    const len = rng.range(size * 0.28, size * 0.49);
    let walked = 0;
    ctx.lineWidth = rng.range(1.4, 2.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (walked < len) {
      const step = rng.range(8, 18);
      a += rng.range(-0.25, 0.25);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      walked += step;
      ctx.lineTo(x, y);
      if (rng.chance(0.18)) ends.push([x, y, a + rng.range(-1.1, 1.1)]);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  for (const [x0, y0, a] of ends) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(a) * rng.range(8, 26), y0 + Math.sin(a) * rng.range(8, 26));
    ctx.stroke();
  }
  // Concentric breaks near the strike, and a crushed centre.
  for (const r of [size * 0.08, size * 0.17]) {
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const rr = r * rng.range(0.85, 1.15);
      if (k === 0) ctx.moveTo(mid + Math.cos(a) * rr, mid + Math.sin(a) * rr);
      else if (rng.chance(0.8)) ctx.lineTo(mid + Math.cos(a) * rr, mid + Math.sin(a) * rr);
      else ctx.moveTo(mid + Math.cos(a) * rr, mid + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, size * 0.06);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function poolTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const rng = new Rng('blood-pool');
  for (let i = 0; i < 26; i++) {
    const r = rng.range(14, 54);
    const x = size / 2 + rng.range(-60, 60);
    const y = size / 2 + rng.range(-60, 60);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Splash flecks around the edge.
  for (let i = 0; i < 70; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(70, 120);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.4, 0.9)})`;
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, rng.range(1.5, 5), 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class GoreSystem {
  mode: GoreMode = 'full';
  /** Something came down on a floor (a piece, a chunk): standing water splashes there (standing-water spec). */
  onLand: ((x: number, y: number, z: number, size: number) => void) | null = null;
  /** Surface height of standing water over (x, z), or null where it is dry (standing-water spec: Blood clouds in water). */
  waterLevelAt: ((x: number, z: number) => number | null) | null = null;
  private readonly clouds: Array<{ mesh: THREE.Mesh; age: number; size: number }> = [];
  private cloudCursor = 0;
  private cloudMats: { full: THREE.MeshStandardMaterial; reduced: THREE.MeshStandardMaterial } | null = null;
  readonly group = new THREE.Group();
  private readonly rng: Rng;
  private readonly floorY: (x: number, z: number) => number;
  private readonly debris: DebrisPiece[] = [];
  /** The ballistic floor model: physics off, and the fallback until (or unless) the physics world exists. */
  private readonly floorBackend: DebrisBackend;
  private debrisBackend: DebrisBackend;
  private readonly emitters: Emitter[] = [];
  private readonly pools: Pool[] = [];
  private poolCursor = 0;
  private readonly poolMats: { full: THREE.MeshStandardMaterial; reduced: THREE.MeshStandardMaterial };
  private readonly glassMarks: GlassMark[] = [];
  private glassCursor = 0;
  private glassMats: Record<GlassMarkKind | 'reduced' | 'reducedStreak', THREE.MeshStandardMaterial> | null = null;
  private crackMats: THREE.MeshStandardMaterial[] | null = null;
  private readonly glassPlane = new THREE.PlaneGeometry(1, 1);
  /** The same plane with its top edge at the origin, so a streak grows downward. */
  private readonly streakPlane = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);

  // Particles: one Points object with ring-buffer slots.
  private readonly points: THREE.Points;
  private readonly pPos: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pLife: Float32Array;
  /** Per-particle index into `clips` (-1 none), set by `burst` with a clip. */
  private readonly pClip = new Int8Array(MAX_PARTICLES).fill(-1);
  private readonly clips: GoreClip[] = [];
  private pCursor = 0;

  // Meat chunks: one InstancedMesh (one draw call), ring buffer of slots.
  private readonly chunkMesh: THREE.InstancedMesh;
  private readonly chunkSlots: Array<{ pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Quaternion; spin: THREE.Vector3; scale: number; live: boolean; resting: boolean; clip: number }> = [];
  private chunkCursor = 0;

  constructor(rng: Rng, floorY: (x: number, z: number) => number = () => 0) {
    this.rng = rng;
    this.floorY = floorY;
    this.floorBackend = floorDebris(floorY);
    this.debrisBackend = this.floorBackend;
    this.group.name = 'gore';

    this.pPos = new Float32Array(MAX_PARTICLES * 3).fill(-999);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.026, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);

    const chunkGeo = new THREE.IcosahedronGeometry(0.022, 1);
    const cp = chunkGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const k = 0.65 + 0.7 * rng.next();
      cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * (0.6 + 0.5 * rng.next()), cp.getZ(i) * k);
    }
    chunkGeo.computeVertexNormals();
    this.chunkMesh = new THREE.InstancedMesh(
      chunkGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0, envMapIntensity: 1.6 }),
      MAX_CHUNKS,
    );
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.castShadow = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color();
    for (let i = 0; i < MAX_CHUNKS; i++) {
      this.chunkMesh.setMatrixAt(i, zero);
      // Dark muscle, pale fat, the odd bone fragment.
      const r = rng.next();
      col.set(r < 0.65 ? 0x4a0a0e : r < 0.88 ? 0x7a3a34 : 0xcfc3a8).multiplyScalar(0.8 + 0.4 * rng.next());
      this.chunkMesh.setColorAt(i, col);
      this.chunkSlots.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), spin: new THREE.Vector3(), scale: 1, live: false, resting: false, clip: -1 });
    }
    this.group.add(this.chunkMesh);
    this.unregisterCaster = shadowCasters.add(this.shadowCaster);

    const tex = poolTexture();
    const pool = (color: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        color,
        alphaMap: tex,
        transparent: true,
        depthWrite: false,
        roughness: 0.12,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
    this.poolMats = { full: pool(0x2a0305), reduced: pool(0x070606) };
    // Pre-create gore canvas/data textures on construction so the first hit/crack never stalls gameplay.
    if (typeof document !== 'undefined') this.prewarm();
  }

  /** Eagerly build all gore canvas/data textures & materials and return their unique textures for GPU pre-upload. */
  prewarm(): THREE.Texture[] {
    this.glassMaterials();
    this.crackMaterial(0);
    this.ensureCloudMats();
    const textures = new Set<THREE.Texture>();
    const mats: THREE.MeshStandardMaterial[] = [this.poolMats.full, this.poolMats.reduced];
    if (this.cloudMats) mats.push(this.cloudMats.full, this.cloudMats.reduced);
    if (this.glassMats) mats.push(...Object.values(this.glassMats));
    if (this.crackMats) mats.push(...this.crackMats);
    for (const m of mats) {
      if (m.map) textures.add(m.map);
      if (m.alphaMap) textures.add(m.alphaMap);
    }
    return [...textures];
  }

  private ensureCloudMats(): { full: THREE.MeshStandardMaterial; reduced: THREE.MeshStandardMaterial } {
    if (!this.cloudMats) {
      const tex = cloudTexture();
      // Lit, so the plume shows where the flashlight or a lamp falls on it and stays dark elsewhere, as blood in murky water does.
      const mk = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, map: tex, transparent: true, depthWrite: false, opacity: 0.8, roughness: 1, metalness: 0 });
      this.cloudMats = { full: mk(0x8a0c0a), reduced: mk(0x1a1a1a) };
    }
    return this.cloudMats;
  }

  get activeDebris(): number {
    return this.debris.length;
  }

  /** Name of the backend new pieces go to ('floor' or 'physics'). */
  get debrisBackendName(): string {
    return this.debrisBackend.name;
  }

  /**
   * Send new severed pieces to `backend` (the physics world's, once it exists), or back to the floor model with
   * null. Pieces already live keep the backend they started with (adopt-physics-engine D5).
   */
  setDebrisBackend(backend: DebrisBackend | null): void {
    this.debrisBackend = backend ?? this.floorBackend;
  }

  /** Splats left where pieces struck walls and props: their own ring, so they never push out authored glass marks. */
  private readonly impactMarks: THREE.Mesh[] = [];
  private impactCursor = 0;

  /** Where a piece first strikes something: a pool on a floor or prop top, a splat on a wall (severed-debris spec). */
  private markImpact(hit: DebrisImpact): void {
    if (hit.speed < IMPACT_MARK_SPEED) return;
    const at = this.tmp.copy(hit.point);
    // The same clip planes as spray and chunks: a mark never lands on the far side of a gore clip's glass.
    for (const clip of this.clips) at[clip.axis] = clipCoord(clip, at[clip.axis], 0)[0];
    const size = Math.min(0.6, 0.18 + hit.piece.radius * 2 + hit.speed * 0.02);
    if (hit.normal.y > 0.6) {
      this.onLand?.(at.x, at.y, at.z, size);
      this.pool(at, size * 0.8, this.mode === 'reduced', at.y);
      return;
    }
    if (hit.normal.y < -0.6) return; // A ceiling: drips would come from the spray, not a mark.
    let m = this.impactMarks.length < MAX_IMPACT_MARKS ? undefined : this.impactMarks[this.impactCursor];
    if (!m) {
      m = new THREE.Mesh(this.glassPlane, this.glassMaterials().splat);
      m.renderOrder = 2;
      this.group.add(m);
      this.impactMarks.push(m);
    } else {
      this.impactCursor = (this.impactCursor + 1) % MAX_IMPACT_MARKS;
    }
    const mats = this.glassMaterials();
    m.material = this.mode === 'reduced' ? mats.reduced : mats.splat;
    m.position.copy(at).addScaledVector(hit.normal, 0.004);
    m.lookAt(m.position.x + hit.normal.x, m.position.y + hit.normal.y, m.position.z + hit.normal.z);
    m.rotateZ(this.rng.range(0, Math.PI * 2));
    m.scale.set(size, size, 1);
  }

  /** Impact splats currently placed (tests). */
  get impactMarkCount(): number {
    return this.impactMarks.length;
  }

  get activePools(): number {
    return this.pools.length;
  }

  get activeGlassMarks(): number {
    return this.glassMarks.length;
  }

  /** World heights of the glass marks' bottom and top edges once fully grown (tests: the clear band). */
  glassMarkExtents(): Array<{ kind: GlassMarkKind; min: number; max: number }> {
    return this.glassMarks.map((m) => {
      const h = ((m.mesh.userData['full'] as [number, number] | undefined) ?? [1, m.length])[1];
      const top = m.kind === 'streak' ? m.mesh.position.y : m.mesh.position.y + h / 2;
      return { kind: m.kind, min: top - h, max: top };
    });
  }

  private glassMaterials(): Record<GlassMarkKind | 'reduced' | 'reducedStreak', THREE.MeshStandardMaterial> {
    if (this.glassMats) return this.glassMats;
    const blob = poolTexture();
    const runs = streakTexture();
    const mat = (color: number, alphaMap: THREE.Texture, opacity: number, roughness: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        color,
        alphaMap,
        transparent: true,
        opacity,
        depthWrite: false,
        roughness,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
    this.glassMats = {
      // A sweaty, greasy palm smear: pale and faint, not blood.
      print: mat(0xd8dcd6, blob, 0.2, 0.6),
      splat: mat(0x5a0508, blob, 0.92, 0.15),
      streak: mat(0x4a0407, runs, 0.95, 0.12),
      reduced: mat(0x0a0808, blob, 0.85, 0.3),
      reducedStreak: mat(0x0a0808, runs, 0.85, 0.3),
      crack: mat(0xe9eef0, blob, 0.8, 0.1),
    };
    return this.glassMats;
  }

  /** The crack decal for variant `i` (the same in Full and Reduced gore: it is glass, not blood). */
  private crackMaterial(i: number): THREE.MeshStandardMaterial {
    if (!this.crackMats) {
      const base = this.glassMaterials().crack;
      this.crackMats = Array.from({ length: CRACK_VARIANTS }, (_, v) => {
        const m = base.clone();
        m.alphaMap = crackTexture(v);
        return m;
      });
    }
    return this.crackMats[i % CRACK_VARIANTS]!;
  }

  /**
   * A mark on a glass pane at `at`, facing along `normal` (toward the side it was made from). `size` is the mark's height
   * (m); a streak is `size` long and runs down over `run` seconds from its top at `at` (or along `along`, a direction on
   * the pane: a hand pulled sideways). A crack is a star of fractures centred on `at`. With a `band`, the mark is moved
   * clear of it so the player can still see through the glass there (infection-kills spec).
   */
  glassMark(at: THREE.Vector3, normal: THREE.Vector3, kind: GlassMarkKind, size: number, opts: { band?: ClearBand; run?: number; dark?: boolean; along?: THREE.Vector3 } = {}): void {
    const mats = this.glassMaterials();
    const dark = opts.dark ?? this.mode === 'reduced';
    let m = this.glassMarks.length < MAX_GLASS_MARKS ? undefined : this.glassMarks[this.glassCursor];
    if (!m) {
      const mesh = new THREE.Mesh(this.glassPlane, mats.splat);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      m = { mesh, kind, length: size, run: 0.2, age: 0 };
      this.glassMarks.push(m);
    } else {
      this.glassCursor = (this.glassCursor + 1) % MAX_GLASS_MARKS;
    }
    m.kind = kind;
    m.age = 0;
    m.length = size;
    m.run = kind === 'streak' ? Math.max(0.2, opts.run ?? 6) : 0.12;
    m.mesh.geometry = kind === 'streak' ? this.streakPlane : this.glassPlane;
    m.mesh.material =
      kind === 'crack' ? this.crackMaterial(Math.floor(this.rng.range(0, CRACK_VARIANTS)))
      : kind === 'print' ? mats.print
      : dark ? (kind === 'streak' ? mats.reducedStreak : mats.reduced)
      : kind === 'streak' ? mats.streak : mats.splat;
    const along = kind === 'streak' && opts.along ? opts.along.clone().addScaledVector(normal, -opts.along.dot(normal)) : null;
    const width = kind === 'streak' ? size * 0.28 : kind === 'print' ? size * 0.8 : size;
    let y = at.y;
    if (kind === 'streak' && !along) {
      // The whole run (top down to top - size) stays out of the band: start it below the band if it would cross.
      if (opts.band && y - size < opts.band.max && y > opts.band.min) y = Math.min(y, opts.band.min - 0.01);
    } else if (kind === 'splat') {
      y = clearOfBand(y, size, opts.band);
    }
    m.mesh.position.set(at.x, y, at.z).addScaledVector(normal, 0.004);
    m.mesh.lookAt(m.mesh.position.x + normal.x, m.mesh.position.y + normal.y, m.mesh.position.z + normal.z);
    if (along && along.lengthSq() > 1e-6) {
      // Run along the pane: the streak's local -Y (its run) turned onto `along`.
      const local = along.normalize().applyQuaternion(m.mesh.quaternion.clone().invert());
      m.mesh.rotateZ(Math.atan2(local.x, -local.y));
    } else m.mesh.rotateZ(kind === 'streak' ? this.rng.range(-0.04, 0.04) : this.rng.range(0, Math.PI * 2));
    m.mesh.scale.set(width, kind === 'streak' ? 0.001 : size, 1);
    if (kind !== 'streak') m.mesh.scale.multiplyScalar(0.3);
    m.mesh.userData['full'] = [width, size];
  }

  /**
   * Add a severed chain. The object must already sit at its world transform (it is
   * reparented to the gore group). `probes` are object-local points for floor contact.
   */
  addDebris(object: THREE.Object3D, velocity: THREE.Vector3, probes: THREE.Vector3[], radius: number, dispose: () => void): void {
    this.group.attach(object);
    // Reduced gore never detaches anything (the humanoid keeps the limb), and never makes a physical piece either.
    const backend = this.mode === 'reduced' ? this.floorBackend : this.debrisBackend;
    // A flying limb is a moving shadow caster until it is gone (shadow-rich-rooms D4).
    const unregister = shadowCasters.add(new RigidCaster(object));
    const disposeObject = dispose;
    dispose = () => {
      unregister();
      disposeObject();
    };
    const piece: DebrisPiece = {
      object,
      velocity: velocity.clone(),
      spin: new THREE.Vector3(this.rng.range(-7, 7), this.rng.range(-4, 4), this.rng.range(-7, 7)),
      probes,
      radius,
      age: 0,
      asleep: false,
      fading: -1,
      dispose,
      backend,
    };
    this.debris.push(piece);
    backend.add(piece);
    // Over budget: the oldest piece that isn't already fading sinks away.
    const live = this.debris.filter((d) => d.fading < 0);
    if (live.length > MAX_DEBRIS) {
      const oldest = live[0];
      if (oldest) {
        oldest.fading = 0;
        oldest.backend.release(oldest);
      }
    }
  }

  /** Spurt from `point` along `dir` (both local to `anchor`) for `duration` seconds. */
  spurt(anchor: THREE.Object3D, point: THREE.Vector3, dir: THREE.Vector3, duration = 1.5, dark = this.mode === 'reduced', clip?: GoreClip): void {
    const ci = this.clipIndex(clip);
    this.emitters.push({ anchor, point: point.clone(), dir: dir.clone().normalize(), duration, age: 0, rate: 260, speed: 2.8, dark, clip: ci });
    // Then it keeps dripping for a while.
    this.emitters.push({ anchor, point: point.clone(), dir: dir.clone().normalize(), duration: duration * 4, age: 0, rate: 14, speed: 0.15, dark, clip: ci });
  }

  /** Index of `clip` in the registry (added if new, the last slot is reused when full); -1 for none. */
  private clipIndex(clip: GoreClip | undefined): number {
    if (!clip) return -1;
    const i = this.clips.findIndex((c) => sameClip(c, clip));
    if (i >= 0) return i;
    if (this.clips.length < MAX_CLIPS) return this.clips.push({ ...clip }) - 1;
    this.clips[MAX_CLIPS - 1] = { ...clip };
    return MAX_CLIPS - 1;
  }

  /** Throw torn meat and bone fragments (Full gore only). `clip` keeps them on one side of a plane. */
  chunks(at: THREE.Vector3, dir: THREE.Vector3, count: number, clip?: GoreClip): void {
    if (this.mode === 'reduced') return;
    for (let n = 0; n < count; n++) {
      const c = this.chunkSlots[this.chunkCursor];
      this.chunkCursor = (this.chunkCursor + 1) % MAX_CHUNKS;
      if (!c) continue;
      c.live = true;
      c.resting = false;
      c.clip = this.clipIndex(clip);
      c.pos.copy(at);
      c.vel.copy(dir).multiplyScalar(this.rng.range(1, 3.2));
      c.vel.x += this.rng.range(-1.3, 1.3);
      c.vel.y += this.rng.range(0.6, 2.6);
      c.vel.z += this.rng.range(-1.3, 1.3);
      c.rot.setFromEuler(new THREE.Euler(this.rng.range(0, 6), this.rng.range(0, 6), this.rng.range(0, 6)));
      c.spin.set(this.rng.range(-14, 14), this.rng.range(-14, 14), this.rng.range(-14, 14));
      c.scale = this.rng.range(0.5, 1.5);
      this.clipChunk(c);
    }
  }

  /** Single burst at a world point (bullet impact on flesh, ADR-0005). */
  burst(at: THREE.Vector3, dir: THREE.Vector3, count = 30, dark = this.mode === 'reduced', clip?: GoreClip): void {
    const d = new THREE.Vector3();
    const ci = this.clipIndex(clip);
    for (let i = 0; i < count; i++) {
      d.copy(dir).multiplyScalar(this.rng.range(0.6, 2.2));
      d.x += this.rng.range(-0.9, 0.9);
      d.y += this.rng.range(-0.3, 1.2);
      d.z += this.rng.range(-0.9, 0.9);
      this.emit(at, d, dark, ci);
    }
  }

  /** Grow a floor pool under a world point (on the floor height there, or at `y`: a prop top a piece landed on). */
  pool(at: THREE.Vector3, size: number, dark = this.mode === 'reduced', y?: number): void {
    // Under standing water blood clouds the water instead of pooling on the floor.
    const level = this.waterLevelAt?.(at.x, at.z) ?? null;
    if (level !== null && (y ?? this.floorY(at.x, at.z)) < level - 0.02) {
      this.cloud(at, level, size, dark);
      return;
    }
    let p = this.pools.length < MAX_POOLS ? undefined : this.pools[this.poolCursor];
    if (!p) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.poolMats.full);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      p = { mesh, target: size, grow: 0 };
      this.pools.push(p);
    } else {
      this.poolCursor = (this.poolCursor + 1) % MAX_POOLS;
    }
    p.mesh.material = dark ? this.poolMats.reduced : this.poolMats.full;
    p.mesh.position.set(at.x, (y ?? this.floorY(at.x, at.z)) + 0.004, at.z);
    p.mesh.rotation.z = this.rng.range(0, Math.PI * 2);
    p.mesh.scale.setScalar(0.001);
    p.target = size * this.rng.range(0.8, 1.2);
    p.grow = 0;
  }

  /** A spreading blood cloud just under a water surface at `level`. */
  private cloud(at: THREE.Vector3, level: number, size: number, dark: boolean): void {
    const cloudMats = this.ensureCloudMats();
    let c = this.clouds.length < MAX_CLOUDS ? undefined : this.clouds[this.cloudCursor];
    if (!c) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cloudMats.full.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 1;
      mesh.name = 'gore-blood-cloud';
      this.group.add(mesh);
      c = { mesh, age: 0, size };
      this.clouds.push(c);
    } else this.cloudCursor = (this.cloudCursor + 1) % MAX_CLOUDS;
    const mat = c.mesh.material as THREE.MeshStandardMaterial;
    mat.color.copy((dark ? cloudMats.reduced : cloudMats.full).color);
    mat.opacity = 0.8;
    c.mesh.position.set(at.x, level - 0.03, at.z);
    c.mesh.rotation.z = this.rng.range(0, Math.PI * 2);
    c.mesh.scale.setScalar(size * 0.4);
    c.mesh.visible = true;
    c.age = 0;
    c.size = size;
  }

  /** Blood clouds under water (tests). */
  cloudCount(): number {
    return this.clouds.filter((c) => c.mesh.visible).length;
  }

  update(dt: number): void {
    this.updateDebris(dt);
    this.updateEmitters(dt);
    this.updateParticles(dt);
    this.updateChunks(dt);
    for (const m of this.glassMarks) {
      if (m.age >= m.run) continue;
      m.age = Math.min(m.run, m.age + dt);
      const k = m.age / m.run;
      const [w, h] = (m.mesh.userData['full'] as [number, number] | undefined) ?? [1, 1];
      if (m.kind === 'streak') m.mesh.scale.set(w, Math.max(0.001, h * (1 - (1 - k) ** 2)), 1);
      else m.mesh.scale.set(w * (0.3 + 0.7 * k), h * (0.3 + 0.7 * k), 1);
    }
    for (const c of this.clouds) {
      if (c.age >= CLOUD_LIFE) continue;
      c.age = Math.min(CLOUD_LIFE, c.age + dt);
      const k = c.age / CLOUD_LIFE;
      // Spreads quickly, then slowly, while it thins out.
      c.mesh.scale.setScalar(c.size * (0.4 + 2.6 * (1 - (1 - k) ** 3)));
      (c.mesh.material as THREE.MeshStandardMaterial).opacity = 0.8 * (1 - k) ** 1.5;
      c.mesh.visible = c.age < CLOUD_LIFE;
    }
    for (const p of this.pools) {
      if (p.grow >= 1) continue;
      p.grow = Math.min(1, p.grow + dt / 2.5);
      p.mesh.scale.setScalar(Math.max(0.001, p.target * (1 - (1 - p.grow) ** 3)));
    }
  }

  clear(): void {
    for (const d of this.debris) {
      if (d.fading < 0) d.backend.release(d);
      d.object.removeFromParent();
      d.dispose();
    }
    this.debris.length = 0;
    for (const m of this.impactMarks) m.removeFromParent();
    this.impactMarks.length = 0;
    this.impactCursor = 0;
    this.emitters.length = 0;
    for (const p of this.pools) p.mesh.removeFromParent();
    this.pools.length = 0;
    for (const c of this.clouds) c.mesh.removeFromParent();
    this.clouds.length = 0;
    this.cloudCursor = 0;
    for (const m of this.glassMarks) m.mesh.removeFromParent();
    this.glassMarks.length = 0;
    this.glassCursor = 0;
    this.poolCursor = 0;
    this.pPos.fill(-999);
    this.pLife.fill(0);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.chunkSlots.forEach((c, i) => {
      c.live = false;
      this.chunkMesh.setMatrixAt(i, zero);
    });
    this.chunkMesh.instanceMatrix.needsUpdate = true;
  }

  private readonly cm = new THREE.Matrix4();
  private readonly cs = new THREE.Vector3();
  private readonly cq = new THREE.Quaternion();

  private clipChunk(c: { pos: THREE.Vector3; vel: THREE.Vector3; clip: number }): void {
    const clip = c.clip >= 0 ? this.clips[c.clip] : undefined;
    if (!clip) return;
    const [np, nv] = clipCoord(clip, c.pos[clip.axis], c.vel[clip.axis]);
    c.pos[clip.axis] = np;
    c.vel[clip.axis] = nv;
  }

  /** Flying chunks as one moving shadow caster (shadow-rich-rooms D4): their bounds while any fly, none once all rest. */
  readonly shadowCaster = new ManualCaster((out) => {
    if (this.flying.isEmpty()) return false;
    this.flying.getBoundingSphere(out);
    out.radius += 0.05;
    return true;
  });
  private readonly flying = new THREE.Box3();

  private updateChunks(dt: number): void {
    let dirty = false;
    this.flying.makeEmpty();
    this.chunkSlots.forEach((c, i) => {
      if (!c.live || c.resting) return;
      dirty = true;
      this.flying.expandByPoint(c.pos);
      c.vel.y -= GRAVITY * dt;
      c.pos.addScaledVector(c.vel, dt);
      const a = c.spin.length() * dt;
      if (a > 1e-6) c.rot.premultiply(this.cq.setFromAxisAngle(this.cs.copy(c.spin).normalize(), a));
      this.clipChunk(c);
      const floor = this.floorY(c.pos.x, c.pos.z) + 0.012 * c.scale;
      if (c.pos.y < floor) {
        if (c.vel.y < -1.5) this.onLand?.(c.pos.x, floor, c.pos.z, 0.08 * c.scale);
        c.pos.y = floor;
        c.vel.y *= -0.18;
        c.vel.x *= 0.45;
        c.vel.z *= 0.45;
        c.spin.multiplyScalar(0.4);
        if (c.vel.lengthSq() < 0.01) c.resting = true;
      }
      this.cm.compose(c.pos, c.rot, this.cs.setScalar(c.scale));
      this.chunkMesh.setMatrixAt(i, this.cm);
    });
    if (dirty) {
      this.chunkMesh.instanceMatrix.needsUpdate = true;
      this.shadowCaster.bump();
    }
  }

  // ---------------------------------------------------------------- internals

  private readonly tmp = new THREE.Vector3();
  private readonly onImpact = (hit: DebrisImpact): void => this.markImpact(hit);
  private readonly backendPieces = new Map<DebrisBackend, DebrisPiece[]>();

  /** Age and fade every piece here; each backend moves its own live pieces (adopt-physics-engine D5). */
  private updateDebris(dt: number): void {
    for (const list of this.backendPieces.values()) list.length = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (!d) continue;
      d.age += dt;
      const o = d.object;
      if (d.fading >= 0) {
        d.fading += dt;
        o.position.y -= dt * 0.08;
        o.scale.multiplyScalar(Math.max(0, 1 - dt / FADE_TIME));
        if (d.fading > FADE_TIME) {
          o.removeFromParent();
          d.dispose();
          this.debris.splice(i, 1);
        }
        continue;
      }
      let list = this.backendPieces.get(d.backend);
      if (!list) this.backendPieces.set(d.backend, (list = []));
      list.push(d);
    }
    for (const [backend, list] of this.backendPieces) if (list.length) backend.update(list, dt, this.onImpact);
  }

  private readonly ePos = new THREE.Vector3();
  private readonly eDir = new THREE.Vector3();
  private readonly eVel = new THREE.Vector3();

  private updateEmitters(dt: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (!e) continue;
      e.age += dt;
      if (e.age > e.duration || !e.anchor.parent) {
        this.emitters.splice(i, 1);
        continue;
      }
      // Pulsing, weakening spurt.
      const life = 1 - e.age / e.duration;
      const pulse = 0.45 + 0.55 * Math.max(0, Math.sin(e.age * 13));
      const n = e.rate * dt * life * pulse;
      const count = Math.floor(n) + (this.rng.chance(n % 1) ? 1 : 0);
      if (count === 0) continue;
      e.anchor.updateWorldMatrix(true, false);
      this.ePos.copy(e.point).applyMatrix4(e.anchor.matrixWorld);
      this.eDir.copy(e.dir).transformDirection(e.anchor.matrixWorld);
      for (let k = 0; k < count; k++) {
        this.eVel.copy(this.eDir).multiplyScalar(e.speed * life * this.rng.range(0.5, 1.1));
        this.eVel.x += this.rng.range(-0.3, 0.3);
        this.eVel.y += this.rng.range(-0.2, 0.4);
        this.eVel.z += this.rng.range(-0.3, 0.3);
        this.emit(this.ePos, this.eVel, e.dark, e.clip);
      }
    }
  }

  private emit(at: THREE.Vector3, vel: THREE.Vector3, dark: boolean, clip = -1): void {
    const i = this.pCursor;
    this.pClip[i] = clip;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    const k = i * 3;
    this.pPos[k] = at.x;
    this.pPos[k + 1] = at.y;
    this.pPos[k + 2] = at.z;
    this.pVel[k] = vel.x;
    this.pVel[k + 1] = vel.y;
    this.pVel[k + 2] = vel.z;
    const shade = this.rng.range(0.6, 1);
    if (dark) {
      this.pCol[k] = 0.03 * shade;
      this.pCol[k + 1] = 0.025 * shade;
      this.pCol[k + 2] = 0.025 * shade;
    } else {
      this.pCol[k] = 0.32 * shade;
      this.pCol[k + 1] = 0.015 * shade;
      this.pCol[k + 2] = 0.02 * shade;
    }
    this.pLife[i] = this.rng.range(1.6, 2.6);
  }

  private updateParticles(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.pLife[i] ?? 0;
      if (life <= 0) continue;
      any = true;
      const k = i * 3;
      const nl = life - dt;
      this.pLife[i] = nl;
      if (nl <= 0) {
        this.pPos[k + 1] = -999;
        continue;
      }
      let vy = (this.pVel[k + 1] ?? 0) - GRAVITY * dt;
      let x = (this.pPos[k] ?? 0) + (this.pVel[k] ?? 0) * dt;
      let y = (this.pPos[k + 1] ?? 0) + vy * dt;
      let z = (this.pPos[k + 2] ?? 0) + (this.pVel[k + 2] ?? 0) * dt;
      const ci = this.pClip[i] ?? -1;
      const clip = ci >= 0 ? this.clips[ci] : undefined;
      if (clip) {
        // Blood that reaches the plane (the glass) stops on it and runs down instead of passing through.
        const ax = AXIS_INDEX[clip.axis];
        const cur = ax === 0 ? x : ax === 1 ? y : z;
        const [np, nv] = clipCoord(clip, cur, ax === 1 ? vy : (this.pVel[k + ax] ?? 0));
        if (np !== cur) {
          if (ax === 0) x = np;
          else if (ax === 1) y = np;
          else z = np;
          if (ax === 1) vy = nv;
          else this.pVel[k + ax] = nv;
        }
      }
      const fy = this.floorY(x, z) + 0.006;
      if (y < fy) {
        // Stick to the floor.
        y = fy;
        vy = 0;
        this.pVel[k] = 0;
        this.pVel[k + 2] = 0;
        x = this.pPos[k] ?? x;
        z = this.pPos[k + 2] ?? z;
      }
      this.pPos[k] = x;
      this.pPos[k + 1] = y;
      this.pPos[k + 2] = z;
      this.pVel[k + 1] = vy;
    }
    if (any) {
      this.points.geometry.getAttribute('position').needsUpdate = true;
      this.points.geometry.getAttribute('color').needsUpdate = true;
    }
  }

  /** Dispose all gore geometries, materials, canvas/data textures, and module-level cloudTex. */
  private readonly unregisterCaster: () => void;

  dispose(): void {
    this.unregisterCaster();
    this.clear();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.chunkMesh.geometry.dispose();
    (this.chunkMesh.material as THREE.Material).dispose();
    this.glassPlane.dispose();
    this.streakPlane.dispose();
    const mats: THREE.MeshStandardMaterial[] = [this.poolMats.full, this.poolMats.reduced];
    if (this.cloudMats) mats.push(this.cloudMats.full, this.cloudMats.reduced);
    if (this.glassMats) mats.push(...Object.values(this.glassMats));
    if (this.crackMats) mats.push(...this.crackMats);
    const textures = new Set<THREE.Texture>();
    for (const m of mats) {
      if (m.map) textures.add(m.map);
      if (m.alphaMap) textures.add(m.alphaMap);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    this.cloudMats = null;
    this.glassMats = null;
    this.crackMats = null;
    if (cloudTex) {
      cloudTex.dispose();
      cloudTex = undefined;
    }
    this.group.clear();
  }
}
