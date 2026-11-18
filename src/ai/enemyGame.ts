import * as THREE from 'three';
import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { HumanoidContext } from '../actors/humanoid.ts';
import type { Player } from '../actors/player.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { EventBus } from '../core/events.ts';
import { validate } from '../core/validate.ts';
import enemiesJson from '../data/enemies.json';
import type { World } from '../world/world.ts';
import { ENEMY_VARIANT_IDS, validateEnemyTable, type EnemyVariantId } from './enemyData.ts';
import { EnemyDirector } from './enemyDirector.ts';
import { playerTarget, squadTarget } from './enemyTargets.ts';
import type { P3 } from './nav.ts';
import { spawnPointsOf, type SpawnPointData } from './spawner.ts';

/**
 * Wires the enemy AI (ADR-0007) into the main game: targets (player and squad), player weapon hits,
 * noise from shots, footsteps and shoves, resets on new game / checkpoint restart / title, a little
 * audio, and the `?enemies=` and `?debug` tools. Kept out of main.ts so the shared file only gains
 * a few lines.
 *
 * Try it: `?level=kit_test&enemies=shambler:2,hero,playDead` spawns those near the player when play
 * starts; `?debug` adds an Enemies folder (spawn in front, kill all, freeze, ignore player).
 * `window.__enemies` is the director (console).
 */

export { spawnPointsOf };

export interface EnemyGameDeps {
  events: EventBus;
  ctx: HumanoidContext;
  world: World;
  player: Player;
  camera: THREE.Camera;
  flashlightOn: () => boolean;
  game: { readonly preset: { enemyHp: number; enemyLurchInterval: number }; flags: Record<string, string | number | boolean> };
  audio?: AudioEngine;
  spawns?: SpawnPointData[];
  /** Squadmates (ADR-0011) as hunt targets and obstacles. */
  squad?: { mates: ReadonlyArray<{ id: string; position: THREE.Vector3 }> } | null;
  search?: string;
}

export interface EnemyGame {
  director: EnemyDirector;
  update(dt: number): void;
  addDebug(gui: GUI): void;
}

const tmp = new THREE.Vector3();
const view = new THREE.Vector3();

