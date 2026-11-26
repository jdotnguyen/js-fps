import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SampleName, SoundName } from './sounds.ts';

/**
 * Commons room sounds (in-world-audio spec): a chair scrapes as one of the crew gets up or sits down, cups and cutlery
 * clink at the tables where they sit, and the kitchen is heard from the counter while Bram works at it. Each comes from
 * its place on the `sfx` bus, so walls, doors and glass muffle it as they do other world sounds. All of it stops for
 * good at the drop. Bram's brew is his routine's own sound (src/ai/cookBrew.ts).
 *
 * Pure bookkeeping over a small audio surface, so it runs in node tests.
 */

/**
 * The game flag that says the intro is over. The intro sets it just before its autosave; `commons_free` is set after the
 * save, so a loaded game would not have it.
 */
export const COMMONS_OPEN_FLAG = 'introSeen';

export const COMMONS_TUNING = {
  // Above 1 on purpose: distance takes 10-20 dB off across the room, and the room bed and radio sit under these.
  chair: { gain: 1.3, reverb: 0.2, rate: [0.92, 1.08] as const },
  table: { gain: 2, reverb: 0.2, rate: [0.94, 1.07] as const, every: [4, 10] as const },
  kitchen: { gain: 2.2, reverb: 0.25, rate: [0.96, 1.04] as const, every: [8, 20] as const },
  /** Share of its level a sound starts at while someone is talking. */
  talkShare: 0.5,
  /** Nothing starts further than this (m) from the player. */
  maxDistance: 24,
  /** Height (m) of a scraping chair leg above its spot. */
  chairHeight: 0.15,
  /** A cup sits this far (m) in front of the diner's seat, at table height. */
  tableReach: 0.45,
  tableHeight: 0.78,
  /** Kitchen sounds spread this far (m) either way along the counter, which runs along x. */
  counterSpread: 1.2,
} as const;

export interface CommonsAudio {
  hasSample(name: SampleName): boolean;
  play(name: SoundName, opts?: VoiceOptions): LoopHandle;
}

type Point = { readonly x: number; readonly y: number; readonly z: number };

/** A chair someone is sitting on; the yaw faces its table. */
export interface CommonsSeat {
  readonly pos: Point;
  readonly yaw: number;
}

export interface CommonsFrame {
  /** Jay's ears. */
  listener: THREE.Vector3;
  /** The drop has started: nothing more this playthrough. */
  over: boolean;
  /** A line is audible or an overheard exchange is being said. */
  talking: boolean;
  /** The chairs crew are sitting on now. */
  seats: readonly CommonsSeat[];
  /** The intro is over. */
  introOver: boolean;
  /** Bram is standing at his station. */
  cookAtStation: boolean;
  /** A scripted Commons scene is running. */
  sceneRunning: boolean;
}

export interface CommonsPlace {
  /** The room these sounds belong to. */
  readonly room: string;
  /** The kitchen counter; null when the level has none. */
  readonly counter: Point | null;
}

type Kind = 'chair' | 'table' | 'kitchen';

const SAMPLES: Record<Kind, SampleName> = { chair: 'chairScrape', table: 'tableClink', kitchen: 'kitchenClatter' };
/** Handles kept so the title screen can cut them off; each clip lasts a second or two. */
const KEPT = 8;

export class CommonsSounds {
  private readonly audio: CommonsAudio;
  private readonly place: CommonsPlace;
  private rng = new Rng('commons-sounds');
  /** Chairs that scraped since the last update. */
  private scrapes: Point[] = [];
  /** Seconds to the next table and kitchen sound; null until their conditions first hold. */
  private tableIn: number | null = null;
  private kitchenIn: number | null = null;
  private playing: LoopHandle[] = [];

  constructor(audio: CommonsAudio, place: CommonsPlace) {
    this.audio = audio;
    this.place = place;
  }

  /** One of the crew got up from, or sat down on, this spot. Only dining chairs in the Commons make a sound. */
  chair(spot: { readonly room: string; readonly kind: string; readonly pos: Point }): void {
    if (spot.room === this.place.room && spot.kind === 'sit_chair') this.scrapes.push(spot.pos);
  }

  update(dt: number, frame: CommonsFrame): void {
    const scrapes = this.scrapes;
    this.scrapes = [];
    if (frame.over) return;
    for (const p of scrapes) this.sound('chair', new THREE.Vector3(p.x, p.y + COMMONS_TUNING.chairHeight, p.z), frame);

    if (frame.seats.length > 0) {
      this.tableIn ??= this.rng.range(...COMMONS_TUNING.table.every);
      this.tableIn -= dt;
      if (this.tableIn <= 0) {
        this.tableIn = this.rng.range(...COMMONS_TUNING.table.every);
        const { pos, yaw } = this.rng.pick(frame.seats);
        const reach = COMMONS_TUNING.tableReach;
        this.sound('table', new THREE.Vector3(pos.x - Math.sin(yaw) * reach, pos.y + COMMONS_TUNING.tableHeight, pos.z - Math.cos(yaw) * reach), frame);
      }
    }

    const counter = this.place.counter;
    if (counter && frame.introOver && frame.cookAtStation && !frame.sceneRunning) {
      this.kitchenIn ??= this.rng.range(...COMMONS_TUNING.kitchen.every);
      this.kitchenIn -= dt;
      if (this.kitchenIn <= 0) {
        this.kitchenIn = this.rng.range(...COMMONS_TUNING.kitchen.every);
        const along = this.rng.range(-COMMONS_TUNING.counterSpread, COMMONS_TUNING.counterSpread);
        this.sound('kitchen', new THREE.Vector3(counter.x + along, counter.y, counter.z), frame);
      }
    }
  }

  /** New game, load, death or the title screen: silence what is playing and start the timers afresh. */
  reset(): void {
    for (const h of this.playing) h.stop(0.1);
    this.playing = [];
    this.scrapes = [];
    this.tableIn = null;
    this.kitchenIn = null;
    this.rng = new Rng('commons-sounds');
  }

  private sound(kind: Kind, position: THREE.Vector3, frame: CommonsFrame): void {
    const name = SAMPLES[kind];
    if (!this.audio.hasSample(name) || position.distanceTo(frame.listener) > COMMONS_TUNING.maxDistance) return;
    const { gain, reverb, rate } = COMMONS_TUNING[kind];
    const handle = this.audio.play(name, {
      bus: 'sfx',
      position,
      gain: gain * (frame.talking ? COMMONS_TUNING.talkShare : 1),
      reverb,
      rate: this.rng.range(rate[0], rate[1]),
    });
    this.playing.push(handle);
    if (this.playing.length > KEPT) this.playing.shift();
  }
}
