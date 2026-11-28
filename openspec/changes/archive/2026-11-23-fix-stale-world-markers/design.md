# Design

## Context

`WorldMarkerHud` keeps a pool of marker elements and hides spare or off-screen ones with `el.hidden = true`. `.world-markers` has a `[hidden] { display: none }` rule, `.world-marker` does not, and its own `display: grid` beats the browser's default for `hidden`. So only the container hides, and only when the whole list is empty. Any single slot that is no longer wanted while another marker is still drawn stays on screen with its last `left`, `top` and text. This is not specific to the card: it is any completion or any turn-away while two markers are in play, so other objectives probably showed it too.

## Decisions

1. **Fix in CSS and keep `hidden` as the mechanism.** Add `.world-marker[hidden] { display: none; }` next to the container rule. This matches the project's existing rule for every other `[hidden]` element (`hud.css:33`, `60`, `107`, `138`).
2. **Do not also clear stale text.** Once the slot is `display: none` nothing shows, and the next frame that wants the slot overwrites position, class and text. Clearing would only add work per frame.
3. **Test the contract, not the stylesheet.** The test builds a `WorldMarkerHud` with a fake camera, drives it from two markers to one and from on-screen to behind the camera, and checks the slot's computed visibility. If a headless DOM cannot compute CSS, the test reads the `hud.css` rule text and asserts a `[hidden]` rule exists for each class the HUD toggles `hidden` on.

## Risks

- The test environment is `node:test` with no real DOM, so a computed-style check may not be possible. Decision 3 names the fallback.
- No other class in `hud.css` that sets `display` and is toggled with `hidden` was audited. Task 1.3 does that sweep so the same bug does not hide elsewhere.
