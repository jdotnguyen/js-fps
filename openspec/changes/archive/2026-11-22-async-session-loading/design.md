# Design

## Context

See `proposal.md` (Why) for the observed boot chop, New Game freeze, and mid-game stutter sources, and `specs/session-loading/spec.md` + `specs/runtime-memory/spec.md` for behavioral requirements.

Key codebase constraints discovered during exploration:
- `src/main.ts` (1,491 lines) currently builds the entire game inside a single `boot()` closure: `WebGLRenderer`, PMREM environment, synchronous `audio.renderSounds()`, `createMaterialsAsync()`, `loadLevel('slice01')`, `BodyModelLibrary`, `loadMocapPacks()`, `Squad` (which synchronously builds `NavMeshNav`), `EnemyDirector`, `NpcDirector.spawnFromLevel()`, `Viewmodel`, and `renderer.compile(scene, camera)` — all before `game.showTitle()` runs.
- At `renderer.compile()` time (`src/main.ts:691`), `squad.group.visible`, `npcs.group.visible`, `enemies.director.group.visible`, `viewmodel`, and all non-attract rooms are hidden, so their SkinnedMesh / custom `onBeforeCompile` infection / shadow-pool / GTAO / exterior / water / CCTV shaders and textures compile and upload synchronously on frame 1 of play or on first room/combat encounter.
- 96 photo textures (~19.2 MB `.webp`) load via `THREE.TextureLoader` (main-thread decode, lazy GPU upload).
- 140 SFX samples (`audio.loadSamples()`) and 286 VO clips (`voicePlayer.loadLines()`) decode concurrently via `Promise.all` / background workers right as play begins.
- `NavMeshNav` (`src/ai/navmesh.ts:116`) builds the Recast heightfield/contours/polymesh/Detour binary synchronously on the main thread, and `createNavMeshData(params)` already produces a serializable `UnsignedCharArray` consumed by `navMesh.initSolo()`.
- `PhysicsWorld.create()` (`src/main.ts:487`) runs whenever the lazy Rapier download finishes, often mid-intro, mirroring every static collider in one synchronous burst.
- Subsystems lacking `.dispose()` today: `Level` (`src/world/level.ts`), `Materials` (`src/render/materials.ts`) + module-level caches in `src/world/kit/merge.ts`, `Post` (`src/render/post.ts`), `Squad` (`src/ai/squad.ts`), `NpcDirector` (`src/ai/npcs.ts`), `Viewmodel` (`src/render/viewmodel/viewmodel.ts`), `GoreSystem` (`src/actors/gore.ts`), `BodyModelLibrary` (`src/actors/bodyModelLibrary.ts`), `KitRegistry` (`src/world/registry.ts`), and `WebAudioVoicePlayer` (`src/dialogue/voicePlayer.ts`).
- Browser pointer lock (`requestPointerLock()`) requires a direct user gesture; it cannot fire automatically after an asynchronous load finishes.
- `trim-startup-bundle` is an open parallel change targeting entry chunk size and `.wasm` delivery; this design stays orthogonal so both can land in either order.

## Goals / Non-Goals

**Goals:**
- Reduce cold boot to title menu to shell-only setup (zero WebGL context, zero level/model/texture/WASM/VO fetches).
- Keep the loading screen progress bar smooth throughout session construction by chunking CPU work and offloading Recast NavMesh generation to a Web Worker.
- Eliminate the New Game frame-1 freeze and first-encounter mid-game GPU/audio/physics stutters via off-thread image decode, chunked `initTexture()`, `compileAsync()`, eager render-target/canvas-texture prep, and throttled background audio decoding.
- Guarantee clean full-session disposal on Quit to title so memory returns to shell baseline and repeated sessions never leak listeners or GPU resources.
- Preserve existing `?debug&jump=`, `?level=`, `?nosplash`, `?vmlab`, and `?slot=scratch&memprobe` workflows.

