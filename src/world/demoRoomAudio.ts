import * as THREE from 'three';
import type { AudioEngine, LoopHandle } from '../audio/engine.ts';
import { Scheduler } from '../audio/scheduler.ts';
import type { Rng } from '../core/rng.ts';
import type { ControlledLight } from '../render/lights.ts';
import { ABYSS_CYCLE } from '../render/fx/abyss.ts';
import type { DemoRoom } from './demoRoom.ts';

const BUZZ_GAIN = 0.2;

interface Buzz {
  handle: LoopHandle;
  light: ControlledLight;
  position: THREE.Vector3;
  prev: number;
  lastZap: number;
}

/**
 * The hallway's soundscape. Loops sit at their sources; one-shots are scheduled at
 * random intervals; light buzz follows each fixture's flicker; a moan is timed to the
 * silhouette passing the window; footsteps change between plate and grating.
 */
export class DemoRoomAudio {
  private readonly engine: AudioEngine;
  private readonly room: DemoRoom;
  private readonly rng: Rng;
  private readonly scheduler: Scheduler;
  private readonly buzz: Buzz[] = [];
  private lastMoanCycle = -1;

  constructor(engine: AudioEngine, room: DemoRoom, rng: Rng) {
    this.engine = engine;
    this.room = room;
    this.rng = rng;
    this.scheduler = new Scheduler(rng.fork('schedule'));
  }

  start(): void {
    const e = this.engine;
    const a = this.room.anchors;
    const r = this.rng;

    e.loop('roomTone', { bus: 'ambience', gain: 0.35 });
    e.loop('ventFan', { bus: 'ambience', gain: 0.6, position: a.vent, reverb: 0.1 });
    e.loop('waterRumble', { bus: 'ambience', gain: 0.8, position: a.window, reverb: 0.2 });
    e.loop('consoleHum', { bus: 'ambience', gain: 0.3, position: a.console });
    for (const f of a.fixtures) {
      this.buzz.push({
        handle: e.loop('fluorescentBuzz', { bus: 'ambience', gain: BUZZ_GAIN, position: f.position, rate: r.range(0.98, 1.02) }),
        light: f.light,
        position: f.position,
        prev: 1,
        lastZap: -1,
      });
    }

    const s = this.scheduler;
    const far = (): THREE.Vector3 =>
      new THREE.Vector3(r.pick([-1, 1]) * r.range(4, 9), r.range(-2, 4), r.range(-14, 14));
    s.add([1.2, 4.5], () =>
      e.play('drip', { bus: 'ambience', position: r.pick(a.drips), gain: 0.35, reverb: 0.35, rate: r.range(0.9, 1.15) }),
    );
    s.add([8, 20], () => e.play('metalKnock', { bus: 'ambience', position: far(), gain: 0.7, muffled: true, reverb: 0.7, rate: r.range(0.8, 1.1) }));
    s.add([16, 38], () =>
      e.play('hullGroan', {
        bus: 'ambience',
        position: new THREE.Vector3(r.range(-6, 6), r.range(-5, 6), r.range(-12, 12)),
        gain: 0.9,
        muffled: true,
        reverb: 0.55,
        rate: r.range(0.85, 1.05),
      }),
    );
    s.add([9, 22], () => e.play('creak', { bus: 'ambience', position: r.pick(a.ceiling), gain: 0.3, reverb: 0.4, rate: r.range(0.9, 1.1) }));
    s.add([20, 42], () =>
      e.play('pressurePing', {
        bus: 'ambience',
        position: a.abyss.clone().add(new THREE.Vector3(0, r.range(-2, 2), r.range(-6, 6))),
        gain: 0.25,
        muffled: true,
        reverb: 0.8,
      }),
    );
    s.add([6, 13], () => e.play('consoleBeep', { bus: 'ambience', position: a.console, gain: 0.3, reverb: 0.15 }));
    s.add([11, 17], () => e.play('klaxon', { bus: 'ambience', position: a.door, gain: 0.5, muffled: true, reverb: 0.5 }));
  }

  update(t: number): void {
    const e = this.engine;
    // Fluorescent buzz follows each light; a failing tube arcs when it kicks back on.
    for (const b of this.buzz) {
      const level = b.light.level;
      b.handle.setGain(BUZZ_GAIN * level, 0.01);
      if (b.prev < 0.4 && level > 0.75 && t - b.lastZap > 0.25) {
        e.play('zap', { bus: 'ambience', position: b.position, gain: 0.35, reverb: 0.25, rate: this.rng.range(0.9, 1.1) });
        b.lastZap = t;
      }
      b.prev = level;
    }

    this.scheduler.update(t);

    // The big silhouette outside crosses the window around 40-60% of its cycle.
    const cycle = Math.floor(t / ABYSS_CYCLE);
    if (t / ABYSS_CYCLE - cycle > 0.4 && cycle !== this.lastMoanCycle) {
      this.lastMoanCycle = cycle;
      e.play('distantMoan', { bus: 'ambience', position: this.room.anchors.abyss, gain: 0.9, muffled: true, reverb: 0.9 });
    }
  }

  /** One footstep from the player (ADR-0004 drives timing; the surface picks the sound). */
  footstep(surface: string, x: number, z: number, sprint: boolean): void {
    this.engine.play(surface === 'grate' ? 'footGrate' : 'footPlate', {
      position: new THREE.Vector3(x, 0.05, z),
      gain: sprint ? 0.8 : 0.65,
      reverb: 0.22,
      rate: this.rng.range(0.94, 1.06) * (sprint ? 1.05 : 1),
    });
  }

  flashlightClick(): void {
    this.engine.play('click', { bus: 'ui', gain: 0.5 });
  }
}
