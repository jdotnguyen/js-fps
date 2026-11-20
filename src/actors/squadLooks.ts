import type { HumanoidSpec } from './humanoid.ts';

/**
 * Appearance of the two squadmates (ADR-0022, docs/characters.md "Looks"). Spread into a
 * HumanoidSpec wherever Giles or Okafor is spawned so they look the same everywhere.
 */
export const GILES: Pick<HumanoidSpec, 'seed' | 'outfit' | 'height' | 'build' | 'look' | 'model'> = {
  seed: 'august-giles',
  // Imported body (ADR-0026, data/body-models.json): the "Mechanic 1" coverall model. `outfit`/`look` below only
  // apply if it fails to load and he falls back to the procedural body.
  model: 'mechanic',
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

export const OKAFOR: Pick<HumanoidSpec, 'seed' | 'outfit' | 'height' | 'build' | 'look' | 'model'> = {
  seed: 'tomas-okafor',
  // Imported body (ADR-0026, data/body-models.json): BrushDip's rigged "Doctor" (lab coat over a blue shirt and tie, grey hair and
  // beard, round glasses), in the "doctor" slot. `outfit`/`look` below only apply if it fails to load and he falls back to the
  // procedural body; they follow the model.
  model: 'doctor',
  outfit: 'medic',
  height: 1.8,
  build: 1.04,
  look: {
    skin: '#c9967c',
    hair: '#8b8682',
    hairLine: 0.15,
    recede: 0.45,
    cropped: true,
    facial: 'beard',
    facialColor: '#4f4a46',
    mouth: 0.019,
    tired: 0.3,
    jaw: 1.0,
    nose: 1.18,
    props: ['glasses', 'penlight', 'chestPatch'],
  },
};
