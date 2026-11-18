import type { TutorialMode } from '../core/settings.ts';
import type { KeyValueStore } from '../core/storage.ts';
import { ACTIONS, type Action } from '../data/types/keymap.ts';

/**
 * Tutorial prompts (ADR-0025), the pure part: which pop-up is due, the queue that holds
 * them while the player is on rails, "seen" state and dismissal. No DOM here, so it runs
 * in Node tests; `tutorialPrompts.ts` draws it and wires it to the game.
 */

export { TUTORIAL_MODES, type TutorialMode } from '../core/settings.ts';

/** `look` is mouse movement: it has no keymap entry. */
export type PromptInput = Action | 'look';

export interface PromptGroup {
  /** Any of these dismisses the prompt. */
  actions: readonly PromptInput[];
  /** "to move", "to fire". */
  verb: string;
}

export interface PromptDef {
  id: PromptId;
  title: string;
  /** Decorative glyph (aria-hidden). */
  icon: string;
  groups: readonly PromptGroup[];
  /** Queued straight after this one is dismissed (Move -> Look). */
  next?: PromptId;
}

export const PROMPT_IDS = ['move', 'look', 'interact', 'flashlight', 'combat'] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

export const PROMPTS: Readonly<Record<PromptId, PromptDef>> = {
  move: { id: 'move', title: 'Move', icon: '✥', groups: [{ actions: ['moveForward', 'moveLeft', 'moveBack', 'moveRight'], verb: 'move' }], next: 'look' },
  look: { id: 'look', title: 'Look', icon: '◎', groups: [{ actions: ['look'], verb: 'look around' }] },
  interact: { id: 'interact', title: 'Interact', icon: '◇', groups: [{ actions: ['interact'], verb: 'use what you are looking at' }] },
  flashlight: { id: 'flashlight', title: 'Flashlight', icon: '☼', groups: [{ actions: ['flashlight'], verb: 'switch your flashlight on or off' }] },
  // One pop-up for both: first contact is no time for two blocking prompts. Either key dismisses it.
  combat: {
    id: 'combat',
    title: 'Fire / Reload',
    icon: '⌖',
    groups: [
      { actions: ['fire'], verb: 'fire' },
      { actions: ['reload'], verb: 'reload' },
    ],
  },
};

/** Non-blocking hints (ADR-0025 "not forced"), keyed by action name. */
export interface HintDef {
  id: string;
  action: string;
  title: string;
  verb: string;
  /** Held actions read "Hold", others "Press". */
  hold: boolean;
}

export const HINTS: Readonly<Record<string, HintDef>> = {
  sprint: { id: 'hint:sprint', action: 'sprint', title: 'Sprint', verb: 'sprint', hold: true },
  // No crouch action in the keymap yet (ADR-0004): the hint stays silent until one is bound.
  crouch: { id: 'hint:crouch', action: 'crouch', title: 'Crouch', verb: 'crouch', hold: false },
};

/** Seconds a hint stays up unless its action is pressed first. */
export const HINT_SECONDS = 6;

export function isAction(name: string): name is Action {
  return (ACTIONS as readonly string[]).includes(name);
}

/** Short label for a key code: KeyW -> W, Mouse0 -> LMB. */
export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return (
    {
      Mouse0: 'LMB',
      Mouse1: 'MMB',
      Mouse2: 'RMB',
      ShiftLeft: 'Shift',
      ShiftRight: 'Shift',
      ControlLeft: 'Ctrl',
      ControlRight: 'Ctrl',
      AltLeft: 'Alt',
      AltRight: 'Alt',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
    }[code] ?? code
  );
}

/** The player's current binding (first key of each action), never a hardcoded key. */
export type Bindings = (action: Action) => readonly string[];

/** Labels for an input: the first bound key, "Mouse" for look; null when unbound. */
export function inputLabel(input: PromptInput, bindings: Bindings): string | null {
  if (input === 'look') return 'Mouse';
  const code = bindings(input)[0];
  return code === undefined ? null : codeLabel(code);
}

export interface DescribedGroup {
  keys: string[];
  text: string;
}

function orList(keys: string[]): string {
  if (keys.length <= 1) return keys[0] ?? '';
  return `${keys.slice(0, -1).join(', ')} or ${keys[keys.length - 1]}`;
}

/** What the pop-up shows and announces, built from the current bindings. */
export function describePrompt(def: PromptDef, bindings: Bindings): { groups: DescribedGroup[]; sentence: string } {
  const groups = def.groups.map((g) => {
    const keys = g.actions.map((a) => inputLabel(a, bindings) ?? 'Unbound');
    const text = g.actions.length === 1 && g.actions[0] === 'look' ? `Move the mouse to ${g.verb}.` : `Press ${orList(keys)} to ${g.verb}.`;
    return { keys, text };
  });
  return { groups, sentence: `${def.title}. ${groups.map((g) => g.text).join(' ')}` };
}

/** Hint text, or null when the action has no binding (the hint is then skipped). */
export function describeHint(def: HintDef, bindings: Bindings): { key: string; text: string } | null {
  if (!isAction(def.action)) return null;
  const code = bindings(def.action)[0];
  if (code === undefined) return null;
  const key = codeLabel(code);
  return { key, text: `${def.hold ? 'Hold' : 'Press'} ${key} to ${def.verb}.` };
}

/** "Seen" tutorials, per profile (ADR-0016). */
export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
  clear(): void;
}

export const PROFILE_KEY = 'js-fps:profile:v1';

/**
 * The player profile (ADR-0016: versioned JSON in localStorage). There is one profile per
 * browser for now; it holds what outlives a playthrough, starting with `tutorialsSeen`.
 */
