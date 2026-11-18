/**
 * Squad behaviour pieces for ADR-0011 steps 3-7, kept free of three.js bodies so they test
 * headless: target choice with role preferences, the kill-share guard, panel tasks with
 * pause/resume, revives, and the downed timers. `squad.ts` owns the bodies and calls these.
 */
import type { P3 } from './nav.ts';

export type SquadId = 'engineer' | 'medic';
/** Where a squad shot lands. Support role: legs cripple, arms save (ADR-0011). */
export type SquadAim = 'legs' | 'arms' | 'torso';

/**
 * What the squad needs to know about one live enemy. The enemy AI (ADR-0007) provides these;
 * `squad.setEnemies(source)` wires its list in. Positions are feet positions.
 */
export interface SquadEnemy {
  readonly id: string;
  readonly position: P3;
  readonly alive: boolean;
  /** Who it has grabbed: 'player', a squad id, or null. */
  readonly grabbing?: string | null;
  /** Legs gone (crawler/dragger): no point aiming at legs. */
  readonly crawling?: boolean;
  readonly hero?: boolean;
}

export interface SquadEnemySource {
  list(): readonly SquadEnemy[];
  /** Apply one squad shot. Returns true if it killed the enemy. */
  shoot(id: string, aim: SquadAim, damage: number, from: P3): boolean;
  /** A grabbed squadmate shoves the grabber off (no struggle for NPCs). */
  shove?(id: string, from: P3): void;
}

export const COMBAT = {
  /** Engage enemies within this range that they can see. */
  engageRange: 14,
  /** Player pistol: 18 damage, 0.18 s interval (viewmodel). Squad fires at ~55% of that rate. */
  playerDamage: 18,
  fireInterval: 0.33,
  magazine: 10,
  reload: 2.2,
  /** ADR-0011 kill-share guard: squad kills above this share of the fight halve their damage. */
  killShare: 0.35,
  /** No enemy engaged for this long: the fight is over and the kill tally resets. */
  fightGap: 8,
  /** Back off when an enemy is this close (Giles / Okafor). */
  backoff: { engineer: 2, medic: 4 } as Record<SquadId, number>,
  /** The medic keeps 4-8 m behind Jay in a fight. */
  medicBehind: [4, 8] as const,
  /** Keep the current target unless another scores this much better. */
  stickiness: 0.6,
} as const;

/** Kill-share guard (invisible to the player). */
export class KillShare {
  player = 0;
  squad = 0;
  private quietT = 0;

  record(by: 'player' | 'squad'): void {
    if (by === 'player') this.player++;
    else this.squad++;
    this.quietT = 0;
  }

  /** True while the squad has more than its share of this fight's kills. */
  get guard(): boolean {
    const total = this.player + this.squad;
    return total > 0 && this.squad / total > COMBAT.killShare;
  }

  /** Damage factor for the next squad shot. */
  get factor(): number {
    return this.guard ? 0.5 : 1;
  }

  /** Call every step with whether anyone is fighting; a long lull ends the fight. */
  update(dt: number, fighting: boolean): void {
    if (fighting) {
      this.quietT = 0;
      return;
    }
    this.quietT += dt;
    if (this.quietT >= COMBAT.fightGap && this.player + this.squad > 0) {
      this.player = 0;
      this.squad = 0;
    }
  }
}

export interface TargetContext {
  me: P3;
  role: SquadId;
  player: P3;
  medic: P3;
  engineer: P3;
  /** Giles is working a panel (enemies near him matter more). */
  engineerWorking: boolean;
  /** Current target id, for stickiness. */
  current: string | null;
  /** Line of sight from this mate to an enemy. */
  canSee(e: SquadEnemy): boolean;
}

const dist = (a: P3, b: P3): number => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Score every visible enemy; highest wins. Threats to Jay, the working engineer and the medic
 * come first; the medic prioritises grabbers (ADR-0011 roles).
 */
