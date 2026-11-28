# Design

## Context

See `proposal.md` for the measurements. The facts the approach rests on:

- A High-tier lit program counts 35 point lights, 10 spot lights (7 with shadows, 1 with a pattern) and 1 directional light. Its fragment source is about 120 KB, and compiling one cold on Direct3D 11 takes about 0.6 s. A draw that needs a program that is not ready blocks the main thread until it is. Texture upload time in the stalled frames was close to zero.
- three.js (r187) puts the output colour space, tone mapping and the visible light counts in each program's key. With no render target bound, `compile` builds screen variants. Play draws into the post chain's target, so it needs the others. The `render:warm` handler in `session.ts` already binds a target; the loading-screen warm-up does not.
- `NpcActor.update` hides a body more than 45 m away. Each squad member's weapon light is a child of that body, so the visible spot count moves between 10, 9 and 8, and each count needs its own variant of every lit material.
- three.js destroys a program when the last material using it is disposed. The warm-up disposes its two sample bodies as soon as it has compiled them.
- Remaining stalls with the first two causes patched: 2.4 s at the first fight (wet and imported body surfaces) and 0.85 s at the finale creature, whose GLB is fetched on `transit:juggernaut_reveal`.
- Fallen crew bodies and blood decals in `world/kit/transit.ts` start their loads while the level is built and nothing waits for them.

## Goals / Non-Goals

**Goals:**

- No program compiled between the loading screen fading out and the session ending, at the loaded quality tier.
- A regression is visible in a playtest and, where it can be checked without a GPU, fails a test.

**Non-Goals:**

- Moving asset loading or rendering to worker threads.
- Changing light counts, materials or anything visible.
- Warming again after a graphics quality change; that still recompiles during play.
- Making cold loads faster beyond what dropping the unused variants gives.

## Decisions

### D1. One way to compile for play

A small render module owns "compile these objects for play": bind a 1x1 render target, call `compileAsync`, restore the previous target. Both the loading-screen warm-up and the `render:warm` handler use it. A test with a stub renderer checks that a target is bound during the call and restored after it.

*Alternative:* bind a target inline at the one broken call. Rejected: the same trap has now been hit in one place after being documented in another.

### D2. Squad weapon lights hang from the squad group

The light and its target become children of `squad.group`, which is never hidden in play, and are placed in world space from the muzzle and aim. The squad syncs them after everything that moves a mate has run (the ride, the squad step, catch-up teleports and the NPC director). A hidden mate's light has intensity 0 and stays counted.

The rule for new code: a real light never hangs from a node that play can hide or remove.

*Alternatives:* exempt the squad from distance hiding (the measurement patch), which draws far bodies and leaves any other hide able to break the count; hide meshes instead of the body group, which touches every reader of `body.group.visible`.

### D3. A warm set that lives as long as the session

The warm-up builds a hidden set of sample objects, adds it to the scene for the compile and the warm frames, then detaches it without disposing its materials. The session disposes it. It holds:

- for every loaded body model and the procedural body: the dry, wet and surface materials on skinned meshes, plus whatever unskinned form severed parts use;
- the gore materials that have no mesh in the scene at load time (pools, water clouds, glass marks, cracks). Casings are sound only, and splashes and sparks already have their points in the scene;
- every held item (mug, wand, pistol with its muzzle flash), which a body creates the first time it shows one.

The finale creature is in the scene itself (D4).

Samples are built through the same code play uses (a real body, a real gore material), so their programs cannot drift from the real ones. A sample body gives up its geometry, shadow-caster and contact registrations after the warm-up and keeps only its materials.

*Alternatives:* a hand-written list of material feature combinations (drifts silently); keeping whole hidden bodies alive (they would need excluding from shadows, contact shadows and updates).

### D4. Everything late-appearing is loaded before the warm-up

The finale creature moves into a preload-and-dispose module like `render/fx/subModel.ts`, loads alongside the cast assets for levels that show it, and is added hidden before the texture upload and warm stages. The reveal event only shows and places it. A failed load logs a warning and the session carries on. The transit kit's fallen bodies and blood textures report their pending loads, and the loading screen waits for them before the texture upload.

### D5. Passes `compile` does not cover are warmed by drawing them

`compile` builds the materials' own programs only. Shadow depth programs and the room-capture filter, downsample and blend programs are built by drawing: one shadow pass of the flashlight takes every visible caster with frustum culling off (the warm set among them), and after the warm frames the room captures run one capture and the first frame of its cross-fade. The camera feeds' look pass draws into a feed's target, so its own warm-up binds one, as D1 does. D6 finds anything left over.

### D6. A program watch in developer sessions

After the warm-up, a developer session records the programs in `renderer.info.programs`. Each later frame it warns once, by name, about any new one. While the debug fly camera is on, or the graphics quality differs from the one the session loaded with, new programs are accepted without a warning (a quality change keeps compiling as things come into view, so resetting once is not enough). The comparison is a pure function with its own test.

