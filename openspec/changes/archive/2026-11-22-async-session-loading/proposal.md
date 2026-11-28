# Proposal

## Why

Opening the game currently builds the entire 3D level (`slice01`), downloads and parses all kit/prop/character/weapon GLBs, decodes 96 photo textures, builds the Recast navmesh, spawns all cast NPCs, and synthesizes all sound effects synchronously before the title menu appears — solely to render the 3D attract camera behind `#menu`. Even after that slow, choppy boot, pressing **New Game** triggers a harsh frame-1 freeze because `renderer.compile()` ran while `squad`, `npcs`, `enemies`, `viewmodel`, and non-attract rooms were hidden, forcing synchronous shader compilation and texture uploads the moment play begins, while mid-game room transitions, first spawns, water/camera-feed lazy allocations, Rapier init, and 426 concurrent audio decodes introduce further stutters.

## What Changes

- Split `src/main.ts` into a lightweight `AppShell` (settings, saves, UI audio, `MenuMusic`, splash, `#menu`, 2D title backdrop, credits) and an on-demand `PlaySession` (WebGL renderer, materials, level, navmesh, physics, cast/squad/enemies, viewmodel, HUD, sequences, loop).
- Replace the title screen's live 3D attract camera with a lightweight CSS/SVG + subtle ambient 2D canvas backdrop so the title menu opens with zero WebGL context and zero level/asset downloads.
- Add a fullscreen session loading screen (themed station graphic + real staged progress bar + stage label) shown when the player starts **New Game**, **Continue**, or **Load Game**.
- Make heavy session construction asynchronous and non-blocking:
  - Defer game SFX rendering/decoding out of shell boot; render procedural game SFX in yielded chunks and throttle background SFX/VO `decodeAudioData` jobs so they do not compete with gameplay frames.
  - Decode photo textures off the main thread (`createImageBitmap`) and pre-upload textures to the GPU in yielded chunks (`renderer.initTexture`).
  - Chunk `Level` room construction, collider AO baking/merging, and cast NPC creation across animation frames so the loading UI stays responsive.
  - Build the Recast navmesh Detour binary inside a Web Worker (with a synchronous fallback for Node/headless tests).
  - Initialize the Rapier `PhysicsWorld` during session loading (when physics switches are enabled) instead of popping in mid-play.
  - Pre-warm WebGL pipelines (`renderer.compileAsync()` + one hidden warm frame) across all rooms, cast/squad/enemy body shaders (`onBeforeCompile`), viewmodel, gore canvas textures, water reflection/ripple targets, and security camera feed shaders before revealing gameplay.
- Fade directly from 100% loading into play (no extra click gate): `New Game` plays the on-rails intro and locks the pointer on first click once control returns; `Continue` / `Load Game` enters play with the existing `"Click to continue"` prompt until clicked.
- Fully dispose the `PlaySession` on **Quit to title** (level geometry/materials/pools, Recast navmesh, Rapier physics, merged material caches, post-processing targets, water/camera-feed targets, characters/viewmodel/gore, `WebAudioVoicePlayer`, session `EventBus`, and `WebGLRenderer` + fresh `<canvas>`) so returning to the title reclaims JS heap and GPU VRAM.
- Auto-trigger session loading (bypassing the title menu) when debug/sandbox URL parameters (`?debug&jump=`, `?level=corner|lab|demo|kit_test`, etc.) are present.

## Capabilities

### New Capabilities
- `session-loading`: Defines shell-only startup with a non-WebGL 2D title backdrop, staged async session loading with progress UI, GPU/audio/navmesh/physics pre-warming to eliminate New Game and mid-game stutters, seamless fade-in handoff, full session disposal on Quit to title, and debug URL auto-loading.

### Modified Capabilities
- `runtime-memory`: Adds a requirement that returning to the title screen disposes the active play session and releases its JS heap, decoded VO audio, and GPU resources back near the shell baseline, verified across repeated Quit-to-title -> New Game cycles.

## Impact

- **Code**: `src/main.ts` (split into `src/app/shell.ts` and `src/app/session.ts` or equivalent), `src/ui/menus/titleBackdrop.ts`, `src/ui/loadingScreen.ts`, `src/ui/styles/menu.css`, `src/ui/menus/screens.ts`, `src/game/game.ts`, `src/world/level.ts` (async chunked builder + `dispose()`), `src/world/kit/merge.ts` (scoped/disposable material caches), `src/world/registry.ts`, `src/render/textures.ts` (`createImageBitmap`), `src/render/materials.ts` (`disposeMaterials`), `src/render/post.ts` (`dispose()`), `src/render/water/system.ts` (eager warm), `src/render/cameraFeed.ts` (shader warm), `src/render/viewmodel/viewmodel.ts` (`dispose()`), `src/ai/navmesh.ts` + `src/ai/navmeshWorker.ts`, `src/ai/squad.ts` (`dispose()`), `src/ai/npcs.ts` (`dispose()`), `src/actors/bodyModelLibrary.ts` (`dispose()`), `src/actors/gore.ts` (eager canvas textures + `dispose()`), `src/audio/engine.ts` (UI-only boot subset + chunked/throttled game audio), and `src/dialogue/voicePlayer.ts` (throttled/prioritized VO decode + `dispose()`).
- **Tests**: Unit tests for chunked level construction, NavMesh worker/sync parity, session disposal/re-creation, throttled audio loading, and debug URL auto-load; browser playtest & `?slot=scratch&memprobe` verification for boot speed, frame-1 smoothness, and Quit-to-title memory release.
- **Related changes**: Complementary to `trim-startup-bundle` (which shrinks the entry chunk and ships `.wasm` separately). No dependency changes required; uses standard Web APIs (`createImageBitmap`, `WebGLRenderer.compileAsync`, Web Workers).
