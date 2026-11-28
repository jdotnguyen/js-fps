# Tasks

## 1. Session Disposal & Cache Hygiene

- [x] 1.1 Add `disposeMaterials(materials)` in `src/render/materials.ts` (closing `ImageBitmap` sources and disposing textures/materials), add `disposeMergeCaches()` in `src/world/kit/merge.ts`, and add `clearTrackedAnisotropy()` in `src/render/anisotropy.ts`; verify with a unit test that recreating materials and merge caches after disposal produces valid materials with no stale references (`npm test -- src/render/anisotropy.test.ts`).
- [x] 1.2 Add `Level.dispose()` in `src/world/level.ts` (disposing room/door/exterior/hull/water/particulate geometries & materials, `LightPool`, `ShadowPool`, `WaterSurface`s, and destroying Recast `NavMesh`/`NavMeshQuery`) and `KitRegistry.dispose()` in `src/world/registry.ts`; verify with a colocated unit test that building and disposing a level releases its resources cleanly (`npm test -- src/world/level.test.ts`).
- [x] 1.3 Add `.dispose()` methods to `Post` (`src/render/post.ts`), `Squad` (`src/ai/squad.ts`), `NpcDirector` (`src/ai/npcs.ts`), `Viewmodel` (`src/render/viewmodel/viewmodel.ts`), `GoreSystem` (`src/actors/gore.ts`, also resetting its module-level `cloudTex`), `BodyModelLibrary` (`src/actors/bodyModelLibrary.ts`), and `WebAudioVoicePlayer` (`src/dialogue/voicePlayer.ts`, disconnecting nodes and clearing decoded buffers); verify `npm run typecheck` passes and existing actor/dialogue unit tests stay green.

## 2. Async Asset Decoding, Chunked Builds & NavMesh Worker

- [x] 2.1 Update `loadPhotoTextures` in `src/render/textures.ts` to decode `.webp` files off the main thread via `fetch` + `createImageBitmap(..., { imageOrientation: 'flipY' })` with `TextureLoader` fallback when `createImageBitmap` is unavailable, and add a helper to collect session textures for chunked `renderer.initTexture()` pre-upload; verify with a unit test covering both `createImageBitmap` and fallback paths (`npm test -- src/render/textures.test.ts`).
- [x] 2.2 Implement `src/ai/navmeshWorker.ts` and `NavMeshNav.buildAsync(opts)` in `src/ai/navmesh.ts` so browser builds voxelize and serialize the Detour `UnsignedCharArray` bytes in a Web Worker (transferring the `ArrayBuffer` back to `navMesh.initSolo()`), falling back to synchronous `buildNavMesh()` when `Worker` is unavailable; add a parity test confirming `NavMeshNav.buildAsync()` matches synchronous pathfinding and door-area toggling (`npm test -- src/ai/navmesh.test.ts`).
- [x] 2.3 Add chunked async level building (`loadLevel` / `Level.buildAsync`) in `src/world/level.ts`, `KitRegistry.preload()` progress + yielded GLB parsing in `src/world/registry.ts`, and batched `NpcDirector.spawnFromLevelAsync()` in `src/ai/npcs.ts`, yielding via `requestAnimationFrame` in browsers and resolving immediately in Node tests; verify with a unit test checking progress monotonicity and unchanged room/NPC output (`npm test -- src/world/level.test.ts`).
- [x] 2.4 Update `AudioEngine` (`src/audio/engine.ts`) so shell boot renders/loads only UI sounds (`uiHover`, `uiSelect`, `uiMenuOpen`) while gameplay procedural SFX render in yielded chunks and `loadSamples()` prioritizes core gameplay SFX before throttling non-urgent samples; update `WebAudioVoicePlayer.loadLines()` (`src/dialogue/voicePlayer.ts`) to throttle background VO decoding (concurrency 1–2 with idle yields, prioritizing intro/active lines first); verify with unit tests for UI-only boot, chunked SFX, and throttled VO decoding (`npm test -- src/audio/engine.test.ts src/dialogue/voicePlayer.test.ts`).

## 3. 2D Title Backdrop & Staged Loading Screen UI

