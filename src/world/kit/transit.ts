import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { paintedDecal } from '../../render/decals.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { at, cylinderBetween, rounded } from './geom.ts';
import { resolvePalette } from './palettes.ts';
import { slab } from './shapes.ts';
import { PieceBuilder, numParam, strParam, type PieceDef, type PieceOutput, type PieceParams } from './types.ts';

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
  const doorSign = doorSide === 'left' ? -1 : 1; // +1 = +X (rotates to -X west at rot=180)
  const hw = w / 2;
  const hl = len / 2;
  const wallT = 0.14;
  const floorH = 0.08;
  const sillY = 1.05;
  const headY = 2.28;
  const doorHalf = 1.05;
  const doorH = 2.34;
  const bodyMat = pal.wallMain;
  const trimMat = pal.trim;
  const darkMat = pal.doorPanel;

  // Floor slab (flush/low step from platform, walkable metal surface).
  pb.add(slab(w, floorH + 0.04, len), pal.floor, at(0, floorH / 2 - 0.02, 0));
  pb.add(slab(w - 0.3, 0.015, len - 0.3), pal.floorAlt, at(0, floorH + 0.005, 0));
  pb.solid(-hw, -0.04, -hl, hw, floorH, hl, 'metal');

  // Roof slab + interior structural ribs for scale.
  const roofT = 0.18;
  pb.add(rounded(w + 0.08, roofT, len + 0.08, 0.04), darkMat, at(0, h - roofT / 2, 0));
  pb.solid(-hw, h - roofT, -hl, hw, h, hl);
  for (let z = -hl + 1.4; z <= hl - 1.3; z += 2.2) {
    pb.add(slab(w - wallT * 2, 0.09, 0.12), trimMat, at(0, h - roofT - 0.045, z));
  }

  // Helper to build a windowed wall span along Z on side `s` (-1 = -X, +1 = +X).
  const sideSpan = (s: number, z0: number, z1: number): void => {
    const span = z1 - z0;
    if (span <= 0.05) return;
    const zc = (z0 + z1) / 2;
    const xc = s * (hw - wallT / 2);
    pb.add(slab(wallT, sillY - floorH, span), bodyMat, at(xc, (sillY + floorH) / 2, zc));
    pb.add(slab(wallT, h - roofT - headY, span), darkMat, at(xc, (h - roofT + headY) / 2, zc));
    pb.add(slab(wallT + 0.03, 0.06, span), trimMat, at(xc, sillY, zc));
    pb.add(slab(wallT + 0.03, 0.06, span), trimMat, at(xc, headY, zc));
    const winH = headY - sillY - 0.06;
    const posts = Math.max(2, Math.round(span / 1.9) + 1);
    for (let i = 0; i < posts; i++) {
      const zp = z0 + (span * i) / (posts - 1);
      pb.add(slab(wallT + 0.02, winH, 0.1), trimMat, at(xc, (sillY + headY) / 2, zp));
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.08, winH), m.glass);
    glass.applyMatrix4(at(xc, (sillY + headY) / 2, zc, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
    glass.renderOrder = 3;
    pb.dynamic(glass);
    pb.solid(s > 0 ? hw - wallT : -hw, floorH, z0, s > 0 ? hw : -hw + wallT, h - roofT, z1);
  };

  // Continuous non-door side.
  sideSpan(-doorSign, -hl, hl);
  // Door side: two spans flanking the open boarding doorway + overhead header.
  sideSpan(doorSign, -hl, -doorHalf);
  sideSpan(doorSign, doorHalf, hl);
  const doorX = doorSign * (hw - wallT / 2);
  pb.add(slab(wallT + 0.04, h - roofT - doorH, doorHalf * 2), darkMat, at(doorX, (h - roofT + doorH) / 2, 0));
  pb.add(slab(wallT + 0.06, 0.06, doorHalf * 2 + 0.16), pal.hazard, at(doorX, doorH, 0));
  pb.solid(doorSign > 0 ? hw - wallT : -hw, doorH, -doorHalf, doorSign > 0 ? hw : -hw + wallT, h - roofT, doorHalf);

  // Front (-Z) and rear (+Z) bulkheads with wide viewing windshields.
  for (const sz of [-1, 1]) {
    const zc = sz * (hl - wallT / 2);
    pb.add(slab(w, sillY - floorH, wallT), bodyMat, at(0, (sillY + floorH) / 2, zc));
    pb.add(slab(w, h - roofT - headY, wallT), darkMat, at(0, (h - roofT + headY) / 2, zc));
    for (const sx of [-1, 1]) {
      pb.add(slab(0.32, headY - sillY, wallT + 0.02), trimMat, at(sx * (hw - 0.16), (sillY + headY) / 2, zc));
    }
    const endGlass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.64, headY - sillY - 0.06), m.glass);
    endGlass.applyMatrix4(at(0, (sillY + headY) / 2, zc, 0, sz > 0 ? Math.PI : 0, 0));
    endGlass.renderOrder = 3;
    pb.dynamic(endGlass);
    pb.solid(-hw, floorH, sz > 0 ? hl - wallT : -hl, hw, h - roofT, sz > 0 ? hl : -hl + wallT);
  }

  // Interior centerline + doorway nav nodes for seamless boarding.
  pb.nav(0, floorH, -hl + 1.8);
  pb.nav(0, floorH, 0);
  pb.nav(0, floorH, hl - 1.8);
  pb.nav(doorSign * (hw - 0.15), floorH, 0);
  pb.nav(doorSign * (hw + 0.75), 0, 0);
  return pb.build();
}

