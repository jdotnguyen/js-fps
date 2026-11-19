import type { HumanoidSpec } from './humanoid.ts';
import { GILES, OKAFOR } from './squadLooks.ts';

/**
 * Appearance of the supporting cast (docs/characters.md, ADR-0017/0022/0023 amendments) and
 * the generic crew looks the levels place (`npcs: [{ look: 'botanist' }]`). Named characters
 * keep a fixed seed so they look the same everywhere; generic crew are seeded per NPC id, so
 * a room of `crew` is a room of different faces in the same clothes.
 *
 * Outfits are the five body outfits (ADR-0006) recoloured through `look.outfitColors`.
 */
export type CastLook = Pick<HumanoidSpec, 'seed' | 'outfit' | 'height' | 'build' | 'look' | 'pose' | 'model'>;

/** Named characters, by look id. */
const NAMED: Record<string, CastLook> = {
  giles: GILES,
  okafor: OKAFOR,
  /**
   * Priya Anand, 29, Okafor's nurse. Imported body (ADR-0026, data/body-models.json): the "Modern Indian Woman" model. `outfit`/`look`
   * below (teal scrubs under a warm plum cardigan) only apply if it fails to load and she falls back to the procedural body.
   */
  priya: {
    seed: 'priya-anand',
    model: 'priya',
    outfit: 'medic',
    height: 1.63,
    build: 0.9,
    look: {
      skin: '#b07650',
      hair: '#17120e',
      hairLine: 0.138,
      facial: null,
      mouth: 0.017,
      tired: 0.1,
      jaw: 0.86,
      nose: 0.95,
      outfitColors: { over: '#7a4a5c', coat: true },
      props: ['penlight', 'chestPatch'],
    },
  },
  /**
   * Katie Heins, security chief: Jay's uniform with a lighter jacket, short purple hair. Imported body (ADR-0026, data/body-models.json):
   * the "BS-V1 Cyborg" model (cybernetic right arm, dark jacket). `outfit`/`look` below only apply if it fails to load.
   */
  heins: {
    seed: 'katie-heins',
    model: 'heins',
    outfit: 'security',
    height: 1.7,
    build: 0.97,
    look: {
      skin: '#f0c6a6',
      hair: '#6b3a8f',
      hairLine: 0.14,
      cropped: true,
      facial: null,
      mouth: 0.018,
      tired: 0.35,
      jaw: 0.95,
      nose: 1.0,
      outfitColors: { over: '#3a4652' },
      props: ['chestPatch'],
    },
  },
  /**
   * Director Hale: a charcoal suit jacket, nervous, tired. Imported body (ADR-0026, data/body-models.json): the "A Man in suit" model.
   * `outfit`/`look` below only apply if it fails to load.
   */
  hale: {
    seed: 'director-hale',
    model: 'hale',
    outfit: 'crew',
    height: 1.76,
    build: 1.02,
    look: {
      skin: '#e3b08e',
      hair: '#5d5b57',
      hairLine: 0.145,
      recede: 0.4,
      facial: null,
      mouth: 0.018,
      tired: 0.7,
      jaw: 1.0,
      nose: 1.05,
      outfitColors: { suit: '#24262b', over: '#2f3238', coat: true, boots: '#0e0e10', belt: '#0e0e10' },
    },
  },
  /**
   * Bram, the cook (`crew_cook`). Imported body (ADR-0026, data/body-models.json): the "Chef T pose" scan.
   * `outfit`/`look` below (white kitchen jacket over checked-grey trousers) only apply if it fails to load and he falls back to the procedural body.
   */
  cook: {
    seed: 'bram-cook',
    model: 'bram',
    outfit: 'crew',
    height: 1.78,
    build: 1.15,
    look: {
      skin: '#cf9471',
      hair: '#6f5236',
      facial: 'beard',
      facialColor: '#5a412b',
      mouth: 0.02,
      tired: 0.4,
      rolled: true,
      outfitColors: { suit: '#4a4c50', over: '#d6d3cb' },
    },
  },
  /**
   * Ines Ruiz, comms technician. Imported body (ADR-0026, data/body-models.json): the "Modern Service Technician" scan.
   * `outfit`/`look`/`props` below (crew blues with a tool vest) only apply if it fails to load and she falls back to the procedural body.
   */
  ruiz: {
    seed: 'ines-ruiz',
    model: 'ruiz',
    outfit: 'crew',
    height: 1.66,
    build: 0.93,
    look: {
      skin: '#b07650',
      hair: '#2c1f15',
      facial: null,
      mouth: 0.017,
      outfitColors: { suit: '#2d3a4e', over: '#3e4a3a' },
      props: ['chestPatch'],
    },
  },
  /**
   * Sung, a diver coming off shift. Imported body (ADR-0026, data/body-models.json): the "Construction Worker In Safety Gear" scan.
   * `outfit`/`look` below (dark drysuit with a yellow harness) only apply if it fails to load and he falls back to the procedural body.
   */
  sung: {
    seed: 'diver-sung',
    model: 'sung',
    outfit: 'crew',
    height: 1.75,
    build: 1.0,
    look: {
      skin: '#e3b08e',
      hair: '#121212',
      cropped: true,
      facial: 'stubble',
      outfitColors: { suit: '#15181c', over: '#a8861e', boots: '#0b0b0c' },
    },
  },
};
NAMED['bram'] = NAMED['cook']!;
export const CAST: Readonly<Record<string, CastLook>> = NAMED;

