# Proposal

## Why

Footsteps are the only sound that knows about walls. `FootstepAudio` raycasts from the listener to each step through `CollisionWorld` and low-passes and quiets it behind a full-height wall or closed door (`in-world-audio`: Footstep range and occlusion). Every other positional sound goes straight to `audio.play` with a position and nothing else. An infected groaning behind a bulkhead sounds as clear as one standing in the room, and so does a slam or a door cycling two rooms away. For a horror game, hearing something muffled through a wall before you see it is one of the cheapest scares there is, and the code to do it already exists.

## What Changes

- **One occlusion check for positional effects.** The wall test inlined in `main.ts` for footsteps (raycast listener to source, only barriers whose top is at least 2 m high count) moves into a shared helper. The audio engine applies it to every positional one-shot on the `sfx` bus, unless the call opts out. New sounds are covered by default.
- **Same treatment as footsteps.** An occluded sound is low-passed and quieter, with a little more reverb, using the values footsteps already use. Footsteps switch to the shared helper with no audible change.
- **Covers today:** infected groans (`ZombieVoices`), hero enemy slams, and door open, close, denied and unlocked sounds when another wall or door is between the door and the player.
- **Not covered:** looping sounds; the ambience bus (its one-shots are already authored `muffled` and placed "far" on purpose); the radio; music; dialogue on the `voice` bus (it must stay intelligible); the player's own sounds; and sounds played by scripted sequences and kills, which stay as authored (for example, the Lab B kill heard through the glass).
- **No new dependency.** It uses `CollisionWorld.raycast`. If `adopt-physics-engine` later adds mesh raycasts for cosmetic rays, this helper is one of their callers.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `in-world-audio`: adds a "World sound occlusion" requirement for positional effects other than footsteps, with the exclusions above. "Footstep range and occlusion" is unchanged.

## Impact

- **Code:** `src/audio/engine.ts` (listener position, an injected occlusion test, an `occlude` option on `play`), a new `src/audio/occlusion.ts` (the shared wall test and muffle values), `src/audio/footsteps.ts` (use the shared values and opt out of the engine check, since it already applies its own), `src/main.ts` (wire the test once instead of inline, and opt the kill `sfx` hook out), and `src/script/gameHost.ts` (opt sequence sounds out). `enemyGame.ts` and `doorAudio.ts` need no change.
- **Tests:** `footsteps.test.ts` stays green unchanged. New engine tests use the fake Web Audio in `src/audio/testing/` with a small test room: a groan behind a closed door is muffled, the same groan with the door open is not, and an opted-out sound is never muffled.
- **Performance:** one raycast per positional play, at most a few dozen a second in the heaviest fight. Recorded once in the heaviest slice scene.
- **Specs:** `audio-mix` is unchanged. Its damage muffle is a whole-mix filter and stacks with per-sound occlusion.
