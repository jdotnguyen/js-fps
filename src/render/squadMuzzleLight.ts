import * as THREE from 'three';
import { MUZZLE_FLASH_TIME } from '../actors/squadPistol.ts';

/**
 * The light of the squad's muzzle flashes (squad-sidearms D7): one point light shared by Giles and Okafor, as warm and as strong as
 * Jay's pistol flash, that lights the room around the muzzle for MUZZLE_FLASH_TIME after each squad shot and fades out. A newer shot
 * takes it over (two mates' 55 ms flashes rarely overlap; both still show their flash sprite). It stays in the scene at zero
 * intensity between shots, so the scene's light count, which every material's program is keyed by, never changes, and room
 * captures borrow it like the player's own lights. No shadow.
 */

/** Peak intensity, colour and reach: the same as Jay's pistol flash (viewmodel.ts). */
export const SQUAD_FLASH_LIGHT = { intensity: 6, color: 0xffb060, distance: 7, decay: 2 } as const;
/** The light sits this far in front of the muzzle (m), so it is never inside the gun or the hand. */
export const FLASH_AHEAD = 0.06;

export class SquadMuzzleLight {
  readonly light: THREE.PointLight;
  private t = Infinity;
  private peak: number = SQUAD_FLASH_LIGHT.intensity;
  private duration: number = MUZZLE_FLASH_TIME;

  constructor(parent: THREE.Object3D) {
    this.light = new THREE.PointLight(SQUAD_FLASH_LIGHT.color, 0, SQUAD_FLASH_LIGHT.distance, SQUAD_FLASH_LIGHT.decay);
    this.light.name = 'squad_muzzle_light';
    this.light.castShadow = false;
    parent.add(this.light);
  }

  /** A squad shot: light at the muzzle (world), a little way along the bore `dir` (world, unit) when given. */
  fire(muzzle: { x: number; y: number; z: number }, dir?: { x: number; y: number; z: number }, boost = 1): void {
    this.light.position.set(muzzle.x, muzzle.y, muzzle.z);
    if (dir) this.light.position.add(new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(FLASH_AHEAD));
    if (this.light.parent) this.light.parent.worldToLocal(this.light.position);
    this.t = 0;
    const scale = Math.max(1, boost);
    this.peak = SQUAD_FLASH_LIGHT.intensity * scale;
    this.duration = scale > 1 ? MUZZLE_FLASH_TIME * 2.2 : MUZZLE_FLASH_TIME;
    this.light.distance = scale > 1 ? 18 : SQUAD_FLASH_LIGHT.distance;
    this.light.intensity = this.peak;
  }

  /** Fade the flash: full at the shot, down to zero over `duration`. */
  update(dt: number): void {
    if (this.t === Infinity) return;
    this.t += Math.max(0, dt);
    if (this.t >= this.duration) {
      this.t = Infinity;
      this.light.intensity = 0;
      return;
    }
    this.light.intensity = this.peak * (1 - this.t / this.duration);
  }

  /** Is the light lit right now (tests)? */
  get lit(): boolean {
    return this.light.intensity > 0;
  }

  dispose(): void {
    this.light.removeFromParent();
    this.light.dispose();
  }
}
