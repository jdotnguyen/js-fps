import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { paintedDecal } from '../../render/decals.ts';
import { flashingState } from '../../render/flashing.ts';
import { trackAnisotropy } from '../../render/anisotropy.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { at, cylinderBetween, rounded } from './geom.ts';
import { resolvePalette } from './palettes.ts';
import { slab } from './shapes.ts';
import {
  BOARDING_STEP_RISE,
  RAIL_HALF_GAUGE,
  RAIL_TOP,
  RIG_GATE_FINAL_Z,
  RIG_GATE_START_Z,
  TRAIN_RIDE_HEIGHT,
  beamMaterial,
  glowMaterial,
  parseCarMotion,
  poolMaterial,
  railMaterial,
} from './transitCommon.ts';
import { PieceBuilder, boolParam, numParam, strParam, type PieceDef, type PieceOutput, type PieceParams } from './types.ts';

/**
 * Lower transit wing structural & hero pieces (openspec finale-transit-rooms-geometry,
 * detail-r11-power-bay): walkable train car shells, grand arrival concourse pillars,
 * check-in booth enclosures, track bed runs, open-seam ceiling headers, and R11 Power Bay
 * turbine-generators, high-voltage switchgear, and transit power-up terminal.
 *
 * Conventions: pivot at floor centre (0, 0, 0), facing -Z, metres.
 */

type PowerBayState = 'standby' | 'starting' | 'online';

const flatCache = new Map<string, THREE.MeshStandardMaterial>();
function flatPaint(key: string, color: number, roughness = 0.55, metalness = 0.25): THREE.MeshStandardMaterial {
  let mat = flatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    mat.name = `transit-${key}`;
    mat.userData['flat'] = true;
    flatCache.set(key, mat);
  }
  return mat;
}

function parsePowerState(payload: unknown): { state: PowerBayState; instant: boolean } | null {
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  const s = rec['state'];
  if (s !== 'standby' && s !== 'starting' && s !== 'online') return null;
  return { state: s, instant: rec['instant'] === true };
}

function applyStatusStrip(mat: THREE.MeshStandardMaterial, state: PowerBayState, t: number): void {
  if (state === 'online') {
    mat.color.setHex(0x38e8b8);
    mat.emissive.setHex(0x38e8b8);
    mat.emissiveIntensity = 2.2;
  } else if (state === 'starting') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 10);
    mat.color.setHex(0x45d8ff);
    mat.emissive.setHex(0x45d8ff);
    mat.emissiveIntensity = 1.0 + 1.4 * pulse;
  } else {
    mat.color.setHex(0xff8c1a);
    mat.emissive.setHex(0xff8c1a);
    mat.emissiveIntensity = 0.85;
  }
}

