import * as THREE from 'three';
import type { Emote } from '../data/types/dialogue.ts';
import { Rng } from '../core/rng.ts';

/**
 * Background conversations (ADR-0029). NPCs that share a `chat` id talk to each other: one speaker at a time says an
 * unvoiced, unsubtitled filler line through `Humanoid.speak()` (the text only drives the mouth and the gestures), the
 * listeners look at the speaker, someone now and then laughs back, and the turn passes on after a short beat.
 *
 * Pure logic over a small member interface, so it runs in node tests without bodies.
 */

/** What a conversation needs from a body. */
export interface ChatMember {
  readonly id: string;
  /** Feet position (XZ is what matters). */
  feet(): { x: number; z: number };
  /** Eye point, for the others to look at. */
  head(out: THREE.Vector3): THREE.Vector3 | null;
  /** Free to talk: ambient, not driven by a sequence, not offering, alive and human. */
  available(): boolean;
  speak(text: string, emote: Emote, seconds: number, seed: string): void;
  stopSpeaking(): void;
  /** Who to look at (null: nobody in particular). */
  lookAt(get: (() => THREE.Vector3 | null) | null): void;
}

export const CHAT_TUNING = {
  /** A member further than this from the group's centre has wandered off and drops out. */
  reach: 3,
  line: [1.6, 4.2] as const,
  beat: [0.4, 2.5] as const,
  /** Now and then the group goes quiet for a while. */
  quietChance: 1 / 6,
  quiet: [4, 8] as const,
  /** A listener laughs or answers in a word after a line. */
  reactChance: 0.25,
} as const;

/** Never shown or voiced: the words only set the rhythm of the mouth. */
const LINES: readonly string[] = [
  'So I told him the pump was fine, and then it flooded the whole bay.',
  'Did you see the new duty roster? Three nights in a row.',
  'Honestly the coffee down here is getting worse.',
  'She said the transfer request went through last week.',
  'We should have been topside by now.',
  'I keep hearing that hum in the walls at night.',
  'Ruiz still owes me twenty from the card game.',
  'No, the other lab. The one with the glass.',
  'My kid sent a drawing of the station, it is on my locker.',
  'They moved the supply sub again, did you hear?',
  'If I see one more safety memo I swear.',
  'Wait, which shift are you on now?',
  'It is only six weeks until rotation, we can do six weeks.',
  'Hale was walking around with the suits again this morning.',
  'Right, and then the lights went out in the whole corridor.',
  'Do you want the rest of this? I cannot finish it.',
];
const REACTIONS: ReadonlyArray<{ text: string; emote: Emote; seconds: number }> = [
  { text: 'Ha ha ha.', emote: 'laugh', seconds: 1.1 },
  { text: 'Yeah.', emote: 'neutral', seconds: 0.6 },
  { text: 'No way.', emote: 'question', seconds: 0.8 },
  { text: 'Ha, right.', emote: 'laugh', seconds: 0.9 },
];

function emoteRoll(rng: Rng): Emote {
  const r = rng.next();
  return r < 0.6 ? 'neutral' : r < 0.8 ? 'question' : r < 0.9 ? 'relieved' : 'laugh';
}

export class ChatGroup {
  readonly id: string;
  readonly members: readonly ChatMember[];
  private rng: Rng;
  private speaker: ChatMember | null = null;
  private last: ChatMember | null = null;
  private left: number;
  private active: ChatMember[] = [];
  private readonly heads = new Map<ChatMember, THREE.Vector3>();
  /** Someone else is giving this group its lines (an overheard exchange): no filler turns of its own. */
  private held = false;

  constructor(id: string, members: readonly ChatMember[]) {
    this.id = id;
    this.members = members;
    this.rng = new Rng(`chat:${id}`);
    this.left = this.rng.range(0.2, 1.5);
  }

  /** Who is talking now (tests, debug). */
  get speaking(): string | null {
    return this.speaker?.id ?? null;
  }

