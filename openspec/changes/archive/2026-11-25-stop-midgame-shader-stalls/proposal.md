# Proposal

## Why

Play freezes for about a second at a time. The cause is shader compilation during play, which the `session-loading` spec already forbids: the loading screen compiles variants the game never draws, and hidden characters change the scene's light count, which gives every lit material a new variant.

Measured on 2026-11-25 at `a97d09c` (High, RX 7900 XTX, Chrome with Direct3D 11, shader cache defeated, dev server):

| | Now | With the first two fixes patched in the browser |
|---|---|---|
| Total load, jump to `r05` | 33.2 s | 16.7 s |
| Shader warm stage | 23.5 s | 6.9 s |
| Programs compiled while a camera visits every room | 151 | 6 (none lit) |
| Time stalled during that tour | 85 s | 0.3 s |
| Longest single frame in the tour | 20 s | 0.18 s |

With an ordinary browser cache, the intro still froze for 1.3 s, 0.7 s and 0.8 s.

## What Changes

- The loading-screen warm-up compiles against the same kind of render target the game draws into, so the variants it builds are the ones play uses.
- Every real light stays counted for the whole session. Hiding a character no longer removes the squad's weapon lights from the scene.
- The warm-up covers what first appears mid-game: every body material variant (including wet and hero bodies) and the Juggernaut, whose model is loaded with the session instead of during the finale.
- Warmed programs stay alive for the session, so removing the last enemy or corpse that used one does not force a recompile later.
- A guard reports any shader program first compiled during play, and tests fail if the light count can change during play.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-loading`: the stutter-free requirement becomes testable (no program is first compiled during play, warmed programs are kept, late-appearing models are loaded up front) and gains a way to report violations.
- `render-lighting`: the number and kind of real lights stays constant during play, whatever is hidden, removed or far away.

## Impact

- `src/app/session.ts` (warm-up stage, Juggernaut loading, guard wiring), `src/ai/squad.ts` (weapon light ownership), probably a new small module for the warm set and the guard.
- `src/actors/` body materials and gore, only as far as the warm set needs to build them.
- Load time should fall. The Juggernaut (7.8 MB GLB, 6 images) is held for the whole session instead of from the finale on, so the `runtime-memory` figures are re-measured.
- No new dependency, no asset change, no change to how the game looks.
- Other active changes (`add-physics-ragdolls`, `adopt-physics-engine`, `commons-overheard-chatter`) may add bodies or meshes that the warm set has to cover.
- Out of scope: worker-thread asset preloading (assets are already loaded and uploaded before play), reducing the light counts, and re-warming after a graphics quality change.
