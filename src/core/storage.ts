/** Minimal key/value storage so persistence can be tested without a browser. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** localStorage, failing soft (private mode, quota, disabled storage). */
export function browserStore(): KeyValueStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (err) {
        console.warn(`[storage] could not write ${key}`, err);
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    keys() {
      try {
        return Object.keys(localStorage);
      } catch {
        return [];
      }
    },
  };
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}
