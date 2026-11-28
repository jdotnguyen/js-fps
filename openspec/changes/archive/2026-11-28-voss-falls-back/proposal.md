# Proposal

## Why

Since 7dc5341 (voss-death-scene §4), Voss leans into the pane after the burst and slides down it. From the observation
gallery her chest passes the creature's head toward the glass at about 0.75 s, so at 0.8 s her face and raised arms fill
the foreground with the creature rising behind her, and it reads as if it burst out of her back. The player's note: "I
liked when she burst open and fell back because it looked like the monster came from her." Before 7dc5341 she fell
straight back, face up, and the creature was left in front of her.

## What Changes

- The Lab B `grownInside` still beat returns to the historical backward fall: at the start of the beat she dies into
  `corpseSupine`, and the burst's backward chest kick carries on into it. The pane lean and slide pose track, the route
  down the glass, the hand-to-pane holds and the body-on-glass thud during the collapse are removed. Her palm prints at
  the glass in the glass beat stay.
- The burst beat gets a short route: she holds at the glass stand for 0.12 s while the creature shows at her chest, then
  recoils straight back 0.49 m to `voss_rest` by the end of the beat, so in today's room her landing clears the creature's
  feet (the historical spot left 2 cm). `voss_rest` moves to 0.49 m behind the stand point. The unused `labb_pane`,
  `labb_slide` and `labb_slump` marks go.
- The creature beat holds `corpseSupine`. The two death twitches go back to the still beat, at their historical times.
- A skipped or restored kill puts her on `voss_rest` in `corpseSupine`, the same place a played one leaves her.
- The creature's spawn, unfolding and pound spot are unchanged: from the gallery its first visible part already comes out
  of the front of her torso once she falls back.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `infection-kills`: "Voss collapses down the pane" becomes "Voss falls back from the creature". She falls backward off
  the glass and lies face up, the creature first shows at the front of her torso, and the gap between them only opens.
  Room for the creature (0.3 m from its feet) and restored in place (hips within 5 cm) stay.

## Impact

- Data: `src/data/kills.json` (`grownInside` burst, still and creature beats), `src/data/levels/slice01/rooms/R04.json`
  (marks).
- Tests: `src/ai/labBRun.test.ts` (the down-the-pane test replaced by backward-fall and emergence tests),
  `src/ai/labBSealed.test.ts` (no body-on-glass sound in Lab B).
- Docs: the collapse line of the drop in `docs/PLAYTEST.md`.
- No code change: the poses `kill_pane_lean`, `kill_pane_slide` and `corpseGlassSlump` stay in the pose library, unused by
  this kill.