**Non-Goals:**
- Changing entry chunk bundling or `.wasm` packaging (owned by `trim-startup-bundle`).
- Rotating gameplay tips on the loading screen (the loading screen shows station graphic + progress bar + stage label only).
- Moving Rapier per-frame physics stepping or `GLTFLoader` scene construction into Web Workers (per-frame stepping is <1 ms and needs synchronous overlap queries; GLB fetch + yielded parse is sufficient).
- Persisting a cached 3D world across Quit to title (the user explicitly prefers full disposal to free RAM).

## Decisions

### D1. Split `main.ts` into `AppShell` and `PlaySession`
Extract two explicit lifecycle layers:
- **`AppShell` (`src/app/shell.ts`)**: Created once at page load. Owns `SettingsStore`, `SaveStore`, validated static tables (`keymap`, `difficulties`, `items`, `uiText`, `scores`), `AudioEngine` (bootstrapped with UI sounds only), `MenuMusic`, `Splash`, `TitleBackdrop2D`, `LoadingScreen`, `EndCredits`, and the title-level `#menu`. Handles menu intents (`onNewGame`, `onLoadSave`, `onAutoLaunch`) by instantiating a `PlaySession`.
- **`PlaySession` (`src/app/session.ts`)**: Created on demand per playthrough. Owns a fresh session-scoped `EventBus` (so tearing down a session never leaves dangling listeners on shell events), a fresh `WebGLRenderer`, `Scene`, `Camera`, `Post`, `Materials`, `Level`/`World`, `NavMeshNav`, `PhysicsWorld`, `BodyModelLibrary`, `Squad`, `NpcDirector`, `EnemyDirector`, `Viewmodel`, `GoreSystem`, `WaterSystem`, `CameraFeeds`, `WebAudioVoicePlayer`, `Guidance`, `SequenceManager`, `Game`, `Input`, `Loop`, and HUD bindings. Exposes `dispose(): void`.

*Alternatives considered:*
- Keep one global `EventBus` and manually track unsubscribe functions across `main.ts`. Rejected: brittle; one missed listener causes ghost audio/NPCs after Quit to title. A per-session `EventBus` plus a tiny bridge for `settings:changed` makes listener leaks impossible by construction.

### D2. Non-WebGL 2D Title Backdrop (`src/ui/menus/titleBackdrop.ts`)
Replace the title attract camera with a pure CSS/SVG + subtle 2D `<canvas>` backdrop rendered behind `#menu` whenever no `PlaySession` is active:
- Deep ocean pressure gradient, subtle drifting abyssal particulates/caustic scan bands, and faint depth/visor telemetry lines matching `#splash` and `titleWordmark.ts`.
- Starts on `showTitle()`, stops its `requestAnimationFrame` loop (and hides/releases its 2D layer) as soon as session loading begins.
- Respects `settings.get().reducedMotion` and `reducedFlashing` (renders a single static frame when reduced motion is enabled).
- `Game.render()` no longer needs a `'title'` attract camera branch; `game.quitToTitle()` invokes a shell callback (`onQuitToTitle`) that disposes the session and re-shows the title backdrop + title menu.

*Alternatives considered:*
- Static pre-rendered screenshot image. Rejected: adds an image asset to maintain whenever level art changes and lacks the living underwater station mood.

### D3. Fullscreen Staged Loading Screen (`src/ui/loadingScreen.ts`)
A dedicated overlay (`#loading-screen`) styled consistently with `#splash` / visor UI:
- Contains a station graphic (inline SVG schematic/depth-ring mark), a deterministic horizontal progress bar (`0%`–`100%`), and a crisp stage label (e.g., `"Preparing textures…"`, `"Downloading station assets…"`, `"Building Docking Ring…"`, `"Generating navigation mesh…"`, `"Compiling shaders…"`).
- Exposed via a lightweight progress controller `{ show(title), setProgress(fraction, label), hide() }` so every async pipeline step reports fractional progress monotonically and never regresses.
- On error, `hide()` runs, any partially built session objects are disposed, and an error banner + `"Back to title"` button (or `#boot-error`) lets the user recover cleanly.

