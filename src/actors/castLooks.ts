import type { HumanoidSpec } from './humanoid.ts';
import { GILES, OKAFOR } from './squadLooks.ts';

/**
 * Appearance of the supporting cast (docs/characters.md, intro-sequence spec, ADR-0022/0023 amendments) and
 * the generic crew looks the levels place (`npcs: [{ look: 'botanist' }]`). Named characters
 * keep a fixed seed so they look the same everywhere; generic crew are seeded per NPC id, so
 * a room of `crew` is a room of different faces in the same clothes.
 *
 * Outfits are the five body outfits (ADR-0006) recoloured through `look.outfitColors`.
 */
export type CastLook = Pick<HumanoidSpec, 'seed' | 'outfit' | 'height' | 'build' | 'look' | 'pose' | 'model' | 'profile' | 'infection'>;

/** Named characters, by look id. */
const NAMED: Record<string, CastLook> = {
  giles: GILES,
  okafor: OKAFOR,
  /**
   * Priya Anand, 29, Okafor's nurse. Imported body (data/body-models.json): the "elegant woman" Character Creator model (light blue
   * rolled-sleeve blouse, white knee-length skirt, shoulder-length light-brown hair). `outfit`/`look` below only apply if it fails to
   * load and she falls back to the procedural body; the skin and hair colours follow the model.
   */
  priya: {
    seed: 'priya-anand',
    model: 'priya',
    // Her motion profile (data/motion-profiles.json): her own clips (CMU subject 22, Bandai feminine walk and run) in the `priya`
    // clip pack, loaded with her body, plus an `intro` variant. Her R08 death-scene variants land with task 6.4.
    profile: 'priya',
    outfit: 'medic',
    height: 1.63,
    build: 0.9,
    look: {
      skin: '#a57563',
      hair: '#6d5441',
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
    profile: 'heins',
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
    profile: 'hale',
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
    profile: 'bram',
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
   * Ines Ruiz, comms technician. Imported body (ADR-0026, data/body-models.json): the "Blue Overalls Technician" scan (navy coveralls,
   * tool belt, long curly dark hair). `outfit`/`look`/`props` below (navy crew suit) only apply if it fails to load and she falls back
   * to the procedural body.
   */
  ruiz: {
    seed: 'ines-ruiz',
    profile: 'ruiz',
    model: 'ruiz',
    outfit: 'crew',
    height: 1.66,
    build: 0.93,
    look: {
      skin: '#d3a083',
      hair: '#1d1510',
      hairStyle: 'curly',
      facial: null,
      mouth: 0.017,
      outfitColors: { suit: '#1c2433', over: '#1c2433' },
      props: ['chestPatch'],
    },
  },
  /**
   * Sung, a diver coming off shift. Imported body (ADR-0026, data/body-models.json): the "Construction Worker In Safety Gear" scan.
   * `outfit`/`look` below (dark drysuit with a yellow harness) only apply if it fails to load and he falls back to the procedural body.
   */
  sung: {
    seed: 'diver-sung',
    profile: 'sung',
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
  /**
   * Dr. Lena Voss, Lab B microbiologist (`crew_lab`, NPC `researcher_b`): the researcher the bloom kills behind the Lab B glass
   * (infection-kills spec). A fixed female body so she is the same woman every run. Stand-in: the "Claudia" business-woman model
   * until a licensed lab-coat model replaces it. `outfit`/`look` below (white lab coat) only apply if it fails to load.
   */
  voss: {
    seed: 'lena-voss',
    profile: 'voss',
    model: 'office3',
    outfit: 'lab',
    height: 1.68,
    build: 0.92,
    look: {
      skin: '#e6b99c',
      hair: '#4a3626',
      hairLine: 0.138,
      facial: null,
      mouth: 0.017,
      tired: 0.8,
      jaw: 0.88,
      nose: 0.97,
    },
  },
  /**
   * The thing that grew inside Dr. Voss and bursts out of her chest in Lab B (infection-kills spec, `grownInside`). Imported body:
   * the "Necromorph Slasher" model. Swap the model here for a smaller, wetter creature later; the kill does not change.
   */
  lab_creature: {
    seed: 'lab-b-creature',
    model: 'necromorph',
    outfit: 'crew',
    height: 1.85,
    build: 0.9,
  },
  /**
   * The elite that charges the R09-R10 door in the valve cutscene and pries it open at the R11 bulkhead (flooded-tunnel
   * spec, design D13): the hero tier's body (the necromorph slasher, blade arms) at the hero's size, driven by the
   * sequences. The same body as the Lab B creature and the R11 climax elite, on purpose. Its small extra hands are not rigged
   * to joints and stay still.
   */
  flood_elite: {
    seed: 'r09-flood-elite',
    model: 'necromorph',
    outfit: 'lab',
    height: 2.15,
    build: 1.25,
    infection: 2,
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
  crew: ['ruiz', 'sung', 'assistant', 'bram', 'botanist1', 'botanist2', 'botanist3', 'office1', 'office2', 'office3'],
  security: ['guard1'], // not Heins: the chief's own body stays hers
  engineer: ['botanist1', 'ruiz'],
  medic: ['doctor', 'priya'],
  lab: ['botanist1', 'botanist2', 'botanist3', 'scientist1'],
  botanist: ['botanist1', 'botanist2', 'botanist3'],
  diver: ['sung'],
  exec: ['office1', 'office3'], // not Hale: the director's own body stays his
  assistant: ['assistant', 'office2', 'office3'],
  maintenance: ['botanist1', 'botanist2', 'botanist3'],
};

/** FNV-1a: a stable, well-spread hash of an NPC id. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Per-NPC-id motion profiles for generic-look characters with bespoke duty motion (dock-checkpoint: dock_guard). */
const NPC_PROFILES: Readonly<Record<string, string>> = {
  dock_guard: 'dock_guard',
};

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
  const profile = NPC_PROFILES[npcId];
  return {
    seed: `crew:${npcId}`,
    outfit: c.outfit,
    ...(c.look ? { look: c.look } : {}),
    ...(model ? { model: model[hashId(npcId) % model.length]! } : {}),
    ...(profile ? { profile } : {}),
  };
}

export function isKnownLook(lookId: string): boolean {
  return lookId in CAST || lookId in CREW;
}