export function scoreTarget(e: SquadEnemy, c: TargetContext): number {
  if (!e.alive) return -Infinity;
  const d = dist(e.position, c.me);
  if (d > COMBAT.engageRange) return -Infinity;
  let s = 1 - d / COMBAT.engageRange;
  if (e.grabbing) s += c.role === 'medic' ? 4 : 3;
  if (e.grabbing === 'player') s += 0.5;
  const toPlayer = dist(e.position, c.player);
  if (toPlayer < 4) s += 1.5 * (1 - toPlayer / 4) + 0.5;
  const toMedic = dist(e.position, c.medic);
  if (toMedic < 4) s += 1.2 * (1 - toMedic / 4);
  if (c.engineerWorking) {
    const toEng = dist(e.position, c.engineer);
    if (toEng < 5) s += 1.4 * (1 - toEng / 5) + 0.3;
  }
  if (e.id === c.current) s += COMBAT.stickiness;
  return s;
}

export function pickTarget(enemies: readonly SquadEnemy[], c: TargetContext): SquadEnemy | null {
  let best: SquadEnemy | null = null;
  let bestScore = -Infinity;
  for (const e of enemies) {
    const s = scoreTarget(e, c);
    if (s === -Infinity || s <= bestScore || !c.canSee(e)) continue;
    best = e;
    bestScore = s;
  }
  return best;
}

/** Support role: Giles cripples (legs), Okafor saves (arms); grabbers get the arms; crawlers the torso. */
export function aimFor(role: SquadId, e: SquadEnemy): SquadAim {
  if (e.grabbing) return 'arms';
  if (role === 'engineer') return e.crawling ? 'torso' : 'legs';
  return 'arms';
}

// ------------------------------------------------------------------ tasks (Giles, Okafor)

/** Task durations in seconds (ADR-0011; brief: bypass 20 s, power 30 s; biometric 5 s). */
export const TASKS: Readonly<Record<string, { duration: number; who: SquadId; pose: string }>> = {
  bypass_short: { duration: 8, who: 'engineer', pose: 'crouchWork' },
  bypass_long: { duration: 20, who: 'engineer', pose: 'crouchWork' },
  bypass: { duration: 20, who: 'engineer', pose: 'crouchWork' },
  power_restore: { duration: 30, who: 'engineer', pose: 'typing' },
  reroute: { duration: 12, who: 'engineer', pose: 'typing' },
  unlock_locker: { duration: 6, who: 'engineer', pose: 'crouchWork' },
  biometric: { duration: 5, who: 'medic', pose: 'typing' },
};

/** An enemy within this of the worker pauses the task (he calls for help and defends). */
export const TASK_THREAT = 3;

export type TaskState = 'walking' | 'working' | 'paused' | 'done';

export interface TaskEvents {
  progress(task: SquadTask): void;
  paused(task: SquadTask): void;
  resumed(task: SquadTask): void;
  done(task: SquadTask): void;
}

/** One panel job. Progress never resets (ADR-0011). */
export class SquadTask {
  readonly kind: string;
  readonly who: SquadId;
  readonly duration: number;
  readonly pose: string;
  /** Where to stand; null works on the spot. */
  readonly at: P3 | null;
  readonly yaw: number | undefined;
  /** Panel or door id the HUD/level shows progress on. */
  readonly panel: string | null;
  progress = 0;
  state: TaskState = 'walking';
  private reported = 0;
  private readonly ev: Partial<TaskEvents>;
  private readonly finished: Array<() => void> = [];

  constructor(kind: string, opts: { at?: P3 | null; yaw?: number; panel?: string | null; duration?: number; who?: SquadId }, ev: Partial<TaskEvents> = {}) {
    const def = TASKS[kind];
    this.kind = kind;
    this.who = opts.who ?? def?.who ?? 'engineer';
    this.duration = opts.duration ?? def?.duration ?? 10;
    this.pose = def?.pose ?? 'crouchWork';
    this.at = opts.at ?? null;
    this.yaw = opts.yaw;
    this.panel = opts.panel ?? null;
    this.ev = ev;
  }

  get done(): boolean {
    return this.state === 'done';
  }

  whenDone(fn: () => void): void {
    if (this.done) fn();
    else this.finished.push(fn);
  }

  /** Reached the panel. */
  arrive(): void {
    if (this.state === 'walking') this.state = 'working';
  }

