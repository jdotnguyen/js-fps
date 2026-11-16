import type { HumanoidSpec } from './humanoid.ts';

/**
 * Appearance of the two squadmates (ADR-0018, docs/characters.md "Looks"). Spread into a
 * HumanoidSpec wherever Giles or Okafor is spawned so they look the same everywhere.
 */
export const GILES: Pick<HumanoidSpec, 'seed' | 'outfit' | 'height' | 'build' | 'look'> = {
  seed: 'august-giles',
  outfit: 'engineer',
  height: 1.82,
  build: 0.95,
  look: {
    skin: '#e3b08e',
    hair: '#2c1f15',
    hairLine: 0.136,
    recede: 0.25,
    hairStyle: 'curly',
    facial: 'beard',
    facialColor: '#2a1d14',
    mouth: 0.019,
    tired: 1,
    jaw: 0.9,
    nose: 1.05,
    // Long sleeves: he is hiding the forearm (stage 2 pushes one sleeve up over the bandage).
    rolled: false,
    props: ['glasses', 'multitool', 'hiVis', 'chestPatch', 'grease'],
  },
};

export const OKAFOR: Pick<HumanoidSpec, 'seed' | 'outfit' | 'height' | 'build' | 'look'> = {
  seed: 'tomas-okafor',
  outfit: 'medic',
  height: 1.8,
  build: 1.04,
  look: {
    skin: '#5e3a26',
    hair: '#8e8a84',
    hairLine: 0.15,
    recede: 0.3,
    cropped: true,
    facial: 'beard',
    facialColor: '#a19b93',
    mouth: 0.019,
    tired: 0.3,
    jaw: 1.0,
    nose: 1.18,
    props: ['glassesOnHead', 'penlight', 'stethoscope', 'chestPatch'],
  },
};
