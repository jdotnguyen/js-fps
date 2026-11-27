import * as THREE from 'three';
import '../ui/styles/base.css';
import { posesJson } from '../data/poseFiles.ts';
import { bodyModelsJson } from '../data/bodyModelFiles.ts';
import { BodyModelLibrary, validateBodyModelTable } from '../actors/bodyModelLibrary.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { Rng } from '../core/rng.ts';
import { validate } from '../core/validate.ts';
import { GoreSystem } from '../actors/gore.ts';
import { Humanoid } from '../actors/humanoid.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { CAST } from '../actors/castLooks.ts';
import { loadSharedMocapLibrary } from '../actors/mocap.ts';
import { loadMocapPacks } from '../actors/mocapPacks.ts';
import { sharedMotionProfiles } from '../actors/motionProfiles.ts';

/**
 * Bakes Director Hale's broadcast portrait (public/assets/brand/hale_broadcast.png): his real body model, head and shoulders,
 * in a studio key light, once per jaw opening (closed, half, open) side by side. The briefing screen (wall_screen, channel
 * briefing) picks a frame from his line's mouth cues. Open /sandbox/hale-portrait.html; `window.halePortrait.png` holds
 * the sheet as a data URL once `window.halePortrait.done` is true.
 */

const FRAME_W = 320;
const FRAME_H = 360;
/** Jaw opening per frame, in degrees (the calm talk style opens about 11°). */
const JAW_DEG = [0, 5, 10];

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(FRAME_W * 2, FRAME_H * 2, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe4ea, 0x1a2226, 1.1));
  const key = new THREE.DirectionalLight(0xfff1e0, 3.2);
  key.position.set(-1.2, 2.6, 2.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd0c8, 0.9);
  fill.position.set(2, 1.8, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x4fd6d0, 2.2);
  rim.position.set(0.5, 2.4, -2.5);
  scene.add(rim);

  const poses = new PoseLibrary(loadPoseFile(posesJson));
  const bodyModels = new BodyModelLibrary(validate(validateBodyModelTable, bodyModelsJson, 'data/bodyModelFiles.ts'));
  const profiles = sharedMotionProfiles();
  await Promise.all([
    bodyModels.load(import.meta.env.BASE_URL),
    loadSharedMocapLibrary().then((lib) => loadMocapPacks(lib, Object.keys(profiles.profiles))),
  ]);
  const gore = new GoreSystem(new Rng('portrait-gore'));
  const h = new Humanoid({ ...CAST['hale']!, role: 'npc', pose: 'idle' }, { poses, gore, bodyModels });
  // Bodies face -Z; turn him to the lens (his idle stands a little angled, so the yaw trims that out).
  h.group.rotation.y = Math.PI + Number(new URLSearchParams(location.search).get('yaw') ?? '0');
  scene.add(h.group);

  const camera = new THREE.PerspectiveCamera(24, FRAME_W / FRAME_H, 0.05, 20);
  const eye = new THREE.Vector3(0, 1.6, 2.1);
  if (new URLSearchParams(location.search).has('look')) h.lookTarget = eye.clone();
  // Settle the idle, then freeze: nothing but the jaw changes between frames.
  for (let i = 0; i < 90; i++) h.update(1 / 30, null);
  h.group.updateWorldMatrix(true, true);

  let jaw: THREE.Bone | null = null;
  let head: THREE.Object3D | null = null;
  h.group.traverse((o) => {
    if ((o as THREE.Bone).isBone && /jaw/i.test(o.name) && !jaw) jaw = o as THREE.Bone;
    if ((o as THREE.Bone).isBone && /head$/i.test(o.name) && !head) head = o;
  });
  // His idle carries a head turn to his right; turn neck and head back to the lens about world up (split between them).
  const turn = Number(new URLSearchParams(location.search).get('turn') ?? '0.58');
  const twist = (bone: THREE.Object3D | null, a: number): void => {
    if (!bone?.parent) return;
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const w = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    bone.quaternion.premultiply(pq.clone().invert().multiply(w).multiply(pq));
    bone.updateWorldMatrix(false, true);
  };
  let neck: THREE.Object3D | null = null;
  h.group.traverse((o) => {
    if ((o as THREE.Bone).isBone && /neck$/i.test(o.name) && !neck) neck = o;
  });
  twist(neck, turn * 0.4);
  twist(head, turn * 0.6);
  const headAt = new THREE.Vector3();
  if (head) (head as THREE.Object3D).getWorldPosition(headAt);
  else headAt.set(0, 1.65, 0);
  camera.position.set(headAt.x, headAt.y - 0.04, headAt.z + 1.9);
  camera.lookAt(headAt.x, headAt.y - 0.15, headAt.z);

  const sheet = document.createElement('canvas');
  sheet.width = FRAME_W * JAW_DEG.length;
  sheet.height = FRAME_H;
  const g = sheet.getContext('2d')!;
  const params = new URLSearchParams(location.search);
  const axis = (params.get('axis') ?? 'x') as 'x' | 'y' | 'z';
  const sign = Number(params.get('sign') ?? '-1');
  const rest = jaw ? (jaw as THREE.Bone).quaternion.clone() : null;
  const q = new THREE.Quaternion();
  const ax = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  JAW_DEG.forEach((deg, i) => {
    if (jaw && rest) (jaw as THREE.Bone).quaternion.copy(rest).multiply(q.setFromAxisAngle(ax, THREE.MathUtils.degToRad(deg * sign)));
    h.group.updateWorldMatrix(true, true);
    renderer.render(scene, camera);
    g.drawImage(canvas, i * FRAME_W, 0, FRAME_W, FRAME_H);
  });
  document.body.appendChild(sheet);
  sheet.style.cssText = 'position:fixed;left:0;bottom:0;background:#1d3b44';
  (window as unknown as { halePortrait: unknown }).halePortrait = {
    done: true,
    jaw: jaw ? (jaw as THREE.Bone).name : null,
    head: head ? (head as THREE.Object3D).name : null,
    png: sheet.toDataURL('image/png'),
  };
}

void boot();
