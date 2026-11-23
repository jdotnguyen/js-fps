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
import { GoreSystem } from '../actors/gore.ts';
import { Humanoid, type HumanoidSpec } from '../actors/humanoid.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { CAST, castSpec } from '../actors/castLooks.ts';
import { GILES, OKAFOR } from '../actors/squadLooks.ts';
import { loadSharedMocapLibrary } from '../actors/mocap.ts';
import { loadMocapPacks } from '../actors/mocapPacks.ts';
import { sharedMotionProfiles } from '../actors/motionProfiles.ts';
import { needFor, ownCovers } from '../actors/castMotionCoverage.ts';
import { detailPass } from '../actors/detailPass.ts';
import { injuryWeight } from '../actors/injury.ts';
import { loadSquadPistolModel } from '../actors/squadPistol.ts';

/**
 * Cast motion sandbox (character-motion spec, design D10): one row per named character plus the two crew defaults, one column
 * per activity and posture, each cell a copy of that character doing that thing. Red labels mark cells that fall back to the
 * default motion. Extra row: Giles with the injury sliders. Open /sandbox/cast-motion.html.
 */

interface Column {
  id: string;
  pose: string;
  walk?: boolean;
  talk?: boolean;
}

const COLUMNS: Column[] = [
  { id: 'idle', pose: 'idle' },
  { id: 'idle_wand', pose: 'idle_wand' },
  { id: 'talk', pose: 'idle', talk: true },
  { id: 'walk', pose: 'idle', walk: true },
  { id: 'kneel', pose: 'kneel_revive' },
  { id: 'crouch', pose: 'crouchWork' },
  { id: 'aim', pose: 'aim_pistol' },
  { id: 'drink', pose: 'drink' },
  { id: 'work', pose: 'typing' },
  { id: 'sit_chair', pose: 'sit_chair' },
  { id: 'sit_stool', pose: 'sit_stool' },
  { id: 'lean_wall', pose: 'lean_wall' },
  { id: 'lean_back', pose: 'lean_back_mug' },
  { id: 'lean_counter', pose: 'lean_counter' },
];

interface RowDef {
  id: string;
  label: string;
  spec: Omit<HumanoidSpec, 'role'>;
  injury?: boolean;
}

const ROWS: RowDef[] = [
  { id: 'giles', label: 'Giles', spec: GILES },
  { id: 'giles_injury', label: 'Giles (injury)', spec: GILES, injury: true },
  { id: 'okafor', label: 'Okafor', spec: OKAFOR },
  ...(['priya', 'voss', 'bram', 'ruiz', 'heins', 'hale', 'sung'] as const).map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1), spec: CAST[id]! })),
  { id: 'dock_guard', label: 'Dock guard', spec: castSpec('security', 'dock_guard') },
  { id: 'crew_m', label: 'Crew (m)', spec: { seed: 'crew:sandbox_m', outfit: 'crew', model: 'office1' } },
  { id: 'crew_f', label: 'Crew (f)', spec: { seed: 'crew:sandbox_f', outfit: 'crew', model: 'office2' } },
];

const SPACING_X = 1.6;
const SPACING_Z = 2.6;
const LANE = 1.2;
const LOAD_RADIUS = 14;

interface Cell {
  row: RowDef;
  col: Column;
  h: Humanoid;
  home: THREE.Vector3;
  dir: number;
  label: THREE.Sprite;
}

