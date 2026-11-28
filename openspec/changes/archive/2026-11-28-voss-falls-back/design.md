# Design

## Context

See proposal.md for why. The kill is data (`kills.json` `grownInside`); the director (`src/ai/npcKills.ts`) runs it.
Facts that shape the approach, measured on the headless Lab B (`labBKillTestKit`):

- The creature spawns at the burst's +0.03 s on its pound spot (0.92 m off the pane, behind Voss's root at the 0.65 m
  glass stand) and unfolds there. Its head starts at her chest joint, 0.11 m below it, and drifts 0.14 m toward the pane
  over the burst. That is the front of her torso, so the spawn is not what reads wrong. Her fall toward the pane is.
- The historical still beat (die into `corpseSupine` at t 0, blend 0.55) moves her hips 0.96 m back from the stand.
  In today's room her feet then land 2 cm from the pounding creature's feet (the spec needs 0.3 m).
- A route moves only a living body (`startRoute` and `updateRoute` skip a dead one), so a still beat route cannot carry the
  fall. A skipped or restored kill rests on the last mark of the last beat that has a route (`restAtRouteEnd`).

## Goals / Non-Goals

**Goals:** the historical backward fall, landing clear of the creature, the same rest for played, skipped and restored
kills, data only.

**Non-Goals:** the creature's spawn, unfolding, pound spot and escape; the burst's gore, light and camera; new motion
capture.

## Decisions

### D1. The landing moves back by a recoil in the burst, not by moving a corpse
The burst beat (she is alive) gets a route: hold at the glass stand to 0.12 s, then straight back to `voss_rest` by
0.6 s (0.49 m, about 1 m/s). The creature's head shows at her chest in the hold. The recoil then opens the gap as the
burst's backward chest kick plays, and the fall carries the same direction on.
- Alternative: let a route carry a dead body through the still beat. That needs a director change for every kill, and the
  corpse would slide under a pose blend. Rejected.
- Alternative: keep the historical spot and move the creature's pound spot. That breaks "The creature pounds from where it
  appears" and its forearms' distance to the glass. Rejected.
- In the burst pose her feet are already off the floor and convulsing (ankles 0.12-0.33 m up, swinging about 0.3 m), so
  the recoil has no planted foot to skate. No footsteps play there, as before.

### D2. 0.49 m back, the least that clears the creature
At 0.35 m back her foot capsules were 0.19 m from its feet; at 0.49 m they are 0.33 m. Her head then rests 0.10 m clear
of the gurney behind her, so there is little room for more.

### D3. `voss_rest` is the restore point, and the route's end
It moves to 0.49 m behind the glass stand, square to the pane. As the burst route's last mark, it is where a skipped or
restored kill puts her, in `corpseSupine` (the creature beat's pose), so the two rests match exactly. The slide's
`labb_pane`, `labb_slide` and `labb_slump` marks go. The pane-slump poses stay in the library.

### D4. No body-on-glass sound in Lab B
She no longer touches the pane after the burst, so `body_glass_hit` leaves this kill. The medbay throw still uses it.

## Risks / Trade-offs

- [A free-look player standing far to one side sees the recoil as a slide] → Checked from a second standing angle; the
  convulsion and gore cover the feet in the 0.48 s.
- [The gurney's 0.10 m margin] → The backward-fall test checks every frame of the fall against the gurney, the bench and
  the cart.
