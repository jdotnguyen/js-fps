import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadWeaponModels, type ClipName, type GlbWeapon, type PlayOptions } from './glbWeapons.ts';
import type { WeaponId } from './rig.ts';

/**
 * ?vmlab: a bare turntable for the imported weapon viewmodels (no game, no post) with a scriptable
 * camera, so models and animation clips can be inspected from any angle. Drive it from the console
 * through `window.vmlab`.
 */
export interface Lab {
  show(id: WeaponId): GlbWeapon;
  play(clip: ClipName, opts?: PlayOptions): void;
  cam(px: number, py: number, pz: number, tx?: number, ty?: number, tz?: number, fov?: number): void;
  weapon: GlbWeapon | null;
  /** Slice everything above this height (metres), or null to clear. */
  clip(y: number | null): void;
}

declare global {
  interface Window {
    vmlab?: Lab;
  }
}

export async function runLab(renderer: THREE.WebGLRenderer): Promise<void> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151b20);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xfff0e0, 4.2);
  key.position.set(-0.6, 1, 0.8);
  const rim = new THREE.DirectionalLight(0x8fc8ff, 1.4);
  rim.position.set(0.8, 0.4, -1);
  const fill = new THREE.HemisphereLight(0x8899aa, 0x201a16, 0.5);
  scene.add(key, rim, fill);

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 20);
  const t0 = performance.now();
  const weapons = await loadWeaponModels();
  console.info(`[vmlab] loaded weapon GLBs in ${(performance.now() - t0).toFixed(0)} ms`);

  let active: GlbWeapon | null = null;
  const lab: Lab = {
    weapon: null,
    clip(y) {
      renderer.clippingPlanes = y === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)];
    },
    show(id) {
      if (active) scene.remove(active.root);
      active = weapons[id];
      scene.add(active.root);
      lab.weapon = active;
      return active;
    },
    play(clip, opts) {
      active?.play(clip, opts);
    },
    cam(px, py, pz, tx = 0, ty = 0, tz = 0, fov = 40) {
      camera.position.set(px, py, pz);
      camera.lookAt(tx, ty, tz);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
  window.vmlab = lab;
  lab.show('pistol');
  lab.cam(0.35, 0.12, 0.3, 0, -0.02, 0);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    active?.update(dt);
    renderer.render(scene, camera);
  });
}
