import { readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { prepareBodyModel, type PreparedBodyModel } from './bodyModel.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';

/**
 * Test helpers: load the main cast's GLBs headless (textures stripped, since Node has no image decoder) and prepare them with
 * their detail hands, once per process. Shared by the hand-physics and held-grip tests.
 */

export async function loadWithoutTextures(url: URL): Promise<THREE.Group> {
  const buf = readFileSync(url);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: unknown;
    textures?: unknown;
    samplers?: unknown;
    materials?: Array<{
      pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
      normalTexture?: unknown;
      occlusionTexture?: unknown;
      emissiveTexture?: unknown;
      extensions?: unknown;
    }>;
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions;
  }
  let text = Buffer.from(JSON.stringify(json));
  while (text.length % 4) text = Buffer.concat([text, Buffer.from(' ')]);
  const rest = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.write('glTF', 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.write('JSON', 16);
  const glb = Buffer.concat([head, text, rest]);
  const { createGltfLoader } = await import('../render/gltf.ts');
  const gltf = await (await createGltfLoader()).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  return gltf.scene;
}

export type MainCastModel = 'mechanic' | 'doctor' | 'priya' | 'hale' | 'office_3' | 'bram' | 'heins' | 'ruiz' | 'sung';

/** Models prepared without the detail hand rig (no handRig in the body model). */
const NO_HAND_RIG: ReadonlySet<MainCastModel> = new Set(['ruiz', 'sung']);

const modelCache = new Map<string, PreparedBodyModel>();

/** A main cast body model, with its finger and twist bones where it has them, prepared once per process. */
export async function loadMainCast(id: MainCastModel): Promise<PreparedBodyModel> {
  let m = modelCache.get(id);
  if (!m) {
    const url = new URL(`../../public/assets/models/${id.startsWith('office') ? 'crew' : 'squad'}/${id}.glb`, import.meta.url);
    m = prepareBodyModel(await loadWithoutTextures(url), { detailHands: !NO_HAND_RIG.has(id) });
    modelCache.set(id, m);
  }
  return m;
}

/** A body-model library holding just the given models. */
export function makeLib(entries: Record<string, PreparedBodyModel>): BodyModelLibrary {
  return { get: (id: string) => entries[id] } as unknown as BodyModelLibrary;
}
