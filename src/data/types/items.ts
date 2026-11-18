import { ValidationError, numRange, obj, oneOf, optional, record, str, type Infer, type Validator } from '../../core/validate.ts';

/**
 * Key items (ADR-0024): things the player holds that open doors and vents. `data/items.json`
 * maps an item id to its display name. Cards are levels: a card satisfies any door that
 * asks for a card of its level or lower (`card_l2` opens `card_l1` doors) [Assumed].
 */
export const ITEM_KINDS = ['card', 'tool'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

const itemShape = {
  /** Shown to the player, highlighted in hint text: "Level 2 Card". */
  name: str,
  kind: oneOf(ITEM_KINDS),
  /** Access level, cards only. */
  level: optional(numRange(1, 9)),
};

export type ItemDef = Infer<typeof itemShape>;
export type ItemTable = Record<string, ItemDef>;

export const validateItemTable: Validator<ItemTable> = (v, p) => {
  const table = record(obj(itemShape))(v, p);
  for (const [id, item] of Object.entries(table)) {
    const ip = `${p} > ${id}`;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ValidationError(ip, `ids use letters, digits, _ and - only, got "${id}"`);
    if (item.kind === 'card' && (item.level === undefined || !Number.isInteger(item.level))) throw new ValidationError(ip, 'cards need a whole-number "level"');
    if (item.kind !== 'card' && item.level !== undefined) throw new ValidationError(`${ip} > level`, 'only cards have a level');
  }
  return table;
};
