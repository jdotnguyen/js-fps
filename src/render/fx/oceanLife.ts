import * as THREE from 'three';
import type { Rng } from '../../core/rng.ts';
import { EXTERIOR_GLSL, exteriorUniforms } from './exteriorLight.ts';

/**
 * 3D ocean life outside a room's exterior windows (Pass B):
 * One InstancedMesh of swimming deep-sea fish (tail-undulating on the GPU) plus one Points cloud
 * of rising bubble streams and drifting bioluminescent plankton, batched across every window of a
 * room so the whole room pays just 1 Mesh draw call + 1 Points call.
 *
 * Each zone is in window-frame world space: origin at window centre (y ≈ 1.5), +X along the glass,
 * +Y up, -Z outward into the water. Everything stays strictly inside `z ∈ [-depth + 0.8, -1.2]`
 * so nothing ever clips the glass or adjacent interior rooms.
 */
export interface OceanZone {
  matrix: THREE.Matrix4;
  width: number;
  depth: number;
}

export interface OceanLife {
  group: THREE.Group;
  update(t: number): void;
}

/** Procedural low-poly fish silhouette (facing +X, tapered body + dorsal/tail fin, ~40 tris). */
function fishGeometry(): THREE.BufferGeometry {
  // Body: flattened elongated octahedron/diamond along X in [-0.18, +0.16] plus flared tail fin to -0.27.
  const pos: number[] = [];
  const pushTri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]): void => {
    pos.push(...a, ...b, ...c);
  };
  const nose: [number, number, number] = [0.16, 0, 0];
  const tailBase: [number, number, number] = [-0.15, 0, 0];
  const top: [number, number, number] = [0.02, 0.055, 0];
  const bot: [number, number, number] = [0.02, -0.048, 0];
  const left: [number, number, number] = [0.02, 0, 0.032];
  const right: [number, number, number] = [0.02, 0, -0.032];
  // Front half
  pushTri(nose, left, top);
  pushTri(nose, top, right);
  pushTri(nose, bot, left);
  pushTri(nose, right, bot);
  // Rear half
  pushTri(tailBase, top, left);
  pushTri(tailBase, right, top);
  pushTri(tailBase, left, bot);
  pushTri(tailBase, bot, right);
  // Tail fin (double-sided vertical fork)
  const tfTop: [number, number, number] = [-0.27, 0.075, 0];
  const tfBot: [number, number, number] = [-0.27, -0.07, 0];
  const tfMid: [number, number, number] = [-0.22, 0, 0];
  pushTri(tailBase, tfTop, tfMid);
  pushTri(tailBase, tfMid, tfTop);
  pushTri(tailBase, tfMid, tfBot);
  pushTri(tailBase, tfBot, tfMid);
  // Dorsal fin
  const dA: [number, number, number] = [0.05, 0.045, 0];
  const dB: [number, number, number] = [-0.06, 0.03, 0];
  const dTop: [number, number, number] = [-0.04, 0.095, 0];
  pushTri(dA, dTop, dB);
  pushTri(dA, dB, dTop);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const FISH_VERT = /* glsl */ `
  uniform float uTime;
  attribute vec4 aTrack; // x: halfSpanX, y: speed, z: phase, w: ampY
  attribute vec3 aTint;
  varying vec3 vTint;
  varying float vDepth;
  varying float vShade;
  varying vec3 vFishWorld;

  void main() {
    float span = aTrack.x;
    float phase = uTime * aTrack.y + aTrack.z;
    // Smooth figure-8 / patrol track along the window width; turn smoothly at the ends.
    float s = sin(phase);
    float c = cos(phase);
    float dir = c >= 0.0 ? 1.0 : -1.0;
    float turn = smoothstep(0.0, 0.35, abs(c));
    // Undulate the tail along local Z as X goes negative.
    vec3 p = position;
    float tail = clamp((0.08 - p.x) * 3.2, 0.0, 1.0);
    p.z += sin(uTime * (6.5 + abs(aTrack.y) * 5.0) + aTrack.z * 7.0 - p.x * 16.0) * 0.035 * tail;
    // Flip heading along local X based on patrol direction, soften yaw near endpoints.
    p.x *= dir;
    p.z *= mix(0.35, 1.0, turn);
    p.x += s * span;
    p.y += sin(phase * 2.0) * aTrack.w;
    p.z += cos(phase * 1.5) * 0.18;

    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vec3 wn = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vShade = 0.55 + 0.45 * clamp(wn.y * 0.7 + 0.3, 0.0, 1.0);
    vTint = aTint;
    vDepth = length(cameraPosition - world.xyz);
    vFishWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FISH_FRAG = /* glsl */ `
  varying vec3 vTint;
  varying float vDepth;
  varying float vShade;
  varying vec3 vFishWorld;
  ${EXTERIOR_GLSL}

  void main() {
    // The shared water fog (exterior-ocean spec): fish fade at the same rate as the seabed behind them.
    // Not self-lit: a faint silhouette in the dark, properly visible only in a lamp's light.
    float lit = clamp(0.08 + dot(extLamps(vFishWorld, vec3(0.0)), vec3(0.333)) * 0.12, 0.0, 1.2);
    vec3 col = mix(vTint * vShade * lit, uWaterColor, waterFog(vDepth));
    gl_FragColor = vec4(col, 0.88);
  }
