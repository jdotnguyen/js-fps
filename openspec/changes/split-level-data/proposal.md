# Proposal

## Why

Several agents work on this project at once in one shared checkout, and their work keeps landing in the same few large
files even when it is about different things: an agent dressing R16b and one staging R04 both edit the 21k-line
`src/data/levels/slice01.json` (48 commits in two months), a rig agent and a creature agent both edit the 11k-line
`poses.json`, and every new sound edits `src/audio/sounds.ts`. The level also has two sources of truth:
`scripts/gen-slice01.mjs` writes the whole level file, people edit that file by hand, and the two have drifted (R15b,
the R16 corpses and three bodies exist only in the JSON). Every overlap costs a hunk-by-hunk commit or a lost edit.

## What Changes

- Split the level into one file per room under `src/data/levels/slice01/rooms/`, plus a level file (start points,
  checkpoints, map stations) and a doors file (doors and vents, which span two rooms). Loaders stitch the parts back
  into today's level data, so the game, validator and tests see the same thing.
- Each room holds its own **layout** (cells, height, wall and floor finishes, glass edges, hand-placed extra pieces).
  The room's floors, walls and ceilings are built from the layout and the doors when the level loads, using the
  generator's rules ported to `src/world/`. **BREAKING** (tooling): `scripts/gen-slice01.mjs` is removed, and the
  level's `pieces` stop being stored in the data.
- Give each named character a folder under `src/data/cast/<name>/` (body, poses, motion profile, mocap pack) and each
  creature a folder under `src/data/creatures/<id>/` (as the Juggernaut already has). Poses that many characters share
  move to `src/data/poses/<family>.json`. `poses.json`, `body-models.json`, `motion-profiles.json` and
  `blade-creature.json` are replaced by these folders.
- Split the sound registry in `src/audio/sounds.ts` into one file per area under `src/audio/sounds/`, combined by a
  hand-kept index, so sound names keep their types.
- Move scene-specific code (the Lab B floor break, the cart's laid-out props, the flood fixtures) out of the `Level`
  class into set-piece modules under `src/world/setpieces/`.
- Add a "where things live" map to `AGENTS.md`, so a new agent starts in the right folder.

The work ships in phases, each landing when no other change is editing the files it moves. Each phase notes the
model and effort it needs (see tasks.md).

## Capabilities

### New Capabilities
- `content-layout`: where authored game content lives and how it is put together. Content is stored one file or
  folder per owner (room, character, creature, sound area, set piece). Shared files only list those owners. Derived
  data, such as room shells, is built from authored data and never committed.

### Modified Capabilities

None. Players see no change: the level, characters, creatures and sounds load and behave exactly as before.

## Impact

- Data: `src/data/levels/slice01.json`, `src/data/poses.json`, `src/data/body-models.json`,
  `src/data/motion-profiles.json`, `src/data/blade-creature.json`, `src/data/mocap/*.json` move into per-owner folders.
- Loaders: `src/app/levelFiles.ts`, `src/app/worldBundle.ts`, `src/world/headlessSlice.ts`, `src/data/types/level.ts`,
  `src/core/validate.ts`, `src/actors/bodyModelLibrary.ts`, `src/actors/animator.ts`, `src/data/mocap/packs.ts`.
- Code: `src/world/level.ts` loses its scene-specific parts. `src/audio/sounds.ts` becomes an index.
- Tests: about 20 test files that read `levels/slice01.json` from disk switch to a shared assembler.
- Scripts and docs: `scripts/gen-slice01.mjs` removed. `scripts/walk-suggest.ts` and `scripts/ambience-generate.ts`
  point at room files. `docs/modular-grid-standard.md`, `docs/surface-dressing-standard.md` and `AGENTS.md` describe the
  new layout.
- Bundle: each level still loads as one lazy chunk (startup-bundle). Splitting files must not add one network request
  per room.
- In-flight changes: rebuild-heins-rig, keep-crossed-arms and add-physics-ragdolls edit files that move, so their
  phases wait until those changes land.
