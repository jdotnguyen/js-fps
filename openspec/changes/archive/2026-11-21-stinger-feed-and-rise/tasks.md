# Tasks

## 1. Feed rate, size and throttle

- [x] 1.1 Add optional `fps` and `size` to `CameraFeedOptions` and the `cameraFeed` action's validation, defaulting to 10 fps and 320x180; resize an existing feed's targets with `setSize` when a later step changes its size. Verify with new cases in `src/render/cameraFeed.test.ts` (default feed, a 30 fps 960x540 feed, a resize) and `npm test -- src/render/cameraFeed.test.ts src/script/action.test.ts`
- [x] 1.2 Keep leftover time in `CameraFeeds.update` (`since -= interval`, drop to 0 after a stall) and render every frame when `fps` is at or above the display rate. Verify in `cameraFeed.test.ts`: a 30 fps feed at steady 1/60 s steps renders exactly 60 frames in 2 s, and one 0.5 s step renders once
- [x] 1.3 Set `fps: 30` and `size: { w: 960, h: 540 }` on the `stinger` feed in `stinger_priya` (`src/data/sequences/action_climax.json`), leave the dock feeds without them, and verify with `npm test -- src/script/quiet.test.ts src/script/action.test.ts` and `npm run typecheck`

## 2. Fullscreen look and render cost

- [x] 2.1 Add a per-feed `look` (`monitor` default, `fullscreen`) to the action and options, and in `cameraFeedGl.ts` drive scanline spacing, grain size, gain, colour and vignette from it and a texel-to-screen-pixel uniform, keeping `monitor` at today's exact values. Set `look: fullscreen` on the stinger feed. Verify `monitor` output is unchanged with a dock-wall screenshot before and after (`?slot=scratch`), and `npm run typecheck`
  - Done: fullscreen scanlines moved to the overlay pass at screen resolution (see design decision 3). Verified the monitor look is unchanged with `src/render/cameraFeedGl.test.ts`, which pins the original numbers, instead of a before/after screenshot: a "before" capture would have needed stashing the shared working tree. Typecheck clean.
- [x] 2.2 Skip `post.render` in `main.ts` while a live or static fullscreen feed is up and the game is playing, and have the overlay clear and draw the feed alone. Verify in the browser that the stinger renders the world at most once per frame (renderer `info.render.calls` / `CameraFeeds.sceneRenders` in the debug overlay), and that the first frame after the feed goes `off` is a normal view
  - Verified by counting WebGL draw calls per frame in the browser: live feed frames at most 53 draws (one feed render), static frames 2 (overlay only), and the first frame after `off` a full player render (285 draws) behind the fade.
