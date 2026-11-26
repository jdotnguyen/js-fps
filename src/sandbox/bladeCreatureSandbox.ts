import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import posesJson from '../data/poses.json';
import bodyModelsJson from '../data/body-models.json';
import { BodyModelLibrary, validateBodyModelTable } from '../actors/bodyModelLibrary.ts';
import { castSpec } from '../actors/castLooks.ts';
import { GoreSystem } from '../actors/gore.ts';
import { Humanoid } from '../actors/humanoid.ts';
import { loadSharedMocapLibrary } from '../actors/mocap.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { Rng } from '../core/rng.ts';
import { validate } from '../core/validate.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { CollisionWorld } from '../world/collision.ts';

/**
 * The blade creature's review page (openspec rig-necromorph, design D10): /sandbox/blade-creature.html, dev server only.
 * Both of its sizes (1.85 m, the Lab B creature; 2.15 m, the R10 elite and the R11 hero) stand beside a 1.78 m crew figure.
 * Pick a pose, open the jaw, show the hit shapes, orbit, pause, step and slow down.
 *   ?pose=<name>   start every creature in that pose      ?hits   hit shapes on      ?speed=0.25
 *   window.blade.setPose(name, blend) / jaw(0..1) / flare(0..1) / clench(0..1) / pause(on) / step(frames) / speed(x) / view(name) / snap()
 */

const FLOOR = 0x2a2f36;

