import type { EventBus } from '../core/events.ts';
import type { ItemDef, ItemTable } from '../data/types/items.ts';

declare module '../core/events.ts' {
  interface EventMap {
    /** The player gained a key item (ADR-0024); `source` is "pickup", "script" or "debug". */
    'item:given': { id: string; name: string; source: string };
  }
}

/**
 * Key items the player holds (ADR-0024). Saved with the game (ADR-0016 `items`).
 * Cards are levels: holding `card_l2` satisfies a door that needs `card_l1`.
 */
export class Inventory {
  readonly table: ItemTable;
  private readonly held: string[] = [];
  private readonly events: EventBus | null;

  constructor(table: ItemTable, events: EventBus | null = null) {
    this.table = table;
    this.events = events;
  }

  def(id: string): ItemDef | null {
    return this.table[id] ?? null;
  }

  /** Display name, or the id itself for an unknown item. */
  name(id: string): string {
    return this.table[id]?.name ?? id;
  }

  has(id: string): boolean {
    return this.held.includes(id);
  }

  /** True if what the player holds opens something that `requires` this item. */
  satisfies(requires: string): boolean {
    if (this.has(requires)) return true;
    const need = this.table[requires];
    if (need?.kind !== 'card' || need.level === undefined) return false;
    const level = need.level;
    return this.held.some((id) => {
      const d = this.table[id];
      return d?.kind === 'card' && d.level !== undefined && d.level >= level;
    });
  }

  /** Add an item. False for unknown ids (warned) or one already held. */
  give(id: string, source = 'script'): boolean {
    if (!this.table[id]) {
      console.warn(`[items] unknown item "${id}" (known: ${Object.keys(this.table).join(', ')})`);
      return false;
    }
    if (this.has(id)) return false;
    this.held.push(id);
    this.events?.emit('item:given', { id, name: this.name(id), source });
    return true;
  }

  /** Held ids in pickup order (what a save stores). */
  list(): string[] {
    return [...this.held];
  }

  /** Replace the held set from a save. Unknown ids are dropped with a warning; no events. */
  restore(ids: readonly string[]): void {
    this.held.length = 0;
    for (const id of ids) {
      if (!this.table[id]) console.warn(`[items] save holds unknown item "${id}"; dropped`);
      else if (!this.held.includes(id)) this.held.push(id);
    }
  }

  clear(): void {
    this.held.length = 0;
  }
}
