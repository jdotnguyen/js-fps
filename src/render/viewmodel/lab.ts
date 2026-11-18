import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createHandMaterials, type HandPose } from './hand.ts';
import { createWeaponMaterials } from './parts.ts';
import { buildPistol, type PistolOptions } from './pistol.ts';
import { buildShotgun, type ShotgunOptions } from './shotgun.ts';
import { basisPlacement, elbowBend, type Placement, type WeaponRig } from './rig.ts';

/**
 * ?vmlab: a bare turntable for the viewmodels (no game, no post) with a scriptable camera,
 * so hand poses and weapon parts can be inspected from any angle. Drive it from the console
 * through `window.vmlab`.
 */
export interface Lab {
  show(id: 'pistol' | 'shotgun', opts?: PistolOptions & ShotgunOptions): WeaponRig;
  cam(px: number, py: number, pz: number, tx?: number, ty?: number, tz?: number, fov?: number): void;
  rig: WeaponRig | null;
  basis: typeof basisPlacement;
  elbow: typeof elbowBend;
  /** Slice everything above this height (metres), or null to clear. */
  clip(y: number | null): void;
  place(hand: 'left' | 'right', p: Placement): void;
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
  const wm = createWeaponMaterials();
  const hm = createHandMaterials();
  let rig: WeaponRig | null = null;
  const lab: Lab = {
    rig: null,
    basis: basisPlacement,
    elbow: elbowBend,
    clip(y) {
      renderer.clippingPlanes = y === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)];
    },
    place(hand, p) {
      const g = rig?.root.getObjectByName(hand === 'right' ? 'hand-right' : 'hand-left');
      if (!g) return;
      g.position.set(...p.pos);
      g.rotation.set(...p.rot);
    },
    show(id, opts) {
      if (rig) scene.remove(rig.root);
      const t0 = performance.now();
      rig = id === 'pistol' ? buildPistol(wm, hm, opts) : buildShotgun(wm, hm, opts);
      console.info(`[vmlab] built ${rig.id} in ${(performance.now() - t0).toFixed(0)} ms`);
      scene.add(rig.root);
      lab.rig = rig;
      return rig;
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
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

export type { HandPose };
