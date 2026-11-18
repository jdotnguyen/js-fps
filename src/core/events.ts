/**
 * Tiny typed event bus. Other modules add events with declaration merging:
 *
 *   declare module '../core/events.ts' {
 *     interface EventMap { 'door:opened': { id: string } }
 *   }
 *
 * Event names are `noun:verb` (ADR-0001).
 */
export interface EventMap {
  'game:booted': { at: number };
  'input:pointerLock': { locked: boolean };
  'settings:changed': { key: string };
}

export type EventName = keyof EventMap;
type Handler<K extends EventName> = (payload: EventMap[K]) => void;
type AnyHandler = (payload: never) => void;

export class EventBus {
  private readonly handlers = new Map<EventName, Set<AnyHandler>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const handlers = set;
    handlers.add(fn as AnyHandler);
    return () => {
      handlers.delete(fn as AnyHandler);
    };
  }

  once<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    // Copy so handlers can unsubscribe while we iterate.
    for (const fn of [...set]) (fn as Handler<K>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
