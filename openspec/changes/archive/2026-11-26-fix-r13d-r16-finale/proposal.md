# Proposal

## Why

Playing from the R13d walk to the R16 finale has timing, staging and restore faults. Okafor is out of earshot at the departure console, the power-loss announcement is lost at the R16 handoff, R16 shows lit and then goes dark, the train sits silent for over half a minute before the finale, and Jay's "something just moved by the north pillar" has nothing on screen to match it.

## What Changes

- Okafor waits beside Giles at the R15a departure console, so their conversation is heard from there.
- The onboard train announcements stay with the listener for the whole line, including across the ride's stage handoffs.
- The tunnel stage is long enough for the power-loss announcement to finish before the train reaches R16, and the arrival lines and finale can no longer miss the ride's arrival.
- R16a and R16b are dark from departure onward. Only the scripted flickers light them.
- Giles says the lost-call line during the power-loss announcement, just after it reports the power gone, instead of at the arrival.
- Before Jay's warning, Jay squints at the far north-west pillar and one flicker shows a body dragged away behind it. The creature stays unseen until `CAM 10`.
- Continuing from the `Arrival Terminal` checkpoint starts the finale again instead of leaving Jay in a parked train.
- `?debug&jump=r11` is the documented way to play from the Power Bay through the finale. The stale `&door=open` debug parameter is removed, and the playtest notes are corrected.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `transit-wing`: R16 darkness starts at departure; onboard announcements finish before the handoff; new requirements for Okafor's console position, arrival timing, Giles's reply during the announcement, the dragged body, checkpoint restore and the end-to-end debug jump.
- `voice-playback`: onboard train announcements are an exception to the Station PA's fixed wall speaker.

## Impact

- Scripts and data: `src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `src/data/levels/slice01.json`, `scripts/gen-slice01.mjs`
- Code: `src/dialogue/speech.ts`, `src/dialogue/voicePlayer.ts`, `src/app/session.ts`, `src/actors/player.ts`, `src/script/actions.ts`, `src/script/host.ts`
- Tests and docs: sequence, voice, camera and level tests, a new ride timing test, `docs/PLAYTEST.md`
- No new assets, voice takes or lights.
- Out of scope: R11 and R13d dialogue, the CAM 09 and CAM 10 shots, the stinger and credits.
