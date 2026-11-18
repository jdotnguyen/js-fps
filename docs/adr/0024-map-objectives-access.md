# ADR-0024: Map, objectives and access gating

Status: Accepted (from the Nov 16 grilling) / Proposed (UI layout, numbers, schema details)

## Context
The morning rounds (ADR-0023) make the quiet half a small hub with optional rooms and
backtracking. Justin wants objective lists with optionals, a map, doors behind access
credentials, vents that need a tool, and backtracking as the player gains access or abilities
(mostly in later chapters) [Decided].

## Decision

### Map [Decided]
- **Auto-map**: rooms and corridors draw onto the map as Jay enters them, with an **arrow
  marker** for his position and facing.
- **Wall map stations**: a map on a wall somewhere in an area; finding it fills in the whole
  area, including rooms not yet visited. If the player never finds it, the map only shows
  what they have walked.
- Hidden rooms (`hidden: true`) are never revealed by a map station [Assumed].
- Map screen shows the **objective list** (required and optional, kept apart) and icons for
  locked doors and vents with what they need, so the player remembers where to return
  [Assumed].

### Objectives [Decided]
- A list of required objectives and a separate list of optionals. The rounds are three
  required objectives done in any order.
- Optionals cover side rooms, crew moments and lore.

### Access gating [Decided]
- **Some doors simply do not open.** Interacting shows "This door won't open." (or a lockdown
  variant).
- **Some doors need an item.** The error text names it and the UI **highlights** the item name
  as a hint: "You'll need a **Level 2 Card** to open this door."
- **Vents need a tool**: "You'll need a **Vent Driver** to open this."
- In the slice **only the Level 2 Card is obtainable** [Decided]: picked up on the rounds and
  used once to backtrack (ADR-0023). Everything else stays locked as a promise for later chapters.

## Details

### Level data (extends ADR-0003)
```json
{ "rooms": [ { "id": "R12a", "area": "hydroponics", "outline": [[0,0],[8,0],[8,6],[0,6]],
               "hidden": false } ],
  "doors": [ { "id": "hydro_store", "access": { "requires": "card_l2" } },
             { "id": "labb_seal", "access": { "sealed": true, "text": "lockdown" } } ],
  "vents": [ { "id": "hydro_vent", "access": { "requires": "vent_driver" } } ],
  "mapStations": [ { "id": "hydro_map", "reveals": "hydroponics" } ] }
```
- Room outlines are 2D floor polygons, already implied by the kit layout; corridors are rooms
  too. Entering a room's trigger volume marks it `seen`.
- `requires` names a key item. Key items live in `data/items.json` with a display name
  ("Level 2 Card", "Vent Driver"). Cards are levels (`card_l2` also satisfies `card_l1`) [Assumed].

### Hint text
- Template strings in `data/dialogue/ui.json`: `access_needs_item` = "You'll need a {item} to
  open this door.", `access_needs_tool` = "You'll need a {item} to open this.", `access_sealed`
  = "This door won't open."
- The `{item}` span is highlighted: bold, a small item icon, and the accent colour, so it is
  never colour alone (ADR-0012).
- Once the player holds the item, the door's map icon changes to "unlocked" [Assumed].

### Map UI
- Action `map` (default `M`), remappable. Full-screen overlay; the game pauses while it is open
  [Assumed].
- Drawn on a canvas in the visor style (ADR-0012): rooms as filled outlines, unseen-but-revealed
  rooms dimmer, doors as gaps, locked doors and vents as icons with a text label on hover/focus.
- Keyboard and gamepad navigable; zoom and pan; legend; readable at 200 % UI scale; high
  contrast option.
- Map state (`seen` rooms, revealed areas, held items, objectives) is saved (ADR-0016).

## Consequences
- Every level needs room outlines and area tags; the kit already knows its footprints.
- The same gating data supports later chapters' backtracking with no new systems.

## Execution steps
1. Room outlines, areas and `seen` tracking in the level loader.
2. Key items, `access` on doors and vents, interact hint text with highlighted item.
3. Objectives (required/optional) and the top-left HUD line (ADR-0012).
4. Map overlay with arrow, icons, objectives; map stations; save state.
5. Level 2 Card pickup and the hydroponics door (ADR-0023).

## Definition of done
- Walking a hub draws it; finding its map station fills it in, hidden rooms excepted.
- A locked door names the item it needs, highlighted, and the map shows it.
- Picking up the Level 2 Card lets the player open the hydroponics door they saw earlier.

## Open questions
- Map station prop look; card levels beyond 2; tool list for later chapters.

## Progress 2026-11-16: step 2 (access gating), map overlay not started
- Key items in `data/items.json` (`card_l1`, `card_l2`, `vent_driver`; validated by
  `data/types/items.ts`), held in `game/inventory.ts`. Cards are levels as assumed. Saves are
  now v2 with an `items` array (migration from v1 adds `[]`), so held items persist (ADR-0016).
