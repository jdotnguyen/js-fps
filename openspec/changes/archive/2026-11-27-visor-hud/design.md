# Design

## Context

`PlayerHud` (`src/ui/hud/playerHud.ts`) builds the vitals and ammo readouts as plain DOM. It polls `player.vitals`, `player.stamina` and an `AmmoReadout` source each rendered frame and writes widths and text. It also owns the interact prompt, the access hint, the downed status box and the screen fade. `game.ts`, `cutscene.ts` and `gameHost.ts` call its `update`, `hide` and `setFade`. Styles live in `src/ui/styles/hud.css`, and the cutscene hide is the `#ui:has(.cine.on)` rule.

Everything the new panels react to is already published on the event bus:

| Event | Used for |
| --- | --- |
| `player:damaged` `{amount, hp, kind, side, dir, severity}` | chip trail, hit jolt and tear, waking from calm |
| `player:downed` / `player:revived` / `player:died` | downed layout, revive fill-up |
| `pickup:taken` `{kind, amount}` | `+N` deltas for medkits and ammo |
| `weapon:fired` / `weapon:dryFire` | pip blink, `EMPTY` flash |
| `weapon:reloadStart` `{duration?, empty?}` / `weapon:shellInsert` / `weapon:reloaded` | pip clear and refill |
| `weapon:equipped` | swap glitch |

`HitInfo` (`src/actors/hit.ts`) comes from `player-hit-feedback`, which is still in progress and uncommitted.

Constraints:
- Several agents share this machine and checkout. `session.ts` and `viewmodel.ts` carry other agents' uncommitted edits.
- The desktop's texture-unit budget is already full on High.
- `game-pause` freezes the scene while menus are open; HUD highlights may keep running there.

## Goals / Non-Goals

**Goals:**
- Panels that read as projected light, with no GPU cost beyond compositing a few small layers.
- State logic in pure, DOM-free models that `node:test` can drive with time steps and events.
- No edits to the player, viewmodel, enemy or post-processing code.

**Non-Goals:**
- True lens distortion or refraction.
- Reworking the interact prompt, the access hint, the compass, the objective list or the crosshair. They keep their current look in this change.
- Gamepad-specific layout.

## Decisions

### D1. DOM, CSS 3D and inline SVG, not a WebGL overlay
The panels are DOM under `#ui`, tilted with CSS 3D transforms. Thin graphics (the ECG, the weapon silhouette, the rim arc, the shell icons) are small inline SVG.
- **Alternative: an orthographic Three.js layer or a canvas texture in the final grade.** That would give real distortion, but it costs a sampler or a pass, touches `post.ts` (which `player-hit-feedback` is editing) and makes text harder.
- **Alternative: a 2D canvas per panel.** It is flexible, but loses crisp text and DOM accessibility, and repaints every frame.

### D2. A `VisorHud` composed inside `PlayerHud`
New modules live under `src/ui/hud/visor/`:

```
 PlayerHud (prompt, hint, fade: unchanged)
   +-- VisorHud
         +-- VisorRim        corner brackets + edge arc
         +-- Biomonitor      health segments, chip, ECG, stamina, downed
         +-- WeaponPanel     name, silhouette, pips, counts, EMPTY, deltas
         +-- VisorMotion     spring offsets for inertia and jolts
         +-- CalmMode        idle timer -> dim level
   models (pure, tested): healthModel, heartModel, ammoModel, calmModel, visorSpring
```

The rim is static markup (`buildRim`), and the motion and calm components live inside `VisorHud`.

`PlayerHud` keeps its public API (`update`, `hide`, `setFade`, `setAmmoSource`, `showHint`) and adds `connect`, `boot`, `dispose`, `tick(dt)` and an optional `frameDt` on `update` (D4). `cutscene.ts` and `gameHost.ts` don't change, and `game.ts` changes only for D4. It forwards to `VisorHud` and drops its own vitals, ammo and `.player-status` DOM. `session.ts` gains a short wiring block that passes the bus, the camera, the settings and the reload key label.

