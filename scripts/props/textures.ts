/**
 * Texture step for imported props (spec imported-props, "Imported textures"): every material ends
 * with a colour map, an ORM map (R = AO, G = roughness, B = metalness) and an OpenGL normal map,
 * all WebP at one power-of-two size per prop. ImageMagick does the image work, as it already does
 * for `npm run textures`, so the same code runs on Windows and in the agents' Linux shell.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Document, Material, Texture } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import type { Channel, MapSet } from './readers.ts';

export const DEFAULT_PX_PER_M = 1024;
export const MIN_TEX = 256;
export const MAX_TEX = 2048;

/** Texture size for a prop: next power of two of (largest dimension x px/m), clamped to 256..2048. */
export function textureSize(largestDim: number, pxPerM = DEFAULT_PX_PER_M): number {
  const want = Math.max(1, Math.ceil(largestDim * pxPerM));
  const pow = 2 ** Math.ceil(Math.log2(want));
  return Math.min(MAX_TEX, Math.max(MIN_TEX, pow));
}

/** The ImageMagick executable with WebP support, or null with the reason. */
export function findMagick(): { bin: string } | { error: string } {
  const candidates = ['magick', 'convert'];
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        if (/^ImageMagick/i.test(entry)) {
          const exe = resolve(base, entry, 'magick.exe');
          if (existsSync(exe)) candidates.push(exe);
        }
      }
    }
  }
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    if (r.error || r.status !== 0 || !/ImageMagick/i.test(r.stdout)) continue;
    const f = spawnSync(bin, ['-list', 'format'], { encoding: 'utf8' });
    if (!/^\s*WEBP\*?\s+\S+\s+rw/m.test(f.stdout ?? '')) return { error: `ImageMagick (${bin}) has no WebP support; install a build with libwebp.` };
    return { bin };
  }
  return { error: 'ImageMagick not found: install it and make sure `magick` (or `convert`) is on PATH, as for `npm run textures`.' };
}

const extFor = (mime: string): string => (mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png');

export interface TextureResult {
  size: number;
  /** Total texels of every texture the prop keeps. */
  texturePixels: number;
  textures: number;
}

/** Re-encode every material's maps. `largestDim` is the imported prop's largest side in metres. */
export function processTextures(doc: Document, maps: Map<Material, MapSet>, largestDim: number, pxPerM: number | undefined, magick: string): TextureResult {
  const size = textureSize(largestDim, pxPerM);
  const work = mkdtempSync(join(tmpdir(), 'props-tex-'));
  const files = new Map<Texture, string>();
  const fileOf = (t: Texture): string => {
    let f = files.get(t);
    if (!f) {
      const img = t.getImage();
      if (!img) throw new Error(`texture "${t.getName() || t.getURI()}" has no image data`);
      f = join(work, `src${files.size}${extFor(t.getMimeType())}`);
      writeFileSync(f, img);
      files.set(t, f);
    }
    return f;
  };
  const run = (args: string[]) => {
    try {
      execFileSync(magick, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      throw new Error(`ImageMagick failed: ${(e as { stderr?: Buffer }).stderr?.toString().trim() || (e as Error).message}`);
    }
  };
  const resize = ['-filter', 'Lanczos', '-resize', `${size}x${size}!`];
  const chan = (src: { texture: Texture; channel: Channel } | null): string[] =>
    src ? ['(', fileOf(src.texture), '-alpha', 'off', ...resize, '-channel', src.channel, '-separate', '+channel', ')'] : ['(', '-size', `${size}x${size}`, 'xc:white', '-channel', 'R', '-separate', '+channel', ')'];
  const made = (name: string, out: string): Texture => doc.createTexture(name).setImage(new Uint8Array(readFileSync(out))).setMimeType('image/webp').setURI(`${name}.webp`);
  let count = 0;
  try {
    let n = 0;
    for (const [material, set] of maps) {
      if (material.isDisposed()) continue;
      const tag = `${material.getName().replace(/[^A-Za-z0-9_]+/g, '_') || 'material'}_${n++}`;
      if (set.color) {
        const out = join(work, `${tag}_color.webp`);
        run([fileOf(set.color), ...resize, '-depth', '8', '-strip', '-quality', '85', out]);
        material.setBaseColorTexture(made(`${tag}_color`, out));
        count++;
      } else material.setBaseColorTexture(null);
      if (set.normal) {
        const out = join(work, `${tag}_normal.webp`);
        run([fileOf(set.normal), '-alpha', 'off', ...(set.normalDx ? ['-channel', 'G', '-negate', '+channel'] : []), ...resize, '-depth', '8', '-strip', '-quality', '92', out]);
        material.setNormalTexture(made(`${tag}_normal`, out));
        count++;
      } else material.setNormalTexture(null);
      if (set.roughness || set.metalness || set.ao) {
        const out = join(work, `${tag}_orm.webp`);
        run([...chan(set.ao), ...chan(set.roughness), ...chan(set.metalness), '-combine', '-depth', '8', '-strip', '-quality', '90', out]);
        const orm = made(`${tag}_orm`, out);
        material.setMetallicRoughnessTexture(orm);
        material.setOcclusionTexture(set.ao ? orm : null);
        count++;
      } else {
        material.setMetallicRoughnessTexture(null);
        material.setOcclusionTexture(null);
      }
      // Other texture slots (emissive, extension maps) are not part of the kit contract.
      material.setEmissiveTexture(null);
    }
    if (count) doc.createExtension(EXTTextureWebP).setRequired(true);
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      // Material extensions with their own textures (e.g. KHR_materials_specular) would keep the old PNGs alive.
      if (ext.extensionName !== 'EXT_texture_webp') for (const m of doc.getRoot().listMaterials()) m.setExtension(ext.extensionName, null);
      if (ext.extensionName !== 'EXT_texture_webp') ext.dispose();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { size, texturePixels: count * size * size, textures: count };
}