function trainShell(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 3.0);
  const len = numParam(p, 'length', 10.0);
  const h = numParam(p, 'height', 2.9);
  const doorSide = strParam(p, 'doorSide', 'right');
  const id = strParam(p, 'id', '');
  const carId = strParam(p, 'carId', '') || id;
  // The whole car body rides `lift` above the track so the bogies and rails show below the floor (Decision 6).
  const lift = numParam(p, 'rideHeight', TRAIN_RIDE_HEIGHT);
  const carGroup = id ? new THREE.Group() : null;
  if (carGroup) {
    carGroup.name = `prop:${id}`;
    carGroup.userData['propId'] = id;
    pb.dynamic(carGroup);
  }
  const liftM = (matrix?: THREE.Matrix4): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(0, lift, 0).multiply(matrix ?? new THREE.Matrix4());
  /** Body mesh, lifted with the car. */
  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): THREE.Mesh => {
    if (carGroup) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.applyMatrix4(liftM(matrix));
      carGroup.add(mesh);
      return mesh;
    }
    return pb.add(geometry, material, liftM(matrix));
  };
  /** Undercarriage mesh at track level (not lifted). */
  const addLow = (geometry: THREE.BufferGeometry, material: THREE.Material, matrix?: THREE.Matrix4): THREE.Mesh => {
    if (carGroup) {
      const mesh = new THREE.Mesh(geometry, material);
      if (matrix) mesh.applyMatrix4(matrix);
      carGroup.add(mesh);
      return mesh;
    }
    return pb.add(geometry, material, matrix);
  };
  /** Dynamic object positioned in body coordinates; lifted with the car. */
  const addDynamic = <T extends THREE.Object3D>(object: T): T => {
    object.position.y += lift;
    if (carGroup) {
      carGroup.add(object);
      return object;
    }
    return pb.dynamic(object);
  };
  /** Dynamic object at track level (beams, pools): not lifted. */
  const addDynamicLow = <T extends THREE.Object3D>(object: T): T => {
    if (carGroup) {
      carGroup.add(object);
      return object;
    }
    return pb.dynamic(object);
  };
  const solid = (
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    surface?: Parameters<PieceBuilder['solid']>[6],
    acoustic?: 'glass',
    enabled = true,
  ) => pb.solid(minX, minY + lift, minZ, maxX, maxY + lift, maxZ, surface, acoustic, enabled);

  const doorSign = doorSide === 'left' ? -1 : 1; // +1 = +X (rotates to -X west at rot=180)
  const hw = w / 2;
  const hl = len / 2;
  const wallT = 0.14;
  const floorH = 0.08;
  const sillY = 1.05;
  const headY = 2.28;
  const doorHalf = 1.05;
  const doorH = 2.34;
  // Car-only copies of the cabin surfaces with a faint cold emissive fill, so a dim cabin still shows its far end
  // (design Decision 11). The shared palette materials stay untouched.
  const cabinFill = (src: THREE.Material): THREE.Material => {
    const c = src.clone();
    if (c instanceof THREE.MeshStandardMaterial) {
      c.emissive = new THREE.Color(0x0b2a33);
      c.emissiveIntensity = 0.38;
    }
    return c;
  };
  const bodyMat = cabinFill(pal.wallMain);
  const trimMat = cabinFill(pal.trim);
  const darkMat = cabinFill(pal.doorPanel);
  const seatMat = cabinFill(flatPaint('cabin-seat', 0x223846, 0.72, 0.08));
  const strapMat = flatPaint('cabin-strap', 0x1b242c, 0.55, 0.2);

  // Floor slab (clean non-slip metal deck with recessed centre aisle runner).
  addMesh(slab(w, floorH + 0.04, len), pal.floor, at(0, floorH / 2 - 0.02, 0));
  addMesh(slab(w - 0.36, 0.015, len - 0.36), pal.floorAlt, at(0, floorH + 0.005, 0));
  addMesh(slab(1.1, 0.018, len - 0.5), pal.pipeAccent, at(0, floorH + 0.006, 0));
  solid(-hw, -0.04, -hl, hw, floorH, hl, 'metal');

  // Roof slab, interior structural ribs, and recessed LED ceiling light diffuser.
  const roofT = 0.18;
  addMesh(rounded(w + 0.08, roofT, len + 0.08, 0.04), darkMat, at(0, h - roofT / 2, 0));
  solid(-hw, h - roofT, -hl, hw, h, hl);
  for (let z = -hl + 1.4; z <= hl - 1.3; z += 2.2) {
    addMesh(slab(w - wallT * 2, 0.09, 0.12), trimMat, at(0, h - roofT - 0.045, z));
  }
  const ceilingStripMat = fixtureMaterial(0xcfe6ee, 1.0);
  ceilingStripMat.name = 'cabin-ceiling-led';
  addMesh(slab(0.28, 0.024, len - 0.9), ceilingStripMat, at(0, h - roofT - 0.014, 0));
  addMesh(slab(0.38, 0.018, len - 0.8), trimMat, at(0, h - roofT - 0.006, 0));
  pb.light([0, h - roofT - 0.16 + lift, -hl * 0.38], 'ceiling', 0);
  pb.light([0, h - roofT - 0.16 + lift, hl * 0.38], 'ceiling', 0);

  // Overhead dual brushed-steel grab rails, vertical stanchions, and hanging hand-straps.
  for (const sx of [-1, 1]) {
    const rx = sx * 0.54;
    addMesh(cylinderBetween(new THREE.Vector3(rx, 2.18, -hl + 0.55), new THREE.Vector3(rx, 2.18, hl - 0.55), 0.022), trimMat);
    for (const sz of [-1, 1]) {
      const bz = sz * (doorHalf + 0.24);
      addMesh(cylinderBetween(new THREE.Vector3(rx, floorH, bz), new THREE.Vector3(rx, h - roofT, bz), 0.024), trimMat);
      solid(rx - 0.03, floorH, bz - 0.03, rx + 0.03, h - roofT, bz + 0.03, 'metal');
    }
    for (let z = -hl + 1.1; z <= hl - 1.0; z += 1.55) {
      if (Math.abs(z) < doorHalf - 0.1) continue;
      addMesh(slab(0.028, 0.16, 0.028), strapMat, at(rx, 2.08, z));
      addMesh(slab(0.036, 0.045, 0.09), trimMat, at(rx, 1.98, z));
    }
  }

  // Door pocket (Decision 7): the open leaf slides into a solid, window-less channel beside the doorway.
  const doorLeafW = doorHalf * 2 + 0.06;
  const openOffsetZ = doorHalf * 2 + 0.08;
  const pocketEnd = openOffsetZ + doorLeafW / 2 + 0.04;

  // Helper to build a windowed wall span along Z on side `s` (-1 = -X, +1 = +X).
  const sideSpan = (s: number, z0: number, z1: number): void => {
    const span = z1 - z0;
    if (span <= 0.05) return;
    const zc = (z0 + z1) / 2;
    const xc = s * (hw - wallT / 2);
    addMesh(slab(wallT, sillY - floorH, span), bodyMat, at(xc, (sillY + floorH) / 2, zc));
    addMesh(slab(wallT, h - roofT - headY, span), darkMat, at(xc, (h - roofT + headY) / 2, zc));
    addMesh(slab(wallT + 0.03, 0.06, span), trimMat, at(xc, sillY, zc));
    addMesh(slab(wallT + 0.03, 0.06, span), trimMat, at(xc, headY, zc));
    addMesh(slab(0.02, 0.035, span - 0.04), pal.pipeAccent, at(s * (hw - wallT - 0.01), headY + 0.08, zc));
    const winH = headY - sillY - 0.06;
    const posts = Math.max(2, Math.round(span / 1.9) + 1);
    for (let i = 0; i < posts; i++) {
      const zp = z0 + (span * i) / (posts - 1);
      addMesh(slab(wallT + 0.02, winH, 0.1), trimMat, at(xc, (sillY + headY) / 2, zp));
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.08, winH), m.glass);
    glass.name = 'train_window_glass';
    glass.applyMatrix4(at(xc, (sillY + headY) / 2, zc, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
    glass.renderOrder = 3;
    addDynamic(glass);
    solid(s > 0 ? hw - wallT : -hw, floorH, z0, s > 0 ? hw : -hw + wallT, h - roofT, z1);
  };

  // Helper to add clean commuter bench seating along side `s` over [z0, z1] (keeps >= 1.9 m clear aisle).
  const addBench = (s: number, z0: number, z1: number): void => {
    const span = z1 - z0;
    if (span < 0.8) return;
    const zc = (z0 + z1) / 2;
    const benchD = 0.4;
    const seatX = s * (hw - wallT - benchD / 2);
    const backX = s * (hw - wallT - 0.04);
    addMesh(slab(benchD - 0.04, 0.36, span - 0.08), darkMat, at(seatX, floorH + 0.18, zc));
    addMesh(rounded(benchD, 0.09, span, 0.02), seatMat, at(seatX, floorH + 0.4, zc));
    addMesh(rounded(0.08, 0.42, span - 0.04, 0.02), seatMat, at(backX, floorH + 0.65, zc));
    for (const sz of [z0 + 0.03, z1 - 0.03]) {
      addMesh(slab(benchD, 0.56, 0.05), trimMat, at(seatX, floorH + 0.28, sz));
    }
    const minX = s > 0 ? hw - wallT - benchD : -hw + wallT;
    const maxX = s > 0 ? hw - wallT : -hw + wallT + benchD;
    solid(minX, floorH, z0, maxX, floorH + 0.46, z1, 'metal');
  };

  // Continuous non-door side + full commuter bench.
  sideSpan(-doorSign, -hl, hl);
  addBench(-doorSign, -hl + 0.32, hl - 0.32);

  // Door side: window span, open boarding doorway, solid door pocket, window span, benches, overhead header.
  sideSpan(doorSign, -hl, -doorHalf);
  sideSpan(doorSign, pocketEnd, hl);
  addBench(doorSign, -hl + 0.32, -doorHalf - 0.16);
  addBench(doorSign, doorHalf + 0.16, hl - 0.32);
  const doorX = doorSign * (hw - wallT / 2);
  addMesh(slab(wallT + 0.04, h - roofT - doorH, doorHalf * 2), darkMat, at(doorX, (h - roofT + doorH) / 2, 0));
  addMesh(slab(wallT + 0.06, 0.06, doorHalf * 2 + 0.16), pal.hazard, at(doorX, doorH, 0));
  solid(doorSign > 0 ? hw - wallT : -hw, doorH, -doorHalf, doorSign > 0 ? hw : -hw + wallT, h - roofT, doorHalf);

  // Pocket panel: outer and inner skins around a leaf channel, end cap, and top/bottom guide plates.
  {
    const skin = 0.03;
    const span = pocketEnd - doorHalf;
    const zc = (doorHalf + pocketEnd) / 2;
    const wallH = h - roofT - floorH;
    const yc = (h - roofT + floorH) / 2;
    addMesh(slab(skin, wallH, span), bodyMat, at(doorSign * (hw - skin / 2), yc, zc));
    addMesh(slab(skin, wallH, span), bodyMat, at(doorSign * (hw - wallT + skin / 2), yc, zc));
    addMesh(slab(wallT, wallH, skin), darkMat, at(doorSign * (hw - wallT / 2), yc, pocketEnd - skin / 2));
    addMesh(slab(wallT - skin * 2, 0.03, span), darkMat, at(doorSign * (hw - wallT / 2), floorH + 0.015, zc));
    addMesh(slab(wallT - skin * 2, 0.03, span), darkMat, at(doorSign * (hw - wallT / 2), h - roofT - 0.015, zc));
    addMesh(slab(wallT + 0.03, 0.06, span), trimMat, at(doorSign * (hw - wallT / 2), sillY, zc));
    addMesh(slab(wallT + 0.03, 0.06, span), trimMat, at(doorSign * (hw - wallT / 2), headY, zc));
    addMesh(slab(0.02, 0.035, span - 0.04), pal.pipeAccent, at(doorSign * (hw - wallT - 0.01), headY + 0.08, zc));
    solid(doorSign > 0 ? hw - wallT : -hw, floorH, doorHalf, doorSign > 0 ? hw : -hw + wallT, h - roofT, pocketEnd);
  }

  // Animated pocketed sliding boarding door leaf + toggleable doorway collider (defaults open).
  const doorLeafH = doorH - floorH - 0.04;
  const doorGroup = new THREE.Group();
  doorGroup.name = 'train_boarding_door';
  const doorLeafX = doorSign * (hw - 0.07); // centred in the 0.08 m leaf channel
  const doorFrame = new THREE.Mesh(rounded(0.065, doorLeafH, doorLeafW, 0.015), darkMat);
  doorFrame.position.set(doorLeafX, floorH + doorLeafH / 2, 0);
  doorGroup.add(doorFrame);
  const doorTrim = new THREE.Mesh(slab(0.07, 0.07, doorLeafW - 0.08), pal.hazard);
  doorTrim.position.set(doorLeafX, floorH + 0.08, 0);
  doorGroup.add(doorTrim);
  const doorPane = new THREE.Mesh(new THREE.PlaneGeometry(doorLeafW - 0.36, 0.92), m.glass);
  doorPane.applyMatrix4(at(doorLeafX, 1.56, 0, 0, doorSign > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
  doorPane.renderOrder = 3;
  doorGroup.add(doorPane);
  doorGroup.position.z = openOffsetZ;
  addDynamic(doorGroup);
  const doorCollider = solid(doorSign > 0 ? hw - wallT : -hw, floorH, -doorHalf, doorSign > 0 ? hw : -hw + wallT, doorH, doorHalf, undefined, undefined, false);

  let doorTargetOpen = true;
  let doorOpenProgress = 1;
  const applyDoorState = (): void => {
    const ease = doorOpenProgress * doorOpenProgress * (3 - 2 * doorOpenProgress);
    doorGroup.position.z = ease * openOffsetZ;
    doorCollider.setEnabled(doorOpenProgress < 0.65);
  };
  pb.on('transit:train_door', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const rec = payload as Record<string, unknown>;
    if (typeof rec['carId'] === 'string' && carId && rec['carId'] !== carId) return;
    doorTargetOpen = rec['open'] !== false;
    if (rec['instant'] === true) {
      doorOpenProgress = doorTargetOpen ? 1 : 0;
      applyDoorState();
    }
  });

  // Front (-Z) bulkhead with wide viewing windshield + twin headlights, and solid rear (+Z) bulkhead (no rear window).
  const routeMat =
    typeof document !== 'undefined'
      ? paintedDecal(
          (ctx, cw, ch) => {
            ctx.fillStyle = '#12181d';
            ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = '#38e8b8';
            ctx.fillRect(0, ch - 8, cw, 8);
            ctx.fillStyle = '#e4e8ec';
            ctx.font = '800 30px "Arial Narrow", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('TRANSIT LINE 01 // ABYSSAL LINK', cw / 2, ch * 0.62, cw - 24);
          },
          512,
          96,
          'train-route-header',
        )
      : flatPaint('train-route-fallback', 0x12181d, 0.7, 0.1);

  // Headlight state (Decision 9): lens glow always; beam and pool only while the car moves with free track ahead.
  const glowMats: THREE.ShaderMaterial[] = [];
  const beamMat = beamMaterial('train-headlight-beam');
  const poolMat = poolMaterial('train-headlight-pool', 0xd8f0ff, 0);
  const beams: THREE.Mesh[] = [];
  let pool: THREE.Mesh | null = null;

  {
    const zc = -(hl - wallT / 2);
    addMesh(slab(w, sillY - floorH, wallT), bodyMat, at(0, (sillY + floorH) / 2, zc));
    addMesh(slab(w, h - roofT - headY, wallT), darkMat, at(0, (h - roofT + headY) / 2, zc));
    addMesh(new THREE.PlaneGeometry(w - 0.72, 0.3), routeMat, at(0, headY + 0.21, zc + wallT / 2 + 0.008, 0, 0, 0));
    for (const sx of [-1, 1]) {
      addMesh(slab(0.32, headY - sillY, wallT + 0.02), trimMat, at(sx * (hw - 0.16), (sillY + headY) / 2, zc));
    }
    const endGlass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.64, headY - sillY - 0.06), m.glass);
    endGlass.name = 'train_window_glass';
    endGlass.applyMatrix4(at(0, (sillY + headY) / 2, zc, 0, 0, 0));
    endGlass.renderOrder = 3;
    addDynamic(endGlass);
    solid(-hw, floorH, -hl, hw, h - roofT, -hl + wallT);

    // Twin headlights: recessed lens, soft glow quad, short tapered gradient beam (no cone, no scene lights).
    const headlightMat = fixtureMaterial(0xeef8ff, 3.2);
    headlightMat.name = 'train-headlight-lens';
    const BEAM_LEN = 8;
    for (const sx of [-1, 1]) {
      const hx = sx * (hw - 0.76);
      const hy = 0.72;
      const hz = -hl - 0.02;
      addMesh(slab(0.26, 0.18, 0.08), trimMat, at(hx, hy, hz));
      addMesh(slab(0.2, 0.12, 0.04), headlightMat, at(hx, hy, hz - 0.03));

      const glowMat = glowMaterial('train-headlight-glow', 0xeaf6ff, 0.9, 0.5);
      glowMats.push(glowMat);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
      glow.name = 'train_headlight_glow';
      glow.position.set(hx, hy, hz - 0.1);
      glow.frustumCulled = false;
      glow.renderOrder = 4;
      addDynamic(glow);

      const beamGeo = new THREE.CylinderGeometry(0.5, 0.06, BEAM_LEN, 20, 1, true);
      beamGeo.translate(0, BEAM_LEN / 2, 0);
      beamGeo.rotateX(-Math.PI / 2); // near end at the lens, far end toward -Z
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.name = 'train_headlight_beam';
      beam.rotation.order = 'YXZ';
      beam.rotation.y = sx * 0.07; // toe in so the beams stay inside a 3.3 m bore
      beam.rotation.x = -0.045;
      beam.position.set(hx, hy, hz - 0.08);
      beam.frustumCulled = false;
      beam.renderOrder = 4;
      beam.visible = false;
      beams.push(beam);
      addDynamic(beam);
    }

    // Light pool on the rails and ties ahead of the nose, just above the rail-top plane.
    const poolGeo = new THREE.PlaneGeometry(2.2, BEAM_LEN - 0.5);
    poolGeo.translate(0, (BEAM_LEN - 0.5) / 2, 0);
    poolGeo.rotateX(-Math.PI / 2);
    pool = new THREE.Mesh(poolGeo, poolMat);
    pool.name = 'train_headlight_pool';
    pool.position.set(0, RAIL_TOP + 0.014, -hl - 0.3);
    pool.frustumCulled = false;
    pool.renderOrder = 2;
    pool.visible = false;
    addDynamicLow(pool);
  }

  let motionSpeed = 0;
  let clearAhead = 8;
  let headlightLevel = 0;
  const applyHeadlights = (): void => {
    const lenFrac = Math.max(0, Math.min(1, (clearAhead - 0.5) / 8));
    const on = headlightLevel > 0.01 && lenFrac > 0.02;
    for (const b of beams) {
      b.visible = on;
      b.scale.z = Math.max(0.001, lenFrac);
    }
    if (pool) {
      pool.visible = on;
      pool.scale.z = Math.max(0.001, lenFrac);
    }
    beamMat.uniforms['uIntensity']!.value = headlightLevel * 0.2 * lenFrac;
    poolMat.uniforms['uIntensity']!.value = headlightLevel * 0.3 * lenFrac;
    for (const g of glowMats) g.uniforms['uIntensity']!.value = 0.5 + 0.5 * headlightLevel;
  };
  applyHeadlights();
  pb.on('transit:car_motion', (payload) => {
    const motion = parseCarMotion(payload, carId);
    if (!motion) return;
    motionSpeed = motion.speed;
    clearAhead = motion.clear;
  });
  pb.on('level:reset', () => {
    doorTargetOpen = true;
    doorOpenProgress = 1;
    applyDoorState();
    motionSpeed = 0;
    clearAhead = 8;
    headlightLevel = 0;
    applyHeadlights();
  });
  pb.tick((_t, dt) => {
    const target = doorTargetOpen ? 1 : 0;
    if (doorOpenProgress !== target) {
      const duration = doorTargetOpen ? 1.8 : 0.85;
      const step = Math.min(1, dt / duration);
      doorOpenProgress = doorOpenProgress < target ? Math.min(1, doorOpenProgress + step) : Math.max(0, doorOpenProgress - step);
      applyDoorState();
    }
    const want = THREE.MathUtils.smoothstep(motionSpeed, 0.4, 3);
    headlightLevel += (want - headlightLevel) * Math.min(1, dt * 3);
    applyHeadlights();
  });

  // Rear (+Z) solid clean bulkhead wall (no rear window).
  {
    const zc = hl - wallT / 2;
    addMesh(slab(w - wallT * 2, h - roofT - floorH, wallT), bodyMat, at(0, (h - roofT + floorH) / 2, zc));
    addMesh(slab(w - wallT * 2, 0.06, wallT + 0.02), trimMat, at(0, sillY, zc));
    addMesh(slab(w - wallT * 2, 0.05, wallT + 0.02), pal.pipeAccent, at(0, headY, zc));
    solid(-hw, floorH, hl - wallT, hw, h - roofT, hl);

    // Centred comms/radio terminal on the interior face of the rear bulkhead (for incoming radio to Heins).
    const rearFaceZ = hl - wallT;
    const commsGroup = new THREE.Group();
    commsGroup.name = 'train_comms_terminal';
    const commsBezel = new THREE.Mesh(slab(0.66, 0.6, 0.02), trimMat);
    commsBezel.position.set(0, 1.38, rearFaceZ - 0.01);
    commsGroup.add(commsBezel);
    const commsBody = new THREE.Mesh(rounded(0.62, 0.56, 0.09, 0.015), darkMat);
    commsBody.position.set(0, 1.38, rearFaceZ - 0.05);
    commsGroup.add(commsBody);
    const commsScreenMat =
      typeof document !== 'undefined'
        ? paintedDecal(
            (ctx, cw, ch) => {
              ctx.fillStyle = '#07141b';
              ctx.fillRect(0, 0, cw, ch);
              ctx.fillStyle = '#123846';
              ctx.fillRect(0, 0, cw, 46);
              ctx.fillStyle = '#38e8b8';
              ctx.fillRect(0, 44, cw, 4);
              ctx.fillStyle = '#e8f4f8';
              ctx.font = `bold 22px ${SCREEN_FONT}`;
              ctx.textAlign = 'left';
              ctx.fillText('COMMS LINK // CH-04', 20, 31);
              ctx.fillStyle = '#e0a82e';
              ctx.font = `bold 20px ${SCREEN_FONT}`;
              ctx.fillText('CAR B -> HEINS', 20, 92);
              ctx.fillStyle = '#8ec8d8';
              ctx.font = `18px ${SCREEN_FONT}`;
              ctx.fillText('STATUS: CARRIER ACTIVE', 20, 130);
              for (let i = 0; i < 14; i++) {
                const bh = 16 + ((i * 19 + 7) % 44);
                ctx.fillStyle = i < 10 ? '#38e8b8' : '#245866';
                ctx.fillRect(20 + i * 32, 224 - bh, 20, bh);
              }
            },
            512,
            256,
            'train-comms-screen',
          )
        : flatPaint('train-comms-screen-fallback', 0x0b2a33, 0.4, 0.1);
    const commsScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.25), commsScreenMat);
    commsScreen.applyMatrix4(at(0, 1.48, rearFaceZ - 0.098, 0, Math.PI, 0));
    commsGroup.add(commsScreen);
    const commsGrille = new THREE.Mesh(slab(0.22, 0.1, 0.02), trimMat);
    commsGrille.position.set(-0.14, 1.23, rearFaceZ - 0.102);
    commsGroup.add(commsGrille);
    const commsHandset = new THREE.Mesh(rounded(0.1, 0.16, 0.035, 0.008), pal.pipeAccent);
    commsHandset.position.set(0.15, 1.24, rearFaceZ - 0.106);
    commsGroup.add(commsHandset);
    const commsLedMat = fixtureMaterial(0x38e8b8, 2.0);
    commsLedMat.name = 'train-comms-led';
    const commsLed = new THREE.Mesh(slab(0.03, 0.018, 0.015), commsLedMat);
    commsLed.position.set(0.24, 1.59, rearFaceZ - 0.1);
    commsGroup.add(commsLed);
    addDynamic(commsGroup);
  }

  // Transit infographic / info sign on the solid windowless door-pocket wall (north-west end at rot=180).
  {
    const pocketZc = (doorHalf + pocketEnd) / 2;
    const signY = (sillY + headY) / 2;
    const innerX = doorSign * (hw - wallT);
    const infoGroup = new THREE.Group();
    infoGroup.name = 'train_pocket_info_sign';
    const infoFrame = new THREE.Mesh(slab(0.024, 0.9, 1.6), trimMat);
    infoFrame.position.set(innerX - doorSign * 0.012, signY, pocketZc);
    infoGroup.add(infoFrame);
    const infoMat =
      typeof document !== 'undefined'
        ? paintedDecal(
            (ctx, cw, ch) => {
              ctx.fillStyle = '#0b1820';
              ctx.fillRect(0, 0, cw, ch);
              ctx.fillStyle = '#153442';
              ctx.fillRect(0, 0, cw, 48);
              ctx.fillStyle = '#48d8e8';
              ctx.fillRect(0, 44, cw, 4);
              ctx.fillStyle = '#e8f4f8';
              ctx.font = `bold 22px ${SCREEN_FONT}`;
              ctx.textAlign = 'left';
              ctx.fillText('THALASSA TRANSIT // LINE 01 ROUTE', 20, 32);
              ctx.strokeStyle = '#38e8b8';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(56, 114);
              ctx.lineTo(456, 114);
              ctx.stroke();
              const stops = [
                { x: 64, label: 'R15A DEPART' },
                { x: 256, label: 'ABYSSAL BORE' },
                { x: 448, label: 'R16A ARRIVAL' },
              ];
              for (const s of stops) {
                ctx.fillStyle = '#38e8b8';
                ctx.beginPath();
                ctx.arc(s.x, 114, 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#cfe6ee';
                ctx.font = `bold 15px ${SCREEN_FONT}`;
                ctx.textAlign = 'center';
                ctx.fillText(s.label, s.x, 148);
              }
              ctx.textAlign = 'left';
              ctx.fillStyle = '#e0a82e';
              ctx.font = `bold 18px ${SCREEN_FONT}`;
              ctx.fillText('DEPTH -185 m  |  PRESSURE NOMINAL', 20, 212);
            },
            512,
            256,
            'train-pocket-info-sign',
          )
        : flatPaint('train-pocket-info-fallback', 0x0b1820, 0.6, 0.1);
    const infoFace = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.82), infoMat);
    infoFace.applyMatrix4(at(innerX - doorSign * 0.026, signY, pocketZc, 0, doorSign > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
    infoGroup.add(infoFace);
    addDynamic(infoGroup);
  }

  // Undercarriage (Decision 6): side skirts, two bogies with wheelsets on the rails, and a guide-strip glow.
  {
    const underside = lift - 0.04;
    const wheelR = 0.11;
    const wheelY = RAIL_TOP + wheelR;
    const wheelMat = flatPaint('bogie-wheel', 0x59636c, 0.4, 0.85);
    const frameMat = flatPaint('bogie-frame', 0x1d262d, 0.55, 0.45);
    for (const sx of [-1, 1]) {
      addLow(slab(0.04, 0.12, len - 1.0), darkMat, at(sx * (hw - 0.06), underside - 0.06, 0));
    }
    const bogieZ = Math.max(1.6, hl - 1.9);
    for (const sz of [-1, 1]) {
      const bz = sz * bogieZ;
      addLow(slab(1.5, 0.07, 0.3), frameMat, at(0, wheelY + 0.08, bz));
      for (const wz of [-0.55, 0.55]) {
        addLow(cylinderBetween(new THREE.Vector3(-RAIL_HALF_GAUGE, wheelY, bz + wz), new THREE.Vector3(RAIL_HALF_GAUGE, wheelY, bz + wz), 0.022), frameMat);
        for (const sx of [-1, 1]) {
          addLow(new THREE.CylinderGeometry(wheelR, wheelR, 0.09, 18), wheelMat, at(sx * RAIL_HALF_GAUGE, wheelY, bz + wz, 0, 0, Math.PI / 2));
        }
      }
      for (const sx of [-1, 1]) {
        addLow(slab(0.06, 0.09, 1.4), frameMat, at(sx * (RAIL_HALF_GAUGE - 0.1), wheelY + 0.07, bz));
      }
      addLow(slab(0.36, 0.12, 0.34), frameMat, at(0, wheelY + 0.03, bz));
    }
    // Cyan guide strips under the skirts and a soft glow on the track bed beneath the car.
    const guideMat = fixtureMaterial(0x38e8d8, 1.3);
    guideMat.name = 'train-guide-strip';
    for (const sx of [-1, 1]) {
      addLow(slab(0.03, 0.025, len - 1.6), guideMat, at(sx * (hw - 0.1), underside - 0.135, 0));
    }
    const underGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, len - 0.6).rotateX(-Math.PI / 2),
      poolMaterial('train-underglow', 0x38e8d8, 0.4, true),
    );
    underGlow.name = 'train_underglow';
    underGlow.position.set(0, RAIL_TOP + 0.012, 0);
    underGlow.frustumCulled = false;
    underGlow.renderOrder = 2;
    addDynamicLow(underGlow);
  }

  // Interior centerline + doorway nav nodes for seamless boarding (platform node stays at track level).
  pb.nav(0, floorH + lift, -hl + 1.8);
  pb.nav(0, floorH + lift, 0);
  pb.nav(0, floorH + lift, hl - 1.8);
  pb.nav(doorSign * (hw - 0.15), floorH + lift, 0);
  pb.nav(doorSign * (hw + 0.75), 0, 0);
  return pb.build();
}


