# Design

## Context

See proposal.md (Why). Measured on 2026-11-22 from a `vite build` of `foundation` at `07d0569` (three 0.187, after `async-session-loading`):

```
  chunk                          min        gzip     loads
  index (entry)                    105 kB      38 kB  always
  session                        2,173 kB     634 kB  New game / Continue / Load (loading screen)
    of which mocap-core.json       898 kB
  three                            642 kB     163 kB  with the session
  physics (rapier3d-compat)      4,334 kB   1,644 kB  when a physics switch is on (D10)
  recast-navigation.wasm-compat    729 kB     218 kB  with the session's navmesh
```

After D1 (task 3.5, same day): `index` 105 kB (38 gzip), `session` 1,256 kB (460 gzip), `mocap-core` 917 kB (173 gzip), each fetched as its own chunk.

- `src/app/session.ts:440` awaits `loadMocapPacks(sharedMocapLibrary(), …)` before any body is built. The cast motion sandbox does the same at line 139. `clearSharedMocapLibrary()` drops the compiled library when a session is disposed. `Animator` falls back to `sharedMocapLibrary()`.
- `initNavmesh()` (`src/ai/navmeshBuild.ts`) runs in the navmesh worker, on the main-thread fallback in `navmesh.ts`, and in Node through `src/world/headlessSlice.ts` and the tests.
- `@recast-navigation/core`'s `init(impl)` calls `impl()` to create the module. Without `impl`, it dynamically imports the compat build, so Vite always emits that chunk.
- The `./wasm` build of Recast is compiled for the web only (`ENVIRONMENT_IS_WEB=true`) and fetches its `.wasm` next to its script. Tried on 2026-11-22: in Node it tries to `fetch()` a `file://` URL and aborts, while the browser build emits a 340 kB `.wasm` correctly.
- `@dimforge/rapier3d-compat`'s `init()` takes no arguments, so its WebAssembly can only come from the embedded base64.
- The shared PC runs Node 24.22.3 (nvm-windows) since 2026-11-22. npm 11 no longer runs packages' install scripts by default.

## Goals / Non-Goals

**Goals:**
- Meet the specs in `specs/startup-bundle` and `specs/mocap-library`.
- Use each library's supported packaging and APIs, with no aliasing, no patching of `node_modules`, and the same engine builds in Node and the browser.

**Non-Goals:**
- The shell boot, the loading screen, and pre-warming. `async-session-loading` owns those.
- A binary clip format. Its own change, if loading time calls for it.
- Splitting the session code or `three` further.
- Removing the compat Recast chunk that Vite still emits. Nothing fetches it (D2), and removing it would need an alias.

## Decisions

### D1. The shared clip library is its own chunk, loaded with the session
`mocap.ts` gains `loadSharedMocapLibrary(): Promise<MocapLibrary>`. It runs `import('../data/mocapCore.ts')` and compiles the result. That small module imports the JSON statically with `with { type: 'json' }`, because a dynamic JSON import can't satisfy both Vite and Node: with the attribute, Vite's dev server serves the JSON as JavaScript and the browser rejects it; without it, Node refuses to load it. Callers share one load promise until `clearSharedMocapLibrary()` resets it. Because the module system caches the import, a second session only recompiles. `sharedMocapLibrary()` stays synchronous and throws an error that names the missing `await` if the load hasn't run, so a late caller fails loudly rather than leaving a body with no pose.

`session.ts` starts the load at the beginning of session loading, so it runs in parallel with the other stages, and awaits it before `loadMocapPacks`. The cast motion sandbox does the same. Tests that use the shared library load it in a `before` hook.

*Alternatives:*
- Fetch from `public/`. Rejected: the dynamic import gives a hashed, cacheable chunk.
- Leave it inside `session`. Rejected: that makes its download and parse serial with the session code, and keeps `session` over the warning limit.

### D2. Recast uses its `./wasm` build everywhere, with bytes supplied in Node
`navmeshBuild.ts` keeps one module-level loader: by default, `() => import('@recast-navigation/wasm/wasm').then((m) => m.default())`. `initNavmesh()` passes it to `init(impl)`, so the browser and the worker stream the hashed `.wasm` file. `setRecastLoader(loader)` replaces the loader before the first `initNavmesh()`.

