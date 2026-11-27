/**
 * Bark system: short combat and idle lines hooked to game events, with a
 * per-bark cooldown, a global cooldown and droppable priority (the lines are `combat` or
 * `idle`, so the speech manager drops them rather than play them late, and any story or
 * hint line cuts them off).
 *
 * Lines live in data/dialogue/barks01.json and are pooled by id: `bark_<pool>_<anything>`.
 * The speaker is the line's own: a rule picks the squadmate the event is about (`self`), the
 * other one (`other`), or anyone. Jay (`player`) only makes short reaction sounds outside
 * the on-rails scenes; his reactions skip the global cooldown.
 *
 * His reaction to a hit (player-hit-feedback D6) is picked by the hit's size rather than by a rule: the lines
 * `hurt_jay_light/mid/heavy`, at least `HURT_GAP` apart unless a heavier one cuts a lighter one off.
 *
 * Event names come from the enemy and squad systems; payload fields are read loosely
 * (`who` / `npc` / `speaker` / `role` for which squadmate) so either side can evolve.
 */

export interface BarkLine {
  id: string;
  speaker: string;
  priority: string;
}

export interface BarkSpeech {
  /** What is speaking now (barks never queue behind story/hint lines). */
  speaking(): { priority: string } | null;
  /** `overlap`: start at once, beside whatever else is speaking. */
  say(lineId: string, speaker: string, opts?: { overlap?: boolean }): void;
  stop?(lineId: string): void;
}

export interface LooseBus {
  on(name: string, fn: (payload: unknown) => void): () => void;
  emit(name: string, payload?: unknown): void;
}

export type BarkWho = 'any' | 'self' | 'other' | 'engineer' | 'medic' | 'player' | 'squad';

export interface BarkRule {
  event: string;
  pool: string;
  /** Seconds before this rule may bark again. */
  cooldown: number;
  who?: BarkWho;
  /** 0..1, rolled each time. Default 1. */
  chance?: number;
  /** Only when the payload passes. */
  when?: (payload: Record<string, unknown>) => boolean;
  /** Fire only after `n` matching events within `within` seconds (teaching barks). */
  count?: { n: number; within: number };
  /** Ignores the global cooldown (Jay's reaction sounds). */
  reaction?: boolean;
}

const SQUAD = ['engineer', 'medic'] as const;
/** Names the squad code may use for its members. */
const ALIASES: Record<string, string> = { engineer: 'engineer', giles: 'engineer', august: 'engineer', medic: 'medic', okafor: 'medic', tomas: 'medic' };

/** Which squadmate a payload is about, if it says. */
export function whoOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  for (const k of ['who', 'npc', 'speaker', 'role', 'id', 'member']) {
    const v = p[k];
    if (typeof v === 'string' && ALIASES[v.toLowerCase()]) return ALIASES[v.toLowerCase()]!;
  }
  return null;
}

const part = (p: Record<string, unknown>): string => String(p['part'] ?? p['limb'] ?? p['region'] ?? '');

/** Default rules [Assumed numbers: per-bark 8-15 s, global 3 s]. */
export const BARK_RULES: readonly BarkRule[] = [
  { event: 'enemy:spotted', pool: 'spotted', cooldown: 15, who: 'squad' },
  { event: 'enemy:alerted', pool: 'spotted', cooldown: 15, who: 'squad' },
  { event: 'squad:reloading', pool: 'reload', cooldown: 10, who: 'self' },
  { event: 'enemy:died', pool: 'enemy_down', cooldown: 9, who: 'squad', chance: 0.7 },
  { event: 'enemy:killed', pool: 'enemy_down', cooldown: 9, who: 'squad', chance: 0.7 },
  { event: 'enemy:hit', pool: 'limb', cooldown: 10, who: 'squad', chance: 0.8, when: (p) => typeof p['severed'] === 'string' && !p['killed'] },
  // Teaching: three torso hits in a short time and Okafor calls for the legs.
  { event: 'enemy:hit', pool: 'legs', cooldown: 25, who: 'medic', count: { n: 3, within: 6 }, when: (p) => /torso|chest|body|abdomen|pelvis/.test(part(p)) && !p['severed'] && !p['killed'] },
  { event: 'player:grabbed', pool: 'grab_jay', cooldown: 3, who: 'player', reaction: true },
  { event: 'player:grabbed', pool: 'grabbed', cooldown: 8, who: 'squad' },
  { event: 'player:grabEscaped', pool: 'escaped', cooldown: 12, who: 'squad', chance: 0.6 },
  { event: 'player:startled', pool: 'scare_jay', cooldown: 4, who: 'player', reaction: true },
  { event: 'player:downed', pool: 'jay_down', cooldown: 5, who: 'medic' },
  { event: 'player:revived', pool: 'jay_up', cooldown: 10, who: 'medic' },
  { event: 'squad:downed', pool: 'mate_down', cooldown: 6, who: 'other' },
  { event: 'squad:up', pool: 'mate_up', cooldown: 10, who: 'self' },
  { event: 'player:lowAmmo', pool: 'low_ammo', cooldown: 40, who: 'engineer' },
  { event: 'player:lowHealth', pool: 'low_health', cooldown: 30, who: 'medic' },
  { event: 'group:cleared', pool: 'cleared', cooldown: 12, who: 'squad' },
  // Giles grumbles about his own work only, never while Okafor is the one on a panel.
  { event: 'squad:taskProgress', pool: 'task', cooldown: 14, who: 'engineer', chance: 0.7, when: (p) => whoOf(p) === 'engineer' },
  { event: 'bark:idle', pool: 'idle', cooldown: 90, who: 'squad' },
];

