# Design

## Context

See proposal.md (Why) for the problem. The current state that shapes the approach:

- **Feeds.** `CameraFeeds` (`src/render/cameraFeed.ts`) holds every feed. The rate (`FEED_FPS = 10`) and the render size (`FEED_SIZE = 320x180`) are module constants shared by every feed: the six dock CCTV monitors and the fullscreen `stinger` feed in `stinger_priya` (`action_climax.json`). `update()` sets `since = 0` after each frame, so the time left over past the interval is lost and the real rate falls below the target, with uneven gaps (at 60 Hz a 10 fps feed lands between about 8.5 and 10 fps).
- **The look.** One CCTV pass (`cameraFeedGl.ts`) serves monitors and fullscreen alike: x2.2 gain, 20% colour, +/-0.05 noise per texel, scanlines at one per texel row (`uRes.y`), and a vignette that darkens the edges by up to 90%. At fullscreen every one of those is magnified about 6x.
- **Cost.** In `main.ts` the player's view is fully rendered (`post.render`) and then the fullscreen feed is drawn over it (`feedGl.overlay`), so the stinger pays for two scene renders a frame.
- **The rise.** `convertedRise` (`kills.json`) is a `converted` kill of five beats. Its `rise` beat cycles four authored poses every 0.38 s with 0.12 s blends and convulsion 0.4. The animator turns motion capture off whenever convulsion is above 0.01 (`animator.ts`, the `useMocap && !seq && convulse <= 0.01` gate), so every beat after `still` is authored poses plus sine jitter.
- **Clips.** `sampleClip` (`src/actors/mocap.ts`) already clamps a clip whose `loop` is false and samples a pelvis position track. No clip in `scripts/mocap.sources.json` is one-shot today, and kill beats name poses only. Priya has a mocap pack (`src/data/mocap/priya.json`, 6 clips) from the in-flight `per-character-motion` change.
- **The take.** CMU `77_17` ("laying down, getting up, careful ready pose"), chosen by the user after watching it. It is not yet in `previews/sources/mocap/cmu/`.

## Goals / Non-Goals

**Goals:**
- The stinger reads sharp and smooth at 30 fps or more on a 60 Hz display, and still reads as security footage.
- Priya's rise is captured human motion, made wrong by the infection layered on top, not keyframes.
- The dock monitors look and cost the same as they do now.

**Non-Goals:**
- Changing the stinger's shot, timing of the other beats, lines, sounds or the cut to static.
- Captured motion for the other kill beats (`twitch`, `turn`) or for other kills.
- Priya's R08 death (`overhaul-priya-r08-death`) or any other use of the `converted` kind.
- A general cutscene or timeline system for clips outside kills.

## Decisions

### 1. Rate and size are per feed, set by the `cameraFeed` action

`CameraFeedOptions` gains optional `fps` and `size` (`{ w, h }`). A feed created without them keeps today's 10 fps and 320x180. A feed's render targets are created at its size on first use; a later `cameraFeed` step with a different size resizes them (`setSize`), not recreates them. `stinger_priya` sets `fps: 30` and `size: { w: 960, h: 540 }`.

- *Why not raise the constants:* six live dock monitors at 30 fps and 960x540 would be six extra full scene renders most frames, for screens a few hundred pixels wide.
- *Why not size the stinger to the screen:* the renders are throttled and the look is soft by design; 960x540 is sharp enough under the CCTV pass at 1080p and half the cost of 1920x1080. The size is authored data, so it can go up after a playtest without code.
- *Alternative: a "fullscreen implies high quality" rule.* Rejected: it hides a cost behind a flag and would make a future fullscreen feed that should look cheap impossible.

### 2. The throttle keeps leftover time

After a frame, `since -= interval` instead of `since = 0`, clamped so a long stall (a hitch, the tab hidden) does not queue a burst of catch-up renders: if `since` is still at least one interval after the subtraction, it drops to 0. A feed with `fps` at or above the display rate renders every frame.

- At 60 Hz a 30 fps feed then renders on exactly every second frame. At 144 Hz it alternates gaps of 4 and 5 frames, which reads as smooth.

### 3. The look's strength follows the feed's size on screen

