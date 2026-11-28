# Proposal

## Why

Cold session loads on developer/sandbox URLs (`?level=`, `?debug&jump=`, `?enemies=`, `?seq=`) bypassed `title-preload` and ran stages sequentially on a single worker / main thread (~12.0 s total: `textures+audio` 2.2 s followed by `level` 6.9 s). Overlapping independent loads, arming `TitlePreload` during the splash on auto-load URLs, time-slicing frame yields, and parallelizing texture generation and room AO/geometry merging across worker pools cuts load time to ~3.5 s.

## What Changes

- Start `bodyModelsReady`, `physicsPromise`, `loadWeaponModels()`, `loadSquadPistolModel()`, `loadMocapPacks()`, and station `levelJson` + `registry.preload` concurrently with `textures+audio` in `createPlaySession` (`prepareStationAssets`).
- Arm `TitlePreload` during the splash sequence on `launch.autoLoad` URLs (`coordinator.armPreload()`), targeted at the requested station level when applicable.
- Replace unconditional per-item `yieldFrame()` pauses in `KitRegistry.preload()` and `Level.buildAllAsync()` with a `TimeSlicer` (`20 ms` budget during session loads).
- Shard procedural texture generation (`texWorker.ts`) across up to 4 workers in `src/render/materials.ts`.
- Offload per-room AO baking, geometry merging, and vertex deduplication (`MergeWorkerPool` / `mergeWorker.ts` / `colliderAo.ts`) across up to 4 workers in `Level.buildAllAsync()`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `title-preload`: Also arm preparation during the splash when booting with developer/sandbox auto-load URL parameters (targeting the requested station level when applicable).

## Impact

- `src/app/session.ts`, `src/app/worldBundle.ts`, `src/app/coordinator.ts`, `src/app/shell.ts`
- `src/world/registry.ts`, `src/world/level.ts`, `src/world/kit/merge.ts`, `src/world/kit/mergeWorker.ts`, `src/world/kit/colliderAo.ts`
- `src/render/materials.ts`
