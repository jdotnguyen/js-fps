import type { KeyValueStore } from '../core/storage.ts';
import { arr, bool, nullable, num, numRange, obj, oneOf, record, scalar, str, validate, vec3, type Infer } from '../core/validate.ts';
import { DIFFICULTY_IDS } from '../data/types/difficulty.ts';

/** Save system (ADR-0016): 3 slots, each with its latest autosave and last manual save. */
export const SAVE_VERSION = 3;
export const SLOT_COUNT = 3;
export const SAVE_KINDS = ['auto', 'manual'] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];

const saveShape = {
  version: num,
  kind: oneOf(SAVE_KINDS),
  slot: numRange(0, SLOT_COUNT - 1),
  savedAt: str,
  playTime: numRange(0, 1e9),
  difficulty: oneOf(DIFFICULTY_IDS),
  chapter: str,
  level: str,
  checkpoint: nullable(str),
  location: str,
  player: obj({ position: vec3, yaw: num, pitch: num, health: numRange(0, 1000), flashlightOn: bool }),
  flags: record(scalar),
  /** Key items held (ADR-0024), ids from data/items.json. Added in v2. */
  items: arr(str),
  /** Map knowledge per level id (ADR-0024): rooms walked and areas revealed. Added in v3. */
  map: record(obj({ seen: arr(str), revealed: arr(str) })),
};

export type SaveData = Infer<typeof saveShape>;
const validateSave = obj(saveShape);

/**
 * MIGRATIONS[n] converts a version-n save object into version n+1.
 * Add an entry (and bump SAVE_VERSION) whenever the schema changes.
 */
export const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // v2 (ADR-0024): key items. Older saves hold none.
  1: (old) => ({ ...old, items: [] }),
  // v3 (ADR-0024): map state. Older saves have walked nothing yet.
  2: (old) => ({ ...old, map: {} }),
};

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Parse, migrate and validate a stored save. Throws SaveError/ValidationError. */
export function parseSave(raw: string, source: string, migrations = MIGRATIONS, current = SAVE_VERSION): SaveData {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SaveError(`${source}: not valid JSON`);
  }
  if (typeof data !== 'object' || data === null) throw new SaveError(`${source}: not an object`);
  let obj = data as Record<string, unknown>;
  let version = typeof obj['version'] === 'number' ? obj['version'] : 0;
  if (version > current) throw new SaveError(`${source}: made by a newer version of the game (v${version})`);
  while (version < current) {
    const step = migrations[version];
    if (!step) throw new SaveError(`${source}: no migration from v${version}`);
    obj = { ...step(obj), version: version + 1 };
    version++;
  }
  return validate(validateSave, obj, source);
}

export interface SaveEntry {
  data: SaveData | null;
  /** Present when something is stored but cannot be loaded. */
  error: string | null;
}

export interface SlotSummary {
  slot: number;
  auto: SaveEntry;
  manual: SaveEntry;
  /** The newer of auto/manual, if any loads. */
  latest: SaveData | null;
  empty: boolean;
}

export class SaveStore {
  private readonly store: KeyValueStore;
  private readonly ns: string;

  constructor(store: KeyValueStore, namespace = 'js-fps:save') {
    this.store = store;
    this.ns = namespace;
  }

  key(slot: number, kind: SaveKind): string {
    return `${this.ns}:slot${slot}:${kind}`;
  }

  read(slot: number, kind: SaveKind): SaveEntry {
    const raw = this.store.get(this.key(slot, kind));
    if (raw === null) return { data: null, error: null };
    try {
      return { data: parseSave(raw, `slot ${slot + 1} ${kind}`), error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  write(save: SaveData): void {
    this.store.set(this.key(save.slot, save.kind), JSON.stringify(save));
    this.store.set(`${this.ns}:lastSlot`, String(save.slot));
  }

  clearSlot(slot: number): void {
    for (const kind of SAVE_KINDS) this.store.remove(this.key(slot, kind));
    this.store.remove(this.seenKey(slot));
  }

  private seenKey(slot: number): string {
    return `${this.ns}:slot${slot}:seen`;
  }

  /** Cutscenes watched to the end in this slot (sequence `skippableAfter`): beside the saves, never rolled back by one. */
  seen(slot: number): Set<string> {
    const raw = this.store.get(this.seenKey(slot));
    if (!raw) return new Set();
    try {
      const v = JSON.parse(raw) as unknown;
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  markSeen(slot: number, id: string): void {
    const s = this.seen(slot);
    if (s.has(id)) return;
    s.add(id);
    this.store.set(this.seenKey(slot), JSON.stringify([...s]));
  }

  summary(slot: number): SlotSummary {
    const auto = this.read(slot, 'auto');
    const manual = this.read(slot, 'manual');
    const loadable = [auto.data, manual.data].filter((d): d is SaveData => d !== null);
    loadable.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return {
      slot,
      auto,
      manual,
      latest: loadable[0] ?? null,
      empty: auto.data === null && manual.data === null && auto.error === null && manual.error === null,
    };
  }

  summaries(): SlotSummary[] {
    return Array.from({ length: SLOT_COUNT }, (_, i) => this.summary(i));
  }

  /** Most recent loadable save across all slots (for Continue). */
  latest(): SaveData | null {
    const all = this.summaries()
      .map((s) => s.latest)
      .filter((d): d is SaveData => d !== null);
    all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return all[0] ?? null;
  }

  /** First empty slot, or null if all are used. */
  firstEmptySlot(): number | null {
    const s = this.summaries().find((x) => x.empty);
    return s ? s.slot : null;
  }
}

/** "1:02:03" or "12:03". */
export function formatPlayTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