export class TutorialProfile implements SeenStore {
  private readonly store: KeyValueStore;
  private readonly key: string;
  private seen: Set<string>;

  constructor(store: KeyValueStore, key = PROFILE_KEY) {
    this.store = store;
    this.key = key;
    this.seen = new Set(TutorialProfile.parse(store.get(key)));
  }

  static parse(raw: string | null): string[] {
    if (raw === null) return [];
    try {
      const data: unknown = JSON.parse(raw);
      if (typeof data !== 'object' || data === null) return [];
      const list = (data as Record<string, unknown>)['tutorialsSeen'];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return []; // damaged profile: tutorials show again, nothing else breaks
    }
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.save();
  }

  clear(): void {
    this.seen = new Set();
    this.save();
  }

  private save(): void {
    let other: Record<string, unknown> = {};
    try {
      const raw = this.store.get(this.key);
      const data: unknown = raw === null ? null : JSON.parse(raw);
      if (typeof data === 'object' && data !== null) other = data as Record<string, unknown>;
    } catch {
      other = {};
    }
    this.store.set(this.key, JSON.stringify({ ...other, version: 1, tutorialsSeen: [...this.seen] }));
  }
}

/** What the game tells the queue each fixed step. */
export interface TutorialStepInput {
  /** On rails or a cutscene running: nothing opens (ADR-0025). */
  onRails: boolean;
  /** Edge this step. */
  pressed: (action: Action) => boolean;
  /** The mouse moved enough since the last step. */
  looked: boolean;
}

export interface TutorialStepResult {
  opened: PromptDef | null;
  dismissed: PromptDef | null;
  hintShown: HintDef | null;
  hintHidden: HintDef | null;
}

/**
 * The prompt queue. Triggers queue a prompt (if the setting and "seen" state allow it);
 * `step` opens the next one when the player has control, and dismisses the open one only
 * when one of its named inputs is pressed. A dismissal step never opens the next prompt,
 * so the dismissing press also reaches the game that same step (ADR-0025: pressing the
 * action performs it).
 */
export class TutorialQueue {
  current: PromptDef | null = null;
  hint: HintDef | null = null;
  private readonly seen: SeenStore;
  private readonly mode: () => TutorialMode;
  private readonly bindings: Bindings;
  private queue: PromptId[] = [];
  private hintQueue: HintDef[] = [];
  private hintTime = 0;
  /** Queued or shown this run, so "Always" still shows each once per playthrough. */
  private readonly session = new Set<string>();

  constructor(seen: SeenStore, mode: () => TutorialMode, bindings: Bindings) {
    this.seen = seen;
    this.mode = mode;
    this.bindings = bindings;
  }

  /** A blocking pop-up is open: the simulation waits. */
  get blocking(): boolean {
    return this.current !== null;
  }

  get pending(): readonly PromptId[] {
    return this.queue;
  }

  /** New game, load or back to the title: nothing carries over. */
  newRun(): void {
    this.current = null;
    this.hint = null;
    this.queue = [];
    this.hintQueue = [];
    this.session.clear();
  }

  /** "Reset tutorials": forget the profile's seen list. */
  reset(): void {
    this.seen.clear();
    this.session.clear();
  }

  private allowed(id: string): boolean {
    const mode = this.mode();
    if (mode === 'off' || this.session.has(id)) return false;
    return mode === 'always' || !this.seen.has(id);
  }

  /** Returns whether it was queued. */
  trigger(id: PromptId): boolean {
    if (!this.allowed(id)) return false;
    this.session.add(id);
    this.queue.push(id);
    return true;
  }

  /** Non-blocking hint by action name (`tutorial:hint`). Unknown names are ignored. */
  triggerHint(action: string): boolean {
    const def = HINTS[action];
    if (!def || !this.allowed(def.id) || !describeHint(def, this.bindings)) return false;
    this.session.add(def.id);
    this.hintQueue.push(def);
    return true;
  }

  step(dt: number, input: TutorialStepInput): TutorialStepResult {
    const out: TutorialStepResult = { opened: null, dismissed: null, hintShown: null, hintHidden: null };
    if (this.mode() === 'off') {
      // Switched off mid-run: drop what is waiting (an open pop-up still needs its key).
      this.queue = [];
      this.hintQueue = [];
    }
    const cur = this.current;
    if (cur) {
      const hit = cur.groups.some((g) => g.actions.some((a) => (a === 'look' ? input.looked : input.pressed(a))));
      if (hit) {
        this.current = null;
        this.seen.add(cur.id);
        // Look follows Move before anything else that is waiting.
        if (cur.next && this.allowed(cur.next)) {
          this.session.add(cur.next);
          this.queue.unshift(cur.next);
        }
        out.dismissed = cur;
      }
    } else if (!input.onRails && this.queue.length > 0) {
      const id = this.queue.shift();
      if (id !== undefined) {
        this.current = PROMPTS[id];
        out.opened = this.current;
      }
    }

    // Hints: never over a pop-up or on rails; gone after a while or once used.
    if (this.hint) {
      this.hintTime -= dt;
      const used = isAction(this.hint.action) && input.pressed(this.hint.action);
      if (used || this.hintTime <= 0) {
        out.hintHidden = this.hint;
        this.hint = null;
      }
    } else if (!this.current && !input.onRails && this.hintQueue.length > 0) {
      const next = this.hintQueue.shift();
      if (next) {
        this.hint = next;
        this.hintTime = HINT_SECONDS;
        this.seen.add(next.id);
        out.hintShown = next;
      }
    }
    return out;
  }
}
