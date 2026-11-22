import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { excludeFromGtao, skipsAo, type GtaoVisibilityHooks } from './post.ts';

const mesh = (mat: THREE.MeshStandardMaterialParameters, userData: Record<string, unknown> = {}): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(mat));
  Object.assign(m.userData, userData);
  return m;
};

/** Stand-in for three r179+ GTAOPass: hides lines itself and restores only what it hid. */
function stubPass(scene: THREE.Object3D): GtaoVisibilityHooks & { renderGBuffer(): boolean[] } {
  const cache: THREE.Object3D[] = [];
  const pass = {
    _overrideVisibility() {
      scene.traverse((o) => {
        if ((o as THREE.Line).isLine && o.visible) {
          o.visible = false;
          cache.push(o);
        }
      });
    },
    _restoreVisibility() {
      for (const o of cache) o.visible = true;
      cache.length = 0;
    },
    /** Mimics GTAOPass.render: override, draw depth/normals, restore; returns visibility during the draw. */
    renderGBuffer(): boolean[] {
      this._overrideVisibility();
      const during = scene.children.map((c) => c.visible);
      this._restoreVisibility();
      return during;
    },
  };
  return pass;
}

test('skipsAo: transparent, non-depth-writing and skipGtao meshes skip AO; solid meshes and non-meshes do not', () => {
  assert.equal(skipsAo(mesh({})), false);
  assert.equal(skipsAo(mesh({ transparent: true, opacity: 0.16 })), true);
  assert.equal(skipsAo(mesh({ depthWrite: false })), true);
  assert.equal(skipsAo(mesh({}, { skipGtao: true })), true);
  assert.equal(skipsAo(new THREE.Group()), false);
});

test('excludeFromGtao hides AO-excluded meshes during the GTAO depth pass and shows them again after (r179 restore)', () => {
  const scene = new THREE.Scene();
  const solid = mesh({});
  const glass = mesh({ transparent: true, opacity: 0.16, depthWrite: false });
  const shaft = mesh({}, { skipGtao: true });
  const hiddenAlready = mesh({ transparent: true });
  hiddenAlready.visible = false;
  const line = new THREE.Line();
  scene.add(solid, glass, shaft, hiddenAlready, line);

  const pass = stubPass(scene);
  excludeFromGtao(pass, scene);
  for (let frame = 0; frame < 3; frame++) {
    assert.deepEqual(pass.renderGBuffer(), [true, false, false, false, false], 'only the solid mesh is drawn into the AO buffers');
    assert.deepEqual(scene.children.map((c) => c.visible), [true, true, true, false, true], 'after the pass everything is as before');
  }
});

test('excludeFromGtao fails loudly when GTAOPass no longer has the hooks', () => {
  assert.throws(() => excludeFromGtao({} as GtaoVisibilityHooks, new THREE.Scene()), /needs porting/);
});