export const GLOBAL_COOLDOWN = 3;
/** Jay's hit reactions, lightest first: a sharp breath, a grunt, a heavy cry. */
export const HURT_LINES = ['hurt_jay_light', 'hurt_jay_mid', 'hurt_jay_heavy'] as const;
/** Seconds between hit reactions of the same size or smaller. */
export const HURT_GAP = 1;
/** The voice follows the blow by this much, so the impact is heard first. */
export const HURT_DELAY = 0.09;

/** Which of `HURT_LINES` a hit of this severity (0..1) draws. */
export function hurtTier(severity: number): number {
  return severity < 0.3 ? 0 : severity < 0.7 ? 1 : 2;
}
/** Seconds after the last combat event that still count as "in combat". */
export const COMBAT_HOLD = 8;
/** Events that mean a fight is on. */
const COMBAT_EVENTS = ['enemy:spotted', 'enemy:alerted', 'enemy:hit', 'enemy:attack', 'enemy:grab', 'player:damaged', 'player:grabbed', 'weapon:fired', 'combat:first', 'squad:downed'];

export interface RoomCommentarySpec {
  readonly lineId: string;
  readonly speaker: string;
  readonly rooms: readonly string[];
  readonly phase: 'morning' | 'post_drop';
  readonly requires?: readonly string[];
}

export const ROOM_COMMENTARY_DWELL_S = 3.0;

export const ROOM_COMMENTARY: readonly RoomCommentarySpec[] = [
  { lineId: 'room_comm_r01_01', speaker: 'engineer', rooms: ['R01'], phase: 'morning', requires: ['briefingSeen'] },
  { lineId: 'room_comm_r12_01', speaker: 'medic', rooms: ['R12b', 'R12c'], phase: 'morning', requires: ['briefingSeen'] },
  { lineId: 'room_comm_r13_01', speaker: 'engineer', rooms: ['R13a', 'R13b', 'R13e'], phase: 'morning', requires: ['briefingSeen'] },
  { lineId: 'room_comm_r14_01', speaker: 'engineer', rooms: ['R14b', 'R14d'], phase: 'morning', requires: ['briefingSeen'] },
  { lineId: 'room_comm_r06_01', speaker: 'engineer', rooms: ['R06'], phase: 'post_drop' },
  { lineId: 'room_comm_r07a_01', speaker: 'medic', rooms: ['R07a'], phase: 'post_drop' },
  { lineId: 'room_comm_r08b_01', speaker: 'player', rooms: ['R08b'], phase: 'post_drop' },
  { lineId: 'room_comm_r16c_01', speaker: 'player', rooms: ['R16c'], phase: 'post_drop' },
];

export const roomCommentaryFlag = (lineId: string): string => `heard_${lineId}`;