function concoursePillar(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 1.45);
  const h = numParam(p, 'height', 8.0);
  const baseH = 0.56;
  const capH = 0.62;
  const shaftH = Math.max(1.0, h - baseH - capH);
  const hw = w / 2;

  // Heavy stepped plinth base with brushed steel kick collar.
  pb.add(rounded(w + 0.32, 0.16, w + 0.32, 0.03), pal.trim, at(0, 0.08, 0));
  pb.add(rounded(w + 0.26, baseH - 0.16, w + 0.26, 0.04), pal.doorPanel, at(0, 0.16 + (baseH - 0.16) / 2, 0));
  pb.add(slab(w + 0.34, 0.09, w + 0.34), pal.trim, at(0, baseH + 0.045, 0));

  // Main architectural clean slate shaft with corner brushed-steel ribs and horizontal band rings.
  pb.add(rounded(w, shaftH, w, 0.04), pal.wallMain, at(0, baseH + shaftH / 2, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pb.add(slab(0.15, shaftH, 0.15), pal.trim, at(sx * (hw - 0.03), baseH + shaftH / 2, sz * (hw - 0.03)));
    }
  }
  // Vertical recessed accent channels on all four faces for grand terminal depth.
  for (const sx of [-1, 1]) {
    pb.add(slab(0.03, shaftH - 0.6, 0.28), pal.doorPanel, at(sx * (hw + 0.005), baseH + shaftH / 2, 0));
    pb.add(slab(0.28, shaftH - 0.6, 0.03), pal.doorPanel, at(0, baseH + shaftH / 2, sx * (hw + 0.005)));
  }
  // Mid-height architectural collar band & upper cove trim ring.
  pb.add(slab(w + 0.14, 0.12, w + 0.14), pal.doorPanel, at(0, 2.55, 0));
  pb.add(slab(w + 0.18, 0.045, w + 0.18), pal.trim, at(0, 2.63, 0));
  const coveGlow = fixtureMaterial(0xb8e6f0, 0.75);
  coveGlow.name = 'concourse-pillar-cove';
  pb.add(slab(w + 0.16, 0.035, w + 0.16), coveGlow, at(0, h - capH - 0.14, 0));

  // Grand capital meeting the 8.0 m ceiling.
  pb.add(slab(w + 0.34, 0.1, w + 0.34), pal.trim, at(0, h - capH - 0.05, 0));
  pb.add(rounded(w + 0.38, capH, w + 0.38, 0.04), pal.doorPanel, at(0, h - capH / 2, 0));

  const ch = hw + 0.14;
  pb.solid(-ch, 0, -ch, ch, h, ch);
  return pb.build();
}