- [x] 3.1 Build `TitleBackdrop2D` (`src/ui/menus/titleBackdrop.ts` + styles in `src/ui/styles/menu.css`) rendering a lightweight CSS/SVG + subtle ambient 2D canvas underwater visor backdrop with `start()`/`stop()` controls and `reducedMotion`/`reducedFlashing` support; verify with a unit test for start/stop lifecycle and reduced-motion static rendering (`npm test -- src/ui/menus/titleBackdrop.test.ts`).
- [x] 3.2 Build `LoadingScreen` (`src/ui/loadingScreen.ts` + markup/styles in `index.html` / `src/ui/styles/menu.css`) showing a themed station graphic, monotonic progress bar (`0%`–`100%`), stage label, and error recovery state; verify with a unit test confirming progress clamping, stage label updates, and show/hide/error transitions (`npm test -- src/ui/loadingScreen.test.ts`).

## 4. Shell / PlaySession Split, GPU Pre-Warm & Debug Auto-Load

- [x] 4.1 Add eager GPU warm hooks: pre-create `GoreSystem` canvas textures on construction (`src/actors/gore.ts`), add `WaterSystem.warm(renderer, scene, camera)` (`src/render/water/system.ts`) to pre-allocate the reflection target and compile `RippleSim`/`WaterSurface`, and add `feedGl.warm()` (`src/render/cameraFeedGl.ts`) to pre-compile CCTV shaders; verify `npm run typecheck` and existing water/camera-feed tests (`npm test -- src/render/cameraFeed.test.ts src/render/water/system.test.ts`).
- [x] 4.2 Extract `AppShell` (`src/app/shell.ts`) and `PlaySession` (`src/app/session.ts`) from `src/main.ts`, wiring `src/ui/menus/screens.ts` and `src/game/game.ts` so:
  - Cold boot runs shell-only setup (no `WebGLRenderer`, no level/GLB/texture/WASM/VO fetches) and shows `TitleBackdrop2D` + `#menu`.
  - `New game`, `Continue`, and `Load game` open `LoadingScreen`, run the staged async pipeline (materials, parallel fetches, chunked level build, NavMesh worker, Rapier `PhysicsWorld.create()` when enabled, batched cast spawns, chunked `initTexture()`, `compileAsync()` across all rooms + characters + representative enemy/body-model shader + viewmodel + gore + water + CCTV + 1 hidden warm render), and fade straight into gameplay (no extra click gate).
  - `Quit to title` calls `session.dispose()`, calls `renderer.dispose()` + `forceContextLoss()`, swaps in a fresh `<canvas id="game">`, and restores `TitleBackdrop2D` + `#menu`.
  - Load failures dispose partial resources and show a recoverable error.
  Verify `npm run typecheck` and add unit tests for shell/session mode transitions and debug URL auto-load parsing (`npm test -- src/app/shell.test.ts`).
- [x] 4.3 Wire debug/sandbox URL auto-load (`?debug&jump=`, `?level=`, `?enemies=`, `?seq=`) in `AppShell` to bypass the title menu and run `LoadingScreen` straight into the requested level/state, and attach/detach `?slot=scratch&memprobe` cleanly across session mount/unmount; verify `?vmlab` still launches the viewmodel lab directly.

## 5. System Verification & Memory Validation

- [x] 5.1 Run full `npm run typecheck`, `npm test`, and `npm run build` and verify zero TypeScript, test, or bundle errors.
- [x] 5.2 Playtest in browser against `npm run preview` (closing browser sessions when done): confirm cold boot reaches title menu with 0 WebGL contexts and 0 `.glb`/`.webp`/`.wasm`/VO network requests; confirm Graphics Quality changed on title applies on first New Game; confirm loading screen progress bar animates smoothly without stalling; confirm New Game intro frame 1, Continue/Load handoff (`Click to continue`), Flooded Tunnel water entry, first enemy spawn/hit, and `?level=slice01&debug&jump=r11` all run without harsh freezes.
- [x] 5.3 Measure memory with `?slot=scratch&memprobe` across Title -> New Game -> Quit to title (3 cycles) and verify JS heap releases at least 85% of active session heap and stays within 15% of the warm post-first-import title baseline after GC, live GPU textures/buffers drop to 0 on title, session 3 stays within 10% of session 1, and player save slots remain untouched.

## Workflow follow-up

- Run `openspec apply` (outside explore mode) to implement tasks 1.1–5.3.
- Archive the change once implementation and browser/memory verification are complete.
