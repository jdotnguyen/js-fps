/**
 * Source readers for `npm run props`: glTF/GLB through gltf-transform, FBX through three's FBXLoader
 * (no DOM: texture loads are stubbed and the maps are rebuilt from the PNGs beside the FBX).
 * Both return a gltf-transform Document plus, per material, where its colour, normal, roughness,
 * metalness and AO come from, so the texture step can pack them the same way for every source.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { Document, NodeIO, type Material, type Node as GNode, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { Maps } from './config.ts';

export type Channel = 'R' | 'G' | 'B';

/** Where each map of one material comes from (textures belong to the document). */
export interface MapSet {
  color: Texture | null;
  normal: Texture | null;
  /** The normal map uses the DirectX convention (green down). */
  normalDx: boolean;
  roughness: { texture: Texture; channel: Channel } | null;
  metalness: { texture: Texture; channel: Channel } | null;
  ao: { texture: Texture; channel: Channel } | null;
}

export interface SourceDoc {
  doc: Document;
  maps: Map<Material, MapSet>;
}

export function gltfIO(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

export async function readSource(path: string, maps?: Maps): Promise<SourceDoc> {
  const ext = extname(path).toLowerCase();
  if (ext === '.fbx') return readFbx(path, maps);
  if (ext === '.gltf' || ext === '.glb') return readGltf(path);
  throw new Error(`unsupported source type "${ext}"`);
}

export async function readGltf(path: string): Promise<SourceDoc> {
  const doc = await gltfIO().read(path);
  const maps = new Map<Material, MapSet>();
  for (const m of doc.getRoot().listMaterials()) {
    const mr = m.getMetallicRoughnessTexture();
    const occ = m.getOcclusionTexture();
    maps.set(m, {
      color: m.getBaseColorTexture(),
      normal: m.getNormalTexture(),
      normalDx: false, // glTF normals are OpenGL by spec
      roughness: mr ? { texture: mr, channel: 'G' } : null,
      metalness: mr ? { texture: mr, channel: 'B' } : null,
      ao: occ ? { texture: occ, channel: 'R' } : null,
    });
  }
  return { doc, maps };
}

const SUFFIXES: Array<[keyof Maps, RegExp]> = [
  ['color', /_(base_?colou?r|albedo|diffuse|color)\.(png|jpe?g)$/i],
  ['normal', /_normal(_directx|_dx|_opengl|_gl)?\.(png|jpe?g)$/i],
  ['roughness', /_rough(ness)?\.(png|jpe?g)$/i],
  ['metalness', /_metal(lic|ness)?\.(png|jpe?g)$/i],
  ['ao', /_(ao|ambient_?occlusion)\.(png|jpe?g)$/i],
];

/** Texture files beside an FBX, found by suffix (`_Base_Color`, `_Normal_DirectX`, `_Roughness`, ...). */
export function findMaps(dir: string): Maps {
  const out: Maps = {};
  for (const f of readdirSync(dir).sort()) {
    for (const [key, re] of SUFFIXES) {
      if (key === 'normalDx' || out[key] !== undefined || !re.test(f)) continue;
      (out as Record<string, string>)[key] = f;
      if (key === 'normal') out.normalDx = /_(directx|dx)\./i.test(f);
    }
  }
  return out;
}

function parseFbx(path: string): THREE.Group {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  // TextureLoader needs a DOM; the maps are rebuilt from files below, so every texture load is a stub.
  const proto = THREE.TextureLoader.prototype as unknown as { load: (...a: unknown[]) => THREE.Texture };
  const load = proto.load;
  proto.load = () => new THREE.Texture();
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    if (typeof a[0] === 'string' && a[0].startsWith('THREE.FBXLoader')) return;
    warn(...a);
  };
  try {
    return new FBXLoader().parse(ab, dirname(path) + '/');
  } finally {
    proto.load = load;
    console.warn = warn;
  }
}

export async function readFbx(path: string, given?: Maps): Promise<SourceDoc> {
  const scene = parseFbx(path);
  const dir = dirname(path);
  const files = given ?? findMaps(dir);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const gscene = doc.createScene(basename(path));
  const textures = new Map<string, Texture>();
  const tex = (file: string | undefined): Texture | null => {
    if (!file) return null;
    let t = textures.get(file);
    if (!t) {
      const isPng = /\.png$/i.test(file);
      t = doc.createTexture(file).setImage(new Uint8Array(readFileSync(join(dir, file)))).setMimeType(isPng ? 'image/png' : 'image/jpeg').setURI(file);
      textures.set(file, t);
    }
    return t;
  };
  const maps = new Map<Material, MapSet>();
  const materials = new Map<string, Material>();
  const material = (m: THREE.Material | undefined): Material => {
    const name = m?.name || 'material';
    let gm = materials.get(name);
    if (!gm) {
      gm = doc.createMaterial(name).setRoughnessFactor(1).setMetallicFactor(1);
      const rough = tex(files.roughness);
      const metal = tex(files.metalness);
      const ao = tex(files.ao);
      if (!metal) gm.setMetallicFactor(0);
      if (!rough) gm.setRoughnessFactor(0.6);
      maps.set(gm, {
        color: tex(files.color),
        normal: tex(files.normal),
        normalDx: files.normalDx === true,
        roughness: rough ? { texture: rough, channel: 'R' } : null,
        metalness: metal ? { texture: metal, channel: 'R' } : null,
        ao: ao ? { texture: ao, channel: 'R' } : null,
      });
      materials.set(name, gm);
    }
    return gm;
  };
  const accessor = (array: Float32Array | Uint32Array, type: 'SCALAR' | 'VEC2' | 'VEC3') => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const visit = (o: THREE.Object3D, parent: GNode | null): void => {
    const node = doc.createNode(o.name || o.type)
      .setTranslation(o.position.toArray() as [number, number, number])
      .setRotation(o.quaternion.toArray() as [number, number, number, number])
      .setScale(o.scale.toArray() as [number, number, number]);
    if (parent) parent.addChild(node);
    else gscene.addChild(node);
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      const pos = g.getAttribute('position');
      if (pos && pos.count) {
        const mesh = doc.createMesh(o.name);
        const position = accessor(Float32Array.from(pos.array as ArrayLike<number>), 'VEC3');
        const nor = g.getAttribute('normal');
        const uv = g.getAttribute('uv');
        const normal = nor ? accessor(Float32Array.from(nor.array as ArrayLike<number>), 'VEC3') : null;
        const texcoord = uv ? accessor(Float32Array.from(uv.array as ArrayLike<number>), 'VEC2') : null;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : pos.count, materialIndex: 0 }];
        for (const grp of groups) {
          const idx = new Uint32Array(grp.count);
          for (let i = 0; i < grp.count; i++) idx[i] = g.index ? g.index.getX(grp.start + i) : grp.start + i;
          const prim = doc.createPrimitive().setAttribute('POSITION', position).setIndices(accessor(idx, 'SCALAR')).setMaterial(material(mats[grp.materialIndex ?? 0]));
          if (normal) prim.setAttribute('NORMAL', normal);
          if (texcoord) prim.setAttribute('TEXCOORD_0', texcoord);
          mesh.addPrimitive(prim);
        }
        node.setMesh(mesh);
      }
    }
    for (const c of o.children) visit(c, node);
  };
  visit(scene, null);
  return { doc, maps };
}