interface Figure {
  label: string;
  h: Humanoid;
  creature: boolean;
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const panel = document.querySelector<HTMLDivElement>('#panel')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15181c);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xdde6ee, 0x22262a, 1.2));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
  key.position.set(3, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5;
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(20, 40, 0x5d6b78, 0x3a434d);
  grid.position.y = 0.001;
  scene.add(grid);
  // Height marks: 1 m, 2 m and 3.2 m (a standard room's ceiling).
  for (const [y, c] of [[1, 0x557799], [2, 0x557799], [3.2, 0xcc6644]] as const) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4, y, -1), new THREE.Vector3(4, y, -1)]), new THREE.LineBasicMaterial({ color: c }));
    scene.add(line);
  }

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 1.1, 0);
  camera.position.set(0.6, 1.8, 5.6);
  orbit.update();

  // Only the creature's model: the crew figure is the procedural body.
  const table = validate(validateBodyModelTable, bodyModelsJson, 'data/body-models.json');
  const bodyModels = new BodyModelLibrary({ necromorph: table['necromorph']! });
  await Promise.all([bodyModels.load(import.meta.env.BASE_URL), loadSharedMocapLibrary()]);
  const posesFile = loadPoseFile(posesJson);
  const poses = new PoseLibrary(posesFile);
  const gore = new GoreSystem(new Rng('blade-sandbox'));
  scene.add(gore.group);
  const colliders = new CollisionWorld();
  const ctx = { poses, gore, bodyModels, colliders };

  const figures: Figure[] = [];
  const add = (label: string, look: string, x: number, creature: boolean): void => {
    const spec = castSpec(look, `sandbox-${look}`);
    const h = new Humanoid({ ...spec, role: 'npc', pose: 'idle' }, ctx);
    h.group.position.set(x, 0, 0);
    h.setHeading(Math.PI); // face the front camera (bodies face -Z)
    h.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(h.group);
    figures.push({ label, h, creature });
  };
  add('Lab B creature, 1.85 m', 'lab_creature', -1.3, true);
  add('R10 elite / R11 hero, 2.15 m', 'flood_elite', 1.3, true);
  add('crew, 1.78 m', 'crew', 3.4, false);
  const creatures = (): Figure[] => figures.filter((f) => f.creature);

  // --- state
  let paused = false;
  let ground = 0;
  let stepRate = 1;
  let speed = Number(params.get('speed') ?? 1);
  let stepFrames = 0;
  let hits = params.has('hits');
  const setAmount = (key: 'jaw' | 'flare' | 'clench', v: number): void => {
    for (const f of creatures()) if (f.h.blade) f.h.blade.amounts[key] = THREE.MathUtils.clamp(v, 0, 1);
  };
  const setPose = (name: string, blend = 0.3): void => {
    for (const f of creatures()) f.h.setPose(name, blend);
  };
  const showHits = (on: boolean): void => {
    hits = on;
    for (const f of figures) f.h.showHitboxes(on);
  };
  showHits(hits);
  if (params.get('pose')) setPose(params.get('pose')!, 0.01);

  // --- panel
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, parent: HTMLElement = panel): HTMLElementTagNameMap[K] => {
    const e = Object.assign(document.createElement(tag), props);
    parent.appendChild(e);
    return e;
  };
  el('h3', { textContent: 'Blade creature' });
  el('div', { textContent: 'drag to orbit · wheel to zoom · right-drag to pan' });
  el('h3', { textContent: 'Pose' });
  const filter = el('input', { type: 'text', placeholder: 'filter poses (blade_, maul_, pry_, ...)' });
  const list = el('select', { size: 12 });
  const fill = (): void => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(...Object.keys(posesFile.poses).filter((n) => n.toLowerCase().includes(q)).sort().map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
  };
  filter.addEventListener('input', fill);
  fill();
  const blendRow = el('label', { textContent: 'blend (s) ' });
  const blend = el('input', { type: 'number', value: '0.3', step: '0.05', min: '0', max: '3' }, blendRow);
  blend.style.width = '60px';
  list.addEventListener('change', () => setPose(list.value, Number(blend.value)));

  el('h3', { textContent: 'Jaw and belly arms' });
  const amount = (label: string, key: 'jaw' | 'flare' | 'clench'): HTMLInputElement => {
    const row = el('label', { textContent: `${label} ` });
    const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' }, row);
    input.addEventListener('input', () => setAmount(key, Number(input.value)));
    return input;
  };
  const sliders = { jaw: amount('jaw open', 'jaw'), flare: amount('belly flare', 'flare'), clench: amount('belly clench', 'clench') };

  el('h3', { textContent: 'Time' });
  const pauseBtn = el('button', { textContent: 'pause' });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.classList.toggle('on', paused);
  });
  el('button', { textContent: 'step' }).addEventListener('click', () => (stepFrames += 1));
  for (const s of [0.25, 0.5, 1]) {
    const b = el('button', { textContent: `${s}x` });
    b.addEventListener('click', () => (speed = s));
  }

  el('h3', { textContent: 'Move' });
  el('div', { textContent: 'creatures walk toward the camera and loop' });
  for (const [label, v] of [['stand', 0], ['prowl 1.1', 1.1], ['prowl 1.35', 1.35], ['charge 3.2', 3.2], ['rush 7.2', 7.2]] as const) {
    el('button', { textContent: label }).addEventListener('click', () => (ground = v));
  }
  el('button', { textContent: 'turn 90' }).addEventListener('click', () => turn());
  const rateRow = el('label', { textContent: 'step rate (a kill slows it) ' });
  const rateIn = el('input', { type: 'number', value: '1', step: '0.1', min: '0.3', max: '1.5' }, rateRow);
  rateIn.style.width = '60px';
  rateIn.addEventListener('input', () => (stepRate = Number(rateIn.value)));

  el('h3', { textContent: 'Performances & Combat' });
  const playPerf = (name: string, hold?: number): void => {
    ground = 0;
    for (const f of creatures()) f.h.playPerformance(name, ...(hold !== undefined ? [{ hold }] : []));
  };
  const stopPerf = (): void => {
    for (const f of creatures()) {
      f.h.stopPerformance();
      f.h.windupSide = null;
      f.h.grabbing = false;
      f.h.charge = 0;
    }
  };
  el('button', { textContent: 'scream' }).addEventListener('click', () => playPerf('scream'));
  el('button', { textContent: 'scream 5 s' }).addEventListener('click', () => playPerf('scream', 5));
  el('button', { textContent: 'windup R' }).addEventListener('click', () => {
    stopPerf();
    for (const f of creatures()) {
      f.h.charge = 1;
      f.h.windupSide = 'R';
    }
  });
  el('button', { textContent: 'slash R' }).addEventListener('click', () => {
    for (const f of creatures()) {
      f.h.windupSide = null;
      f.h.strike('R');
    }
  });
  el('button', { textContent: 'grab' }).addEventListener('click', () => {
    stopPerf();
    for (const f of creatures()) {
      f.h.charge = 1;
      f.h.grabbing = true;
    }
  });
  el('button', { textContent: 'stop' }).addEventListener('click', () => stopPerf());

  el('h3', { textContent: 'Show' });
  const hitBtn = el('button', { textContent: 'hit shapes' });
  hitBtn.classList.toggle('on', hits);
  hitBtn.addEventListener('click', () => {
    showHits(!hits);
    hitBtn.classList.toggle('on', hits);
  });
  const gridBtn = el('button', { textContent: 'floor grid' });
  gridBtn.classList.add('on');
  gridBtn.addEventListener('click', () => {
    grid.visible = !grid.visible;
    gridBtn.classList.toggle('on', grid.visible);
  });

  el('h3', { textContent: 'View' });
  const VIEWS: Record<string, [number, number, number, number, number, number]> = {
    front: [0.6, 1.8, 5.6, 0, 1.1, 0],
    side: [-6.5, 1.5, 0.4, 0, 1.1, 0],
    back: [0.6, 1.8, -5.6, 0, 1.1, 0],
    heads: [0.2, 2.2, 2.4, 0.2, 1.85, 0],
    elite: [1.9, 2.3, 1.4, 1.3, 1.95, 0],
    feet: [0, 0.4, 3.2, 0, 0.15, 0],
  };
  const view = (name: string): void => {
    const v = VIEWS[name] ?? VIEWS['front']!;
    camera.position.set(v[0], v[1], v[2]);
    orbit.target.set(v[3], v[4], v[5]);
    orbit.update();
  };
  for (const name of Object.keys(VIEWS)) el('button', { textContent: name }).addEventListener('click', () => view(name));

  el('h3', { textContent: 'Readout' });
  const readout = el('div', { id: 'readout' });


  const tmp = new THREE.Vector3();
  const updateReadout = (): void => {
    const lines = figures.map((f) => {
      const box = new THREE.Box3().setFromObject(f.h.group);
      return `${f.label}\n  top ${box.max.y.toFixed(2)} m  feet ${f.h.jointWorld('foot_L', tmp).y.toFixed(2)} m`;
    });
    readout.textContent = `${paused ? 'paused' : `${speed}x`}\n${lines.join('\n')}`;
  };

  const resize = (): void => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const toward = new THREE.Vector3(0, 0, 1);
  /** Turn each creature a quarter turn on the spot (to the left of where it faces). */
  const turnTo = new Map<Figure, THREE.Vector3>();
  const turn = (): void => {
    ground = 0;
    for (const f of creatures()) {
      const h = f.h.heading + Math.PI / 2;
      turnTo.set(f, new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)));
    }
  };
  const advance = (dt: number): void => {
    for (const f of creatures()) {
      (f.h as unknown as { animator: { gaitRate: number } }).animator.gaitRate = stepRate;
      const face = turnTo.get(f);
      if (face && ground === 0) {
        f.h.steer(face, dt, { maxSpeed: 0 });
        if (Math.abs(Math.atan2(Math.sin(f.h.heading - Math.atan2(-face.x, -face.z)), Math.cos(f.h.heading - Math.atan2(-face.x, -face.z)))) < 0.01) turnTo.delete(f);
      } else if (ground > 0) {
        f.h.group.position.addScaledVector(f.h.steer(toward, dt, { maxSpeed: ground, accel: 6 }), dt);
        if (f.h.group.position.z > 3.5) f.h.group.position.z = -6;
      } else f.h.steer(null, dt);
    }
    for (const f of figures) f.h.update(dt, camera.position);
  };
  let last = performance.now();
  let readoutT = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) advance(dt * speed);
    else if (stepFrames > 0) {
      stepFrames--;
      advance(1 / 60);
    }
    orbit.update();
    renderer.render(scene, camera);
    readoutT -= dt;
    if (readoutT <= 0) {
      readoutT = 0.25;
      updateReadout();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  (window as unknown as { blade: unknown }).blade = {
    figures,
    camera,
    scene,
    setPose,
    play: playPerf,
    stop: stopPerf,
    jaw: (v: number) => {
      setAmount('jaw', v);
      sliders.jaw.value = String(v);
    },
    flare: (v: number) => {
      setAmount('flare', v);
      sliders.flare.value = String(v);
    },
    clench: (v: number) => {
      setAmount('clench', v);
      sliders.clench.value = String(v);
    },
    pause: (on = true) => (paused = on),
    step: (frames = 1) => (stepFrames += frames),
    speed: (x: number) => (speed = x),
    /** Walk the creatures toward the camera at v m/s (0 stands), with an optional kill step rate. */
    turn,
    move: (v: number, rate = 1) => {
      ground = v;
      stepRate = rate;
    },
    hits: showHits,
    view,
    /** Advance `frames` at 1/60 s and return the picture as a JPEG data URL (works in a hidden or headless page). */
    snap: (frames = 0): string => {
      for (let i = 0; i < frames; i++) advance(1 / 60);
      renderer.render(scene, camera);
      return canvas.toDataURL('image/jpeg', 0.85);
    },
    /**
     * A contact sheet: `tiles` frames of one figure, `every` frames apart, in a grid, each from a camera that follows it
     * (`side`, `front` or `back`, at `dist` m). Shows how it moves, not just how it stands. Returns a JPEG data URL.
     */
    sheet: (opts: { figure?: number; tiles?: number; every?: number; cols?: number; view?: 'side' | 'front' | 'back'; dist?: number; size?: [number, number] } = {}): string => {
      const f = figures[opts.figure ?? 1]!;
      const tiles = opts.tiles ?? 16;
      const every = opts.every ?? 3;
      const cols = opts.cols ?? 8;
      const rows = Math.ceil(tiles / cols);
      const [w, h] = opts.size ?? [1600, 900];
      const tw = Math.floor(w / cols);
      const th = Math.floor(h / rows);
      const shown = figures.map((x) => x.h.group.visible);
      figures.forEach((x) => (x.h.group.visible = x === f));
      const cam = new THREE.PerspectiveCamera(32, tw / th, 0.05, 80);
      renderer.setSize(w, h, false);
      renderer.setScissorTest(true);
      renderer.setClearColor(0x15181c);
      const pos = new THREE.Vector3();
      for (let i = 0; i < tiles; i++) {
        if (i > 0) for (let k = 0; k < every; k++) advance(1 / 60);
        f.h.group.getWorldPosition(pos);
        const heading = f.h.heading;
        const fwd = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
        const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const d = opts.dist ?? 4.2;
        const off = opts.view === 'front' ? fwd.clone().multiplyScalar(d) : opts.view === 'back' ? fwd.clone().multiplyScalar(-d) : side.clone().multiplyScalar(d);
        cam.position.copy(pos).add(off).setY(pos.y + 1.15);
        // Framed a little ahead of the feet: the head and blades reach forward.
        cam.lookAt(pos.x + fwd.x * 0.35, pos.y + 0.95, pos.z + fwd.z * 0.35);
        const x = (i % cols) * tw;
        const y = h - (Math.floor(i / cols) + 1) * th;
        renderer.setViewport(x, y, tw, th);
        renderer.setScissor(x, y, tw, th);
        renderer.clear();
        renderer.render(scene, cam);
      }
      const url = canvas.toDataURL('image/jpeg', 0.85);
      renderer.setScissorTest(false);
      figures.forEach((x, i) => (x.h.group.visible = shown[i]!));
      resize();
      return url;
    },
  };
}

boot().catch((e: unknown) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:absolute;top:0;left:320px">${String(e)}</pre>`);
});
