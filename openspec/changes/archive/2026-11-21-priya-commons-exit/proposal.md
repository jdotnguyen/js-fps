# Proposal

## Why

After the intro, Priya walks to `priya_exit` and stays there. Once the rounds start, Bram is teleported to the same spot. `priya_exit` is 0.6 m in front of `D_R02_R13a`, the Commons door to the Wet Vestibule and the dive bay. So two people stand in a doorway Jay uses, for no reason, and the give-way logic keeps them coming back to it. It also sends Priya toward the dive bay, when her last line says she is going to the medical bay.

## What Changes

- At the end of the intro, Priya walks away from Jay toward `D_R02_R03`, the Observation Gallery door on the real route to the medical bay. The moment she is out of Jay's view, even mid-walk, she is parked off-stage in the shut surgery (`priya_offstage`, R08b). The medical bay itself is on the admin booth's CAM 04 feed, so she can't wait at `priya_r08`. Later scenes already move her from there.
- A skipped intro, and a load after the intro, put her at the same parked spot. She is never left in the Commons, the Wet Vestibule or a doorway.
- When the Commons changes during the rounds (the TV comes on), Bram goes back to his station (`cook_stand`) instead of `priya_exit`. A load puts him there too.
- As soon as the intro ends ("Briefing's in the gallery in ten"), Giles and Okafor head for their briefing spots in the Observation Gallery and wait there, instead of waiting together in the gallery doorway (`gallery_door`) after Giles's 45 s call. If Jay dawdles, Giles comes back to `dawdle_call`, beside the door, to call him.
- `priya_exit` is removed. No NPC rest spot in the Commons may sit in front of a door.

## Capabilities

### New Capabilities

### Modified Capabilities
- `intro-sequence`: the coffee hand-off says where Priya goes and how she leaves; the skip end state puts her off-screen instead of at her exit spot; a new requirement covers who is where in the Commons after the intro, Bram at his station, and no one waiting in a doorway.

## Impact

- Data: `src/data/sequences/intro_shift_change.json` (Priya's exit walk, plus the skip end state if it is authored separately), `src/data/sequences/rounds.json` (`rounds_commons_changes`), `src/data/sequences/quiet_restore.json` (Bram's and Priya's placement on load), and `src/data/levels/slice01.json` through `scripts/gen-slice01.mjs` (remove `priya_exit`; add a walk-out point past `D_R02_R03` if needed).
- Tests: `src/script/intro.test.ts` (exit and skip), a level or sequence test that no Commons rest anchor lies within door give-way reach (`GIVE_WAY.doorReach`, 1.2 m) of a door.
- Related: `overhaul-priya-r08-death` later moves Priya from her parked spot into R07 for her run into the medical bay. This change does not depend on it, and works with today's `action_security`, which already moves her to `priya_r08`.
- Out of scope: idle routines for Bram or the Commons crew (only his position changes).
