/**
 * Audio registry audit (spec audio-assets: Procedural sound is fallback-only).
 * Lists:
 *   - procedural specs (SOUND_SPECS) that no code, sequence or level names,
 *   - recorded samples (SAMPLE_URLS) that nothing plays, directly or by shadowing a used spec,
 *   - files under public/assets/audio/ that nothing references.
 * Run: npm run audio:audit (exits 1 when anything is unused). src/audio/audit.test.ts runs it in CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AuditInput {
  /** Names in SOUND_SPECS. */
  specNames: readonly string[];
  /** SAMPLE_URLS: name -> one path or several. */
  samples: Readonly<Record<string, string | readonly string[]>>;
  /** Text of every source and content file that may name a sound (excluding the registry itself). */
  sources: ReadonlyMap<string, string>;
  /** Audio files on disk, relative to public/ (e.g. assets/audio/ui/ui-click.mp3). */
  files: readonly string[];
  /** Tool scripts. They only count as references for files (source masters a fit script reads), not for sound names. */
  tools?: ReadonlyMap<string, string>;
}

export interface AuditResult {
  unreferencedSpecs: string[];
  unusedSamples: string[];
  unregisteredFiles: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `name` appears as a whole identifier or string in any source. */
function named(name: string, sources: ReadonlyMap<string, string>): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9_$])${escape(name)}([^A-Za-z0-9_$]|$)`);
  for (const text of sources.values()) if (re.test(text)) return true;
  return false;
}

export function auditAudio(input: AuditInput): AuditResult {
  const usedName = new Map<string, boolean>();
  const isUsed = (n: string) => {
    let v = usedName.get(n);
    if (v === undefined) usedName.set(n, (v = named(n, input.sources)));
    return v;
  };
  const unreferencedSpecs = input.specNames.filter((n) => !isUsed(n));
  // A sample is used if something plays its name, including through a same-named procedural spec.
  const unusedSamples = Object.keys(input.samples).filter((n) => !isUsed(n));
  const registered = new Set(Object.values(input.samples).flatMap((v) => (typeof v === 'string' ? [v] : [...v])));
  const allText = [...input.sources.values()].join('\n');
  const toolText = [...(input.tools?.values() ?? [])].join('\n');
  // Tools may name a master in another format (the wav a compressed mp3 came from), so match the stem.
  const base = (f: string) => f.slice(f.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '.');
  const unregisteredFiles = input.files.filter((f) => !registered.has(f) && !allText.includes(f) && !toolText.includes(base(f)));
  return { unreferencedSpecs, unusedSamples, unregisteredFiles };
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Gather the real project's registry, sources and files. */
export async function projectAuditInput(root = ROOT): Promise<AuditInput> {
  const { SOUND_SPECS, SAMPLE_URLS } = await import('../src/audio/sounds.ts');
  const posix = (p: string) => relative(root, p).split(sep).join('/');
  const skip = (p: string) =>
    p === 'src/audio/sounds.ts' || p.endsWith('.test.ts') || p.startsWith('src/audio/testing/');
  const sources = new Map<string, string>();
  for (const p of walk(join(root, 'src'), (f) => /\.(ts|json)$/.test(f))) {
    const rel = posix(p);
    if (!skip(rel)) sources.set(rel, readFileSync(p, 'utf8'));
  }
  const audioDir = join(root, 'public', 'assets', 'audio');
  const files = walk(audioDir, (f) => /\.(mp3|ogg|wav|m4a|flac)$/i.test(f)).map((p) => relative(join(root, 'public'), p).split(sep).join('/'));
  const tools = new Map<string, string>();
  for (const p of walk(join(root, 'scripts'), (f) => /\.(ts|mjs|js)$/.test(f) && !f.endsWith('audio-audit.ts'))) tools.set(posix(p), readFileSync(p, 'utf8'));
  return { specNames: Object.keys(SOUND_SPECS), samples: SAMPLE_URLS, sources, files, tools };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = auditAudio(await projectAuditInput());
  const sections: Array<[string, string[]]> = [
    ['Procedural specs nothing plays (delete from SOUND_SPECS)', result.unreferencedSpecs],
    ['Recorded samples nothing plays (remove from SAMPLE_URLS)', result.unusedSamples],
    ['Audio files nothing references (register or delete)', result.unregisteredFiles],
  ];
  let any = false;
  for (const [title, items] of sections) {
    console.log(`${title}: ${items.length === 0 ? 'none' : ''}`);
    for (const i of items) console.log(`  - ${i}`);
    any ||= items.length > 0;
  }
  process.exit(any ? 1 : 0);
}