### D4. Chunked Async Level Construction (`Level.buildAsync`)
Convert `loadLevel()` / `new Level()` so heavy synchronous loops yield across frames when running in the browser, while keeping a synchronous path (or immediate `await`) for headless tests:
1. `registry.preload(ids, onItemProgress)` fetches all GLB `ArrayBuffer`s in parallel, then parses them with `MeshoptDecoder`/`GLTFLoader` yielding a frame (`nextFrame()`) between GLB parses so decoding doesn't burst on one frame.
2. Room construction (`buildRoom`) yields after each 1–2 rooms and reports progress.
3. Collider AO baking and `AoMergeBuilder.build()` (currently the single largest CPU stall in `Level`) yields after each room and after door merges.
4. `npcs.spawnFromLevel()` yields in small batches (e.g., 2–3 cast bodies per frame).

A small helper `yieldFrame()` uses `requestAnimationFrame` in browsers and resolves immediately (`Promise.resolve()`) in headless/Node test environments so unit tests pay zero frame-wait overhead.

### D5. Off-Thread Recast NavMesh Web Worker (`src/ai/navmeshWorker.ts`)
Move `buildNavMesh(boxes, doors)` into a dedicated module Web Worker:
- Main thread extracts plain serializable `{ boxes: Aabb[], doors: Array<{ box: Aabb }> }` from `CollisionWorld` and posts them to `navmeshWorker.ts`.
- Worker initializes Recast WASM, runs the exact existing voxelization/contour/polymesh/Detour pipeline up through `createNavMeshData(params)`, copies the resulting `UnsignedCharArray` bytes into a `Uint8Array`, frees all Recast intermediate allocations, and transfers the underlying `ArrayBuffer` back to the main thread (`postMessage({ bytes }, [bytes.buffer])`), then terminates.
- Main thread receives the bytes, ensures `initNavmesh()` is ready, constructs an `UnsignedCharArray`, calls `navMesh.initSolo(rawData)`, builds `NavMeshQuery`, and maps `doorPolys` (milliseconds).
- **Fallback**: When `typeof Worker === 'undefined'` (Node unit tests) or if the worker errors, `NavMeshNav.buildAsync()` transparently falls back to synchronous `buildNavMesh()` on the current thread.
- Compatibility with `trim-startup-bundle`: the worker imports the same `initNavmesh()` helper from `src/ai/navmesh.ts` (or shared init module), so switching Recast to `@recast-navigation/wasm/wasm` automatically works in both worker and main thread.

### D6. Off-Thread Photo Texture Decoding & Chunked GPU Upload
- Update `src/render/textures.ts` (`loadPhotoTextures`) to fetch `.webp` blobs and decode them off the main thread via `createImageBitmap(blob, { imageOrientation: 'flipY' })` when available (falling back to `TextureLoader` in Node/unsupported environments), wrapping the `ImageBitmap` in a `THREE.Texture`.
- Track every texture created by `Materials`, `KitRegistry` imported props, `BodyModelLibrary`, `Viewmodel`, and `GoreSystem`.
- During the loading screen's GPU warm stage, upload textures in small batches (e.g., 6–8 textures per `nextFrame()`) via `renderer.initTexture(tex)` so entering a new room mid-game never triggers `gl.texImage2D` + mipmap stalls.

### D7. Complete GPU Pipeline Pre-Warm (Fixing New Game & First-Encounter Stutters)
Before fading out the loading screen:
1. **Eagerly initialize lazy GPU resources**:
   - Create `GoreSystem` canvas textures (`streakTexture`, `crackTexture(0..2)`, `cloudTexture`) and gore meshes/materials at construction instead of on first hit.
   - Pre-allocate `WaterSystem`'s reflection `WebGLRenderTarget` (for Medium/High) and step one silent `RippleSim` pass so water shaders compile upfront.
   - Pre-compile `CameraFeeds`'s CCTV `ShaderMaterial` pass once (`feedGl.warm()`).
   - If `PhysicsWorld` switches are enabled, `await` `loadPhysics()` + `PhysicsWorld.create()` during the loading screen so static collider mirroring never pops in mid-intro.
