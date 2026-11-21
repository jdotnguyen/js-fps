/**
 * Import config for third-party props (openspec import-lab-props, spec imported-props).
 * One entry per prop id in scripts/props.sources.json; paths are relative to the raw folder
 * (default ../props-src, outside the repository).
 */

/** Which way the model's front faces in the source file; the import turns it to the kit's -Z. */
export type Front = '-z' | '+z' | '-x' | '+x';

/** Selects source meshes: by node name (exact), by name prefix (`foo*`), by material name (`mat:foo`) or by node index (`#7`). */
export type Selector = string;

export interface HingedPart {
  /** Source node that carries the part; its origin is the hinge (true of both rigged first-batch sources). */
  node: string;
  /** Reset the node's rotation to identity (the closed pose) before baking; otherwise the source pose is kept. */
  closed?: boolean;
}

export interface Maps {
  color?: string;
  normal?: string;
  /** The normal map uses the DirectX convention (green down); it is flipped to OpenGL on import. */
  normalDx?: boolean;
  roughness?: string;
  metalness?: string;
  ao?: string;
}

export interface PropSource {
  id: string;
  /** Source file, relative to the raw folder: .gltf, .glb or .fbx. */
  source: string;
  /** Licence, e.g. "CC0" or "CC BY 4.0". */
  licence: string;
  /** Author or studio, as the credit must read. */
  author: string;
  /** Source title and URL, for the credit. */
  title: string;
  url: string;
  /** Real height of the imported prop in metres; the model is scaled uniformly to it. */
  height: number;
  front?: Front;
  /** Most triangles the imported model may have. */
  triBudget: number;
  /** Texture density (default 1024 px per metre of the largest dimension). */
  texturePxPerM?: number;
  /** Keep only these meshes (default: all). Applied before `drop`. */
  keep?: Selector[];
  /** Drop these meshes. */
  drop?: Selector[];
  /** Hinged parts kept as separate `PART_<name>` nodes. */
  parts?: Record<string, HingedPart>;
  /** FBX only: texture files for every material (default: found next to the FBX by suffix). */
  maps?: Maps;
}

const REQUIRED_STRINGS = ['id', 'source', 'licence', 'author', 'title', 'url'] as const;
const FRONTS: readonly string[] = ['-z', '+z', '-x', '+x'];

/** Problems with one config entry (empty when it is usable). */
export function entryProblems(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return ['entry is not an object'];
  const e = raw as Record<string, unknown>;
  const out: string[] = [];
  for (const k of REQUIRED_STRINGS) if (typeof e[k] !== 'string' || !(e[k] as string).trim()) out.push(`missing ${k}`);
  if (typeof e.id === 'string' && !/^[a-z][a-z0-9_]*$/.test(e.id)) out.push(`id "${e.id}" must be snake_case`);
  if (typeof e.source === 'string' && !/\.(gltf|glb|fbx)$/i.test(e.source)) out.push(`source must be .gltf, .glb or .fbx`);
  if (!(typeof e.height === 'number' && e.height > 0)) out.push('missing height (metres, > 0)');
  if (!(typeof e.triBudget === 'number' && e.triBudget >= 12)) out.push('missing triBudget (>= 12)');
  if (e.front !== undefined && !FRONTS.includes(e.front as string)) out.push(`front must be one of ${FRONTS.join(', ')}`);
  if (e.texturePxPerM !== undefined && !(typeof e.texturePxPerM === 'number' && e.texturePxPerM > 0)) out.push('texturePxPerM must be > 0');
  for (const k of ['keep', 'drop'] as const) {
    if (e[k] !== undefined && !(Array.isArray(e[k]) && (e[k] as unknown[]).every((s) => typeof s === 'string'))) out.push(`${k} must be a list of selectors`);
  }
  if (e.parts !== undefined) {
    if (!e.parts || typeof e.parts !== 'object') out.push('parts must be an object');
    else {
      for (const [name, p] of Object.entries(e.parts as Record<string, unknown>)) {
        const part = p as Partial<HingedPart> | null;
        if (!/^[a-z][a-z0-9_]*$/.test(name)) out.push(`part name "${name}" must be snake_case`);
        if (!part || typeof part.node !== 'string' || !part.node) out.push(`part ${name}: missing node`);
        if (part && part.closed !== undefined && typeof part.closed !== 'boolean') out.push(`part ${name}: closed must be true or false`);
      }
    }
  }
  return out;
}

export interface SourcesFile {
  props: PropSource[];
}

/** Validate every entry; returns the usable ones and one message per refused entry. */
export function readSources(raw: unknown): { ok: PropSource[]; refused: string[] } {
  const list = (raw as { props?: unknown })?.props;
  if (!Array.isArray(list)) return { ok: [], refused: ['sources file has no "props" list'] };
  const ok: PropSource[] = [];
  const refused: string[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const id = typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : `#${i}`;
    const problems = entryProblems(entry);
    if (seen.has(id)) problems.push('duplicate id');
    seen.add(id);
    if (problems.length) refused.push(`${id}: ${problems.join('; ')}`);
    else ok.push(entry as PropSource);
  });
  return { ok, refused };
}

/** Does a mesh match a selector? `name` is the node name, `index` the node index, `materials` its material names. */
export function matches(sel: Selector, name: string, index: number, materials: readonly string[]): boolean {
  if (sel.startsWith('#')) return Number(sel.slice(1)) === index;
  if (sel.startsWith('mat:')) return materials.includes(sel.slice(4));
  if (sel.endsWith('*')) return name.startsWith(sel.slice(0, -1));
  return name === sel;
}
