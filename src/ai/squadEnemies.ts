import * as THREE from 'three';
import type { EventBus } from '../core/events.ts';
import type { JointName } from '../actors/skeleton.ts';
import type { EnemyDirector } from './enemyDirector.ts';
import type { P3 } from './nav.ts';
import type { Squad, SquadEnemy, SquadEnemySource } from './squad.ts';
import type { SquadAim } from './squadBrain.ts';

/**
 * Connects the squad (ADR-0011) to the enemy AI (ADR-0007):
 * - the squad sees `director.list` as `SquadEnemy`s and shoots through `director.applyHit`
 *   (gore, severing and `enemy:hit` with `by` = the squad id, like the player's shots);
 * - enemy hits on a squadmate go to `squad.damageMate`, a downed mate is not a target, and the
 *   ADR-0011 weights replace the default 0.6 (medic 0.7, 1.0 while reviving; working Giles 0.9);
 * - the player's kills feed the kill-share guard (`enemy:died` with `by: 'player'`).
 */

/** Joints to aim at per role preference, tried in order (a severed limb is skipped by the raycast). */
const AIM_JOINTS: Record<SquadAim, JointName[]> = {
  legs: ['shin_L', 'shin_R', 'thigh_L', 'thigh_R'],
  arms: ['foreArm_R', 'foreArm_L', 'upperArm_R', 'upperArm_L'],
  torso: ['chest', 'spine'],
};

const origin = new THREE.Vector3();
const to = new THREE.Vector3();
const dir = new THREE.Vector3();

/** The director's enemies as squad enemies; `shooter()` names who fires (for `enemy:hit` `by`). */
export function squadEnemySource(director: EnemyDirector, shooter: () => string = () => 'engineer'): SquadEnemySource {
  const views = new Map<object, SquadEnemy>();
  const view = (e: EnemyDirector['list'][number]): SquadEnemy => {
    let v = views.get(e);
    if (!v) {
      v = {
        get id() {
          return e.id;
        },
        get position() {
          return e.position;
        },
        get alive() {
          return e.alive;
        },
        get grabbing() {
          return e.grabbing ? 'player' : null;
        },
        get crawling() {
          return e.body.locomotion.mode !== 'walk';
        },
        get hero() {
          return e.hero;
        },
      };
      views.set(e, v);
    }
    return v;
  };
  let cache: SquadEnemy[] = [];
  return {
    list() {
      cache.length = 0;
      for (const e of director.list) if (e.alive) cache.push(view(e));
      if (views.size > director.list.length * 2 + 16) {
        views.clear();
        cache = [];
      }
      return cache;
    },
    shoot(id: string, aim: SquadAim, damage: number, from: P3): boolean {
      const e = director.list.find((x) => x.id === id);
      if (!e || !e.alive) return false;
      origin.set(from.x, from.y, from.z);
      const tries = [...AIM_JOINTS[aim], ...AIM_JOINTS.torso];
      for (const joint of tries) {
        e.body.jointWorld(joint, to);
        dir.subVectors(to, origin);
        const len = dir.length();
        if (len < 1e-3) continue;
        dir.divideScalar(len);
        const hit = e.body.raycast(origin, dir, len + 0.5);
        if (!hit) continue;
        const result = director.applyHit(hit, damage, dir, shooter());
        return result?.killed === true;
      }
      return false;
    },
  };
}

export function wireSquadToEnemies(squad: Squad, director: EnemyDirector, events: EventBus): void {
  let shooterId = 'engineer';
  const source = squadEnemySource(director, () => shooterId);
  squad.setEnemies({
    list: () => source.list(),
    shoot: (id, aim, damage, from) => {
      // Which mate is firing: the one standing at `from`.
      let best = Infinity;
      for (const m of squad.mates) {
        const d = Math.hypot(m.position.x - from.x, m.position.z - from.z);
        if (d < best) {
          best = d;
          shooterId = m.id;
        }
      }
      return source.shoot(id, aim, damage, from);
    },
  });
  for (const m of squad.mates) {
    const t = director.targets.find((x) => x.id === m.id);
    if (!t) continue;
    const w = (): number => squad.weights().find((x) => x.id === m.id)?.weight ?? 0.6;
    Object.assign(t, {
      alive: () => !m.downed,
      weight: w,
      hurt: (amount: number) => squad.damageMate(m.id, amount),
    });
  }
  events.on('enemy:died', ({ by }) => {
    if (by === 'player') squad.recordKill('player');
  });
}
