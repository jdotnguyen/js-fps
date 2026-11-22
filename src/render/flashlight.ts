import * as THREE from 'three';

/**
 * Player flashlight (ADR-0004): a shadow-casting spot that trails the view slightly
 * through a spring, so the beam feels hand-held. Toggling changes intensity only
 * (hiding a light would recompile materials).
 */
export class Flashlight {
  readonly light: THREE.SpotLight;
  intensity = 70;
  /** Off at the start: the first dark area teaches the key (ADR-0025). */
  on = false;
  stiffness = 40;
  damping = 8;
  private readonly camera: THREE.Camera;
  private readonly dir = new THREE.Vector3(0, 0, -1);
  private readonly vel = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private level = 0;
  /** The held model's lens in world space while it is up (player-flashlight spec), else null: the beam leaves the chest. */
  origin: THREE.Vector3 | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.camera = camera;
    this.light = new THREE.SpotLight(0xfff1dc, this.intensity, 24, THREE.MathUtils.degToRad(26), 0.55, 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.02;
    this.light.shadow.camera.near = 0.1;
    scene.add(this.light, this.light.target);
    camera.getWorldDirection(this.dir);
  }

  /** The beam's current brightness, 0..1 (the fade included), for the lens glow. */
  get brightness(): number {
    return this.level;
  }

  toggle(): void {
    this.on = !this.on;
  }

  update(dt: number): void {
    const step = Math.min(dt, 1 / 30);
    this.camera.getWorldDirection(this.tmp);
    // Spring the beam direction toward the view direction.
    this.vel.addScaledVector(this.tmp.sub(this.dir), this.stiffness * step);
    this.vel.multiplyScalar(Math.max(0, 1 - this.damping * step));
    this.dir.addScaledVector(this.vel, step).normalize();

    // Carried at the left of the chest: low and to the left, so it never glares on a right-hand weapon.
    if (this.origin) {
      this.light.position.copy(this.origin);
    } else {
      this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.light.position.copy(this.camera.position).addScaledVector(this.right, -0.22);
      this.light.position.y -= 0.32;
    }
    this.light.target.position.copy(this.light.position).addScaledVector(this.dir, 6);

    // Short fade instead of a hard snap when toggling.
    const goal = this.on ? 1 : 0;
    this.level += (goal - this.level) * Math.min(1, step * 18);
    this.light.intensity = this.intensity * this.level;
    // Skip shadow-map rendering while off without toggling castShadow (which recompiles materials).
    this.light.shadow.autoUpdate = this.level > 0.001;
  }
}