`;

const BUBBLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute vec4 aMotion; // x: riseSpeed, y: heightSpan, z: phase, w: kind (0=plankton, 1=bubble)
  attribute float aSize;
  varying float vKind;
  varying float vAlpha;
  varying vec3 vPWorld;

  void main() {
    vec3 p = position;
    float kind = aMotion.w;
    float span = aMotion.y;
    float life = fract(aMotion.z + uTime * aMotion.x / max(span, 0.5));
    if (kind > 0.5) {
      // Rising bubble: climbs steadily with a gentle wobble, fades at top & bottom.
      p.y += (life - 0.5) * span;
      p.x += sin(uTime * 2.1 + aMotion.z * 31.0 + life * 8.0) * 0.07;
      p.z += cos(uTime * 1.7 + aMotion.z * 23.0 + life * 6.0) * 0.07;
      vAlpha = smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.82, life) * 0.55;
    } else {
      // Drifting bioluminescent plankton: slow orbital current + gentle shimmer pulse.
      p.x += sin(uTime * 0.35 + aMotion.z * 19.0) * 0.45;
      p.y += cos(uTime * 0.28 + aMotion.z * 13.0) * 0.25;
      p.z += sin(uTime * 0.22 + aMotion.z * 29.0) * 0.2;
      float pulse = 0.45 + 0.55 * sin(uTime * 1.6 + aMotion.z * 43.0);
      vAlpha = 0.28 + 0.42 * pulse;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(1.2, -mv.z);
    vKind = kind;
    vPWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    vAlpha *= smoothstep(16.0, 2.5, dist);
    gl_PointSize = clamp((aSize * 220.0 * uPixelRatio) / dist, 1.5, 16.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BUBBLE_FRAG = /* glsl */ `
  varying float vKind;
  varying float vAlpha;
  varying vec3 vPWorld;
  ${EXTERIOR_GLSL}

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float lit = clamp(dot(extLamps(vPWorld, vec3(0.0)), vec3(0.333)) * 0.15, 0.0, 1.0);
    if (vKind > 0.5) {
      // Hollow specular bubble ring with soft rim.
      float rim = smoothstep(0.22, 0.42, r) * smoothstep(0.5, 0.41, r);
      float spec = smoothstep(0.16, 0.0, length(c - vec2(-0.14, -0.14)));
      vec3 col = vec3(0.45, 0.78, 0.86) * (0.55 + rim * 0.7) + vec3(0.7, 0.95, 1.0) * spec;
      // Bubbles show only where a lamp catches them.
      gl_FragColor = vec4(col, (rim * 0.75 + spec * 0.65 + 0.12) * vAlpha * lit);
    } else {
      // Soft glowing cyan-aqua bioluminescent speck.
      float glow = smoothstep(0.5, 0.0, r);
      vec3 col = mix(vec3(0.18, 0.62, 0.72), vec3(0.48, 0.95, 0.92), glow);
      // Sparse, dim bioluminescence: a few faint points in the dark, not a starfield.
      gl_FragColor = vec4(col, glow * glow * vAlpha * (0.22 + 0.6 * lit));
    }
  }
