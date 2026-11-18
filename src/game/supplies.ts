import * as THREE from 'three';
import type { EventBus, EventName } from '../core/events.ts';
import type { DifficultyPreset, DifficultyTable } from '../data/types/difficulty.ts';
import type { PickupData, SupplyKind } from '../data/types/level.ts';
import { fixtureMaterial, type Materials } from '../render/materials.ts';
import { inReach, inWeaponReach, rollDrop, supplyAmount, takenFlag, WEAPON_OF, WEAPON_PICKUP, type AmmoWeapon } from './pickups.ts';

declare module '../core/events.ts' {
  interface EventMap {
    /** A supply was collected (ADR-0005/0008). `amount`: rounds, shells or HP healed. */
    'pickup:taken': { id: string; kind: SupplyKind; amount: number; dropped: boolean };
  }
}

export interface SuppliesDeps {
  scene: THREE.Scene;
  materials: Materials;
  events: EventBus;
  /** Placed supply pickups (level `pickups` with a `kind`). */
  placed: readonly PickupData[];
  difficulties: DifficultyTable;
  preset: () => DifficultyPreset;
  /** The playthrough's flags: taken placed pickups are saved as `pickup:<id>`. */
  flags: () => Record<string, string | number | boolean>;
  feet: () => { x: number; y: number; z: number };
  hp: () => number;
  /** Heal; returns false if nothing was healed (full health). */
  heal: (amount: number) => boolean;
  /** Ammo per owned weapon (missing = not owned). */
  ammo: () => Partial<Record<AmmoWeapon, { reserve: number; mag: number }>>;
  addAmmo: (weapon: AmmoWeapon, n: number) => void;
  /** Weapon pickups: hand Jay the weapon; false if he already has it (then it is left). */
  giveWeapon?: (weapon: AmmoWeapon) => boolean;
  random?: () => number;
}

interface Live {
  id: string;
  kind: SupplyKind;
  /** Standard amount, or the fixed amount of a drop. */
  base: number | undefined;
  fixed: number | undefined;
  pos: [number, number, number];
  mesh: THREE.Group;
  dropped: boolean;
  t: number;
}

const MAX_DROPS = 12;

/**
 * Ammo boxes and medkits in the world (ADR-0005 step 6, ADR-0008): placed by level data or
 * dropped by enemies, collected by walking within 1 m. A medkit stays put while Jay is at
 * full health. Placed ones are remembered in the save flags; drops are not saved.
 */
export class Supplies {
  readonly group = new THREE.Group();
  private readonly d: SuppliesDeps;
  private readonly live: Live[] = [];
  private readonly random: () => number;
  private readonly geo = {
    ammo: new THREE.BoxGeometry(0.22, 0.11, 0.14),
    shells: new THREE.BoxGeometry(0.18, 0.09, 0.12),
    kit: new THREE.BoxGeometry(0.3, 0.12, 0.2),
    stripe: new THREE.BoxGeometry(1, 1, 1),
  };
  private readonly glow = { ammo: fixtureMaterial('#ffb347', 2.2), kit: fixtureMaterial('#ff4a3d', 2.2) };
  private dropSeq = 0;

  constructor(deps: SuppliesDeps) {
    this.d = deps;
    this.random = deps.random ?? Math.random;
    this.group.name = 'supplies';
    deps.scene.add(this.group);
    for (const p of deps.placed) if (p.kind) this.spawn(p.id, p.kind, p.pos, p.rot ?? 0, p.amount, undefined, false);
    // Enemy deaths roll a need-based drop. The enemy code may name the event either way.
    for (const name of ['enemy:died', 'enemy:killed']) {
      deps.events.on(name as EventName, ((p: unknown) => this.onEnemyDeath(p)) as never);
    }
  }

  /** New game or load: placed pickups follow the flags, drops vanish. */
  reset(): void {
    for (let i = this.live.length - 1; i >= 0; i--) if (this.live[i]!.dropped) this.remove(i);
    const placed = new Set(this.live.map((l) => l.id));
    for (const p of this.d.placed) if (p.kind && !placed.has(p.id)) this.spawn(p.id, p.kind, p.pos, p.rot ?? 0, p.amount, undefined, false);
  }

  /** Drop a supply at a position (enemy drops, or scripts). */
  drop(kind: SupplyKind, amount: number, at: [number, number, number]): void {
    const drops = this.live.filter((l) => l.dropped);
    if (drops.length >= MAX_DROPS) this.remove(this.live.indexOf(drops[0]!));
    this.spawn(`drop${this.dropSeq++}`, kind, at, this.random() * 360, undefined, amount, true);
  }

