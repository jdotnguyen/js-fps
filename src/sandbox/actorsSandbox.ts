import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import '../ui/styles/base.css';
import keymapJson from '../data/keymap.json';
import posesJson from '../data/poses.json';
import { validateKeymap } from '../data/types/keymap.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { createDebugTools, readDebugFlags } from '../core/debug.ts';
import { EventBus } from '../core/events.ts';
import { FreeCamera } from '../core/freeCamera.ts';
import { Input } from '../core/input.ts';
import { Loop } from '../core/loop.ts';
import { Rng } from '../core/rng.ts';
import { SettingsStore } from '../core/settings.ts';
import { validate } from '../core/validate.ts';
import { createRenderer } from '../render/renderer.ts';
import { createMaterials } from '../render/materials.ts';
import { createPost } from '../render/post.ts';
import { Flashlight } from '../render/flashlight.ts';
import { GoreSystem } from '../actors/gore.ts';
import { Humanoid, type BodyHit, type HumanoidSpec } from '../actors/humanoid.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { separate, type SepBody } from '../actors/separation.ts';
import { SLAM, slamFalloff } from '../actors/slam.ts';

/**
 * ADR-0006 test room: /sandbox/actors.html (dev server only, not part of the game build).
 * Shoot each part to check severing and the behaviour change. Kept out of main.ts on
 * purpose so it never collides with menu/save work there.
 */

const FOG = 0x04080a;
const PISTOL = { damage: 18, pellets: 1, spread: 0 };
const SHOTGUN = { damage: 9, pellets: 8, spread: THREE.MathUtils.degToRad(4) };

interface Actor {
  h: Humanoid;
  wanderDir: THREE.Vector3;
  wanderTimer: number;
  lurchTimer: number;
  lurchLeft: number;
}

function el<T extends HTMLElement>(sel: string): T {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error(`sandbox page is missing ${sel}`);
  return e;
}

function injectStyles(): void {
  const s = document.createElement('style');
  s.textContent = `
    #sandbox-hud { position: absolute; left: 12px; top: 56px; margin: 0; padding: 10px 12px; max-width: 46ch;
      background: rgb(5 9 12 / 0.72); border: 1px solid rgb(207 232 240 / 0.25); font: 12px/1.45 var(--mono); white-space: pre-wrap; }
    #crosshair { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px;
      border: 1px solid var(--visor); border-radius: 50%; opacity: 0.8; }`;
  document.head.appendChild(s);
}

