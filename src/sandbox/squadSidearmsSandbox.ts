import * as THREE from 'three';
import '../ui/styles/base.css';
import keymapJson from '../data/keymap.json';
import { posesJson } from '../data/poseFiles.ts';
import { bodyModelsJson } from '../data/bodyModelFiles.ts';
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
import { GoreSystem } from '../actors/gore.ts';
import { Humanoid } from '../actors/humanoid.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { GILES, OKAFOR } from '../actors/squadLooks.ts';
import { loadSharedMocapLibrary } from '../actors/mocap.ts';
import { loadMocapPacks } from '../actors/mocapPacks.ts';
import { sharedMotionProfiles } from '../actors/motionProfiles.ts';
import { loadSquadPistolModel } from '../actors/squadPistol.ts';
import { shotPoints, type SquadEvents, type SquadId } from '../ai/squad.ts';
import { COMBAT } from '../ai/squadBrain.ts';
import { AudioEngine } from '../audio/engine.ts';
import { CasingAudio, type CasingLanding } from '../audio/casings.ts';
import { wallOccluder } from '../audio/occlusion.ts';
import { SAMPLE_URLS, type SampleName } from '../audio/sounds.ts';
import { CollisionWorld, type ColliderSurface } from '../world/collision.ts';
import { SquadMuzzleLight } from '../render/squadMuzzleLight.ts';
import { SQUAD_SHOT, wireSquadShots } from '../app/squadShots.ts';

/**
 * Squad sidearms sandbox (squad-sidearms): Giles and Okafor aiming their pistols at a target in a dark room, for checking the
 * change without playing to a fight. Fire either mate (or both, or auto-fire at the squad's real rate) and see the pistol, its
 * aim, the slide kick and the muzzle flash lighting the room; hear the squad gunshot (positional, muffled through the closed
 * hatch), A/B it against Jay's shot, and hear the brass land on concrete, deck plate, a grate over a lower deck, carpet or
 * shallow water. It runs the game's own pieces: the shot wiring (squadShots.ts), the casing audio, the shared muzzle light,
 * wall occlusion and the room reverb. Open /sandbox/squad-sidearms.html.
 */

// ------------------------------------------------------------------ the room

/** Floor strips across the room (x ranges, m), each a surface the brass can land on. */
const STRIPS: ReadonlyArray<{ id: string; label: string; x0: number; x1: number; surface: ColliderSurface; color: number; water?: number }> = [
  { id: 'concrete', label: 'Concrete', x0: -6, x1: -3.6, surface: 'concrete', color: 0x55585c },
  { id: 'metal', label: 'Deck plate', x0: -3.6, x1: -1.2, surface: 'metal', color: 0x3c4650 },
  { id: 'grate', label: 'Grate over a deck', x0: -1.2, x1: 1.2, surface: 'grate', color: 0x222a30 },
  { id: 'carpet', label: 'Office carpet', x0: 1.2, x1: 3.6, surface: 'rubber', color: 0x3b3550 },
  { id: 'water', label: 'Shallow water', x0: 3.6, x1: 6, surface: 'concrete', color: 0x4a5055, water: 0.06 },
];
const ROOM = { x0: -6, x1: 6, z0: -14, z1: 4, h: 3 };
/** The partition with the hatch, between the firing line and the far end of the room. */
const PARTITION_Z = -8;
const HATCH = { x0: -3, x1: 3, h: 2.4 };
/** Where the mates stand (z) and how far ahead the target is (m). */
const MATE_Z = 0;
const TARGET_DIST = 6;

function stripOf(id: string) {
  return STRIPS.find((s) => s.id === id) ?? STRIPS[1]!;
}

