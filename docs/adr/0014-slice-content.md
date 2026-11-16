# ADR-0014: Slice content: map, beat sheet and script outline

Status: Accepted (structure from Q&A) / Proposed (specific beats, names, map)

## Context
The slice is 10-15 minutes [Decided]: quiet opening then "the drop" [Decided], horror beats
including transformations and people killed behind glass [Decided], shambler and play-dead
enemies [Decided], the shotgun appearing partway [Decided], no squad deaths [Decided], and a
cliffhanger where the engineer reveals he is infected [Decided: Option A]. Future chapters
go back in time [Decided]. The overall story ending is open [Open].

## Setting placeholders [Assumed]
- Station: **Thalassa Deep Research Station**, ~3,000 m down. Name is a placeholder.
- Infection: unnamed in this slice; researchers called it "the bloom".
- The team: player (security officer, silent), August Giles (engineer), Dr. Tomas Okafor (medic).

## Map (rooms)
| ID | Room | Purpose |
|---|---|---|
| R01 | Docking ring corridor | Start, walk and talk, abyss windows |
| R02 | Commons | Normal life: crew eating, PA, quarantine notice |
| R03 | Observation gallery | Glass wall looking into R04 |
| R04 | Lab B (seen through glass) | Transformation set piece #1 |
| R05 | Lab junction | First contact, pistol and dismemberment teaching |
| R06 | Pressure door hall | "Cover me" defence |
| R07 | Security office + armory | Breathing room, shotgun, play-dead intro |
| R08 | Medical bay (seen through glass from R07) | Dragged-away kill, set piece #2 |
| R09 | Flooded maintenance tunnel | Wading, dying lights, mixed enemies, hint use |
| R10 | Valve room | Puzzle-lite: restore pressure to open R11 |
| R11 | Control room | Climax defence, then cliffhanger |

Flow is linear with small side rooms (lockers with ammo) for exploration.

## Beat sheet (target times)
1. **0:00-2:30 Quiet (R01-R02).** Shift change. A skippable on-rails intro (ADR-0017): the
   player guards the docking ring, Giles and Okafor arrive, banter sets personalities, and
   the player follows them to the kitchen. Learn move, look, flashlight, interact (badge door). Crew acts normally.
   PA announces a "routine quarantine" of Lab B. *Foreshadow 1:* Giles rubs his forearm and
   dismisses it.
2. **2:30-3:30 The drop (R03-R04).** In the gallery a researcher in R04 convulses and
   transforms behind the glass (stage 0 -> 3). Lights die, emergency red, alarm. Glass
   cracks but holds. Lockdown seals the way back. Checkpoint.
3. **3:30-5:30 First contact (R05).** A shambler breaks through a door. Pistol use. Okafor:
   "Legs! Take its legs!" Severed limb demonstrates the rule. Okafor sets the revive rule in
   one line: "You go down, I'll get you up. If I go down, we're both done." Two to three more trickle in.
   Checkpoint.
4. **5:30-7:30 Cover me (R06).** Sealed pressure door. Giles bypasses it (20 s task) while
   ~6 shamblers come from a vent and the corridor. First grab; a teammate shoots it off.
   Checkpoint.
5. **7:30-9:00 Breathing room (R07-R08).** Security office; Giles unlocks the armory: shotgun.
   Corpses on the floor; one is a play-dead and gets up as the player passes. Through the
   glass to R08, Okafor's nurse, Priya Anand, is dragged out of view by something unseen and killed (docs/characters.md); blood on the
   glass. *Foreshadow 2:* Giles goes ahead alone to a panel ("I'll get the panel, go"); a
   scream-like sound off-screen, he returns. *Foreshadow 3:* a fresh bandage on his
   forearm: "Cut it on the panel." Okafor offers to look; he refuses. Checkpoint.
6. **9:00-12:00 Flooded tunnel and valve (R09-R10).** The way from R07 into R09 runs
   through a med-lab biometric door that only Okafor can open (his specialist moment). Knee-deep water slows movement; dying
   lights; shamblers and play-deads among floating debris. The player must find and turn
   the valve (hint system teaches itself here). Checkpoint.
7. **12:00-13:30 Climax (R11).** Restore control room power (Giles, 30 s task) while
   ~14 enemies (max 8 active) come through two entrances. The shotgun shines.
8. **13:30-15:00 Cliffhanger (R11).** Doors sealed; silence; relief banter. Giles at the
   final console. Lights come back on and show a fluid trail behind him. He says quietly,
   "I didn't want you to see this." The player's look is soft-locked on him, his arm
   convulses and begins to change. Okafor, blindsided, steps toward him; Giles says "Stay back,
   Tomas." Cut to black. Title card. (ADR-0022)

## Script outline
- About 80-110 lines in `data/dialogue/slice01.json`: ~40 story, ~20 hints, ~40 barks.
- Giles: dry, competent, deflects with humour (makes the reveal hurt).
- Okafor: calm, clinical, the first to understand what the bloom is.
- PA and unknown voices for atmosphere.
- Lines are written after systems work (step 5 below), so they fit real timings.

## Checkpoints
`cp_first_contact` (R05), `cp_cover_me` (R06), `cp_security` (R07), `cp_flooded` (R09),
`cp_climax` (R11).

## Execution steps
1. Block out all rooms in level JSON with structural kit only; walk it for pacing
   (target 12 min on Standard by a first-time player).
2. Place lights, atmosphere, doors, triggers, spawns, checkpoints.
3. Prop dressing per room.
4. Sequences for each beat.
5. Write dialogue and hints; placeholder VO.
6. Encounter tuning on all difficulties.
7. Cliffhanger polish.

## Definition of done
- A first-time player finishes in 10-15 min on Standard.
- All three foreshadowing beats are noticed by at least one playtester, and the reveal
  still lands.

## Open questions
- Overall story ending, the bloom's origin, station and title names.
