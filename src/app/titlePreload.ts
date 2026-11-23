/**
 * Holds what the title prepared for the next session (openspec `preload-during-title`, title-preload spec).
 *
 * One promise per named item, not finished values: a session that starts while an item is still running awaits
 * that work instead of starting it again. Each item belongs to a group that decides what invalidates it:
 *  - `shared`: valid for any level, quality and GPU (engines, models, sounds);
 *  - `quality`: valid for one graphics quality (textures);
 *  - `level`: valid for one level, quality and GPU (validated level data, the built world, the navmesh).
 */
export type PreloadGroup = 'shared' | 'quality' | 'level';

/** What a prepared result was made for. `gpu` is a stable string of the GPU limits that shaped it. */
export interface PreloadKey {
  readonly levelId: string;
  readonly quality: string;
  readonly gpu: string;
}

interface Entry {
  readonly group: PreloadGroup;
  readonly promise: Promise<unknown>;
  /** Frees a result nobody adopted; cleared once the entry is dropped or taken. */
  release: ((value: unknown) => void) | undefined;
}

export interface TitlePreloadOptions {
  /** Where failures are reported. Defaults to `console.warn`. */
  warn?: (message: string, error: unknown) => void;
}

export class TitlePreload {
  private key: PreloadKey;
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  private readonly warn: (message: string, error: unknown) => void;

  constructor(key: PreloadKey, options: TitlePreloadOptions = {}) {
    this.key = key;
    this.warn = options.warn ?? ((m, e) => console.warn(m, e));
  }

  get current(): PreloadKey {
    return this.key;
  }

  has(item: string): boolean {
    return this.entries.has(item);
  }

  /** Whether `take(item, key, …)` would hand over a prepared result (rather than run its fallback). */
  available(item: string, key: PreloadKey): boolean {
    const entry = this.entries.get(item);
    return !!entry && !this.disposed && this.valid(entry.group, key);
  }

  /** The in-flight or finished result of `item` without taking it, for an item that builds on another. Null if absent. */
  peek<T>(item: string): Promise<T> | null {
    return (this.entries.get(item)?.promise as Promise<T> | undefined) ?? null;
  }

  /**
   * Start preparing `item`. Does nothing if it is already running, finished or held, or if the holder was disposed,
   * so callers can arm the same item more than once. `release` frees a result nobody will adopt.
   */
  start<T>(item: string, group: PreloadGroup, run: () => Promise<T>, release?: (value: T) => void): void {
    if (this.disposed || this.entries.has(item)) return;
    const entry: Entry = {
      group,
      release: release as ((value: unknown) => void) | undefined,
      promise: undefined as unknown as Promise<unknown>,
    };
    let promise: Promise<T>;
    try {
      promise = run();
    } catch (error) {
      promise = Promise.reject(error);
    }
    const tracked = promise.then(
      (value) => value,
      (error: unknown) => {
        // A failed item is forgotten so the next take builds it the normal way; the real error then shows once.
        if (this.entries.get(item) === entry) this.entries.delete(item);
        this.warn(`[title-preload] ${item} failed; the load will build it`, error);
        throw error;
      },
    );
    tracked.catch(() => undefined); // reported above; avoids an unhandled rejection when nobody takes it
    (entry as { promise: Promise<unknown> }).promise = tracked;
    this.entries.set(item, entry);
  }

  /**
   * Hand `item` to a session. Returns the prepared (or in-flight) result when it is valid for `key`, and otherwise
   * runs `fallback`, so a missing, mismatched or failed item loads exactly as it did before preparation existed.
   * A taken item belongs to the caller: the holder no longer releases it.
   */
  take<T>(item: string, key: PreloadKey, fallback: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(item);
    if (!entry || this.disposed || !this.valid(entry.group, key)) return fallback();
    this.entries.delete(item);
    entry.release = undefined;
    return (entry.promise as Promise<T>).catch(() => fallback());
  }

  /** The graphics quality changed on the title: quality and level results made for the old one are released. */
  setQuality(quality: string): void {
    if (quality === this.key.quality) return;
    this.key = { ...this.key, quality };
    this.drop('quality');
    this.drop('level');
  }

  /** Release every item of `group` (also what its in-flight work produces when it finishes). */
  drop(group: PreloadGroup): void {
    for (const [item, entry] of this.entries) {
      if (entry.group !== group) continue;
      this.entries.delete(item);
      // A finished result is released at once; one still running is released when it lands.
      const release = entry.release;
      entry.release = undefined;
      if (release) {
        void entry.promise.then(
          (value) => {
            try {
              release(value);
            } catch (error) {
              this.warn(`[title-preload] releasing ${item} failed`, error);
            }
          },
          () => undefined,
        );
      }
    }
  }

  /** Release everything and refuse further work (quit to title, or the session took over). */
  dispose(): void {
    this.disposed = true;
    this.drop('level');
    this.drop('quality');
    this.drop('shared');
  }

  private valid(group: PreloadGroup, key: PreloadKey): boolean {
    if (group === 'shared') return true;
    if (group === 'quality') return key.quality === this.key.quality;
    return key.levelId === this.key.levelId && key.quality === this.key.quality && key.gpu === this.key.gpu;
  }
}
