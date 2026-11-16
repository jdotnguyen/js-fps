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
