/**
 * Physics feature switches for one session (adopt-physics-engine, design D9): the stored setting, unless the URL
 * overrides it with `?physics=`:
 *
 * - `?physics=off` (or `none`, `0`): every feature off.
 * - `?physics` (or `on`, `all`, `1`): every feature on.
 * - `?physics=debris,ragdoll`: exactly the named features on, the rest off.
 */
import { PHYSICS_FEATURES, PHYSICS_OFF, type PhysicsFeature, type PhysicsSwitches } from '../core/settings.ts';

export interface ResolvedSwitches {
  switches: PhysicsSwitches;
  /** Names in the URL list that are not features (reported once, ignored). */
  unknown: string[];
  /** Where the switches came from. */
  source: 'settings' | 'url';
}

const OFF = new Set(['off', 'none', '0', 'false']);
const ALL = new Set(['', 'on', 'all', '1', 'true']);

export function resolvePhysicsSwitches(stored: PhysicsSwitches, search: string): ResolvedSwitches {
  const q = new URLSearchParams(search);
  const raw = q.get('physics');
  if (raw === null) return { switches: { ...stored }, unknown: [], source: 'settings' };
  const value = raw.trim().toLowerCase();
  if (OFF.has(value)) return { switches: { ...PHYSICS_OFF }, unknown: [], source: 'url' };
  if (ALL.has(value)) return { switches: allOn(), unknown: [], source: 'url' };
  const out: Record<PhysicsFeature, boolean> = { ...PHYSICS_OFF };
  const unknown: string[] = [];
  for (const name of value.split(',').map((n) => n.trim()).filter(Boolean)) {
    if ((PHYSICS_FEATURES as readonly string[]).includes(name)) out[name as PhysicsFeature] = true;
    else unknown.push(name);
  }
  return { switches: out, unknown, source: 'url' };
}

/** True when at least one feature needs the engine. */
export function anyPhysics(s: PhysicsSwitches): boolean {
  return PHYSICS_FEATURES.some((f) => s[f]);
}

function allOn(): PhysicsSwitches {
  return { debris: true, ragdoll: true, powered: true, interact: true };
}
