# Design

## Context

See proposal.md for why. The intro is data: `intro_shift_change.json` runs `say`, move and camera steps, many of them in parallel.

- The booth banter runs in parallel with Giles's walk to the arch, so cutting it saves less than its voice time.
- Bram's section and the Mara exchange are sequential, so they save their full length.

## Goals / Non-Goals

**Goals:** remove about 25 s without leaving a gap or a line that answers something no longer said, and keep skip parity.

**Non-Goals:** new or re-recorded lines, changed walk routes or speeds, new camera behaviour, the timing of the arrival PA and airlock, and the content of `intro_jay_05`.

## Decisions

### D1. Remove steps only; keep the staging
The twelve `say` steps go. Moves, gaze cues, mug hand-offs and both `drink` animations stay where they are. The booth parallel keeps its two moves and the guard's look. If Priya's entrance steps on Giles's mug hand-off once the kettle talk is gone, add a short wait (under 1 s) before Bram walks back.

### D2. Remove `mara_mentioned`
Nothing reads it. Older saves keep it harmlessly, so no migration is needed.

### D3. Delete the cut lines and clips
The twelve dialogue entries and MP3s are removed, so the game stops loading and decoding voice it never plays. Git history restores them. `scripts/vo-takes.json` is a record of past takes and stays as it is. The `audition_giles_okafor` list in `scripts/vo-generate.ts` names `intro_giles_02` and `intro_okafor_02` and would fail on a missing line, so those two are swapped for remaining intro lines (`intro_giles_09`, `intro_okafor_06`).

- *Keep the entries unused.* Easier to bring back, at the cost of dead data in every session.

## Timing

**Before** (2026-11-25, at commit `6b9bab2` plus other sessions' uncommitted work): **196.7 s** (3:17) from the intro's first frame to control returning, loading excluded. Measured in headless Chrome from New Game on a scratch slot, Standard, 58 fps, real voice clips, nothing skipped. The mug offer was left to run its 6 s timeout, so a player who takes the mug at once finishes sooner.

| Beat | Starts | Ends |
| --- | --- | --- |
| Booth banter | 62.1 s | 72.4 s, the guard's line at the alarm |
| Kettle talk | 134.9 s | 148.7 s, Priya's first line |
| Mara exchange | 169.3 s | 177.0 s, Priya's coffee offer |

**After** (2026-11-26): **169.4 s** (2:49), a saving of **27.3 s**. Same method, 59 fps, on a private copy of commit `da0f4fe` plus this change, because another session's half-finished edit was breaking the intro in the shared checkout. Line times before the first cut match the earlier run within 0.1 s.

- Skipped run: skip held from 55 s, control back at 61 s, end flags identical to the watched run.
- One new stretch with nobody speaking: 3.6 s while Giles walks into the arch (62.1 to 65.7 s), where the booth banter was. Other walking pauses in the intro are 3.1 to 3.5 s. The arch has no sound files yet, so it is quiet.
- D1's wait before Bram walks back was not added: the mug hand-off finishes during Giles's line. Okafor and Giles now both drink as Priya walks in.

The user watched it and accepted the pacing on 2026-11-26.

## Test results

On the same private copy: `npm run typecheck` passes, and `npm test` runs 1975 tests with 16 failing. The same 16 fail with identical messages without this change, and the user accepted them. They are the 16 listed for `fix-misaligned-voice-clips`: mocap bake, cast motion coverage, held grip, motion profiles, dock guard routine, music loudness, squad gathers, credits, gallery lights, scripted and authored walks, and wall clearance.

## Risks / Trade-offs

- [Bram loses most of his lines] -> Accepted. He keeps his greeting and "One each, then."
- [The saving feels too small] -> Time the intro before and after. Ruiz's exchange (about 20-25 s) is the next candidate, in a later change.
