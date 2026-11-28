# Proposal

## Why

Currently, weapon accuracy in Thalassa is a static interpolation between fixed hipfire and ADS cones that snaps in 0.15 s, and the crosshair is a static CSS mark that gives no feedback on firing cadence, weapon choke, or aiming steadiness. Introducing a deliberate hold-to-focus accuracy system with rapid-fire bloom and a matching dynamic reticle rewards paced, survival-horror aiming and makes every shot's spread readable on screen.

## What Changes

- Add a dynamic weapon accuracy model (`WeaponAccuracy`) with **hold-to-focus** ADS tightening and **rapid-fire bloom** in both hipfire and ADS for the pistol and shotgun.
- Penalize focus gain when moving rapidly or making sharp mouse flicks, while tolerating small tracking micro-adjustments; drop focus on firing, sprinting, reloading, or switching weapons.
- Route the resolved angular spread from `WeaponAccuracy` directly into hitscan resolution (`fireShot` / `enemyDirector.playerShot`) so the shot cone and reticle always match 1:1.
- Replace the static CSS `#crosshair` with a dynamic SVG reticle (`CrosshairHud`) featuring a center dot and **two curved side brackets** (left and right arcs, no top/bottom) whose radius projects the active angular spread through camera FOV, tightening snugly onto the dot and brightening white at full focus.
- Handle non-firing states cleanly: unarmed shows only the center dot; sprinting or reloading fades out the brackets leaving a faint dot; cutscenes hide the reticle as before; reduced motion keeps honest radius updates without spring bounce.

## Capabilities

### New Capabilities
- `weapon-accuracy`: Dynamic weapon spread (hold-to-focus ADS settling, rapid-fire bloom in hipfire and ADS, movement/turn disturbance) and its FOV-projected two-bracket crosshair HUD.

### Modified Capabilities
<!-- None: existing `weapon-viewmodels` requirements (models, hands, rest pose, reload/pump timing, AO) are unchanged. -->

## Impact

- **Simulation / Hitscan**: New `src/actors/accuracy.ts` (plus `src/actors/accuracy.test.ts`); minor signature extension to `fireShot()` in `src/actors/shots.ts` and `playerShot()` in `src/ai/enemyDirector.ts`; wiring in `src/ai/enemyGame.ts`.
- **HUD / Presentation**: New `src/ui/hud/crosshairHud.ts` (plus unit tests); `#crosshair` styling updated in `src/ui/styles/hud.css`; per-frame update wired in `src/app/session.ts`.
- **No breaking changes** to saves, levels, audio assets, or existing weapon viewmodel clips.
