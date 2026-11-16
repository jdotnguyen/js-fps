# ADR-0015: Performance budget, verification and workflow

Status: Proposed (standing rules for all ADRs)

## Context
Target hardware is a MacBook Air M2 [Decided]. Work is executed by Claude in succession
on a hobby project that will grow over time [Decided]. Each step must be checkable.

## Performance budget (Medium tier, 1440x900, MacBook Air M2)
| Metric | Budget |
|---|---|
| Frame time | <= 16.6 ms (60 fps), 1% lows >= 45 fps |
| Draw calls | <= 300 |
| Visible triangles | <= 1.5 M |
| Shadow-casting lights | 2 |
| Active fill lights | 8 (pooled) |
| Active humanoids | 10 (8 enemies + 2 squad) |
| Debris pieces | 24 |
| Decals | 64 |
| Texture memory | <= 256 MB |
| Initial load (dev build) | <= 5 s to title |
- Shader compile hitches avoided by pre-warming materials with `renderer.compile` during the
  loading screen.

## Verification per ADR
1. `npm run build` passes.
2. Run in the browser (built-in browser preview or Justin's), check the ADR's Definition of
   done, and capture a screenshot of the result.
3. `?debug` stats checked against the budget in the heaviest room so far.
4. Console free of errors and warnings.
5. Short note appended to the ADR: "Done on <date>: what was verified, known gaps".

## Workflow
- Execute ADRs in index order. Before starting one, re-read its [Assumed] items and ask
  Justin about any that look risky.
- Work on a branch per ADR (`adr/0002-rendering`). Commit only when Justin approves;
  merge in order.
- Never change a [Decided] item without asking; record any change as a new ADR that
  supersedes the old section.
- Note: on Justin's machine, git needs delete permission to clean its lock files; request it
  once when the first commit is approved.

## Status
Standing rule set; no execution steps of its own.

## Measurements

### 2026-11-16: humanoids, crowd and hero tiers (ADR-0006, ADR-0021)
MacBook Air M2, Claude desktop browser pane (Chrome 156), visible, rendering at 1440x900 x 1.25 (1800x1125
buffer), post-processing on, flashlight on. Scene: `sandbox/actors.html?stress` (8 crowd bodies at 10-13.5k
triangles each, 3 heroes at 64.6k each, the room), the bodies walking toward the camera.

| View | Avg fps | 1% low | Draw calls | Triangles drawn |
|---|---|---|---|---|
| Whole room, all 11 bodies | 60 (vsync) | 56.5 | 146 | 1.24 M |
| Same view, bodies hidden | 60 (vsync) | 56.5 | 58 | 31 k |
| Close-up on the heroes | 60 (vsync) | 56.8 | 94 | 0.30 M |

All within budget (60 fps, 1% lows >= 45, <= 300 calls, <= 1.5 M triangles). The cap is vsync, so the headroom
is not known from these numbers.

A synchronous benchmark (`__actors.bench()`, which waits for the GPU after every frame and so overstates frame
time on the M2's tile-based GPU) gave the split: the bodies cost about 7.5 ms at this resolution with or without
post, AI + separation + animation about 1.5 ms of CPU, and post-processing is the largest single cost. Post also
renders the scene a second time, so drawn triangles roughly double with it on; a busier room may hit the 1.5 M
budget through post before it does through bodies.

How to repeat: open `sandbox/actors.html?stress` with the pane visible, then in the console
`__actors.renderSize(1440, 900)` and time requestAnimationFrame for a few seconds (`__actors.stats()` gives calls,
triangles and the buffer size). A hidden pane runs as a background page and caps near 30 fps, so it cannot be used.

