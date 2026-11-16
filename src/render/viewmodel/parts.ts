import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  brushedNormalMap,
  fabricNormalMap,
  stippleNormalMap,
} from './detailMaps.ts';
import { SCREEN_FONT } from '../screens.ts';

/**
 * Weapon-space convention: +X right, +Y up, -Z toward the muzzle (same as camera space).
 * Profiles are drawn as (forward, up) pairs where forward = -Z.
 */

export interface WeaponMaterials {
  slide: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  grip: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  shell: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  cyan: THREE.MeshStandardMaterial;
  label: THREE.MeshBasicMaterial;
}

function tiled(tex: THREE.Texture, x: number, y: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(x, y);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function labelTexture(lines: string[], w = 512, h = 96): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#c9d1d6';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(h * 0.34)}px ${SCREEN_FONT}`;
  const lh = h / (lines.length + 0.4);
  lines.forEach((l, i) => ctx.fillText(l, 10, lh * (i + 0.85)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createWeaponMaterials(): WeaponMaterials {
  const brushed = brushedNormalMap();
  const stipple = stippleNormalMap();
  const fabric = fabricNormalMap();
  return {
    slide: new THREE.MeshStandardMaterial({
      color: 0x30363c, metalness: 0.88, roughness: 0.4,
      normalMap: tiled(brushed, 3, 1), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0x9aa1a6, metalness: 1, roughness: 0.28,
      normalMap: tiled(brushed, 2, 1), normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.4,
    }),
    polymer: new THREE.MeshStandardMaterial({
      color: 0x16191c, metalness: 0.05, roughness: 0.7,
      normalMap: tiled(fabric, 1.5, 1.5), normalScale: new THREE.Vector2(0.18, 0.18),
    }),
    grip: new THREE.MeshStandardMaterial({
      color: 0x131518, metalness: 0.02, roughness: 0.82,
      normalMap: tiled(stipple, 3, 4), normalScale: new THREE.Vector2(0.9, 0.9),
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x0d0e10, metalness: 0, roughness: 0.86,
      normalMap: tiled(stipple, 5, 2), normalScale: new THREE.Vector2(0.7, 0.7),
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x060708, metalness: 0.4, roughness: 0.5 }),
    paint: new THREE.MeshStandardMaterial({
      color: 0x23282d, metalness: 0.55, roughness: 0.58,
      normalMap: tiled(fabric, 2, 2), normalScale: new THREE.Vector2(0.12, 0.12),
    }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 1, roughness: 0.32 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x8a1f1a, metalness: 0.05, roughness: 0.55 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0a1114, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55,
      clearcoat: 1, clearcoatRoughness: 0.04,
    }),
    cyan: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2fd3ff, emissiveIntensity: 2.4, roughness: 0.3 }),
    label: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
}

export function rbox(w: number, h: number, d: number, r = 0.002): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
}

/** Cylinder along Z. */
export function cylZ(r: number, len: number, radial = 24, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, len, radial, 1, false); // r at +Y (becomes +Z, the rear)
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Side profile extruded across X. Points are (forward, up); the result is centred on x = 0
 * with total width `width` and softened edges.
 */
export function extrudeProfile(points: Array<[number, number]>, width: number, bevel = 0.002): THREE.BufferGeometry {
  const s = new THREE.Shape();
  points.forEach(([a, y], i) => (i === 0 ? s.moveTo(a, y) : s.lineTo(a, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.0005, width - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape x (forward) -> -Z, extrusion z -> +X
  return g;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name = ''): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** On-gun emissive readout; redraws only when its text changes (ADR-0005). */
export class AmmoScreen {
  readonly material: THREE.MeshStandardMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private last = '';

  private readonly kind: string;

  constructor(kind: string) {
    this.kind = kind;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 128;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: this.texture, emissiveIntensity: 1.5, roughness: 0.25,
    });
    this.set(12, 36);
  }

  set(mag: number, reserve: number): void {
    const key = `${this.kind}:${mag}:${reserve}`;
    if (key === this.last) return;
    this.last = key;
    const { ctx, canvas } = this;
    const low = mag <= 3;
    const col = low ? '#ff5a4a' : '#2fd3ff';
    ctx.fillStyle = '#02080a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 84px ${SCREEN_FONT}`;
    ctx.fillText(String(mag).padStart(2, '0'), canvas.width / 2, 86);
    ctx.globalAlpha = 0.75;
    ctx.font = `600 28px ${SCREEN_FONT}`;
    ctx.fillText(`/ ${String(reserve).padStart(2, '0')}`, canvas.width / 2, 118);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < canvas.height; y += 3) ctx.fillRect(0, y, canvas.width, 1);
    this.texture.needsUpdate = true;
  }
}