function checkinBooth(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 3.6);
  const d = numParam(p, 'depth', 2.2);
  const h = numParam(p, 'height', 3.2);
  const label = strParam(p, 'label', 'CHECK-IN // CLEARANCE');
  const hw = w / 2;
  const hd = d / 2;
  const counterH = 1.05;
  const fasciaBottom = 2.4;

  // Solid base counter with recessed brushed-steel kick plate and transaction ledge (front faces -Z).
  pb.add(slab(w - 0.08, 0.16, d - 0.08), pal.doorPanel, at(0, 0.08, 0));
  pb.add(rounded(w, counterH - 0.2, d, 0.02), pal.wallMain, at(0, 0.16 + (counterH - 0.2) / 2, 0));
  pb.add(slab(w - 0.14, 0.04, 0.03), pal.pipeAccent, at(0, 0.56, -hd - 0.01));
  pb.add(rounded(w + 0.08, 0.07, d + 0.16, 0.015), pal.trim, at(0, counterH - 0.035, -0.04));
  // Recessed stainless pass-through tray at central cutout.
  pb.add(slab(0.76, 0.02, 0.34), pal.doorPanel, at(0, counterH + 0.01, -hd + 0.12));

  // Side partition piers + back wall.
  for (const sx of [-1, 1]) {
    pb.add(slab(0.18, h - counterH, d), pal.doorPanel, at(sx * (hw - 0.09), (h + counterH) / 2, 0));
  }
  pb.add(slab(w - 0.36, h - counterH, 0.16), pal.wallMain, at(0, (h + counterH) / 2, hd - 0.08));

  // Interior teller workstation detail visible through glass: dual monitors, keyboard, desk lamp glow.
  const monitorShell = flatPaint('booth-monitor', 0x161d24, 0.45, 0.3);
  const screenGlow = fixtureMaterial(0x52c8dc, 0.85);
  screenGlow.name = 'booth-monitor-glow';
  for (const sx of [-0.95, 0.95]) {
    pb.add(slab(0.46, 0.3, 0.04), monitorShell, at(sx, counterH + 0.26, 0.18, -0.1, sx > 0 ? -0.22 : 0.22, 0));
    pb.add(slab(0.4, 0.24, 0.015), screenGlow, at(sx, counterH + 0.26, 0.155, -0.1, sx > 0 ? -0.22 : 0.22, 0));
    pb.add(slab(0.1, 0.12, 0.08), pal.trim, at(sx, counterH + 0.06, 0.2));
    pb.add(slab(0.36, 0.025, 0.14), monitorShell, at(sx, counterH + 0.015, -0.08));
  }

  // Glazed teller screen with central check-in cutout + overhead signage fascia.
  const screenH = fasciaBottom - counterH;
  const sideGlassW = (w - 0.36 - 0.9) / 2;
  for (const sx of [-1, 1]) {
    const gx = sx * (0.45 + sideGlassW / 2);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(sideGlassW, screenH - 0.06), m.glass);
    pane.applyMatrix4(at(gx, counterH + screenH / 2, -hd + 0.14));
    pane.renderOrder = 3;
    pb.dynamic(pane);
    pb.add(slab(0.06, screenH, 0.06), pal.trim, at(sx * 0.45, counterH + screenH / 2, -hd + 0.14));
  }
  pb.add(rounded(w + 0.06, h - fasciaBottom, d + 0.06, 0.02), pal.doorPanel, at(0, (h + fasciaBottom) / 2, 0));
  pb.add(slab(w + 0.08, 0.08, 0.06), pal.trim, at(0, fasciaBottom + 0.04, -hd - 0.03));
  // Overhead illuminated fascia sign facing -Z.
  const fasciaMat =
    typeof document !== 'undefined'
      ? paintedDecal(
          (ctx, cw, ch) => {
            ctx.fillStyle = '#0d1920';
            ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = '#38c8d8';
            ctx.fillRect(0, ch - 8, cw, 8);
            ctx.fillStyle = '#e8f4f8';
            ctx.font = `bold 34px ${SCREEN_FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText(label, cw / 2, ch * 0.62, cw - 36);
          },
          512,
          96,
          `checkin-fascia-${label}`,
        )
      : flatPaint('checkin-fascia-fallback', 0x0d1920, 0.5, 0.1);
  pb.add(new THREE.PlaneGeometry(w - 0.36, 0.42), fasciaMat, at(0, fasciaBottom + 0.42, -hd - 0.042, 0, Math.PI, 0));

  pb.solid(-hw, 0, -hd, hw, h, hd);
  return pb.build();
}

function trackBed(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 3.4);
  const len = numParam(p, 'length', 4.0);

  // Recessed dark track apron, sleepers, and twin polished rails. Rail heads stay at or below RAIL_TOP, well under
  // the lifted car floor, so no rail ever intersects a train car.
  pb.add(slab(w, 0.025, len), pal.doorPanel, at(0, 0.0125, 0));
  for (let z = -len / 2 + 0.35; z <= len / 2 - 0.3; z += 0.7) {
    pb.add(slab(2.2, 0.03, 0.18), pal.ceiling, at(0, 0.035, z));
  }
  for (const sx of [-1, 1]) {
    pb.add(slab(0.08, RAIL_TOP - 0.05, len), railMaterial(), at(sx * RAIL_HALF_GAUGE, (RAIL_TOP + 0.05) / 2, 0));
  }
  return pb.build();
}

/**
 * Clean two-step boarding stair bridging the lifted car threshold (`TRAIN_RIDE_HEIGHT`). Local frame: the
 * high step ends at x = 0 (the car skin) and the steps descend toward -X; width runs along Z.
 */
function boardingStep(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const width = numParam(p, 'width', 2.2);
  const rise = numParam(p, 'rise', BOARDING_STEP_RISE);
  const depth = 0.6;
  const hw = width / 2;
  for (let i = 0; i < 2; i++) {
    const top = rise * (i + 1);
    const x0 = -depth * (2 - i) - 0.02;
    const x1 = x0 + depth;
    pb.add(slab(depth, top, width), pal.floor, at((x0 + x1) / 2, top / 2, 0));
    pb.add(slab(depth - 0.02, 0.02, width - 0.04), pal.floorAlt, at((x0 + x1) / 2, top + 0.01, 0));
    pb.add(slab(0.07, 0.025, width), pal.hazard, at(x0 + 0.035, top + 0.0125, 0));
    pb.solid(x0, 0, -hw, x1, top, hw, 'metal');
  }
  for (const sz of [-1, 1]) {
    pb.add(slab(depth * 2, 0.04, 0.04), pal.trim, at(-depth - 0.02, rise * 2 + 0.02, sz * (hw - 0.02)));
  }
  pb.nav(-depth * 1.5 - 0.02, rise, 0);
  pb.nav(-depth * 0.5 - 0.02, rise * 2, 0);
  return pb.build();
}

function seamHeader(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 4.0);
  const bottom = numParam(p, 'bottom', 5.0);
  const top = numParam(p, 'top', 8.0);
  const d = numParam(p, 'depth', 0.36);
  const h = Math.max(0.2, top - bottom);

  pb.add(slab(w, h + 0.08, d), pal.wallMain, at(0, bottom + h / 2 + 0.02, 0));
  pb.add(slab(w, 0.14, d + 0.08), pal.trim, at(0, bottom + 0.07, 0));
  pb.solid(-w / 2, bottom, -d / 2, w / 2, top + 0.08, d / 2);
  return pb.build();
}

/**
 * R11 Power Bay hero turbine-generator skid (~1.8 m W x 3.2 m L, risers up to 5.0 m ceiling).
 * Front rotor cage faces -Z; subscribes to `r11:power_state` and `level:reset`.
 */
function powerGenerator(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const ceiling = numParam(p, 'ceiling', 5.0);
  const turbineTeal = flatPaint('turbine-teal', 0x264852, 0.55, 0.35);
  const castIron = flatPaint('cast-iron', 0x22282e, 0.65, 0.55);
  const copperCoil = flatPaint('copper-coil', 0xa8602a, 0.38, 0.78);
  const warnRed = flatPaint('warn-red', 0xa82e24, 0.5, 0.2);

  // Heavy vibration plinth + brushed steel trim band + mounting feet.
  pb.add(rounded(1.76, 0.22, 3.16, 0.02), pal.doorPanel, at(0, 0.11, 0));
  pb.add(slab(1.8, 0.06, 3.2), castIron, at(0, 0.04, 0));
  for (const sx of [-0.74, 0.74]) {
    for (const sz of [-1.25, 0, 1.25]) {
      pb.add(rounded(0.22, 0.28, 0.26, 0.02), pal.trim, at(sx, 0.14, sz));
    }
  }

  // Main horizontal stator drum + cooling/stiffener rings + rear end-bell.
  const axisY = 1.12;
  pb.add(new THREE.CylinderGeometry(0.66, 0.66, 2.24, 24), turbineTeal, at(0, axisY, 0.08, Math.PI / 2, 0, 0));
  for (const rz of [-0.88, -0.5, -0.12, 0.26, 0.64, 1.02]) {
    pb.add(new THREE.CylinderGeometry(0.72, 0.72, 0.07, 24), pal.trim, at(0, axisY, rz, Math.PI / 2, 0, 0));
  }
  pb.add(new THREE.CylinderGeometry(0.58, 0.66, 0.24, 20), castIron, at(0, axisY, 1.32, Math.PI / 2, 0, 0));

  // Side junction manifolds & copper busbar terminal blocks.
  for (const sx of [-1, 1]) {
    pb.add(rounded(0.26, 0.78, 1.45, 0.02), castIron, at(sx * 0.74, 0.88, 0.15));
    pb.add(rounded(0.18, 0.32, 0.62, 0.015), copperCoil, at(sx * 0.78, 1.44, 0.15));
  }

  // Top exhaust / busbar manifold + vertical risers up to the 5.0 m ceiling.
  const riserTop = Math.max(2.6, ceiling - 0.18);
  pb.add(rounded(0.92, 0.24, 1.6, 0.03), castIron, at(0, 1.88, 0.2));
  for (const rz of [-0.35, 0.75]) {
    pb.add(cylinderBetween(new THREE.Vector3(0, 1.98, rz), new THREE.Vector3(0, riserTop, rz), 0.15, 14), pal.trim);
    pb.add(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 14), castIron, at(0, 2.06, rz));
    pb.add(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 14), castIron, at(0, riserTop - 0.12, rz));
  }
  pb.add(cylinderBetween(new THREE.Vector3(-0.36, 1.96, 0.2), new THREE.Vector3(-0.36, riserTop, 0.2), 0.07, 10), warnRed);

  // Protective front rotor shroud ring at -Z.
  pb.add(new THREE.TorusGeometry(0.6, 0.065, 10, 24), castIron, at(0, axisY, -1.16));
  pb.add(rounded(1.28, 0.06, 0.06, 0.01), pal.trim, at(0, axisY, -1.24));
  pb.add(rounded(0.06, 1.28, 0.06, 0.01), pal.trim, at(0, axisY, -1.24));

  // Dynamic spinning turbine rotor / flywheel inside the -Z shroud.
  const rotor = new THREE.Group();
  rotor.name = 'generator_rotor';
  rotor.position.set(0, axisY, -1.14);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 16), pal.trim);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.Mesh(rounded(0.11, 0.5, 0.04, 0.01), copperCoil);
    const ang = (i * Math.PI) / 3;
    blade.position.set(Math.cos(ang) * 0.31, Math.sin(ang) * 0.31, 0);
    blade.rotation.z = ang + Math.PI / 2;
    blade.rotation.y = 0.28;
    rotor.add(blade);
  }
  pb.dynamic(rotor);

  // Dynamic status strip on the front shroud top + side junction box.
  const statusMat = fixtureMaterial(0xff8c1a, 0.85);
  statusMat.name = 'power-generator-status';
  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.055, 0.04), statusMat);
  frontBar.position.set(0, axisY + 0.72, -1.18);
  pb.dynamic(frontBar);

  let state: PowerBayState = 'standby';
  let speed = 0;
  let silencedAtR16 = false;
  pb.on('r11:power_state', (payload) => {
    const parsed = parsePowerState(payload);
    if (!parsed) return;
    state = parsed.state;
    if (parsed.instant) {
      speed = state === 'online' ? 14 : state === 'starting' ? 7 : 0;
    }
  });
  pb.on('transit:ride_state', (payload) => {
    const rec = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    const stage = rec?.['stage'];
    if (stage === 'arrival' || stage === 'arrived') silencedAtR16 = true;
    else if (stage === 'idle') silencedAtR16 = false;
  });
  pb.on('level:reset', () => {
    state = 'standby';
    speed = 0;
    silencedAtR16 = false;
  });
  pb.tick((t, dt) => {
    const target = state === 'online' ? 14 : state === 'starting' ? 9 : 0;
    const rate = state === 'standby' ? 3.5 : 4.2;
    speed += (target - speed) * Math.min(1, dt * rate);
    rotor.rotation.z += speed * dt;
    applyStatusStrip(statusMat, state, t);
  });

  pb.soundLoop({
    sound: 'powerBayHum',
    pos: [0, 1.1, 0],
    gain: 8.5,
    maxDist: 34,
    reverb: 0.25,
    bus: 'sfx',
    active: () => state === 'online' && !silencedAtR16,
  });
  pb.solid(-0.92, 0, -1.62, 0.92, 2.35, 1.62, 'metal');
  return pb.build();
}

/**
 * R11 Power Bay high-voltage switchgear & breaker cabinet bank (2.8 m W x 0.85 m D x 2.35 m H + busbars).
 * Front faces -Z; subscribes to `r11:power_state` and `level:reset`.
 */
function switchgearBank(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const ceiling = numParam(p, 'ceiling', 5.0);
  const cabinetDark = flatPaint('switchgear-body', 0x262d33, 0.55, 0.45);
  const leverRed = flatPaint('breaker-red', 0xb32d22, 0.45, 0.25);
  const dialFace = flatPaint('dial-face', 0xd8dfd8, 0.35, 0.05);

  // Plinth + main 3-bay cabinet enclosure.
  pb.add(slab(2.84, 0.16, 0.88), pal.doorPanel, at(0, 0.08, 0));
  pb.add(rounded(2.76, 2.16, 0.82, 0.02), cabinetDark, at(0, 1.24, 0));
  pb.add(rounded(2.84, 0.12, 0.88, 0.02), pal.trim, at(0, 2.36, 0));

  // Three recessed breaker bays with throw handles and analog voltmeter bezels.
  for (const bx of [-0.88, 0, 0.88]) {
    pb.add(rounded(0.76, 1.78, 0.05, 0.015), pal.doorPanel, at(bx, 1.2, -0.415));
    pb.add(rounded(0.12, 0.24, 0.08, 0.01), pal.trim, at(bx - 0.18, 1.22, -0.44));
    pb.add(rounded(0.05, 0.16, 0.12, 0.01), leverRed, at(bx - 0.18, 1.24, -0.48));
    pb.add(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 14), pal.trim, at(bx + 0.14, 1.68, -0.44, Math.PI / 2, 0, 0));
    pb.add(new THREE.CylinderGeometry(0.07, 0.07, 0.045, 14), dialFace, at(bx + 0.14, 1.68, -0.445, Math.PI / 2, 0, 0));
  }

  // Overhead busbar ducting & risers to the 5.0 m ceiling.
  const riserTop = Math.max(2.6, ceiling - 0.18);
  for (const bx of [-0.88, 0, 0.88]) {
    pb.add(cylinderBetween(new THREE.Vector3(bx, 2.4, 0), new THREE.Vector3(bx, riserTop, 0), 0.085, 10), pal.trim);
  }
  pb.add(rounded(2.4, 0.18, 0.24, 0.02), cabinetDark, at(0, Math.min(riserTop - 0.25, 4.1), 0));

  // Dynamic breaker indicator strip along the upper fascia.
  const statusMat = fixtureMaterial(0xff8c1a, 0.85);
  statusMat.name = 'switchgear-status';
  const strip = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.05, 0.03), statusMat);
  strip.position.set(0, 2.22, -0.43);
  pb.dynamic(strip);

  let state: PowerBayState = 'standby';
  pb.on('r11:power_state', (payload) => {
    const parsed = parsePowerState(payload);
    if (parsed) state = parsed.state;
  });
  pb.on('level:reset', () => {
    state = 'standby';
  });
  pb.tick((t) => {
    applyStatusStrip(statusMat, state, t);
  });

  pb.solid(-1.42, 0, -0.45, 1.42, 2.42, 0.45, 'metal');
  return pb.build();
}

function drawPowerTerminal(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, state: PowerBayState): void {
  ctx.fillStyle = state === 'online' ? '#03110e' : '#0b0804';
  ctx.fillRect(0, 0, w, h);

  const accent = state === 'online' ? '#4df0c0' : state === 'starting' ? '#58d8ff' : '#ff9e2c';
  const dim = state === 'online' ? '#1f705a' : state === 'starting' ? '#256078' : '#734514';

  ctx.font = `600 20px ${SCREEN_FONT}`;
  ctx.fillStyle = accent;
  ctx.textAlign = 'left';
  ctx.fillText('TRANSIT SUB-GRID // POWER BAY 11', 18, 32);
  ctx.fillRect(18, 42, w - 36, 2);

  ctx.font = `17px ${SCREEN_FONT}`;
  const rows: Array<[string, string]> = [
    ['TURBINE GEN-01 / 02', state === 'online' ? '1800 RPM  [SYNC]' : state === 'starting' ? 'SPINNING UP...' : '0 RPM  [STANDBY]'],
    ['BUS OUTPUT', state === 'online' ? '4.16 kV  NOMINAL' : state === 'starting' ? 'RAMPING...' : '0.00 kV  OFFLINE'],
    ['LIGHT BANKS 1-3', state === 'online' ? 'ENERGIZED' : state === 'starting' ? 'CLOSING BREAKERS' : 'DARK (BACKUP)'],
    ['R15a RAIL BUS', state === 'online' ? 'ONLINE // READY' : 'ISOLATED'],
  ];
  rows.forEach(([k, v], i) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = dim;
    ctx.fillText(k, 18, 82 + i * 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = accent;
    ctx.fillText(v, w - 18, 82 + i * 32);
  });

  // Load bar graph at bottom.
  const load = state === 'online' ? 0.86 + Math.sin(t * 2) * 0.03 : state === 'starting' ? 0.35 + 0.3 * Math.abs(Math.sin(t * 3)) : 0.06;
  ctx.fillStyle = '#141a1c';
  ctx.fillRect(18, h - 58, w - 36, 18);
  ctx.fillStyle = accent;
  ctx.fillRect(20, h - 56, Math.max(8, (w - 40) * load), 14);

  ctx.textAlign = 'left';
  ctx.font = `600 18px ${SCREEN_FONT}`;
  const blink = Math.floor(t * 2) % 2 === 0;
  ctx.fillStyle = state === 'online' ? '#4df0c0' : blink ? accent : dim;
  ctx.fillText(state === 'online' ? 'STATUS: AUXILIARY SUB-GRID ONLINE' : state === 'starting' ? 'STATUS: ENERGIZING BAY...' : 'STATUS: AWAITING BREAKER ENGAGE', 18, h - 18);
}

/**
 * Giles's west-wall transit power-up terminal at `final_console` (1.72 m W x 0.88 m D, front faces -Z).
 */
function powerTerminal(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const deskMat = flatPaint('term-body', 0x2a3238, 0.55, 0.35);
  const leverRed = flatPaint('term-lever', 0xb32d22, 0.45, 0.25);

  // Heavy base desk, side wings, and hooded monitor bay.
  pb.add(rounded(1.68, 0.86, 0.78, 0.025), deskMat, at(0, 0.43, 0));
  pb.add(rounded(1.76, 0.06, 0.9, 0.015), pal.trim, at(0, 0.89, -0.04));
  for (const sx of [-0.78, 0.78]) {
    pb.add(rounded(0.1, 0.92, 0.72, 0.015), pal.doorPanel, at(sx, 1.32, 0.04));
  }
  pb.add(rounded(1.64, 0.1, 0.62, 0.02), pal.doorPanel, at(0, 1.78, 0.06));
  // Tactile breaker switch cluster + keyboard pad on the desk ledge.
  pb.add(rounded(0.64, 0.035, 0.24, 0.01), m.rubber, at(-0.18, 0.935, -0.2));
  for (let i = 0; i < 3; i++) {
    pb.add(rounded(0.06, 0.08, 0.08, 0.01), leverRed, at(0.32 + i * 0.14, 0.95, -0.18));
  }
  // Low floor conduit bridge stub running out the back (+Z toward wall).
  pb.add(slab(0.45, 0.03, 0.6), pal.doorPanel, at(0, 0.015, 0.62));

  let state: PowerBayState = 'standby';
  let dirty = true;
  const screen =
    typeof document !== 'undefined'
      ? new CanvasScreen(512, 288, (ctx, t, w, h) => drawPowerTerminal(ctx, t, w, h, state))
      : null;
  if (screen) screen.material.name = 'power-terminal-screen';
  const assembly = new THREE.Group();
  assembly.position.set(0, 1.36, 0.18);
  assembly.rotation.x = -0.22;
  assembly.add(new THREE.Mesh(rounded(1.16, 0.66, 0.12, 0.02), pal.doorPanel));
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.56), screen ? screen.material : pal.doorPanel);
  display.position.z = -0.062;
  display.rotation.y = Math.PI;
  assembly.add(display);
  pb.dynamic(assembly);

  const statusMat = fixtureMaterial(0xff8c1a, 0.9);
  statusMat.name = 'power-terminal-status';
  const hoodStrip = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.04, 0.03), statusMat);
  hoodStrip.position.set(0, 1.74, -0.24);
  pb.dynamic(hoodStrip);

  pb.on('r11:power_state', (payload) => {
    const parsed = parsePowerState(payload);
    if (!parsed) return;
    state = parsed.state;
    dirty = true;
  });
  pb.on('level:reset', () => {
    state = 'standby';
    dirty = true;
  });
  pb.tick((t) => {
    if (screen) {
      if (dirty) {
        dirty = false;
        // Force an immediate redraw when state flips.
        screen.update(t + 1);
      } else {
        screen.update(t);
      }
    }
    applyStatusStrip(statusMat, state, t);
  });

  pb.solid(-0.88, 0, -0.36, 0.88, 1.82, 0.44, 'metal');
  return pb.build();
}

/**
 * Wall-mounted industrial / transit stencil plate (`paintedDecal`, origin on floor at wall face, front -Z).
 */
function transitSign(p: PieceParams): PieceOutput {
  const pb = new PieceBuilder();
  const title = strParam(p, 'title', 'POWER BAY 11');
  const sub = strParam(p, 'sub', 'TRANSIT SUB-GRID');
  const w = numParam(p, 'width', 1.4);
  const h = numParam(p, 'height', 0.48);
  const y = numParam(p, 'y', 1.9);
  const accent = strParam(p, 'accent', '#e0a82e');
  const mat =
    typeof document !== 'undefined'
      ? paintedDecal(
          (ctx, cw, ch) => {
            ctx.fillStyle = 'rgba(18, 22, 26, 0.88)';
            ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = accent;
            ctx.fillRect(0, 0, 14, ch);
            ctx.fillRect(14, ch - 8, cw - 14, 8);
            ctx.fillStyle = '#e4e8ec';
            ctx.font = '800 50px "Arial Narrow", Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(title, 30, ch * 0.52, cw - 52);
            ctx.fillStyle = accent;
            ctx.font = '700 26px "Arial Narrow", Arial, sans-serif';
            ctx.fillText(sub, 30, ch * 0.82, cw - 52);
          },
          512,
          176,
          `transit-sign-${title}-${sub}`,
        )
      : flatPaint('sign-fallback', 0x1a2024, 0.7, 0.1);
  pb.add(new THREE.PlaneGeometry(w, h), mat, at(0, y, -0.042, 0, Math.PI, 0));
  return pb.build();
}

/**
 * Heavy armored sea-tunnel blast-gate portal (`4.0 m W x 5.0 m H`, wall-aligned on `-Z` edge).
 * Telescoping vertical-lift shutter leaves retract into the upper header (`x in [-1.95, +1.95]`),
 * revealing a deep matte-black sea-tunnel alcove. Listens to `transit:blast_gate` & `level:reset`.
 */
function transitBlastGate(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const h = Math.max(4.0, numParam(p, 'height', 5.0));
  const gateId = strParam(p, 'gateId', '');
  const boreW = 3.3;
  const boreH = 3.45;
  const hw = boreW / 2;
  const wallZ = -1.875;

  // Side jamb piers and upper header lintel (keeping 3.3 m x 3.45 m bore clear when open).
  const pierW = 2.0 - hw;
  for (const sx of [-1, 1]) {
    const px = sx * (hw + pierW / 2);
    pb.add(slab(pierW, h + 0.1, 0.38), pal.wallMain, at(px, h / 2, wallZ));
    pb.add(slab(0.12, boreH + 0.12, 0.44), pal.trim, at(sx * (hw + 0.04), boreH / 2, wallZ + 0.03));
    pb.add(slab(0.08, boreH - 0.2, 0.06), pal.hazard, at(sx * (hw + 0.14), boreH / 2, -1.66));
  }
  const headH = h + 0.05 - boreH;
  pb.add(slab(4.0, headH, 0.4), pal.wallMain, at(0, boreH + headH / 2, wallZ));
  pb.add(slab(boreW + 0.24, 0.16, 0.48), pal.trim, at(0, boreH + 0.08, wallZ + 0.04));
  pb.add(slab(boreW + 0.12, 0.1, 0.06), pal.hazard, at(0, boreH + 0.22, -1.64));

  // Dark sea-tunnel lining behind the gate. It is an open sleeve (sides, top, bottom) with nothing across the bore:
  // a train car and the player pass through it, and the shroud or tunnel continues straight behind.
  const tunnelDepth = 0.9;
  const tz = -2.0 - tunnelDepth / 2;
  pb.add(slab(0.08, boreH + 0.1, tunnelDepth), m.black, at(-hw - 0.02, boreH / 2, tz));
  pb.add(slab(0.08, boreH + 0.1, tunnelDepth), m.black, at(hw + 0.02, boreH / 2, tz));
  pb.add(slab(boreW + 0.1, 0.08, tunnelDepth), m.black, at(0, boreH + 0.02, tz));
  pb.add(slab(boreW + 0.1, 0.08, tunnelDepth), m.black, at(0, -0.02, tz));

  // Overhead sector stencil plate on the lintel.
  if (typeof document !== 'undefined') {
    const plate = paintedDecal(
      (ctx, cw, ch) => {
        ctx.fillStyle = '#14191e';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#e0a82e';
        ctx.fillRect(0, 0, cw, 10);
        ctx.fillRect(0, ch - 10, cw, 10);
        ctx.fillStyle = '#e4e8ec';
        ctx.font = '800 36px "Arial Narrow", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SECTOR 01 // SEA TUNNEL', cw / 2, ch * 0.63, cw - 40);
      },
      512,
      128,
      'transit-blast-gate-plate',
    );
    pb.add(new THREE.PlaneGeometry(2.8, 0.48), plate, at(0, boreH + 0.62, -1.655));
  }

  // Animated vertical-lift armored shutter leaves (contained strictly inside x in [-1.66, +1.66]).
  // A bright, lightly self-lit finish so the shutter reads from far down a dark hallway.
  const shutterMat = new THREE.MeshStandardMaterial({ color: 0xaebcc4, roughness: 0.45, metalness: 0.45, emissive: 0x2a3d45, emissiveIntensity: 1 });
  shutterMat.name = 'gate-shutter';
  const shutter = new THREE.Group();
  shutter.name = 'blast_gate_shutter';
  const leafLower = new THREE.Mesh(rounded(boreW - 0.04, 1.78, 0.18, 0.02), shutterMat);
  leafLower.position.set(0, 0.89, wallZ - 0.02);
  shutter.add(leafLower);
  const leafUpper = new THREE.Mesh(rounded(boreW - 0.04, 1.76, 0.14, 0.02), shutterMat);
  leafUpper.position.set(0, 2.6, wallZ + 0.04);
  shutter.add(leafUpper);
  const centerBar = new THREE.Mesh(slab(boreW - 0.12, 0.12, 0.22), pal.trim);
  centerBar.position.set(0, 1.76, wallZ + 0.02);
  shutter.add(centerBar);
  const sealStrip = new THREE.Mesh(slab(boreW - 0.16, 0.09, 0.2), pal.hazard);
  sealStrip.position.set(0, 0.07, wallZ + 0.02);
  shutter.add(sealStrip);
  // Hazard bands across both leaves, on the tunnel-side face a car approaches.
  for (const by of [0.55, 2.75]) {
    const band = new THREE.Mesh(slab(boreW - 0.2, 0.2, 0.05), pal.hazard);
    band.position.set(0, by, wallZ - 0.12);
    shutter.add(band);
  }
  // Level attaches dynamic parts to the room group keeping their world transform, so a part that is moved at runtime
  // lives under a root of its own and is moved relative to it (design Decision 12): this keeps a sealed shutter on the
  // floor in a sunken room such as R16a.
  const shutterRoot = new THREE.Group();
  shutterRoot.name = 'blast_gate_shutter_root';
  shutterRoot.add(shutter);
  pb.dynamic(shutterRoot);

  // Dual rail aspect signal lamps (amber-red when sealed -> emerald-green when open).
  const signalMat = fixtureMaterial(0xff4422, 1.6);
  signalMat.name = 'blast-gate-signal';
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 0.08), signalMat);
    lamp.position.set(sx * (hw + 0.16), boreH - 0.35, -1.63);
    pb.dynamic(lamp);
    // The same aspect on the tunnel side, so an approaching car sees the gate light up from afar.
    const tunnelLamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.08), signalMat);
    tunnelLamp.position.set(sx * (hw + 0.2), boreH - 0.5, -2.06);
    pb.dynamic(tunnelLamp);
  }
  const lintelBar = new THREE.Mesh(new THREE.BoxGeometry(boreW + 0.3, 0.1, 0.06), signalMat);
  lintelBar.position.set(0, boreH + 0.02, -2.06);
  pb.dynamic(lintelBar);

  let targetOpen = false;
  let progress = 0;
  /** Seconds a full open or close takes; a transit:blast_gate event may ask for faster. */
  let moveSeconds = 1.8;
  /** The shutter lifts clear of the bore (and of a car roof) into the header pocket. */
  const travel = boreH + 0.1;

  // Solid colliders for jambs, header, and toggleable shutter envelope.
  pb.solid(-2.0, 0, -2.02, -hw, h, -1.68);
  pb.solid(hw, 0, -2.02, 2.0, h, -1.68);
  pb.solid(-hw, boreH, -2.02, hw, h, -1.68);
  const shutterCollider = pb.solid(-hw, 0, -2.0, hw, boreH, -1.72);

  pb.on('transit:blast_gate', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const rec = payload as Record<string, unknown>;
    if (typeof rec['gateId'] === 'string' && gateId && rec['gateId'] !== gateId) return;
    targetOpen = rec['open'] !== false;
    moveSeconds = typeof rec['seconds'] === 'number' && rec['seconds'] > 0.2 ? Math.min(3, rec['seconds']) : 1.8;
    if (rec['instant'] === true) {
      progress = targetOpen ? 1 : 0;
      shutter.position.y = progress * travel;
      shutterCollider.setEnabled(!targetOpen);
    }
  });
  pb.on('level:reset', () => {
    targetOpen = false;
    moveSeconds = 1.8;
    progress = 0;
    shutter.position.y = 0;
    shutterCollider.setEnabled(true);
  });
  pb.tick((_t, dt) => {
    const target = targetOpen ? 1 : 0;
    if (progress !== target) {
      const step = Math.min(1, dt / moveSeconds);
      progress = progress < target ? Math.min(1, progress + step) : Math.max(0, progress - step);
    }
    const ease = progress * progress * (3 - 2 * progress);
    shutter.position.y = ease * travel;
    const open = progress > 0.85;
    shutterCollider.setEnabled(!open);
    if (open) {
      signalMat.color.setHex(0x38e8b8);
      signalMat.emissive.setHex(0x38e8b8);
      signalMat.emissiveIntensity = 2.0;
    } else {
      signalMat.color.setHex(0xff4422);
      signalMat.emissive.setHex(0xff4422);
      signalMat.emissiveIntensity = 1.6;
    }
  });

  return pb.build();
}

/**
 * Suspended/wall-mounted Departure Boarding Bay rail schedule board (`CanvasScreen`, facing -Z).
 */
function transitDepartBoard(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 2.4);
  const h = numParam(p, 'height', 1.1);
  const y = numParam(p, 'y', 3.15);
  const mode = strParam(p, 'mode', 'departure') === 'arrival' ? 'arrival' : 'departure';

  pb.add(rounded(w + 0.14, h + 0.14, 0.16, 0.02), pal.doorPanel, at(0, y, 0));
  pb.add(slab(w + 0.18, 0.06, 0.18), pal.trim, at(0, y + h / 2 + 0.07, 0));
  pb.add(slab(w + 0.18, 0.06, 0.18), pal.trim, at(0, y - h / 2 - 0.07, 0));
  for (const sx of [-w * 0.36, w * 0.36]) {
    pb.add(slab(0.06, 1.4, 0.06), pal.trim, at(sx, y + h / 2 + 0.72, 0));
  }

  let screen: CanvasScreen | null = null;
  if (typeof document !== 'undefined') {
    screen = new CanvasScreen(
      512,
      256,
      (ctx, cw, ch, t) => {
        ctx.fillStyle = '#071117';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#12303c';
        ctx.fillRect(0, 0, cw, 52);
        ctx.fillStyle = mode === 'arrival' ? '#e0a82e' : '#48d8e8';
        ctx.fillRect(0, 48, cw, 4);
        ctx.fillStyle = '#e8f4f8';
        ctx.font = `bold 24px ${SCREEN_FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('TRANSIT LINE 01 // ARRIVAL TERMINAL', 20, 34);
        ctx.fillStyle = '#e0a82e';
        ctx.font = `bold 20px ${SCREEN_FONT}`;
        ctx.fillText(
          mode === 'arrival' ? 'PLATFORM B   |   ARRIVAL TRACK DOCK' : 'PLATFORM A   |   SHUTTLE CAR 01',
          20,
          96,
        );
        ctx.fillStyle = '#9ec4d0';
        ctx.font = `18px ${SCREEN_FONT}`;
        ctx.fillText(
          mode === 'arrival' ? 'PROCEED WEST -> CONCOURSE & CHECK-IN' : 'ROUTE: R15A DEPARTURE -> SEA TUNNEL -> R16A',
          20,
          140,
        );
        const blink = Math.floor(t * 2) % 2 === 0;
        ctx.fillStyle = mode === 'arrival' ? '#f0b840' : '#38e8b8';
        ctx.font = `bold 22px ${SCREEN_FONT}`;
        const statusText = mode === 'arrival' ? 'STATUS: DOCKED // AWAITING CLEARANCE' : 'STATUS: BOARDING // CLEAR TO DEPART';
        ctx.fillText(blink ? `${statusText} _` : statusText, 20, 198);
      },
      0.45,
    );
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screen ? screen.material : pal.doorPanel);
  face.name = 'transit_board_face';
  face.userData['boardMode'] = mode;
  face.applyMatrix4(at(0, y, -0.085, 0, Math.PI, 0));
  pb.dynamic(face);
  if (screen) pb.tick((t) => screen!.update(t));
  return pb.build();
}

