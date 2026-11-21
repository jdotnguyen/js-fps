import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import kitManifestJson from '../data/kit-manifest.json';
import { Rng } from '../core/rng.ts';
import type { Materials } from '../render/materials.ts';
import { IMPORTED_PROPS, standInSize } from '../world/kit/importedProps.ts';
import { KitRegistry, validateKitManifest } from '../world/registry.ts';
import { validate } from '../core/validate.ts';
import type { PieceOutput } from '../world/kit/types.ts';

/**
 * Imported props preview (openspec import-lab-props, spec imported-props): /sandbox/props.html (dev server only).
 * Every imported prop's model (front row) beside its stand-in (back row) on a 1 m grid, with the model's colliders
 * (green), its -Z facing (arrow) and the climbable-top height. Loads nothing from slice01.
 *   ?prop=<id>   frame one prop
 */

const GAP = 0.8;
const BACK = 2.4;

function label(text: string, sub: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8eef2';
  g.font = 'bold 34px Consolas, monospace';
  g.fillText(text, 8, 38);
  g.fillStyle = '#9fb0bc';
  g.font = '26px Consolas, monospace';
  g.fillText(sub, 8, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(1.2, 0.225, 1);
  return s;
}

function colliderHelpers(out: PieceOutput, color: number): THREE.Group {
  const g = new THREE.Group();
  for (const c of out.colliders) g.add(new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)), color));
  return g;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15191d);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 6, -4);
  scene.add(sun, new THREE.HemisphereLight(0xbcd0e0, 0x202428, 0.6));
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.02, 200);
  const controls = new OrbitControls(camera, canvas);

  const manifest = validate(validateKitManifest, kitManifestJson, 'data/kit-manifest.json');
  const ids = Object.keys(IMPORTED_PROPS).sort();
  const withModels = new KitRegistry(manifest);
  // Manifest URLs are relative to the game page at the site root; this page lives under /sandbox/.
  const { createGltfLoader } = await import('../render/gltf.ts');
  const loader = await createGltfLoader();
  await withModels.preload(ids, (url) => loader.loadAsync(`/${url}`));
  const standIns = new KitRegistry({ glb: {} });
  const mats = {} as Materials;
  const rng = new Rng(1);

  const list = document.querySelector<HTMLElement>('#list')!;
  const frames = new Map<string, { centre: THREE.Vector3; radius: number }>();
  let x = 0;
  for (const id of ids) {
    const rec = IMPORTED_PROPS[id]!;
    const [w, h, d] = standInSize(rec.size);
    const cx = x + w / 2;
    const model = withModels.create(id, {}, rng, mats);
    model.object.position.set(cx, 0, 0);
    scene.add(model.object, colliderHelpers(model, 0x4cff7a).translateX(cx));
    const standIn = standIns.create(id, {}, rng, mats);
    standIn.object.position.set(cx, 0, BACK);
    standIn.object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = new THREE.MeshStandardMaterial({ color: 0x5f666b, roughness: 0.7 });
    });
    scene.add(standIn.object);
    const top = Math.max(...model.colliders.map((c) => c.max[1]));
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(cx, 0.02, -d / 2), 0.5, 0xffc24a, 0.12, 0.08);
    scene.add(arrow);
    const tag = label(id, `${rec.size.map((v) => v.toFixed(2)).join(' x ')} m  top ${top.toFixed(2)}`);
    tag.position.set(cx, h + 0.25, 0);
    scene.add(tag);
    frames.set(id, { centre: new THREE.Vector3(cx, h / 2, 0), radius: Math.max(w, h, d) });
    const loaded = withModels.source(id) === 'glb';
    const row = document.createElement('div');
    row.innerHTML = `<a data-id="${id}">${id}</a> ${rec.triangles} tris, ${rec.materials} mat, top ${top.toFixed(2)} m${loaded ? '' : ' <span class="bad">(stand-in: model failed)</span>'}`;
    list.append(row);
    x += w + GAP;
  }
  const grid = new THREE.GridHelper(Math.ceil(x + 4) * 2, Math.ceil(x + 4) * 2, 0x56606a, 0x30363c);
  grid.position.set(x / 2, 0, BACK / 2);
  scene.add(grid);

  const frame = (id: string | null): void => {
    const f = id ? frames.get(id) : null;
    const centre = f?.centre ?? new THREE.Vector3(x / 2, 0.6, BACK / 2);
    const r = f?.radius ?? x / 2;
    controls.target.copy(centre);
    camera.position.copy(centre).add(new THREE.Vector3(r * 0.9, r * 0.7, -r * 2.2));
    controls.update();
  };
  list.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset['id'];
    if (id) frame(id);
  });
  frame(new URLSearchParams(location.search).get('prop'));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  (window as unknown as { props: unknown }).props = { frame, ids };
}

void boot();
