import * as THREE from 'three';
import type { Level } from './level.ts';
import { SHADOW_CONES } from './shadowPool.ts';

/**
 * ?debug lighting overlay (shadow-rich-rooms D9): a cone per bound shadow spot (green while fully on, yellow while
 * fading), a range ring per bound fill light (blue), a red cross on claimed slots that got no light, and a HUD line
 * with the pool counts and this frame's shadow-map redraws. Loaded only with ?debug (a dynamic import).
 */
export class LightingOverlay {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly hud: HTMLDivElement | null;
  private enabled = false;
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly level: Level;

  constructor(level: Level) {
    this.level = level;
    this.group.name = 'lighting-overlay';
    this.group.visible = false;
    const g = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 }));
    this.lines.renderOrder = 12;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    if (typeof document !== 'undefined' && document.body) {
      this.hud = document.createElement('div');
      this.hud.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:20;font:12px ui-monospace,Menlo,monospace;color:#e8f4f8;background:rgba(0,0,0,.6);padding:4px 8px;pointer-events:none;display:none';
      document.body.appendChild(this.hud);
    } else this.hud = null;
  }

  set visible(on: boolean) {
    this.enabled = on;
    this.group.visible = on;
    if (this.hud) this.hud.style.display = on ? 'block' : 'none';
  }

  get visible(): boolean {
    return this.enabled;
  }

  /** The HUD text for the current frame (also what tests read). */
  summary(): string {
    const pool = this.level.shadowPool;
    const states = pool.states();
    const bound = states.filter((s) => s.slot).length;
    const fading = states.filter((s) => s.slot && s.phase !== 'on').length;
    const st = this.level.lightingState();
    const fill = st.slots.filter((s) => s.by === 'fill').length;
    const none = st.slots.filter((s) => s.by === 'none').length;
    return `room ${st.room ?? '-'} | shadow ${bound}/${pool.size} (fading ${fading}, redrawn ${pool.redraws}) | fill ${fill}/${this.level.pool.size} | claimed ${st.claimed}, unlit ${none}`;
  }

  /** Rebuild the overlay for this frame. Call after the world update. */
  update(): void {
    if (!this.enabled) return;
    const pos = this.pos;
    const col = this.col;
    pos.length = 0;
    col.length = 0;
    const seg = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color): void => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const green = new THREE.Color(0x39ff6a);
    const yellow = new THREE.Color(0xffd34d);
    const blue = new THREE.Color(0x3aa0ff);
    const red = new THREE.Color(0xff3030);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const ring = (center: THREE.Vector3, radius: number, c: THREE.Color, axis: 'y' | 'x' | 'z' = 'y'): void => {
      const n = 24;
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2;
        const t1 = ((i + 1) / n) * Math.PI * 2;
        const p = (t: number, out: THREE.Vector3): THREE.Vector3 =>
          axis === 'y' ? out.set(center.x + Math.cos(t) * radius, center.y, center.z + Math.sin(t) * radius) : axis === 'x' ? out.set(center.x, center.y + Math.cos(t) * radius, center.z + Math.sin(t) * radius) : out.set(center.x + Math.cos(t) * radius, center.y + Math.sin(t) * radius, center.z);
        seg(p(t0, a), p(t1, b), c);
      }
    };
    for (const s of this.level.shadowPool.states()) {
      if (!s.slot) continue;
      const c = s.phase === 'on' ? green : yellow;
      const angle = THREE.MathUtils.degToRad(SHADOW_CONES[s.slot.kind ?? 'ceiling'].angle);
      const apex = s.light.position;
      const r = s.light.distance * Math.sin(angle);
      const base = new THREE.Vector3(apex.x, apex.y - s.light.distance * Math.cos(angle), apex.z);
      ring(base, r, c);
      for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2;
        seg(apex, b.set(base.x + Math.cos(t) * r, base.y, base.z + Math.sin(t) * r), c);
      }
    }
    for (const { slot, by } of this.level.lightingState().slots) {
      if (by === 'fill') {
        ring(slot.position, slot.range, blue, 'y');
        ring(slot.position, slot.range, blue, 'x');
      } else if (by === 'none') {
        const p = slot.position;
        seg(a.set(p.x - 0.3, p.y - 0.3, p.z), b.set(p.x + 0.3, p.y + 0.3, p.z), red);
        seg(a.set(p.x - 0.3, p.y + 0.3, p.z), b.set(p.x + 0.3, p.y - 0.3, p.z), red);
      }
    }
    const g = this.lines.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (this.hud) this.hud.textContent = this.summary();
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.group.removeFromParent();
    this.hud?.remove();
  }
}