async function boot(): Promise<void> {
  injectStyles();
  const canvas = el<HTMLCanvasElement>('#game');
  const prompt = el<HTMLElement>('#prompt');
  const hud = el<HTMLElement>('#sandbox-hud');
  const events = new EventBus();
  const settings = new SettingsStore(events);
  const flags = readDebugFlags(location.search);
  const keymap = validate(validateKeymap, keymapJson, 'data/keymap.json');
  const poses = new PoseLibrary(loadPoseFile(posesJson));
  const usePost = !new URLSearchParams(location.search).has('nopost');

  const renderer = createRenderer(canvas, settings.get());
  // Count draw calls across every post pass, not just the last one.
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.045);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.15;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(settings.get().fov, innerWidth / innerHeight, 0.05, 80);
  camera.position.set(0, 1.62, 6);

  // ---------------------------------------------------------------- room
  const mats = createMaterials(512, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const room = new THREE.Group();
  const floorMat = mats.diamond.clone();
  for (const t of [floorMat.map, floorMat.normalMap, floorMat.roughnessMap]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);
  const solids: THREE.Mesh[] = [floor];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    room.add(mesh);
    solids.push(mesh);
    return mesh;
  };
  box(16, 3.4, 0.2, 0, 1.7, -8.1, mats.paintDark);
  box(0.2, 3.4, 16, -7.1, 1.7, 0, mats.paintTeal);
  box(0.2, 3.4, 16, 7.1, 1.7, 0, mats.paintDark);
  box(16, 3.4, 0.2, 0, 1.7, 8.1, mats.paintDark);
  // Engineer's wall panel (left), medic's console (right).
  box(0.25, 0.9, 1.2, -6.85, 0.75, -2, mats.steel);
  box(0.7, 1.0, 1.4, 5.4, 0.5, -4, mats.paintBone);
  room.add(new THREE.HemisphereLight(0x8fa3ad, 0x14181b, 0.35));
  if (new URLSearchParams(location.search).has('rim')) {
    const key = new THREE.DirectionalLight(0xffd7b0, 2.2); key.position.set(-3, 4, 4); room.add(key);
    const rim = new THREE.DirectionalLight(0x5fe0c0, 3.0); rim.position.set(3, 3, -4); room.add(rim);
  }
  for (const [x, z, shadow] of [[0, -4, true], [-4.5, -1, false], [4.5, -4, false], [0, 3, false]] as const) {
    const spot = new THREE.SpotLight(0xffe2bd, 38, 11, THREE.MathUtils.degToRad(48), 0.6, 1.6);
    spot.position.set(x, 3.3, z);
    spot.target.position.set(x, 0, z);
    spot.castShadow = shadow;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0005;
    room.add(spot, spot.target);
  }
  scene.add(room);

  const gore = new GoreSystem(new Rng('sandbox-gore'));
  scene.add(gore.group);
  const flashlight = new Flashlight(scene, camera);

  // ---------------------------------------------------------------- humanoids
  const actors: Actor[] = [];
  let engineer: Humanoid | null = null;
  let hitboxes = false;

  const spawn = (spec: HumanoidSpec, x: number, z: number, heading: number): Humanoid => {
    const h = new Humanoid(spec, { poses, gore });
    h.group.position.set(x, 0, z);
    h.heading = heading;
    h.group.rotation.y = heading;
    scene.add(h.group);
    h.showHitboxes(hitboxes);
    actors.push({ h, wanderDir: new THREE.Vector3(), wanderTimer: 0, lurchTimer: 2 + Math.random() * 4, lurchLeft: 0 });
    return h;
  };

  const stress = new URLSearchParams(location.search).has('stress');
  const spawnAll = (): void => {
    for (const a of actors) a.h.dispose();
    actors.length = 0;
    gore.clear();
    if (stress) {
      // ADR-0015 budget scene: 8 crowd bodies and 3 heroes (`?stress`).
      const outfits = ['crew', 'lab', 'security', 'medic', 'engineer'] as const;
      for (let i = 0; i < 8; i++) {
        spawn({ seed: `stress-${i}`, outfit: outfits[i % outfits.length] ?? 'crew', role: 'enemy', infection: 1 + (i % 3) }, -4.5 + (i % 4) * 3, -6.5 + Math.floor(i / 4) * 1.8, 0);
      }
      for (let i = 0; i < 3; i++) {
        spawn({ seed: `stress-hero-${i}`, outfit: 'lab', role: 'enemy', infection: 2, hero: true, height: 2.15, build: 1.25, pose: 'hulk' }, -3 + i * 3, -2.5, 0);
      }
      return;
    }
    spawn({ seed: 'shambler-a', outfit: 'crew', role: 'enemy', infection: 1 }, -2.2, -6, 0);
    spawn({ seed: 'shambler-b', outfit: 'lab', role: 'enemy', infection: 2 }, 0.4, -7, 0.2);
    spawn({ seed: 'shambler-c', outfit: 'security', role: 'enemy', infection: 3 }, 2.6, -6.4, -0.3);
    spawn({ seed: 'hero-warden', outfit: 'lab', role: 'enemy', infection: 2, hero: true, height: 2.15, build: 1.25, baseHp: 400, pose: 'hulk' }, 0.2, -3, 0);
    spawn({ seed: 'shambler-d', outfit: 'crew', role: 'enemy', infection: 2.5 }, -0.8, -4.6, 0.1);
    const lurker = spawn({ seed: 'playdead-a', outfit: 'lab', role: 'enemy', infection: 2 }, 2.2, -1.5, 2.4);
    lurker.playDead('corpseProne');
    engineer = spawn({ seed: 'august-giles', outfit: 'engineer', role: 'npc', transformable: true, pose: 'crouchWork', height: 1.82 }, -6.05, -2, Math.PI / 2);
    engineer.plantFeet = true;
    engineer.handTargets.L = new THREE.Vector3(-6.72, 0.95, -1.82);
    engineer.handTargets.R = new THREE.Vector3(-6.72, 0.88, -2.2);
    const medic = spawn({ seed: 'okafor', outfit: 'medic', role: 'npc', pose: 'typing', height: 1.8 }, 4.6, -4, -Math.PI / 2);
    medic.handTargets.L = new THREE.Vector3(5.12, 1.02, -4.22);
    medic.handTargets.R = new THREE.Vector3(5.12, 1.02, -3.8);
    spawn({ seed: 'corpse-sec', outfit: 'security', role: 'corpse', pose: 'corpseSlumped' }, -6.62, 2.2, -Math.PI / 2);
  };
  spawnAll();

  // ---------------------------------------------------------------- shooting
  let weapon = PISTOL;
  let lastHit = 'Shoot a body part.';
  const raycaster = new THREE.Raycaster();
  const ray = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();

  const fire = (origin: THREE.Vector3, direction: THREE.Vector3): BodyHit | null => {
    const lines: string[] = [];
    let first: BodyHit | null = null;
    for (let p = 0; p < weapon.pellets; p++) {
      ray.copy(direction);
      if (weapon.spread > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * weapon.spread;
        tmpQ.setFromAxisAngle(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).applyQuaternion(camera.quaternion), r);
        ray.applyQuaternion(tmpQ);
      }
      raycaster.set(origin, ray);
      raycaster.far = 60;
      const wall = raycaster.intersectObjects(solids, false)[0];
      const limit = wall ? wall.distance : 60;
      let best: BodyHit | null = null;
      for (const a of actors) {
        const hit = a.h.raycast(origin, ray, limit);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      if (!best) continue;
      first ??= best;
      // Shotgun falloff: full to 6 m, 50% at 12 m (ADR-0005).
      const falloff = weapon === SHOTGUN ? 1 - 0.5 * THREE.MathUtils.clamp((best.distance - 6) / 6, 0, 1) : 1;
      const r = best.humanoid.applyHit(best, weapon.damage * falloff, ray);
      const hp = best.humanoid.damage.hpOf(r.region).toFixed(0);
      const max = best.humanoid.damage.maxHp[r.region].toFixed(0);
      let line = `${best.humanoid.spec.seed} · ${r.region} −${r.applied.toFixed(0)} (${hp}/${max})`;
      if (r.severed) line += ` → SEVERED ${r.lost.join('+')}`;
      if (r.weakSpot) line += ` · WEAK SPOT`;
      if (r.killed) line += ` → DEAD (${r.killedBy})`;
      lines.push(line);
    }
    if (lines.length) lastHit = lines.slice(-4).join('\n');
    return first;
  };

  // ---------------------------------------------------------------- input
  const input = new Input(canvas, keymap, events);
  const freeCam = new FreeCamera(camera, input, () => settings.get());
  freeCam.speed = 3;
  freeCam.bounds = new THREE.Box3(new THREE.Vector3(-6.7, 0.25, -7.7), new THREE.Vector3(6.7, 3, 7.7));
  canvas.addEventListener('click', () => input.requestLock());
  prompt.textContent = 'Click to start · WASD move · Mouse shoot';
  prompt.hidden = false;
  events.on('input:pointerLock', ({ locked }) => {
    prompt.hidden = locked;
  });
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyH') {
      hitboxes = !hitboxes;
      for (const a of actors) a.h.showHitboxes(hitboxes);
    } else if (e.code === 'KeyG') {
      gore.mode = gore.mode === 'full' ? 'reduced' : 'full';
    } else if (e.code === 'KeyT') {
      engineer?.startTransformation(6);
    } else if (e.code === 'KeyR') {
      spawnAll();
      lastHit = 'Reset.';
    }
  });

  const post = usePost ? createPost(renderer, scene, camera, settings.get().quality) : null;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post?.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  });
  renderer.compile(scene, camera);
  const debug = flags.enabled ? await createDebugTools() : null;
  if (debug) {
    const g = debug.gui;
    g.add(gore, 'mode', ['full', 'reduced']).name('gore').listen();
    const eng = { infection: 0 };
    g.add(eng, 'infection', 0, 3, 0.01).name('engineer infection').onChange((v: number) => engineer?.setInfection(v));
  }

  // ---------------------------------------------------------------- AI stand-in
  const toCam = new THREE.Vector3();
  const think = (a: Actor, dt: number): void => {
    const h = a.h;
    if (h.spec.role !== 'enemy') {
      h.lookTarget = h.group.position.distanceTo(camera.position) < 5 ? camera.position : null;
      return;
    }
    if (h.state === 'playingDead') {
      if (h.group.position.distanceTo(camera.position) < 3) h.getUp();
      return;
    }
    // Lurch bursts: 2.4 m/s for 0.6 s every 4-7 s (ADR-0007).
    a.lurchTimer -= dt;
    if (a.lurchTimer <= 0) {
      a.lurchLeft = 0.6;
      a.lurchTimer = 4 + Math.random() * 3;
    }
    a.lurchLeft -= dt;
    // Heroes never lurch: they come on at one steady, heavy pace (ADR-0021).
    h.speedScale = a.lurchLeft > 0 && !h.spec.hero ? 2.4 / 1.3 : 1;
    toCam.subVectors(camera.position, h.group.position).setY(0);
    const dist = toCam.length();
    let desired: THREE.Vector3 | null = null;
    if (h.locomotion.blind) {
      a.wanderTimer -= dt;
      if (a.wanderTimer <= 0) {
        const ang = Math.random() * Math.PI * 2;
        a.wanderDir.set(Math.sin(ang), 0, Math.cos(ang));
        a.wanderTimer = 2 + Math.random() * 2;
      }
      desired = a.wanderDir;
    } else if (dist > 1.3 && dist < 16) {
      desired = toCam;
    }
    h.lookTarget = camera.position;
    // Lunge when close: jaw gapes, arms reach.
    h.charge = !h.spec.hero && !h.locomotion.blind && dist < 2.6 ? 1 : 0;
    if (h.spec.hero) {
      // Close the last of the distance to slam range, then slam.
      if (dist < SLAM.range * 0.75) desired = null;
      h.tryAttack(camera.position);
      if (h.slam?.busy) desired = toCam;
    }
    h.move(desired, dt);
    // Keep inside the room.
    h.group.position.x = THREE.MathUtils.clamp(h.group.position.x, -6.6, 6.6);
    h.group.position.z = THREE.MathUtils.clamp(h.group.position.z, -7.6, 7.6);
  };

  // ---------------------------------------------------------------- separation (ADR-0018)
  // Live enemies are pushed apart; corpses, seated NPCs, play-dead bodies and the camera are immovable.
  // `?nosep` turns it off so the old clipping can be compared.
  const separationOn = !new URLSearchParams(location.search).has('nosep');
  const sepBodies: SepBody[] = [];
  const sepOwners: Array<Humanoid | null> = [];
  const PLAYER_RADIUS = 0.35;
  const applySeparation = (): void => {
    sepBodies.length = 0;
    sepOwners.length = 0;
    for (const a of actors) {
      const h = a.h;
      const fp = h.footprint;
      const mobile = h.spec.role === 'enemy' && (h.state === 'alive' || h.state === 'falling' || h.state === 'gettingUp');
      sepBodies.push({ x: h.group.position.x, z: h.group.position.z, r: fp.r, mass: mobile ? fp.mass : Infinity });
      sepOwners.push(mobile ? h : null);
    }
    sepBodies.push({ x: camera.position.x, z: camera.position.z, r: PLAYER_RADIUS, mass: Infinity });
    sepOwners.push(null);
    separate(sepBodies);
    sepOwners.forEach((h, i) => {
      const b = sepBodies[i];
      if (!h || !b) return;
      h.group.position.x = THREE.MathUtils.clamp(b.x, -6.6, 6.6);
      h.group.position.z = THREE.MathUtils.clamp(b.z, -7.6, 7.6);
    });
  };

  // ---------------------------------------------------------------- loop
  let simTime = 0;
  /** Camera shake 0..1 from hero stomps and slams; applied at render time only. */
  let shake = 0;
  let lastSlam = '';
  const shakeOffset = new THREE.Vector3();
  let fps = 60;
  let frozen = false;
  const loop = new Loop({
    update: (dt) => {
      simTime += dt;
      if (input.wasPressed('weapon1')) weapon = PISTOL;
      if (input.wasPressed('weapon2')) weapon = SHOTGUN;
      if (input.wasPressed('flashlight')) flashlight.toggle();
      if (input.locked && input.wasPressed('fire')) fire(camera.position, camera.getWorldDirection(fwd));
      freeCam.update(dt);
      if (frozen) {
        input.endStep();
        return;
      }
      for (const a of actors) think(a, dt);
      if (separationOn) applySeparation();
      for (const a of actors) {
        a.h.update(dt, camera.position);
        const impact = a.h.consumeSlamImpact();
        if (impact) {
          const d = Math.hypot(camera.position.x - impact.x, camera.position.z - impact.z);
          const f = slamFalloff(d);
          shake = Math.max(shake, 0.35 + 0.65 * f);
          lastSlam = f > 0 ? `SLAM · hit you for ${(SLAM.damage * f).toFixed(0)}` : `SLAM · missed (${d.toFixed(1)} m)`;
        }
        if (a.h.footfall) {
          const d = a.h.group.position.distanceTo(camera.position);
          if (d < 8) shake = Math.max(shake, 0.12 * (1 - d / 8));
        }
      }
      shake = Math.max(0, shake - dt * 2.2);
      gore.update(dt);
      input.endStep();
    },
    render: (_alpha, frameDt) => {
      renderer.info.reset();
      debug?.beginFrame();
      freeCam.look();
      shakeOffset.set(Math.sin(simTime * 61), Math.sin(simTime * 77 + 1), Math.sin(simTime * 53 + 2)).multiplyScalar(0.03 * shake * shake);
      camera.position.add(shakeOffset);
      flashlight.update(frameDt);
      if (post) post.render(simTime);
      else renderer.render(scene, camera);
      debug?.endFrame();
      camera.position.sub(shakeOffset);
      if (frameDt > 0) fps += (1 / frameDt - fps) * 0.05;
      const info = renderer.info.render;
      const alive = actors.filter((a) => a.h.alive).length;
      const tris = Math.round(actors.reduce((s, a) => s + a.h.triangles, 0) / actors.length);
      hud.textContent = [
        `ACTORS SANDBOX · ADR-0006`,
        `weapon ${weapon === PISTOL ? 'pistol (18)' : 'shotgun (8×9)'}  [1/2]`,
        `gore ${gore.mode.toUpperCase()}  [G]   hitboxes ${hitboxes ? 'on' : 'off'}  [H]`,
        `[T] transform engineer   [R] reset   [F] flashlight   separation ${separationOn ? 'on' : 'off (?nosep)'}`,
        ``,
        lastHit,
        lastSlam,
        `alive ${alive}/${actors.length}   debris ${gore.activeDebris}   pools ${gore.activePools}`,
        `tris/body ${tris}   draw calls ${info.calls}   ${fps.toFixed(0)} fps`,
      ].join('\n');
    },
  });
  loop.start();

  // Automation hook for headless checks.
  Object.assign(window, {
    __actors: {
      actors: () => actors.map((a) => a.h),
      gore,
      camera,
      /** Place the camera and aim it (FreeCamera owns yaw/pitch). */
      view: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
        camera.position.set(x, y, z);
        const d = new THREE.Vector3(tx - x, ty - y, tz - z).normalize();
        freeCam.yaw = Math.atan2(-d.x, -d.z);
        freeCam.pitch = Math.asin(d.y);
      },
      freeze: (on: boolean) => {
        frozen = on;
      },
      step: (seconds: number, withAi = false) => {
        for (let t = 0; t < seconds; t += 1 / 60) {
          for (const a of actors) {
            if (withAi) think(a, 1 / 60);
            a.h.update(1 / 60, camera.position);
          }
          gore.update(1 / 60);
        }
      },
      fire: (o: THREE.Vector3, d: THREE.Vector3) => fire(o, d),
      /**
       * ADR-0015 benchmark that does not depend on requestAnimationFrame (a hidden pane throttles it):
       * runs `frames` full frames (AI, separation, animation, render) at w x h CSS pixels, waiting for
       * the GPU after each one, and reports frame time in ms. Pessimistic: CPU and GPU never overlap.
       */
      bench: (frames = 300, w = 1440, h = 900, warmup = 30) => {
        const prevSize = renderer.getSize(new THREE.Vector2());
        renderer.setSize(w, h, false);
        post?.setSize(w, h, renderer.getPixelRatio());
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const gl = renderer.getContext();
        const px = new Uint8Array(4);
        const total: number[] = [];
        const cpu: number[] = [];
        let calls = 0;
        let triangles = 0;
        const dt = 1 / 60;
        for (let i = 0; i < frames + warmup; i++) {
          const t0 = performance.now();
          simTime += dt;
          for (const a of actors) think(a, dt);
          if (separationOn) applySeparation();
          for (const a of actors) a.h.update(dt, camera.position);
          gore.update(dt);
          const t1 = performance.now();
          renderer.info.reset();
          if (post) post.render(simTime);
          else renderer.render(scene, camera);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const t2 = performance.now();
          if (i < warmup) continue;
          total.push(t2 - t0);
          cpu.push(t1 - t0);
          calls = Math.max(calls, renderer.info.render.calls);
          triangles = Math.max(triangles, renderer.info.render.triangles);
        }
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        renderer.setSize(prevSize.x, prevSize.y, false);
        post?.setSize(prevSize.x, prevSize.y, renderer.getPixelRatio());
        camera.aspect = prevSize.x / prevSize.y;
        camera.updateProjectionMatrix();
        const sorted = [...total].sort((a, b) => a - b);
        const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
        return {
          frames,
          buffer: `${size.x}x${size.y}`,
          avgMs: +avg(total).toFixed(2),
          cpuMs: +avg(cpu).toFixed(2),
          p99Ms: +p99.toFixed(2),
          worstMs: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
          avgFps: +(1000 / avg(total)).toFixed(1),
          low1Fps: +(1000 / p99).toFixed(1),
          calls,
          triangles,
          humanoids: actors.length,
          bodyTriangles: actors.reduce((t, a) => t + a.h.triangles, 0),
        };
      },
      /** Render at w x h CSS pixels regardless of the window (ADR-0015 checks at 1440x900); null restores. */
      renderSize: (w: number | null, h: number | null) => {
        const W = w ?? innerWidth;
        const H = h ?? innerHeight;
        renderer.setSize(W, H, false);
        post?.setSize(W, H, renderer.getPixelRatio());
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
      },
      /** Last frame's renderer stats and the drawing buffer size (ADR-0015 checks). */
      stats: () => {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, width: size.x, height: size.y, pixelRatio: renderer.getPixelRatio() };
      },
      setWeapon: (w: 'pistol' | 'shotgun') => {
        weapon = w === 'pistol' ? PISTOL : SHOTGUN;
      },
      THREE,
    },
  });
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.querySelector<HTMLElement>('#boot-error');
  if (box) {
    box.textContent = `Sandbox failed to start.\n\n${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
    box.hidden = false;
  }
});