/** Generic crew looks: an outfit plus colours; face, build and height come from the seed. */
const CREW: Readonly<Record<string, Pick<CastLook, 'outfit' | 'look'>>> = {
  crew: { outfit: 'crew' },
  security: { outfit: 'security' },
  engineer: { outfit: 'engineer' },
  medic: { outfit: 'medic' },
  lab: { outfit: 'lab' },
  botanist: { outfit: 'crew', look: { rolled: true, outfitColors: { suit: '#4d5a3c', over: '#6f7a5a' } } },
  diver: { outfit: 'crew', look: { outfitColors: { suit: '#15181c', over: '#a8861e', boots: '#0b0b0c' } } },
  exec: { outfit: 'crew', look: { outfitColors: { suit: '#2a2c31', over: '#3b3e46', coat: true, boots: '#101012' } } },
  assistant: { outfit: 'crew', look: { outfitColors: { suit: '#3a3d44', over: '#8b8f96' } } },
  maintenance: { outfit: 'engineer', look: { props: ['hiVis', 'grease'], outfitColors: { suit: '#55585a' } } },
};

export const CREW_LOOKS: readonly string[] = Object.keys(CREW);

/**
 * Imported bodies (ADR-0026, `data/body-models.json`) for generic crew looks: each NPC of the look gets one of these, picked by its id so
 * the same NPC keeps the same body. The procedural outfit above is the fallback if a model fails to load.
 */
const CREW_MODELS: Readonly<Record<string, readonly string[]>> = {
  botanist: ['botanist1', 'botanist2', 'botanist3'],
  assistant: ['assistant'],
};

/** FNV-1a: a stable, well-spread hash of an NPC id. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The body spec for a look id. Named cast ignore `npcId`; generic crew use it as the seed.
 * Unknown ids fall back to plain crew (and say so through `warn`).
 */
export function castSpec(lookId: string, npcId: string, warn?: (m: string) => void): CastLook {
  const named = CAST[lookId];
  if (named) return named;
  const crew = CREW[lookId];
  if (!crew) warn?.(`npc "${npcId}": unknown look "${lookId}", using crew`);
  const c = crew ?? CREW['crew']!;
  const model = CREW_MODELS[lookId];
  return { seed: `crew:${npcId}`, outfit: c.outfit, ...(c.look ? { look: c.look } : {}), ...(model ? { model: model[hashId(npcId) % model.length]! } : {}) };
}

export function isKnownLook(lookId: string): boolean {
  return lookId in CAST || lookId in CREW;
}
