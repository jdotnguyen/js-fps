import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../core/validate.ts';
import { validateItemTable } from '../data/types/items.ts';
import { levelValidator, type KitIds, type LevelData } from '../data/types/level.ts';
import { validateUiText } from '../data/types/uiText.ts';
import { Inventory } from '../game/inventory.ts';
import { checkAccess } from './access.ts';

// ADR-0024 access gating: schema, hint text and key-item rules.

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const items = validate(validateItemTable, json('../data/items.json'), 'data/items.json');
const ui = validate(validateUiText, json('../data/dialogue/ui.json'), 'data/dialogue/ui.json');
const refs = { items: new Set(Object.keys(items)), uiText: new Set(Object.keys(ui)) };

/** Every kit id the level uses, so the schema test does not need the three.js registry. */
function kitsOf(raw: unknown): KitIds {
  const level = raw as { rooms: Array<{ pieces: Array<{ kit: string }>; props?: Array<{ kit: string }> }> };
  return {
    structure: new Set(level.rooms.flatMap((r) => r.pieces.map((p) => p.kit))),
    prop: new Set(level.rooms.flatMap((r) => (r.props ?? []).map((p) => p.kit))),
  };
}

const kitTestRaw = json('../data/levels/kit_test.json');
const check = (raw: unknown): LevelData => validate(levelValidator(kitsOf(kitTestRaw), refs), raw, 'kit_test');
/** kit_test with door D3's access replaced. */
const withAccess = (access: unknown): unknown => {
  const copy = structuredClone(kitTestRaw) as { doors: Array<Record<string, unknown>> };
  copy.doors.find((d) => d['id'] === 'D3')!['access'] = access;
  return copy;
};

const inv = (...held: string[]): Inventory => {
  const i = new Inventory(items);
  for (const id of held) i.give(id);
  return i;
};

test('items.json: cards carry a level, the slice items exist', () => {
  assert.equal(items['card_l2']?.name, 'Level 2 Card');
  assert.equal(items['card_l2']?.level, 2);
  assert.equal(items['vent_driver']?.name, 'Vent Driver');
  assert.throws(() => validate(validateItemTable, { card_x: { name: 'X', kind: 'card' } }, 'x'), /cards need a whole-number "level"/);
  assert.throws(() => validate(validateItemTable, { t: { name: 'T', kind: 'tool', level: 1 } }, 'x'), /only cards have a level/);
});

test('kit_test.json validates with a Level 2 door, a sealed door, a vent and the card pickup', () => {
  const level = check(kitTestRaw);
  assert.deepEqual(level.doors.find((d) => d.id === 'D3')?.access, { requires: 'card_l2' });
  assert.deepEqual(level.doors.find((d) => d.id === 'D4')?.access, { sealed: true, text: 'lockdown' });
  assert.deepEqual(level.vents?.[0]?.access, { requires: 'vent_driver' });
  assert.equal(level.pickups?.[0]?.item, 'card_l2');
});

test('access schema: exactly one of requires/sealed, known items, text only when sealed', () => {
  assert.throws(() => check(withAccess({})), /exactly one of "requires" or "sealed"/);
  assert.throws(() => check(withAccess({ requires: 'card_l2', sealed: true })), /exactly one/);
  assert.throws(() => check(withAccess({ requires: 'card_l9' })), /doors\[2\] > access > requires: unknown item "card_l9"/);
  assert.throws(() => check(withAccess({ requires: 'card_l2', text: 'lockdown' })), /"text" is only for sealed/);
  assert.throws(() => check(withAccess({ sealed: true, text: 'nope' })), /no ui text "access_sealed_nope"/);
  assert.throws(() => check(withAccess({ requries: 'card_l2' })), /unknown field/);
});

test('denied without the item: hint names it and marks it for highlighting', () => {
  const r = checkAccess({ requires: 'card_l2' }, 'door', inv(), ui);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.hint.key, 'access_needs_item');
  assert.equal(r.hint.text, "You'll need a Level 2 Card to open this door.");
  const marked = r.hint.parts.filter((p) => p.item);
  assert.deepEqual(marked, [{ text: 'Level 2 Card', item: { id: 'card_l2', kind: 'card' } }]);
  assert.equal(r.hint.parts[0]?.text, "You'll need a ");
});

test('vents use the tool hint', () => {
  const r = checkAccess({ requires: 'vent_driver' }, 'vent', inv('card_l2'), ui);
  assert.ok(!r.ok && r.hint.text === "You'll need a Vent Driver to open this.");
  assert.ok(!r.ok && r.hint.parts.some((p) => p.item?.id === 'vent_driver' && p.item.kind === 'tool'));
  assert.equal(checkAccess({ requires: 'vent_driver' }, 'vent', inv('vent_driver'), ui).ok, true);
});

test('card_l2 opens Level 1 and Level 2 doors; card_l1 does not open Level 2', () => {
  const l2 = inv('card_l2');
  assert.equal(checkAccess({ requires: 'card_l1' }, 'door', l2, ui).ok, true);
  assert.equal(checkAccess({ requires: 'card_l2' }, 'door', l2, ui).ok, true);
  assert.equal(checkAccess({ requires: 'card_l2' }, 'door', inv('card_l1'), ui).ok, false);
  // A tool is never satisfied by a card.
  assert.equal(checkAccess({ requires: 'vent_driver' }, 'vent', l2, ui).ok, false);
});

test('sealed never opens, whatever the player holds', () => {
  const all = inv(...Object.keys(items));
  const plain = checkAccess({ sealed: true }, 'door', all, ui);
  assert.ok(!plain.ok && plain.hint.text === "This door won't open." && plain.hint.parts.every((p) => !p.item));
  const lockdown = checkAccess({ sealed: true, text: 'lockdown' }, 'door', all, ui);
  assert.ok(!lockdown.ok && lockdown.hint.key === 'access_sealed_lockdown');
  assert.ok(!checkAccess({ sealed: true }, 'vent', all, ui).ok);
});

test('no access data means open; inventory survives list/restore (the save path)', () => {
  assert.equal(checkAccess(undefined, 'door', null, ui).ok, true);
  const a = inv('card_l2');
  const b = new Inventory(items);
  b.restore(JSON.parse(JSON.stringify(a.list())) as string[]);
  assert.equal(b.satisfies('card_l2'), true);
  assert.equal(b.give('card_l2'), false, 'already held');
  assert.equal(b.give('nonsense'), false);
  b.restore(['card_l2', 'gone_item']);
  assert.deepEqual(b.list(), ['card_l2']);
});

test('sequence action giveItem gives a key item (and warns on unknown ids)', async () => {
  const { SequenceManager } = await import('../script/runtime.ts');
  const { validateSequences } = await import('../script/schema.ts');
  const inventory = new Inventory(items);
  const warnings: string[] = [];
  const host = {
    events: { on: () => () => undefined, emit: () => undefined },
    flags: {},
    resolve: () => null,
    warn: (m: string) => warnings.push(m),
    giveItem: (id: string) => inventory.give(id, 'script'),
  };
  const defs = validateSequences({
    'give.json': { id: 'give', steps: [{ do: 'giveItem', item: 'card_l2' }, { do: 'giveItem', item: 'card_l9' }] },
  });
  const m = new SequenceManager(host, defs);
  m.start('give');
  m.update(1 / 60);
  assert.equal(inventory.has('card_l2'), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /card_l9/);
});
