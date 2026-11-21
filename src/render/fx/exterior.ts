import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng.ts';
import { EXTERIOR_GLSL, applyExterior, createWaterDome, exteriorUniforms, packLamps, type ExteriorLamp } from './exteriorLight.ts';
import { createSeabed, type Seabed } from './seabed.ts';

/**
 * Everything outside the station, built once per level (openspec change overhaul-exterior-ocean,
 * spec exterior-ocean): the water dome, the seabed and its rocks, the legs the station stands on,
 * and the hull floodlights at the real windows. Window tiles only leave `ocean-zone` markers; this
 * module turns the markers into lamp runs, so lamp spacing follows the glass, not the 4 m tile.
 */

/** A real window tile, from its `ocean-zone` marker: frame at the glass centre, +X along it, -Z out. */
export interface ExteriorWindow {
  room: string;
  matrix: THREE.Matrix4;
  width: number;
  flicker: boolean;
}

/** An occupied hull grid column (exteriorHull.ts). */
export interface ExteriorColumn {
  gx: number;
  gz: number;
  x: number;
  z: number;
  bottom: number;
}

export interface Floodlight extends ExteriorLamp {
  room: string;
  flicker: boolean;
  /** Nominal intensity; `intensity` is this times the current flicker level. */
  base: number;
}

export interface Exterior {
  group: THREE.Group;
  floodlights: readonly Floodlight[];
  seabed: Seabed;
  /** Per frame: show or hide everything, follow the camera, flicker, and pack the lamp uniforms. */
  update(t: number, eye: THREE.Vector3, visible: boolean, reducedFlashing: boolean, extraLamps?: readonly ExteriorLamp[]): void;
}

const CELL = 4;
const HALF = CELL / 2;
/** Glass metres per floodlight. */
export const LAMP_SPACING = 7;
const LAMP_DOWN = THREE.MathUtils.degToRad(43);
const LAMP_OUTER = THREE.MathUtils.degToRad(32);
const LAMP_INNER = THREE.MathUtils.degToRad(18);
const LAMP_RANGE = 18;
const LAMP_INTENSITY = 30;
const LAMP_COLOR = 0xfff1d0;
/** Lamp mount relative to the window centre: above the head, out past the hull skin. */
const LAMP_UP = 1.3;
const LAMP_OUT = 0.55;
const MARGIN = 45;

export function lampCount(runLength: number): number {
  return Math.max(1, Math.round(runLength / LAMP_SPACING));
}

export interface WindowRun {
  room: string;
  start: number;
  end: number;
  right: THREE.Vector3;
  out: THREE.Vector3;
  /** The wall line's point at s = 0, at window-centre height. */
  origin: THREE.Vector3;
  flicker: boolean;
}

/** Group window tiles into runs of adjacent glass on one wall of one room. */
export function windowRuns(windows: readonly ExteriorWindow[]): WindowRun[] {
  type Item = { w: ExteriorWindow; c: THREE.Vector3; right: THREE.Vector3; out: THREE.Vector3; s: number };
  const groups = new Map<string, Item[]>();
  for (const w of windows) {
    const c = new THREE.Vector3().setFromMatrixPosition(w.matrix);
    const right = new THREE.Vector3().setFromMatrixColumn(w.matrix, 0).normalize();
    const out = new THREE.Vector3().setFromMatrixColumn(w.matrix, 2).normalize().negate();
    const key = `${w.room}|${Math.round(out.x)},${Math.round(out.z)}|${Math.round(c.dot(out) * 10)}|${Math.round(c.y * 10)}`;
    const list = groups.get(key) ?? [];
    list.push({ w, c, right, out, s: c.dot(right) });
    groups.set(key, list);
  }
  const runs: WindowRun[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.s - b.s);
    let cur: WindowRun | null = null;
    for (const it of list) {
      const a = it.s - it.w.width / 2;
      const b = it.s + it.w.width / 2;
      if (cur && a - cur.end <= 0.6) {
        cur.end = Math.max(cur.end, b);
        cur.flicker ||= it.w.flicker;
        continue;
      }
      cur = { room: it.w.room, start: a, end: b, right: it.right, out: it.out, origin: it.c.clone().addScaledVector(it.right, -it.s), flicker: it.w.flicker };
      runs.push(cur);
    }
  }
  return runs;
}

/** Floodlights for the runs: `lampCount` per run, evenly spaced; the first lamp of a flicker run flickers. */
export function placeFloodlights(runs: readonly WindowRun[]): Floodlight[] {
  const lamps: Floodlight[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const run of runs) {
    const len = run.end - run.start;
    const n = lampCount(len);
    for (let i = 0; i < n; i++) {
      const s = run.start + ((i + 0.5) * len) / n;
      const position = run.origin.clone().addScaledVector(run.right, s).addScaledVector(up, LAMP_UP).addScaledVector(run.out, LAMP_OUT);
      const direction = run.out.clone().multiplyScalar(Math.cos(LAMP_DOWN)).addScaledVector(up, -Math.sin(LAMP_DOWN)).normalize();
      lamps.push({
        room: run.room,
        flicker: run.flicker && i === 0,
        position,
        direction,
        color: new THREE.Color(LAMP_COLOR),
        base: LAMP_INTENSITY,
        intensity: LAMP_INTENSITY,
        range: LAMP_RANGE,
        inner: LAMP_INNER,
        outer: LAMP_OUTER,
      });
    }
  }
  return lamps;
}

