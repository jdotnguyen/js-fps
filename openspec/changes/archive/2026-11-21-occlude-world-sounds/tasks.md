# Tasks

## 1. Shared occlusion helper

- [x] 1.1 Add `src/audio/occlusion.ts` with `wallOccluder(raycast)` (the test moved unchanged from `main.ts`: ray from listener to source stopping 0.35 m short, only hits with `maxY >= 2.0` count) and the `OCCLUDED_CUTOFF_HZ`, `OCCLUDED_GAIN_SCALE` and `OCCLUDED_REVERB` constants (design D3); verify with `src/audio/occlusion.test.ts` on a small `CollisionWorld`: a full-height wall blocks, a 1 m counter does not, a disabled (open) door does not, and a source within 0.5 m is never blocked
- [x] 1.2 Make `FootstepAudio` import the shared constants, and wire `main.ts` to build one `wallOccluder` and pass it as `isOccluded`; verify `npm test -- src/audio/footsteps.test.ts` passes unchanged

## 2. Engine occlusion

- [x] 2.1 In `AudioEngine`, keep the listener position in `updateListener`, add `setOccluder(fn | null)` and an `occlude?: boolean` option on `VoiceOptions` (design D1, D2); verify with `npm run typecheck`
- [x] 2.2 Apply the D5 treatment in `play` when D1's conditions hold; verify with `src/audio/engine.test.ts` cases under the fake Web Audio: an occluded `sfx` sound gets a 520 Hz low-pass, 0.42 gain and at least 0.34 reverb send; the same sound with the occluder returning false, with `occlude: false`, on the `ambience` or `voice` bus, without a position, or within 0.6 m is untouched; `loop` is never occluded; and with no occluder set nothing changes
- [x] 2.3 Cover the `muffled` and `cutoff` combinations; verify with an engine test that `muffled: true` plus occlusion gives 520 Hz, and `cutoff: 300` plus occlusion keeps 300 Hz

## 3. Callers

- [x] 3.1 Pass `occlude: false` from `FootstepAudio.playPlayer` and `playCharacter` (design D4); verify with a footsteps test that the engine receives `occlude: false` and the occluded footstep values are unchanged
- [x] 3.2 Pass `occlude: false` from the kill `sfx` hook in `main.ts` and the sequence sound step in `gameHost.ts` (design D7); verify with `npm test -- src/script/gameHostSfx.test.ts` extended to assert the option is set on positional sequence sounds
- [x] 3.3 Call `audio.setOccluder(occluder)` in `main.ts` once the level's `CollisionWorld` exists, and `setOccluder(null)` on level teardown and return to title; verify with `npm run typecheck`, and in the browser that a groan from an infected behind a closed bulkhead door is muffled, and the next groan is clear once the door opens (game teardown never happens; the occluder is cleared on the title screen instead. Browser check done by the author in playtest.)
- [x] 3.4 Pin door behaviour (design D6); verify with an `occlusion.test.ts` case that a ray from either side to a closed door's centre is not blocked by that door, and that a wall between the listener and the door blocks it
- [x] 3.5 Add a short "Occlusion" note to `docs/audio-assets.md`: positional `sfx` one-shots are muffled behind walls by default, and `occlude: false` opts out; verify the note names the option exactly as `VoiceOptions` defines it

## 4. Integration check

- [x] 4.1 Run `npm test` and `npm run typecheck`; verify both pass
- [x] 4.2 Playtest with `docs/PLAYTEST.md` as a reference: infected groans heard through bulkheads in the slice, a hero slam behind a wall, Lab B's scripted kill through the glass still as authored, and door sounds from both sides; record the peak rays per second and added frame time in the heaviest slice fight in design.md "Measurements" (playtested by the author on 2026-11-21: glass found too strong, fixed by group 5; raycast cost not measured, see design.md "Measurements")

## 5. Glass muffles lightly (design D8, added after playtest)

- [x] 5.1 Carry an optional `acoustic: 'glass'` from `BoxSpec` through `transformBox`, `PieceBuilder.solid` and `CollisionWorld.add` to the collider, and set it on the `wall_glass_partition` wall collider; verify with a kit test that every `wall_glass_partition` collider is marked and `wall_panel`'s is not, and with `npm run typecheck`
- [x] 5.2 Make the occluder return `'none' | 'glass' | 'wall'`, continuing past glass to look for a wall beyond it; verify with `occlusion.test.ts` cases: glass only gives `'glass'`, glass then a wall gives `'wall'`, a wall then glass gives `'wall'`, and every existing case keeps its result
- [x] 5.3 Apply the glass treatment (gain × 0.75, cutoff `min(existing, 2500 Hz)`, reverb unchanged) in `occludeVoice` and `FootstepAudio`; verify with engine and footsteps tests that a sound through glass is quieter and duller than in the open but louder and brighter than through a wall
- [x] 5.4 Re-run the real-level probe at the R07 glass; verify a monster 1 m behind the pane now reads `'glass'`, and run `npm test` and `npm run typecheck`

## Workflow follow-up

- Archive the change once the playtest is signed off.
- Verify the archived `in-world-audio` spec contains "World sound occlusion" and an unchanged "Footstep range and occlusion".
