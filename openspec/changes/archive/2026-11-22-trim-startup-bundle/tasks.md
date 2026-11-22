# Tasks

## 1. Spike

- [x] 1.1 In a scratch folder on Node 24, install `@dimforge/rapier3d@0.21` and import it from a one-line ESM script, without flags. Verify: it loads and creates a `World`. Result: it does not load (extensionless imports, no `"type": "module"`), so Rapier stays on `-compat` (design D3, D4).

## 2. Build hygiene

- [x] 2.1 Remove the dynamic `import()`s of `src/ui/mapModel.ts` and `src/data/types/level.ts` that the build warns about and import them statically (design D5). Verify: `npm run build` no longer prints the dynamic-import warning, and `npm run typecheck` passes.
- [x] 2.2 Add the entry-budget plugin to `vite.config.ts` (design D6). Verify: a build prints the entry chunk's minified and gzip sizes, and fails if the budget is temporarily lowered to 50 kB.
- [x] 2.3 Extend the plugin with the chunk limits (1,500 kB, and 4,500 kB for `physics`) and set Vite's own limit just above the `physics` one (design D6). Verify: a build prints no size warning, and warns when the general limit is temporarily lowered to 1,000 kB (naming `session`) or the `physics` limit to 4,000 kB.

## 3. Shared clip library as its own chunk

- [x] 3.1 Add `loadSharedMocapLibrary()`, make `sharedMocapLibrary()` throw a named error before it has run, and reset the promise in `clearSharedMocapLibrary()` (design D1). Add `mocap.test.ts` cases for the load, the error, and a reload after clearing. Verify: `npm test -- src/actors/mocap.test.ts`.
- [x] 3.2 Start the load at the beginning of session loading in `src/app/session.ts` and await it before `loadMocapPacks`, and do the same in `src/sandbox/castMotionSandbox.ts`. Verify: `npm run typecheck`, and the game (New game, Continue, Quit to title then New game) and the cast motion sandbox show animated characters in `npm run dev`. Reuse a running server. Done 2026-11-22 on the production preview: New game, Quit to title then New game, and the cast motion sandbox. Continue was not run, because the scratch slot keeps no saves and a real slot would touch player saves; it loads through the same session path.
- [x] 3.3 Load the library once for every test file in a test preload (`scripts/test-setup.ts`, passed with `--import` by `scripts/run-tests.ts`), as a session does before building bodies. Verify: the test files that build characters fail no more tests than on `HEAD` without the change, and `scripts/run-tests.test.ts` covers the preload.
- [x] 3.4 Update the test that owns the mocap-library "Size check" to the modified requirement (session-start clip data, 2 MB). Verify: the test passes, and still fails if the limit is temporarily lowered below the current size.
- [x] 3.5 Verify the spec: in `npm run build`, `mocap-core` is in its own chunk, the entry and `session` chunks don't contain it, and `session` is under 1,500 kB. Record the sizes in design.md Context.

## 4. Recast loads its `.wasm` file

- [x] 4.1 Add `@recast-navigation/wasm` at exactly 0.44.0 as a dependency. Add the default loader and `setRecastLoader()` to `src/ai/navmeshBuild.ts` (design D2). Verify: `npm run build` emits `recast-navigation.wasm-*.wasm`, and `npm run typecheck` passes.
- [x] 4.2 Add `src/ai/navmeshNode.ts` (the `wasmBinary` loader), import it from `src/world/headlessSlice.ts`, and add a test preload passed with `--import` in `scripts/run-tests.ts`. Verify: `npm test -- src/ai/navmesh.test.ts src/ai/navmeshNodes.test.ts src/ai/dockGuardRoutine.test.ts src/world/labWing.test.ts` pass, and `grep -rn navmeshNode src --include=*.ts` shows no browser-side importer.
- [x] 4.3 Check the browser in `npm run dev` on `slice01`. Verify: the Network panel shows `recast-navigation.wasm` fetched, no `wasm-compat` chunk fetched, and NPCs path around the slice. The navmesh is built in the worker; the main-thread fallback is covered by the Node tests, which run the same `init` path. Done 2026-11-22 (dev and preview): `.wasm` fetched, compat chunk not fetched, crew walk in from the doorway.

## 5. Rapier stays on compat

- [x] 5.1 Note in `docs/physics.md` that Rapier stays on `-compat` and why, with the revisit condition (design D3). Verify: the note names the package, the reason, and the `physics` size limit.

## 6. Integration

- [x] 6.1 Run `npm run build`. Verify: no chunk-size or dynamic-import warnings, the entry chunk is within budget, and the navmesh engine is a `.wasm` file.
- [x] 6.2 Run `npm run preview` in Chrome. Check the title screen, New game, Continue, Quit to title then New game, `?physics=debris,ragdoll`, and NPC pathing, using `docs/PLAYTEST.md` and `?slot=scratch`. Verify: characters animate, NPCs path, the navmesh `.wasm` is fetched and its compat chunk is not, and with physics off the `physics` chunk is not fetched. Done 2026-11-22, Chrome only; Continue as in 3.2. With physics on, Rapier loaded and mirrored 914 colliders.
- [x] 6.3 Run `npm run typecheck`, and the test files this change touched. Verify: typecheck passes, and those files fail no more tests than before the change. Done 2026-11-22: the touched test files pass (33/33). Typecheck's only error is in another change's in-progress `src/ai/enemyDirector.ts`; this change's files have none.

## Workflow follow-up

- Archive the change after review. `startup-bundle` becomes a new main spec, and the `mocap-library` delta merges into the main spec.