  /** Members taking part right now. */
  get engaged(): readonly string[] {
    return this.active.map((m) => m.id);
  }

  /** Back to the start (new game, load): same seed, nobody talking. */
  reset(): void {
    this.endLine();
    this.rng = new Rng(`chat:${this.id}`);
    this.left = this.rng.range(0.2, 1.5);
    this.last = null;
    this.held = false;
    for (const m of this.members) m.lookAt(null);
    this.active = [];
  }

  /**
   * Hold the group's own turns while it speaks written lines, or take them up again. Holding closes any filler line or
   * reaction at once, so nothing here moves or shuts a mouth that is saying a real one; the members keep facing each
   * other.
   */
  suspend(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    if (on) {
      this.speaker = null;
      for (const m of this.members) m.stopSpeaking();
    } else {
      this.left = this.rng.range(...CHAT_TUNING.beat);
    }
  }

  update(dt: number): void {
    this.refresh();
    if (this.speaker && !this.active.includes(this.speaker)) this.endLine();
    if (this.active.length < 2) {
      this.endLine();
      return;
    }
    if (this.held) {
      this.active.forEach((m, i) => m.lookAt(this.headGetter(this.active[(i + 1) % this.active.length]!)));
      return;
    }
    this.left -= dt;
    if (this.left > 0) return;
    if (this.speaker) {
      // The line is over: maybe a quick reaction from someone else, then a beat.
      const done = this.speaker;
      this.endLine();
      const others = this.active.filter((m) => m !== done);
      if (others.length && this.rng.chance(CHAT_TUNING.reactChance)) {
        const r = this.rng.pick(REACTIONS);
        this.rng.pick(others).speak(r.text, r.emote, r.seconds, `${this.id}:${r.text}`);
      }
      this.left = this.rng.chance(CHAT_TUNING.quietChance) ? this.rng.range(...CHAT_TUNING.quiet) : this.rng.range(...CHAT_TUNING.beat);
      return;
    }
    this.startLine();
  }

  private refresh(): void {
    const free = this.members.filter((m) => m.available());
    let cx = 0;
    let cz = 0;
    for (const m of free) {
      const p = m.feet();
      cx += p.x;
      cz += p.z;
    }
    cx /= Math.max(1, free.length);
    cz /= Math.max(1, free.length);
    const now = free.filter((m) => {
      const p = m.feet();
      return Math.hypot(p.x - cx, p.z - cz) <= CHAT_TUNING.reach;
    });
    for (const m of this.active) if (!now.includes(m)) m.lookAt(null);
    this.active = now;
  }

  private startLine(): void {
    const pool = this.active.length > 2 ? this.active.filter((m) => m !== this.last) : this.active.filter((m) => m !== this.last).concat(this.active.length === 2 && this.rng.chance(0.25) && this.last ? [this.last] : []);
    const speaker = this.rng.pick(pool.length ? pool : this.active);
    const text = this.rng.pick(LINES);
    const seconds = this.rng.range(...CHAT_TUNING.line);
    this.speaker = speaker;
    this.last = speaker;
    this.left = seconds;
    speaker.speak(text, emoteRoll(this.rng), seconds, `${this.id}:${text}`);
    const at = this.headGetter(speaker);
    const others = this.active.filter((m) => m !== speaker);
    for (const m of others) m.lookAt(at);
    // The speaker talks to one of them.
    if (others.length) speaker.lookAt(this.headGetter(this.rng.pick(others)));
  }

  private endLine(): void {
    if (!this.speaker) return;
    this.speaker.stopSpeaking();
    this.speaker = null;
  }

  private headGetter(m: ChatMember): () => THREE.Vector3 | null {
    let v = this.heads.get(m);
    if (!v) {
      v = new THREE.Vector3();
      this.heads.set(m, v);
    }
    const out = v;
    return () => m.head(out);
  }
}