/**
 * Brushed-steel platform safety handrail + flush yellow tactile edge strip (along Z, facing -X/+X).
 */
function platformRailing(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const len = Math.max(1.2, numParam(p, 'length', 5.6));
  const railH = 1.04;
  const hl = len / 2;

  // Flush yellow tactile hazard edge strip (never snags capsule).
  pb.add(slab(0.24, 0.008, len), pal.hazard, at(0.14, 0.004, 0));
  // Top & mid rails + end/intermediate posts.
  pb.add(rounded(0.055, 0.055, len, 0.015), pal.trim, at(0, railH, 0));
  pb.add(slab(0.035, 0.035, len), pal.trim, at(0, railH * 0.54, 0));
  const posts = Math.max(2, Math.round(len / 1.4) + 1);
  for (let i = 0; i < posts; i++) {
    const pz = -hl + 0.06 + ((len - 0.12) * i) / (posts - 1);
    pb.add(slab(0.05, railH, 0.05), pal.doorPanel, at(0, railH / 2, pz));
    pb.add(slab(0.12, 0.02, 0.12), pal.trim, at(0, 0.01, pz));
  }
  pb.solid(-0.08, 0, -hl, 0.08, railH + 0.05, hl, 'metal');
  return pb.build();
}

let tunnelSteelMat: THREE.MeshStandardMaterial | undefined;
/** Tunnel steel with a dim teal emissive base: the ride tunnel has no room lights of its own. */
function tunnelSteel(): THREE.MeshStandardMaterial {
  if (!tunnelSteelMat) {
    tunnelSteelMat = new THREE.MeshStandardMaterial({ color: 0x33454e, roughness: 0.6, metalness: 0.4, emissive: 0x0b2f38, emissiveIntensity: 1 });
    tunnelSteelMat.name = 'transit-tunnel-steel';
    tunnelSteelMat.userData['flat'] = true;
  }
  return tunnelSteelMat;
}

