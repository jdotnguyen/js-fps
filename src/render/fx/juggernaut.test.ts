import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Juggernaut, JUGGERNAUT_URL, loadJuggernaut } from './juggernaut.ts';
import { JUGGERNAUT_DEF } from '../../actors/creature/juggernaut.ts';
import { loadWithoutTextures } from '../../actors/castModelTestKit.ts';

// session-loading "Late-appearing models load with the session" (openspec stop-midgame-shader-stalls D4); the finale's
// creature driven by its rig with its face parts showing (openspec rig-juggernaut D9); its entrance a walk with roars
// (openspec juggernaut-walk-and-roar D6, transit-wing CAM 10 scenarios).

const MODEL = new URL('../../../public/assets/models/infected/monster_juggernaut.glb', import.meta.url);
const model = () => loadWithoutTextures(MODEL);
const anchor = (x: number, yaw = 0) => ({ pos: { x, y: 0, z: 0 }, yaw });
const DT = 1 / 60;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

/** Run until it stands (or `seconds` pass). */
function run(j: Juggernaut, seconds = 12): number {
  let t = 0;
  for (; t < seconds && (t < DT || !j.gait.standing); t += DT) j.update(DT);
  return t;
}

test('its URL is the creature data\'s model', () => {
  assert.equal(JUGGERNAUT_URL, JUGGERNAUT_DEF.model);
});

test('loaded hidden, 5.1 m tall in its exported pose, eyes, teeth and tongue showing', async () => {
  const urls: string[] = [];
  const j = await loadJuggernaut('/base', async (url) => (urls.push(url), { scene: await model() }));
  assert.ok(j);
  assert.deepEqual(urls, [`/base/${JUGGERNAUT_URL}`]);
  assert.equal(j.root.visible, false);
  const all = meshes(j.root);
  assert.equal(all.length, 5);
  for (const m of all) {
    assert.equal(m.visible, true, `${m.name} shows`);
    assert.equal(m.castShadow, true);
  }
  assert.equal(all.filter((m) => (m.material as THREE.Material).name === 'details').length, 4, 'eyes, teeth, tongue, tongue teeth');
  // Its scale: the body measured in the exported pose (limbs off the gait's IK) is 5.1 m.
  for (const s of ['arm.L', 'arm.R', 'leg.L', 'leg.R'] as const) j.rig.setLimbTarget(s, null);
  j.rig.setPose('exported_rest');
  j.rig.update(0);
  j.root.updateMatrixWorld(true);
  const body = all.find((m) => (m.material as THREE.Material).name === 'body') as THREE.SkinnedMesh;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < body.geometry.attributes.position!.count; i++) box.expandByPoint(body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld));
  assert.ok(Math.abs(box.max.y - box.min.y - 5.1) < 1e-3, `height ${(box.max.y - box.min.y).toFixed(4)} m`);
});

test('the reveal walks it from the hide anchor to the peek anchor in about 5.2 s, with a footfall per landing', async () => {
  const j = new Juggernaut(await model());
  const scene = new THREE.Scene();
  scene.add(j.root);
  const falls: string[] = [];
  j.onFootfall = (kind) => falls.push(kind);
  j.reveal(anchor(64.8, 1.66), anchor(68.2, 1.66), new THREE.Vector3(75.2, 1.6, 0));
  assert.equal(j.root.visible, true);
  assert.ok(Math.abs(j.root.position.x - 64.8) < 1e-6 && Math.abs(j.root.position.z) < 1e-6, 'starts at the hide anchor');
  const t = run(j);
  assert.ok(j.gait.standing, 'it ends standing');
  assert.ok(Math.abs(t - 5.2) <= 0.4, `the walk took ${t.toFixed(2)} s`);
  const end = Math.hypot(j.root.position.x - 68.2, j.root.position.z);
  assert.ok(end <= 0.05, `ends ${(end * 100).toFixed(1)} cm from the peek anchor`);
  assert.ok(falls.length >= 8, `${falls.length} footfalls`);
  assert.ok(falls.includes('foot') && falls.includes('hand'));
  const aim = j.aimPoint(new THREE.Vector3())!;
  assert.ok(aim.y > 4, 'aims above the head');
});

test('act plays a roar over its stance: the jaw opens, then it settles', async () => {
  const j = new Juggernaut(await model());
  j.reveal(anchor(0), anchor(0));
  j.act('roar_full');
  let maxJaw = 0;
  for (let t = 0; t < j.acts.duration('roar_full') + 0.1; t += DT) {
    j.update(DT);
    maxJaw = Math.max(maxJaw, j.rig.getFace().jaw);
  }
  assert.ok(maxJaw > 0.99, 'the jaw opens fully');
  assert.equal(j.acts.finished, true);
  assert.ok(j.rig.getFace().jaw < 0.5, 'it settles');
});

test('the reveal and the acts create no object, material or geometry', async () => {
  const j = new Juggernaut(await model());
  const scene = new THREE.Scene();
  scene.add(j.root);
  const parts = (): unknown[] => {
    const out: unknown[] = [];
    scene.traverse((o) => out.push(o, (o as THREE.Mesh).material, (o as THREE.Mesh).geometry));
    return out;
  };
  const before = parts();
  j.reveal(anchor(2), anchor(6));
  j.act('roar_walk');
  run(j);
  j.act('roar_full');
  run(j, 7);
  assert.deepEqual(parts(), before);
  j.hide();
  assert.equal(j.root.visible, false);
  j.reveal(null, null);
  assert.ok(Math.abs(j.root.position.x - 2) < 1e-6, 'without anchors it starts where it was told before');
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

test('dispose releases geometry, materials and skeletons and leaves the scene', async () => {
  const j = new Juggernaut(await model());
  const scene = new THREE.Scene();
  scene.add(j.root);
  const disposed = new Set<unknown>();
  const all = meshes(j.root);
  for (const m of all) {
    m.geometry.addEventListener('dispose', () => disposed.add(m.geometry));
    (m.material as THREE.Material).addEventListener('dispose', () => disposed.add(m.material));
  }
  j.dispose();
  for (const m of all) {
    assert.ok(disposed.has(m.geometry), `${m.name} geometry`);
    assert.ok(disposed.has(m.material), `${m.name} material`);
  }
  assert.equal(j.root.parent, null);
});
