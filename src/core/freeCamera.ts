import type { Box3, PerspectiveCamera } from 'three';
import type { Input } from './input.ts';
import type { Settings } from './settings.ts';

const PITCH_LIMIT = (85 * Math.PI) / 180;
/** Radians per pixel at sensitivity 1. */
const LOOK_SCALE = 0.0022;

/**
 * Debug fly camera. Stands in for the player until ADR-0004, then stays as the F1
 * free-fly camera in ?debug.
 */
export class FreeCamera {
  speed = 4;
  sprintMultiplier = 3;
  yaw = 0;
  pitch = 0;
  /** Optional box the camera is kept inside (no collision until ADR-0004). */
  bounds: Box3 | null = null;
  private readonly camera: PerspectiveCamera;
  private readonly input: Input;
  private readonly settings: () => Readonly<Settings>;

  constructor(camera: PerspectiveCamera, input: Input, settings: () => Readonly<Settings>) {
    this.camera = camera;
    this.input = input;
    this.settings = settings;
    camera.rotation.order = 'YXZ';
  }

  /** Per rendered frame, for smooth mouse look. */
  look(): void {
    const { x, y } = this.input.consumeLook();
    const s = this.settings();
    const k = LOOK_SCALE * s.mouseSensitivity;
    this.yaw -= x * k;
    this.pitch -= y * k * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Per fixed simulation step. */
  update(dt: number): void {
    const forward = this.input.axis('moveBack', 'moveForward');
    const strafe = this.input.axis('moveLeft', 'moveRight');
    const vertical = this.input.axis('flyDown', 'flyUp');
    if (!forward && !strafe && !vertical) return;
    const speed = this.speed * (this.input.isDown('sprint') ? this.sprintMultiplier : 1) * dt;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // -Z is forward (ADR-0001 conventions).
    const p = this.camera.position;
    p.x += (-sin * forward + cos * strafe) * speed;
    p.z += (-cos * forward - sin * strafe) * speed;
    p.y += vertical * speed;
    if (this.bounds) p.clamp(this.bounds.min, this.bounds.max);
  }
}
