# Tasks

## 1. Decouple station asset preloading from materials

- [x] 1.1 Extract `prepareStationAssets` in `src/app/worldBundle.ts` (loading `levelJson`, `kit-manifest.json`, validating `LevelData`, and running `registry.preload`) and update `buildStationWorld` to accept optional preloaded `{ registry, data }`, keeping `prepareWorldBundle` and `level.test.ts` passing (`npm test -- src/world/level.test.ts`).
- [x] 1.2 Ensure `prepareStationAssets` disposes its `KitRegistry` on error and forward `onProgress` cleanly; verify with `npm run typecheck`.

## 2. Overlap independent loads with Stage 1 in `createPlaySession`

- [x] 2.1 In `src/app/session.ts`, start `bodyModelsReady`, `physicsPromise`, `castAssetsPromise`, and (when `!bundle && levelId`) `prepareStationAssets` before awaiting `textures+audio`, attaching safe `.catch(() => undefined)` handlers until awaited.
- [x] 2.2 Guard `loading.setProgress` with a monotonic high-water mark across overlapping progress callbacks and ensure `dispose()` / error recovery cleans up any in-flight `registry`, `bodyModels`, or `materials` on failure; verify with `npm run typecheck` and `npm test -- src/app/shell.test.ts src/app/stageTimer.test.ts`.

## 3. Splash preload on auto-load URLs and time-sliced yields

- [x] 3.1 Add `SessionCoordinator.armPreload()` in `src/app/coordinator.ts` and arm `TitlePreload` during the splash in `src/app/shell.ts` for `launch.autoLoad` URLs; verify with `npm test -- src/app/shell.test.ts`.
- [x] 3.2 Add `sliceMs` `TimeSlicer` support to `KitRegistry.preload()` and `Level.buildAllAsync()`, passing `SESSION_SLICE_MS = 20` from `src/app/session.ts`; verify with `npm test -- src/world/level.test.ts src/core/timeSlice.test.ts`.

## 4. Multi-worker pools for textures and room AO/merge

- [x] 4.1 Shard `TEXTURE_KEYS` across up to 4 `texWorker.ts` instances in `src/render/materials.ts` with per-chunk sync fallback.
- [x] 4.2 Extract `src/world/kit/colliderAo.ts`, implement `src/world/kit/mergeWorker.ts` and `MergeWorkerPool` in `src/world/kit/merge.ts`, and fan out `Level.buildAllAsync()` room merges across the pool in `src/world/level.ts`; verify with `npm test -- src/world/level.test.ts` and `npx vite build`.

## 5. Verification

- [x] 5.1 Run targeted tests (`shell.test.ts`, `stageTimer.test.ts`, `level.test.ts`, `timeSlice.test.ts`) and `npx vite build` to confirm clean compilation and bundle checks.
- [x] 5.2 Measure a cold debug URL load (`?slot=scratch&level=slice01&debug&jump=r11`) and compare `[session] ready in ...` `StageTimer` totals before and after (`12037 ms` -> `3501 ms`).