/** Legs under the hull: a checkerboard of column centres, so every wing, corridors too, stands on some. */
export function legColumns(columns: readonly ExteriorColumn[]): ExteriorColumn[] {
  return columns.filter((c) => (((c.gx + c.gz) % 2) + 2) % 2 === 0);
}

function footprintDistance(columns: readonly ExteriorColumn[]): (x: number, z: number) => number {
  return (x, z) => {
    let best = Infinity;
    for (const c of columns) {
      const dx = Math.max(0, Math.abs(x - c.x) - HALF);
      const dz = Math.max(0, Math.abs(z - c.z) - HALF);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
      if (best === 0) return 0;
    }
    return Math.sqrt(best);
  };
}

const BEAM_VERT = /* glsl */ `
  attribute float aAlong;
  varying float vAlong;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vAlong = aAlong;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  varying float vAlong;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  ${EXTERIOR_GLSL}
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    // Soft edges: brightest where the cone is seen face-on, fading at its silhouette.
    float face = pow(abs(dot(normalize(vNormalW), view)), 1.6);
    float body = pow(1.0 - vAlong, 1.4) * smoothstep(0.0, 0.06, vAlong);
    // Marine snow drifting down through the light.
    vec3 sp = vWorld * 9.0 + vec3(sin(uTime * 0.2) * 2.0, uTime * 1.1, 0.0);
    float snow = step(0.992, h3(floor(sp))) * (0.6 + 0.4 * sin(uTime * 3.0 + h3(floor(sp) + 1.0) * 20.0));
    vec3 col = vec3(1.0, 0.95, 0.82) * (0.035 * face * body + snow * 0.5 * body);
    col *= uLevel * (1.0 - waterFog(length(vWorld - cameraPosition)));
    gl_FragColor = vec4(col, 1.0);
  }`;

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...exteriorUniforms, uTime: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** Open cone from the lamp (apex) along `direction`; `aAlong` is 0 at the lamp and 1 at the far end. */
function beamGeometry(lamp: Floodlight): THREE.BufferGeometry {
  const length = lamp.range * 0.75;
  const g = new THREE.ConeGeometry(Math.tan(lamp.outer * 0.85) * length, length, 20, 4, true);
  g.translate(0, -length / 2, 0);
  const pos = g.getAttribute('position');
  const along = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) along[i] = -pos.getY(i) / length;
  g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), lamp.direction));
  g.translate(lamp.position.x, lamp.position.y, lamp.position.z);
  return g;
}

function housingGeometry(lamp: Floodlight): { body: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), lamp.direction);
  const place = (g: THREE.BufferGeometry, z: number): THREE.BufferGeometry => g.translate(0, 0, z).applyQuaternion(q).translate(lamp.position.x, lamp.position.y, lamp.position.z);
  const body = mergeGeometries([
    place(new THREE.BoxGeometry(0.42, 0.3, 0.32), -0.16).toNonIndexed(),
    place(new THREE.BoxGeometry(0.1, 0.5, 0.1), -0.36).toNonIndexed(), // bracket back to the hull
  ])!;
  const lens = place(new THREE.CircleGeometry(0.15, 16), 0.005);
  return { body, lens };
}

export interface ExteriorOptions {
  columns: readonly ExteriorColumn[];
  windows: readonly ExteriorWindow[];
  /** Painted steel for the legs and lamp housings. */
  steel: THREE.Material;
  rng: Rng;
}