function concoursePillar(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 1.45);
  const h = numParam(p, 'height', 8.0);
  const baseH = 0.5;
  const capH = 0.55;
  const shaftH = Math.max(1.0, h - baseH - capH);

  // Heavy plinth base, architectural concrete/slate shaft with corner steel ribs, and ceiling capital.
  pb.add(rounded(w + 0.28, baseH, w + 0.28, 0.04), pal.doorPanel, at(0, baseH / 2, 0));
  pb.add(slab(w + 0.32, 0.08, w + 0.32), pal.trim, at(0, baseH + 0.04, 0));
  pb.add(rounded(w, shaftH, w, 0.04), pal.wallAlt, at(0, baseH + shaftH / 2, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pb.add(slab(0.14, shaftH, 0.14), pal.trim, at(sx * (w / 2 - 0.03), baseH + shaftH / 2, sz * (w / 2 - 0.03)));
    }
  }
  pb.add(slab(w + 0.34, 0.1, w + 0.34), pal.trim, at(0, h - capH - 0.05, 0));
  pb.add(rounded(w + 0.36, capH, w + 0.36, 0.04), pal.doorPanel, at(0, h - capH / 2, 0));

  const ch = w / 2 + 0.14;
  pb.solid(-ch, 0, -ch, ch, h, ch);
  return pb.build();
}

function checkinBooth(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 3.6);
  const d = numParam(p, 'depth', 2.2);
  const h = numParam(p, 'height', 3.2);
  const hw = w / 2;
  const hd = d / 2;
  const counterH = 1.05;
  const fasciaBottom = 2.4;

  // Solid base counter + brushed transaction ledge (front faces -Z).
  pb.add(rounded(w, counterH - 0.06, d, 0.02), pal.wallMain, at(0, (counterH - 0.06) / 2, 0));
  pb.add(rounded(w + 0.08, 0.07, d + 0.16, 0.015), pal.trim, at(0, counterH - 0.035, -0.04));

  // Side partition piers + back wall.
  for (const sx of [-1, 1]) {
    pb.add(slab(0.18, h - counterH, d), pal.doorPanel, at(sx * (hw - 0.09), (h + counterH) / 2, 0));
  }
  pb.add(slab(w - 0.36, h - counterH, 0.16), pal.wallMain, at(0, (h + counterH) / 2, hd - 0.08));

  // Glazed teller screen with a central check-in cutout + overhead signage fascia.
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

  pb.solid(-hw, 0, -hd, hw, h, hd);
  return pb.build();
}

function trackBed(p: PieceParams, _rng: Rng, m: Materials): PieceOutput {
  const pb = new PieceBuilder();
  const pal = resolvePalette(p, m);
  const w = numParam(p, 'width', 3.4);
  const len = numParam(p, 'length', 4.0);
  const gauge = 1.5;

  // Recessed dark track apron, sleepers, and twin steel rails (walkable, low profile).
  pb.add(slab(w, 0.025, len), pal.doorPanel, at(0, 0.0125, 0));
  for (let z = -len / 2 + 0.35; z <= len / 2 - 0.3; z += 0.7) {
    pb.add(slab(2.2, 0.03, 0.18), pal.ceiling, at(0, 0.035, z));
  }
  for (const sx of [-1, 1]) {
    pb.add(slab(0.08, 0.05, len), pal.trim, at(sx * (gauge / 2), 0.075, 0));
  }
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
  pb.on('r11:power_state', (payload) => {
    const parsed = parsePowerState(payload);
    if (!parsed) return;
    state = parsed.state;
    if (parsed.instant) {
      speed = state === 'online' ? 14 : state === 'starting' ? 7 : 0;
    }
  });
  pb.on('level:reset', () => {
    state = 'standby';
    speed = 0;
  });
  pb.tick((t, dt) => {
    const target = state === 'online' ? 14 : state === 'starting' ? 9 : 0;
    const rate = state === 'standby' ? 3.5 : 4.2;
    speed += (target - speed) * Math.min(1, dt * rate);
    rotor.rotation.z += speed * dt;
    applyStatusStrip(statusMat, state, t);
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

  pb.solid(-0.88, 0, -0.46, 0.88, 1.82, 0.44, 'metal');
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
            ctx.font = '800 54px "Arial Narrow", Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(title, 30, ch * 0.52);
            ctx.fillStyle = accent;
            ctx.font = '700 28px "Arial Narrow", Arial, sans-serif';
            ctx.fillText(sub, 30, ch * 0.82);
          },
          512,
          176,
          `transit-sign-${title}-${sub}`,
        )
      : flatPaint('sign-fallback', 0x1a2024, 0.7, 0.1);
  pb.add(new THREE.PlaneGeometry(w, h), mat, at(0, y, -0.008, 0, Math.PI, 0));
  return pb.build();
}

function propDef(id: string, generate: (p: PieceParams, rng: Rng, m: Materials) => PieceOutput): PieceDef {
  return { id, family: 'prop', footprint: [1, 1], generate };
}

export const TRANSIT_PROPS: PieceDef[] = [
  propDef('transit_train_shell', trainShell),
  propDef('concourse_pillar', concoursePillar),
  propDef('checkin_booth', checkinBooth),
  propDef('track_bed', trackBed),
  propDef('seam_header', seamHeader),
  propDef('power_generator', powerGenerator),
  propDef('switchgear_bank', switchgearBank),
  propDef('power_terminal', powerTerminal),
  propDef('transit_sign', transitSign),
];
