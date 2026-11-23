import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hemisphereAverage, normaliseProbe, probeAverage, projectCubeSh } from './roomLightProbe.ts';

// openspec change room-light-response, design D5 (environment-lighting spec "Room-coloured bounce light").

const SIZE = 16;
const WARM: [number, number, number] = [1.0, 0.6, 0.25];
const COOL: [number, number, number] = [0.2, 0.4, 1.0];
const GREY: [number, number, number] = [0.1, 0.1, 0.1];

/** Faces in WebGL order +X −X +Y −Y +Z −Z, each one flat colour. */
function cube(colours: Array<[number, number, number]>): Float32Array[] {
  return colours.map(([r, g, b]) => {
    const f = new Float32Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) f.set([r, g, b, 1], i * 4);
    return f;
  });
}

const irradianceAt = (sh: THREE.SphericalHarmonics3, dir: THREE.Vector3): THREE.Vector3 => sh.getIrradianceAt(dir.normalize(), new THREE.Vector3());
/** Warmth: red over blue. */
const warmth = (c: THREE.Vector3): number => c.x / Math.max(c.z, 1e-6);

test('a cube warm on +X and cool on −X projects to a warm +X lobe and a cool −X one', () => {
  // The renderer reads faces back in WebGL order; three flips X for the WebGL coordinate system, so the face index 0
  // texels map to the world direction the capture camera for +X looked along.
  const sh = projectCubeSh(cube([WARM, COOL, GREY, GREY, GREY, GREY]), SIZE, -1);
  const px = irradianceAt(sh, new THREE.Vector3(1, 0, 0));
  const nx = irradianceAt(sh, new THREE.Vector3(-1, 0, 0));
  const up = irradianceAt(sh, new THREE.Vector3(0, 1, 0));
  assert.ok(warmth(px) > 1.5, `+X is warm (${px.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(warmth(nx) < 0.7, `−X is cool (${nx.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(px.x > nx.x && nx.z > px.z);
  assert.ok(warmth(up) < warmth(px) && warmth(up) > warmth(nx), 'in between straight up');
});

test('the projection matches three’s LightProbeGenerator on a uniform cube (L0 only, radiance × π irradiance)', () => {
  const sh = projectCubeSh(cube(Array(6).fill([0.5, 0.5, 0.5])), SIZE, -1);
  const e = irradianceAt(sh, new THREE.Vector3(0, 0, 1));
  // A uniform radiance L gives irradiance πL in three's convention.
  assert.ok(Math.abs(e.x - Math.PI * 0.5) < 0.02, `irradiance ${e.x}`);
  for (let j = 1; j < 9; j++) assert.ok(sh.coefficients[j]!.length() < 1e-3, `band ${j} is empty`);
});

const preset = (sky: number, ground: number, intensity: number) => ({ sky: new THREE.Color(sky), ground: new THREE.Color(ground), intensity });

test('normalising keeps the probe at w of the preset’s average, whatever the capture’s brightness', () => {
  const gallery = preset(0x9ea6ab, 0x0d0f11, 0.12);
  for (const scale of [0.01, 1, 40]) {
    const raw = projectCubeSh(cube([WARM, COOL, GREY, GREY, GREY, GREY].map((c) => c.map((v) => v * scale) as [number, number, number])), SIZE, -1);
    const out = normaliseProbe(raw, gallery, 0.6, new THREE.SphericalHarmonics3());
    const want = 0.6 * hemisphereAverage(gallery);
    assert.ok(Math.abs(probeAverage(out) - want) / want < 1e-6, `scale ${scale}`);
    assert.ok(warmth(irradianceAt(out, new THREE.Vector3(1, 0, 0))) > 1.5, 'and keeps the capture’s colour and direction');
  }
});

test('a black capture gives a flat probe in the preset’s colours at the same strength', () => {
  const backup = preset(0x3a3630, 0x040404, 0.06);
  const raw = projectCubeSh(cube(Array(6).fill([0, 0, 0])), SIZE, -1);
  const out = normaliseProbe(raw, backup, 0.6, new THREE.SphericalHarmonics3());
  const want = 0.6 * hemisphereAverage(backup);
  assert.ok(Math.abs(probeAverage(out) - want) / want < 1e-6);
  for (let j = 1; j < 9; j++) assert.equal(out.coefficients[j]!.length(), 0);
});