### D3. Polled truth, event-driven animation
Each frame the panels read the true values: `player.vitals`, `player.stamina`, `player.isExhausted` and the `AmmoReadout` source. Events only start animations on top: a chip, a fill-up, a blink, a refill, a jolt or a delta. Whenever an animation ends or is cancelled (a weapon swap mid-reload, a restore, a reload interrupted by a hit), the display snaps to the polled values. A missed or extra event can therefore never leave a wrong number on screen. The `+N` figures come from the polled health and the held weapon's reserve rising, so a revive and a medkit need no separate path. The ammo source also reports `reloading`, which ends a refill that the weapon dropped without an event.

### D4. Play time for state, frame time for decoration
`Game` runs the simulation in `update(dt)` on play time, which stops while the scene is frozen. It draws in `render(frameDt)`, which runs every frame. The HUD follows the same split:
- **Play time** goes through `PlayerHud.tick(dt)`, called from `Game.update`. It drives everything that mirrors the simulation: the chip hold and drain, the heal fill-up, the ECG scroll, the pistol refill over `duration`, and the calm timer. A paused game therefore freezes these, as `game-pause` asks.
- **Frame time** goes through `PlayerHud.update(player, interactions, frameDt)`, called from `Game.render`. It drives the boot sequence, the glitch on swap, `+N` deltas and the spring, so menus and the spotlight callout stay live.

