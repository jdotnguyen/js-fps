import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { drawTagMark } from '../../render/logo.ts';
import type { DoorKit, DoorState } from '../../data/types/level.ts';
import { at, rounded } from './geom.ts';
import { slab } from './shapes.ts';
import { AoMergeBuilder } from './merge.ts';
import { AREA_PALETTES, type AreaPalette } from './palettes.ts';
import { doorFrame } from './structure.ts';
import { PieceBuilder, type BoxSpec, type PieceOutput } from './types.ts';

/**
 * Door kits (ADR-0003): frame + animated leaves + a status screen on both sides of the
 * right jamb. Built in piece space: origin at the cell centre, door on the cell's -Z edge.
 */

export interface DoorAreas {
  /** Area of the room on the +Z (door cell) side. */
  front?: string;
  /** Area of the room on the -Z (far) side. */
  back?: string;
}

export interface DoorVisual {
  /** Static frame geometry and colliders (merged with the door). */
  frame: PieceOutput;
  /** Moving parts. */
  leaves: THREE.Group;
  /** 0 = closed, 1 = open. */
  setOpen(f: number): void;
  /** Collider while closed, in piece space. */
  closedBox: BoxSpec;
  /** Glass doors let you see the next room even when shut (and sound passes as through glass). */
  seeThrough: boolean;
  /** A pressure door with a porthole (level-kit spec): the next room is drawn through it when shut, but it blocks sound like any door. */
  porthole: boolean;
  /** Seconds for a full open or close. */
  travelTime: number;
  tick(t: number): void;
}

const Z = -2;
const PI = Math.PI;

export const DOOR_COLORS: Record<DoorState, string> = {
  open: '#39ff9e',
  closed: '#4fd6d0',
  locked: '#ff3b2f',
  jammed: '#ffb020',
  sealed: '#ff3b2f',
};

function mergedLeaf(build: (mb: AoMergeBuilder) => void, name: string): THREE.Group {
  const mb = new AoMergeBuilder();
  build(mb);
  return mb.build(name, null);
}

/** Porthole on the +X leaf of a pressure door: centre height above the floor and glass radius (m). */
export const PORTHOLE = { y: 1.6, r: 0.15 } as const;

/** A pressure-door leaf (1.02 x 2.4 x 0.14) with a round hole through it for a porthole, centred at leaf-local (0, cy). */
function portholeLeafGeometry(cy: number, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.51, -1.2);
  shape.lineTo(0.51, -1.2);
  shape.lineTo(0.51, 1.2);
  shape.lineTo(-0.51, 1.2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, cy, r + 0.02, 0, PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -0.07);
  return g;
}

