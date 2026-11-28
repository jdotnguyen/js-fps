# Proposal

## Why

Jay's first-person pistol has two problems that are in view whenever it is drawn:

- Novelty decals are painted into its textures: two skull diamonds and an orange "BANG" on the left side of the slide. They clash with the game's tone, and the skull looks like the Call of Duty: Ghosts emblem, a third-party mark that the model's CC BY 4.0 licence is unlikely to cover.
- It looks soft. Its 1024 px textures give about 1,800-2,260 texture pixels per metre on a surface that sits roughly 7-30 cm from the camera. The author's 2048 px textures are now available.

## What Changes

- Replace the pistol's colour, roughness/metal and normal textures with the author's 2048 px versions. They use the same layout as the shipped ones.
- Paint out the three slide decals, the fourth tilted skull (on what appears to be the magazine) and the cut-off decal pieces on narrow frame surfaces, filling each with clean metal from the surrounding part so that grain and wear carry through.
- Apply the same repair to the roughness/metal texture, which holds matching footprints, so no outline shows in reflections.
- Make both changes part of `scripts/fix-just-weapons-glb.mjs`, so a rebuild keeps them and the shipped model can be updated without rebuilding its geometry. The 2048 px source becomes a required input for the pistol.
- Raise the pistol's file size budget to fit the larger textures.
- Note the changes in `CREDITS.md`, since CC BY 4.0 requires modifications to be indicated.

Out of scope: the mesh, UVs, rig and animations; the sleeves and gloves (including their 2048 px textures); the shotgun and the squad pistol; added or generated surface detail; new decals; screen-wide rendering settings such as chromatic aberration and anti-aliasing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `weapon-viewmodels`: adds requirements that the first-person pistol shows no decals, stickers or third-party logos at any point, including during reload, and that its surfaces are textured at 2048 px.

## Impact

- `public/assets/models/weapons/pistol.glb`: three textures change. The file grows from about 1.6 MB to about 2.6 MB.
- GPU texture memory: about 50 MB more, to be measured as `runtime-memory` requires.
- `scripts/fix-just-weapons-glb.mjs`: gains the texture step. It already depends on ImageMagick, so no new dependency is expected.
- `scripts/fixJustWeapons.test.ts`: new texture checks and a higher size budget for the pistol.
- `CREDITS.md`: the AnimatedPistol entry.
- A source file kept outside the repo: the 2048 px glTF download of AnimatedPistol.
- No gameplay or rendering code.