function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 40;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000a';
  g.fillRect(0, 0, 256, 40);
  g.fillStyle = '#e8edf2';
  g.font = '20px system-ui, sans-serif';
  g.fillText(text, 8, 27);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1.6, 0.25, 1);
  return s;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const events = new EventBus();
  const settings = new SettingsStore(events);
  const poses = new PoseLibrary(loadPoseFile(posesJson));
  const renderer = createRenderer(canvas, settings.get());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050607);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.03, 80);
  const input = new Input(canvas, validate(validateKeymap, keymapJson, 'data/keymap.json'), events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.speed = 3;
  canvas.addEventListener('click', () => input.requestLock());
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---- Room: floor strips, walls, the partition and its hatch, as meshes and colliders.
  const world = new CollisionWorld();
  const mat = (color: number, roughness = 0.85, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const box = (min: [number, number, number], max: [number, number, number], m: THREE.Material, surface: ColliderSurface | null, tag = 'static') => {
    const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), m);
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    scene.add(mesh);
    return { mesh, collider: world.add({ min, max }, tag, surface) };
  };
  for (const s of STRIPS) {
    if (s.surface === 'grate') {
      // A see-through grate over a lower deck, so some brass falls through and lands again below.
      box([s.x0, -0.65, ROOM.z0], [s.x1, -0.55, ROOM.z1], mat(0x2b3138, 0.6, 0.6), 'metal');
      const g = box([s.x0, -0.04, ROOM.z0], [s.x1, 0, ROOM.z1], new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.5, metalness: 0.7, transparent: true, opacity: 0.55 }), 'grate');
      g.mesh.renderOrder = 1;
    } else {
      box([s.x0, -0.2, ROOM.z0], [s.x1, 0, ROOM.z1], mat(s.color, s.surface === 'metal' ? 0.45 : 0.9, s.surface === 'metal' ? 0.6 : 0.05), s.surface);
    }
    if (s.water) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, ROOM.z1 - ROOM.z0), new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.6 }));
      w.rotation.x = -Math.PI / 2;
      w.position.set((s.x0 + s.x1) / 2, s.water, (ROOM.z0 + ROOM.z1) / 2);
      scene.add(w);
    }
    const l = labelSprite(s.label);
    l.position.set((s.x0 + s.x1) / 2, 0.08, 2.4);
    scene.add(l);
  }
  const wallMat = mat(0x6b7178, 0.8, 0.3);
  box([ROOM.x0 - 0.2, 0, ROOM.z0], [ROOM.x0, ROOM.h, ROOM.z1], wallMat, 'metal');
  box([ROOM.x1, 0, ROOM.z0], [ROOM.x1 + 0.2, ROOM.h, ROOM.z1], wallMat, 'metal');
  box([ROOM.x0, 0, ROOM.z0 - 0.2], [ROOM.x1, ROOM.h, ROOM.z0], wallMat, 'metal');
  box([ROOM.x0, 0, ROOM.z1], [ROOM.x1, ROOM.h, ROOM.z1 + 0.2], wallMat, 'metal');
  box([ROOM.x0, ROOM.h, ROOM.z0], [ROOM.x1, ROOM.h + 0.2, ROOM.z1], mat(0x40454b), 'metal');
  // The partition: wall either side of the hatch and above it, and the hatch leaf itself (a closed door; open = disabled).
  box([ROOM.x0, 0, PARTITION_Z - 0.2], [HATCH.x0, ROOM.h, PARTITION_Z], wallMat, 'metal');
  box([HATCH.x1, 0, PARTITION_Z - 0.2], [ROOM.x1, ROOM.h, PARTITION_Z], wallMat, 'metal');
  box([HATCH.x0, HATCH.h, PARTITION_Z - 0.2], [HATCH.x1, ROOM.h, PARTITION_Z], wallMat, 'metal');
  const hatch = box([HATCH.x0, 0, PARTITION_Z - 0.15], [HATCH.x1, HATCH.h, PARTITION_Z - 0.05], mat(0x8a5a2a, 0.6, 0.4), 'metal', 'door');
  const setHatch = (closed: boolean): void => {
    hatch.collider.enabled = closed;
    hatch.mesh.visible = closed;
  };

  // ---- Light: a dim room, so the flash shows; one faint lamp.
  const hemi = new THREE.HemisphereLight(0xb8c4d0, 0x1a1d20, 1);
  scene.add(hemi);
  const lamp = new THREE.PointLight(0xdfe8f0, 1, 14, 2);
  lamp.position.set(0, 2.8, -3);
  scene.add(lamp);
  const setRoomLight = (v: number): void => {
    hemi.intensity = 1.2 * v;
    lamp.intensity = 6 * v;
  };

  // ---- Bodies and their pistols.
  const bodyModels = new BodyModelLibrary(validate(validateBodyModelTable, bodyModelsJson, 'data/bodyModelFiles.ts'));
  await Promise.all([
    bodyModels.load(import.meta.env.BASE_URL),
    loadSharedMocapLibrary().then((lib) => loadMocapPacks(lib, Object.keys(sharedMotionProfiles().profiles))),
    loadSquadPistolModel(),
  ]);
  const gore = new GoreSystem(new Rng('sidearms-gore'));
  scene.add(gore.group);
  const mates: Record<SquadId, { h: Humanoid; strip: string; label: THREE.Sprite; side: number }> = {
    engineer: { h: new Humanoid({ ...GILES, role: 'npc', pose: 'aim_pistol' }, { poses, gore, bodyModels }), strip: 'metal', label: labelSprite('Giles'), side: -1 },
    medic: { h: new Humanoid({ ...OKAFOR, role: 'npc', pose: 'aim_pistol' }, { poses, gore, bodyModels }), strip: 'carpet', label: labelSprite('Okafor'), side: 1 },
  };
  for (const m of Object.values(mates)) scene.add(m.h.group, m.label);

  // ---- The target: a dummy with its aim point, moved round an arc in front of the mates.
  const target = new THREE.Group();
  const dummy = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 4, 10), mat(0x7a2a2a, 0.7, 0));
  dummy.position.y = 0.85;
  target.add(dummy);
  const aimMark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff4040 }));
  target.add(aimMark);
  scene.add(target);
  const state = { heading: 0, height: 1.4, aim: true, auto: false, autoT: [0, 0.15], timeScale: 1, paused: false, roomLight: 0.15 };
  const aimPoint = new THREE.Vector3();
  const placeTarget = (): void => {
    const a = THREE.MathUtils.degToRad(state.heading);
    target.position.set(-Math.sin(a) * TARGET_DIST, 0, MATE_Z - Math.cos(a) * TARGET_DIST);
    aimMark.position.set(0, state.height, 0);
    aimPoint.set(target.position.x, state.height, target.position.z);
  };
  const placeMates = (): void => {
    for (const m of Object.values(mates)) {
      const s = stripOf(m.strip);
      const x = (s.x0 + s.x1) / 2 + m.side * 0.35;
      m.h.group.position.set(x, 0, MATE_Z);
      // Face the target (bodies face -Z), as the squad steers to.
      m.h.group.rotation.y = Math.atan2(-(aimPoint.x - x), -(aimPoint.z - MATE_Z));
      m.h.aimTarget = state.aim ? aimPoint : null;
      m.h.lookTarget = aimPoint;
      m.label.position.set(x, 2.15, MATE_Z);
    }
  };
  placeTarget();
  placeMates();

  // ---- Audio: the game's engine, occlusion and reverb; the shot wiring, brass and muzzle light.
  const audio = new AudioEngine();
  const resume = (): void => void audio.resume();
  addEventListener('pointerdown', resume, { capture: true });
  addEventListener('keydown', resume, { capture: true });
  const sampleNames = (Object.keys(SAMPLE_URLS) as SampleName[]).filter((n) => n === 'squadPistolShot' || n === 'pistolShot' || n.startsWith('casing'));
  void audio.loadSamples({ names: sampleNames });
  audio.setOccluder(wallOccluder((...ray) => world.raycast(...ray)));
  audio.setRoomReverb('metal_corridor');
  const waterAt = (x: number): number => STRIPS.find((s) => s.water && x >= s.x0 && x < s.x1)?.water ?? 0;
  const casings = new CasingAudio({
    audio,
    listener: () => camera.position,
    world: {
      raycast: (...r) => world.raycast(...r),
      surfaceAt: (x, y, z) => world.surfaceAt(x, y, z),
      waterDepth: (x) => waterAt(x),
    },
  });
  const light = new SquadMuzzleLight(scene);
  wireSquadShots({ events, audio, casings: () => last.casingProbe, light, body: (id) => mates[id].h });

  // A casing audio wrapper that remembers where each landing resolved, for the readout.
  const last = {
    shot: null as SquadEvents['squad:fired'] | null,
    landing: null as CasingLanding | null,
    occlusion: '-',
    casingProbe: { eject: (ej: Parameters<CasingAudio['eject']>[0]) => (last.landing = casings.eject(ej)) },
  };
  const occluder = wallOccluder((...ray) => world.raycast(...ray));
  const fire = (id: SquadId): void => {
    const m = mates[id];
    const shot: SquadEvents['squad:fired'] = { id, enemy: 'dummy', hit: false, killed: false, ...shotPoints({ position: m.h.group.position, body: m.h }) };
    last.shot = shot;
    last.occlusion = occluder(camera.position, new THREE.Vector3(shot.muzzle.x, shot.muzzle.y, shot.muzzle.z));
    events.emit('squad:fired', shot);
  };
  const jayShot = (): void => void audio.play('pistolShot', { bus: 'sfx', gain: 0.6, reverb: 0.35, rate: 0.97 + Math.random() * 0.06 });
  const squadInHead = (): void => void audio.play('squadPistolShot', { bus: 'sfx', gain: SQUAD_SHOT.gain, reverb: SQUAD_SHOT.reverb });

  // ---- Camera spots.
  const views: Record<string, { at: [number, number, number]; look: [number, number, number] }> = {
    side: { at: [-5.2, 1.7, 1.2], look: [0, 1.2, -2] },
    behind: { at: [0.4, 1.75, 3.4], look: [0, 1.3, -4] },
    giles: { at: [-1.2, 1.55, -0.9], look: [-2.6, 1.35, -0.4] },
    okafor: { at: [3.6, 1.55, -0.9], look: [2.1, 1.35, -0.4] },
    door: { at: [0, 1.6, -11.5], look: [0, 1.4, 0] },
    left3m: { at: [-3, 1.6, 0.2], look: [0, 1.4, -3] },
  };
  const goView = (id: string): void => {
    const v = views[id]!;
    camera.position.set(...v.at);
    camera.lookAt(...v.look);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    freeCam.yaw = e.y;
    freeCam.pitch = e.x;
  };
  goView('behind');

  // ---- Panel.
  const panel = document.querySelector<HTMLDivElement>('#panel')!;
  const stripOptions = (sel: string) => STRIPS.map((s) => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${s.label}</option>`).join('');
  panel.innerHTML = `
    <b>Squad sidearms</b>
    <h4>Fire</h4>
    <div class="row"><button id="fireG">Giles (1)</button><button id="fireO">Okafor (2)</button><button id="fireB">Both (3)</button></div>
    <label><input id="auto" type="checkbox"> Auto-fire at the squad's rate (F)</label>
    <h4>A/B the gunshot</h4>
    <div class="row"><button id="jay">Jay's shot (J)</button><button id="squadHead">Squad shot, in your head</button></div>
    <div>Positional squad shots come from the mates; try the "3 m left" view for the spec's covering-fire case.</div>
    <h4>Where they stand (brass lands on it)</h4>
    <label>Giles <select id="stripG">${stripOptions(mates.engineer.strip)}</select></label>
    <label>Okafor <select id="stripO">${stripOptions(mates.medic.strip)}</select></label>
    <h4>Target</h4>
    <label>Heading <input id="heading" type="range" min="-40" max="40" step="1" value="0"><span id="headingV">0°</span></label>
    <label>Aim height <input id="height" type="range" min="0.5" max="2.2" step="0.05" value="1.4"><span id="heightV">1.40 m</span></label>
    <label><input id="aim" type="checkbox" checked> Aim correction (off: the clip's own arm)</label>
    <h4>Room</h4>
    <label><input id="hatch" type="checkbox" checked> Hatch closed (muffles through it)</label>
    <label>Room light <input id="room" type="range" min="0" max="1" step="0.01" value="0.15"><span id="roomV">0.15</span></label>
    <h4>Time</h4>
    <div class="row"><button id="pause">Pause</button>
      <select id="speed"><option value="1" selected>1x</option><option value="0.25">0.25x</option><option value="0.05">0.05x (watch the flash)</option></select></div>
    <h4>View</h4>
    <div class="row"><button data-view="behind">Behind</button><button data-view="side">Side</button><button data-view="left3m">3 m left</button>
      <button data-view="giles">Giles's gun</button><button data-view="okafor">Okafor's gun</button><button data-view="door">Behind the hatch</button></div>
    <div id="readout"></div>`;
  const $ = <T extends HTMLElement>(id: string): T => panel.querySelector<T>(`#${id}`)!;
  $('fireG').onclick = () => fire('engineer');
  $('fireO').onclick = () => fire('medic');
  $('fireB').onclick = () => (fire('engineer'), fire('medic'));
  $<HTMLInputElement>('auto').onchange = (e) => (state.auto = (e.target as HTMLInputElement).checked);
  $('jay').onclick = jayShot;
  $('squadHead').onclick = squadInHead;
  $<HTMLSelectElement>('stripG').onchange = (e) => ((mates.engineer.strip = (e.target as HTMLSelectElement).value), placeMates());
  $<HTMLSelectElement>('stripO').onchange = (e) => ((mates.medic.strip = (e.target as HTMLSelectElement).value), placeMates());
  $<HTMLInputElement>('heading').oninput = (e) => {
    state.heading = Number((e.target as HTMLInputElement).value);
    $('headingV').textContent = `${state.heading}°`;
    placeTarget();
    placeMates();
  };
  $<HTMLInputElement>('height').oninput = (e) => {
    state.height = Number((e.target as HTMLInputElement).value);
    $('heightV').textContent = `${state.height.toFixed(2)} m`;
    placeTarget();
    placeMates();
  };
  $<HTMLInputElement>('aim').onchange = (e) => ((state.aim = (e.target as HTMLInputElement).checked), placeMates());
  $<HTMLInputElement>('hatch').onchange = (e) => setHatch((e.target as HTMLInputElement).checked);
  $<HTMLInputElement>('room').oninput = (e) => {
    state.roomLight = Number((e.target as HTMLInputElement).value);
    $('roomV').textContent = state.roomLight.toFixed(2);
    setRoomLight(state.roomLight);
  };
  $('pause').onclick = () => {
    state.paused = !state.paused;
    $('pause').textContent = state.paused ? 'Resume' : 'Pause';
  };
  $<HTMLSelectElement>('speed').onchange = (e) => (state.timeScale = Number((e.target as HTMLSelectElement).value));
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-view]')) b.onclick = () => goView(b.dataset.view!);
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Digit1') fire('engineer');
    else if (e.code === 'Digit2') fire('medic');
    else if (e.code === 'Digit3') (fire('engineer'), fire('medic'));
    else if (e.code === 'KeyJ') jayShot();
    else if (e.code === 'KeyF') {
      state.auto = !state.auto;
      $<HTMLInputElement>('auto').checked = state.auto;
    }
  });
  setHatch(true);
  setRoomLight(state.roomLight);

  // ---- Readout.
  const deg = (r: number) => `${THREE.MathUtils.radToDeg(r).toFixed(1)}°`;
  const tmpM = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const boreError = (h: Humanoid): string => {
    const p = h.pistol;
    if (!p) return 'no pistol';
    p.muzzle.getWorldPosition(tmpM);
    const bore = new THREE.Vector3(0, 0, -1).applyQuaternion(p.muzzle.getWorldQuaternion(tmpQ));
    return `${deg(bore.angleTo(aimPoint.clone().sub(tmpM)))} off (wrist ${deg(h.aimSwingAngle)}, shoulder ${deg(h.armSwingAngle)})`;
  };
  const readout = (): string => {
    const s = last.shot;
    const l = last.landing;
    return [
      `Giles   ${boreError(mates.engineer.h)}`,
      `Okafor  ${boreError(mates.medic.h)}`,
      `Flash light ${light.light.intensity.toFixed(2)}`,
      s ? `Last shot ${s.id === 'engineer' ? 'Giles' : 'Okafor'}${s.fromPistol ? '' : ' (no pistol: fallback point)'}, heard: ${last.occlusion === 'none' ? 'clear' : last.occlusion}` : 'No shot yet',
      l ? `Brass: ${l.surface} after ${l.delay.toFixed(2)} s${l.under ? `, then ${l.under.surface} below` : ''}` : 'Brass: -',
      `Sound: ${audio.hasSound('squadPistolShot') ? 'squad shot loaded' : 'loading...'}`,
    ].join('\n');
  };

  // ---- Loop.
  let lastT = performance.now();
  let readoutT = 0;
  const frame = (now: number): void => {
    const real = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const dt = state.paused ? 0 : real * state.timeScale;
    freeCam.update(real);
    if (state.auto && !state.paused) {
      (['engineer', 'medic'] as const).forEach((id, i) => {
        state.autoT[i]! -= dt;
        if (state.autoT[i]! <= 0) {
          state.autoT[i] = COMBAT.fireInterval * (0.85 + Math.random() * 0.3);
          fire(id);
        }
      });
    }
    for (const m of Object.values(mates)) m.h.update(dt, camera.position);
    light.update(dt);
    gore.update(dt);
    audio.updateListener(camera);
    readoutT -= real;
    if (readoutT <= 0) {
      readoutT = 0.1;
      $('readout').textContent = readout();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // For checks from the console or tests.
  (window as unknown as { squadSidearms: unknown }).squadSidearms = { mates, state, fire, light, camera, last, goView, setHatch };
}

void boot();
