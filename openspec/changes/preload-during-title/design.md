# Design

## Context

See `proposal.md` for why. Today `createPlaySession` in `src/app/session.ts` runs every stage after the player picks a menu entry. The shell (`src/app/shell.ts`) already owns the `AudioContext`, the settings, and the title lifecycle through `SessionCoordinator`. Quit to title disposes the whole session, including a forced WebGL context loss (`resetGameCanvas`), and the shell then re-enters the title.

Stage 5 is the first place the player's intent is used (`game.load` or `game.newGame`). Everything before it depends only on the level id, the graphics quality, and settings that cannot change mid-load. The level for New game is `DEFAULT_LEVEL`; for Continue and Load it comes from the save.

Constraints:

- No renderer and nothing held on the GPU at the title (`session-loading`); a limits probe is allowed (D10).
- A session must keep loading correctly with no preparation (debug URLs, a failed preparation, a different level).
- The Shared Machine notes in `AGENTS.md` limit tabs and test runs, so tests use the node test runner and fake loaders, not a browser.

## Goals / Non-Goals

**Goals:**

- One loading code path. A session asks for what it needs; each item is either already prepared, in flight, or built on the spot.
- Preparation never makes the splash, menu or music stutter.
- Per-stage timings, so the saving is measured and Phase 2 can be sized.

**Non-Goals:**

- Creating the renderer, uploading textures or compiling shaders at the title (Phase 2). Those stay in the loading screen. The world is built at the title, but not rendered or uploaded. Shader compile is slow only on a cold driver cache (about 15.8 s then, 0.9 s warm), which Phase 2 would address.
- Preparing levels other than the default. A save on another level drops only the level-specific results.
- Changing what any stage produces. Only when and where it runs changes.
- A memory ceiling or idle timeout for held results. RAM is not a constraint for this change.

## Decisions

**D1. A `TitlePreload` holder owned by the shell, keyed by `(levelId, quality)`.**
The key also carries the GPU limits from D10. It holds a promise per item, not finished values, so a session started mid-preparation awaits the work in flight instead of starting it again. The session receives it as an optional dependency and calls `take(item)`. A hit returns the promise, which then counts as consumed. A miss, a key mismatch or a failure runs the existing loader. Alternative: hand the session a ready-made bundle at start. Rejected because it forces the session to wait for everything or ignore everything, and it makes a partial preparation a special case.

**D2. Items are grouped by what invalidates them.**

| Group | Items | Invalidated by |
|---|---|---|
| Shared | session, mocap library, physics and navmesh chunks and wasm; body, weapon, seabed and submarine models; mocap packs; gameplay samples; procedural SFX | nothing in this change |
| Quality | procedural textures (size follows the tier) | quality change |
| Level | level JSON validated, the built world (see D9), navmesh build | level mismatch, quality change, GPU limits mismatch |

A quality change on the title (`settings:changed`) drops the Quality group and the built world (which holds the materials) and starts them again. A session on a different level drops the Level group at `take` time and builds it normally. Shared items are never dropped except on dispose.

The baseline in `docs/PLAYTEST.md` shows the level build as the largest warm stage (about 5.5 s of 10 s), so the built world is the main item of this change, not an extra.

**D3. Items are consumed once and handed over to the session.**
Models, packs and audio buffers become session-owned when taken, and the session disposes them as today. Anything the shell keeps for itself (UI sounds, menu music) stays out of the holder. After Quit to title the holder is rebuilt from scratch (D6), so nothing a disposed session owned is ever reused.

**D4. SFX synthesis and sample decode move off the splash's critical path.**
Procedural SFX synthesis (`renderSoundsAsync`) today runs on the main thread and yields every four sounds. At the title it runs in small slices with a yield between each, and slices pause while the menu is interacted with. If the slices still cost visible frames in measurement, moving synthesis to a worker is the next step, and it is listed as a task to measure first, not assumed. The audio engine needs to accept buffers rendered before a session starts; the shell's `AudioContext` already exists. Textures already generate in a worker and need no change beyond being startable early.

**D5. The splash becomes unskippable, and the title starts the preparation.**
`startSplash` loses its skip input handlers. The wait-for-gesture step stays, because it unlocks audio. The preparation does not wait for that click: the shell arms it when the title is entered, so the splash loader's wait, the click prompt and the two splash cards (about 4 s each) are all window. Level and quality are known then: level is `DEFAULT_LEVEL`, quality is the current setting. `?vmlab` and the auto-load URLs do not prepare, because they load a session immediately and the loading screen does the work as today; `?nosplash` alone still shows the title, so it prepares.

**D6. Preparation is armed by the coordinator and re-armed on `enterTitle`.**
`SessionCoordinator.enterTitle` starts a fresh holder; `start` hands the current holder to `createSession` and clears it. So a Quit to title always gets a new one, and a failed load that returns to the title does too. Sessions never see a holder that a previous session consumed.

**D7. Failure is per item.**
A rejected promise is removed from the holder and logged at `console.warn`. The session's `take` then builds that item itself, so a real fault still shows its real error from the normal path, once. Preparation never throws into the shell.

**D8. Timings come from one small stage timer in the session.**
The loading pipeline already has named progress points. A timer records start and end per stage and whether each stage's inputs came from the holder, and logs one summary line at ready. It adds no behavior, so it can land first and give the baseline numbers before any other task changes the load.

