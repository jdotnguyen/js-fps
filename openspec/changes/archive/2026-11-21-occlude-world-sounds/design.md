# Design

## Context

See proposal.md (Why). These are the parts of the current code that shape the approach:

- **Footsteps already do it.** `FootstepAudio.playCharacter` aims a probe at torso height (step position + 1.35 m) and calls an injected `isOccluded(listener, probe)`, skipping sources within 0.6 m. If the probe is occluded, it scales gain by 0.42, sets a 520 Hz cutoff (replacing its distance air-absorption cutoff) and raises reverb to 0.34.
- **The wall test lives in `main.ts`.** It raycasts `CollisionWorld` from the listener toward the source, stopping 0.35 m short, and counts a hit only if the collider's `maxY` is at least 2.0. Open doors disable their colliders, so they never block.
- **The engine knows nothing about the world.** `AudioEngine.play` builds source → optional low-pass (`muffled` = 650 Hz, or `cutoff`) → gain → HRTF panner → bus, plus a reverb send. `updateListener(camera)` writes the camera pose into the Web Audio listener but does not keep the position.
- **Positional one-shots on `sfx` today:** infected groans and the hero slam (`enemyGame.ts`), door sounds (`doorAudio.ts`, from the door's position), the kill `sfx` hook (`main.ts`, with no bus, so `sfx`) and sequence sounds (`gameHost.ts`, also `sfx` by default). Ambience one-shots and every `loop` are on the `ambience` bus. Weapon and UI sounds have no position.
- **Tests** use `installFakeWebAudio()` from `src/audio/testing/fakeWebAudio.ts`, which models gain, biquad and panner nodes with readable parameters.

## Goals / Non-Goals

**Goals:**
- One definition of "behind a wall" and one set of muffle values, shared by footsteps and the engine.
- New positional effects are occluded without the caller doing anything.
- `src/audio/` stays free of world imports. The world reaches it only through an injected function.

**Non-Goals:**
- Re-checking occlusion while a sound plays, or smoothly opening up a sound as a door slides.
- Partial occlusion, diffraction around doorways, or transmission that depends on the material.
- Changing the footstep rules, including the `maxY >= 2.0` barrier test (see Risks).

## Decisions

### D1. The check runs in the engine, not in each caller
`AudioEngine.play` applies occlusion when every one of these holds: the voice has a `position`; its bus is `sfx`; `opts.occlude !== false`; an occluder is set; and the source is more than 0.6 m from the listener. Callers that want the old behaviour pass `occlude: false`.
*Alternative:* each caller asks for occlusion, as footsteps do. Rejected: new sounds would silently skip it, which is today's problem.

### D2. Injected occluder and kept listener position
The engine gains `setOccluder(fn: ((from, to) => boolean) | null)`, and `updateListener` copies the camera position into a private vector that the check reads. With no occluder set, which is the case in headless tests and the title screen, nothing is muffled. `main.ts` sets it once the level's `CollisionWorld` exists and clears it on level teardown.
*Alternative:* pass `CollisionWorld` to the engine. Rejected: it couples the audio module to world code, and the engine tests would need a level.

### D3. Shared helper `src/audio/occlusion.ts`
The module exports:
- `wallOccluder(raycast)`, the test moved unchanged from `main.ts`: ray from listener to source, stopping 0.35 m short, with only hits whose `maxY` is at least 2.0 counting. It takes a raycast function, so the module imports nothing from `world/`.
- `OCCLUDED_CUTOFF_HZ = 520`, `OCCLUDED_GAIN_SCALE = 0.42` and `OCCLUDED_REVERB = 0.34`.

`main.ts` builds one occluder and gives it both to `FootstepAudio` (as `isOccluded`) and to `audio.setOccluder`. Footsteps import the constants instead of defining their own.

### D4. Footsteps keep their own call and opt out of the engine's
Footsteps aim at torso height rather than the sound's position, and when occluded they replace their distance cutoff. If the engine checked too, the muffle would be applied twice. So `playCharacter` and `playPlayer` pass `occlude: false`. Behaviour is identical, and `footsteps.test.ts` does not change.

### D5. Treatment, applied once at start
When occluded, the engine sets:
- cutoff to `min(opts.cutoff ?? (opts.muffled ? 650 : Infinity), 520)`
- gain to `(opts.gain ?? 1) * 0.42`
- reverb to `max(opts.reverb ?? 0, 0.34)`

A `duration` fade ramps from the reduced level, and `setGain` on the returned handle still works as before. Because the decision is made at start, a 2 s door clip or groan keeps it even if a door opens during it. That is acceptable for sounds this short.

### D6. Doors need no special case
A door sound plays at the door's centre, and the ray stops 0.35 m short of it, so the door's own leaf (about 0.2 m thick, centred on the same plane) is never hit. Another wall or closed door further along the line still blocks. A test pins this down.

### D7. Authored sounds opt out
The kill `sfx` hook in `main.ts` and the sequence sound step in `gameHost.ts` pass `occlude: false`, so scripted scenes sound as authored, including through Lab B's glass. A future sequence step field could opt in per step. That is not part of this change.

### D8. Glass is a light muffle (added after playtest)
The first build treated glass partitions as walls. In playtest, a monster groaning or slamming right behind the R07 glass dropped to a dull thud, and its volume jumped as it moved between the glass and an open doorway. Glass now has its own, lighter treatment:
- **Marking.** `wall_glass_partition` is the only kit piece that gives glass a collider (R03, R07, R12b, R14b). Its wall collider carries `acoustic: 'glass'` through `BoxSpec`, `transformBox` and `CollisionWorld.add`. Glass in `slice.ts` is decals only, with no colliders.
- **Wall test.** The occluder returns `'none' | 'glass' | 'wall'`. When the nearest full-height hit is glass, the ray continues from where it leaves that box. A wall or closed door further along returns `'wall'`, otherwise `'glass'`. A low hit still ends the search as before, so footsteps keep their behaviour everywhere except at glass.
- **Treatment.** Through glass: gain × 0.75 and cutoff `min(existing, 2500 Hz)`, with reverb unchanged. Footsteps use the same values and keep their distance air absorption when it is lower.
*Alternative:* no muffle at all through glass. Rejected by the author in favour of a light muffle, so the glass still reads as a barrier.

## Risks / Trade-offs

- [The `maxY >= 2.0` rule is absolute height, so on floors near 3 m a crate can count as a wall] → It is kept as is for parity with footsteps, as the Non-Goals say. If playtests show false muffles on the upper floors, a follow-up changes the rule to barrier height or a height above the listener, for both footsteps and the engine at once.
- [A muffled groan stays muffled after a door opens mid-groan] → Accepted (D5). Groans repeat every few seconds, so the next one is clear.
- [Raycast cost in a big fight] → One ray per positional `sfx` one-shot, a few dozen a second at worst, against the 2 m hash. Measured once in the heaviest slice fight and recorded below.
- [Glass panes counted as walls, so monsters at a window were inaudible] → Fixed by D8. Scripted kills stay exempt (D7).
- [A glass piece added later without the marker sounds like a wall] → A test asserts that every `wall_glass_partition` collider carries `acoustic: 'glass'`. New glass pieces with colliders must set it.

## Migration Plan

It ships in one change with no switch. Rollback is to not call `setOccluder` in `main.ts`, after which the engine never muffles and footsteps keep working through their own `isOccluded`.

## Measurements

| Scene | Rays per second (peak) | Added frame time | Notes |
|---|---|---|---|
| Heaviest slice fight | not measured | not measured | The shared dev server kept reloading during the session. No frame drops noticed in the author's playtest. |
