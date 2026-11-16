# ADR-0001: Project reset and code architecture

Status: Accepted (structure, language) / Proposed (loop details)

## Context
The repo contains INKSHOT, a cel-shaded arena wave shooter generated without input. The
target is now a story-driven Dead Space-style horror FPS in interior corridors [Decided],
delivered first as a 10-15 min tech demo that must grow into many chapters [Decided].
The architecture must make new chapters mostly *data*, not code.

## Decision
1. Keep Vite + Three.js (r170+) and the browser as the platform. [Decided]
2. Move INKSHOT to `legacy/inkshot/` (kept for reference, not imported). [Assumed]
3. TypeScript, strict mode (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). [Decided]
   Vite compiles it with no extra config; `npm run typecheck` runs `tsc --noEmit`.
   Data stays JSON (so a future level editor can write it). Every data format has a TS type
   in `src/data/types/` and a runtime validator that narrows `unknown` JSON to that type.
4. Lightweight "entities + systems" structure, not a full ECS. [Assumed]
5. All content (levels, dialogue, sequences, weapons, difficulty, enemies) lives in
   `src/data/` as JSON and is validated at load. [Decided: data-driven]
6. Fixed-timestep simulation, variable-rate rendering. [Assumed]

## Details

### Directory layout
```
src/
  main.ts              bootstrap only
  core/                loop.js, time.js, events.js, input.js, rng.js, assets.js,
                       config.js, settings.js, debug.js, validate.js
  render/              renderer.js, post.js, lights.js, materials.js, textures.js,
                       viewmodel.js, fx/ (fog shafts, particulates, decals, water)
  world/               kit/ (one file per kit piece family), registry.js,
                       levelLoader.js, collision.js, rooms.js, doors.js, triggers.js
  actors/              player.js, humanoid.js (shared body builder), squad/, enemies/
  combat/              weapons.js, hitscan.js, damage.js, debris.js, pickups.js
  ai/                  navgraph.js, pathfind.js, steering.js, perception.js, fsm.js
  script/              sequencer.js, actions/ (one file per action type), flags.js
  dialogue/            dialogue.js, speech.js, hints.js, subtitles.js
  audio/               engine.js, buses.js, reverb.js, synth/ (sfx), ambience.js, music.js
  ui/                  hud/, menus/, styles/
  data/                levels/, dialogue/, sequences/, weapons.json, enemies.json,
                       difficulty.json, kit-manifest.json, keymap.json
public/assets/         future GLB, audio, textures (empty for now)
legacy/inkshot/        old prototype
docs/adr/              these files
```

### Game loop
- Simulation at fixed 60 Hz with an accumulator; max 5 sub-steps per frame (prevents
  spiral of death after tab switches). Render once per frame. [Assumed]
- Order per step: input -> player -> squad -> enemies -> combat -> sequencer -> triggers
  -> audio listener update. Rendering reads final state (no interpolation in the slice;
  add if judder is visible).
- `time.scale` supports slow-motion for set pieces and 0 for pause.

### Events
- `core/events.js`: tiny typed-by-convention event bus. Names are `noun:verb`, e.g.
  `door:opened`, `enemy:limbSevered`, `objective:completed`, `player:died`.
- Systems never import each other just to notify; they emit. Sequences and hints
  listen to events.

### Entities and systems
- Entities are plain classes (`Player`, `SquadMember`, `Enemy`, `Door`, `Pickup`) with
  `update(dt, ctx)`. A `World` object owns lists and exposes queries
  (`world.enemiesNear(pos, r)`, `world.room(id)`).
- `ctx` passed to updates: `{ world, events, time, audio, difficulty, rng, debug }`.

### Data and validation
- JSON files are imported through Vite (`import level from './data/levels/slice01.json'`).
- `core/validate.ts`: hand-rolled type-guard validators (no new runtime dependency) that throw readable
  errors at startup ("level slice01, room R06, piece 3: unknown kit 'corrdor_straight'").

### Determinism
- `core/rng.js`: seeded mulberry32. Procedural geometry and spawn variation use seeds, so
  a level looks identical every load.

### Units and conventions
- Metres, Y up, -Z forward, angles in degrees in data and radians in code.
- Kit piece origin: floor centre of its footprint.

### Debug
- `?debug` enables: Stats panel (three/examples `stats.module.js`), lil-gui (shipped in
  three/examples, no new dependency), collider/trigger/navgraph overlays, free-fly camera
  (F1), god mode (F2), sequence jump `?seq=<id>`, checkpoint jump `?cp=<id>`.

### Persistence
- Saves: superseded by ADR-0016 (checkpoint autosave + save stations, 3 slots). Settings and difficulty in
  `localStorage`. Game over (downed rules, ADR-0004) restarts from the last in-memory checkpoint.

## Consequences
- Old modules are not reused directly; useful pieces (pointer lock, AABB movement, Web Audio
  synth helpers) are ported deliberately.
- Adding a chapter = new level JSON + dialogue JSON + sequences JSON, plus new kit pieces
  only when the art needs them.

## Alternatives rejected
- Plain JS with JSDoc: less setup, but weaker guarantees across many data formats and systems.
- Full ECS library (bitecs etc.): overkill for tens of entities, harder to read.
- Game engine (Babylon, PlayCanvas): more features, but a rewrite away from the Three.js
  knowledge already in the repo.
- Unity/Godot web export: loses the "just a web project" simplicity.

## Execution steps
1. `git mv src legacy/inkshot/src` (and old `index.html` copy); requires delete permission for
   git to clean up lock files on the user's machine.
2. Add `typescript` as a dev dependency, `tsconfig.json`, `typecheck` script; create directory skeleton, `main.ts`, `core/*` with loop, events, input, rng, settings,
   validate, debug.
3. Render a placeholder grey room with a free camera to prove the loop.
4. Update README (controls placeholder, run instructions, link to ADRs).

## Definition of done
- `npm run dev` shows an empty room at 60 fps, `?debug` shows stats and lil-gui.
- `npm run build` and `npm run typecheck` succeed with no errors.
- A malformed JSON field produces a readable startup error.

## Open questions
- None blocking.

## Progress log
- 2026-11-15: Implemented. Legacy moved to `legacy/inkshot/`; TS strict config; `core/`
  (events, loop, input, rng, settings, validate, debug, freeCamera); typed keymap data;
  baseline renderer; grey test room; README.
  Verified in Claude's sandbox: 17 unit tests pass (validator error paths, RNG determinism,
  loop stepping/backlog/pause, events, settings merge, shipped keymap), all files parse.
  **Not yet verified** (needs `npm install`, blocked in the sandbox): `npm run typecheck`,
  `npm run build`, running in the browser, 60 fps check. Justin to run these.
  Deviation: `FreeCamera` lives in `core/` (debug fly camera, later F1).