export function buildDoor(kit: DoorKit, height: number, state: () => DoorState, _rng: Rng, m: Materials, areas?: DoorAreas, opts?: { porthole?: boolean }): DoorVisual {
  const porthole = kit === 'pressure_slide' && opts?.porthole === true;
  const pb = new PieceBuilder();
  const frontPal: AreaPalette | undefined = areas?.front ? AREA_PALETTES[areas.front] : undefined;
  const backPal: AreaPalette | undefined = areas?.back ? AREA_PALETTES[areas.back] : undefined;
  const leafKey = frontPal?.doorPanel ?? backPal?.doorPanel;
  const leafMat = leafKey ? m[leafKey] : m.paintDark;
  const glassBarKey = frontPal?.doorGlassBar ?? backPal?.doorGlassBar;
  const glassBarMat = glassBarKey ? m[glassBarKey] : m.paintBone;
  const framePaint = (pal: AreaPalette | undefined): THREE.MeshStandardMaterial =>
    kit === 'bulkhead' ? m.servicePaint : pal?.doorPanel ? m[pal.doorPanel] : m.paintDark;
  const frameSurround = (pal: AreaPalette | undefined): THREE.MeshStandardMaterial =>
    pal?.doorSurround ? m[pal.doorSurround] : m.paintDark;
  doorFrame(pb, m, 4, height, {
    trim: m.steelBrushed,
    paintFront: framePaint(frontPal),
    paintBack: framePaint(backPal),
    surroundFront: frameSurround(frontPal),
    surroundBack: frameSurround(backPal),
  });
  const leaves = new THREE.Group();
  leaves.name = `door-leaves:${kit}`;
  let setOpen: (f: number) => void;
  let travelTime = 0.9;

  if (kit === 'bulkhead') {
    travelTime = 1.8;
    const leaf = mergedLeaf((mb) => {
      mb.add(rounded(2.1, 2.5, 0.24, 0.04), leafMat, at(0, 0, 0));
      for (const y of [-0.8, 0, 0.8]) mb.add(rounded(2.02, 0.12, 0.32, 0.02), m.steel, at(0, y, 0));
      for (const fz of [-1, 1]) {
        mb.add(slab(1.9, 0.22, 0.02), m.steelBrushed, at(0, -1.05, fz * 0.13));
        mb.add(new THREE.TorusGeometry(0.26, 0.03, 8, 32), m.steel, at(0, 0.4, fz * 0.2));
        for (let k = 0; k < 3; k++) mb.add(slab(0.52, 0.025, 0.03), m.steel, at(0, 0.4, fz * 0.2, 0, 0, (k * PI) / 3));
        mb.add(slab(0.3, 0.12, 0.02), m.black, at(0.7, 0.9, fz * 0.13));
      }
    }, 'bulkhead-leaf');
    leaf.position.set(0, 1.25, Z);
    leaves.add(leaf);
    setOpen = (f) => {
      leaf.position.y = 1.25 + f * 2.35;
    };
  } else {
    const glass = kit === 'glass_slide';
    for (const s of [-1, 1]) {
      const leaf = mergedLeaf((mb) => {
        if (glass) {
          mb.add(rounded(1.02, 0.12, 0.1, 0.02), m.steel, at(0, 1.14, 0));
          mb.add(rounded(1.02, 0.18, 0.1, 0.02), m.steel, at(0, -1.11, 0));
          mb.add(rounded(0.08, 2.4, 0.1, 0.02), m.steel, at(-0.47, 0, 0));
          mb.add(rounded(0.08, 2.4, 0.12, 0.02), m.steel, at(0.47, 0, 0));
          mb.add(slab(0.86, 0.06, 0.104), glassBarMat, at(0, -0.15, 0));
        } else {
          // The porthole sits in the +X leaf; that leaf drops its sign plate and grab rail to clear the glass.
          const holed = porthole && s > 0;
          const cy = PORTHOLE.y - 1.2;
          mb.add(holed ? portholeLeafGeometry(cy, PORTHOLE.r) : rounded(1.02, 2.4, 0.14, 0.03), leafMat, at(0, 0, 0));
          mb.add(rounded(0.06, 2.4, 0.18, 0.02), m.steel, at(-s * 0.48, 0, 0));
          for (const fz of [-1, 1]) {
            mb.add(slab(0.96, 0.22, 0.02), m.steelBrushed, at(0, -0.98, fz * 0.075));
            mb.add(slab(0.055, 0.14, 0.02), m.hazardClean, at(-s * 0.48, 0.2, fz * 0.095));
            if (holed) {
              // Bolted ring round the glass on each face.
              mb.add(new THREE.TorusGeometry(PORTHOLE.r + 0.03, 0.025, 8, 32), m.steel, at(0, cy, fz * 0.075));
              for (let k = 0; k < 8; k++) {
                const a = (k * PI) / 4;
                const rr = PORTHOLE.r + 0.03;
                mb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), m.steelBrushed, at(Math.cos(a) * rr, cy + Math.sin(a) * rr, fz * 0.1, PI / 2, 0, 0));
              }
            } else {
              mb.add(slab(0.3, 0.16, 0.02), m.black, at(s * 0.1, 0.7, fz * 0.075));
              mb.add(rounded(0.7, 0.05, 0.03, 0.01), m.steel, at(0, 0.3, fz * 0.08));
            }
          }
        }
      }, `slide-leaf-${s}`);
      if (glass) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 2.1), m.glass);
        pane.position.y = 0.02;
        pane.renderOrder = 3;
        leaf.add(pane);
      }
      if (porthole && s > 0) {
        const pane = new THREE.Mesh(new THREE.CircleGeometry(PORTHOLE.r + 0.02, 32), m.glass);
        pane.name = 'door-porthole-glass';
        pane.position.set(0, PORTHOLE.y - 1.2, 0);
        pane.renderOrder = 3;
        leaf.add(pane);
      }
      const closedX = s * 0.5;
      leaf.position.set(closedX, 1.2, Z);
      leaves.add(leaf);
    }
    // Only the two leaves slide; the jamb status screens added to `leaves` below stay on the jamb.
    const slide = [...leaves.children];
    setOpen = (f) => {
      slide.forEach((leaf, i) => {
        const s = i === 0 ? -1 : 1;
        leaf.position.x = s * (0.5 + f * 0.98);
      });
    };
  }

  // Status screen on both faces of the right jamb.
  const screen = new CanvasScreen(160, 200, (ctx, t, w, h) => drawDoorStatus(ctx, t, w, h, state(), kit), 1.6, 4);
  for (const fz of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), screen.material);
    panel.position.set(1.16, 1.5, Z + fz * 0.316);
    panel.rotation.y = fz > 0 ? 0 : PI;
    leaves.add(panel);
  }
  setOpen(0);

  return {
    frame: pb.build(),
    leaves,
    setOpen,
    closedBox: { min: [-1, 0, Z - 0.14], max: [1, 2.4, Z + 0.14] },
    seeThrough: kit === 'glass_slide',
    porthole,
    travelTime,
    tick: (t) => screen.update(t),
  };
}

function drawDoorStatus(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, state: DoorState, kit: DoorKit): void {
  const color = DOOR_COLORS[state];
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  drawTagMark(ctx, w / 2, 34, 18, { ink: '#9fb7bd', accent: color });
  const blink = Math.floor(t * 1.5) % 2 === 0;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  if (state === 'locked' || state === 'sealed') {
    ctx.strokeStyle = ctx.fillStyle = blink ? color : '#7a1d16';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(w / 2, 86, 20, PI, 0);
    ctx.stroke();
    ctx.fillRect(w / 2 - 30, 84, 60, 40);
  } else if (state === 'jammed') {
    ctx.font = `700 54px ${SCREEN_FONT}`;
    ctx.fillText(blink ? '!' : '', w / 2, 122);
  } else {
    // Chevrons pointing through the door.
    ctx.lineWidth = 7;
    ctx.strokeStyle = color;
    for (let k = 0; k < 2; k++) {
      const y = 76 + k * 26 + ((t * 30) % 26);
      ctx.beginPath();
      ctx.moveTo(w / 2 - 28, y);
      ctx.lineTo(w / 2, y + 16);
      ctx.lineTo(w / 2 + 28, y);
      ctx.stroke();
    }
  }
  ctx.font = `700 24px ${SCREEN_FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(state.toUpperCase(), w / 2, 160);
  ctx.font = `12px ${SCREEN_FONT}`;
  ctx.fillStyle = '#7f9aa0';
  ctx.fillText(kit === 'bulkhead' ? 'BULKHEAD' : kit === 'glass_slide' ? 'GLASS DOOR' : 'PRESSURE DOOR', w / 2, 182);
}