- [x] 2.3 Tune the fullscreen look values in the browser on the stinger at 1920x1080: scanlines at most 4 px apart, Priya's face and hands readable, colour visible, still reads as CCTV. Record the final values in `design.md` decision 3. Verify by a screenshot of the stinger attached to the change's PR notes
  - Tuned at 1280x720 (the pane's size); scanline pitch is 3 px at 1080p by `scanPitch`, tested. Added a contrast curve, a smaller caption and a caption/REC inset below the cinematic bars; values in design decision 3. Screenshots taken during the session; attach a fresh one to the PR.

## 3. One-shot get-up clip

- [x] 3.1 Fetch CMU `77_17` (add `priya_rise` to `scripts/mocap.sources.json` as `source: cmu`, `take: 77_17`, `loop: false`, `loco: false`, `pack: priya`, then `node scripts/mocap-fetch.mjs`), and check its first frame's facing (face-down, back or side) and its pelvis height curve. Verify by noting the starting posture and the get-up's start and end times in `design.md` decision 7
- [x] 3.2 Make the bake handle a one-shot clip: no seam blend, no loop window, and the pelvis height track kept absolute so the body rises from the floor. Set `start`/`end` on `priya_rise` to the get-up only. Verify with `node scripts/bake-mocap.mjs` then `node scripts/bake-mocap.mjs --check`, `npm test -- src/actors/mocapPacks.test.ts src/actors/mocapCredits.test.ts`, and that the baked clip's pelvis Y starts near floor height and ends near standing height
- [x] 3.3 Update `docs/mocap-sources.md` (the sizes table from the bake, and the CMU row of "What each source has" with the get-up) and the CMU row's usage note in `CREDITS.md`. Verify the sizes table matches the bake output and `npm test -- src/actors/mocapCredits.test.ts` passes

## 4. Clips in kill beats

- [x] 4.1 Add `clip`, `speed` (a number or a list of `[t, speed]` keys) and `until: "clip"` to the kill beat schema in `src/data/types/kills.ts`, with poses optional on a clip beat. Verify with validation cases in `src/ai/killProfile.test.ts` (a valid clip beat, bad speed keys rejected) and `npm test -- src/ai/killProfile.test.ts`
  - Done with `poses` still required: on a clip beat they are the fallback played when the body has no such clip (the spec's missing-clip behaviour needs them). Schema cases are in `src/ai/killRun.test.ts` beside the runner tests (`killProfile.test.ts` covers motion profiles, not the schema).
- [x] 4.2 Play a beat's clip in `src/ai/killRun.ts` and the animator: sample it once at the beat's speed, hold the last frame, end the beat on `until: clip` or `max`, blend in over about 0.3 s, keep the victim's root and facing from the start of the beat, and fall back to the poses with one warning if the clip is missing. Verify with `src/ai/killRun.test.ts` cases (beat length at speed 0.75 and with speed keys, missing-clip fallback) and `npm test -- src/ai/killRun.test.ts src/ai/npcKills.test.ts`
  - `killRun.test.ts` 21/21. `npcKills.test.ts` has 2 failures (mauled attacker hand distance) that also fail with this change's animator and hook edits removed: they come from the in-flight R08 work, not this change.
- [x] 4.3 Layer convulsion and `kick` reactions on top of the sampled clip during a clip beat, with the convulsion's sine rates scaled to about a third, leaving the `convulse <= 0.01` mocap gate unchanged for every other case. Turn off foot IK and hold layers while a kill clip plays. Verify with a new `src/actors/animator.test.ts`: a clip beat's joints differ from the bare clip when convulsion is on and match it when off, and a non-clip kill's output is unchanged; run `npm test -- src/actors/animator.test.ts`
  - `animator.test.ts` 7/7. Foot IK was already off for the whole kill; the hold layer is now also off while a clip plays.

## 5. Priya's rise

- [x] 5.1 Change `convertedRise`'s `rise` beat in `src/data/kills.json` to `clip: priya_rise`, `until: clip`, convulsion about 0.1, speed about 0.75 with one or two lurches, and kicks on a shoulder and the head. If task 3.1 found the take does not start face-down, add an authored pose matching its first frame and end the `turn` beat on it. Verify `npm test -- src/ai/killProfile.test.ts src/script/action.test.ts`
- [x] 5.2 Review the rise in the cast motion sandbox (`docs/cast-motion-sandbox.md`) on Priya's body: no sinking into the floor, no pop into or out of the clip, feet end where she lay, twitches read as spasms. Verify by a short clip from the sandbox
  - Reviewed in the game instead (the sandbox cannot run a kill): the user's playtests found her lying half in the wall and a jump into the clip. Fixed by moving `priya_hide`, a face-down `writhingProne` turn beat, moving the body's origin under the clip's first frame and rebasing the left pose onto the clip's root (design, "Playtest fixes"). Checked against the level colliders headlessly and by `animator.test.ts`; signed off in the user's playtest.

## 6. Playtest

- [x] 6.1 Play the slice's ending in the browser following `docs/PLAYTEST.md` (`?slot=scratch`), reusing a running dev server: the stinger runs at 30 fps or more and reads clear, Priya's rise is one continuous captured motion of at least 3 s that ends facing CAM 04, the cut to static and the fade still land, and the dock CCTV wall looks as before. Run `npm test` and `npm run build`. Verify by the user's sign-off on the playtest
  - Signed off by the user after three rounds of playtest fixes (design: blood pool, straight cut to the credits, the score carried into them, the new logo, the hush). Played on production snapshots served on a separate port, since other agents' edits kept reloading the shared dev server. `npm test`: 1,248 of 1,264 pass; the 16 failures are in other agents' in-flight work (talk gestures, held props, arm poses, the dock guard sit, the R08 attack, slice01 walk paths), none in this change's files. Bundle builds; typecheck clean apart from other agents' temporary `_diag` files.

## Workflow follow-up

- Archive the change after the user signs off on the playtest.
- Committed in two parts (shared checkout): first the parts that build on HEAD alone (feed rate, size and look; the `hush` mechanism; the new logo; the straight cut to the credits). Priya's rise (the clip in kill beats, `priya_rise`, the anchor move, `writhingProne`), the blood pool, the stinger's `hush` step and the score carried into the credits depend on the uncommitted per-character motion packs, score player and stinger rewrite, and are committed once those land.