Each feed has a `look` (`monitor` default, `fullscreen` for the stinger, set by the action). The pass reads its strength from `LOOKS` in `cameraFeedGl.ts`. For `fullscreen`:

- Scanlines are drawn by the overlay pass at screen resolution (`gl_FragCoord`), one every `scanPitch(height)` pixels (3 px at 1080p, clamped to 2-4 px), depth 0.12, and not into the feed texture. *Changed during implementation:* lines 3 screen pixels apart cannot be drawn into a 960x540 texture that is then stretched to 1080p (they would alias), so the overlay, which already runs at screen resolution, draws them. The overlay is now a small shader material that keeps MeshBasicMaterial's output encoding (`colorspace_fragment`).
- Gain x1.5 instead of x2.2; colour kept at 45% instead of 20%; grain amplitude halved (it is per feed texel, so finer at 960x540).
- A contrast curve (gamma 1.3, applied before the grain) deepens the blacks. *Added during browser tuning:* without it the clearer picture read as murky grey-green and Priya did not stand out.
- The vignette reaches 55% at the corners instead of 90%.
- The caption is laid out at half the monitor's scale, and the caption and REC dot are moved down 13% of the height. *Added during browser tuning:* sharp, the old caption proportion spanned a third of the view, and the stinger's 11vh cinematic bars covered both.
- Tint and the occasional wobble are unchanged. The caption is drawn at the feed's own resolution, so it stays sharp at any size.

Final values (tuned in the browser at 1280x720 on the stinger): `fullscreen: { gain: 1.5, colour: 0.45, noise: 0.05, scan: 0, vignette: 0.55, gamma: 1.3, labelScale: 0.5, inset: 0.13 }`, overlay scanline depth 0.12. `monitor` keeps the original numbers exactly (`gain 2.2, colour 0.2, noise 0.1, scan 0.16, vignette 0.9`, no curve, caption unchanged), pinned by `cameraFeedGl.test.ts`.

Exact values are tuning, done in the browser. `monitor` keeps today's numbers exactly, so the dock wall does not change.

- *Alternative: a second shader.* Rejected: one pass with a few uniforms keeps the two looks from drifting apart.

### 4. The player's view is not rendered under a fullscreen feed

While `cameraFeeds.fullscreen` is a live or static feed and the game is playing, the frame skips `post.render` and the overlay clears and draws the feed alone. The world still updates (sequences, audio, NPCs), only the player's camera render is skipped. The shadow update that frame is left to the feed's own render.

- This pays for the 30 fps 960x540 feed: the stinger goes from two scene renders a frame to at most one.
- The fade steps around the feed (`fade to 0` after the feed starts, `fade to 1` after it goes `off`) already cover the switch, so no frame of an empty view shows.

### 5. A kill beat can play a captured clip

