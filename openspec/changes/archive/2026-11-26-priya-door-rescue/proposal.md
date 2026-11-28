# Proposal

## Why

Two moments in the R07/R08 scene don't land in playtests:

- **The run.** Priya says nothing as she bolts. Okafor's "Hey, hey! It's us!" plays before she has done anything, and she
  then runs on to the beds and crouches. She only comes back to the glass when he speaks.
- **The "medical advice" exchange.** It reads as long and confusing. In the intro, Priya tells Okafor "Sit. That's medical
  advice." and he answers "That's my line." In R07 the roles flip, so both of them have claimed the same line and the
  callback never resolves.

## What Changes

- **She shouts as she runs.** Priya shouts "Don't shoot! Don't shoot!" as she runs past the squad. This sets up her later
  "I saw the guns, I thought you were-".
- **Okafor calls after her at the door.** His "Hey, hey! It's us! It's us!" moves to play as she reaches `D_R07_R08`.
- **She stays at the door.** She runs just inside the medical bay, stops and turns to face the door. She no longer runs to
  the beds and crouches. Okafor goes straight to the door when the rescue starts, and nobody walks to the window.
- **His opening line is cut.** "It's me. Come to the door." becomes "It's me.", since she is already there.
- **The talk-down is rewritten.** Okafor: "Sit down by the beds. Breathe with me. In... and out." Priya, on a shaky
  breath: "...Okay. Okay." The "medical advice" callback is dropped from this scene. The intro lines stay.
- **The sob is cut from the run.** The sob on her stumble (`cover_priya_run_01`) no longer plays, because the shout
  replaces it. The stumble animation stays.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `medbay-attack`: what Priya says and where she ends up on the run; where she waits for the rescue; the talk-down lines.

## Impact

- **Data:**
  - `src/data/dialogue/slice01_action.json`: a new line `cover_priya_run_02`, plus `sec_okafor_10`, `sec_okafor_17` and
    `sec_priya_18` changed.
  - `src/data/sequences/action_security.json`: the run's timing and target, Okafor's first walk, and her walk to the
    window removed.
  - `scripts/gen-slice01.mjs` and `src/data/levels/slice01.json`: one new R08 anchor at the door.
- **VO:** four clips through `scripts/vo-generate.ts` on each speaker's pinned model, one request per model, with the
  word check (`docs/voice-casting-standard.md`).
- **Tests:** `src/script/action.test.ts` (the run and the rescue order) and `src/world/slice01.test.ts` (the new anchor
  reaches the beds on the navmesh).
