# Proposal

## Why

`npm run build` still warns about oversized chunks. `async-session-loading` (archived 2026-11-22) already moved the game out of the entry chunk, which is now 105 kB, and put it behind a loading screen. What remains:

- **`session` (2,173 kB).** The lazy chunk the loading screen waits on. 898 kB of it is `src/data/mocap-core.json`, which is downloaded and parsed in series with the session code.
- **`physics` (4,334 kB) and `recast-navigation.wasm-compat` (729 kB).** Both embed their WebAssembly as base64 inside JavaScript, which makes them about a third larger and stops the browser compiling them while they download. Physics will soon be on by default.
- **The warning itself.** Its 500 kB default flags every lazy chunk, so it says nothing about real regressions, and nothing guards the small entry chunk that `async-session-loading` won.

## What Changes

- The core mocap clip library leaves the `session` chunk. It becomes its own chunk, fetched in parallel when a session starts loading and ready before any body is built.
- Recast's navmesh WebAssembly ships as a separate `.wasm` file through the package's own `@recast-navigation/wasm/wasm` build. Node (the headless slice and tests) gives the same build the file's bytes, read from disk.
- Rapier stays on `@dimforge/rapier3d-compat`: its bundler package cannot be loaded by Node (design D3). Its lazy chunk gets its own size limit instead of the general one.
- `src/ui/mapModel.ts` and `src/data/types/level.ts` are imported only statically, which removes the "dynamically imported … but also statically imported" warning.
- The build enforces a 250 kB entry-chunk budget, and the chunk-size warning is set to flag only real outliers.

## Capabilities

### New Capabilities
- `startup-bundle`: what the game downloads before the title screen and when a session starts. Covers the entry chunk's budget, keeping clip data in its own chunk, how WebAssembly engines are shipped, and when the build warns.

### Modified Capabilities
- `mocap-library`: "The library stays within its size limit" now covers the shared clip data loaded when a session starts, which is fetched as its own chunk.

## Impact

- **Code**: `src/actors/mocap.ts` (async load of the shared library), `src/app/session.ts` and `src/sandbox/castMotionSandbox.ts` (await it), `src/ai/navmeshBuild.ts` and a new Node-only `src/ai/navmeshNode.ts`, `src/world/headlessSlice.ts`, `scripts/run-tests.ts` and a test preload, a small `src/data/mocapCore.ts` module, the importers of `src/ui/mapModel.ts`, and `vite.config.ts`.
- **Tests**: tests that use the shared clip library load it first. Navmesh tests run against the same Recast build the browser uses.
- **Dependencies**: add `@recast-navigation/wasm` (0.44.0, already installed through `recast-navigation`) as a direct dependency.
- **Tooling**: `vite.config.ts` gains the chunk-size plugin and excludes the Recast WebAssembly package from dev pre-bundling. The Node.js minimum stays at 22.6 (design D4).
- **Related**: `async-session-loading` (archived) owns the shell boot and the loading screen; this change only changes what those load. `adopt-physics-engine` D10 (lazy engine chunk) is unchanged.