/** The ride tunnel's cross-section, shared by the R15a/R16a shrouds and the Stage 2 rig so the look never changes. */
const BORE = { w: 4.2, h: 4.0, panelLo: 1.0, panelHi: 3.6 } as const;

interface BoreTarget {
  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4): void;
}

interface BoreOptions {
  /** Length along Z, centred on 0. */
  len: number;
  /** Z of each rib (a column pair, an arch and two lit guide bars). */
  ribs: number[];
  roofLight: THREE.Material;
  guideLight: THREE.Material;
  /** The wall texture between the lights (a palette wall material with a faint cold fill). */
  wallMat: THREE.Material;
  ceilingMat: THREE.Material;
}

/**
 * One length of the ride hallway (openspec train-interior-abyssal-ride, user-approved look): a closed, lit steel hallway.
 * Dark steel deck and roof, textured wall panels between lit rib bars, a lit roof strip and lit guide strips, panel seams
 * every metre (they give the speed of the ride something to read against), and polished rails on sleepers. No windows.
 */
function buildBore(t: BoreTarget, o: BoreOptions): void {
  const { w, h, panelLo, panelHi } = BORE;
  const hw = w / 2;
  const steel = tunnelSteel();
  t.mesh(slab(w, 0.14, o.len), steel, at(0, -0.07, 0));
  t.mesh(slab(w, 0.14, o.len), steel, at(0, h + 0.07, 0));
  t.mesh(slab(0.3, 0.02, o.len - 0.4), o.roofLight, at(0, h - 0.01, 0));
  for (const sx of [-1, 1]) {
    const wx = sx * (hw + 0.07);
    // Full-height wall in the wall texture, with steel dado and cornice rails and a seam every metre.
    t.mesh(slab(0.14, h, o.len), o.wallMat, at(wx, h / 2, 0));
    t.mesh(slab(0.18, 0.1, o.len), steel, at(sx * (hw + 0.01), panelLo, 0));
    t.mesh(slab(0.18, 0.1, o.len), steel, at(sx * (hw + 0.01), panelHi, 0));
    for (let z = -o.len / 2 + 0.5; z < o.len / 2; z += 1) {
      t.mesh(slab(0.05, panelHi - panelLo - 0.1, 0.05), steel, at(sx * (hw - 0.015), (panelLo + panelHi) / 2, z));
    }
    t.mesh(slab(0.05, 0.04, o.len - 0.4), o.guideLight, at(sx * (hw - 0.12), 0.18, 0));
  }
  for (const z of o.ribs) {
    t.mesh(slab(0.18, h - 0.1, 0.18), steel, at(-hw + 0.09, h / 2, z));
    t.mesh(slab(0.18, h - 0.1, 0.18), steel, at(hw - 0.09, h / 2, z));
    t.mesh(slab(w, 0.18, 0.18), steel, at(0, h - 0.09, z));
    t.mesh(slab(0.05, 0.9, 0.05), o.guideLight, at(-hw + 0.2, 1.5, z));
    t.mesh(slab(0.05, 0.9, 0.05), o.guideLight, at(hw - 0.2, 1.5, z));
  }
  // Sleepers every metre (so adjoining segments tile) and polished rails (heads at RAIL_TOP, under the lifted car).
  for (let z = -o.len / 2 + 0.5; z < o.len / 2; z += 1) {
    t.mesh(slab(1.9, 0.05, 0.2), o.ceilingMat, at(0, 0.025, z));
  }
  for (const sx of [-1, 1]) {
    t.mesh(slab(0.08, RAIL_TOP - 0.05, o.len), railMaterial(), at(sx * RAIL_HALF_GAUGE, (RAIL_TOP + 0.05) / 2, 0));
  }
}

/** A palette wall material with the tunnel's faint cold emissive fill, so the wall texture reads without room lights. */
function hallWall(pal: { wallMain: THREE.Material }): THREE.Material {
  const c = pal.wallMain.clone();
  if (c instanceof THREE.MeshStandardMaterial) {
    c.emissive = new THREE.Color(0x0b2a33);
    c.emissiveIntensity = 0.5;
  }
  return c;
}

/**
 * Fake black fog for an open end of the hallway (design Decision 14): a few transparent black planes across the bore that
 * thicken to solid black at `endZ`, so the player never sees the hard edge of the hallway ahead. `dir` is +1 when the end
 * is at +Z (the planes thicken toward it) and -1 for -Z.
 */
function hallFog(endZ: number, dir: 1 | -1, spacing: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hall_fog';
  const opacity = [1, 0.82, 0.58, 0.32];
  for (let k = 0; k < opacity.length; k++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: opacity[k]!, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    mat.name = 'hall-fog';
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.4), mat);
    plane.position.set(0, 2.1, endZ - dir * k * spacing);
    plane.renderOrder = 6;
    plane.frustumCulled = false;
    g.add(plane);
  }
  return g;
}

/**
 * Tunnel extension shroud behind R15a south & R16a north blast gates so Stage 1 pull-out and Stage 3 glide-in travel
 * through the lit hallway (the same hallway as Stage 2, so the ride is one continuous place).
 */
function transitTunnelShroud(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const len = numParam(p, 'length', 18.0);
  const roofLight = fixtureMaterial(0x9fe8ff, 2.4);
  roofLight.name = 'shroud-roof-light';
  const guideLight = fixtureMaterial(0x38e8d8, 2.0);
  guideLight.name = 'shroud-guide-light';
  const ribs: number[] = [];
  for (let z = -len / 2 + 1.5; z <= len / 2 - 1.0; z += 3.0) ribs.push(z);
  buildBore({ mesh: (g, mat, mx) => void pb.add(g, mat, mx) }, { len, ribs, roofLight, guideLight, wallMat: hallWall(pal), ceilingMat: pal.ceiling });
  pb.solid(-1.6, -0.04, -len / 2, 1.6, 0.02, len / 2, 'metal');
  // The open end (away from the blast gate) fades to black: 'south' (R15a's shroud), 'north' (R16a's) or 'both'.
  const fogEnd = strParam(p, 'fog', 'none');
  if (fogEnd === 'south' || fogEnd === 'both') pb.dynamic(hallFog(len / 2 - 0.05, 1, 1.0));
  if (fogEnd === 'north' || fogEnd === 'both') pb.dynamic(hallFog(-len / 2 + 0.05, -1, 1.0));
  return pb.build();
}

let darkBoreMat: THREE.MeshStandardMaterial | undefined;
/** Unlit tunnel steel for the switched-off bore past R16a's car: no emissive, so only the room lights ever touch it. */
function darkBoreSteel(): THREE.MeshStandardMaterial {
  if (!darkBoreMat) {
    darkBoreMat = new THREE.MeshStandardMaterial({ color: 0x1a2328, roughness: 0.75, metalness: 0.35 });
    darkBoreMat.name = 'transit-dark-bore-steel';
    darkBoreMat.userData['flat'] = true;
  }
  return darkBoreMat;
}

/**
 * The tunnel the track runs on into past R16a's parked car (openspec r16a-perpendicular-train-arrival, Decision 3): the ride
 * hallway with its lights off. Local frame: the room's wall plane is z = 0 (the room is at -Z), and the bore runs out of
 * it toward +Z for `length`. The piece owns the wall across its 4 m cell edge: piers and a header (`wallHeight` tall)
 * around an open `width` x `height` portal with a dark steel frame, then a steel liner (dark, no emissive, no rib bars or
 * guide strips) closed at the far end by black fog planes that thicken to solid black. Everything but the portal is solid.
 */
function transitDarkBore(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 3.4);
  const h = numParam(p, 'height', 3.4);
  const len = numParam(p, 'length', 6.0);
  const wallH = numParam(p, 'wallHeight', 5.0);
  const steel = darkBoreSteel();
  const hw = w / 2;
  const t = 0.1;
  const wallT = 0.25;
  // The wall across the cell edge: piers either side of the portal and a header above it (inward only, like a kit wall).
  const pierW = 2.0 - hw;
  for (const sx of [-1, 1]) {
    pb.add(slab(pierW, wallH + 0.05, wallT), pal.wallMain, at(sx * (hw + pierW / 2), wallH / 2, -wallT / 2));
    pb.solid(sx > 0 ? hw : -2.0, 0, -wallT, sx > 0 ? 2.0 : -hw, wallH, 0, 'metal');
    // Dark steel jamb trim around the portal.
    pb.add(slab(0.12, h, 0.34), steel, at(sx * (hw + 0.04), h / 2, -wallT / 2 - 0.02));
  }
  const headH = wallH + 0.05 - h;
  pb.add(slab(4.0, headH, wallT), pal.wallMain, at(0, h + headH / 2, -wallT / 2));
  pb.add(slab(w + 0.24, 0.14, 0.34), steel, at(0, h - 0.07, -wallT / 2 - 0.02));
  pb.solid(-2.0, h, -wallT, 2.0, wallH, 0, 'metal');
  // Liner side walls and roof, and a solid cap at the far end.
  for (const sx of [-1, 1]) {
    pb.add(slab(t, h, len), steel, at(sx * (hw + t / 2), h / 2, len / 2));
    pb.solid(sx > 0 ? hw : -hw - t, 0, 0, sx > 0 ? hw + t : -hw, h, len, 'metal');
  }
  pb.add(slab(w + 2 * t, t, len), steel, at(0, h + t / 2, len / 2));
  pb.solid(-hw - t, h, 0, hw + t, h + t, len, 'metal');
  pb.solid(-hw, 0, len - 0.3, hw, h + t, len, 'metal');
  // A floor, so nothing that gets in can fall out of the world under the walls and the cap.
  pb.solid(-hw - t, -0.3, 0, hw + t, 0, len, 'metal');
  // Black fog planes, solid at the far end, so the bore reads as continuing into the dark.
  const fog = new THREE.Group();
  fog.name = 'dark_bore_fog';
  const spacing = Math.min(1.0, (len - 0.4) / 4);
  const opacity = [1, 0.82, 0.58, 0.32];
  for (let k = 0; k < opacity.length; k++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: opacity[k]!, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    mat.name = 'dark-bore-fog';
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.position.set(0, h / 2, len - 0.12 - k * spacing);
    plane.renderOrder = 6;
    plane.frustumCulled = false;
    fog.add(plane);
  }
  pb.dynamic(fog);
  return pb.build();
}

/**
 * Infinite-scrolling hallway rig for Stage 2 of the abyssal ride: the same lit hallway as the shrouds, in segments that
 * scroll past the stationary train cabin. Lights fade into the dark at both ends, so the hallway seen on pull-out runs
 * unchanged through the whole ride and into the R16a glide-in.
 */
function transitSeaTunnelRig(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const segCount = 9;
  const segLen = 6.0;
  const totalLen = segCount * segLen;
  const halfSpan = totalLen / 2;

  const rings: Array<{ group: THREE.Group; lights: Array<{ mat: THREE.MeshStandardMaterial; base: number }> }> = [];
  // The rings scroll along Z relative to this root (Level keeps a dynamic part's world transform, so the root carries the
  // rig's place in the room and the rings only ever hold offsets from it).
  const rigRoot = new THREE.Group();
  rigRoot.name = 'sea_tunnel_rig_root';
  pb.dynamic(rigRoot);
  const wallMat = hallWall(pal);
  // Black fog at both ends of the hallway hides the wrap-around of the rings and the far end.
  pb.dynamic(hallFog(halfSpan, 1, 2.0));
  pb.dynamic(hallFog(-halfSpan, -1, 2.0));
  // The closed blast gate that approaches at the end of Stage 2. It is the same piece as R16a's north gate, so the cut to
  // R16a (a closed gate this far ahead of an identical hallway) cannot be seen. It lives under a holder, like the rings.
  const gatePiece = transitBlastGate({ ...p, gateId: 'rig_gate', height: 5 }, _rng, m);
  const gateHolder = new THREE.Group();
  gateHolder.name = 'rig_gate_holder';
  const gateRoot = gatePiece.object;
  gateRoot.name = 'rig_gate_root';
  gateRoot.visible = false;
  gateHolder.add(gateRoot);
  pb.dynamic(gateHolder);
  let gateArmed = false;
  let gateExplicit = false;
  let gateWallZ = RIG_GATE_START_Z;
  const placeGate = (): void => {
    gateRoot.position.z = gateWallZ + 1.875; // the gate piece's wall is 1.875 m from its origin
    gateRoot.visible = gateArmed;
  };
  placeGate();
  for (let i = 0; i < segCount; i++) {
    const ring = new THREE.Group();
    ring.name = `sea_tunnel_ring_${i}`;
    // Per-ring light materials so the lit strips can fade out toward the ends of the hallway.
    const roofLight = fixtureMaterial(0x9fe8ff, 2.4);
    roofLight.name = 'rig-roof-light';
    const guideLight = fixtureMaterial(0x38e8d8, 2.0);
    guideLight.name = 'rig-guide-light';
    buildBore(
      {
        mesh: (g, mat, mx) => {
          const mesh = new THREE.Mesh(g, mat);
          mesh.applyMatrix4(mx);
          ring.add(mesh);
        },
      },
      { len: segLen, ribs: [-1.5, 1.5], roofLight, guideLight, wallMat, ceilingMat: pal.ceiling },
    );
    rigRoot.add(ring);
    rings.push({
      group: ring,
      lights: [
        { mat: roofLight as THREE.MeshStandardMaterial, base: 2.4 },
        { mat: guideLight as THREE.MeshStandardMaterial, base: 2.0 },
      ],
    });
  }

  let active = p['autoScroll'] === true;
  let speed = numParam(p, 'speed', 20);
  let scrollOffset = 0;

  const updatePositions = (): void => {
    for (let i = 0; i < segCount; i++) {
      const z = -halfSpan + ((i * segLen - scrollOffset + totalLen * 2) % totalLen);
      const r = rings[i]!;
      r.group.position.z = z;
      // Lit strips fade into the dark at the far ends, hiding the wrap-around.
      const fade = Math.max(0, Math.min(1, 1 - Math.max(0, Math.abs(z) - (halfSpan - 10)) / 10));
      for (const l of r.lights) l.mat.emissiveIntensity = l.base * fade;
    }
  };
  updatePositions();

  pb.on('transit:tunnel_scroll', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const rec = payload as Record<string, unknown>;
    if (typeof rec['active'] === 'boolean') active = rec['active'];
    if (typeof rec['speed'] === 'number' && Number.isFinite(rec['speed'])) speed = rec['speed'];
    updatePositions();
  });
  pb.on('transit:rig_gate', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const rec = payload as Record<string, unknown>;
    gateArmed = rec['arm'] === true;
    if (typeof rec['wallZ'] === 'number' && Number.isFinite(rec['wallZ'])) {
      gateExplicit = true;
      gateWallZ = Math.max(RIG_GATE_FINAL_Z, rec['wallZ']);
    } else {
      gateExplicit = false;
      gateWallZ = RIG_GATE_START_Z;
    }
    placeGate();
  });
  pb.on('level:reset', () => {
    active = p['autoScroll'] === true;
    speed = numParam(p, 'speed', 20);
    scrollOffset = 0;
    gateArmed = false;
    gateExplicit = false;
    gateWallZ = RIG_GATE_START_Z;
    placeGate();
    updatePositions();
  });
  pb.tick((_t, dt) => {
    if (!active) return;
    scrollOffset = (scrollOffset + speed * dt) % totalLen;
    // The gate rides the scroll toward the car and stops where R16a's closed gate will be (unless driven analytically).
    if (gateArmed && !gateExplicit) {
      gateWallZ = Math.max(RIG_GATE_FINAL_Z, gateWallZ - speed * dt);
      placeGate();
    }
    updatePositions();
  });

  return pb.build();
}