export function buildExterior(o: ExteriorOptions): Exterior {
  const group = new THREE.Group();
  group.name = 'exterior';
  const dome = createWaterDome();
  group.add(dome);

  // ------------------------------------------------------------ seabed
  const cols = o.columns.length ? o.columns : [{ gx: 0, gz: 0, x: 0, z: 0, bottom: -0.85 }];
  const minX = Math.min(...cols.map((c) => c.x)) - HALF - MARGIN;
  const maxX = Math.max(...cols.map((c) => c.x)) + HALF + MARGIN;
  const minZ = Math.min(...cols.map((c) => c.z)) - HALF - MARGIN;
  const maxZ = Math.max(...cols.map((c) => c.z)) + HALF + MARGIN;
  const distance = footprintDistance(cols);
  const seabed = createSeabed({ minX, maxX, minZ, maxZ, distance, seed: 7 });
  group.add(seabed.group);

  // Rocks: a few in front of every real window, more scattered around the station.
  const rocks: Array<{ x: number; z: number; yaw: number; scale: number }> = [];
  const rng = o.rng;
  for (const w of o.windows) {
    const c = new THREE.Vector3().setFromMatrixPosition(w.matrix);
    const right = new THREE.Vector3().setFromMatrixColumn(w.matrix, 0).normalize();
    const out = new THREE.Vector3().setFromMatrixColumn(w.matrix, 2).normalize().negate();
    for (let k = 0; k < 3; k++) {
      const p = c.clone().addScaledVector(out, rng.range(5, 22)).addScaledVector(right, rng.range(-w.width / 2 - 5, w.width / 2 + 5));
      if (distance(p.x, p.z) > 2) rocks.push({ x: p.x, z: p.z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.5, 1.1) });
    }
  }
  for (let tries = 0, placed = 0; tries < 400 && placed < 36; tries++) {
    const x = rng.range(minX + 5, maxX - 5);
    const z = rng.range(minZ + 5, maxZ - 5);
    const d = distance(x, z);
    if (d < 3 || d > 35) continue;
    rocks.push({ x, z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.5, 1.2) });
    placed++;
  }
  seabed.addRocks(rocks);

  // ------------------------------------------------------------ legs
  const steel = applyExterior(o.steel);
  const legGeoms: THREE.BufferGeometry[] = [];
  for (const c of legColumns(o.columns)) {
    const top = c.bottom;
    const foot = seabed.heightAt(c.x, c.z) - 0.2;
    const h = top - foot;
    if (h <= 0.3) continue;
    legGeoms.push(new THREE.CylinderGeometry(0.28, 0.32, h, 10).translate(c.x, foot + h / 2, c.z).toNonIndexed());
    legGeoms.push(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12).translate(c.x, top - 0.15, c.z).toNonIndexed());
    legGeoms.push(new THREE.BoxGeometry(1.1, 0.25, 1.1).translate(c.x, foot + 0.125, c.z).toNonIndexed());
  }
  const addMesh = (name: string, geoms: THREE.BufferGeometry[], mat: THREE.Material, order = 0): void => {
    if (!geoms.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geoms)!, mat);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.userData['skipGtao'] = true;
    group.add(mesh);
  };
  addMesh('exterior-legs', legGeoms, steel);

  // ------------------------------------------------------------ floodlights
  const floodlights = placeFloodlights(windowRuns(o.windows));
  const lensSteady = new THREE.MeshBasicMaterial({ color: new THREE.Color(LAMP_COLOR).multiplyScalar(3), toneMapped: false, fog: false });
  const lensFlicker = lensSteady.clone();
  const beamSteady = beamMaterial();
  const beamFlicker = beamMaterial();
  const bodies: THREE.BufferGeometry[] = [];
  const lenses = { steady: [] as THREE.BufferGeometry[], flicker: [] as THREE.BufferGeometry[] };
  const beams = { steady: [] as THREE.BufferGeometry[], flicker: [] as THREE.BufferGeometry[] };
  for (const lamp of floodlights) {
    const { body, lens } = housingGeometry(lamp);
    bodies.push(body);
    (lamp.flicker ? lenses.flicker : lenses.steady).push(lens.toNonIndexed());
    (lamp.flicker ? beams.flicker : beams.steady).push(beamGeometry(lamp).toNonIndexed());
  }
  addMesh('exterior-floodlight-housings', bodies, steel);
  addMesh('exterior-floodlight-lenses', lenses.steady, lensSteady);
  addMesh('exterior-floodlight-lenses-flicker', lenses.flicker, lensFlicker);
  addMesh('exterior-floodlight-beams', beams.steady, beamSteady, 2);
  addMesh('exterior-floodlight-beams-flicker', beams.flicker, beamFlicker, 2);

  // Flicker: a short dip every 6-14 s, seeded.
  let nextDip = 4 + rng.range(0, 4);
  let dipEnd = -1;
  const dipLevel = (t: number): number => {
    if (t >= nextDip) {
      dipEnd = t + rng.range(0.25, 0.6);
      nextDip = dipEnd + rng.range(6, 14);
    }
    return t < dipEnd ? 0.15 + 0.35 * Math.abs(Math.sin(t * 47)) : 1;
  };

  const all: ExteriorLamp[] = [];
  return {
    group,
    floodlights,
    seabed,
    update(t, eye, visible, reducedFlashing, extraLamps = []) {
      group.visible = visible;
      if (!visible) return;
      dome.position.copy(eye);
      const level = reducedFlashing ? 1 : dipLevel(t);
      for (const l of floodlights) l.intensity = l.base * (l.flicker ? level : 1);
      lensFlicker.color.setHex(LAMP_COLOR).multiplyScalar(3 * level);
      beamFlicker.uniforms['uLevel']!.value = level;
      beamSteady.uniforms['uTime']!.value = t;
      beamFlicker.uniforms['uTime']!.value = t;
      all.length = 0;
      all.push(...floodlights, ...extraLamps);
      packLamps(all, eye);
    },
  };
}
