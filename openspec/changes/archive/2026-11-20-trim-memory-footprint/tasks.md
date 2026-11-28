# Tasks

## 1. Fixed audio sample rate

- [x] 1.1 Create the AudioContext at 48 kHz with a device-rate fallback in `src/audio/engine.ts`, and verify that `npm run typecheck` passes and the built-in browser accepts a 48 kHz context.
- [x] 1.2 Add `src/audio/engineRate.test.ts` with a stubbed global `AudioContext`: the requested rate is 48000, and when construction throws the engine falls back with exactly one `[audio]` warning. Verify with `npm test`.
- [x] 1.3 Check by ear that the shotgun, a radio line and the Commons ambience sound the same as before on the developer's PC, and note the check in the change. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 2. Test suite ceiling

- [x] 2.1 Add `scripts/run-tests.ts`, which runs `node --test --test-concurrency=<TEST_CONCURRENCY or 4>` over `src/**/*.test.ts`, and point `npm test` at it. Verify that the run passes and that a process sampler never sees more than 4 test files running at once.
- [x] 2.2 Add a "Shared machine" section to `AGENTS.md`: reuse one running dev server, close browsers you open, run single test files while iterating, and use `TEST_CONCURRENCY` only for solo runs. Verify the section is there and the commands it gives run as written.

## 3. Memory probe and baseline

- [x] 3.1 Add the `?slot=scratch` in-memory save slot. Verify with a unit test that saves taken in scratch mode never call `localStorage.setItem`, and that existing slots are unchanged after a scratch session.
- [x] 3.2 Add `?memprobe`: install the WebGL resource counters before the renderer is created and expose `window.__memprobe` (sample, `renderer.info.memory`, decoded audio bytes). Verify `__memprobe.sample()` returns counts in the built-in browser.
- [x] 3.3 Record the post-load baseline (JS heap, GPU textures and buffers, decoded audio) in design.md, Baseline, using the procedure in D3. Verify the table is filled from `__memprobe.sample()` readings.
- [x] 3.4 Run the full D3 session (10-minute enemy churn, five checkpoint restarts) on a dev server with no file changes landing, or on `npm run preview`. Verify the "Enemy churn" and "Restart from checkpoint" scenarios pass, or record what fails as a new change. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 4. Integration

- [x] 4.1 Re-run the memory procedure (design.md D3) after `fidelity-first-rendering` lands. Verify its shadow and SMAA targets show up as a stated rise in GPU memory and the session still shows no growth. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.2 Run `npm run build` and `npm test`, and verify both pass with the new test runner. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## Workflow follow-up

- Archive the change after review, then confirm the `runtime-memory` and `test-suite` specs exist under `openspec/specs/` and that `audio-mix` contains the added requirement.