2. **Apply start state first**: Run `newGame` initial placement (`intro_shift_change` dock pose) or `load(save)` restore so the camera, lighting, and flags reflect frame 1.
3. **Compile all shaders asynchronously**:
   - Temporarily mark all level rooms, `squad.group`, `npcs.group`, `viewmodel.group`, `gore.group`, and one hidden off-camera warm dummy enemy/body-model mesh (covering the custom `onBeforeCompile` infection shader + SkinnedMesh variants) as visible.
   - Call `await renderer.compileAsync(scene, camera)` (uses `KHR_parallel_shader_compile` where supported).
   - Run one hidden warm render through `waterSystem.update()` + `post.render()` (with the loading screen still opaque above the canvas) so GTAO, UnrealBloom, SMAA, shadow maps, and water reflection pipelines finalize before the canvas is revealed.
   - Restore exact visibility/culling state and dispose the temporary warm dummy if created.
4. **Fade out loading screen**: Hand off straight into play (`New Game` begins `intro_shift_change`; `Continue`/`Load` displays the live scene with the existing `"Click to continue"` prompt until the user clicks for pointer lock).

### D8. Split Boot Audio vs. Throttled Session Audio & VO
- **Shell boot**: `AudioEngine` renders only the 3 UI sounds (`uiHover`, `uiSelect`, `uiMenuOpen`) or fetches their 3 tiny MP3s immediately alongside `MenuMusic` (~<15 ms main-thread work instead of rendering all 30+ procedural SFX at boot).
- **Session loading**:
  - Render remaining procedural fallback SFX in yielded chunks (e.g., 4 specs per frame) during the loading screen.
  - Fetch & decode **priority gameplay samples** (weapons, footsteps, doors, water, core UI/ambience) during the loading screen with bounded concurrency (e.g., 4).
- **Background streaming/throttling after play starts**:
  - Remaining non-urgent ambience/gore/zombie samples and the 286 VO clips in `WebAudioVoicePlayer` decode with low concurrency (1–2 at a time), prioritizing lines for the current beat/intro first, and yielding via `requestIdleCallback` (with `setTimeout` fallback) between `decodeAudioData` calls so audio decoding never causes frame spikes.
  - `WebAudioVoicePlayer.play()` continues to load any uncached line on demand with procedural fallback if a player skips ahead rapidly.

### D9. Full Session Disposal on Quit to Title
Add explicit `.dispose()` methods where missing so `PlaySession.dispose()` cleanly releases everything:
- `Loop.stop()`, `Input.dispose()`, `window` resize/click listeners removed, `SequenceManager.cancelAll()`, `SpeechManager.stopAll()`, `ScorePlayer.stopAll()`, `AmbienceDirector.dispose()`, `PropAudioController.dispose()`, `DoorAudio.stopAll()`, `WebAudioVoicePlayer.dispose()` (disconnects nodes and clears `recorded`/`cache` maps).
- `PhysicsWorld.destroy()`.
- `Level.dispose()`: disposes all room/door/exterior/hull/water/dust geometries and non-shared materials, `LightPool`, `ShadowPool`, `WaterSurface`s, and destroys Recast `NavMesh` + `NavMeshQuery` WASM instances (`navMesh.destroy()`, `query.destroy()`).
- `disposeMaterials(materials)` + `disposeMergeCaches()` (disposes and clears module-level `flatBuckets`, `glowBucket`, `vertexColorVariants` in `src/world/kit/merge.ts` — or scopes caches to the session).
- `Squad.dispose()`, `NpcDirector.dispose()`, `EnemyDirector.dispose()`, `Viewmodel.dispose()`, `GoreSystem.dispose()`, `BodyModelLibrary.dispose()`, `KitRegistry.dispose()`, `Sparks.dispose()`, `WaterSplashes.dispose()`, `WaterSystem.dispose()`, `CameraFeeds.dispose()`, `feedGl.dispose()`, `Post.dispose()`, and PMREM `scene.environment.dispose()`.
- **WebGL context release**: Call `renderer.dispose()` and `renderer.forceContextLoss()`, then replace `<canvas id="game">` with a fresh `<canvas id="game">` element so the next `PlaySession` acquires a clean WebGL2 context without leaking GPU memory on the title screen.
- Ensure `AudioEngine` keeps UI sounds + `MenuMusic` alive on the shell while stopping any lingering world loops and resetting the occluder to `null`.

