import * as THREE from 'three';
import type { Collider } from './collision.ts';
import type { Level } from './level.ts';

/**
 * ?debug overlays for kit levels (ADR-0003): grid, room cells and IDs, colliders,
 * triggers, sockets, light slots and nav nodes. Each layer toggles in the debug GUI.
 */

export const OVERLAY_LAYERS = ['grid', 'rooms', 'colliders', 'triggers', 'sockets', 'lightSlots', 'navNodes'] as const;
export type OverlayLayer = (typeof OVERLAY_LAYERS)[number];

function boxEdges(boxes: Array<{ min: THREE.Vector3; max: THREE.Vector3 }>, inset = 0): Float32Array {
  const out = new Float32Array(boxes.length * 24 * 3);
  let o = 0;
  for (const b of boxes) {
    const x0 = b.min.x + inset;
    const y0 = b.min.y + inset;
    const z0 = b.min.z + inset;
    const x1 = b.max.x - inset;
    const y1 = b.max.y - inset;
    const z1 = b.max.z - inset;
    const c = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ];
    const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    for (const e of edges) {
      const v = c[e]!;
      out[o++] = v[0]!;
      out[o++] = v[1]!;
      out[o++] = v[2]!;
    }
  }
  return out;
}

function lines(positions: Float32Array, color: number, depthTest = true): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const m = new THREE.LineBasicMaterial({ color, depthTest, transparent: !depthTest, opacity: depthTest ? 1 : 0.8 });
  const l = new THREE.LineSegments(g, m);
  l.renderOrder = 10;
  l.frustumCulled = false;
  return l;
}

function points(list: THREE.Vector3[], colors: THREE.Color[], size: number): THREE.Points {
  const g = new THREE.BufferGeometry().setFromPoints(list);
  const c = new Float32Array(colors.length * 3);
  colors.forEach((col, i) => col.toArray(c, i * 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, depthTest: false, sizeAttenuation: true }));
  p.renderOrder = 11;
  p.frustumCulled = false;
  return p;
}

function textSprite(text: string, sub: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffd34d';
  ctx.font = '700 56px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 60);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '28px ui-monospace, Menlo, monospace';
  ctx.fillText(sub, 256, 104);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 12;
  return s;
}

export class LevelOverlay {
  readonly group = new THREE.Group();
  readonly layers: Record<OverlayLayer, THREE.Group>;
  readonly visible: Record<OverlayLayer, boolean>;

  constructor(level: Level) {
    this.group.name = 'level-debug';
    const mk = (): THREE.Group => {
      const g = new THREE.Group();
      g.visible = false;
      this.group.add(g);
      return g;
    };
    this.layers = { grid: mk(), rooms: mk(), colliders: mk(), triggers: mk(), sockets: mk(), lightSlots: mk(), navNodes: mk() };
    this.visible = { grid: false, rooms: false, colliders: false, triggers: false, sockets: false, lightSlots: false, navNodes: false };
    const d = level.debug;

    // Grid on the 4 m cells, covering the level.
    const size = Math.ceil(Math.max(d.bounds.max.x - d.bounds.min.x, d.bounds.max.z - d.bounds.min.z) / 4 + 2) * 4;
    const grid = new THREE.GridHelper(size, size / 4, 0xffd34d, 0x5a6a70);
    const center = d.bounds.getCenter(new THREE.Vector3());
    grid.position.set(Math.round(center.x / 4) * 4 + (size / 4) % 2 * 2, 0.02, Math.round(center.z / 4) * 4 + (size / 4) % 2 * 2);
    this.layers.grid.add(grid);

    for (const r of d.rooms) {
      this.layers.rooms.add(lines(boxEdges(r.cells, 0.08), 0xffd34d));
      const first = r.cells[0];
      if (!first) continue;
      const label = textSprite(r.id, r.name);
      const c = new THREE.Vector3();
      for (const cell of r.cells) c.add(cell.getCenter(new THREE.Vector3()));
      c.divideScalar(r.cells.length);
      label.position.set(c.x, 2.3, c.z);
      this.layers.rooms.add(label);
    }

    const toBox = (c: Collider): { min: THREE.Vector3; max: THREE.Vector3 } => ({ min: new THREE.Vector3(c.minX, c.minY, c.minZ), max: new THREE.Vector3(c.maxX, c.maxY, c.maxZ) });
    // Room geometry in orange; door frames and leaves in pink.
    this.layers.colliders.add(lines(boxEdges(level.collision.colliders.filter((c) => !c.tag.startsWith('door:')).map(toBox), 0.01), 0xff7a1a));
    this.layers.colliders.add(lines(boxEdges(level.collision.colliders.filter((c) => c.tag.startsWith('door:')).map(toBox), 0.01), 0xff2a6a));

    this.layers.triggers.add(lines(boxEdges(d.triggers), 0x39ff9e, false));

    const sock = new Float32Array(d.sockets.length * 6 * 3);
    d.sockets.forEach((s, i) => {
      const a = s.pos.clone().setY(s.pos.y + 0.3);
      const b = a.clone().addScaledVector(s.dir, 0.8);
      const side = new THREE.Vector3(-s.dir.z, 0, s.dir.x).multiplyScalar(0.2);
      const h1 = b.clone().addScaledVector(s.dir, -0.25).add(side);
      const h2 = b.clone().addScaledVector(s.dir, -0.25).sub(side);
      [a, b, b, h1, b, h2].forEach((v, k) => v.toArray(sock, (i * 6 + k) * 3));
    });
    this.layers.sockets.add(lines(sock, 0x2fd3ff, false));

    this.layers.lightSlots.add(
      points(
        d.slots.map((s) => s.pos),
        d.slots.map((s) => new THREE.Color(s.claimed ? (s.kind === 'emergency' ? 0xff3b2f : 0xfff1a8) : 0x6a6a6a)),
        0.22,
      ),
    );
    this.layers.navNodes.add(
      points(
        d.nav.map((p) => p.clone().setY(p.y + 0.05)),
        d.nav.map(() => new THREE.Color(0xd04dff)),
        0.18,
      ),
    );
  }

  set(layer: OverlayLayer, on: boolean): void {
    this.visible[layer] = on;
    this.layers[layer].visible = on;
  }
}
