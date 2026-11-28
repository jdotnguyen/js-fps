# Proposal

## Why

After the contact fight in the Lab Junction (R05) the station is still fully lit, so nothing tells the player that the outbreak has spread past Lab B. A blackout beat here does that: panicked radio calls from around the base, a calm PA notice that main power has failed, then the whole station dropping to backup lighting. The darkness gives the flashlight a real job, so this is where it should be taught and where it should first be seen in the player's hand.

## What Changes

- New scripted beat at the end of the contact fight. Once the Voss creature (`r05_contact`) and the two monsters that follow it (`r05_trickle`) are dead, four new radio voices call in incidents from around the station one after another, each overlapping the last by about a second, and some are cut off. A squad member reacts, the Station PA announces main power failure and the switch to emergency lighting, and the whole station goes to backup lighting.
- New station-wide power state (`mains` / `backup`). In `backup`, the main lights in every room go out and only that room's backup lights stay on, dim, over darker ambient light. The state is saved with checkpoints and restored on load.
- The flashlight prompt ("F: Flashlight") appears when the blackout hits, unless the flashlight is already on. It still shows only once per profile.
- The flashlight gets a visible first-person model ("Flashlight" by MAR.COS., CC BY 4.0). While the light is on with the pistol out or no weapon drawn, it sits close in the lower left, pointing forward, its back end cut off by the edge of the screen so it never looks like it is floating. With the shotgun out the model is hidden and the beam keeps coming from the chest. No hand model is added.
- The drop's alarm becomes its own recorded ElevenLabs sound (`lockdownAlarm`), separate from the pump room's `klaxon` loop. ElevenLabs also supplies a power-down sound and the hum of the backup lamps.
- New VO, generated with Gemini TTS: four new radio speakers (`radio_ops`, `radio_dock`, `radio_hydro`, `radio_launch`), a new Station PA notice, and one squad reaction line.
- **BREAKING** (content): the TAG FM radio now plays only in the Commons kitchen. The Lab Junction (`r05_radio`), Hydroponics Storeroom (`hydro_radio`) and Sample Store (`dive_radio`) radios are removed, along with the `ruined_radio_off` sequence and the radio branches of `quiet_restore` that use them.

- The Launch Hall door to the Maintenance Corridor (`D_R13b_R13d`) is sealed for the whole game ("Out of service"), so the player cannot walk into the unpolished R13d from the dive bay. The climax still opens R13d from the Control Room, so its leak hiss stays.

## Capabilities

### New Capabilities
- `station-power`: the station-wide power state: how the blackout beat is triggered and runs, what backup lighting looks like, the radio chatter and PA notice with their speakers and voices, the flashlight prompt it raises, and keeping the state across checkpoints.
- `player-flashlight`: the first-person flashlight model: when it shows, where it sits on screen, and how it relates to the weapons and the beam.

### Modified Capabilities
- `render-lighting`: claimed lights gain a backup role; scripted power changes reach every room.
- `in-world-audio`: the TAG FM radio plays only from the Commons kitchen; the drop's lockdown alarm and the new power sounds are recorded samples.
- `lab-wing`: the wing no longer keeps the R05 console radio.
- `hydroponics-wing`: the Storeroom no longer has a radio.
- `dive-bay`: the bay no longer keeps the `dive_radio` anchor, and its door to the Maintenance Corridor is sealed all game.

## Impact

- **Data:** `src/data/sequences/action_contact.json` (new beat; ruined-radio steps and `ruined_radio_off` removed), `src/data/sequences/quiet_restore.json`, `src/data/sequences/drop.json` (alarm id), `src/data/dialogue/slice01.json` and `src/data/dialogue/speakers.json` (new lines and speakers), `src/data/levels/slice01.json` (backup lights and beacons, radio anchors removed, `D_R13b_R13d` sealed), `src/data/sequences/rounds.json` and `quiet_restore.json` (radio moves removed). Level changes are made in `scripts/gen-slice01.mjs`, which generates `slice01.json`.
- **Code:** a script action for station power in `src/script/actions.ts` and `src/script/host.ts`; power state in `src/world/level.ts`; save/restore in `src/game/save.ts` and `src/game/game.ts`; the flashlight prompt moved from the `area:dark` trigger to the blackout in `src/ui/tutorialPrompts.ts`; the flashlight model in `src/render/viewmodel/` or `src/render/flashlight.ts`; new samples in `src/audio/sounds.ts`.
- **Assets:** `public/assets/models/props/flashlight.glb` (compressed), new VO in `public/assets/vo/`, new SFX in `public/assets/audio/ambience/`.
- **Scripts and docs:** `scripts/lib/voCast.ts`, the ambience manifest in `scripts/ambience-generate.ts`, `docs/voice-casting-standard.md`, `CREDITS.md`, `docs/PLAYTEST.md`.
- **Tests:** sequence, level and save tests that refer to the removed radios or to the R05 end state.
