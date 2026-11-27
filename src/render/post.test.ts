import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HitMarks } from './hitMarks.ts';
import { AoSplit, createGradeEffect, setHitMarks, skipsAo } from './post.ts';

const mesh = (mat: THREE.MeshStandardMaterialParameters, userData: Record<string, unknown> = {}): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(mat));
  Object.assign(m.userData, userData);
  return m;
};

/** Whether the renderer would draw `obj` for the default camera: visible up the chain and on layer 0. */
function drawn(obj: THREE.Object3D, camera: THREE.Camera): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return obj.layers.test(camera.layers);
}

test('skipsAo: transparent, non-depth-writing and skipGtao meshes skip AO; solid meshes and non-meshes do not', () => {
  assert.equal(skipsAo(mesh({})), false);
  assert.equal(skipsAo(mesh({ transparent: true, opacity: 0.16 })), true);
  assert.equal(skipsAo(mesh({ depthWrite: false })), true);
  assert.equal(skipsAo(mesh({}, { skipGtao: true })), true);
  assert.equal(skipsAo(new THREE.Group()), false);
});

test('AoSplit draws solid meshes in the AO render and transparent, non-depth-writing and skipGtao meshes only in the second', () => {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const solid = mesh({});
  const glass = mesh({ transparent: true, opacity: 0.16, depthWrite: false });
  const decal = mesh({ depthWrite: false });
  const shaft = mesh({}, { skipGtao: true });
  const dust = new THREE.Points();
  const door = mesh({});
  const doorSign = mesh({ transparent: true }); // an excluded child of a solid mesh
  door.add(doorSign);
  const pane = mesh({ transparent: true });
  const frame = mesh({}); // a solid child of an excluded mesh
  pane.add(frame);
  const hidden = mesh({});
  hidden.visible = false;
  const light = new THREE.PointLight();
  scene.add(solid, glass, decal, shaft, dust, door, pane, hidden, light);
  const aoScene = [solid, door, frame];
  const afterAo = [glass, decal, shaft, dust, doorSign, pane];
  const all = [...aoScene, ...afterAo, hidden, light];
  const masks = all.map((o) => o.layers.mask);

  const split = new AoSplit();
  for (let frame = 0; frame < 3; frame++) {
    split.beginAoScene(scene);
    assert.deepEqual(aoScene.map((o) => drawn(o, camera)), [true, true, true], 'AO render: solid geometry');
    assert.deepEqual(afterAo.map((o) => drawn(o, camera)), afterAo.map(() => false), 'AO render: nothing see-through');
    assert.equal(drawn(light, camera), true, 'lights stay in the AO render');

    split.beginAfterAo();
    assert.deepEqual(aoScene.map((o) => drawn(o, camera)), [false, false, false], 'second render: no solid geometry');
    assert.deepEqual(afterAo.map((o) => drawn(o, camera)), afterAo.map(() => true), 'second render: every excluded mesh');
    assert.equal(drawn(light, camera), true, 'lights stay in the second render');
    assert.equal(drawn(hidden, camera), false);

    split.end();
    assert.deepEqual(all.map((o) => o.layers.mask), masks, 'every layer mask is restored');
  }
});

test('the grade effect uses the uniform objects post.grade hands out', () => {
  const { effect, grade } = createGradeEffect();
  for (const name of ['uGrain', 'uVignette', 'uAberration', 'uLift', 'uGain', 'uDamage', 'uHitFlash', 'uHitDir', 'uMarks', 'uMarkRect', 'uMarkPlace', 'uMarkState', 'uTime', 'uResolution'] as const) {
    assert.equal(effect.uniforms.get(name), grade[name], name);
  }
  grade.uGrain.value = 0;
  grade.uDamage.value = 0.8;
  assert.equal(effect.uniforms.get('uGrain')!.value, 0);
  assert.equal(effect.uniforms.get('uDamage')!.value, 0.8);
});

test('the grade is handed the live claw marks and nothing for an empty slot', () => {
  const { grade } = createGradeEffect();
  const marks = new HitMarks(() => 0.5);
  marks.add({ kind: 'swipe', side: 'R', dir: { x: 1, y: 0 }, severity: 1 }, 16 / 9);
  marks.update(0.2);
  setHitMarks(grade, marks);
  assert.deepEqual(grade.uMarkState.value[0]!.toArray(), [1, 1]);
  assert.ok(grade.uMarkRect.value[0]!.z < 0, 'mirrored for the right');
  assert.ok(grade.uMarkPlace.value[0]!.x > 2 / 3);
  assert.equal(grade.uMarkState.value[1]!.y, 0);
  setHitMarks(grade, null);
  assert.equal(grade.uMarkState.value[0]!.y, 0, 'cleared');
});

test('eye adaptation: the grade reads the adaptation uniforms, and the setting switches only the uniform', () => {
  const { effect, grade } = createGradeEffect();
  for (const name of ['uAdaptState', 'uAdaptKey', 'uAdaptOn'] as const) assert.equal(effect.uniforms.get(name), grade[name], name);
  assert.equal(grade.uAdaptOn.value, 1, 'on by default');
  assert.match(effect.getFragmentShader(), /col \*= mix\(1\.0, adaptMul, uAdaptOn\)/, 'off forces a multiplier of 1.0');
  assert.match(effect.getFragmentShader(), /clamp\(uAdaptKey \/ exp2\(texture2D\(uAdaptState, vec2\(0\.5\)\)\.r\), 0\.7, 1\.6\)/, 'capped 0.7 to 1.6');
  const before = effect.getFragmentShader();
  grade.uAdaptOn.value = 0;
  assert.equal(effect.uniforms.get('uAdaptOn')!.value, 0);
  assert.equal(effect.getFragmentShader(), before, 'no shader change, so no rebuild');
});
