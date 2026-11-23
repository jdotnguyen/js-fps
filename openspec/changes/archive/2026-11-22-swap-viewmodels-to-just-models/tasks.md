# Tasks

## 1. Spike: look at the models in the weapon lab

- [x] 1.1 Load the two source GLBs (copies, not committed) in the weapon lab (`src/render/viewmodel/lab.ts`, see `docs/lab-sandbox.md`) next to the current pistol and shotgun. Reuse a running dev server on `http://localhost:5173/` and close the tab afterwards. Verify by saving one screenshot of each weapon at rest and noting in design.md's Open Questions the size and position that keep both arms entering through the bottom or side edge at 16:9, 21:9 and 4:3 at the lowest and highest field of view.
- [x] 1.2 Decide the uniform scale and the offset toward the camera for each weapon, and whether the pistol and the shotgun can share one value. Verify by writing the chosen numbers into design.md (Decision 2) and removing that Open Question.
- [x] 1.3 Read the real cue times from the bone tracks: pistol magazine out, magazine in and slide in `Reload`; shotgun pump in `Shoot`, shell seat in `Reload`, pump rack in `ReloadEnd`. Verify by listing each time next to its clip in design.md (Decision 5 to 7).

## 2. Asset pipeline

- [x] 2.1 Write `scripts/fix-just-weapons-glb.mjs`: rebuild the gun meshes from the author's FBX (rest-pose skinning, converted into the GLB's bind space, weights mapped by bone name; the spike prototype is in the session scratchpad as `rebake.mjs`), then remove the camera, crosshair, sun and controller nodes, rename the gun bones to the names the loader expects, re-encode textures as WebP and meshopt-compress (the scale from 1.2 is not baked in; it is `modelScale` in code, see 3.1), and keep the 1024 px textures (the FBX's 4K originals are not used). The two files cannot share glove textures on disk, so `loadWeaponModels` shares the glove and sleeve textures at runtime (see 3.1). Verify by running it on the two sources and checking the outputs are under 2.5 MB each (1.6 MB and 2.2 MB measured; the old files were 0.9 MB each, the difference being the FBX's denser gun meshes and the shotgun's longer clips), and that running it on its own output gives the same model (vertices equal to float rounding).
- [x] 2.2 Add `scripts/fixJustWeapons.test.ts` (in the style of `scripts/importSquadPistol.test.ts`) that parses the committed `pistol.glb` and `shotgun.glb` and asserts the clip names, the gun bone names, no camera, crosshair or sun nodes, a CC-BY-4.0 licence in the asset extras, and that the gun parts sit on the gun bones (the slide's bounds within 1.5 units of the `Up` bone, the shotgun body between `Base` and `Pump`). Verify with `npm test -- scripts/fixJustWeapons.test.ts`.
- [x] 2.3 Write the two new GLBs into `public/assets/models/weapons/`. Verify by loading each in the lab and seeing the same look as in 1.1.

## 3. Pistol

- [x] 3.1 In `src/render/viewmodel/glbWeapons.ts`, share the identical glove and sleeve textures between the two weapons after loading (dispose the duplicates), and add per-weapon `bone`, `modelScale` and rest source to `WeaponModelSpec`, build `Rest` from `Take`'s last frame, update `ClipName`, and drop the pistol's `Idle`. Verify with `npm run typecheck` and a small unit test that builds a `GlbWeapon` from a hand-made clip set and holds the rest pose.
- [x] 3.2 In `viewmodel.ts`, play `Take` for every draw (the first draw and a switch), `Shoot` for a shot and `Reload` for both loaded and empty reloads at 1x. Set `SWITCH_SPEED` and `WIELD_SPEED` so the clips play at their authored speed. Verify by playing in the lab: draw, fire, reload empty and reload partial each complete and return to rest with no pop.
- [x] 3.3 Re-read `CUES.pistol` from 1.3 (drop `slideSoft`), and replace the recoil cancel, which cancelled the old `Fire` clip's 0.35 m throw and has nothing to cancel in `Shoot`, with stronger recoil springs (starting values, tuned in a playtest). Verify in the lab that the magazine sounds land with the visible magazine within 0.1 s, and add or update the cue assertions in the existing viewmodel and audio tests (`src/audio/engine.test.ts`).
- [x] 3.4 Refit the pistol rack sound to `Take` with `scripts/fit-pistol-cock.mjs` (or drop the fit if the clip no longer has a rack): dropped, the new `Take` has no slide movement, so the cue, the sound entry, the sample and the script are removed. Follow `docs/audio-assets.md`. Verify by listening to the first draw in the lab and by running the touched audio tests.

## 4. Shotgun

- [x] 4.1 In `viewmodel.ts`, replace `Fire`, `PostFire`, `PriorToReload`, `ReloadOne` and `ReloadLastOne` with `Shoot`, `ReloadStart`, `Reload` and `ReloadEnd`; retime `CUES.shotgun.pump` and `shell` from 1.3; remove the never-set `stop` flag. Verify by playing in the lab: a shot and pump, a full reload from empty, and fire-interrupt after two shells (the two shells stay).
- [x] 4.2 Make the shotgun cooldown the time the pump is home in `Shoot` (0.85 s) and keep the hull ejecting on the pump cue (`src/audio/casings.ts`). Verify by `npm test -- src/audio/casings.test.ts` and by watching the hull leave on the pump in the lab.

## 5. Breathing and framing

- [x] 5.1 Wire `feel.idle` to a slow sine on the weapon root for both weapons, scaled by `reducedMotion`. Verify with a unit test that the offset is non-zero over 5 s and exactly zero with reduced motion on.
- [x] 5.2 Check that no arm end or loose hand shows at 16:9, 21:9 and 4:3 at the lowest and highest field of view, at rest, aiming, sprinting, reloading and switching, for both weapons. Verify with screenshots from the lab or `docs/PLAYTEST.md`, and adjust the scale or offset from 1.2 if needed.

## 6. Flashlight

- [x] 6.1 In `src/render/flashlight.ts`, remove the spring and set the beam direction from the camera on every frame, always from the chest-left origin. Verify with a unit test that after one `update` the direction equals the camera direction, for a 90 degree turn in a single step.
- [x] 6.2 Delete `flashlightProp.ts`, its test and `public/assets/models/weapons/flashlight.glb`, and remove its use, its raise and lower logic and its lens glow from `viewmodel.ts` and `src/app/session.ts`. Verify with `npm run typecheck` and a search that finds no remaining reference to `FlashlightProp`.
- [x] 6.3 Check the beam in the lab and in a dark room with the pistol, the shotgun and no weapon: same origin, no lag on a fast turn. Verify by playing on `?slot=scratch`. Accepted on the user's playtest ("looks good"); the beam's direction and origin are covered by `flashlight.test.ts`, and my own in-game spin check never finished loading.

## 7. Credits, old assets and docs

- [x] 7.1 In `CREDITS.md`, add JUST's two models with link and CC BY 4.0 and remove the DJMaesen and MAR.COS. rows. Delete the old weapon GLBs once nothing loads them. Verify by `grep` showing no reference to the old file names and by opening the in-game credits (`src/ui/credits.ts`).
- [x] 7.2 Update `docs/HANDOFF.md` and `docs/PLAYTEST.md` for the new clips, the flashlight and the reload length, and the comment in `glbWeapons.ts` that describes the old shotgun fix. Verify by reading the pages against the code.
- [x] 7.3 Edit the Purpose of `openspec/specs/player-flashlight/spec.md` so it no longer says the model is on screen. Verify with `openspec validate swap-viewmodels-to-just-models`.

## 8. Integration checks

- [x] 8.1 Run `npm run typecheck`, `npm run build` and the test files this change touched (`npm test -- <files>`). Verify they all pass and note any unrelated failures from other agents' uncommitted work.
- [x] 8.2 Play through with `?slot=scratch&memprobe`: draw, fire, reload, switch weapons, flashlight on and off, and holstered start before the drop (the `holster-until-the-drop` behaviour). Verify the load size and memory against the previous build, and close every server, tab and browser this session opened. Accepted on the user's playtest ("looks good"); headless I checked draw, rest at 70-95 degrees and three aspect ratios, and the poses, but not fire or reload in the live game (the reload and shotgun flow are covered by `viewmodel.test.ts`).

## 9. Ambient occlusion and the viewmodel

- [x] 9.1 In `GlbWeapon`, flag every mesh of the model `userData.skipGtao`, so the AO pass in `post.ts` neither shades the weapons nor reads them. Verify with a unit test in `glbWeapons.test.ts` that `skipsAo` is true for every mesh of a built weapon, and by switching the headless game to High and seeing the gun still drawn, lit and hidden by walls.
- [x] 9.2 On the desktop PC at High, in the red-lit lab where it was seen: no streaks or repeating pattern on the gun or gloves while turning, the same as on Medium. Verify with the user (only their GPU shows the artifact); the debug URL and `__post.setQuality` toggles are described in `docs/PLAYTEST.md`. Confirmed by the user on High after the fix.