CI has no GPU, so the automated tests cover the causes instead: the compile helper binds a target (D1), and the visible light count is unchanged with the squad near, far, split and with weapon lights on (D2).

*Alternative:* a browser test in CI. Rejected here: the repository has no browser test runner, and a software renderer takes minutes to compile these shaders.

### D7. How the result is verified

In a browser, with the shader cache defeated by adding a never-taken `discard` with a random constant to each fragment shader: load `?level=slice01&debug&slot=scratch&jump=r05`, move the view through every room facing four ways, fight every body model including in water, and play the finale. Pass: the program watch stays silent and no frame is stalled by a compile. Record load time and the warm stage's duration here beside the figures in `proposal.md`.

## Risks / Trade-offs

- [A pass cannot be warmed ahead of play] -> The watch names it. If it truly cannot be built at load, narrow the requirement in this change before archiving, with the measured stall.
- [The larger warm set lengthens loading] -> Programs are deduplicated by key and compile in parallel. The patched warm stage took 6.9 s against 23.5 s today; record the final figure and say so if it ends above today's.
- [A weapon light lags its muzzle by a step, mostly on the train] -> Sync after all movement and check the ride in the browser.
- [Kept materials and the early creature use more memory] -> Re-measure with `?slot=scratch&memprobe` as `runtime-memory` requires, including quit-to-title disposal.
- [A dev server with a warm cache hides misses] -> Verify with the cache defeated (D7).
- [Other active changes edit `session.ts` and add bodies] -> Re-run D7 after merging; the watch shows what they added.

## Measurements

Same machine and procedure as `proposal.md` (cold shader cache, High, `?level=slice01&debug&slot=scratch&jump=r05`, dev server).

| After | Total load | `shaders+warm` | Programs first compiled in the 8 s after ready |
|---|---|---|---|
| Before the change | 33.2 s | 23.5 s | not recorded |
| Task 1.2 (compile for the play target) | 16.7 s | 6.9 s | 5, all unlit: the room-capture PMREM, downsample and blend programs |
| All groups (task 5.1, 2026-11-25) | 15.8 s | 8.6 s | 0 |

Task 5.1 run, cold cache, developer session, nothing reported by the program watch in any part of it: every room facing four ways; fights with every body model, severed limbs, a hero and a play-dead body, dry (R05) and with water (R09); the finale creature's reveal; every enemy and corpse removed, a checkpoint restart and both fights again. The longest frame after ready was 133 ms, none of it waiting on a shader.

Also clean for 55 to 75 s each from a new game and the jumps `drop`, `r07`, `r10_flood`, `r11`, `stinger_priya`, `r16_finale` and `transit_ride` (cold-cache loads 16 to 23 s, warm stage 8.8 to 10.6 s). The player stood still in those, so scenes that wait for the player to walk somewhere were not all played.

The warm stage grew from 6.9 s to about 9 s with the warm set, the shadow pass and the held items, still far below 23.5 s.

Weapon lights (task 2.4): on the train ride and in the finale the light was 0 m from the muzzle and its target 0 m from the aim on every sampled frame, across the ride's cabin hand-off.

Memory (task 5.2, 2026-11-25): High, 1920x1080, `?level=slice01&debug&slot=scratch&memprobe`, dev server, heap after forced garbage collection. "Before" is `a97d09c` served from a clean export; "after" is the working tree, which also holds other changes' uncommitted work.

| Sample | JS heap MB | GPU textures MB | GPU buffers MB | Decoded audio MB | Programs |
|---|---|---|---|---|---|
| Loaded, before | 75 | 1779 | 16 | 488 | 167 |
| Loaded, after | 85 | 1841 | 148 | 494 | 151 |
| 12 waves of 8 shamblers killed and removed, before | 80 | 1798 | 52 | 488 | 177 |
| 12 waves, after | 87 | 1845 | 148 | 494 | 151 |
| Every room visited, before | 91 | 1800 | 153 | 490 | 297 |
| Every room visited, after | 88 | 1862 | 153 | 496 | 151 |
| Quit to title, before | 79 | 0 | 0 | 303 to 305 | 0 |
| Quit to title, after | 79 | 0 | 0 | 310 to 312 | 0 |

- Heap, texture and audio figures stay within 15% of before.
- GPU buffers are 148 MB at load against 16 MB, because the shadow warm-up pass draws every caster, which uploads its geometry. It is the same memory the old build reached once every room had been seen (153 MB in both), taken at load, and it also removes those first-view uploads from play.
- The program count no longer grows with play.
- Quitting to the title frees every GL object and leaves the same heap as before. One session cycle was measured, not three.

## Open Questions

- Should the title preload also fetch the finale creature? It only shortens the load.
- Metal on the M2 Air was not measured. The causes are the same; the times will differ.