  update(dt: number): void {
    const flags = this.d.flags();
    const feet = this.d.feet();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i]!;
      if (!l.dropped && flags[takenFlag(l.id)]) {
        this.remove(i);
        continue;
      }
      l.t += dt;
      if (!WEAPON_PICKUP[l.kind]) {
        l.mesh.rotation.y += dt * 0.6;
        l.mesh.position.y = l.pos[1] + 0.04 + Math.sin(l.t * 2) * 0.02;
      }
      const reach = WEAPON_PICKUP[l.kind] ? inWeaponReach(feet, l.pos) : inReach(feet, l.pos);
      if (reach && this.collect(l)) this.remove(i);
    }
  }

  private collect(l: Live): boolean {
    const weaponGiven = WEAPON_PICKUP[l.kind];
    if (weaponGiven) {
      if (!this.d.giveWeapon?.(weaponGiven)) return false;
      if (!l.dropped) this.d.flags()[takenFlag(l.id)] = true;
      this.d.events.emit('pickup:taken', { id: l.id, kind: l.kind, amount: 0, dropped: l.dropped });
      return true;
    }
    const preset = this.d.preset();
    const amount = l.fixed ?? supplyAmount(l.kind, preset, this.d.difficulties, l.base);
    if (l.kind === 'medkit') {
      if (!this.d.heal(amount)) return false;
    } else {
      const weapon = WEAPON_OF[l.kind as 'ammo_pistol' | 'ammo_shotgun'];
      if (!this.d.ammo()[weapon]) return false; // not owned yet: leave it
      this.d.addAmmo(weapon, amount);
    }
    if (!l.dropped) this.d.flags()[takenFlag(l.id)] = true;
    this.d.events.emit('pickup:taken', { id: l.id, kind: l.kind, amount, dropped: l.dropped });
    return true;
  }

  private onEnemyDeath(p: unknown): void {
    const at = positionOf(p);
    if (!at) return;
    const drop = rollDrop(this.d.preset(), this.d.difficulties, { hp: this.d.hp(), ammo: this.d.ammo() }, this.random);
    if (drop) this.drop(drop.kind, drop.amount, [at[0], at[1], at[2]]);
  }

  private spawn(id: string, kind: SupplyKind, pos: readonly number[], rot: number, base: number | undefined, fixed: number | undefined, dropped: boolean): void {
    const m = this.d.materials;
    const mesh = new THREE.Group();
    mesh.name = `supply:${id}`;
    if (WEAPON_PICKUP[kind]) {
      // The Breacher on its rack: barrel, receiver, pump and stock, with an amber stripe so it reads in the dark.
      const parts: Array<[number, number, number, number, number, number]> = [
        [0.06, 0.06, 0.62, 0, 0.05, -0.28], // barrel + mag tube
        [0.07, 0.1, 0.3, 0, 0.04, 0.12], // receiver
        [0.08, 0.06, 0.16, 0, 0.0, -0.2], // pump
        [0.05, 0.12, 0.3, 0, -0.02, 0.38], // stock
      ];
      for (const [w, h, d, x, y, z] of parts) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m.paintDark);
        b.position.set(x, y + 0.06, z);
        mesh.add(b);
      }
      const glowStripe = new THREE.Mesh(this.geo.stripe, this.glow.ammo);
      glowStripe.scale.set(0.072, 0.012, 0.2);
      glowStripe.position.set(0, 0.155, 0.12);
      mesh.add(glowStripe);
      mesh.position.set(pos[0]!, pos[1]!, pos[2]!);
      mesh.rotation.y = (rot * Math.PI) / 180;
      this.group.add(mesh);
      this.live.push({ id, kind, base, fixed, pos: [pos[0]!, pos[1]!, pos[2]!], mesh, dropped, t: 0 });
      return;
    }
    const body = new THREE.Mesh(kind === 'medkit' ? this.geo.kit : kind === 'ammo_shotgun' ? this.geo.shells : this.geo.ammo, kind === 'medkit' ? m.paintBone : m.paintDark);
    const size = (body.geometry as THREE.BoxGeometry).parameters;
    body.position.y = size.height / 2;
    const stripe = new THREE.Mesh(this.geo.stripe, kind === 'medkit' ? this.glow.kit : this.glow.ammo);
    if (kind === 'medkit') {
      // A glowing cross on the lid.
      stripe.scale.set(0.12, 0.01, 0.035);
      const bar = stripe.clone();
      bar.scale.set(0.035, 0.01, 0.12);
      stripe.position.y = bar.position.y = size.height + 0.004;
      mesh.add(bar);
    } else {
      stripe.scale.set(size.width * 1.02, 0.02, size.depth * 1.02);
      stripe.position.y = size.height * 0.7;
    }
    mesh.add(body, stripe);
    mesh.position.set(pos[0]!, pos[1]!, pos[2]!);
    mesh.rotation.y = (rot * Math.PI) / 180;
    this.group.add(mesh);
    this.live.push({ id, kind, base, fixed, pos: [pos[0]!, pos[1]!, pos[2]!], mesh, dropped, t: this.random() * 6 });
  }

  private remove(i: number): void {
    const [l] = this.live.splice(i, 1);
    if (l) this.group.remove(l.mesh);
  }
}

/** `{ pos: [x,y,z] }`, `{ position: {x,y,z} }` or `{ x, y, z }`, at feet level. */
function positionOf(p: unknown): [number, number, number] | null {
  if (typeof p !== 'object' || p === null) return null;
  const o = p as Record<string, unknown>;
  const v = o['pos'] ?? o['position'] ?? o['at'] ?? o;
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number')) return [v[0] as number, v[1] as number, v[2] as number];
  if (typeof v === 'object' && v !== null) {
    const q = v as Record<string, unknown>;
    if (typeof q['x'] === 'number' && typeof q['y'] === 'number' && typeof q['z'] === 'number') return [q['x'], q['y'], q['z']];
  }
  return null;
}