export interface BarkDeps {
  lines: readonly BarkLine[];
  speech: BarkSpeech;
  bus: LooseBus;
  /** 0..1 random source (seeded in tests). */
  random?: () => number;
  /** Barks stay quiet (on rails, cutscene, paused). */
  blocked?: () => boolean;
  /** Jay is held: the grab has its own sound, so hits make none. */
  grabbed?: () => boolean;
  rules?: readonly BarkRule[];
  /** Seconds of quiet before an idle bark may play; null disables idle barks. */
  idleAfter?: number | null;
  /** Station phase for idle bark & room commentary gating (defaults to 'morning'). */
  phase?: () => 'morning' | 'post_drop';
  /** Current player room id for one-time contextual room commentary. */
  playerRoom?: () => string | null;
  /** True when a scripted scene belonging to `room` is running. */
  sceneRunning?: (room: string) => boolean;
  /** Save-persisted game flag access for one-time room remarks. */
  flag?: (name: string) => boolean;
  setFlag?: (name: string) => void;
  /** Optional override list of contextual room remarks (defaults to ROOM_COMMENTARY). */
  roomCommentary?: readonly RoomCommentarySpec[];
}

export class BarkSystem {
  /** Seconds since start (driven by `update`). */
  now = 0;
  private readonly d: BarkDeps;
  private readonly pools = new Map<string, BarkLine[]>();
  private readonly lineIds = new Set<string>();
  private readonly ready = new Map<BarkRule, number>();
  private readonly counts = new Map<BarkRule, number[]>();
  private readonly lastLine = new Map<string, string>();
  private readonly offs: Array<() => void> = [];
  private globalReady = 0;
  private lastCombat = -Infinity;
  private quiet = 0;
  private dwellRoom: string | null = null;
  private dwellTime = 0;
  /** The last hit reaction: its tier and when it started. */
  private hurtLast: { tier: number; at: number } | null = null;
  /** The reaction waiting out `HURT_DELAY`. */
  private hurtDue: { id: string; at: number } | null = null;
  private readonly random: () => number;

  constructor(deps: BarkDeps) {
    this.d = deps;
    this.random = deps.random ?? Math.random;
    for (const line of deps.lines) {
      this.lineIds.add(line.id);
      const m = /^bark_(.+)_[^_]+$/.exec(line.id);
      if (!m) continue;
      const pool = m[1]!;
      const list = this.pools.get(pool) ?? [];
      list.push(line);
      this.pools.set(pool, list);
    }
    for (const rule of deps.rules ?? BARK_RULES) {
      const r = rule;
      this.offs.push(deps.bus.on(r.event, (p) => this.fire(r, p)));
    }
    for (const name of COMBAT_EVENTS) this.offs.push(deps.bus.on(name, () => (this.lastCombat = this.now)));
    this.offs.push(
      deps.bus.on('player:damaged', (p) => {
        const hit = p as { kind?: string; severity?: number } | undefined;
        if (hit?.kind !== 'grab' && typeof hit?.severity === 'number') this.hurt(hurtTier(hit.severity));
      }),
      // The hit that downs him draws the heavy cry, whatever its size.
      deps.bus.on('player:downed', () => this.hurt(HURT_LINES.length - 1)),
    );
  }

  /** Jay reacts aloud to a hit of `tier`, a moment after it; a bigger one takes the place of a smaller. */
  private hurt(tier: number): void {
    const id = HURT_LINES[tier]!;
    if (!this.lineIds.has(id) || this.d.blocked?.() || this.d.grabbed?.()) return;
    const last = this.hurtLast;
    if (last && tier <= last.tier && this.now - last.at < HURT_GAP) return;
    if (last) this.d.speech.stop?.(HURT_LINES[last.tier]!);
    this.hurtLast = { tier, at: this.now };
    this.hurtDue = { id, at: this.now + HURT_DELAY };
  }

  /** A fight is on (or ended less than COMBAT_HOLD s ago). Hints stay quiet meanwhile. */
  get inCombat(): boolean {
    return this.now - this.lastCombat < COMBAT_HOLD;
  }

  poolIds(): string[] {
    return [...this.pools.keys()];
  }

  update(dt: number): void {
    this.now += dt;
    if (this.hurtDue && this.now >= this.hurtDue.at - 1e-9) {
      this.d.speech.say(this.hurtDue.id, 'player', { overlap: true });
      this.hurtDue = null;
    }
    const busy = this.d.speech.speaking() !== null || this.inCombat || (this.d.blocked?.() ?? false);
    this.updateRoomCommentary(dt, busy);
    const idleAfter = this.d.idleAfter === undefined ? 60 : this.d.idleAfter;
    if (idleAfter === null) return;
    this.quiet = busy ? 0 : this.quiet + dt;
    if (this.quiet >= idleAfter) {
      this.quiet = 0;
      this.d.bus.emit('bark:idle', {});
    }
  }

