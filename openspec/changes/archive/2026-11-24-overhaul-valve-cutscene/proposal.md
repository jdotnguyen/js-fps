# Proposal

## Why

The R10 valve cutscene plays flat. The creature's shriek starts under Okafor's lines, from a spot only about 4.5 m from the door, so it never feels like something coming up the R09 hall. After the door seals, the view stays locked on the door for several more seconds of pounds and retreat. The follow-up ambush only fires at the R11 bulkhead, so it can take a long time to trigger, and the pry itself barely opens the door and barely gets the arms through before it slams.

## What Changes

- The flood cutscene opens on a loud monster scream from far down the R09 hall (the supplied `monster-roar-02` clip), heard before anyone speaks. The elite stands beside the ammo crate at the back of the straight stretch, with the scream coming from it.
- After the scream, Jay breaks into a scripted run from the wheel toward the doors, with the view on the open door and the straight stretch of R09. He stops well short of the ambush trigger area.
- When Jay reaches the end of his run, his flashlight is forced on and his view is held on the elite, so it can be seen. It then runs at the door and arrives as the door seals.
- Okafor's two lines ("Something's coming up the stairs!", "Seal it now!") now follow the scream and the start of the run. "Seal it now!" still ends as the leaves meet.
- The player's view is released at the slam. The pounds, the retreat and Giles's "Is it gone?" play with control back.
- The ambush (the elite prying the door open) fires from a new, larger trigger area in R10 next to the R09 and R11 doors, instead of at the R11 bulkhead.
- The pry opens the door wider (about 0.5, up from 0.3) and the blades reach further through before the door slams and shears the forearms. The gap stays too narrow to pass.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `flooded-tunnel`: the flood cutscene's order (scream, scripted run, charge, lines), when the view is released, where the ambush trigger sits, and how far the door and the arms open in the pry.

## Impact

- `src/data/sequences/action_tunnel.json`: `valve_turn` reordered and extended, `r10_ambush` retimed.
- `scripts/gen-slice01.mjs` and the generated `src/data/levels/slice01.json`: new ambush trigger box, new anchors (scream origin, charge start, Jay's run stop), and the elite's pry position.
- `src/data/poses.json`: `pry_reach`, `pry_clamp` and `pry_wrench` reach further.
- Audio: the scream is imported as a new one-shot (following `docs/audio-assets.md`) and mapped in `src/audio/sounds.ts`, replacing `creatureCharge` in the cutscene. A `CREDITS.md` entry is added.
- `src/script/action.test.ts` ordering tests and `docs/PLAYTEST.md` valve and ambush notes are updated.
