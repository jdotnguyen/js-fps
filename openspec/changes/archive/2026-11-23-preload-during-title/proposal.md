# Proposal

## Why

New game, Continue and Load game all run one long loading pipeline: textures, procedural sound synthesis, sample decode, model and mocap downloads, level build, navmesh, physics, then GPU upload and shader compile. None of it starts until the player picks a menu entry, even though the player spends the splash and menu time doing nothing the loader could not use. Most of that work does not depend on which entry they pick, only on the level and the graphics quality. Moving it into the splash and menu time shortens the visible load.

## What Changes

- The title now does background work. While the splash and title menu are showing, the shell prepares everything a session needs that does not depend on the player's choice and does not need a WebGL context: the session, mocap, physics and navmesh code and wasm; the default level's JSON, validated and built into a world in memory, and its navmesh; the body, weapon, seabed and submarine models; the mocap packs; the procedural textures; the procedural sound effects; and the gameplay samples.
- Session loading adopts the prepared results instead of rebuilding them. A session that finds no matching prepared results, or a failed preparation, loads exactly as it does today.
- Prepared results are keyed by level and graphics quality. Changing quality on the title discards the quality-dependent results and prepares them again. Choosing a save whose level is not the prepared level drops the level-specific results and keeps the shared engines and assets.
- Returning to the title after a session prepares again.
- The splash can no longer be skipped. The click-or-key gate that unlocks audio stays, because browsers require it. `?nosplash` and the developer and sandbox auto-load URLs still bypass the splash and load directly.
- Preparation yields to the splash, the menu and the title music: it runs in workers where it can, and in idle slices on the main thread otherwise. Menu interaction pauses it.
- **BREAKING**: the requirement that the title screen fetch no level, model, texture, navmesh or gameplay-audio data is replaced. The title still creates no renderer and holds nothing on the GPU.
- Out of scope, recorded as a follow-up: creating the renderer, uploading textures and compiling shaders at the title (Phase 2). The baseline shows compile is slow only on a cold driver cache. The GPU stages stay in the loading screen.
- The session logs a per-stage timing breakdown so the result can be measured, and so Phase 2 can be sized.

## Capabilities

### New Capabilities

- `title-preload`: what the shell prepares while the splash and title menu show, how prepared results are keyed, adopted, invalidated and discarded, how preparation yields to the menu, and how a failed or missing preparation falls back to the normal load.

### Modified Capabilities

- `session-loading`: the title no longer has to fetch nothing; the splash is unskippable once audio is unlocked; the loading stages adopt prepared results when present.

## Impact

- `src/app/shell.ts`, `src/app/coordinator.ts`: start, pause, re-arm and discard the preparation.
- `src/app/session.ts`: split loading into preparing the level-and-quality-dependent assets and applying the player's intent; adopt prepared results; stage timings.
- `src/ui/splash.ts`: remove skipping; keep the audio-unlock gate.
- `src/audio/engine.ts`, `src/render/materials.ts`, `src/world/level.ts`, `src/render/tex/`: results must be producible before a session exists and hand over to it.
- Tests next to these modules; the shell test covers the title lifecycle.
- Memory: prepared results stay in memory while the title shows. Accepted for this change.
