# Proposal

## Why

The slice ends on Priya's body rising on a security camera, and the scene lands, but it looks bad. The fullscreen feed is a 320x180 picture stretched over the whole view at a nominal 10 fps (fewer in practice), behind heavy gain, noise, a near-greyscale grade and thick scanlines. Under it, her rise is four hand-keyed poses that snap every 0.38 s with fast sine jitter on top, and motion capture is switched off for the whole kill. A sharper feed alone would only show that more clearly, so both have to change together.

## What Changes

- A camera feed can set its own frame rate and render size. The fullscreen stinger feed renders at 30 fps or more at about 960x540; the dock CCTV wall's monitors keep 320x180 at 10 fps.
- The feed throttle keeps leftover time between frames, so a feed holds its set rate instead of falling below it with uneven gaps.
- A fullscreen feed gets a clearer CCTV look: less gain and noise, more colour, and scanlines and grain sized to the screen rather than to the texture. It still reads as security footage (tint, scanlines, vignette, label, REC dot).
- While a fullscreen feed covers the view, the player's own view is not rendered underneath it.
- A kill beat can play a captured motion clip once, at an authored speed, and end on its last frame, with convulsion and kicks layered on top of the clip instead of replacing it.
- Priya's `convertedRise` rise plays a new captured get-up clip, `priya_rise`, baked from CMU take `77_17` into her motion pack. The rise beat lasts as long as the clip, and its convulsion drops to a light layer, with the sharp twitches done by kicks.

## Capabilities

### New Capabilities
- `camera-feeds`: security camera feeds rendered from a point in the world onto monitors or over the whole view: their states, frame rate, render size, the CCTV look, and what they cost while seen or unseen.

### Modified Capabilities
- `infection-kills`: kill beats can play a captured clip, and a `converted` kill's rise uses captured motion with the convulsion layered over it.

## Impact

- `src/render/cameraFeed.ts`, `src/render/cameraFeedGl.ts`, `src/render/cameraFeed.test.ts`: per-feed rate and size, the throttle fix, the fullscreen look.
- `src/script/host.ts` and `src/script/actions.ts` (`CameraFeedOptions` and the `cameraFeed` action); `src/main.ts` / `src/render/renderer.ts` for skipping the main view under a fullscreen feed.
- `src/data/types/kills.ts`, `src/ai/killRun.ts`, `src/actors/animator.ts`, `src/actors/humanoid.ts`: a clip on a kill beat, one-shot clip playback, convulsion over mocap.
- `scripts/mocap.sources.json` and the bake scripts (a one-shot clip), `src/data/mocap/priya.json` (regenerated), `docs/mocap-sources.md` (sizes table).
- `src/data/kills.json` (`convertedRise`) and `src/data/sequences/action_climax.json` (`stinger_priya` feed options).
- Builds on the in-flight `per-character-motion` change (mocap library and character packs).
- `CREDITS.md`: the existing CMU row already covers the database; its usage note should mention the get-up.
