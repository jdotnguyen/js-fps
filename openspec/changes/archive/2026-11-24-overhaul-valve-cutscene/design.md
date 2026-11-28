# Design

## Context

See `proposal.md` for the motivation. The cutscene is the `valve_turn` sequence and the ambush is `r10_ambush`, both in `src/data/sequences/action_tunnel.json`. The earlier design (archived `overhaul-flooded-tunnel`, D13) fixed two rules this change must keep: the lines and the slam are timed off each other, and no door line starts after the door seals.

Current state that shapes the approach:
- The elite spawns at the sump anchor (x 24.4), about 4.5 m from the door at about x 29, and the shriek (`creatureCharge`, gain 6) starts about 1.2 s after the view turns, under Okafor's lines.
- The player's view is held (`playerFrame`) until the end of the sequence, a few seconds after the slam.
- `trig_r10_ambush` is a 2.8 x 2.8 m box centred at (32, 47.2), at the R11 bulkhead.
- The pry opens the leaves to 0.3 (about 0.4 m). The door collider stays on below 0.6 open. The elite stands at `r09_pry` (x 29.5), and the `pry_*` poses only just reach the door plane.
- R09's last stretch toward the door (cells 4 to 7, about x 16 to 32) is straight and level with the door. Further back the hall steps over a row and turns, so it is out of sight from R10. This comes from the level data and the cell layout; it has to be confirmed with a real sightline check.

## Goals / Non-Goals

**Goals:**
- The scream is the first sound of the charge and carries down the hall.
- Jay's run and the elite's run are visible together through the open door.
- The view is free from the slam on.
- The ambush fires near the two doors, and the arms visibly reach through a wider gap.

**Non-Goals:**
- No change to the music cues, the beacon, the squad placement or the skip rules.
- No change to the Valve Room checkpoint contents or the once-per-save rule.
- The gap does not become passable, and R09 stays unreachable.

## Decisions

### D1. The elite waits beside the ammo crate and screams there; the flashlight and the view light it
The clip (`monster-roar-02`, 4.9 s, stereo, 24 kHz, peaking at -0.2 dB) is converted to mono and played at the highest gain the step allows (20) as a positional one-shot from the elite itself, so it picks up the `flooded` reverb and the hall's own distance and echo. The elite is spawned beside the ammo crate at the back of the straight stretch (x 17, a 1 m step clear of the crate's collider), so it is in place before the scream. The first version spawned it hidden around the bend; playtest found it too hard to see while it ran, so it now stands in sight. To make it readable at about 18 m, `valve_turn` frames Jay's view on it (a new anchor at chest height) and switches his flashlight on with a new `playerFlashlight` step once his run ends (the beam reaches 24 m). The ceiling tube over the crate (slot 3, the sparking one, given the id `r09_charge_light`) is set to steady at the scream, so the elite is lit from above whatever the fog does to the beam. The step sets the light itself, since the controls' flashlight flag only gates the key. A skipped scene leaves the light as set.
*Alternative:* spawn it at x 10 and run the whole hall. Rejected: the first 6 m or more would be hidden around the corner, so the player would see nothing and the run would be shorter on screen anyway.

### D2. The scream replaces the shriek in the cutscene and in the pry
The new one-shot replaces `creatureCharge` in `valve_turn`. The ambush's `creatureCharge` stays, since it is a different moment (the wrench) and a different, shorter shriek. The old asset is left in place.
*Alternative:* swap `creatureCharge` globally. Rejected: the 4.9 s scream is too long to play under the wrench.

### D3. Jay's run is scripted and ends outside the ambush box
A new run step moves Jay (cutscene mode, view framed on the open door) from the wheel to a new anchor roughly halfway to the doors, at least a few metres short of the new trigger. The existing `playerWalkTo` step already walks the player body along the floor, so no new host action is needed.
*Alternative:* move the camera only and snap the player at the end. Rejected: the player would visibly jump.

