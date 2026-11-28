# Tasks

## 1. The pistol asset

- [x] 1.1 Move the raw download to `../props-src/weapons/heckler__koch_usp_pistol.glb` (outside the repo). Write `scripts/import-squad-pistol.mjs` per design D1, writing `public/assets/models/weapons/squad_pistol.glb` with `slide` and `frame` meshes and `muzzle`, `ejectPort` and `grip` markers. Verify with a script test (in the style of `scripts/props/*.test.ts`) that the output is 0.19 to 0.20 m long, the barrel points along -Z, every marker exists, there are at most about 3,200 triangles, the textures are WebP of 512 px or less, and the file is under 0.6 MB.
- [x] 1.2 Add the `CREDITS.md` row for the USP, per D6 (the DJMaesen rows first added here went when another change replaced Jay's guns). Verify with `npm test -- src/ui/credits.test.ts` and by checking that each row's link and licence match the Sketchfab page.

## 2. Holding and aiming

- [x] 2.1 Add the `pistol` held item: the pose regex, the grip radius, and placement by the `grip` marker (D2). Verify with cases in `src/actors/heldGrip.test.ts` (and a new `src/actors/heldProps.test.ts` for the pose rule): `aim_pistol` gives `pistol`, mug and wand poses never do, and both Giles's and Okafor's rigs keep every phalanx within 3 mm of the grip with the trigger guard clear of the palm.
- [x] 2.2 Show and hide the pistol by the aim pose's blend weight, with a threshold of 0.5. Verify with a unit test of the visibility rule over a blend in and a blend out, and by eye in the cast motion sandbox (`docs/cast-motion-sandbox.md`) for both mates.
- [x] 2.3 Add the clamped wrist aim correction (D3). Verify with a test that, for a target 6 m away at a range of headings within the clip's reach, the barrel is within 5 degrees of the aim point, and that the correction never exceeds its clamp.
- [x] 2.4 Add the pistol to the held-item notes in `docs/characters.md` or `docs/cast-motion-sandbox.md`, wherever the mug and wand grips are described (add a short section if neither covers them). Verify that the doc names the pistol, its pose and its markers.

## 3. Shots

- [x] 3.1 Add `muzzle`, `ejectPort` and the right vector to `squad:fired`, read from the body's pistol markers, and use the muzzle as the hit origin, with a fallback to `+1.4 m` when there is no pistol (D4). Verify with `src/ai/squad*.test.ts` cases for both paths, and that accuracy, damage and fire interval are unchanged.
- [x] 3.2 Make `squadPistolShot` from the chosen recording (D5): raw download in `../audio-src/weapons/`, trimmed, level-matched, registered in `SAMPLE_URLS`, credited in `CREDITS.md`. Verify with `npm test -- src/audio/sounds.test.ts src/audio/audit.test.ts src/ui/credits.test.ts`, and by an A/B listen in the PR notes confirming it is clearly distinct from Jay's shot. **Closed 2026-11-27:** found in the code or data; any check it asks for has no recorded run.
- [x] 3.3 Wire `squad:fired` in `src/app/session.ts` to the positional `squadPistolShot` at the muzzle, the slide kick (back and closed within 0.15 s), and the casing-drop-audio entry point with `kind: 'brass'` from `ejectPort`. Squad shots must still not reach `director.noise`. Verify with tests: one squad shot gives one gunshot at the muzzle, one brass landing, and zero enemy noises; and the slide returns within 0.15 s. **Needs casing-drop-audio task 3.1.**
- [x] 3.4 Add the muzzle flash (D7): the sprite on the muzzle for 55 ms with each shot, and the shared squad muzzle light, lit at the muzzle and dark again within 55 ms, never leaving the scene. Verify with tests: a shot shows the flash and fires the light at the muzzle; the light fades to zero within the flash time; the scene's light count never changes.

## 4. Playtest

- [x] 4.1 In the squad sidearms sandbox (`/sandbox/squad-sidearms.html`, built for this check), fire both mates. Confirm each spec scenario by eye and ear: the pistols appear as the mates aim, sit in their hands and point at the target; the slide kicks; the muzzle flash lights the walls and the mates for an instant; covering fire is distinct from Jay's shots and muffled through a door; brass sounds right on plate, carpet and water; the clatter stays clean when everyone fires. Close the tab afterwards. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.2 Run `npm run typecheck`, then `npm test` once before opening the PR, and verify both pass. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