A new Node-only module, `src/ai/navmeshNode.ts`, sets a loader that reads `recast-navigation.wasm.wasm` from disk, next to the resolved `@recast-navigation/wasm/wasm` entry. It hands the bytes to the same factory through Emscripten's documented `wasmBinary` module option: `m.default({ wasmBinary })`. `headlessSlice.ts` imports it, and so does a test preload that `scripts/run-tests.ts` passes with `--import`, so every Node test, worker or not, uses it. Nothing in the browser graph imports `navmeshNode.ts`, so `node:fs` never reaches Vite.

`@recast-navigation/wasm` becomes a direct dependency at the exact version `recast-navigation` uses (0.44.0). It is also listed in `optimizeDeps.exclude`, because the dev server's pre-bundling would move the script away from its `.wasm`, which is Vite's documented case for that option. Production builds are unaffected.

*Alternatives:*
- Keep compat (with an exception in the spec). Rejected by the user.
- Detect Node inside `navmeshBuild.ts` and import `node:fs` dynamically. Rejected: it puts a Node import into the browser graph, which brings Vite's externalization warning or a `@vite-ignore`.
- Compat in Node and `./wasm` in the browser. Rejected: tests wouldn't cover the shipped build.

### D3. Rapier stays on `@dimforge/rapier3d-compat`, with its own size limit
Task 1.1 (2026-11-22) found that Rapier's bundler package, `@dimforge/rapier3d` 0.21, cannot be loaded by Node. It has no `"type": "module"` and uses extensionless relative imports (`from "./exports"`), and no Node option resolves those; only a custom resolver hook would. The `-compat` package's `init()` takes no arguments, so its embedded base64 module is the only way to load it. The user chose to keep `-compat` (2026-11-22). The physics chunk stays lazy and is fetched only when a physics feature is on (`adopt-physics-engine` D10). It gets its own limit in D6 instead of an exemption, so it still cannot grow unnoticed.

Revisit when Rapier publishes a package that both Node and Vite can load without a custom resolver.

*Alternatives:*
- `@dimforge/rapier3d` in the browser and `-compat` in tests. Rejected: tests wouldn't cover the shipped build.
- `@dimforge/rapier3d` everywhere with a Node resolver hook in the test preload. Rejected: a workaround for the package's layout.

### D4. The Node.js minimum is unchanged
Node 24 was only needed for Rapier's bundler build (D3). Everything else in this change (`--import`, `import.meta.resolve`) works on the documented minimum, Node 22.6, so `README.md` and `AGENTS.md` stay as they are. The shared PC runs Node 24.22.3 since 2026-11-22, which is within that range.

### D5. `mapModel.ts` is imported statically everywhere
`guidance.ts`, `mapScreen.ts` and `wayfinding.ts` import it statically, so it is already in the same chunk as its dynamic importer. Remove whichever `import('…/mapModel.ts')` the build warns about (now in `session.ts`). No chunk changes.

### D6. The warning limit and entry budget live in `vite.config.ts`
A local plugin in `vite.config.ts`, using the `generateBundle` hook, owns chunk-size checks:
- It prints the entry chunk's minified and gzip sizes, and calls `this.error()` above 250 kB. Today's entry is 105 kB, so the budget leaves room for the shell to grow without letting the session code leak back in.
- It warns about any chunk over 1,500 kB, except `physics`, which warns over 4,500 kB (D3; it is 4,334 kB today). After D1 the largest other chunk is `session`, at 1,256 kB.

Vite's own warning (`build.chunkSizeWarningLimit`) is set just above the `physics` limit, so it can't report the allowed chunk a second time. The plugin is the one place the limits live.

*Alternatives:*
- A separate post-build script. Rejected: easy to skip.
- Raising Vite's limit to cover `physics`. Rejected: that hides every other chunk up to 4.5 MB.

## Risks / Trade-offs

- [`wasmBinary` handling differs in a future Recast release] → It is a standard Emscripten option, and the version is pinned exactly. The navmesh tests fail loudly if it breaks.
- [A Node entry point that skips the preload] → `initNavmesh()` in Node without the Node loader fails with the existing `fetch failed` abort. `navmeshNode.ts` names itself in that error path's docs, and `headlessSlice.ts` imports it directly.
- [Rapier's 4.3 MB base64 chunk is fetched on every level load once physics is on by default] → It loads behind the loading screen, in parallel with the session. D6's `physics` limit catches growth, and D3 names when to revisit.
- [Something builds a body before the clip load finishes] → `sharedMocapLibrary()` throws (D1). The playtest covers New game, Continue, Quit to title then New game, and the cast motion sandbox.

## Migration Plan

Land D5 and D6, then D1 and D2. Each one reverts on its own.

## Open Questions

None.