  /**
   * One step. `threat` is whether an enemy is within TASK_THREAT of the worker; `able` is
   * false while he is downed or busy defending.
   */
  update(dt: number, threat: boolean, able = true): void {
    if (this.state === 'done' || this.state === 'walking') return;
    if (this.state === 'working' && (threat || !able)) {
      this.state = 'paused';
      this.ev.paused?.(this);
      return;
    }
    if (this.state === 'paused') {
      if (threat || !able) return;
      this.state = 'working';
      this.ev.resumed?.(this);
    }
    this.progress = Math.min(1, this.progress + dt / this.duration);
    // Progress events every 10 %, for the panel screen and barks.
    const step = Math.floor(this.progress * 10);
    if (step > this.reported) {
      this.reported = step;
      if (this.progress < 1) this.ev.progress?.(this);
    }
    if (this.progress >= 1) this.finish();
  }

  /** Skip end state, or a debug complete. */
  finish(): void {
    if (this.state === 'done') return;
    this.progress = 1;
    this.state = 'done';
    this.ev.progress?.(this);
    this.ev.done?.(this);
    for (const fn of this.finished.splice(0)) fn();
  }
}

// ------------------------------------------------------------------ revive and downed

export const REVIVE = {
  duration: 3,
  /** A hit pauses the revive for this long. */
  hitPause: 0.6,
  /** Close enough to kneel. */
  reach: 1.1,
  /** Giles is only revived when no enemy is this close to Okafor. */
  safeRadius: 6,
  /** Giles gets up on his own after this, at half health. */
  engineerDowned: 6,
  maxHp: 100,
} as const;

/** A revive in progress (Okafor on Jay or Giles). Being hit pauses it; progress is kept. */
export class ReviveJob {
  readonly target: 'player' | 'engineer';
  progress = 0;
  private pauseT = 0;

  constructor(target: 'player' | 'engineer') {
    this.target = target;
  }

  hit(): void {
    this.pauseT = REVIVE.hitPause;
  }

  get paused(): boolean {
    return this.pauseT > 0;
  }

  /** Returns true when the revive completes. `kneeling` is false while still walking over. */
  update(dt: number, kneeling: boolean): boolean {
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return false;
    }
    if (!kneeling) return false;
    this.progress = Math.min(1, this.progress + dt / REVIVE.duration);
    return this.progress >= 1;
  }
}

/**
 * The ADR-0011 failure rule: if the medic is down when Jay goes down, nobody can revive him
 * and it is game over.
 */
export function playerDownIsGameOver(medicDowned: boolean): boolean {
  return medicDowned;
}

/** Enemy target weights (ADR-0011) for the enemy AI to read: player 1.0 is the enemy side's. */
export function enemyWeight(id: SquadId, opts: { reviving: boolean; working: boolean; downed: boolean }): number {
  if (opts.downed) return 0.3;
  if (id === 'medic') return opts.reviving ? 1.0 : 0.7;
  return opts.working ? 0.9 : 0.6;
}

// ------------------------------------------------------------------ reveal ladder

/** What each `giles.infectionStage` does (ADR-0022 ladder). `reveal` is stage 4. */
export const INFECTION_LADDER: ReadonlyArray<{ rasp: number; laugh: boolean; gestures: readonly string[]; gestureEvery: number }> = [
  { rasp: 0, laugh: true, gestures: ['rub_forearm'], gestureEvery: 55 },
  { rasp: 0, laugh: true, gestures: ['rub_forearm', 'flex_hand'], gestureEvery: 40 },
  { rasp: 0.25, laugh: true, gestures: ['flex_hand', 'rub_forearm'], gestureEvery: 32 },
  { rasp: 0.45, laugh: true, gestures: ['cough', 'flex_hand', 'rub_forearm'], gestureEvery: 24 },
  { rasp: 0.6, laugh: false, gestures: [], gestureEvery: Infinity },
];

export function ladderStage(stage: number): (typeof INFECTION_LADDER)[number] {
  const i = Math.max(0, Math.min(INFECTION_LADDER.length - 1, Math.floor(stage)));
  return INFECTION_LADDER[i]!;
}
