# Design

## Context

See proposal.md for why. The facts that shape the approach:

- `src/data/levels/slice01.json` holds 35 rooms. By size, a room is mostly hand-authored content: props (74 kB across
  rooms), lights (16 kB), anchors (10 kB), NPCs, triggers. The generated `pieces` are 21 kB.
- `scripts/gen-slice01.mjs` turns per-room tables into `pieces`. Its input per room is cells, height, `floor`,
  `floorOverride`, `floorParams`, `floorMaterial`, `ceiling`, `ceilingMaterial`, `walls`, `wallOverride`, `wallParams`,
  `wallMaterial`, `noDeadFixtures` and `extraPieces`. Rules that cross rooms: door edges, glass edges and open edges skip
  walls. The rules have subtle details: the wall finish is chosen by a hash of cell and side; ceilings are emitted first,
  one per cell, so numeric light slots follow cell order; and `noDeadFixtures` drops unlit fixtures and renumbers light
  slots.
- The generator is behind the JSON (R15b, the 17 R16 corpses and three bodies exist only in the JSON). The JSON is the
  truth for everything except how pieces are derived.
- The game loads levels through `import.meta.glob('../data/levels/*.json')` in `src/app/levelFiles.ts`. The Node tests
  load them through `readdirSync` in `src/world/headlessSlice.ts`, and about 20 test files read `levels/slice01.json`
  from disk directly.
- TS sound names come from `keyof typeof SOUND_SPECS | keyof typeof SAMPLE_URLS` in `src/audio/sounds.ts`.
- Per-owner layouts already exist and work: `src/data/sequences/` (one file per scene), `src/data/mocap/` (one pack per
  character, lazily loaded), `src/data/creatures/juggernaut.*`.
- The checkout is shared by several agents at once. A move that lands while another agent edits the old file loses
  that agent's work.

## Goals / Non-Goals

**Goals:**
- Each kind of work edits files owned by what it works on (see specs/content-layout).
- Every phase is checkable by a test showing the game sees the same data as before.
- One source of truth per fact, with nothing generated committed.

**Non-Goals:**
- Changing any content, behaviour or look. Every phase is a no-op for the player.
- Splitting `session.ts` or other wiring files. Why they churn is not yet understood. That is a follow-up.
- Splitting append-only docs (`CREDITS.md`, `docs/PLAYTEST.md`). They conflict rarely and resolve trivially.
- A level editor or new authoring tools.

## Decisions

### D1. Level layout on disk

```
src/data/levels/slice01/
  level.json        id, name, seed, playerStart, squadStart, rooms, pickups, checkpoints, mapStations
  doors.json        doors, vents
  rooms/<id>.json   one per room, in level order given by level.json `rooms: [ids]`
```

Room order matters (light slots, test expectations), so `level.json` lists room ids in order instead of relying on
directory order. A room file without an entry, or an entry without a file, fails loading with both names.
`pickups` sit in `level.json` with the other level-wide lists (each already names its room, and their order spans rooms).
`kit_test.json` stays a single file: the loader accepts either a `<id>.json` file or a `<id>/` folder.

*Alternative:* split each room further into shell, dressing and cast files. Rejected: the collisions reported are
between rooms, not within one. A room file is at most ~35 kB (R16b), small enough to share between dressing and cast
work. This can be revisited per room if one grows.

### D2. One assembler, two file readers

A pure function `assembleLevel(parts)` in `src/data/levels/` takes `{ level, doors, rooms: Record<id, room> }` and
returns today's `LevelData` shape. Two thin readers feed it:
- Browser: a per-level module that globs `./slice01/**/*.json` with `eager: true` and calls `assembleLevel`. The session
  imports that module lazily, so the whole level is still **one lazy chunk** (startup-bundle). A non-eager glob would
  have produced one request per room.
- Node: `readLevelParts(id)` using `readdirSync`, used by `headlessSlice.ts`, the tests and scripts.

Validation runs on the assembled data, but each part carries its source path, so `validate()` errors name
`levels/slice01/rooms/R16b.json > props[3] > kit`. Every test that reads `levels/slice01.json` directly moves to the Node
reader.

### D3. Room shells built at load (option C)

Each room gets a `layout` object holding exactly the generator's per-room inputs (Context), plus glass and open edges
expressed as edges of that room. `extraPieces` stays inside `layout`. A new module `src/world/shell.ts` ports the
generator's piece rules to TS: same hash for wall choice, same ceiling-first order, same `noDeadFixtures` renumbering.
`assembleLevel` calls it, so the assembled `LevelData` still has `pieces` and nothing downstream changes.

Lights stay stored with their final slot numbers, as they are today. The builder only has to emit fixtures in the same
order. This keeps light authoring unchanged and avoids rewriting every light.

*Alternatives:* (A) keep the generator writing `rooms/<id>.shell.json`. Rejected: the 1.8k-line generator stays the
one file every layout change edits, and in a shared checkout a regenerate writes other agents' half-done rooms into
your commit. (B) Retire the generator and store `pieces` by hand. Rejected: moving a door or adding a cell becomes
hand-editing wall tiles on both sides of an edge.

