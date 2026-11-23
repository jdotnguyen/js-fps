# Proposal

## Why

The first-person pistol and shotgun are DJMaesen's "Pistol Animated" and "Shotgun Animated", both CC BY-NC 4.0. A non-commercial licence blocks any commercial release. JUST's "AnimatedPistol" and "Animated Shotgun" (both CC BY 4.0) share one rig and one gloved arm, so the two weapons would also look like the same pair of hands. They animate the hands in more detail (every finger, a magazine-out and slide-rack reload on the pistol, a start / per-shell / end reload on the shotgun).

The held flashlight model leans on the old rig: both new guns are gripped with both hands, so a flashlight model has no free hand to sit in. Dropping the model and keeping only the light is simpler and also lets the beam point exactly where the player looks.

## What Changes

- Replace `pistol.glb` and `shotgun.glb` with cleaned copies of JUST's models. A new script (in the style of `scripts/fix-weapon-glb.mjs`) strips the camera rig, crosshair, sun and controller nodes, renames the gun bones, re-encodes the textures and shares the glove textures between the two weapons. The proportions of the source model are kept as authored.
- Place both weapons close to the camera, so the sleeves start off screen and no floating hand or forearm end is visible. Any size adjustment is a uniform scale of the whole model (arms and gun together), never of the gun alone.
- Map the new clips: pistol `Take`, `Shoot`, `Reload`, `Hide`; shotgun `Take`, `Shoot` (fire and pump in one clip), `ReloadStart`, `Reload` (once per shell), `ReloadEnd`, `Hide`. The shotgun's `Watch` clip is left unused.
- The pistol has a single reload for loaded and empty magazines, played at 1x (3.67 s). The empty-magazine reload no longer has its own clip.
- Neither pistol nor shotgun ships an idle clip. The rest pose is held, with a small procedural breath so the hands are never frozen.
- Re-read the `CUES` sound timings from the new clips' bone tracks, and refit or drop the pistol rack sound that was fitted to the old `Weild` clip.
- Retune the recoil cancel for the smaller `Shoot` kick.
- Remove the held flashlight model (`FlashlightProp`, `flashlight.glb`, its raise and lower logic, its credit and its lens glow). The beam always leaves the chest, with the pistol, the shotgun or nothing out.
- The beam direction follows the camera on every frame. The spring that made it trail the view while turning is removed.
- Credit JUST in `CREDITS.md` for both models, remove the DJMaesen and MAR.COS. rows, and delete the unused old GLBs.

## Capabilities

### New Capabilities
- `weapon-viewmodels`: How the first-person pistol and shotgun look and play: licensing and credit, no visible floating hands, a living rest pose, and reload and pump timing taken from the authored clips.

### Modified Capabilities
- `player-flashlight`: The held model and every requirement about it are removed. The beam always comes from the chest and points straight along the view with no lag. The lens pattern requirement stays.

## Impact

- Code: `src/render/viewmodel/glbWeapons.ts` (clip names, bone names, scale), `viewmodel.ts` (clip use, `CUES`, recoil cancel, breath, shotgun reload and pump state), `rig.ts` and `lab.ts` if they name the old bones, `src/render/flashlight.ts` (no spring), `flashlightProp.ts` and its test (deleted), `src/app/session.ts` (flashlight prop wiring), `src/audio/sounds.ts` and `scripts/fit-pistol-cock.mjs` (rack sound).
- Assets: `public/assets/models/weapons/` (pistol and shotgun replaced, flashlight and old weapon models removed), a new `scripts/fix-just-weapons-glb.mjs`, `CREDITS.md`.
- Specs: new `weapon-viewmodels`, delta to `player-flashlight`. The casing requirements in `in-world-audio` still hold, since they describe the pump motion.
- Coordination: `holster-until-the-drop` (6/8) and `squad-sidearms` (9/12) also touch the pistol. The squad's third-person pistol (`squad_pistol.glb`) is not changed.
- Memory and loading: both weapons together raise the texture count (about 20 images at 1024x1024 before sharing the glove), so the compressed assets and the shared glove textures should be checked against the `runtime-memory` and `startup-bundle` specs.
