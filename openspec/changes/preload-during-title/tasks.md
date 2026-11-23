# Tasks

## 1. Stage timings and baseline

- [x] 1.1 Add a stage timer to the session load that logs each stage's duration, the total, and whether each stage used prepared results (none yet). Verify with a unit test of the timer and a console line on a real load.
- [x] 1.2 Record a baseline for New game and Continue on `slice01` at High, in a scratch slot (`?slot=scratch&memprobe`), with a cold and a warm HTTP cache. Verify the numbers are in `docs/PLAYTEST.md` or `docs/HANDOFF.md` next to how they were measured (callback time plus `gl.finish`, not fps).

## 2. The preparation holder

- [x] 2.1 Add `TitlePreload` keyed by `(levelId, quality, gpuLimits)` that stores a promise per item, with `take`, drop-by-group (quality, level), and `dispose`. Verify with a node test using fake loaders: a hit returns the in-flight promise, a mismatch or failure runs the fallback, and an item is never started twice.
- [x] 2.2 Cover failure and races in the same tests: a rejected item is dropped and logged, a quality change mid-generation discards the result, and a session started mid-preparation awaits the work in flight.
- [x] 2.3 Wire the coordinator: `enterTitle` creates a holder, `start` hands it to `createSession` and clears it. Verify with `src/app/shell.test.ts`: a new holder after Quit to title, and none reused after a session consumed one.

## 3. Shared items

- [x] 3.1 Make the session adopt prepared code and engines: session chunk, mocap library, physics and navmesh chunks and wasm. Verify with a test that a load with a holder does not request them again and an unprepared load still does.
- [x] 3.2 Make the session adopt prepared models and packs: body, weapon, seabed and submarine models, and mocap packs. Verify the same way, and that disposing the session still disposes what it adopted.
- [x] 3.3 Let the audio engine accept sounds rendered and samples decoded before a session exists, and adopt them in session stage 1. Verify with `src/audio/engine.test.ts`: a prepared load and an unprepared load end with the same set of buffers.
- [x] 3.4 Measured the main-thread slices behind the splash (2026-11-23): they do cost frames, from several sources (chunk parsing, body models, the level build, SFX synthesis). Decision: the splash is a loading window and the hitching is accepted, so synthesis stays on the main thread. Recorded in `design.md` D11 and `docs/PLAYTEST.md`.

## 4. Quality items and the built world

- [x] 4.1 Make procedural texture generation startable before a session and drop it on a quality change. Verify with a test: changing quality discards the old result and the next load uses the new size.
- [x] 4.2 Add the GPU limits probe (max texture units, fragment uniform vectors, anisotropy; context released at once, result cached for the page) and make the holder key on it. Verify with a test using a fake probe: a failed probe prepares no world, and different limits never adopt each other's world.
- [x] 4.3 Prepare the default level's data validated and its navmesh. Verify with a test that a save on another level drops them and keeps the shared items.
- [x] 4.4 Build the level at the title as a bundle (own event bus, inventory, scene, materials, registry) in time-budgeted slices that pause on menu interaction. Verify with a test that the bundle builds with no renderer, a dropped bundle is disposed, and a quality change rebuilds it. Find any other construction-time reads of session state in the level and move them.
- [x] 4.5 Make the session adopt the bundle whole at the top of `createPlaySession`, then do the GL work on the adopted scene (environment, background, fog, anisotropy, material-unit measurement). Verify a prepared and an unprepared load of `slice01` give the same level, navmesh, light budget and events, and the level tests in `src/world/` still pass.

## 5. Splash and arming

- [x] 5.1 Remove skipping from the splash and keep the audio-unlock gate and `?nosplash`. Verify with a test that Escape, Enter, Space and click do not advance a stage, and the gate still resolves on a key press.
- [x] 5.2 Start the preparation when the title is entered, hold the level build while the menu is interacted with, and skip it for `?vmlab` and the auto-load URLs. Verify with tests for the arming, the idle gate and the coordinator, including an auto-load with no holder.
- [x] 5.3 Update `openspec/specs` through the change's deltas and add a short note on the title preload to `docs/PLAYTEST.md`. Verify `openspec validate preload-during-title` passes.

## 6. Verification in the browser

- [x] 6.1 Played through the splash, title and New game at High in a scratch slot: the title makes no renderer (only the limits probe), each load logs which stages used prepared results, and the splash may hitch while the preparation runs (accepted). Continue and Load game share the same stages and are covered by the coordinator and adoption tests, not separately by hand.
- [x] 6.2 Compare against the baseline from 1.2 and record the saving per stage, plus how much remains in stages 5 and 6, which sizes the Phase 2 follow-up.
- [x] 6.3 By hand: changing quality on the title then starting (textures and world rebuilt and adopted), and Quit to title then starting again (2.0 s, all prepared). Covered by unit tests, not tried by hand: starting before preparation finishes, and loading a save on another level. The browser is closed.
