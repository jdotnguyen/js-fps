import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Juggernaut, JUGGERNAUT_URL, loadJuggernaut } from './juggernaut.ts';

// session-loading "Late-appearing models load with the session" (openspec stop-midgame-shader-stalls D4).

function model() {
  const scene = new THREE.Group();
  const map = new THREE.Texture();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), new THREE.MeshStandardMaterial({ name: 'body', map }));
  body.position.y = 5;
  const details = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'details' }));
  details.position.y = 900;
  const head = new THREE.Object3D();
  head.name = 'head_ik_094';
  head.position.y = 9;
  scene.add(body, details, head);
  const disposed: string[] = [];
  const track = (name: string, o: THREE.EventDispatcher<{ dispose: object }>): void => o.addEventListener('dispose', () => disposed.push(name));
  track('geometry', body.geometry);
  track('material', body.material);
  track('map', map);
  track('details', details.material);
  return { scene, body, details, disposed };
}

const anchor = (x: number, yaw = 0) => ({ pos: { x, y: 1, z: 0 }, yaw });

test('loaded hidden, at its height, with the stray detail meshes off', async () => {
  const m = model();
  const urls: string[] = [];
  const j = await loadJuggernaut('/base', async (url) => (urls.push(url), { scene: m.scene }));
  assert.ok(j);
  assert.deepEqual(urls, [`/base/${JUGGERNAUT_URL}`]);
  assert.equal(j.root.visible, false);
  assert.equal(m.details.visible, false);
  assert.equal(m.body.castShadow, true);
  j.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.body);
  assert.ok(Math.abs(box.max.y - box.min.y - 5.1) < 1e-6);
  assert.ok(Math.abs(box.min.y) < 1e-6, 'standing on its root');
});

test('the reveal only shows and places it: no new object, material or geometry', () => {
  const m = model();
  const j = new Juggernaut(m.scene);
  const scene = new THREE.Scene();
  scene.add(j.root);
  const parts = (): unknown[] => {
    const out: unknown[] = [];
    scene.traverse((o) => out.push(o, (o as THREE.Mesh).material, (o as THREE.Mesh).geometry));
    return out;
  };
  const before = parts();
  j.reveal(anchor(2), anchor(6, 1.5));
  assert.equal(j.root.visible, true);
  assert.deepEqual(j.root.position.toArray(), [2, 1, 0]);
  assert.equal(j.root.rotation.y, 1.5);
  j.update(2.6);
  assert.ok(Math.abs(j.root.position.x - 4) < 1e-6, 'half way, eased');
  j.update(10);
  assert.equal(j.root.position.x, 6);
  const aim = j.aimPoint(new THREE.Vector3())!;
  assert.ok(aim.y > j.root.position.y + 4, 'above the head');
  assert.deepEqual(parts(), before);

  j.hide();
  assert.equal(j.root.visible, false);
  j.reveal(null, null);
  assert.deepEqual(j.root.position.toArray(), [2, 1, 0], 'without anchors it comes back where it was told before');
});

test('a model that cannot be loaded warns by name and gives null', async (t) => {
  const warned: string[] = [];
  t.mock.method(console, 'warn', (msg: string) => void warned.push(msg));
  const j = await loadJuggernaut('/', async () => {
    throw new Error('404');
  });
  assert.equal(j, null);
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /monster_juggernaut\.glb/);
});

test('dispose releases geometry, materials and textures and leaves the scene', () => {
  const m = model();
  const j = new Juggernaut(m.scene);
  const scene = new THREE.Scene();
  scene.add(j.root);
  j.dispose();
  assert.deepEqual(m.disposed.sort(), ['details', 'geometry', 'map', 'material']);
  assert.equal(j.root.parent, null);
});