**D9. The built world is prepared as one bundle the session adopts whole.**
`loadLevel` builds Three.js objects and needs no GL context, but it takes the session's event bus, inventory, scene and materials, and subscribes to the bus. So the preparation creates its own `EventBus`, `Inventory`, `Scene` and materials, builds the level against them, and hands the bundle `{ events, inventory, scene, materials, registry, level }` to the session. The session uses those objects in place of the ones it would have created at the top of `createPlaySession`. The decision to adopt is made once, at the start, from `(levelId, quality, GPU limits)`; there is no mixing of a prepared level with a fresh bus. The session still does the GL-dependent work on the adopted scene: environment map, background, fog, anisotropy and the material-unit measurement.
Alternative: build the level at session start but earlier (overlapping stages). Rejected because the level build is serial main-thread work; overlap does not shorten it.

**D10. GPU limits come from a short-lived probe.**
The level's light budget depends on `clampTier`, which needs the GPU's max texture units and fragment uniform vectors, and the materials' anisotropy needs the GPU's maximum. A probe creates a context on an `OffscreenCanvas` (or a detached canvas), reads those three numbers, and loses the context at once. It holds no scene or GPU resources, so the title still has no renderer. The numbers join the key, so a world built for other limits is never adopted. Anisotropy is set afterwards through the existing `setAnisotropy`, which retargets tracked textures. The probe replaces the "no WebGL context at all" wording with "no renderer and no resources held on the GPU".

**D11. The level build runs in budgeted slices on the main thread.**
`Level.buildAsync` already yields between chunks. At the title the slices are bounded by a time budget per frame, so the splash animation keeps frames, and they pause while the menu is interacted with. The build is about 5 s of main-thread work; spread over the splash and menu it costs the splash some frame time, which tasks 4.x measure. If it is visibly rough, the slice budget shrinks and the build takes longer in the background; the load still gains whatever finished.

**Outcome of D11 (2026-11-23).** First measurement, with a click at 0.3 s: 32 long tasks of 80-690 ms in the first 9 s (about 6 s of main-thread work), so the splash cards hitched. A CPU profile of the trace attributed about 4 s of it to the level's per-room merge and AO bake, about 0.5 s to preparing body models, and the rest to room geometry builds and single sounds.

Two changes followed, to make the splash smooth at the cost of finishing the preparation later (about 8.8 s to 11 s after load):
1. The room merge and AO bake run as one generator (`AoMergeBuilder.buildSteps`, `Level.mergeRoomSteps`) that ends a step after each mesh added, each geometry baked and each merge. The synchronous path runs it to the end; the title runs it through a `TimeSlicer` that hands the thread back after 6 ms of work (`TITLE_SLICE_MS`). One code path, two drivers.
2. Preparing body models, which cannot be cut into small steps without rewriting `prepareBodyModel`, runs one model at a time and only after the splash has ended, when nothing animates.

Result over the whole splash with an immediate click: frames over 50 ms 36 to 9, over 100 ms 19 to 3, worst 450 ms to 217 ms. What is left is single room-geometry builds (55-250 ms) and single sounds (70-100 ms). Cutting the room build into steps the same way, and synthesizing sounds in a worker, are the next steps if that is not smooth enough.

**D12. An unadopted world is disposed.**
A bundle that is dropped (quality change, level mismatch, quit to title, failure) has its geometries, materials, textures and bus listeners disposed by the holder, so repeated invalidation does not leak.

## Risks / Trade-offs

- **Building the world before a session changes assumptions the level made.** The level may read the session's state at construction time (the bus, tutorials, flags). → The bundle is built against its own bus and inventory and is only adopted whole; a test builds the level both ways and compares its observable state; construction-time reads of anything else are found and moved in task 4.2.
- **The probe context itself.** → It lives for one call, holds nothing, and its limits are cached for the page's lifetime. If the probe fails, the world is not prepared and the normal load runs.

- **Main-thread slices still cost frames during the splash.** → The splash animation is the visible thing at risk. Slice size is small and measured; if frames drop, synthesis moves to a worker (D4). The measurement uses the playtest approach from `docs/PLAYTEST.md`, timing the callback plus `gl.finish`, not fps, because vsync hides it.
- **The default level is not the one the player loads.** → Only the Level group is lost; the Shared group, which is most of the cost, is still used. Measured in tasks.
- **A stale result is used after a quality change.** → The holder is keyed by quality and a change drops the Quality group at once; a test covers the race where a change lands mid-generation.
- **A preparation in flight when the player starts holds the load back.** → It is awaited, which is never slower than starting it again, and anything not started yet is built as part of the load.
- **Behavior drift from adopting prepared buffers.** → Items are the same producers called earlier, with the same inputs. Tests compare an adopted load and an unprepared load for the same level and quality.
- **Unskippable splash annoys repeated launches.** → Accepted. `?nosplash` stays for development.

## Migration Plan

No data or save format changes. Rollback is reverting the change; the session keeps working with no holder. Land the stage timer first to capture a baseline, then the holder with the shared items, then the quality and level groups, then the splash change.

## Open Questions

- Whether SFX synthesis needs a worker. Decided by the measurement in the task list, and it changes only where that stage runs.