const beaconBeamMatCache = new Map<string, THREE.MeshBasicMaterial>();
function beaconBeamMaterial(key: string, color: number): THREE.MeshBasicMaterial {
  let mat = beaconBeamMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.name = `transit-${key}`;
    beaconBeamMatCache.set(key, mat);
  }
  return mat;
}

const beaconLensMatCache = new Map<string, THREE.MeshStandardMaterial>();
function beaconLensMaterial(key: string, color: number, emissiveIntensity: number): THREE.MeshStandardMaterial {
  let mat = beaconLensMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity,
      roughness: 0.18,
      metalness: 0.05,
    });
    mat.name = `transit-${key}`;
    beaconLensMatCache.set(key, mat);
  }
  return mat;
}

/**
 * Wall/pillar-mounted red rotating emergency beacon (facing -Z from mount plane at z = 0).
 * Dark until `transit:r16_beacons` { on: true }; swaps rotating cones for a steady red lens under reducedFlashing.
 */
function transitRotatingBeacon(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const phase = numParam(p, 'phase', 0);
  const beamLen = numParam(p, 'beamLength', 3.4);
  const claimLight = boolParam(p, 'light', true);

  // Wall mounting plate, horizontal arm, housing collar, and protective dome cage.
  pb.add(rounded(0.22, 0.22, 0.04, 0.01), pal.doorPanel, at(0, 0, -0.02));
  pb.add(rounded(0.08, 0.08, 0.16, 0.01), pal.trim, at(0, -0.04, -0.1));
  pb.add(new THREE.CylinderGeometry(0.085, 0.095, 0.07, 16), pal.doorPanel, at(0, 0.015, -0.16));
  // Dark unlit ruby dome shell visible when beacon is off.
  pb.add(new THREE.CylinderGeometry(0.068, 0.075, 0.13, 14), flatPaint('beacon-dome-off', 0x4a0c0c, 0.22, 0.1), at(0, 0.11, -0.16));
  pb.add(new THREE.SphereGeometry(0.068, 14, 10), flatPaint('beacon-dome-off', 0x4a0c0c, 0.22, 0.1), at(0, 0.175, -0.16));
  // Thin protective wire guard ring.
  pb.add(new THREE.TorusGeometry(0.084, 0.008, 6, 16).rotateX(Math.PI / 2), pal.trim, at(0, 0.12, -0.16));

  // Twin opposing volumetric red beams rotating around the dome's Y axis.
  const coneA = new THREE.ConeGeometry(0.55, beamLen, 14, 1, true).rotateZ(-Math.PI / 2).translate(beamLen / 2, 0, 0);
  const coneB = new THREE.ConeGeometry(0.55, beamLen, 14, 1, true).rotateZ(Math.PI / 2).translate(-beamLen / 2, 0, 0);
  const core = new THREE.SphereGeometry(0.082, 14, 10);
  const rotorGeo = mergeGeometries([core.toNonIndexed(), coneA.toNonIndexed(), coneB.toNonIndexed()], false)!;
  const rotor = new THREE.Mesh(rotorGeo, beaconBeamMaterial('red-beacon-beam', 0xff2218));
  rotor.position.set(0, 0.12, -0.16);
  rotor.name = 'r16_beacon_rotor';
  rotor.visible = false;
  pb.dynamic(rotor);

  // Steady glowing red lens shown when `reducedFlashing` is active.
  const steady = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 14, 10),
    beaconLensMaterial('red-beacon-steady', 0xff281c, 3.2),
  );
  steady.position.set(0, 0.12, -0.16);
  steady.name = 'r16_beacon_steady';
  steady.visible = false;
  pb.dynamic(steady);

  if (claimLight) pb.light([0, 0.12, -0.26], 'emergency');

  const defaultOn = boolParam(p, 'defaultOn', false);
  let on = defaultOn;
  pb.tick((t) => {
    rotor.visible = on && !flashingState.reduced;
    steady.visible = on && flashingState.reduced;
    rotor.rotation.y = t * 4.2 + phase;
  });
  pb.on('transit:r16_beacons', (e) => {
    on = (e as { on?: boolean } | undefined)?.on === true;
  });
  pb.on('level:reset', () => {
    on = defaultOn;
  });

  return pb.build();
}

const BLOOD_VARIANTS: Record<string, readonly string[]> = {
  pool: ['pool_01', 'pool_02', 'pool_03', 'pool_04', 'pool_05'],
  spatter: ['spatter_01', 'spatter_02', 'spatter_03', 'spatter_04', 'spatter_05'],
  smear: ['smear_01', 'smear_02', 'smear_03', 'smear_04'],
  leak: ['leak_01', 'leak_02', 'leak_03'],
  drag: ['smear_01', 'smear_02', 'smear_03', 'smear_04'],
  drop: ['drop_01', 'drop_02', 'drop_03'],
};

let bloodLoader: THREE.TextureLoader | null = null;
const bloodMatCache = new Map<string, THREE.MeshStandardMaterial>();
function bloodTextureMaterial(variant: string, seed: string, explicitTex: string): THREE.MeshStandardMaterial {
  const pool = BLOOD_VARIANTS[variant] ?? BLOOD_VARIANTS['pool']!;
  const hash = Math.abs(seed.split('').reduce((h, c) => ((h * 31) ^ c.charCodeAt(0)) | 0, 0));
  const texName = explicitTex || pool[hash % pool.length]!;
  const key = `blood-tex-${texName}`;
  let mat = bloodMatCache.get(key);
  if (mat) return mat;

  let map: THREE.Texture | null = null;
  if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
    if (!bloodLoader) bloodLoader = new THREE.TextureLoader();
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    map = bloodLoader.load(`${base}assets/textures/blood/${texName}.webp`);
    map.colorSpace = THREE.SRGBColorSpace;
    trackAnisotropy(map);
  }

  mat = new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : 0x3b0404,
    map,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    roughness: 0.16,
    metalness: 0.06,
  });
  mat.name = key;
  bloodMatCache.set(key, mat);
  return mat;
}

/**
 * Glossy dark-red CC0 photographic blood decal for floors (`surface: 'floor'`) or walls/pillars (`surface: 'wall'`).
 * Zero colliders; shares cached materials per texture asset in `public/assets/textures/blood/`.
 * Optional `count > 1` stamps a dense deterministic cluster of overlapping decals across `spreadW` x `spreadH`.
 */
const ALL_FLOOR_BLOOD = [
  'pool_01', 'pool_02', 'pool_03', 'pool_04', 'pool_05',
  'spatter_01', 'spatter_02', 'spatter_03', 'spatter_04', 'spatter_05',
  'smear_01', 'smear_02', 'smear_03', 'smear_04',
  'drop_01', 'drop_02', 'drop_03',
] as const;

const ALL_WALL_BLOOD = [
  'spatter_01', 'spatter_02', 'spatter_03', 'spatter_04', 'spatter_05',
  'smear_01', 'smear_02', 'smear_03', 'smear_04',
  'leak_01', 'leak_02', 'leak_03',
  'pool_01', 'pool_02', 'pool_03', 'pool_04', 'pool_05',
  'drop_01', 'drop_02', 'drop_03',
] as const;

function bloodDecalProp(p: PieceParams): PieceOutput {
  const pb = new PieceBuilder();
  const surface = strParam(p, 'surface', 'floor') === 'wall' ? 'wall' : 'floor';
  const variant = strParam(p, 'variant', surface === 'wall' ? 'leak' : 'pool');
  const explicitTex = strParam(p, 'tex', '');
  const w = numParam(p, 'width', 1.6);
  const h = numParam(p, 'height', 1.6);
  const seed = strParam(p, 'seed', 'r16');
  const count = Math.max(1, Math.round(numParam(p, 'count', 1)));

  if (count === 1) {
    const mat = bloodTextureMaterial(variant, seed, explicitTex);
    const geo = new THREE.PlaneGeometry(w, h);
    if (surface === 'floor') {
      pb.add(geo, mat, at(0, 0.008, 0, -Math.PI / 2, 0, 0));
    } else {
      const y = numParam(p, 'y', h / 2);
      pb.add(geo, mat, at(0, y, -0.008, 0, Math.PI, 0));
    }
    return pb.build();
  }

  const spreadW = numParam(p, 'spreadW', w * 2.2);
  const spreadH = numParam(p, 'spreadH', h * 2.0);
  const baseY = numParam(p, 'y', h / 2);
  const pool = surface === 'floor' ? ALL_FLOOR_BLOOD : ALL_WALL_BLOOD;
  let state = Math.abs(seed.split('').reduce((acc, c) => ((acc * 31) ^ c.charCodeAt(0)) | 0, 0)) || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    const texName = explicitTex || pool[Math.floor(next() * pool.length)]!;
    const mat = bloodTextureMaterial(variant, seed, texName);
    const sw = w * (0.65 + next() * 0.85);
    const sh = h * (0.65 + next() * 0.85);
    const dx = (next() - 0.5) * spreadW;
    const d2 = (next() - 0.5) * spreadH;
    const lift = 0.008 + (i % 10) * 0.0014;
    const geo = new THREE.PlaneGeometry(sw, sh);
    if (surface === 'floor') {
      const yaw = next() * Math.PI * 2;
      pb.add(geo, mat, at(dx, lift, d2, -Math.PI / 2, 0, yaw));
    } else {
      const isLeak = texName.startsWith('leak_');
      const roll = isLeak ? (next() - 0.5) * 0.16 : (next() - 0.5) * 1.4;
      pb.add(geo, mat, at(dx, Math.max(sh * 0.35, baseY + d2), -lift, 0, Math.PI, roll));
    }
  }
  return pb.build();
}

const FALLEN_BODY_MODELS: Record<string, string> = {
  guard1: 'assets/models/crew/guard_1.glb',
  office1: 'assets/models/crew/office_1.glb',
  office2: 'assets/models/crew/office_2.glb',
  office3: 'assets/models/crew/office_3.glb',
  botanist1: 'assets/models/crew/botanist_1.glb',
};

const bloodImgCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadBloodImage(texName: string): Promise<HTMLImageElement | null> {
  let p = bloodImgCache.get(texName);
  if (p) return p;
  p = new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null);
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${base}assets/textures/blood/${texName}.webp`;
  });
  bloodImgCache.set(texName, p);
  return p;
}

function applyBloodOverlayToMaterial(mat: THREE.Material, bloodImg: HTMLImageElement | null, seed: number): THREE.Material {
  if (!(mat instanceof THREE.MeshStandardMaterial) || !bloodImg || typeof document === 'undefined') return mat;
  const cloned = mat.clone();
  const srcImg = cloned.map?.image as (HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined);
  const w = 512;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return cloned;

  if (srcImg) {
    try {
      ctx.drawImage(srcImg as CanvasImageSource, 0, 0, w, h);
    } catch {
      ctx.fillStyle = `#${cloned.color.getHexString()}`;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = `#${cloned.color.getHexString()}`;
    ctx.fillRect(0, 0, w, h);
  }

  // Stamp 3 varied dark-blood splatters across the UV map so torso, limbs, and clothes are heavily bloodied.
  for (let i = 0; i < 3; i++) {
    const a = ((seed * 1.7 + i * 2.1) % 6.28);
    const sx = ((seed * 97 + i * 173) % 340) + 86;
    const sy = ((seed * 131 + i * 199) % 340) + 86;
    const sz = 210 + ((seed * 53 + i * 71) % 160);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(bloodImg, -sz / 2, -sz / 2, sz, sz);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloodImg, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = cloned.map ? cloned.map.flipY : false;
  trackAnisotropy(tex);
  cloned.map = tex;
  cloned.roughness = Math.min(cloned.roughness, 0.52);
  cloned.needsUpdate = true;
  return cloned;
}