### D10. Debug, Sandbox, and Memory Probe Auto-Load
- Parse URL query flags in `AppShell`:
  - `?vmlab` continues to bypass the title and launch the viewmodel lab directly.
  - If any of `?debug&jump=`, `?level=`, `?enemies=`, or `?seq=` is present, `AppShell` skips showing the title menu after splash (or immediately with `?nosplash`) and auto-launches `PlaySession` via the loading screen straight into the requested level/jump/mode.
  - `?slot=scratch&memprobe` installs `memProbe` in the shell (attaching/detaching `threeInfo` and `voicePlayer.decodedBytes()` as sessions mount/unmount) so memory measurements cover Title -> New Game -> Quit to Title -> New Game cycles.
  - Preserve `window.__view` screenshot pinning by supporting it whenever a session is running (or via `?level=slice01&nosplash` for title/room shots).

## Risks / Trade-offs

- **[Module-level singleton caches leaking across Quit to title -> New Game]** → Several modules hold module-level maps/textures (`merge.ts` `flatBuckets`/`vertexColorVariants`, `gore.ts` `cloudTex`, `anisotropy.ts` tracked texture set, `mocap.ts` shared library). Mitigation: add explicit `clear`/`dispose` functions for GPU-owning caches (`merge.ts`, `gore.ts`, `anisotropy.ts`), while keeping pure-JSON `mocap` data reusable (small CPU memory, avoids re-parsing) or releasing GPU objects strictly on dispose.
- **[Browser WebGL context creation/loss quirks across repeated Quit -> New Game cycles]** → Replacing `<canvas id="game">` after `renderer.forceContextLoss()` avoids stale context reuse bugs in Chrome/Safari; verify 3+ consecutive Quit -> New Game cycles in Playwright with `?memprobe`.
- **[`createImageBitmap` `imageOrientation: 'flipY'` browser differences or memory lifetime]** → Remember to call `bitmap.close()` on texture disposal (or after `renderer.initTexture(tex)` once uploaded? No — keep `bitmap` alive if context could restore, and close every `ImageBitmap` in `disposeMaterials`!). Fallback cleanly to `TextureLoader` if `createImageBitmap` is unavailable.
- **[Recast WASM worker bundling in Vite dev & prod]** → Vite supports `new Worker(new URL('./navmeshWorker.ts', import.meta.url), { type: 'module' })` (already proven by `texWorker.ts`, `musicWorker.ts`, `scoreWorker.ts`). Test in both `npm run dev` and `npm run build` + `npm run preview`, and verify Node tests hit the sync fallback cleanly.
- **[Pre-warming all rooms with `compileAsync` adds 0.5–1.5 s to the loading screen]** → Acceptable and expected trade-off: shifts GPU compilation from an jarring frame-1 freeze and mid-combat hitches into a smooth progress-bar stage on the loading screen.
- **[Interaction with `trim-startup-bundle`]** → Both touch `src/main.ts` and `src/ai/navmesh.ts`. Keeping `AppShell` / `PlaySession` cleanly factored and routing Recast WASM init through one shared helper minimizes merge friction regardless of which change lands first.

## Migration Plan

Land in incremental, independently testable blocks:
1. **Disposal & cache hygiene** (`Level`, `Materials`, `merge.ts`, `Post`, `Squad`, `NpcDirector`, `Viewmodel`, `GoreSystem`, `BodyModelLibrary`, `KitRegistry`, `WebAudioVoicePlayer`, `anisotropy.ts`) — safe before changing boot flow.
2. **Async building blocks** (`textures.ts` `createImageBitmap`, `navmeshWorker.ts` + `NavMeshNav.buildAsync()`, `Level.buildAsync()` chunked yields, `AudioEngine` UI-subset boot + throttled SFX/VO).
3. **UI components** (`TitleBackdrop2D` + `LoadingScreen` overlay).
4. **Shell / Session split** (`AppShell`, `PlaySession`, GPU pre-warm stage, Quit-to-title teardown, debug URL auto-load).
5. **Verification** (unit tests + browser playtest + `?slot=scratch&memprobe` 3-cycle memory verification).
