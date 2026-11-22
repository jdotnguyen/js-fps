import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { evaluateMisterCycle, MISTER_BURST_DUR } from './misterCycle.ts';
import type { PropSoundEvent } from './types.ts';

const noop = (): void => undefined;
const stubCtx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => stubCtx, style: {} }) };

const { SLICE_PROPS } = await import('./slice.ts');

function fakeMaterials(): Materials {
  const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial();
  return new Proxy({} as Materials, { get: () => mat() });
}

test('evaluateMisterCycle ramps spray smoothly, lingers cloud after shutoff, and sputters every 3rd cycle', () => {
  const start = evaluateMisterCycle(0.2, 10, 0, false);
  assert.equal(start.active, true);
  assert.ok(start.spray > 0.5 && start.cloud > 0, 'spray and cloud active during burst');

  // 1.0 s after shutoff: spray is off, but vapor cloud still lingers smoothly.
  const linger = evaluateMisterCycle(MISTER_BURST_DUR + 1.0, 10, 0, false);
  assert.equal(linger.active, false);
  assert.equal(linger.spray, 0);
  assert.ok(linger.cloud > 0.2 && linger.cloud < 0.9, `cloud lingers smoothly after shutoff (got ${linger.cloud})`);

  // Fully dissipated well after shutoff.
  const quiet = evaluateMisterCycle(MISTER_BURST_DUR + 2.5, 10, 0, false);
  assert.equal(quiet.cloud, 0);

  // Sputter rail produces double-puff sputter on cycle % 3 === 1.
  const sput1 = evaluateMisterCycle(11.1, 11, 0, true);
  assert.equal(sput1.kind, 'sputter');
  assert.equal(sput1.active, true);
  const sputGap = evaluateMisterCycle(11.7, 11, 0, true);
  assert.equal(sputGap.active, false, 'brief choke between the two sputter puffs');
  const sput2 = evaluateMisterCycle(12.2, 11, 0, true);
  assert.equal(sput2.active, true, 'second sputter puff fires');
});

test('mister piece builds two GPU shader layers with zero CPU uploads and emits synchronized burst sounds', () => {
  const kit = SLICE_PROPS.find((d) => d.id === 'mister')!;
  const out = kit.generate({ length: 8, ceiling: 4.5, period: 10, offset: 0, sputter: true }, new Rng('mister-test'), fakeMaterials());

  const points: THREE.Points[] = [];
  out.object.traverse((o) => {
    if (o instanceof THREE.Points) points.push(o);
  });
  assert.equal(points.length, 2, 'two GPU particle layers (spray cones + vapor cloud)');
  for (const p of points) {
    assert.ok(p.material instanceof THREE.ShaderMaterial, `${p.name} uses GPU ShaderMaterial`);
    assert.equal(p.userData['skipGtao'], true, `${p.name} skips GTAO`);
  }

  const posVersions = points.map((p) => (p.geometry.getAttribute('position') as THREE.BufferAttribute).version);
  const sounds: PropSoundEvent[] = [];
  out.onSound?.((ev) => sounds.push(ev));

  // Cycle 0 (normal burst) starts at t = 0.05.
  out.tick?.(0.05, 0.016);
  assert.deepEqual(
    sounds.map((s) => s.sound),
    ['misterValve', 'misterSpray'],
    'normal burst emits valve + spray',
  );
  // Zero CPU vertex buffer uploads after ticking.
  const afterVersions = points.map((p) => (p.geometry.getAttribute('position') as THREE.BufferAttribute).version);
  assert.deepEqual(afterVersions, posVersions, 'no CPU vertex buffer uploads on tick');

  // Cycle 1 (sputter burst) starts at t = 10.05.
  sounds.length = 0;
  out.tick?.(10.05, 0.016);
  assert.deepEqual(
    sounds.map((s) => s.sound),
    ['misterValve', 'misterSputter'],
    'sputter cycle emits valve + sputter',
  );
});

test('hvac_dehumidifier emits dehumidifierHum loop and reactive humidityAlarm until round:hydro_alarm clears it', () => {
  const kit = SLICE_PROPS.find((d) => d.id === 'hvac_dehumidifier')!;
  const out = kit.generate({ ceiling: 3.2 }, new Rng('dehum-test'), fakeMaterials());

  assert.ok(out.soundLoops?.some((l) => l.sound === 'dehumidifierHum'), 'declares dehumidifierHum loop');

  const sounds: PropSoundEvent[] = [];
  out.onSound?.((ev) => sounds.push(ev));

  // Tick through first chirp and second chirp.
  out.tick?.(0.1, 0.1);
  out.tick?.(1.0, 0.1);
  assert.equal(sounds.filter((s) => s.sound === 'humidityAlarm').length, 1, 'chirps while alarm is active');

  // Clear alarm via round:hydro_alarm listener -> no more chirps.
  const clearFn = out.listeners?.find((l) => l.event === 'round:hydro_alarm')?.fn;
  const resetFn = out.listeners?.find((l) => l.event === 'level:reset')?.fn;
  assert.ok(clearFn && resetFn, 'registers round:hydro_alarm and level:reset listeners');
  clearFn!(undefined);
  sounds.length = 0;
  for (let t = 2; t <= 12; t += 0.5) out.tick?.(t, 0.5);
  assert.equal(sounds.length, 0, 'silent after round:hydro_alarm');

  // Reset level -> alarm chirping resumes.
  resetFn!(undefined);
  out.tick?.(13.0, 0.1);
  out.tick?.(14.0, 0.1);
  assert.equal(sounds.filter((s) => s.sound === 'humidityAlarm').length, 1, 'resumes after level:reset');
});

test('hydroponics equipment props declare their positional ElevenLabs loops', () => {
  const defs = new Map(SLICE_PROPS.map((d) => [d.id, d]));
  const mats = fakeMaterials();
  const hasLoop = (kitId: string, sound: string): boolean => {
    const out = defs.get(kitId)!.generate({}, new Rng(`loop:${kitId}`), mats);
    return (out.soundLoops ?? []).some((l) => l.sound === sound);
  };
  assert.ok(hasLoop('hydro_trough', 'hydroTrickle'));
  assert.ok(hasLoop('plant_rack', 'hydroTrickle'));
  assert.ok(hasLoop('fertigation_tank', 'fertigationPump'));
  assert.ok(hasLoop('kettle_set', 'kettleSimmer'));
});