### D4. Getting from today's data to layouts (the drift)

The JSON stays the truth for all content. Layouts come from the generator's room tables. For each room, a one-time
script builds pieces from the layout and compares them with the committed `pieces`, normalised as an unordered set of
`kit|cell|rot|params`. A room that matches takes the layout. A room that differs (R15b exists only in the JSON) gets its
layout written by hand until it matches, or keeps the difference listed in the migration note for review. No room's
content (props, NPCs, lights...) is ever taken from the generator.

### D5. Cast, creature and pose folders

```
src/data/cast/<name>/      body.json, poses.json, motion.json, mocap.json (baked)
src/data/creatures/<id>/   creature.json, poses.json      (juggernaut moves to this shape too)
src/data/poses/<family>.json   shared poses: sit, lean, corpse, kill, maul, idle ...
src/data/body-models.json      keeps only generic crew bodies and look pools
```

A pose is owned by the folder of the only character that uses it (prefix such as `priya_`, `okafor_`, `blade_`).
Anything used by more than one character goes to a family file. A combining loader merges every pose file into one
`PoseLibrary` and fails on a duplicate name, naming both files (spec: one pose name, one file).

`scripts/bake-mocap.mjs` writes each pack into the character's folder. The generated lazy-import table
(`mocap/packs.ts`) is regenerated by the bake script as today, so packs stay separate lazy chunks (mocap-library,
startup-bundle).

### D6. Sound area files with a typed index

```
src/audio/sounds/<area>.ts   export const specs = { ... } as const satisfies ...; export const samples = { ... }
src/audio/sounds/index.ts    import * as weapons from './weapons.ts'; ...
                             export const SOUND_SPECS = { ...weapons.specs, ...ui.specs, ... };
```

The index is written by hand, not globbed. Globbing loses the literal key types that `SoundName` is built from, and
the Node test runner has no `import.meta.glob`. The index changes only when an area is added. A test checks that no
name is defined in two areas, since object spread would silently keep the last one. `src/audio/sounds.ts` re-exports
the index, so existing imports keep working.

### D7. Set pieces out of `Level`

A `SetPiece` interface gets the hooks the current scene code uses (build after rooms, per-frame update, event or flag
handlers, state for save and restore), plus a narrow handle onto the level (prop poses, swapping room materials,
colliders). `src/world/setpieces/index.ts` lists them, like the sound index. The first moves are the Lab B floor break
(`breakLabBFloor`), the after-groups / `layOut` laid-out props, and the flood's swinging fixtures and sparks. `Level`
keeps generic mechanisms (lights, doors, props) and loses scene names. This decision is the least settled. The phase 4
agent may reshape the interface once it reads the code, as long as the spec holds.

### D8. Phases, models and effort

| Phase | What | Model / effort | Why |
|---|---|---|---|
| 0 | This proposal, design, tasks | Opus 5.5 / medium | Judgment on loaders, types, migration |
| 1a | Split slice01 into files with pieces copied as-is, assembler and readers, equality test, AGENTS.md map, generator frozen | Sonnet 5.5 / medium | Mechanical, fully checked by an equality test |
| 1b | `shell.ts`, layouts replace pieces, sort out drift, generator deleted | Opus 5.5 / high | Porting subtle rules plus sorting out drift without losing hand edits |
| 2 | Cast, creatures, pose folders | Sonnet 5.5 / medium | Mechanical, equality test on the merged tables |
| 3 | Sound area files | Sonnet 5.5 / medium | Mechanical, typecheck plus duplicate test |
| 4 | Set pieces out of `level.ts` | Opus 5.5 / high | Real refactor with visual behaviour, needs a browser playtest |

Each phase starts in a fresh session (`/clear`) and points at this change. Phases 2 and 3 touch different files from
1b and from each other, so they can run in parallel.

## Risks / Trade-offs