### D4. Order of the new `valve_turn`
```
 beacon -> view turns to open door
 -> view framed on the waiting elite, scream (positional, from the elite)
 -> Jay's scripted run (wait)
 -> flashlight on, a beat, the elite runs at the door
 -> Okafor_01, Okafor_02 (door closes during it, leaves meet as it ends)
 -> slam hit + slam sound + release the view and control
 -> pounds, retreat, Giles "Is it gone?", cp_valve
```
The elite's speed is tuned so it reaches the top of the stairs just after the leaves meet. Okafor's two lines (about 4 s) set the length of its run, so its speed is derived from them rather than fixed.

### D5. View release moves to the slam
`playerFrame clear` and `playerControl reset` move from the end of the sequence to right after the slam beat. `valve_done`, the objective change and `cp_valve` move up to the slam beat too (see D9); Giles's line and the `floodOut` cue stay at the end. The sequence can no longer assume the player stays still at the end, so squad placement and the checkpoint position use Jay's actual position. The `floodSlamHit` stinger and the door slam still land together.

### D6. A bigger ambush trigger in R10, next to both doors
`trig_r10_ambush` becomes a larger box inside R10 covering the approach to the R09–R10 and R10–R11 doors, placed beyond where Jay's run ends. It stays an `enter` trigger gated on `valve_done` and `unless ambush_done`, as before. Exact corners are set from the R10 footprint at implementation, and a level test checks that Jay's run-stop anchor lies outside the box.
*Alternative:* keep the box and add a timer. Rejected: a timer fires wherever Jay stands, and can fire with him facing away or at the wrong moment.

### D7. The pry opens wider and the arms reach through
- `doorPry` opens to about 0.5 (a gap of about 0.65 m), up from 0.3, staying under the 0.6 point at which the door collider turns off. The spec keeps the gap "too narrow to pass"; the collider is the real guard, so a test asserts the collider stays on at the maximum pry.
- The elite's pry position moves closer to the door (about 0.6 m) and the three `pry_*` poses are edited so the forearms extend through the doorway. The severing step still happens at the instant the door closes, so the forearms are still at the door plane.
- The wrench is slightly longer, so the arms are seen reaching in before the slam.

### D9. Walking into the box cuts the aftermath short and starts the pry now
With the view released at the slam, Jay can reach the trigger while the pounds, the retreat or Giles's "Is it gone?" are still playing. So:
- `valve_done`, the objective change and `cp_valve` move up to the slam beat (D5), so the ambush's `requires` is met and the checkpoint is safe if the rest is cut.
- `r10_ambush` starts by silencing speech and stopping the rest of `valve_turn` (`stopSequence` with `speech: true`, plus `hush` for anything queued), then plays the `floodOut` cue itself so the music ends in the same state.
- The pry then starts on the same frame, with no wait before the sting.
*Alternative:* let `valve_turn` finish first and queue the ambush. Rejected: that is the delay the user wants gone.

### D8. Audio import and credit
The clip is processed per `docs/audio-assets.md` (mono, loudness-matched, trimmed), added under `public/assets/audio/ambience/`, and mapped in `src/audio/sounds.ts`. The `CREDITS.md` entry needs the source page and licence, which the user still has to supply, so the entry is recorded as "freesound_community" until then.

## Risks / Trade-offs

- [The sightline is not as assumed and the run is hidden] → check with a raycast from Jay's run-stop position to the elite's start position before tuning anything else, and move the start forward if blocked.
- [The scripted run feels like a player teleport or fights the collider] → run along a navmesh-clear line, run for about 1.5 s, and test with a squad member standing near the wheel.
- [Releasing the view at the slam breaks the squad placement or the checkpoint position] → place squad and checkpoint from Jay's actual position, and cover it with a sequence test.
- [Wider gap looks passable] → keep the collider test, and check the look in the browser from the pump room.
- [The scream is loud and clips against the stinger] → set gain by ear and keep it a few dB under the slam hit.
- [The ambush cuts in while `valve_turn` is still running and leaves music or flags half-set] → the flags and checkpoint are set at the slam (D9), the ambush plays `floodOut` itself, and a sequence test fires the trigger mid-aftermath.
- [Taking the checkpoint at the slam saves Jay mid-cutscene] → save Jay's real position and verify a restore from `cp_valve` still places the squad in R10 and seals the door.
