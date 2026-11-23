import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import '../ui/styles/base.css';
import keymapJson from '../data/keymap.json';
import posesJson from '../data/poses.json';
import bodyModelsJson from '../data/body-models.json';
import { BodyModelLibrary, validateBodyModelTable } from '../actors/bodyModelLibrary.ts';
import { validateKeymap } from '../data/types/keymap.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { EventBus } from '../core/events.ts';
import { FreeCamera } from '../core/freeCamera.ts';
import { Input } from '../core/input.ts';
import { Rng } from '../core/rng.ts';
import { SettingsStore } from '../core/settings.ts';
import { validate } from '../core/validate.ts';
import { createRenderer } from '../render/renderer.ts';
import { createMaterials } from '../render/materials.ts';
import { GoreSystem } from '../actors/gore.ts';
import { Humanoid } from '../actors/humanoid.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { castSpec } from '../actors/castLooks.ts';
import { loadSharedMocapLibrary } from '../actors/mocap.ts';
import { loadMocapPacks } from '../actors/mocapPacks.ts';
import { sharedMotionProfiles } from '../actors/motionProfiles.ts';
import { SLICE_PROPS } from '../world/kit/slice.ts';
import { transformBox, type SpotSlot } from '../world/kit/types.ts';
import { at } from '../world/kit/geom.ts';
import { CollisionWorld } from '../world/collision.ts';

/**
 * ADR-0029 pose bench: /sandbox/poses.html (dev server only). Real Commons furniture with bodies in the
 * seated and leaning spots, to tune `sit_*` / `lean_*` poses and their gestures by eye.
 *   ?view=front|side|top|bar|sofa|wall   camera presets
 *   ?gesture=<suffix>                    every body plays `<base>_<suffix>` if it exists (e.g. glance, talk)
 *   window.bench.setPose(i, name) / bench.view(name) / bench.cycle(true)
 */