function labelSprite(text: string, fallback: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = fallback ? '#7a1d1d' : '#1d3a2a';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#fff';
  g.font = '22px system-ui, sans-serif';
  g.fillText(text, 8, 31);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1.2, 0.225, 1);
  return s;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const events = new EventBus();
  const settings = new SettingsStore(events);
  const poses = new PoseLibrary(loadPoseFile(posesJson));
  const renderer = createRenderer(canvas, settings.get());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xdde6ee, 0x22262a, 1.4));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.4);
  key.position.set(4, 8, 6);
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 120);
  camera.position.set((COLUMNS.length * SPACING_X) / 2, 2.4, 4.5);
  camera.lookAt((COLUMNS.length * SPACING_X) / 2, 1, -3);
  const input = new Input(canvas, validate(validateKeymap, keymapJson, 'data/keymap.json'), events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.speed = 4;
  canvas.addEventListener('click', () => input.requestLock());
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const bodyModels = new BodyModelLibrary(validate(validateBodyModelTable, bodyModelsJson, 'data/body-models.json'));
  const profiles = sharedMotionProfiles();
  await Promise.all([
    bodyModels.load(import.meta.env.BASE_URL),
    loadSharedMocapLibrary().then((lib) => loadMocapPacks(lib, Object.keys(profiles.profiles))),
    loadSquadPistolModel(),
  ]);
  const gore = new GoreSystem(new Rng('sandbox-gore'));
  scene.add(gore.group);

  // ---- UI
  const state = { paused: false, speed: 1, soloRow: '', soloCol: '', stage: 0, exposure: 0 };
  const panel = document.querySelector<HTMLDivElement>('#panel')!;
  panel.innerHTML = `
    <b>Cast motion</b>
    <div class="row"><button id="pause">Pause</button><button id="step">Step</button><button id="restart">Restart</button>
      <select id="speed"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option></select></div>
    <label>Scrub (paused) <input id="scrub" type="range" min="0" max="5" step="0.05" value="0"></label>
    <div class="row"><select id="soloRow"><option value="">all rows</option>${ROWS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('')}</select>
      <select id="soloCol"><option value="">all columns</option>${COLUMNS.map((c) => `<option value="${c.id}">${c.id}</option>`).join('')}</select></div>
    <label><input id="detail" type="checkbox" checked> detail pass (fingers, twist, trunk)</label>
    <label>Giles stage <input id="stage" type="range" min="0" max="4" step="1" value="0"><span id="stageV">0</span></label>
    <label>Giles exposure <input id="exposure" type="range" min="0" max="1" step="0.05" value="0"><span id="expV">0</span></label>
    <div>Red label: falls back to the default motion. Click to look, WASD to fly.</div>`;
  const $ = <T extends HTMLElement>(id: string): T => panel.querySelector<T>(`#${id}`)!;

  // ---- Cells (rows load as the camera nears them)
  const cells: Cell[] = [];
  const loaded = new Set<string>();
  const rowZ = (i: number): number => -i * SPACING_Z;
  const buildRow = (ri: number): void => {
    const row = ROWS[ri]!;
    loaded.add(row.id);
    COLUMNS.forEach((col, ci) => {
      const home = new THREE.Vector3(ci * SPACING_X, 0, rowZ(ri));
      const h = new Humanoid({ ...row.spec, role: 'npc', pose: col.pose }, { poses, gore, bodyModels });
      h.group.position.copy(home);
      h.group.rotation.y = Math.PI; // face the camera (bodies face -Z)
      scene.add(h.group);
      const prof = row.spec.profile ?? profiles.defaults[row.id === 'crew_f' ? 'f' : 'm'];
      const need = needFor(col.walk ? 'walk' : col.talk ? 'talk' : col.pose);
      const fallback = !row.spec.profile || !ownCovers(profiles, prof, need, '', col.pose);
      const label = labelSprite(`${row.label} · ${col.id}`, fallback);
      label.position.set(home.x, 0.05, home.z + 0.55);
      scene.add(label);
      cells.push({ row, col, h, home, dir: 1, label });
    });
  };
  const restart = (): void => {
    for (const c of cells) {
      scene.remove(c.h.group, c.label);
      c.h.dispose();
    }
    cells.length = 0;
    loaded.clear();
  };

  const tmp = new THREE.Vector3();
  const stepCells = (dt: number): void => {
    for (const c of cells) {
      if (c.col.talk && !c.h.speaking) c.h.speak('Nobody tells the kitchen anything. We just hear the pipes.', null, 4);
      if (c.col.walk) {
        const off = c.h.group.position.x - c.home.x;
        if (off > LANE) c.dir = -1;
        if (off < -LANE) c.dir = 1;
        c.h.move(tmp.set(c.dir, 0, 0), dt);
      }
      if (c.row.injury) {
        c.h.setInjury(state.stage >= 4 ? 1 : injuryWeight(state.stage, state.exposure));
        c.h.setHandTwitchStage(state.stage);
      }
      c.h.update(dt, camera.position);
    }
  };

  $<HTMLButtonElement>('pause').onclick = (e) => {
    state.paused = !state.paused;
    (e.target as HTMLButtonElement).textContent = state.paused ? 'Play' : 'Pause';
  };
  $<HTMLButtonElement>('step').onclick = () => stepCells(1 / 30);
  $<HTMLButtonElement>('restart').onclick = restart;
  $<HTMLSelectElement>('speed').onchange = (e) => (state.speed = Number((e.target as HTMLSelectElement).value));
  let scrubAt = 0;
  $<HTMLInputElement>('scrub').oninput = (e) => {
    // Scrubbing advances the paused grid to the slider's time since the last restart; dragging back restarts and replays.
    const t = Number((e.target as HTMLInputElement).value);
    if (t < scrubAt) {
      restart();
      scrubAt = 0;
      return;
    }
    for (; scrubAt < t; scrubAt += 1 / 30) stepCells(1 / 30);
  };
  // Picking a row flies the camera to it (rows only load near the camera, so a row far back would otherwise never appear).
  $<HTMLSelectElement>('soloRow').onchange = (e) => {
    state.soloRow = (e.target as HTMLSelectElement).value;
    const i = ROWS.findIndex((r) => r.id === state.soloRow);
    if (i < 0) return;
    camera.position.set((COLUMNS.length * SPACING_X) / 2, 2.0, rowZ(i) + 5.5);
    freeCam.yaw = 0;
    freeCam.pitch = -0.12;
    camera.rotation.set(freeCam.pitch, freeCam.yaw, 0);
  };
  $<HTMLSelectElement>('soloCol').onchange = (e) => (state.soloCol = (e.target as HTMLSelectElement).value);
  $<HTMLInputElement>('detail').onchange = (e) => (detailPass.enabled = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>('stage').oninput = (e) => {
    state.stage = Number((e.target as HTMLInputElement).value);
    $('stageV').textContent = String(state.stage);
  };
  $<HTMLInputElement>('exposure').oninput = (e) => {
    state.exposure = Number((e.target as HTMLInputElement).value);
    $('expV').textContent = state.exposure.toFixed(2);
  };

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    freeCam.update(dt);
    ROWS.forEach((r, i) => {
      const near = Math.abs(camera.position.z - rowZ(i)) < LOAD_RADIUS;
      const wanted = (!state.soloRow || state.soloRow === r.id) && near;
      if (wanted && !loaded.has(r.id)) buildRow(i);
    });
    for (const c of cells) {
      const show = (!state.soloRow || state.soloRow === c.row.id) && (!state.soloCol || state.soloCol === c.col.id);
      c.h.group.visible = show;
      c.label.visible = show;
    }
    if (!state.paused) stepCells(dt * state.speed);
    gore.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // For checks from the console or tests.
  (window as unknown as { castMotion: unknown }).castMotion = { cells, state, rows: ROWS, columns: COLUMNS, camera };
}

void boot();
