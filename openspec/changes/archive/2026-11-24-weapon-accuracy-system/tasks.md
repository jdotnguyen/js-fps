# Tasks

## 1. Weapon Accuracy Simulation

- [x] 1.1 Implement `WeaponAccuracy` and `ACCURACY_PROFILES` in `src/actors/accuracy.ts` covering per-weapon hipfire/ADS/focused spread, rapid-fire bloom compounding and decay in both hipfire and ADS, steady-aim hold-to-focus, movement/flick disturbance with micro-tracking tolerance, and focus reset on shot/sprint/reload/weapon-switch; verify with `npm run typecheck`.
- [x] 1.2 Add unit tests in `src/actors/accuracy.test.ts` verifying hipfire and ADS rapid-fire bloom compounding/cap/decay, pistol and shotgun hold-to-focus progression, movement and sharp-flick disturbance vs gentle micro-tracking, and focus clear on sprint/reload/switch; verify with `npm test -- src/actors/accuracy.test.ts`.

## 2. Hitscan Integration

- [x] 2.1 Extend `fireShot()` in `src/actors/shots.ts` and `playerShot()` in `src/ai/enemyDirector.ts` to accept an optional explicit `spreadRad` override (preserving default `aimBlend` fallback for existing callers) and add/update unit tests in `src/actors/shots.test.ts` verifying explicit spread override behavior; verify with `npm test -- src/actors/shots.test.ts`.
- [x] 2.2 Wire `WeaponAccuracy` into `src/ai/enemyGame.ts` and `src/app/session.ts` so each `weapon:fired` reads `accuracy.spreadRad` for the shot before applying `accuracy.onShot(weapon)`, and expose `reloading` state from `Viewmodel` (`src/render/viewmodel/viewmodel.ts`) if not already readable; verify with `npm run typecheck` and `npm test -- src/render/viewmodel/viewmodel.test.ts`.

## 3. Two-Bracket Dynamic Crosshair HUD

- [x] 3.1 Implement `CrosshairHud` in `src/ui/hud/crosshairHud.ts` rendering a center dot and two curved left/right SVG side brackets inside `#crosshair`, projecting `spreadRad` to screen pixels using camera vertical FOV, tightening snugly to the dot and brightening white at full focus, showing dot-only when unarmed, fading brackets while sprinting/reloading, and disabling spring overshoot under `reducedMotion`; add unit tests in `src/ui/hud/crosshairHud.test.ts` covering FOV projection, focus/unarmed/suppressed classes, and reduced motion, and verify with `npm test -- src/ui/hud/crosshairHud.test.ts`.
- [x] 3.2 Update `#crosshair` styling in `src/ui/styles/hud.css` for the SVG dot + two side brackets (`.focused`, `.unarmed`, `.suppressed`, cutscene `.cine.on` hiding) and wire `CrosshairHud` into the per-frame update loop in `src/app/session.ts`; verify with `npm run typecheck`.

## 4. End-to-End Verification

- [x] 4.1 Run `npm run typecheck`, targeted unit tests (`npm test -- src/actors/accuracy.test.ts src/actors/shots.test.ts src/ui/hud/crosshairHud.test.ts`), and `npm run build` to confirm a clean production bundle.
- [x] 4.2 Playtest in the browser (`docs/PLAYTEST.md`) across pistol and shotgun: verify unarmed dot-only before Lab B drop, two-bracket expansion on rapid hipfire and rapid ADS fire, smooth hold-to-focus tightening and white lock cue, movement/flick disturbance, sprint/reload bracket fade, and cutscene hiding.
