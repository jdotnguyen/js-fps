import * as THREE from 'three';

export type ScreenDraw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

/** An emissive canvas screen (consoles, door panels, the gun's ammo readout later). */
export class CanvasScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshStandardMaterial;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly draw: ScreenDraw;
  private readonly interval: number;
  private next = 0;

  constructor(width: number, height: number, draw: ScreenDraw, emissiveIntensity = 1.6, fps = 8) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.draw = draw;
    this.interval = 1 / fps;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: this.texture,
      emissiveIntensity,
      roughness: 0.25,
      metalness: 0,
    });
    this.redraw(0);
  }

  update(t: number): void {
    if (t < this.next) return;
    this.next = t + this.interval;
    this.redraw(t);
  }

  private redraw(t: number): void {
    const { width: w, height: h } = this.canvas;
    this.ctx.save();
    this.draw(this.ctx, t, w, h);
    this.ctx.restore();
    // CRT scanlines
    this.ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < h; y += 3) this.ctx.fillRect(0, y, w, 1);
    this.texture.needsUpdate = true;
  }
}

/** Shared monospace font stack for screens. */
export const SCREEN_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