- [A move lands while another agent is editing the old file, and that agent's edits are lost] → Each move phase
  starts by checking `git status` and the in-flight changes list for the files it moves. It goes ahead only when none
  is dirty or claimed, does the move in one commit, and leaves the old path absent so any late edit fails loudly
  instead of writing to a dead file.
- [The shell port differs subtly (wall hash, slot order), so lights land on the wrong fixtures] → Per-room equality of
  built and committed pieces before the stored `pieces` are dropped, plus a test that every numeric light slot still
  points at the same fixture position. Spot-check rooms in the browser.
- [Building shells at load costs time] → 35 rooms of grid work is under a millisecond compared with GLB loading.
  Measure once in phase 1b.
- [Many small files add Vite requests] → Eager glob inside one lazily imported level module (D2), verified by checking
  the chunk list in `npm run build` output.
- [Sound spread hides a duplicate name] → Duplicate-name test (D6).
- [Tests and scripts that read old paths break] → Phase tasks include a grep for each old path. Phase 1a's equality
  test against the old file runs once during migration, and the old file is deleted afterwards.
- [Set-piece interface over-fits the first three pieces] → Kept narrow. Phase 4 can adjust it (D7).

## Migration Plan

Each phase is one commit (or a small series) and is reversible with `git revert`, since it moves data and adds a
loader. During phase 1a the equality test compares the assembled data against the old `slice01.json` before that
file is deleted. Phase 1b's equality test compares built pieces against the phase 1a room files' stored pieces before
those are dropped. Commits follow the shared-checkout practice (private index, own paths only).

### Phase 1b migration notes (2026-11-26)

- Layout fields: `cells` (deck-0 `[x, z]`, in ceiling order), `floor`, `floorOverride`, `floorParams`, `floorMaterial`,
  `ceiling`, `ceilingMaterial`, `walls`, `wallOverride`, `wallParams`, `wallMaterial`, `open`, `fixtures`,
  `extraPieces`. Two generator inputs changed form. A glass pane is the owner's `wallOverride`, and the room behind
  lists that side in `open`, like an open seam. `noDeadFixtures` became `fixtures`, the cells whose ceilings carry a
  housing, because lights store their final slot numbers and can no longer say which cells are lit. Room `height`
  stays a room field, since the builder does not use it.
- 29 rooms took their layout from the generator's table and build exactly the stored pieces in the same order.
- R13d, R15a, R16a, R16b and R16c were reworked by hand after the generator (Phase 2b, fix-r13d-r16-finale), and R15b
  exists only in the data. Their layouts were derived from the stored pieces. The generator tables were not used, so
  R13d keeps the plain finish Phase 2b gave it, not the generator's rust.
- Differences kept on purpose: R16a and R16b build the same pieces in a different order. Their windows, stairs, plain
  walls and panel walls group differently. None of those pieces holds a light slot, so the slot order and every
  light's position stay the same (`lightSlots` snapshot test). R15b has no `cells`. Its five ceilings are
  `extraPieces`, because the room has no floor or walls of its own.

### Phase 2 migration notes (2026-11-27)

- Each kind of file has a hand-kept index with static JSON imports, which works in both Vite and the Node test runner, as
  the sound index does (D6): `src/data/poseFiles.ts`, `bodyModelFiles.ts` and `motionFiles.ts`. `mergeFiles.ts` fails
  loading on a name two files define. A test checks each index against the files on disk.
- The crew defaults (`defaults`, `crew_m`, `crew_f`) have no character folder, so they are in `src/data/motion-crew.json`.
- `body-models.json` keeps the bodies no one character owns, the infected ones among them. It is merged first, so spawns
  still pick from the same bodies in the same order. Voss wears the shared `office3`, and has no `body.json`.
- Body and motion files keep their table's shape (`{ "<id>": {...} }`), because a body's id differs from its
  character's name (Giles wears `mechanic`, Okafor `doctor`).
- The pack table stays at `src/data/mocap/packs.ts`. Its source comes from `scripts/lib/mocapPackFiles.mjs`.

### Phase 4 notes (2026-11-27)

- The interface is narrower than D7 sketched, because only one piece needed moving. `SetPiece` has an `id` and
  `attach(level)`, called once after the rooms are built and merged. It returns null when the level lacks the piece's
  room, or an instance with `reset` (new game) and `dispose`. The handle (`SetPieceLevel`) offers the level id,
  materials, the event bus and `roomGroup(id)`. A per-frame update, save state and prop or collider access are left
  out until a piece needs them.
- The Lab B floor break moved to `setpieces/labBFloor.ts`. Its test hook `Level.breakLabBFloor()` went with it. The
  slice01 test now breaks the floor by emitting `glass:set labb shattered`.
- The flood's swinging fixtures and sparks stay in `Level` (approved by the user). Neither is flood code: swinging comes
  from kit pieces (`hanging_tube`, swaying pendants) used in R02, R03, R07a, R09, R14b and R14d, and is knocked by
  shotgun blasts and the `lightJolt` action. Sparks come from a light's `sparks: true` flag, which only R09 uses today.
  The spec's example of "the flood's swinging fixtures" describes the content, which already lives in room files.
- Open question resolved: the after-groups and kill-aftermath props (`layOut`, `afterPose`, `propPose`) are a generic
  mechanism and stay in `Level`. Groups and poses are authored on props in room files (`after`), and the NPC kills
  name them from data.
- `R15b`'s exclusion from the exterior hull was a room id in `Level`. It is now the room field `hull: false`.
- A test (`setpieces/setpieces.test.ts`) fails when `level.ts` mentions a room id anywhere, or has a string literal
  equal to a sequence id, a set-piece id or any content `id` in a level's data. Three comments that named rooms as
  examples were reworded.

## Open Questions

- Whether the after-groups and kill-aftermath prop logic (`layOut`, `propPose`) count as a set piece or as a generic
  mechanism. Phase 4 decides on reading the code. Decided: a generic mechanism (see the phase 4 notes).
- Exact area boundaries for sound files. The section comments in `sounds.ts` are the starting cut.