function relaxCorpseBones(scene: THREE.Object3D, pose: string): void {
  const s = pose === 'faceup' ? -1 : 1;
  scene.traverse((o) => {
    if (!(o instanceof THREE.Bone)) return;
    const n = o.name.toLowerCase();
    if (n.includes('leftarm') || n.includes('upperarm_l') || n.includes('arm_l')) {
      o.rotation.z += 0.95;
      o.rotation.x += 0.35 * s;
    } else if (n.includes('rightarm') || n.includes('upperarm_r') || n.includes('arm_r')) {
      o.rotation.z -= 0.85;
      o.rotation.x -= 0.25 * s;
    } else if (n.includes('leftforearm') || n.includes('lowerarm_l')) {
      o.rotation.y += 0.45;
    } else if (n.includes('rightforearm') || n.includes('lowerarm_r')) {
      o.rotation.y -= 0.55;
    } else if (n.includes('leftupleg') || n.includes('thigh_l')) {
      o.rotation.z += 0.14;
      o.rotation.x += 0.18 * s;
    } else if (n.includes('rightupleg') || n.includes('thigh_r')) {
      o.rotation.z -= 0.22;
      o.rotation.x -= 0.12 * s;
    } else if (n.includes('rightleg') || n.includes('calf_r') || n.includes('shin_r')) {
      o.rotation.x += 0.45;
    } else if (n.includes('head')) {
      o.rotation.y += 0.42 * s;
      o.rotation.z += 0.22;
    }
  });
}

/**
 * Grounded, uncollided high-fidelity fallen crew body (movable via `Level.setPropTransform`).
 * Loads a rigged crew GLB in the browser, poses it on the floor, and composites dark blood textures onto its materials.
 */
function fallenBody(p: PieceParams): PieceOutput {
  const pb = new PieceBuilder();
  const root = new THREE.Group();
  root.name = 'fallen_body';
  const id = strParam(p, 'id', '');
  if (id) root.userData['propId'] = id;

  const variant = strParam(p, 'variant', 'guard1');
  const pose = strParam(p, 'pose', 'facedown');
  const bloodTex = strParam(p, 'bloodTex', 'spatter_02');
  const modelUrl = FALLEN_BODY_MODELS[variant] ?? FALLEN_BODY_MODELS['guard1']!;
  root.userData['bodyVariant'] = variant;

  // Lightweight fallback silhouette shown in headless Node tests and replaced once the GLB finishes loading in browser.
  const fallback = new THREE.Mesh(
    rounded(0.42, 0.22, 1.65, 0.06),
    flatPaint('crew-fallback', 0x222c36, 0.72, 0.08),
  );
  fallback.position.set(0, 0.11, 0);
  root.add(fallback);

  if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const seed = Math.abs((id || variant).split('').reduce((h, ch) => ((h * 31) ^ ch.charCodeAt(0)) | 0, 0));
    void Promise.all([
      import('../../render/gltf.ts').then(({ createGltfLoader }) => createGltfLoader()).then((l) => l.loadAsync(`${base}${modelUrl}`)),
      loadBloodImage(bloodTex),
    ]).then(([gltf, bloodImg]) => {
      const model = gltf.scene;
      // Measure standing bounds and normalize height to ~1.74 m.
      model.updateMatrixWorld(true);
      const rawBox = new THREE.Box3().setFromObject(model);
      const rawH = rawBox.max.y - rawBox.min.y;
      const scale = rawH > 0.2 ? 1.74 / rawH : 1;
      model.scale.setScalar(scale);

      // Pose bones out of T-pose and composite blood splatter directly onto the crew textures.
      relaxCorpseBones(model, pose);
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m, idx) => applyBloodOverlayToMaterial(m, bloodImg, seed + idx));
        } else if (o.material) {
          o.material = applyBloodOverlayToMaterial(o.material, bloodImg, seed);
        }
      });

      const wrapper = new THREE.Group();
      wrapper.add(model);
      if (pose === 'faceup') {
        wrapper.rotation.x = -Math.PI / 2;
      } else if (pose === 'side') {
        wrapper.rotation.x = Math.PI / 2;
        wrapper.rotation.y = 0.65;
      } else {
        wrapper.rotation.x = Math.PI / 2;
      }
      wrapper.updateMatrixWorld(true);
      const posedBox = new THREE.Box3().setFromObject(wrapper);
      if (Number.isFinite(posedBox.min.y)) {
        wrapper.position.y -= posedBox.min.y - 0.01;
      }

      root.remove(fallback);
      root.add(wrapper);
      root.updateMatrixWorld(true);
    }).catch(() => {
      // Keep fallback mesh if GLB fails to load.
    });
  }

  pb.dynamic(root);
  return pb.build();
}

/**
 * Grand Arrival Concourse overhead structural ceiling truss (`span` along X, anchored at floor y = 0,
 * hanging from `height` ceiling down to `height - 1.05 m`, zero floor colliders).
 */
function concourseTruss(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const span = numParam(p, 'span', 19.4);
  const h = numParam(p, 'height', 8.0);
  const depth = numParam(p, 'depth', 0.42);
  const topY = h - 0.08;
  const botY = h - 0.96;
  const midY = (topY + botY) / 2;

  // Upper & lower steel I-beam chords spanning the full concourse width.
  pb.add(slab(span, 0.14, depth + 0.12), pal.doorPanel, at(0, topY, 0));
  pb.add(slab(span, 0.16, depth + 0.14), pal.doorPanel, at(0, botY, 0));
  pb.add(slab(span, 0.045, depth + 0.18), pal.trim, at(0, botY - 0.09, 0));
  // Recessed web plates & vertical architectural stiffeners.
  pb.add(slab(span - 0.2, topY - botY - 0.12, depth * 0.45), pal.wallMain, at(0, midY, 0));
  const ribs = Math.max(4, Math.round(span / 2.4));
  for (let i = 0; i <= ribs; i++) {
    const x = -span / 2 + 0.35 + ((span - 0.7) * i) / ribs;
    pb.add(slab(0.12, topY - botY, depth + 0.08), pal.trim, at(x, midY, 0));
  }
  // Subtle linear architectural LED accent along the bottom soffit.
  const stripMat = fixtureMaterial(0xd4eef6, 0.9);
  stripMat.name = 'concourse-truss-led';
  pb.add(slab(span * 0.48, 0.025, 0.12), stripMat, at(0, botY - 0.12, 0));
  return pb.build();
}

/**
 * Focal Arrival Concourse monument sign mounted high on a wall (local wall plane z = 0, facing -Z).
 */
function concourseMonumentSign(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 8.2);
  const h = numParam(p, 'height', 2.0);
  const y = numParam(p, 'y', 5.0);
  const title = strParam(p, 'title', 'THALASSA TRANSIT TERMINAL');
  const sub = strParam(p, 'sub', 'ARRIVAL CONCOURSE  //  SECTOR 01  //  CUSTOMS & DISPATCH');

  pb.add(rounded(w + 0.26, h + 0.26, 0.14, 0.02), pal.doorPanel, at(0, y, -0.07));
  pb.add(slab(w + 0.32, 0.07, 0.18), pal.trim, at(0, y + h / 2 + 0.14, -0.08));
  pb.add(slab(w + 0.32, 0.07, 0.18), pal.trim, at(0, y - h / 2 - 0.14, -0.08));
  const accentStrip = fixtureMaterial(0x38c8d8, 1.0);
  accentStrip.name = 'concourse-monument-strip';
  pb.add(slab(w, 0.035, 0.04), accentStrip, at(0, y - h / 2 - 0.05, -0.14));

  const faceMat =
    typeof document !== 'undefined'
      ? paintedDecal(
          (ctx, cw, ch) => {
            ctx.fillStyle = '#091319';
            ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = '#112936';
            ctx.fillRect(0, 0, cw, 22);
            ctx.fillStyle = '#38c8d8';
            ctx.fillRect(42, ch - 26, cw - 84, 6);
            ctx.fillStyle = '#e0a82e';
            ctx.fillRect(42, 48, 14, ch - 96);
            ctx.fillStyle = '#eaf4f8';
            ctx.font = `800 72px ${SCREEN_FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText(title, cw / 2 + 6, ch * 0.5, cw - 120);
            ctx.fillStyle = '#7ec8d8';
            ctx.font = `700 32px ${SCREEN_FONT}`;
            ctx.fillText(sub, cw / 2 + 6, ch * 0.77, cw - 120);
          },
          1024,
          256,
          `concourse-monument-${title}`,
        )
      : flatPaint('concourse-monument-fallback', 0x091319, 0.5, 0.1);
  pb.add(new THREE.PlaneGeometry(w, h), faceMat, at(0, y, -0.148, 0, Math.PI, 0));
  return pb.build();
}

/**
 * Clean modern transit terminal waiting bench (width along X, facing -Z).
 */
function concourseBench(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 2.4);
  const d = 0.64;
  const seatMat = flatPaint('concourse-bench-seat', 0x20313d, 0.68, 0.08);
  const hw = w / 2;

  // Brushed steel base beam & twin pedestal legs.
  pb.add(slab(w - 0.3, 0.07, 0.1), pal.doorPanel, at(0, 0.34, 0));
  for (const sx of [-hw + 0.35, hw - 0.35]) {
    pb.add(rounded(0.08, 0.38, d - 0.08, 0.015), pal.trim, at(sx, 0.19, 0));
    pb.add(slab(0.16, 0.03, d), pal.doorPanel, at(sx, 0.015, 0));
  }
  // Padded seat & backrest panels + end armrests.
  pb.add(rounded(w, 0.09, d - 0.1, 0.025), seatMat, at(0, 0.44, -0.02));
  pb.add(rounded(w, 0.38, 0.08, 0.025), seatMat, at(0, 0.74, d / 2 - 0.06, -0.14, 0, 0));
  for (const sx of [-hw + 0.04, 0, hw - 0.04]) {
    pb.add(rounded(0.045, 0.22, d - 0.12, 0.01), pal.trim, at(sx, 0.56, -0.01));
  }

  pb.solid(-hw, 0, -d / 2, hw, 0.92, d / 2, 'metal');
  return pb.build();
}

/**
 * Clean terminal queue stanchion posts with taut retractable belt (runs along X).
 */
function stanchionBarrier(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const len = numParam(p, 'length', 3.2);
  const posts = Math.max(2, Math.round(numParam(p, 'posts', 3)));
  const beltMat = flatPaint('stanchion-belt', 0x164a56, 0.78, 0.05);
  const hl = len / 2;

  for (let i = 0; i < posts; i++) {
    const x = -hl + (len * i) / (posts - 1);
    pb.add(new THREE.CylinderGeometry(0.16, 0.18, 0.045, 16), pal.doorPanel, at(x, 0.0225, 0));
    pb.add(new THREE.CylinderGeometry(0.028, 0.032, 0.92, 12), pal.trim, at(x, 0.48, 0));
    pb.add(new THREE.CylinderGeometry(0.042, 0.042, 0.1, 14), pal.doorPanel, at(x, 0.93, 0));
  }
  pb.add(slab(len - 0.06, 0.065, 0.012), beltMat, at(0, 0.9, 0));
  pb.solid(-hl - 0.14, 0, -0.16, hl + 0.14, 0.98, 0.16, 'metal');
  return pb.build();
}

/**
 * Abandoned transit passenger luggage cluster (hard-shell rolling case + tipped Pelican + scattered folder).
 * Low-profile storytelling prop with no blocking collider so it never snags movement.
 */
function luggageCluster(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const tipped = boolParam(p, 'tipped', true);
  const caseDark = flatPaint('luggage-dark', 0x1e2832, 0.48, 0.22);
  const caseTeal = flatPaint('luggage-teal', 0x264852, 0.45, 0.18);
  const caseAmber = flatPaint('luggage-amber', 0xa67422, 0.52, 0.15);
  const paper = flatPaint('luggage-paper', 0xd8dce0, 0.85, 0.0);

  // Primary upright rolling transit case.
  pb.add(rounded(0.46, 0.68, 0.26, 0.03), caseDark, at(-0.24, 0.34, 0.05, 0, 0.28, 0));
  pb.add(slab(0.18, 0.22, 0.03), pal.trim, at(-0.24, 0.78, 0.05, 0, 0.28, 0));
  // Secondary hard-shell case (either tipped on its side or resting beside it).
  if (tipped) {
    pb.add(rounded(0.58, 0.22, 0.38, 0.025), caseTeal, at(0.32, 0.11, -0.14, 0, -0.45, 0));
    pb.add(rounded(0.34, 0.14, 0.26, 0.02), caseAmber, at(0.18, 0.07, 0.34, 0, 0.7, 0));
    pb.add(slab(0.24, 0.008, 0.32), paper, at(0.58, 0.008, 0.18, 0, 0.42, 0));
    pb.add(slab(0.22, 0.008, 0.28), paper, at(0.44, 0.01, 0.42, 0, -0.58, 0));
  } else {
    pb.add(rounded(0.42, 0.52, 0.24, 0.025), caseTeal, at(0.26, 0.26, -0.06, 0, -0.22, 0));
  }
  return pb.build();
}

function propDef(id: string, generate: (p: PieceParams, rng: Rng, m: Materials) => PieceOutput): PieceDef {
  return { id, family: 'prop', footprint: [1, 1], generate };
}

function structureDef(id: string, generate: (p: PieceParams, rng: Rng, m: Materials) => PieceOutput): PieceDef {
  return { id, family: 'structure', footprint: [1, 1], generate };
}

export const TRANSIT_STRUCTURE: PieceDef[] = [
  structureDef('transit_blast_gate', transitBlastGate),
];

export const TRANSIT_PROPS: PieceDef[] = [
  propDef('transit_train_shell', trainShell),
  propDef('transit_tunnel_shroud', transitTunnelShroud),
  propDef('transit_sea_tunnel_rig', transitSeaTunnelRig),
  propDef('transit_dark_bore', transitDarkBore),
  propDef('concourse_pillar', concoursePillar),
  propDef('checkin_booth', checkinBooth),
  propDef('concourse_truss', concourseTruss),
  propDef('concourse_monument_sign', concourseMonumentSign),
  propDef('concourse_bench', concourseBench),
  propDef('stanchion_barrier', stanchionBarrier),
  propDef('luggage_cluster', luggageCluster),
  propDef('track_bed', trackBed),
  propDef('transit_boarding_step', boardingStep),
  propDef('seam_header', seamHeader),
  propDef('power_generator', powerGenerator),
  propDef('switchgear_bank', switchgearBank),
  propDef('power_terminal', powerTerminal),
  propDef('transit_sign', transitSign),
  propDef('transit_depart_board', transitDepartBoard),
  propDef('platform_railing', platformRailing),
  propDef('transit_rotating_beacon', transitRotatingBeacon),
  propDef('blood_decal', bloodDecalProp),
  propDef('fallen_body', fallenBody),
];