const FOG = 0x0b0d10;

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const params = new URLSearchParams(location.search);
  const events = new EventBus();
  const settings = new SettingsStore(events);
  const posesFile = loadPoseFile(posesJson);
  const poses = new PoseLibrary(posesFile);
  const renderer = createRenderer(canvas, settings.get());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 80);
  const keymap = validate(validateKeymap, keymapJson, 'data/keymap.json');
  const input = new Input(canvas, keymap, events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.speed = 3;
  canvas.addEventListener('click', () => input.requestLock());
  const prompt = document.querySelector<HTMLElement>('#prompt');
  if (prompt) {
    events.on('input:pointerLock', ({ locked }) => {
      prompt.hidden = locked;
    });
  }

  const m = createMaterials(512, 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // A wall to lean on, at z = -3 (face toward +z).
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.25), new THREE.MeshStandardMaterial({ color: 0x5a6670, roughness: 0.8 }));
  wall.position.set(-6, 1.5, -3.125);
  scene.add(wall);
  scene.add(new THREE.HemisphereLight(0xdde6ee, 0x22262a, 1.4));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.4);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -10;
  key.shadow.camera.right = key.shadow.camera.top = 10;
  scene.add(key);

  const gore = new GoreSystem(new Rng('bench-gore'));
  scene.add(gore.group);
  const bodyModels = new BodyModelLibrary(validate(validateBodyModelTable, bodyModelsJson, 'data/body-models.json'));
  const motionProfiles = sharedMotionProfiles();
  await Promise.all([
    bodyModels.load(import.meta.env.BASE_URL),
    loadSharedMocapLibrary().then((lib) => loadMocapPacks(lib, Object.keys(motionProfiles.profiles))),
  ]);

  const colliders = new CollisionWorld();
  colliders.add({ min: [-8, 0, -3.25], max: [-4, 3, -3.0] }, 'bench:wall', 'concrete');
  const defs = new Map(SLICE_PROPS.map((d) => [d.id, d]));
  const spots: Array<SpotSlot & { world: THREE.Vector3; wyaw: number }> = [];
  const place = (kit: string, x: number, z: number, rotDeg: number, p: Record<string, number | string | boolean>): void => {
    const def = defs.get(kit);
    if (!def) throw new Error(kit);
    const out = def.generate(p, new Rng(`bench:${kit}:${x},${z}`), m);
    const ry = THREE.MathUtils.degToRad(rotDeg);
    const mat = at(x, 0, z, 0, ry, 0);
    out.object.applyMatrix4(mat);
    out.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    scene.add(out.object);
    for (const c of out.colliders) colliders.add(transformBox(c, mat), `bench:${kit}`);
    for (const s of out.spots ?? []) spots.push({ ...s, world: new THREE.Vector3(...s.pos).applyMatrix4(mat), wyaw: s.yaw + ry });
  };
  place('dining_table', 0, 0, 0, { width: 2.2, seats: 6, mugs: 2, caddy: true });
  place('bar_counter', 4, 0, 0, { width: 2.4, stools: 3, mugs: 1 });
  place('sofa', -4, 2, 180, { width: 2.6, tone: 'warm' });
  place('sofa', -2.2, 3.4, 225, { width: 1 });
  place('bar_counter', -6.2, 2.2, 90, { width: 2.4, stools: 1, mugs: 0 }); // bar height (1.06 m): the lean_counter target

  const looks = ['crew', 'lab', 'botanist', 'diver', 'maintenance', 'assistant', 'engineer', 'crew', 'lab', 'botanist', 'diver', 'crew'];
  const bodies: Array<{ h: Humanoid; base: string }> = [];
  // Crew bodies cycled over the seats (`?models=a,b,c` picks others).
  const MODELS = params.get('models')?.split(',') ?? ['office1', 'office2', 'office3', 'guard1', 'scientist1', 'assistant', 'botanist1', 'botanist2', 'botanist3'];
  const add = (look: string, id: string, pos: THREE.Vector3, yaw: number, pose: string): void => {
    const spec = { ...castSpec(look, id), model: MODELS[bodies.length % MODELS.length]! };
    const h = new Humanoid({ ...spec, role: 'npc', pose }, { poses, gore, bodyModels, colliders });
    h.group.position.copy(pos);
    h.setHeading(yaw);
    scene.add(h.group);
    bodies.push({ h, base: pose });
  };
  spots.forEach((s, i) => add(looks[i % looks.length]!, `bench_${i}`, s.world, s.wyaw, s.kind));
  // Leaners: back to the wall, and at a counter end.
  add('crew', 'bench_lean_wall', new THREE.Vector3(-6.3, 0, -3 + 0.45), Math.PI, 'lean_wall');
  add('lab', 'bench_lean_wall2', new THREE.Vector3(-5.2, 0, -3 + 0.45), Math.PI, 'lean_wall');
  add('maintenance', 'bench_lean_counter', new THREE.Vector3(-6.2 - 0.22 - 0.18, 0, 1.4), -Math.PI / 2, 'lean_counter');
  // Backs against a kitchen counter (front edge 0.36 m behind the feet), mug in hand (ADR-0029 intro kitchen).
  place('kitchen_counter', 3, 4.5, 0, { width: 3 });
  add('crew', 'bench_back_1', new THREE.Vector3(2.5, 0, 4.5 - 0.32 - 0.36), THREE.MathUtils.degToRad(-20), 'lean_back_mug');
  add('crew', 'bench_back_2', new THREE.Vector3(3.5, 0, 4.5 - 0.32 - 0.36), THREE.MathUtils.degToRad(20), 'lean_back');
  // A standing reference.
  add('crew', 'bench_stand', new THREE.Vector3(2.2, 0, 1.6), Math.PI, 'idle');

  const VIEWS: Record<string, [number, number, number, number, number, number]> = {
    front: [0, 1.6, 4.2, 0, 0.7, 0],
    side: [-2.6, 1.0, 0, 0, 0.7, 0],
    top: [0.5, 6, 3, 0, 0, 0],
    bar: [4, 1.3, -3, 4, 0.8, 0],
    barside: [7, 1.2, -0.5, 4, 0.8, -0.5],
    sofa: [-4, 1.4, -1.2, -4, 0.6, 2],
    sofaside: [-1, 1.2, 2, -4, 0.6, 2],
    wall: [-5.5, 1.4, 0.8, -5.8, 1, -2.8],
    wallside: [-3.2, 1.2, -2.2, -5.8, 1, -2.7],
    counter: [-8.6, 1.4, 3.6, -6.5, 1, 2.2],
    all: [0, 7, 9, -1, 0, 0],
    back: [3, 1.3, 1.2, 3, 0.9, 3.8],
    backside: [5.4, 1.2, 3.6, 3, 0.9, 3.9],
  };
  const aimDir = new THREE.Vector3();
  const aimCamera = (px: number, py: number, pz: number, tx: number, ty: number, tz: number): void => {
    camera.position.set(px, py, pz);
    aimDir.set(tx - px, ty - py, tz - pz).normalize();
    freeCam.yaw = Math.atan2(-aimDir.x, -aimDir.z);
    freeCam.pitch = Math.asin(Math.max(-1, Math.min(1, aimDir.y)));
    camera.rotation.set(freeCam.pitch, freeCam.yaw, 0);
  };
  const view = (name: string): void => {
    const v = VIEWS[name] ?? VIEWS['front']!;
    aimCamera(v[0], v[1], v[2], v[3], v[4], v[5]);
  };
  view(params.get('view') ?? 'front');

  const gesture = params.get('gesture');
  const setPose = (i: number, name: string): void => bodies[i]?.h.setPose(name, 0.3);
  const applyGesture = (suffix: string | null): void => {
    for (const b of bodies) {
      const name = suffix ? `${b.base}_${suffix}` : b.base;
      b.h.setPose(poses.has(name) ? name : b.base, 0.3);
    }
  };
  if (gesture) applyGesture(gesture);
  let cycling = false;
  let cycleT = 0;
  let cycleIdx = 0;
  const SUFFIXES = [null, 'glance', 'glance_other', 'look_down', 'talk', 'drink', 'lean', 'hands', 'crossed'];
  (window as unknown as { bench: unknown }).bench = {
    bodies,
    camera,
    cam: aimCamera,
    setPose,
    view,
    gesture: applyGesture,
    cycle: (on: boolean) => (cycling = on),
    /** Advance and draw a few frames now (works while the pane is hidden), and return the picture as a JPEG data URL. */
    snap: (frames = 30): string => {
      for (let i = 0; i < frames; i++) for (const b of bodies) b.h.update(1 / 30, camera.position);
      renderer.render(scene, camera);
      return canvas.toDataURL('image/jpeg', 0.85);
    },
    speak: (i: number, text = 'So I told him the pump was fine, and then it flooded.', emote: 'neutral' | 'laugh' | 'question' = 'neutral') => bodies[i]?.h.speak(text, emote, 3),
  };

  const resize = (): void => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    freeCam.update(dt);
    freeCam.look();
    input.endStep();
    if (cycling) {
      cycleT += dt;
      if (cycleT > 2.5) {
        cycleT = 0;
        cycleIdx = (cycleIdx + 1) % SUFFIXES.length;
        applyGesture(SUFFIXES[cycleIdx] ?? null);
      }
    }
    for (const b of bodies) b.h.update(dt, camera.position);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((e: unknown) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:absolute;top:0;left:0">${String(e)}</pre>`);
});
