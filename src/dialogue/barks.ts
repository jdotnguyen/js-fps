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
  say(lineId: string, speaker: string): void;
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
  { event: 'squad:taskProgress', pool: 'task', cooldown: 14, who: 'engineer', chance: 0.7 },
  { event: 'bark:idle', pool: 'idle', cooldown: 90, who: 'squad' },
];

export const GLOBAL_COOLDOWN = 3;
/** Seconds after the last combat event that still count as "in combat". */
export const COMBAT_HOLD = 8;
/** Events that mean a fight is on. */
const COMBAT_EVENTS = ['enemy:spotted', 'enemy:alerted', 'enemy:hit', 'enemy:attack', 'enemy:grab', 'player:damaged', 'player:grabbed', 'weapon:fired', 'combat:first', 'squad:downed'];

export interface BarkDeps {
  lines: readonly BarkLine[];
  speech: BarkSpeech;
  bus: LooseBus;
  /** 0..1 random source (seeded in tests). */
  random?: () => number;
  /** Barks stay quiet (on rails, cutscene, paused). */
  blocked?: () => boolean;
  rules?: readonly BarkRule[];
  /** Seconds of quiet before an idle bark may play; null disables idle barks. */
  idleAfter?: number | null;
}

export class BarkSystem {
  /** Seconds since start (driven by `update`). */
  now = 0;
  private readonly d: BarkDeps;
  private readonly pools = new Map<string, BarkLine[]>();
  private readonly ready = new Map<BarkRule, number>();
  private readonly counts = new Map<BarkRule, number[]>();
  private readonly lastLine = new Map<string, string>();
  private readonly offs: Array<() => void> = [];
  private globalReady = 0;
  private lastCombat = -Infinity;
  private quiet = 0;
  private readonly random: () => number;

  constructor(deps: BarkDeps) {
    this.d = deps;
    this.random = deps.random ?? Math.random;
    for (const line of deps.lines) {
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
    const idleAfter = this.d.idleAfter === undefined ? 60 : this.d.idleAfter;
    if (idleAfter === null) return;
    const busy = this.d.speech.speaking() !== null || this.inCombat || (this.d.blocked?.() ?? false);
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
  }

  dispose(): void {
    for (const off of this.offs) off();
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
    const line = this.pick(rule, p);
    if (!line) return null;
    this.ready.set(rule, this.now + rule.cooldown);
    if (!rule.reaction) this.globalReady = this.now + GLOBAL_COOLDOWN;
    if (rule.count) this.counts.set(rule, []);
    this.lastLine.set(rule.pool, line.id);
    this.d.speech.say(line.id, line.speaker);
    return line.id;
  }

  private pick(rule: BarkRule, p: Record<string, unknown>): BarkLine | null {
    const pool = this.pools.get(rule.pool);
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
    const last = this.lastLine.get(rule.pool);
    if (options.length > 1) options = options.filter((l) => l.id !== last);
    return options[Math.floor(this.random() * options.length) % options.length] ?? null;
  }
}
