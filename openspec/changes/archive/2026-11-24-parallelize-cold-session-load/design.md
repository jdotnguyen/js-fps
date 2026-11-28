# Design

## Context

See `proposal.md` — Why. Cold loads on debug/sandbox URLs (`launch.autoLoad`) skipped `title-preload`, awaited `textures+audio` before starting cast/physics/kit-GLB loads, slept a full animation frame after every GLB and room, and ran all procedural textures and room AO/merge passes on a single worker or the main thread.

## Goals / Non-Goals

**Goals:**
- Overlap independent cold-load fetches (`bodyModels`, `physics`, `weapons`, `mocapPacks`, and station `prepareStationAssets`) with Stage 1 (`textures+audio`).
- Arm `TitlePreload` during the splash on `launch.autoLoad` URLs so splash time prepares the target station level, materials, engines, and audio.
- Use `TimeSlicer` (`sliceMs`) in `KitRegistry.preload()` and `Level.buildAllAsync()` instead of unconditional per-item `yieldFrame()` sleeps.
- Parallelize procedural texture generation across a `texWorker.ts` pool and per-room AO + `mergeVertices` across a `MergeWorkerPool`.
- Keep loading-bar progress monotonic and dispose partially allocated resources cleanly on failure.

**Non-Goals:**
- Moving `GLTFLoader.parseAsync` / `MeshoptDecoder` into workers.
- Changing WebGL `texture-upload` or `shaders+warm` stages.

## Decisions

### 1. Split kit-GLB preloading from `Level.buildAsync` in `worldBundle.ts`
`prepareStationAssets` loads/validates `levelJson` + `kit-manifest.json` and runs `registry.preload` without needing `materials` or a scene. `buildStationWorld` accepts optional `preparedAssets`, keeping `prepareWorldBundle` and `loadLevel` backwards-compatible.

### 2. Overlap Stage 1 & Stage 2 in `session.ts` with monotonic progress
`createPlaySession` starts `bodyModelsReady`, `physicsPromise`, `castAssetsPromise`, and `stationAssetsPromise` before awaiting `textures+audio`, guards `loading.setProgress` with a `maxProgress` high-water mark, and ensures `dispose()` cleans up in-flight `registry` and `bodyModels`.

### 3. Arm `TitlePreload` during splash on `autoLoad` URLs
`SessionCoordinator.armPreload()` initializes `this.preload` without entering the title menu. `shell.ts` configures `TitleArming` with `launch.autoLoad.levelParam` (when it targets a station level) and calls `coordinator.armPreload()` before `await splash.finish()`.

### 4. `TimeSlicer` for `KitRegistry.preload()` and `Level.buildAllAsync()`
`KitRegistry.preload()` accepts `sliceMs` and uses `TimeSlicer`, and `Level.buildAllAsync()` calls `slicer.tick()` after `buildRoom` and `buildExteriorAndDoors`. `session.ts` passes `SESSION_SLICE_MS = 20`.

### 5. Worker pools for procedural textures and room AO/merge
- `generateSetsAsync` in `src/render/materials.ts` shards `TEXTURE_KEYS` round-robin across up to `min(4, hardwareConcurrency)` `texWorker.ts` instances, with per-chunk sync fallback on error.
- `colliderAo` is extracted to `src/world/kit/colliderAo.ts` so `level.ts` and `mergeWorker.ts` share identical AO math. `MergeWorkerPool` initializes up to 4 workers with serialized enabled `CollisionWorld` boxes, then fans out room AO baking, `mergeGeometries`, and `mergeVertices` across rooms in parallel, transferring raw typed arrays back. Node/tests fall back to the existing main-thread path.

## Risks / Trade-offs

- **Worker startup / memory overhead** → Capped at 4 workers per pool and `MergeWorkerPool` is terminated immediately in `finally` after rooms finish merging.
- **Unrelated pre-existing typecheck error in `src/world/slice01.test.ts`** → Verified zero TypeScript errors in all modified/added files and clean `vite build`.
