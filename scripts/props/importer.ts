/**
 * Runs the import for a list of configured props: read, kit conventions, textures, write the GLB,
 * then record its cost (spec imported-props) and its kit-manifest line, both in the same run.
 * A source that fails is reported with its id and the step, and the others still import.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PropSource } from './config.ts';
import { applyConventions, pruneUnused } from './convention.ts';
import { gltfIO, readSource } from './readers.ts';
import { processTextures } from './textures.ts';

export const PROPS_URL_BASE = 'assets/models/props/';

/** One imported prop's cost and provenance, as stored in src/data/imported-props.json. */
export interface PropRecord {
  url: string;
  /** Size of the imported model in metres: x, y (height), z. */
  size: [number, number, number];
  triangles: number;
  materials: number;
  transparentMaterials: number;
  texturePixels: number;
  bytes: number;
  parts: string[];
  source: { title: string; author: string; licence: string; url: string };
}

export interface RecordsFile {
  props: Record<string, PropRecord>;
}

export interface Failure {
  id: string;
  step: 'read' | 'conventions' | 'textures' | 'write';
  message: string;
}

export interface ImportOptions {
  rawDir: string;
  /** public/assets/models/props */
  outDir: string;
  recordsPath: string;
  manifestPath: string;
  magick: string;
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export async function importProp(entry: PropSource, o: ImportOptions): Promise<PropRecord> {
  let step: Failure['step'] = 'read';
  try {
    const { doc, maps } = await readSource(join(o.rawDir, entry.source), entry.maps);
    step = 'conventions';
    const conv = await applyConventions(doc, entry);
    step = 'textures';
    const tex = processTextures(doc, maps, Math.max(...conv.size), entry.texturePxPerM, o.magick);
    pruneUnused(doc);
    step = 'write';
    const bytes = await gltfIO().writeBinary(doc);
    mkdirSync(o.outDir, { recursive: true });
    writeFileSync(join(o.outDir, `${entry.id}.glb`), bytes);
    const used = doc.getRoot().listMaterials();
    return {
      url: `${PROPS_URL_BASE}${entry.id}.glb`,
      size: conv.size.map((v) => round(v)) as [number, number, number],
      triangles: conv.triangles,
      materials: used.length,
      transparentMaterials: used.filter((m) => m.getAlphaMode() === 'BLEND').length,
      texturePixels: tex.texturePixels,
      bytes: bytes.byteLength,
      parts: conv.parts,
      source: { title: entry.title, author: entry.author, licence: entry.licence, url: entry.url },
    };
  } catch (e) {
    throw Object.assign(new Error((e as Error).message), { step });
  }
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

export async function runImport(entries: PropSource[], o: ImportOptions, log: (s: string) => void = console.log): Promise<{ ok: string[]; failed: Failure[] }> {
  const records = readJson<RecordsFile>(o.recordsPath, { props: {} });
  const manifest = readJson<{ glb: Record<string, string> }>(o.manifestPath, { glb: {} });
  const ok: string[] = [];
  const failed: Failure[] = [];
  for (const entry of entries) {
    try {
      const rec = await importProp(entry, o);
      records.props[entry.id] = rec;
      manifest.glb[entry.id] = rec.url;
      ok.push(entry.id);
      log(`  ${entry.id}: ${rec.triangles} tris, ${rec.materials} material(s), ${Math.round(rec.bytes / 1024)} KB, ${rec.size.join(' x ')} m`);
    } catch (e) {
      const step = (e as { step?: Failure['step'] }).step ?? 'read';
      failed.push({ id: entry.id, step, message: (e as Error).message });
      log(`  ${entry.id}: FAILED at ${step}: ${(e as Error).message}`);
    }
  }
  const sorted = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(o.recordsPath, JSON.stringify({ props: sorted(records.props) }, null, 2) + '\n');
  writeFileSync(o.manifestPath, JSON.stringify({ ...manifest, glb: sorted(manifest.glb) }, null, 2) + '\n');
  return { ok, failed };
}
