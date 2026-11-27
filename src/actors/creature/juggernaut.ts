import type * as THREE from 'three';
import defJson from '../../data/creatures/juggernaut/creature.json' with { type: 'json' };
import posesJson from '../../data/creatures/juggernaut/poses.json' with { type: 'json' };
import { validateCreatureDef, validateCreaturePoses } from '../../data/types/creatures.ts';
import { CreatureRig } from './rig.ts';

/** The Juggernaut's rig data (openspec rig-juggernaut D5), validated once on import. */
export const JUGGERNAUT_DEF = validateCreatureDef(defJson, 'data/creatures/juggernaut/creature.json');
export const JUGGERNAUT_POSES = validateCreaturePoses(posesJson, 'data/creatures/juggernaut/poses.json');

/** Build the Juggernaut's rig on its model, loaded (and still) in its neutral pose. */
export function createJuggernautRig(model: THREE.Object3D): CreatureRig {
  return new CreatureRig(model, JUGGERNAUT_DEF, JUGGERNAUT_POSES, 'data/creatures/juggernaut');
}
