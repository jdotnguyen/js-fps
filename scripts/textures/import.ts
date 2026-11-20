/**
 * Imports raw photoscanned texture sets into public/assets/textures/<slot>/{color,normal,orm}.webp.
 * Requires ImageMagick (`magick` or `convert`) on PATH (or in Program Files on Windows).
 *
 * Usage: npm run textures [-- <sourceDir> [slot ...]]
 *   sourceDir defaults to ../textures (relative to the repo root). Extra args filter slots.
 * ORM packing: R = AO (white if missing), G = roughness, B = metalness (black if missing).
 * Poly Haven `arm` files are already packed and are only resized.
 * Optional `opacity` + `opacityBake: true` bakes perforations directly into color and ORM (dark
 * matte non-metallic cavities) so perforated panels need no alpha cutout at runtime.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Slot {
  set: string;
  color: string;
  normal: string;
  ao: string | null;
  roughness: string | null;
  metalness: string | null;
  arm: string | null;
  opacity?: string | null;
  opacityBake?: boolean;
  size?: number;
  desaturate?: number;
}
interface Sources {
  slots: Record<string, Slot>;
}

const root = new URL('../../', import.meta.url);
const repo = decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, '$1');
const srcDir = resolve(repo, process.argv[2] ?? '../textures');
const filter = process.argv.slice(3);
const outRoot = resolve(repo, 'public/assets/textures');
const DEFAULT_SIZE = 1024;
const QUALITY = '88';
const DATA_QUALITY = '92';

const sources: Sources = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));

function findMagick(): string {
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
    if (!r.error && r.status === 0 && /ImageMagick/i.test(r.stdout)) return bin;
  }
  fail('ImageMagick not found: install it and make sure `magick` (or `convert`) is on PATH.');
}

function fail(msg: string): never {
  console.error(`textures: ${msg}`);
  process.exit(1);
}

const magick = findMagick();
function run(args: string[]): void {
  try {
    execFileSync(magick, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) {
    fail(`ImageMagick failed: ${magick} ${args.join(' ')}\n${(e as Error).message}`);
  }
}

function src(slot: string, rel: string): string {
  const p = resolve(srcDir, rel);
  if (!existsSync(p)) fail(`slot "${slot}": missing source file ${p}`);
  return p;
}

const common = (size: number): string[] => ['-alpha', 'off', '-filter', 'Lanczos', '-resize', `${size}x${size}!`];
const webp = (out: string, dataMap: boolean): string[] => [
  '-depth', '8', '-strip', '-quality', dataMap ? DATA_QUALITY : QUALITY, '-define', 'webp:method=4', out,
];
/** One channel of a (grayscale) map, resized, as a single-channel image. */
const chan = (path: string, size: number): string[] => ['(', path, ...common(size), '-channel', 'R', '-separate', '+channel', ')'];

const names = Object.keys(sources.slots);
for (const f of filter) if (!names.includes(f)) fail(`unknown slot "${f}". Known: ${names.join(', ')}`);
const todo = filter.length ? filter : names;

for (const name of todo) {
  const s = sources.slots[name]!;
  const size = s.size ?? DEFAULT_SIZE;
  const dir = resolve(outRoot, name);
  const colorIn = src(name, s.color);
  const normalIn = src(name, s.normal);
  const armIn = s.arm ? src(name, s.arm) : null;
  const aoIn = s.ao ? src(name, s.ao) : null;
  const roughIn = s.roughness ? src(name, s.roughness) : null;
  const metalIn = s.metalness ? src(name, s.metalness) : null;
  const opIn = s.opacity && s.opacityBake ? src(name, s.opacity) : null;
  if (!armIn && !roughIn) fail(`slot "${name}": needs either arm or roughness`);
  mkdirSync(dir, { recursive: true });

  if (opIn) {
    // Bake perforations into colour: dark acoustic cavity (#0d0f11) where opacity is black.
    const fg = [colorIn, ...common(size), ...(s.desaturate !== undefined ? ['-modulate', `100,${s.desaturate},100`] : [])];
    run([
      '(', '-size', `${size}x${size}`, 'xc:#0d0f11', ')',
      '(', ...fg, ')',
      '(', opIn, ...common(size), ')',
      '-compose', 'Over', '-composite',
      ...webp(resolve(dir, 'color.webp'), false),
    ]);
  } else {
    const colorArgs = [colorIn, ...common(size)];
    if (s.desaturate !== undefined) colorArgs.push('-modulate', `100,${s.desaturate},100`);
    run([...colorArgs, ...webp(resolve(dir, 'color.webp'), false)]);
  }

  run([normalIn, ...common(size), ...webp(resolve(dir, 'normal.webp'), true)]);

  if (armIn) {
    run([armIn, ...common(size), ...webp(resolve(dir, 'orm.webp'), true)]);
  } else {
    const constant = (c: string): string[] => ['-size', `${size}x${size}`, `xc:${c}`, '-colorspace', 'Gray', '-depth', '8'];
    const aoChan = opIn
      ? aoIn
        ? ['(', ...chan(aoIn, size), ...chan(opIn, size), '-compose', 'Multiply', '-composite', ')']
        : chan(opIn, size)
      : aoIn
        ? chan(aoIn, size)
        : ['(', ...constant('white'), ')'];
    const roughChan = opIn
      ? ['(', ...chan(roughIn!, size), '(', opIn, ...common(size), '-channel', 'R', '-separate', '+channel', '-negate', ')', '-compose', 'Lighten', '-composite', ')']
      : chan(roughIn!, size);
    const metalChan = metalIn
      ? opIn
        ? ['(', ...chan(metalIn, size), ...chan(opIn, size), '-compose', 'Multiply', '-composite', ')']
        : chan(metalIn, size)
      : ['(', ...constant('black'), ')'];
    run([
      ...aoChan,
      ...roughChan,
      ...metalChan,
      '-combine', '-colorspace', 'sRGB',
      ...webp(resolve(dir, 'orm.webp'), true),
    ]);
  }
  console.log(`textures: ${name} <- ${s.set}${aoIn || armIn ? '' : ' (no AO)'}${metalIn || armIn ? '' : ' (no metal)'}${opIn ? ' (opacity baked)' : ''}`);
}
console.log(`textures: done (${todo.length} slots) -> ${outRoot}`);
