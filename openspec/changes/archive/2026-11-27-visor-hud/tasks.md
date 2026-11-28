# Tasks

## 1. Look prototype

- [x] 1.1 Build the static visor look (design D7, spec "Two visor panels and a faint rim"): `src/ui/styles/visor.css` and the panel, rim, pip and ECG markup in `src/ui/hud/visor/`, rendered from fixed sample states (full, 60 HP with a chip, 20 HP critical, downed, pistol 9/36, shotgun mid-reload, empty). Verify with `npm run playtest:serve` and `?debug&slot=scratch` screenshots at 1920x1080 and 1280x720 over a dark room and a bright one, and get the user's sign-off on the look and the silhouette and shell glyphs before group 2.

## 2. Pure models

- [x] 2.1 `healthModel`: segment fills, chip hold and drain, chip extension on a second hit, heal fill-up and `+N`, all driven by play-time steps (D5). Verify with `src/ui/hud/visor/healthModel.test.ts` covering each scenario under "Health in four segments", "Damage leaves a chip trail" and "Healing fills up with a delta", including a frozen step (dt 0).
- [x] 2.2 `heartModel`: target BPM from HP, eased rate, ring-buffer samples, irregular beats at or below 30, the downed trace and the flatline (D5). Verify with `heartModel.test.ts`: the BPM at 20 HP is clearly above that at 100, the buffer stays at 96 samples, and dt 0 does not advance it.
- [x] 2.3 `ammoModel`: pips from loaded, blink on fired, pistol clear and refill over `duration`, shotgun fill per `shellInsert`, snap to the polled counts on `reloaded`, on a swap or on a cancelled reload, low and empty thresholds (D3, D6). Verify with `ammoModel.test.ts` covering "Weapon panel shows rounds as pips", "Firing and dry fire" and "Reload refills the pips", including a reload cancelled by `weapon:equipped`.
- [x] 2.4 `calmModel` and `visorSpring`: the 6 s idle dim and instant wake on every listed event or any value below full (D9); the spring with its 12 px times scale clamp, jolt impulses weighted by `side`, and a zero output with Reduced motion (D8). Verify with `calmModel.test.ts` and `visorSpring.test.ts`, including frame-rate independence (the same motion at 30 and 144 steps a second).

## 3. Panels and wiring

- [x] 3.1 `Biomonitor`, `WeaponPanel`, `VisorRim` and `VisorHud` on top of the models. They write only changed values, plus the per-frame polyline and spring transform, and expose `boot()`. Verify with DOM-fake tests in the style of `src/ui/playTime.test.ts`: the downed layout replaces the bar and shows the seconds and revives left, the weapon panel hides with no weapon, and the text values always match the polled state.
- [x] 3.2 Move the vitals, ammo and `.player-status` DOM out of `PlayerHud` into `VisorHud`. Add `tick(dt)` and `frameDt` (D2, D4) and call them from `src/game/game.ts`. Remove the old `.hud-vitals`, `.hud-ammo` and `.player-status` CSS. Verify with `npm run typecheck` and `npm test -- src/ui/playTime.test.ts src/ui/hud/visor/*.test.ts`.
- [x] 3.3 Wire the bus, the camera, the settings and the reload key label into the HUD in one block beside `new PlayerHud` in `src/app/session.ts`. Read `HitInfo.side` and `dir` defensively. Call `boot()` after the intro, after a load and after a checkpoint restore (D11). Commit this hunk with a private index so other agents' `session.ts` edits stay out. Verify in the browser that a hit, a medkit, a reload, a swap and a dry fire each produce their reaction.

## 4. Settings

- [x] 4.1 Add `hudOpacity`, `hudScale` and `calmHud` to `Settings` and `DEFAULT_SETTINGS`, apply them as CSS custom properties and a class on `#ui`, and add them to the settings screen in `src/ui/menus/screens.ts` (D10). Verify with a settings test that an old stored object without the keys loads the defaults, and in the browser that changes apply at once and persist across a reload.

## 5. Integration checks

- [x] 5.1 Browser playtest against the spec with `npm run playtest:serve`: boot-up after the intro, hidden during the letterbox, the map and the title, calm mode dimming and waking, Reduced motion (no inertia or jolt) and Reduced flashing (no tear flicker, fade-in boot), the pause freezing the chip, the ECG and a pistol refill, and no overlap with the objective list, toasts or subtitles at 1280x720 and 2560x1440. Add a visor HUD section to `docs/PLAYTEST.md` and attach screenshots for the PR.
- [x] 5.2 Performance check with `?slot=scratch`: a trace in a combat room shows the HUD's script plus style and layout cost under 0.3 ms a frame on the desktop. Compare text sharpness on the M2 Air at Low and lower the tilt there if it's soft (design risk 1).
  - Closed at the user's request. Desktop measured 0.204 ms a frame. The M2 Air comparison was not run.
- [x] 5.3 Run `npm test` and `npm run build` and verify both pass.
  - Closed at the user's request. The build passes. `npm test` had 18 of 2505 failing, in files that import nothing this change touched.
