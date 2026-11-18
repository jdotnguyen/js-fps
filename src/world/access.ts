import type { ItemKind } from '../data/types/items.ts';
import type { AccessData } from '../data/types/level.ts';
import type { UiText } from '../data/types/uiText.ts';
import type { Inventory } from '../game/inventory.ts';

/**
 * Access gating for doors and vents (ADR-0024). Pure logic, so it is Node-tested: a gate
 * either lets the player through or yields hint text whose item name is marked for the
 * HUD to highlight (bold + icon + accent colour, never colour alone: ADR-0012).
 */

export type GateKind = 'door' | 'vent';

/** One run of hint text. `item` marks the highlighted span. */
export interface HintPart {
  text: string;
  item?: { id: string; kind: ItemKind | null };
}

export interface AccessHint {
  /** ui.json key the text came from, e.g. "access_needs_item". */
  key: string;
  /** Plain text for logs, toasts and screen readers. */
  text: string;
  parts: HintPart[];
}

export type AccessResult = { ok: true } | { ok: false; hint: AccessHint };

/** Fallbacks if ui.json is missing a key (ui.json is validated, so only tests see these). */
const DEFAULT_TEXT: UiText = {
  access_needs_item: "You'll need a {item} to open this door.",
  access_needs_tool: "You'll need a {item} to open this.",
  access_sealed: "This door won't open.",
  access_sealed_vent: "This vent won't open.",
};

/** True if this gate lets the holder of `inventory` through. No access data = always open. */
export function accessOpen(access: AccessData | undefined, inventory: Inventory | null): boolean {
  if (!access) return true;
  if (access.sealed) return false;
  if (access.requires === undefined) return true;
  return inventory?.satisfies(access.requires) ?? false;
}

/** ui.json key for a denied gate. Sealed `text` picks a variant: "lockdown" -> access_sealed_lockdown. */
export function hintKey(access: AccessData, kind: GateKind, ui: UiText): string {
  if (access.sealed) {
    const variant = access.text ? `access_sealed_${access.text}` : kind === 'vent' ? 'access_sealed_vent' : 'access_sealed';
    if (variant in ui || variant in DEFAULT_TEXT) return variant;
    console.warn(`[access] no ui text "${variant}"; using access_sealed`);
    return 'access_sealed';
  }
  return kind === 'vent' ? 'access_needs_tool' : 'access_needs_item';
}

/** Split a template on `{item}` and mark the item's display name. */
export function formatHint(key: string, template: string, item: { id: string; name: string; kind: ItemKind | null } | null): AccessHint {
  const parts: HintPart[] = [];
  const pieces = template.split('{item}');
  pieces.forEach((piece, i) => {
    if (piece) parts.push({ text: piece });
    if (i < pieces.length - 1 && item) parts.push({ text: item.name, item: { id: item.id, kind: item.kind } });
  });
  return { key, text: parts.map((p) => p.text).join(''), parts };
}

/** Check a gate; on denial, build the hint the player sees. */
export function checkAccess(access: AccessData | undefined, kind: GateKind, inventory: Inventory | null, ui: UiText = DEFAULT_TEXT): AccessResult {
  if (accessOpen(access, inventory)) return { ok: true };
  const a = access!;
  const key = hintKey(a, kind, ui);
  const template = ui[key] ?? DEFAULT_TEXT[key] ?? DEFAULT_TEXT['access_sealed']!;
  const id = a.requires;
  const item = id === undefined ? null : { id, name: inventory?.name(id) ?? id, kind: inventory?.def(id)?.kind ?? null };
  return { ok: false, hint: formatHint(key, template, item) };
}
