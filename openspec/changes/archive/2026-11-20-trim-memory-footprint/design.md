# Design

## Context

See proposal.md for why. The design rests on measurements taken on 2026-11-20:

**Tests** (Node 22 in the Linux VM on the developer's PC, one file at a time, `/usr/bin/time` peak RSS):

| File | Peak RSS | Time |
|---|---|---|
| `src/world/slice01.test.ts` | 1,123 MB | 63 s |
| `src/world/slice01ScriptedWalks`, `dockCheckpoint`, `slice01Walks`, `slice01JumpTops`, `spots` | 400-435 MB each | ~6 s each |
| `bodyModel`, `handPhysics`, `enemySim`, `enemy`, `npcs` and others | 180-250 MB | 1-4 s |
| All 98 files, summed | 12.3 GB | 144 s serial |

`node --test` runs `os.availableParallelism() - 1` files at once by default. A simulation of the run with these figures:

| Concurrency | Peak RSS | Wall time |
|---|---|---|
| 4 | ~2.3 GB | ~82 s |
| 8 | ~3.4 GB | ~72 s |
| 16 | ~4.5 GB | ~67 s |
| 24 | ~5.3 GB | ~66 s |

Wall time bottoms out at about 65 s because `slice01.test.ts` alone takes 63 s. `tsc --noEmit` peaks at about 500 MB. Eight agents each running tests, a type check and a Vite server on a many-core PC easily pass 25 GB of Node.js.

**Game** (dev build in the built-in browser, title screen with the level loaded behind it):

- JS heap after load: ~234 MB.
- 240 enemy bodies spawned and removed with the `?debug` Enemies buttons: the heap peaked at ~430 MB and settled back to 234-235 MB after garbage collection. The spawn/dispose path does not leak JS memory.
- The title screen pauses the simulation and does not render the spawn point, so kills, gore, corpses and the GPU side of spawning were not covered. Covering them needs a game session, and a new game overwrites a save slot. D3 adds a scratch slot for this.
- From the assets: 93 photo textures at 1024² (~520 MB GPU with mipmaps); GLB textures ~340 MB GPU plus ~250 MB of decoded `ImageBitmap`s that three.js keeps in CPU memory; decoded audio ~262 MB at 48 kHz (voice 128 MB: 89 MB story, 37 MB barks/hints/reactions; music and effects 134 MB).
- Three ambience samples (`oneshot-wand-beep`, `oneshot-arch-alarm`, `oneshot-arch-pass`) fail to decode. They belong to the in-flight dock work and are not part of this change.

## Goals / Non-Goals

**Goals:**
- Keep the test suite's memory bounded, so several agents can work in the repo on one machine.
- Make game memory measurable and repeatable for the slice, without touching player saves.

**Non-Goals:**
- Slimming the level tests (building `slice01` once per file to cut its 1.1 GB / 63 s). Deferred: the concurrency cap alone removes the incident, at the cost of about 15 s per full run.
- Reducing what the game loads. Voice on demand, releasing decoded GLB images and KTX2 textures were considered and dropped. The game showed no leak, and each carried a risk to timing, to the tier switch or to the look. The recorded baseline decides whether they come back.
- Changing frame-rate budgets; that is `fidelity-first-rendering`'s job.
- Managing processes outside the repo, such as agents' Playwright browsers. `AGENTS.md` guidance covers those.

## Decisions

### D1. Fixed 48 kHz AudioContext, with a fallback (done)
`createAudioContext()` in `src/audio/engine.ts` asks for 48 kHz and, if the browser throws, creates a context at the device rate with one warning. 48 kHz is the native rate of most devices, so most machines see no resampling at all. *Alternative:* 44.1 kHz would save 8% more, but most Windows devices would then be resampled and some effects were tuned at 48 kHz. Not worth it.

### D2. A test runner script owns concurrency
`npm test` becomes `node --experimental-strip-types scripts/run-tests.ts`. The script spawns `node --test --test-concurrency=<n>` with the same glob, where `n` is `TEST_CONCURRENCY` or 4. A script is needed because npm on Windows runs scripts through `cmd.exe`, where `${VAR:-4}` does not expand. *Alternative:* hard-coding `--test-concurrency=4` in `package.json` works, but leaves no override for a solo run.

### D3. Memory probe and scratch save slot
- `?memprobe` installs counters on the WebGL context before the renderer is created: live textures, buffers, renderbuffers, framebuffers and programs, plus bytes uploaded by `texImage*`/`bufferData`.
- It exposes `window.__memprobe` with `sample()`, `renderer.info.memory`, decoded audio bytes from the engine and voice player, and the debug Enemies actions.
- `?slot=scratch` routes every save and load to an in-memory slot that is never written to `localStorage`. Automated sessions then never touch the player's saves.

Procedure: open `/?debug&slot=scratch&memprobe` with the pane visible. Start a new game in scratch slot 1 and sample (`__memprobe.sample('loaded')`). Then run 10 minutes of cycles: spawn 4 shamblers and 4 model shamblers from the Enemies panel, wait 3 s, kill all, wait 4 s, and remove all every third cycle. Remove all, wait about 30 s for garbage collection, and sample again. Restart from the checkpoint five times, sampling after each. Compare against the "No memory growth over a session" tolerances. *Alternative:* the threejs-devtools bridge proxy gives similar numbers, but needs a proxy port and is not available to every agent.

## Baseline

Measured 2026-11-20. Built-in browser pane (Chrome 156) on the developer's PC, viewport 1280x720 at device pixel ratio 1.75, quality Medium (the default), dev build, `?debug&slot=scratch&memprobe`:

| Point | JS heap | GPU textures | GPU buffers | Render buffers | Programs | Decoded audio |
|---|---|---|---|---|---|---|
| Title, level loaded | 272 MB | 62 / 246 MB | 324 / 4 MB | 14 / 20 MB | 76 | 254 MB |
| New game, intro starting | 247 MB | 89 / 328 MB | 511 / 13 MB | 14 / 20 MB | 98 | 254 MB |

Texture and buffer counts rise as more of the level is drawn for the first time, because three.js uploads on first render. A fair "post-load" point is therefore after a walk through the heaviest area, not the title.

The 10-minute session could not be finished. While other agents were editing `src/`, Vite fully reloaded the page about once a minute, and each reload ended the session. The longest uninterrupted run was 3 cycles (24 bodies spawned, killed and removed): GPU buffers went 491 to 544 and geometries 92 to 105, with the intro camera still moving into new rooms. That is not enough to tell growth from first-time uploads. The session needs a dev server with no file changes landing, or `npm run build && npm run preview`. The scratch slot held: the player's five saved keys were byte-for-byte unchanged afterwards.

## Risks / Trade-offs

- [The concurrency cap slows full runs on big machines] → about +15 s while `slice01.test.ts` stays at 63 s. `TEST_CONCURRENCY` raises the cap for a solo run.
- [Probe counters miss resources created before they are installed] → `?memprobe` installs on the context before the renderer exists, so counts are absolute.
- [The scratch slot is left on by accident] → it is only on with the `?slot=scratch` query parameter, and the title screen says so.

## Migration Plan

Each decision lands on its own and can be reverted on its own.