export function setupEnemies(d: EnemyGameDeps): EnemyGame {
  const table = validate(validateEnemyTable, enemiesJson, 'data/enemies.json');
  const nav = d.world.navGraph();
  const mates = d.squad?.mates ?? [];
  const obstacles = mates.map((m) => ({ x: 0, z: 0, r: 0.3, m }));
  const director = new EnemyDirector({
    ctx: d.ctx,
    nav,
    colliders: d.world.playerWorld.colliders,
    events: d.events,
    table,
    difficulty: () => d.game.preset,
    seed: `${d.world.id}:enemies`,
    obstacles: () => {
      for (const o of obstacles) {
        o.x = o.m.position.x;
        o.z = o.m.position.z;
      }
      return obstacles;
    },
  });
  director.group.visible = false;
  director.addTarget(playerTarget(d.player, d.flashlightOn));
  // Squadmates take hits through `enemy:attack` (the squad owns their health, ADR-0011).
  for (const m of mates) director.addTarget(squadTarget({ id: m.id, position: () => m.position }));
  if (d.spawns?.length) director.setSpawns(d.spawns);

  const ev = d.events;
  const cleared = (): Set<string> => new Set(director.spawner.groupIds().filter((g) => d.game.flags[`group:${g}`] === 'cleared'));
  let mode = 'title';
  let pendingDebug = parseDebugSpawns(new URLSearchParams(d.search ?? '').get('enemies'));
  ev.on('game:mode', ({ mode: next }) => {
    director.group.visible = next !== 'title';
    if (next === 'title') director.clear();
    else if (next === 'playing' && mode === 'title') {
      director.reset(cleared());
      pendingDebug = parseDebugSpawns(new URLSearchParams(d.search ?? '').get('enemies'));
    }
    mode = next;
  });
  ev.on('game:restarted', () => director.reset(cleared()));
  ev.on('group:cleared', ({ group }) => {
    d.game.flags[`group:${group}`] = 'cleared';
  });

  // Hits and noise.
  ev.on('weapon:fired', ({ weapon }) => {
    d.camera.getWorldPosition(tmp);
    d.camera.getWorldDirection(view);
    director.playerShot(weapon, tmp, view, d.player.aimBlend);
  });
  ev.on('player:footstep', (f) => director.noise(f.sprint ? 'sprint' : 'footstep', f, 'player'));
  ev.on('player:shove', (s) => {
    director.shove(s.origin, s.dir, s.range, s.coneDeg, s.damage, s.push);
    director.noise('impact', { x: s.origin[0], y: s.origin[1], z: s.origin[2] }, 'player');
  });

  // Cheap audio: a groan when one notices you, a heavy knock when a hero slams.
  const audio = d.audio;
  if (audio) {
    ev.on('enemy:alerted', (a) => audio.play('distantMoan', { bus: 'sfx', gain: 0.55, rate: 1.25 + Math.random() * 0.2, position: new THREE.Vector3(a.x, a.y + 1.5, a.z), reverb: 0.3 }));
    ev.on('enemy:slam', (s) => audio.play('metalKnock', { bus: 'sfx', gain: 1, rate: 0.45, position: new THREE.Vector3(s.x, s.y, s.z), reverb: 0.5 }));
  }

  const spawnAhead = (variant: EnemyVariantId, distance = 6, model?: string | null): void => {
    const p = findSpotNear(director, d.player, distance);
    if (!p) return void console.warn('[enemies] no walkable spot found');
    const yaw = Math.atan2(p.x - d.player.body.x, p.z - d.player.body.z);
    director.spawn(variant, p, yaw, model === undefined ? {} : { model });
  };
  const firstModel = (): string | null => {
    const lib = d.ctx.bodyModels;
    return lib ? (Object.keys(lib.table).find((id) => lib.get(id)) ?? null) : null;
  };

  Object.assign(globalThis, { __enemies: director });

  return {
    director,
    update(dt) {
      if (pendingDebug.length) {
        for (const v of pendingDebug) spawnAhead(v, 7 + Math.random() * 6);
        pendingDebug = [];
      }
      d.camera.getWorldPosition(tmp);
      director.update(dt, tmp);
    },
    addDebug(gui) {
      const f = gui.addFolder('Enemies');
      const actions = {
        shambler: () => spawnAhead('shambler'),
        hero: () => spawnAhead('hero', 8),
        playDead: () => spawnAhead('playDead', 4),
        modelShambler: () => {
          const id = firstModel();
          if (id) spawnAhead('shambler', 6, id);
          else console.warn('[enemies] no body model loaded (data/body-models.json)');
        },
        killAll: () => {
          for (const e of director.list) if (e.alive) e.body.hurt('torso', 1e6);
        },
        clear: () => director.clear(),
      };
      f.add(actions, 'shambler').name('spawn shambler ahead');
      f.add(actions, 'hero').name('spawn hero ahead');
      f.add(actions, 'playDead').name('spawn play-dead ahead');
      f.add(actions, 'modelShambler').name('spawn model shambler ahead');
      f.add(actions, 'killAll').name('kill all');
      f.add(actions, 'clear').name('remove all');
      f.add(director, 'frozen').name('freeze AI');
      f.add(director, 'ignorePlayer').name('ignore player');
      const stats = { alive: 0, queued: 0, states: '' };
      f.add(stats, 'alive').listen().disable();
      f.add(stats, 'queued').listen().disable();
      f.add(stats, 'states').listen().disable();
      setInterval(() => {
        stats.alive = director.aliveCount;
        stats.queued = director.spawner.pending();
        stats.states = Object.entries(director.stateCounts()).map(([k, v]) => `${k} ${v}`).join(', ');
      }, 250);
      f.close();
    },
  };
}

/** `?enemies=shambler:2,hero,playDead` -> list of variants. */
export function parseDebugSpawns(param: string | null): EnemyVariantId[] {
  if (!param) return [];
  const out: EnemyVariantId[] = [];
  for (const part of param.split(',')) {
    const [name, n] = part.trim().split(':');
    const v = ENEMY_VARIANT_IDS.find((id) => id.toLowerCase() === (name ?? '').toLowerCase());
    if (!v) {
      console.warn(`[enemies] unknown variant '${name}'. Known: ${ENEMY_VARIANT_IDS.join(', ')}`);
      continue;
    }
    for (let i = 0; i < Math.min(8, Math.max(1, Number(n ?? 1) || 1)); i++) out.push(v);
  }
  return out;
}

/** A nav node about `distance` m from the player, preferring the view direction and a walkable route. */
export function findSpotNear(director: EnemyDirector, player: Player, distance: number): P3 | null {
  const nav = director.nav;
  const feet = { x: player.body.x, y: player.body.y, z: player.body.z };
  const v = player.viewDirection(tmp).setY(0).normalize();
  let best: P3 | null = null;
  let bestScore = Infinity;
  for (const n of nav.nodes) {
    const dx = n.x - feet.x;
    const dz = n.z - feet.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.5 || Math.abs(n.y - feet.y) > 0.5) continue;
    const ahead = dist > 0 ? (dx * v.x + dz * v.z) / dist : 0;
    const taken = director.list.some((e) => Math.hypot(e.motor.x - n.x, e.motor.z - n.z) < 0.8);
    const score = Math.abs(dist - distance) - ahead * 2 + (taken ? 10 : 0) + Math.random() * 0.5;
    if (score < bestScore && nav.findPath(feet, n, { radius: 0.25 })) {
      bestScore = score;
      best = n;
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null;
}
