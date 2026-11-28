# Proposal

## Why

After Jay takes the Level 2 card from the Director's desk, a bold diamond marker reading "2m" stays on screen wherever he goes, though the objective list already shows the objective complete. The cause is in the HUD: each in-world marker is hidden by setting its `hidden` attribute, but `.world-marker` sets `display: grid` and has no `[hidden]` rule, so the attribute does nothing. Any marker that stops being wanted keeps its last position and last distance text. The list shrinks when an objective completes, so the leftover marker is the one that was 2 m away at the moment of the pickup. The same happens when a marker goes off-screen or behind Jay: it stays pinned where it was last drawn.

## What Changes

- A marker that is not in the current frame's marker list, or whose target is behind or off the edge of the screen, is no longer visible.
- A marker that comes back after being hidden shows its current position and distance, never the stale ones.
- Cover the hide path with a test, so a CSS rule cannot silently defeat it again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `hud-wayfinding`: the in-world objective marker requirement gains an explicit rule that a marker disappears with its objective and when its target leaves the view.

## Impact

- `src/ui/styles/hud.css` (a `[hidden]` rule for `.world-marker`) and possibly `src/ui/hud/worldMarkerHud.ts`.
- A new test next to `worldMarkerHud.ts`; existing `wayfinding.test.ts` is untouched (it covers the pure resolver, which is correct).
- No data, save or audio changes.
