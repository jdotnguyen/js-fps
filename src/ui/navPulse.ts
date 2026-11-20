import * as THREE from 'three';
import type { Navigator, P3 } from '../ai/nav.ts';

/** ADR-0012 nav pulse: seconds visible, cooldown after it fades. */
export const PULSE_SECONDS = 3;
export const PULSE_COOLDOWN = 2;
/** The line stops this far along the path (it fades out with distance anyway). */
const MAX_LENGTH = 40;

/**
 * Diegetic objective locator (ADR-0012): a glowing line along the navgraph path from Jay to
 * the current objective target, fading with distance and over 3 s. Q (`navPulse`) fires it;
 * the last hint tier fires it automatically (ADR-0010).
 */
export class NavPulse {
  readonly group = new THREE.Group();
  private readonly nav: () => Navigator | null;
  private readonly material: THREE.ShaderMaterial;
  private line: THREE.Mesh | null = null;
  private t = 0;
  private cooldown = 0;

  constructor(nav: () => Navigator | null) {
    this.nav = nav;
    this.group.name = 'navPulse';
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color('#39ffd0') } },
      vertexShader: 'attribute float along; varying float vAlong; void main(){ vAlong = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform float uTime; uniform float uFade; uniform vec3 uColor; varying float vAlong; void main(){ float head = uTime * 14.0; float glow = smoothstep(head - 6.0, head, vAlong) * (1.0 - smoothstep(head, head + 0.5, vAlong)); float base = 0.35 * (1.0 - smoothstep(0.0, 40.0, vAlong)) * step(vAlong, head); float a = (base + glow) * uFade; gl_FragColor = vec4(uColor * a, a); }',
    });
  }

  /** Can fire now (not showing, cooldown over). */
  get ready(): boolean {
    return this.line === null && this.cooldown <= 0;
  }

  /** Show the way from feet `from` to `to`. False if not ready or no route. */
  fire(from: P3, to: P3): boolean {
    if (!this.ready) return false;
    const nav = this.nav();
    const path = nav?.findPath(from, to) ?? [to];
    const pts = [from, ...path].map((p) => new THREE.Vector3(p.x, p.y + 0.05, p.z));
    const ribbon = buildRibbon(pts, 0.12);
    if (!ribbon) return false;
    this.line = new THREE.Mesh(ribbon, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
    this.group.add(this.line);
    this.t = 0;
    return true;
  }

  update(dt: number): void {
    if (this.line) {
      this.t += dt;
      this.material.uniforms['uTime']!.value = this.t;
      this.material.uniforms['uFade']!.value = Math.min(1, (PULSE_SECONDS - this.t) / 0.6);
      if (this.t >= PULSE_SECONDS) {
        this.group.remove(this.line);
        this.line.geometry.dispose();
        this.line = null;
        this.cooldown = PULSE_COOLDOWN;
      }
    } else if (this.cooldown > 0) this.cooldown -= dt;
  }
}

/** A flat ribbon on the floor along the points, with an `along` attribute in metres. */
function buildRibbon(pts: THREE.Vector3[], halfWidth: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const along: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) dist += p.distanceTo(pts[i - 1]!);
    if (dist > MAX_LENGTH) break;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * halfWidth;
    const nz = (dx / l) * halfWidth;
    pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
    along.push(dist, dist);
    const k = (pos.length / 3) - 2;
    if (k >= 2) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
  }
  if (pos.length < 12) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  return g;
}