The boot-up, tear, glitch, pip blinks and `+N` are CSS animations, so they run in real time; the frame time (the scene's, which is zero while frozen) drives the spring and ends the boot-up class.

This adds two one-line edits in `src/game/game.ts`.

### D5. Health and heart numbers
- **Segments:** four segments, each filled to `clamp((hp - 25*i) / 25, 0, 1)`.
- **Chip:** hold 0.4 s, then drain at a rate that covers the span in 0.5 s. A new hit during the hold resets the hold; a hit during the drain keeps the chip's top and restarts the hold.
- **Heal:** fill at 50 HP/s, with a minimum duration of 0.25 s.
- **Heart rate:** `bpm = lerp(72, 148, 1 - hp/100)`, eased toward its target at 20 bpm/s so it doesn't jump on a hit.
- **ECG:** a 96-sample ring buffer sampled from a PQRST beat shape at the current rate, drawn as one SVG `polyline` (one string write per frame, no layout). At or below 30 HP every third beat gets random timing jitter and a smaller R spike. Downed draws a weak, slow trace; dead flatlines.

### D6. Ammo pips
- `ammoModel` holds `shown` (filled pips), `mag`, the reload mode and the progress.
- `fired` drops one pip with a 120 ms blink-out class.
- A pistol `reloadStart` clears the pips over the first 15% of `duration`, then refills them linearly to the target over the rest. The target is `min(mag, loaded + reserve)`.
- A shotgun `shellInsert` fills one shell icon.
- `reloaded` snaps to the reported counts.
- The pips are fixed DOM nodes, 12 or 6, rebuilt only on a weapon change.
- Low is at most `ceil(mag/4)` and empty is 0, matching today's thresholds.

### D7. The projection look
- **Tilt:** a `.visor` container with `perspective: 1100px`. The biomonitor gets `rotateY(14deg)` and the weapon panel `rotateY(-14deg)`, each with `transform-origin` on its outer edge.
- **Glow:** text and strokes use `--visor`, with a soft glow from `text-shadow` and SVG `drop-shadow` on small elements only.
- **Additive blending:** the panels use `mix-blend-mode: screen`.
- **Legibility:** behind the text sits a soft dark radial underlay (not a panel), so the readouts stay legible over bright fog and lights.
- **Scanlines:** one `repeating-linear-gradient` layer clipped to each panel at about 6% opacity.
- **Colour fringe:** two offset `text-shadow`s (cyan -1px, red +1px) at low alpha, raised briefly during a tear.
- **Hit tear:** for about 0.2 s, two slices of the panel (its upper rows and its lower rows) slide opposite ways with `translate`, by an amount scaled by `severity`. A `clip-path` slice would need a second copy of the panel. With Reduced flashing on, there is a single offset with no flicker.
- **What stays off:** `backdrop-filter`, and `filter: blur` on anything larger than an icon.
- **Animation:** only `transform` and `opacity`, so the compositor does the work.

### D8. Visor motion
`VisorMotion` reads the camera's yaw and pitch each frame and computes angular rates from the change. It also reads the eye's vertical offset from its rest height for head bob. A critically damped spring (about 6 Hz) chases `-rate * k`, clamped to 12 px times `hudScale`. Hit jolts add an impulse along `-dir.x` (or a small centred dip when there is no `dir`), weighted toward the panel on the struck side by `side`. Reduced motion zeroes the spring and jolt output. Rates are scaled by frame time, so frame rate doesn't change the feel.

### D9. Calm mode
`calmModel` counts play time since the last wake event. It wakes on damage, fired, dryFire, reloadStart, equipped, sprint start or a pickup, and whenever health, stamina or the magazine is below full. After 6 s the panels ease to an opacity of 0.35 over 1 s; on waking they return in 0.12 s. The visor rim stays at its own faint level either way.

### D10. Settings
Three new settings:
- `hudOpacity`: 0.4 to 1, default 0.85.
- `hudScale`: 0.75 to 1.5, default 1.
- `calmHud`: default true.

They're applied as CSS custom properties (`--hud-opacity`, `--hud-scale`) on `#ui` and on the visor's root, and a class for calm mode. The root sits beside `#ui`, not inside it, so that its screen blend reaches the 3D scene. They appear in the existing settings screen in `src/ui/menus/screens.ts`. The stored-settings loader already drops unknown or mistyped keys, so old saves pick up the defaults.

### D11. Boot-up
`VisorHud.boot()` plays a short sequence on frame time: rim at 0 ms, panel frames at 250 ms, readouts at 500 to 900 ms, with a staggered flicker. With Reduced flashing on, it's a 0.4 s fade. The session calls it when play starts after the intro or a load, and after a checkpoint restore. `PlayerHud` also calls it the first time the panels show in a session. CSS hides the visor while the loading screen is up, so the boot-up after a load starts when that screen has gone.

## Risks / Trade-offs

- **Text through `rotateY` can look soft on some GPUs, notably the M2 Air.** Mitigation: keep the angle at 14 degrees or less, keep font sizes at whole pixels, compare screenshots on both machines, and fall back to a smaller angle at Low quality.
- **`mix-blend-mode: screen` washes out over bright scenes.** Mitigation: the dark underlay (D7), and HUD opacity in settings.
- **`HitInfo` is uncommitted work from `player-hit-feedback`.** Mitigation: read `side` and `dir` defensively and fall back to a centred jolt. Don't ship the visor change ahead of `hit.ts`, or ship it reading only `amount` until `hit.ts` lands.
- **Wiring in `session.ts` collides with other agents' hunks.** Mitigation: one small block next to the `new PlayerHud` call, committed with a private index and the hunk picker (see the shared-checkout memory note).
- **Per-frame DOM writes.** Mitigation: write only changed values. The polyline and the spring transform are the only writes every frame, and both are compositor-friendly or tiny. Check with a performance trace that the HUD stays under 0.3 ms a frame.
- **The weapon panel crowds the objective list on short or narrow screens.** Mitigation: browser-check at 1280x720 and 2560x1440 with the objective list full, and anchor both to the safe area.

## Migration Plan

This is a UI replacement with no save format change. Rollback means reverting the commit, and the new settings keys are simply ignored by older builds.

## Open Questions

- The exact glyphs for the weapon silhouettes and shell icons can be settled in the look prototype (task 1).