A beat gains `clip` (a clip id from the victim's motion profile or pack) and `speed` (default 1). With a clip:

- The beat drives the victim's body from the clip, from its first frame to its last, at `speed`, then holds the last frame. Its poses list is optional and, if given, only gives the pose to hold after the beat ends.
- `until: "clip"` ends the beat when the clip ends; `max` still bounds it.
- The victim's root stays where the kill put her; the clip's pelvis position track moves the body off the floor. The clip's facing is aligned to the victim's current facing at the start of the beat.
- A clip that is missing (pack not loaded, bad id) logs once and falls back to the beat's poses, so the kill never stalls.

`speed` can also be a short list of `[t, speed]` keys across the beat, so a rise can lurch: slow, a fast jerk, slow again. Linear between keys.

- *Alternative: a `clip` kill event.* Rejected: the beat already owns the body, its timing and its end; an event would fight the beat's own pose.

**As built:**
- `KillRun` owns the clip's progress (one clock): a `clip` hook starts it and returns its length (null when missing); each update moves progress on by `dt * speed(t) / length` and pushes it through `clipPhase`. The animator samples the clip at that progress into its authored base pose (`Animator.playClip` / `clipPhase`), so the clip blends in like any `setPose` and the next beat's pose stops it.
- `poses` stays required: on a clip beat it is the fallback that loops when the clip is missing (the spec's missing-clip behaviour needs it), and its first pose is set on entry before the clip takes over. A missing clip under `until: "clip"` ends the beat at `s`.
- `Humanoid.chooseAnimation` no longer re-poses a body while its clip plays (it called `setPose` every frame). The facing needed no alignment: the bake turns each take so the hips' mean forward is -Z, and a face-down get-up ends facing where the head pointed.

### 6. Convulsion layers over a clip instead of switching it off

During a clip beat, convulsion and `kick` reactions are added on top of the sampled clip, the same additive offsets they add to authored poses today. The `convulse <= 0.01` mocap gate stays for every other case, so no other kill or the locomotion blend changes.

For a clip beat the convulsion noise also runs slower and larger-grained: the fast sines (17-31 Hz) are scaled down to about a third of their rate, so at 30 fps on a feed they read as tremor and spasm, not flicker. This applies only while a clip plays.

**As built:** the convulsion noise runs on its own clock (`convulsePhase`), which advances at `CLIP_CONVULSE_RATE` (1/3) while a clip plays and at 1 otherwise, so for a body that never plays a clip it equals `time` exactly (tested). Because the clip is the authored base layer and not the mocap layer, the mocap gate is untouched. The hold layer is also off while a clip plays.

### 7. `priya_rise` is a one-shot clip in Priya's pack

`scripts/mocap.sources.json` gains `priya_rise`: `source: cmu`, `take: 77_17`, `loop: false`, `loco: false`, `pack: priya`, trimmed with `start`/`end` to the get-up only (from first movement on the floor to standing, before the "careful ready pose"). The bake keeps the pelvis height track for it. The trim times are found from the take's pelvis height curve after fetching.

`convertedRise`'s `rise` beat becomes `clip: priya_rise`, `until: clip`, convulsion about 0.1, and a few `kick` events (a shoulder, the head) for the twitches; its `face` beat is unchanged. Speed starts at about 0.75 with one or two lurches, tuned in the browser.

If `77_17` does not start face-down, the `turn` beat ends in a pose that matches the clip's first frame (on her back or side, from a new authored pose), so the hand-off into the clip has no pop.

**Found after fetching (task 3.1):** `77_17` starts face-down (chest facing the floor from 0.25 s; frame 0 is the calibration T-pose), so it matches `corpseProne` and no roll is needed. The take runs 6.0 s: face-down to 1.6 s (a small head lift at 1.0 s), push up onto hands and knees 1.75-3.0 s, kneel up 3.0-4.25 s, stand 4.5-6.0 s, ending bowed about 27 degrees forward. `priya_rise` is trimmed to 1.6-6.0 s (4.4 s, 107 frames at 24 fps). Baked hip height: 0.04 m at the start, 0.49 m on hands and knees, 0.93 m standing, 0.88 m at the end. The existing bake already handles `loop: false` correctly (no seam blend, no loop window, no travel removal, hip height from the floor up), so it needed no code change.

**First tuning (task 5.1):** speed keys `[[0, 0.6], [1.3, 0.6], [1.55, 1.35], [1.85, 0.65], [3.6, 0.7], [3.8, 1.25], [4.05, 0.8]]` (slow, a lurch onto the hands, slow kneel, a second lurch up to standing), so the rise lasts 5.9 s; convulsion 0.1 at rate 2; kicks on the right shoulder (0.9 s), the head (2.6 s) and the left shoulder (4.4 s); blend in 0.3 s. The old pose loop stays as the fallback (1.5 s). These are starting values for the playtest.

**Playtest fixes (first review):** her lying body was half in R08b's east wall, and the ending showed the game between the feed and the credits.
- **Where she lies:** `corpseProne` lies by tipping the root about the feet, so her head sat 1.6 m out from `priya_hide` and, at yaw 300, inside the east wall (x 9.75). `priya_hide` moves to (9.2, 0, 53.45), yaw 0: she lies along the free strip between the bed and the east wall, head toward CAM 04. Measured against the level's colliders, the lying and writhing poses stay 11-16 cm clear. During the rise one hand at a time comes within about 1 cm of the bed side or the wall.
- **No flip before the rise:** the `turn` beat used `writhing`, which lies on the back the other way round, so her head swung about 3 m in 0.3 s and then swung back into the face-down clip. A new `writhingProne` pose (face-down, a knee drawn up, arms clawing) replaces it in `convertedRise` only.
- **No jump into the clip:** the bake centres a clip's hips on their average, so the clip's first frame lay 0.47 m off from the body. `playClip` now moves the body's origin (`clipShift`, applied by `Humanoid.playKillClip` and synced to the actor) so the first frame's hips land where the hips are, and she stands where the clip ends. The pose being left is first rebuilt on the clip's root (`rebaseRoot`): blending a tipped root into bent hips sagged the head 0.24 m through the floor halfway. Pinned in `animator.test.ts`.
- **Straight to the credits:** the stinger now fades to black before turning the feed off. `endSlice` used to go to the title (clearing the fade and drawing the level) and then lazy-load the credits, which also fade in over 700 ms. It now shows the credits over the black, waits until they cover the screen, then goes to the title underneath.

**Second review:** a pool of blood under her, no menu sting before the credits, and no pop-up before them.
- **Blood pool:** `sec_glass` (where she is first laid in the surgery) and `action_restore` place a `gore` pool at a new `priya_pool` anchor (9.2, 0, 52.55), under her chest. It has long finished growing by the stinger. Restore sequences re-run on every resume, so a `pool` step marks a spot once per session (the game never clears pools). The tests that forbid hand-placed gore in her scene now allow exactly this pool.
- **No menu sting:** going to the title under the credits unhid the menu, which plays its open sting. The sting is skipped while the credits are open.
- **No pop-up:** the end-of-slice credits now cover the black at once (`instant`, no 700 ms fade-in for anything above the black to show through), and the credits code is preloaded 4 s after boot so there is no download gap. On a production snapshot, the fade reached 0.97 and the next frame was the credits, fully opaque, with nothing else visible in between.
- **One song into the credits:** her rise plays under the Lab B score (`kill:still` cues its drone and hold). Going to the title used to hard-stop every score and fade the menu theme in, a choppy cut. When the slice ends with a score playing, the score now carries on under the credits and the menu theme is held silent (`MenuMusic.hold`). When the credits close, the score fades out over 3 s (`ScorePlayer.fadeOutAll`, timed on the audio clock because `update` does not run on the title screen) while the menu theme fades in.

**Third review:** the new logo, and nothing but the scene once the feed is up.
- **Logo:** the black THALASSA title card before the stinger and the credits' opening card now show the title screen's failing-display wordmark (`createTitleWordmark`) instead of plain text. Screen readers still get the text. The title card builds the animated logo each time it is shown and drops it once faded, so nothing keeps drawing behind play.
- **Hush:** a new `hush` step (`{ "do": "hush", "speakers": [...] }`, `"off": true` to lift) fades the world's ambience and sound-effect buses out on a separate per-bus gain in the engine (apart from volume settings and story ducking), and lets only the listed speakers be heard (`SpeechManager.onlySpeakers`: others are cut off, new lines dropped). Music and UI are untouched, so the score carries on. The stinger hushes everything but Priya (`nurse`) before its feed fades in. Going to the title or restarting lifts it.

## Risks / Trade-offs

- [The bake drops or normalises pelvis height for non-loco clips, so she rises in place, half in the floor] -> check the baked pelvis track first (task 1); if it is flattened, bake one-shot clips with absolute pelvis height.
- [Foot IK and contact solves pin her feet or hands to standing positions while she is on the floor] -> turn foot IK and hold layers off while a kill clip plays, as they already are for authored kill poses; verify in the cast motion sandbox.
- [Pop from the `turn` beat's last pose into the clip's first frame] -> blend into the clip over about 0.3 s; author the `turn` end pose to match.
- [Skipping the player's render leaves stale state (shadows, room visibility) for the first frame back] -> the fade to black covers it; the first frame after the feed goes `off` is a normal full render.
- [The sharper feed exposes the body model, the room dressing or lighting in the surgery] -> playtest at the new size; lighting fixes for CAM 04's view are in scope if they are about the shot.
- [The priya pack grows] -> a one-shot clip of a few seconds at the bake rate is small; the sizes table in `docs/mocap-sources.md` is regenerated by the bake.
- [The take's performer is male (subject 77, also used for Giles) and the get-up reads masculine] -> the user chose it after watching it; Priya's motion profile timing and the lurching speed make it hers.

## Open Questions

- Exact look values (gain, colour, scanline spacing, vignette) and the rise's speed keys: found by tuning in the browser, no spec change.
