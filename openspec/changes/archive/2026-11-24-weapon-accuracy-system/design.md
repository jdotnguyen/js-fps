# Design

## Context

See `proposal.md` for motivation. Today, player spread is computed inline inside `fireShot()` (`src/actors/shots.ts`) as a linear interpolation between static `hip` and `aim` half-angles using `player.aimBlend` (which ramps 0 -> 1 in `0.15 s` in `src/actors/player.ts`). `src/ai/enemyGame.ts` listens to `weapon:fired` and calls `director.playerShot(weapon, origin, view, player.aimBlend)`. The crosshair (`#crosshair` in `index.html` and `src/ui/styles/hud.css`) is a static 22x22 px CSS element toggled solely by `game:mode` in `src/app/session.ts`.

## Goals / Non-Goals

**Goals:**
- Provide a single, deterministic, unit-testable accuracy state (`WeaponAccuracy`) shared by both hitscan resolution and the crosshair HUD.
- Deliver deliberate survival-horror gunplay: hold-to-focus ADS tightening + rapid-fire bloom in both hipfire and ADS.
- Render a crisp, DPI-independent SVG reticle (center dot + two curved left/right brackets) whose screen radius accurately reflects the angular spread cone at the active camera FOV.

**Non-Goals:**
- Changing weapon damage, pellet count, falloff, stagger thresholds, or adding hidden critical hit multipliers.
- Modifying GLB weapon viewmodel animations, iron-sight alignments, or recoil springs.
- Adding new user-facing settings (existing `fov` and `reducedMotion` settings are respected automatically).

## Decisions

### D1: Pure `WeaponAccuracy` simulation module (`src/actors/accuracy.ts`)
Keep accuracy state in a standalone, DOM-free, Three-free class `WeaponAccuracy` stepped once per frame (or fixed tick) with explicit inputs: `{ dt, weapon, aimBlend, moveSpeed, turnRate, sprinting, reloading, armed }`, plus an `onShot(weapon)` impulse called when `weapon:fired` fires.
- **Rationale**: Pure state makes deterministic unit tests trivial (bloom compounding, decay, focus settling, flick disturbance, weapon switch reset) without spinning up WebGL or DOM.
- **Alternative considered**: Embedding accuracy state inside `Player` or `Viewmodel`. Rejected because `Player` does not know which weapon is equipped or reloading, and `Viewmodel` is a render-layer module that should not own gameplay hitscan math.

### D2: Spread composition (base + focus + bloom)
Each weapon defines an `AccuracyProfile`:
- `hipSpread`: rested hipfire half-angle (rad) — pistol `0.024`, shotgun `0.075`.
- `adsSpread`: initial ADS half-angle (rad) before focus settles — pistol `0.014`, shotgun `0.062`.
- `focusSpread`: fully focused ADS half-angle (rad) — pistol `0.002`, shotgun `0.042`.
- `focusTime`: seconds of steady ADS to reach 100% focus — pistol `0.75 s`, shotgun `0.85 s`.
- `bloomPerShotHip` / `bloomPerShotAds`: bloom added per shot — pistol `0.018` / `0.012`, shotgun `0.025` / `0.018`.
- `bloomMax`: maximum bloom cap — pistol `0.075`, shotgun `0.11`.
- `bloomDelay` / `bloomDecayRate`: short hold (`0.08 s`–`0.12 s`) before exponential/linear decay back to 0 so rapid follow-ups noticeably compound while paced shots feel crisp.

Resolved spread:
```text
stanceBase = lerp(hipSpread, lerp(adsSpread, focusSpread, easeOut(focus)), aimBlend)
spreadRad  = stanceBase + bloom
```
- **Rationale**: Separating `focus` (0..1) and `bloom` (radians) guarantees that firing in ADS both opens the cone immediately (via `bloom`) and drops `focus`, requiring the player to pause and re-settle.

### D3: Steady-aim disturbance without punishing micro-tracking
While `aimBlend > 0.85`, not sprinting, not reloading, and `bloom` is low:
- Compute a stability factor from horizontal speed (`moveSpeed`) and angular view speed (`turnRate` in rad/s):
  - Small tracking motion below a deadzone (e.g., `turnRate <= 0.35 rad/s`, `moveSpeed <= 0.4 m/s`) allows 100% focus gain.
  - Walking/strafing slows focus gain (e.g., 35% rate) rather than wiping it.
  - Sharp mouse flicks (`turnRate > 1.8 rad/s`) pause gain and shed focus smoothly.
- Sprinting, reloading, switching weapons, or dropping out of ADS (`aimBlend < 0.5`) decays/clears `focus`.
- **Rationale**: Preserves the survival-horror reward for planting feet and timing shots without making tracking a shambling enemy head feel brittle.

### D4: 1:1 Hitscan sync (`src/actors/shots.ts` & `src/ai/enemyDirector.ts`)
Extend `fireShot()` and `enemyDirector.playerShot()` to accept an optional explicit `spreadRad` override (defaulting to the existing `aimBlend` lerp so all existing unit tests and callers remain backward-compatible). In `src/ai/enemyGame.ts`, read `accuracy.spreadRad` **before** calling `accuracy.onShot(weapon)` on `weapon:fired`, so the shot uses the exact spread the player saw on the reticle when they pulled the trigger, and the reticle kicks open immediately after for the follow-up shot.
- **Rationale**: Guarantees what-you-see-is-what-you-shoot accuracy and zero breakage for existing tests.

### D5: Two-bracket SVG reticle (`src/ui/hud/crosshairHud.ts`)
Populate `#crosshair` with an SVG centered on the viewport containing:
- A small center dot (`<circle>`).
- Two curved side arcs (`<path>` on the left and right, spanning e.g. `-42°..+42°` and `138°..222°` around the center — no top or bottom ticks).
- Projected pixel radius:
  ```text
  radiusPx = clamp(tan(spreadRad) / tan(fovRad / 2) * (viewportHeight / 2), minPx, maxPx)
  ```
  with `minPx` tightening snugly onto the center dot (e.g. `4.5 px`) at full pistol focus, and `maxPx` capped so extreme bloom stays readable on screen.
- Smooth display radius with a fast critically damped response (or direct tracking when `reducedMotion` is enabled so there is zero bounce/overshoot).
- Visual state classes on `#crosshair`:
  - `.focused`: crisp pure white (`#ffffff`, higher opacity/drop-shadow) when `focus >= 0.98 && bloom < 0.001`.
  - `.unarmed`: hides the two bracket paths, leaving only the center dot.
  - `.suppressed` (sprinting or reloading): fades brackets to `opacity: 0` and dims the center dot.
  - Existing `#ui:has(.cine.on) #crosshair { display: none; }` continues to hide it during cutscenes.

## Risks / Trade-offs

- **ADS viewmodel iron sights overlap**: The pistol/shotgun iron sights sit near screen center in ADS. -> Keep the two side brackets thin (`1.5 px` stroke with subtle dark drop-shadow) and strictly on the left/right sides so they frame the front sight post without obscuring the vertical sightline.
- **Event listener ordering on `weapon:fired`**: If `accuracy.onShot()` runs before `enemyGame.ts` fires the hitscan, the first shot would wrongly suffer its own bloom. -> Call `accuracy.onShot(weapon)` immediately *after* reading `accuracy.spreadRad` in the shot handler (or snapshot spread before mutating bloom).
- **Tuning feel**: Spread numbers and focus duration (`0.75 s`) are initial targets. -> Keep `ACCURACY_PROFILES` exported and mutable (like `PLAYER_TUNING`) so they can be tuned live during playtesting.