  /** Forget cooldowns and combat state (new game, load). */
  reset(): void {
    this.ready.clear();
    this.counts.clear();
    this.globalReady = 0;
    this.lastCombat = -Infinity;
    this.quiet = 0;
    this.dwellRoom = null;
    this.dwellTime = 0;
    this.hurtLast = null;
    this.hurtDue = null;
  }

  dispose(): void {
    for (const off of this.offs) off();
  }

  private updateRoomCommentary(dt: number, busy: boolean): void {
    if (!this.d.playerRoom || !this.d.flag || !this.d.setFlag) return;
    const room = this.d.playerRoom();
    if (room !== this.dwellRoom) {
      this.dwellRoom = room;
      this.dwellTime = 0;
    }
    if (!room || busy || this.d.sceneRunning?.(room)) return;
    this.dwellTime += dt;
    if (this.dwellTime < ROOM_COMMENTARY_DWELL_S || this.now < this.globalReady) return;
    const phase = this.d.phase?.() ?? 'morning';
    const specs = this.d.roomCommentary ?? ROOM_COMMENTARY;
    for (const spec of specs) {
      if (spec.phase !== phase || !spec.rooms.includes(room)) continue;
      if (!this.lineIds.has(spec.lineId)) continue;
      const flag = roomCommentaryFlag(spec.lineId);
      if (this.d.flag(flag)) continue;
      if (spec.requires && !spec.requires.every((f) => this.d.flag!(f))) continue;
      this.d.setFlag(flag);
      this.globalReady = this.now + GLOBAL_COOLDOWN;
      this.quiet = 0;
      this.d.speech.say(spec.lineId, spec.speaker);
      return;
    }
  }

  /** Try a rule for an event. Returns the line id said, or null. Public for tests. */
  fire(rule: BarkRule, payload: unknown): string | null {
    const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    if (rule.when && !rule.when(p)) return null;
    if (rule.count) {
      const list = (this.counts.get(rule) ?? []).filter((t) => this.now - t <= rule.count!.within);
      list.push(this.now);
      this.counts.set(rule, list);
      if (list.length < rule.count.n) return null;
    }
    if (this.d.blocked?.()) return null;
    if (this.now < (this.ready.get(rule) ?? 0)) return null;
    if (!rule.reaction && this.now < this.globalReady) return null;
    const speaking = this.d.speech.speaking();
    // A story or hint line is up: a bark would only be dropped (or worse, queued). Skip it.
    if (speaking && (speaking.priority === 'story' || speaking.priority === 'hint') && !rule.reaction) return null;
    if (rule.chance !== undefined && this.random() >= rule.chance) return null;
    const poolName = rule.pool === 'idle' && this.d.phase?.() === 'post_drop' ? 'idle_dark' : rule.pool;
    const line = this.pick(poolName, rule, p);
    if (!line) return null;
    this.ready.set(rule, this.now + rule.cooldown);
    if (!rule.reaction) this.globalReady = this.now + GLOBAL_COOLDOWN;
    if (rule.count) this.counts.set(rule, []);
    this.lastLine.set(poolName, line.id);
    this.d.speech.say(line.id, line.speaker);
    return line.id;
  }

  private pick(poolName: string, rule: BarkRule, p: Record<string, unknown>): BarkLine | null {
    const pool = this.pools.get(poolName);
    if (!pool?.length) return null;
    const who = rule.who ?? 'any';
    const about = whoOf(p);
    let speakers: readonly string[] | null;
    switch (who) {
      case 'self':
        speakers = about ? [about] : SQUAD;
        break;
      case 'other':
        speakers = about ? SQUAD.filter((s) => s !== about) : SQUAD;
        break;
      case 'squad':
        speakers = SQUAD;
        break;
      case 'any':
        speakers = null;
        break;
      default:
        speakers = [who];
    }
    let options = speakers ? pool.filter((l) => speakers!.includes(l.speaker)) : [...pool];
    if (options.length === 0) return null;
    const last = this.lastLine.get(poolName);
    if (options.length > 1) options = options.filter((l) => l.id !== last);
    return options[Math.floor(this.random() * options.length) % options.length] ?? null;
  }
}
