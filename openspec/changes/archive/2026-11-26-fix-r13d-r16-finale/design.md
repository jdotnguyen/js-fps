# Design

## Context

See `proposal.md` for motivation. Measured on 2026-11-26 with the shipped clips, in seconds after Jay boards. A headless run of the real script runtime, ride controller and speech manager gave these times, and a browser run from `jump=r11` showed the same missed waits.

| Time | Event |
| --- | --- |
| 56.1 | `r16_pa_01` starts (12.5 s) |
| 66.4 | Stage 3 hand-off; `R16a` still at its authored lighting |
| 68.7 | `r16_pa_01` ends; only now do the `R16` blackout steps run |
| 75.4 | Train at rest |
| 109.3 | Finale starts, after the 20 s and 15 s `waitFor` timeouts |

Causes:

- The Stage 2 `parallel` step waits for the dialogue branch, which outlasts `tunnelSeconds: 61`. The blackout and both `waitFor` steps come after it, and `waitFor` only sees events emitted after it starts.
- A PA voice is positioned once, when it starts (`voicePlayer.ts`). `session.ts` places onboard lines at the camera, but the hand-off then moves the camera about 45 m, roughly 23 dB down.
- `r13d_transit_walk` sends Okafor to `r15a_platform`, about 10 m from `r15a_giles_console`.
- Only the ride emits `transit:arrived_r16`, just after `cp_r16_arrived` saves. `action_restore` never re-emits it. (Found by reading the code; not yet reproduced.)
- `jump=r11` with no other parameter does reach the stinger. `&door=open` only works with `jump=transit_ride` and opens a door the script now owns. `&power=on` sets `r11_powered`, which `r11_power_bay` excludes, so by the code it skips the Power Bay scene.

## Goals / Non-Goals

**Goals:** fix the above and add the north-pillar scare, using existing clips, models and lights.

**Non-Goals:** reworking the ride controller to wait on dialogue, new voice takes, changes to `CAM 09`/`CAM 10`, or making `jump=r16`/`r16b` dark (they stay lit inspection jumps).

## Decisions

1. **Give Okafor a new anchor, `r15a_okafor_console`**, starting near `[44.2, 0, 40.4]` and facing Giles. Moving `r15a_platform` instead would move the `jump=r15a` spawn.

2. **Lengthen Stage 2 to 66 s and move the brake cue from 57 s to 62 s.** The same headless run then has the PA end at 68.7 and the hand-off at 71.4. Trimming dialogue or speeding the PA would change approved audio.

3. **Run the arrival steps in their own `parallel` branch** (gate sound, `r15a_okafor_03`, wait for `arrived`), registered when Stage 2 starts. The margin fixes today's clips; the branch keeps a longer future take from stalling the script. Latching events inside `waitFor` was rejected because it changes every sequence.

4. **Black out `R16a` and `R16b` as the ride starts**, before the Stage 2 `parallel`. Neither room is drawn from `R15a` or `R15b`, so nothing visible changes there. The finale keeps its own blackout steps.

5. **Onboard PA follows the listener.** Add a `follow` option on `say` that reaches the voice player and updates the panner each frame, set by `session.ts` for the onboard lines. Playing them with no position was rejected because it loses the overhead direction.

6. **Drag a body, and keep the creature unseen.** Playtesting showed that a glimpse of the Juggernaut spoils `CAM 10`. `r16b_corpse_booth_north` now lies at `[60.4, 0, 31]`, yaw `187`, so that from Jay's seat its legs are behind the far north-west pillar. `npcMoveTo` slides it in its frozen pose to `r16_body_drag_to [60.2, 0, 29.4]` at `0.3 m/s`. `R16b` is lit `steady` for about 4 s (0.6 s still, then the drag) and goes off before `r16_jay_02`. One on-off pulse is already safe under reduced flashing. Bodies slightly nearer the pillar on the floor plan lie in its shadow and do not read.

7. **Magnify the shot and clear its sightline.** The pillar is about 25 m from Jay, who is locked in the car, so `playerFrame` gains `zoom` (1 to 4, eased in and out; the finale uses 3). The arrival board stays at `z 35` and rises from `y 3.15` to `y 4.35`, just under the ceiling, because moving it south put it in front of `CAM 09`. Two luggage stacks move off the sightline.

8. **Time Giles's reply from the announcement.** The Stage 2 dialogue branch starts `r16_pa_01` without waiting, waits 4.8 s (the recording pauses from 4.6 to 5.2 s, after "traction power has been lost") and says `r15a_giles_04` with `overlap`. Splitting the announcement was rejected because it changes approved audio. A timing test holds the offset.

9. **A second restore sequence, `r16_restore`, owns the finale restart.** It lives in `action_restore.json`, triggers like `action_restore` (play from the title) when `transit_ride_done` is set and `r16_finale_done` is not, waits 0.1 s, applies the dark state, places the squad in the car, clears `seq:r16_arrival_finale` and emits `transit:arrived_r16`. The wait matters: a load starts restore sequences, then restarts and cancels them and runs them again, so an immediate emit would start the finale, lose it to the cancel and leave its `once` flag set. Pause and resume do not match the trigger. `jump=r16_finale` starts the same sequence instead of doing it by hand.

10. **Remove `&door=open`** and rewrite the stale playtest entries (the R11 wave fight and Giles reveal no longer exist). Test URLs carry `&slot=scratch` so saves are untouched.

## Risks / Trade-offs

- [Other agents are editing `session.ts`, `slice01.json`, `action.test.ts` and `PLAYTEST.md` in this checkout] → Re-read before editing, keep hunks small, and commit only this change's hunks.
- [Their saves reload the dev server's page mid-playthrough] → Run long browser checks when the tree is quiet, or block the live-reload socket in the test tab.
- [`gen-slice01.mjs` is behind `slice01.json`] → Add the anchors to both by hand; do not regenerate.
- [A body 25 m away is small even magnified] → A pale-coated body in the light, `zoom 3`, and a slow drag. A level test checks that it starts partly hidden and ends out of sight.
- [A re-recorded clip could push the PA past the hand-off again] → A timing test reads the real clip lengths and fails.
- [Console shows "17 texture units, GPU supports 16" in the test browser, from load onward] → Seen before any edit here; not part of this change.
