import * as THREE from 'three';
import { Rng } from '../core/rng.ts';

/**
 * Severing effects (ADR-0006): rigid debris, fluid spurts and floor pools. One instance per
 * scene, shared by every humanoid. Budgets from ADR-0015: 24 debris, decals kept well
 * under the 64 total.
 */

export type GoreMode = 'full' | 'reduced';

export const MAX_DEBRIS = 24;
export const MAX_POOLS = 24;
const MAX_PARTICLES = 900;
const GRAVITY = 9.8;
const DEBRIS_SLEEP_AFTER = 3;
const FADE_TIME = 0.6;
const UP = new THREE.Vector3(0, 1, 0);

interface Debris {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  /** Points (object-local) tested against the floor, with their radius. */
  probes: THREE.Vector3[];
  radius: number;
  age: number;
  asleep: boolean;
  fading: number;
  dispose: () => void;
}

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
}

interface Pool {
  mesh: THREE.Mesh;
  target: number;
  grow: number;
}

/** A soft, irregular pool texture, generated once. */
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
  readonly group = new THREE.Group();
  private readonly rng: Rng;
  private readonly floorY: (x: number, z: number) => number;
  private readonly debris: Debris[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly pools: Pool[] = [];
  private poolCursor = 0;
  private readonly poolMats: { full: THREE.MeshStandardMaterial; reduced: THREE.MeshStandardMaterial };

  // Particles: one Points object with ring-buffer slots.
  private readonly points: THREE.Points;
  private readonly pPos: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pLife: Float32Array;
  private pCursor = 0;

  constructor(rng: Rng, floorY: (x: number, z: number) => number = () => 0) {
    this.rng = rng;
    this.floorY = floorY;
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
      new THREE.PointsMaterial({ size: 0.022, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);

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
  }

  get activeDebris(): number {
    return this.debris.length;
  }

  get activePools(): number {
    return this.pools.length;
  }

  /**
   * Add a severed chain. The object must already sit at its world transform (it is
   * reparented to the gore group). `probes` are object-local points for floor contact.
   */
  addDebris(object: THREE.Object3D, velocity: THREE.Vector3, probes: THREE.Vector3[], radius: number, dispose: () => void): void {
    this.group.attach(object);
    this.debris.push({
      object,
      velocity: velocity.clone(),
      spin: new THREE.Vector3(this.rng.range(-7, 7), this.rng.range(-4, 4), this.rng.range(-7, 7)),
      probes,
      radius,
      age: 0,
      asleep: false,
      fading: -1,
      dispose,
    });
    // Over budget: the oldest piece that isn't already fading sinks away.
    const live = this.debris.filter((d) => d.fading < 0);
    if (live.length > MAX_DEBRIS) {
      const oldest = live[0];
      if (oldest) oldest.fading = 0;
    }
  }

  /** Spurt from `point` along `dir` (both local to `anchor`) for `duration` seconds. */
  spurt(anchor: THREE.Object3D, point: THREE.Vector3, dir: THREE.Vector3, duration = 1.5, dark = this.mode === 'reduced'): void {
    this.emitters.push({ anchor, point: point.clone(), dir: dir.clone().normalize(), duration, age: 0, rate: 160, speed: 2.4, dark });
  }

  /** Single burst at a world point (bullet impact on flesh, ADR-0005). */
  burst(at: THREE.Vector3, dir: THREE.Vector3, count = 18, dark = this.mode === 'reduced'): void {
    const d = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      d.copy(dir).multiplyScalar(this.rng.range(0.6, 2.2));
      d.x += this.rng.range(-0.9, 0.9);
      d.y += this.rng.range(-0.3, 1.2);
      d.z += this.rng.range(-0.9, 0.9);
      this.emit(at, d, dark);
    }
  }

  /** Grow a floor pool under a world point. */
  pool(at: THREE.Vector3, size: number, dark = this.mode === 'reduced'): void {
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
    p.mesh.position.set(at.x, this.floorY(at.x, at.z) + 0.004, at.z);
    p.mesh.rotation.z = this.rng.range(0, Math.PI * 2);
    p.mesh.scale.setScalar(0.001);
    p.target = size * this.rng.range(0.8, 1.2);
    p.grow = 0;
  }

  update(dt: number): void {
    this.updateDebris(dt);
    this.updateEmitters(dt);
    this.updateParticles(dt);
    for (const p of this.pools) {
      if (p.grow >= 1) continue;
      p.grow = Math.min(1, p.grow + dt / 2.5);
      p.mesh.scale.setScalar(Math.max(0.001, p.target * (1 - (1 - p.grow) ** 3)));
    }
  }

  clear(): void {
    for (const d of this.debris) {
      d.object.removeFromParent();
      d.dispose();
    }
    this.debris.length = 0;
    this.emitters.length = 0;
    for (const p of this.pools) p.mesh.removeFromParent();
    this.pools.length = 0;
    this.poolCursor = 0;
    this.pPos.fill(-999);
    this.pLife.fill(0);
  }

  // ---------------------------------------------------------------- internals

  private readonly tmp = new THREE.Vector3();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  private updateDebris(dt: number): void {
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
      if (d.asleep) continue;
      if (d.age > DEBRIS_SLEEP_AFTER + 2) {
        d.asleep = true;
        continue;
      }
      d.velocity.y -= GRAVITY * dt;
      o.position.addScaledVector(d.velocity, dt);
      const angle = d.spin.length() * dt;
      if (angle > 1e-6) {
        this.tmpQ.setFromAxisAngle(this.tmp.copy(d.spin).normalize(), angle);
        o.quaternion.premultiply(this.tmpQ);
      }
      // Floor contact against the lowest probe.
      o.updateMatrixWorld(true);
      let lowest = Infinity;
      let lx = 0;
      let lz = 0;
      for (const p of d.probes) {
        this.tmp.copy(p).applyMatrix4(o.matrixWorld);
        if (this.tmp.y < lowest) {
          lowest = this.tmp.y;
          lx = this.tmp.x;
          lz = this.tmp.z;
        }
      }
      const floor = this.floorY(lx, lz) + d.radius;
      if (lowest < floor) {
        o.position.y += floor - lowest;
        if (d.velocity.y < 0) d.velocity.y *= -0.22;
        d.velocity.x *= 0.72;
        d.velocity.z *= 0.72;
        d.spin.multiplyScalar(0.55);
        // No contact torque in this simple model, so tip long pieces over until they lie flat.
        const first = d.probes[0];
        const last = d.probes[d.probes.length - 1];
        let upright = 0;
        if (first && last && first !== last) {
          const a = this.tmp.copy(last).sub(first).transformDirection(o.matrixWorld);
          upright = Math.abs(a.y);
          if (upright > 0.3) {
            // Rotate the long axis toward horizontal whichever way it points.
            const k = this.tmpAxis.crossVectors(UP, a).multiplyScalar(Math.sign(a.y));
            if (k.lengthSq() < 1e-6) k.set(1, 0, 0);
            d.spin.addScaledVector(k.normalize(), 70 * upright * dt);
          }
        }
        if (upright <= 0.3 && d.age > 0.4 && d.velocity.lengthSq() < 0.02 && d.spin.lengthSq() < 0.2) d.asleep = true;
        if (d.age > DEBRIS_SLEEP_AFTER && upright <= 0.3) d.asleep = true;
      }
    }
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
        this.emit(this.ePos, this.eVel, e.dark);
      }
    }
  }

  private emit(at: THREE.Vector3, vel: THREE.Vector3, dark: boolean): void {
    const i = this.pCursor;
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
}
