# Tasks

## 1. 2048 px textures

- [x] 1.1 Before changing the model, record the baseline: GPU texture memory of the heaviest scene at High using `?slot=scratch&memprobe`, and screenshots of the pistol at rest and aiming from a repeatable spot. Verify the figure is written into design.md under Memory Measurement.
- [x] 1.2 Add the texture step to `scripts/fix-just-weapons-glb.mjs`: replace the three `Colt` textures in a built `pistol.glb` with those from the 2048 px glTF, and run it from the full rebuild, which fails without that file. Verify that running it on the shipped model changes only those three textures (mesh, skin, clips and arm textures unchanged).
- [x] 1.3 In `scripts/fixJustWeapons.test.ts`, check that the three gun textures are at least 2048 px and raise the pistol's size budget to 3.0 MB. Verify the size check on textures fails on the previous `pistol.glb`.

## 2. Decal repair

- [x] 2.1 Extend the texture step to cover the three slide decals, the tilted skull and every cut-off fragment in the colour texture with clean metal from the same part, with feathered edges. Verify on enlarged before/after crops that no decal pixels or hard seams remain and that no wooden grip pixels changed.
- [x] 2.2 Repair the matching footprints in the roughness/metal texture, using the same source offsets as the colour texture where one is copied, and check the 2048 px normal map for footprints, repairing any the same way. Verify on the same crops that no square, round or lettering outline remains.
- [x] 2.3 Rebuild the shipped `pistol.glb`. Verify that a second run produces the same textures and that `npm test -- scripts/fixJustWeapons.test.ts` passes.
- [x] 2.4 Add a test that finds no saturated blue, orange or yellow pixels inside the repaired regions of the colour texture (limited to those regions because the wooden grip is orange-brown). Verify it fails on the previous `pistol.glb` and passes on the repaired one.
- [x] 2.5 Update the script's header comment (the new input, its file name and Sketchfab page, the command) and the AnimatedPistol entry in `CREDITS.md` (2048 px textures, decals painted out, new file size). Verify the documented command runs as written.

## 3. In-game check

- [x] 3.1 View the pistol at rest, aiming and through a full reload on High and Medium, with `?slot=scratch`. Verify with screenshots that every scenario in the `weapon-viewmodels` delta holds, including no ghost outline as the view turns past a light and a visibly crisper slide than in the baseline screenshots.
- [x] 3.2 Repeat the memory measurement from 1.1. Verify the new figure and the change from the baseline are recorded in design.md, with the reason if it rose by more than 15%.
