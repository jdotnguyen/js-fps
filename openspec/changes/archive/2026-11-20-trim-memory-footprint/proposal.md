# Proposal

## Why

On 2026-11-20 the developer's PC hit 100% RAM and started paging, with Node.js at about 25 GB while eight agents worked on the repo at once. Measurement found no runaway leak in the game. Two costs add up instead:

- **Tests:** one `npm test` peaks at several GB because Node runs one test process per CPU thread and the level tests are heavy.
- **The game:** each open tab loads about 1.5-2 GB of textures and decoded audio and keeps CPU copies it never reads again.

Nothing measured memory before this; the only memory budget written down (256 MB of textures, in the retired ADR-0015) is exceeded about 3x by the assets. The game keeps a large but steady footprint. The test-side costs and the lack of any measurement are what this change addresses.

## What Changes

- **Audio decodes at a fixed 48 kHz** whatever the output device's rate. A 96 or 192 kHz Windows device no longer multiplies decoded audio memory by 2-4x. (Already applied in `src/audio/engine.ts`.)
- **The test suite has a concurrency cap.** `npm test` runs at most 4 test files at once (overridable) instead of one per CPU thread, which roughly halves a run's peak memory on a 16-thread PC (about 4.5 GB to 2.3 GB).
- **Memory is measured like frame rate.** A memory probe and an in-memory scratch save slot let a scripted play session run without touching the player's saves. The session must show no growth, and the steady-state figures are recorded with the change that measures them.
- **Agent guidance:** `AGENTS.md` asks agents to share one dev server, close the browsers they open, and avoid running the full test suite in parallel when a single test file will do.

## Capabilities

### New Capabilities
- `runtime-memory`: how much memory a running game tab may use, that it does not grow over a session, and how this is measured.
- `test-suite`: how many test files `npm test` runs at once, so several agents can run it on one machine.

### Modified Capabilities
- `audio-mix`: adds a fixed mix sample rate.

## Impact

- **Code:** `src/audio/engine.ts` (done), `src/core/storage.ts` or the save store (scratch slot), `src/main.ts` and a new `src/core/memProbe.ts` (probe), `scripts/run-tests.ts` and `package.json` (`test` script).
- **Docs:** `AGENTS.md` gets the shared-machine guidance. The measurement procedure lives in the `runtime-memory` spec and this design, not in an ADR. ADR-0015 is deleted: its rules were not being enforced or checked against the specs. Its frame-rate role passes to `fidelity-first-rendering`'s `render-quality` spec.
- **Dependencies:** none.
- **Related change:** `fidelity-first-rendering` adds shadow maps, an SMAA pass and an uncapped pixel ratio on High. The baseline recorded here is what those additions are measured against.
- **Out of scope:** any change to how the game looks or sounds or what it loads. Loading voice lines on demand, releasing decoded GLB images and GPU-compressed textures were considered and dropped as too risky for the gain, because the game showed no leak. They can come back as their own change if the recorded baseline shows a need.