- Level schema: door `access` (`requires` xor `sealed`, `text` picks `access_sealed_<text>`),
  `vents: [{ id, room, box, access }]` (the visual is a separate piece such as `wall_vent`) and
  `pickups: [{ id, room, item, pos, rot }]`. Item ids and sealed text variants are checked at load.
- `world/access.ts` decides gates and builds hints from `data/dialogue/ui.json`; the HUD shows
  them under the interact prompt for 4 s with the item in bold, an icon and the accent colour.
  A gated door answers a tap (no hold) and auto doors stay shut without the item. Sealed doors
  never open for the player; sequences can still force them with `doorState`.
- Events: `access:denied { id, kind, requires?, sealed?, hint }`, `access:granted` (first open
  per session), `vent:opened`, `item:given`. Sequence action `giveItem { item }` (instant).
- kit_test: D3 (Lab B -> vault) needs the Level 2 Card, which lies on the Lab B desk; D4 is a
  sealed lockdown bulkhead to a new one-cell annex R05; V1 is a wall vent in Lab B needing the
  Vent Driver. `?level=kit_test&debug` adds "give <item>" buttons; `&give=card_l2` gives at start.
- Not yet: vents only open (no crawling), gate/vent open states are not saved, map icons.

## Progress 2026-11-17: steps 1, 3 and 4 (map, objectives, stations, save)
- Level schema: room `area` (default: the level id), `hidden`, `outline` ([[x, z], ...] override);
  level `mapStations: [{ id, pos, reveals, rot?, room? }]` (`reveals` must be some room's area).
  `Level.source` exposes the validated data.
- `ui/mapModel.ts` (pure, Node-tested): outlines derived from the kit cells on a 0.5 m raster
  (full 4 m cells for room tiles, 3 m corridor shapes with arms on open sides, rotated like the
  kit), merged wall segments, door openings cut out as 2 m gaps, gates/vents/stations, and
  `MapState` (seen on `room:entered`, areas revealed by stations, hidden rooms never revealed).
- `ui/mapScreen.ts`: action `map` (default M, in keymap.json/ACTIONS) calls `game.openMap()`:
  mode "paused", mouse freed, pause menu hidden (`game:map`). Canvas: walked rooms filled,
  revealed rooms dim + dashed, current room brighter, room names where they fit, padlock /
  cross / vent icons with text labels ("Needs Level 2 Card", "Unlocked: Level 2 Card",
  "Lockdown: won't open"), station "M" icons, Jay's arrow with facing; side panel with
  required and optional objectives apart, a focusable gate list (focus centres the map),
  legend, zoom/centre/contrast/close buttons. Keys: arrows/WASD pan, +/- zoom, C centre,
  H high contrast (remembered), M/Esc close; drag and wheel. Sizes from rem (200 % scale).
  Draws only the player's deck.
- Stations: a wall panel with a glowing screen, interact "Download map", toast, event
  `map:revealed { area, station, rooms }`; first entry into an area with an unused station
  emits `map:areaEntered` (starts the optional "Find the ... wall map").
- Objectives: `data/objectives.json` + `data/types/objectives.ts` (title, required, area,
  target, hint tiers, `startOn`/`completeOn` event matchers). `ui/objectives.ts`
  ObjectiveTracker reads/writes the same `obj:<id>` flags as `setObjective`/
  `completeObjective`, so objectives save for free. Top-left line `ui/hud/objectiveHud.ts`:
  5 s on change (changes stack), Tab recalls the active list. Nav pulse `ui/navPulse.ts`: Q
  draws a floor ribbon along the navgraph path to the nearest room of the objective's area
  (3 s, 2 s cooldown); the last hint tier fires it.
- Save v3 (`map: { <levelId>: { seen, revealed } }`), migration from v2 adds `{}`.
- kit_test now has areas (`prep`, `lab_b`), the sealed annex R05 `hidden`, a wall map in the
  corridor revealing `lab_b`, and three supply pickups.
- Try it: `?level=kit_test`, walk R01 -> corridor, M shows the walked rooms; use the corridor
  wall map, M again shows Lab B and the vault dashed (annex stays blank); try D3 for the
  Level 2 hint, the map labels it, `&debug` "give Level 2 Card" flips it to "Unlocked".
- Not verified in a browser: drawing, focus handling, pointer re-lock on close (keypress
  re-lock relies on user activation), station panel placement/look. Area names assumed for
  the slice: `hydroponics`, `dive_bay`, `admin` (objectives use them; slice01.json must match).
  Gate/vent open states are still not saved. Multi-deck levels show only the current deck.