`;

/** Build a single room-level 3D ocean life rig covering all exterior windows of a room. */
export function createOceanLife(zones: readonly OceanZone[], rng: Rng): OceanLife {
  const group = new THREE.Group();
  group.name = 'ocean-life';
  const uTime = { value: 0 };

  // --- 1. Schooling fish (1 InstancedMesh for the entire room)
  const fishPerZone = Math.max(4, Math.min(8, Math.round(28 / Math.max(1, zones.length))));
  const totalFish = zones.length * fishPerZone;
  const geo = fishGeometry();
  const trackArr = new Float32Array(totalFish * 4);
  const tintArr = new Float32Array(totalFish * 3);
  const fishMat = new THREE.ShaderMaterial({
    uniforms: { uTime, ...exteriorUniforms },
    vertexShader: FISH_VERT,
    fragmentShader: FISH_FRAG,
    transparent: true,
    depthWrite: true,
  });
  const fish = new THREE.InstancedMesh(geo, fishMat, totalFish);
  fish.name = 'ocean-fish';
  fish.userData['skipGtao'] = true;
  fish.frustumCulled = false;

  const palette = [
    new THREE.Color(0x4b9aa8),
    new THREE.Color(0x3a7e8f),
    new THREE.Color(0x69b5bd),
    new THREE.Color(0x2f687a),
    new THREE.Color(0x7ac5c4),
  ];
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();

  let fi = 0;
  for (const z of zones) {
    const safeDepth = Math.max(2.6, Math.min(8.5, z.depth - 0.8));
    // Spawn 1–2 tight small schools per window so fish move together organically.
    const schoolY = rng.range(-0.6, 0.75);
    const schoolZ = -rng.range(1.8, Math.max(2.4, safeDepth * 0.68));
    const schoolSpeed = rng.range(0.28, 0.52);
    const schoolPhase = rng.range(0, Math.PI * 2);
    for (let k = 0; k < fishPerZone; k++) {
      const member = k < Math.ceil(fishPerZone * 0.7);
      const scale = rng.range(0.75, 1.45);
      const ox = rng.range(-z.width * 0.18, z.width * 0.18);
      const oy = member ? schoolY + rng.range(-0.35, 0.35) : rng.range(-0.9, 0.9);
      const oz = member ? schoolZ + rng.range(-0.45, 0.45) : -rng.range(1.6, Math.max(2.2, safeDepth - 0.3));
      const clampedZ = Math.min(-1.35, Math.max(-(safeDepth - 0.25), oz));
      p.set(ox, oy, clampedZ);
      q.identity();
      s.setScalar(scale);
      local.compose(p, q, s);
      m.multiplyMatrices(z.matrix, local);
      fish.setMatrixAt(fi, m);
      const span = Math.max(0.6, z.width * 0.42 - Math.abs(ox));
      trackArr[fi * 4] = span;
      trackArr[fi * 4 + 1] = member ? schoolSpeed + rng.range(-0.04, 0.04) : rng.range(0.2, 0.48);
      trackArr[fi * 4 + 2] = member ? schoolPhase + rng.range(-0.35, 0.35) : rng.range(0, Math.PI * 2);
      trackArr[fi * 4 + 3] = rng.range(0.06, 0.18);
      const col = rng.pick(palette);
      tintArr[fi * 3] = col.r;
      tintArr[fi * 3 + 1] = col.g;
      tintArr[fi * 3 + 2] = col.b;
      fi++;
    }
  }
  geo.setAttribute('aTrack', new THREE.InstancedBufferAttribute(trackArr, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tintArr, 3));
  fish.instanceMatrix.needsUpdate = true;
  group.add(fish);

  // --- 2. 3D Rising Bubbles & Bioluminescent Plankton (1 Points mesh for the entire room)
  const ptsPerZone = Math.max(24, Math.min(48, Math.round(160 / Math.max(1, zones.length))));
  const totalPts = zones.length * ptsPerZone;
  const posArr = new Float32Array(totalPts * 3);
  const motArr = new Float32Array(totalPts * 4);
  const sizeArr = new Float32Array(totalPts);
  const wp = new THREE.Vector3();

  let pi = 0;
  for (const z of zones) {
    const safeDepth = Math.max(2.4, Math.min(8.5, z.depth - 0.6));
    // Two bubble-vent columns per window + scattered drifting bioluminescent motes.
    const vents = [
      { x: rng.range(-z.width * 0.36, -0.3), z: -rng.range(1.6, Math.max(2.2, safeDepth * 0.65)) },
      { x: rng.range(0.3, z.width * 0.36), z: -rng.range(1.8, Math.max(2.4, safeDepth * 0.8)) },
    ];
    for (let k = 0; k < ptsPerZone; k++) {
      const bubble = k < Math.floor(ptsPerZone * 0.45);
      if (bubble) {
        const v = vents[k % vents.length]!;
        wp.set(v.x + rng.range(-0.22, 0.22), rng.range(-0.3, 0.3), v.z + rng.range(-0.22, 0.22)).applyMatrix4(z.matrix);
        motArr[pi * 4] = rng.range(0.45, 0.95);
        motArr[pi * 4 + 1] = rng.range(2.6, 3.8);
        motArr[pi * 4 + 2] = rng.range(0, 1);
        motArr[pi * 4 + 3] = 1;
        sizeArr[pi] = rng.range(0.05, 0.11);
      } else {
        wp.set(rng.range(-z.width * 0.48, z.width * 0.48), rng.range(-1.1, 1.3), -rng.range(1.1, safeDepth)).applyMatrix4(z.matrix);
        motArr[pi * 4] = rng.range(0.1, 0.25);
        motArr[pi * 4 + 1] = 2.0;
        motArr[pi * 4 + 2] = rng.range(0, 1);
        motArr[pi * 4 + 3] = 0;
        sizeArr[pi] = rng.range(0.035, 0.085);
      }
      posArr[pi * 3] = wp.x;
      posArr[pi * 3 + 1] = wp.y;
      posArr[pi * 3 + 2] = wp.z;
      pi++;
    }
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  pGeo.setAttribute('aMotion', new THREE.BufferAttribute(motArr, 4));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(sizeArr, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      ...exteriorUniforms,
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1 },
    },
    vertexShader: BUBBLE_VERT,
    fragmentShader: BUBBLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.name = 'ocean-bubbles-plankton';
  points.userData['skipGtao'] = true;
  points.frustumCulled = false;
  points.renderOrder = 2;
  group.add(points);

  return {
    group,
    update(t: number): void {
      uTime.value = t;
    },
  };
}
