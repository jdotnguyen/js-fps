# Design

## Context

See proposal.md for why. The viewmodel pipeline is `glbWeapons.ts` (`GlbWeapon`: loads a GLB, plays clips by name, follows one gun bone for the muzzle and recoil) driven by `viewmodel.ts` (state machine, sway and bob springs, `CUES` sound timings, ammo). Both new files are a different shape from the old ones. I measured them in Node with three.js (scripts kept in the scratchpad, not in the repo):

| | pistol | shotgun |
|---|---|---|
| Rig | 119 nodes, 89 joints, same sleeve and glove meshes | same |
| Clips | `Take` 0.33, `Shoot` 0.33, `Reload` 3.67, `Hide` 0.47 | `Take` 0.63, `Watch` 2.5, `Shoot` 1.04, `ReloadStart` 0.63, `Reload` 0.71, `ReloadEnd` 0.71, `Hide` 0.63 |
| Gun bones | `Base_060`, `Up_061` (slide), `Mag_062` | `Base_060`, `Pump_061`, `Shell_062` |
| Size | 8.6 MB, 9 PNGs at 1024x1024 | 11.7 MB, 11 PNGs at 1024x1024 |

Facts that shape the approach:

- **Rest pose.** In both files, every clip starts and ends on one pose (`Take`'s last frame). `Shoot`, `Reload` and `Hide` key only about 60 to 70 of `Take`'s 160 channels, but the bones they leave out sit at a default transform equal to that pose. So crossfading in and out of rest never snaps a finger.
- **No idle.** The pistol and shotgun have no loop. `GlbWeapon` already falls back to holding a clip's first frame (the old shotgun used it). `feel.idle` exists in the feel table but nothing reads it.
- **Scale.** The Armature node is scaled 1142x. The gun mesh data is out of proportion with the arm data (a Colt about 165 units long against hands tens of units across; the shotgun's gun vertices in the thousands). My skinned-bounds check in Node put the Colt tens of units from the arms, which cannot be right visually, so the true on-screen size is unknown until the models are loaded in the weapon lab.
- **The GLBs' gun meshes are broken; the FBX sources are right.** Spike result (the Sketchfab GLBs, loaded as shipped, put the gun parts far from the arms): the pistol's three Colt parts are the FBX bind-pose geometry divided by 5.85, and the slide is also doubled along x; the shotgun body is 1.027x, its shell about 3x and flipped, and one small part's bind matrix is corrupt in the FBX. No single factor fixes them. The author's FBX files (`MyPistol.fbx`, `AnimatedShotgun.fbx`, with 4K textures) have the gun skinned correctly: the shotgun body comes out 42 units long against a hand of 8 (real-world ratio about 5.3), and the slide and frame sit on the `Up`, `Base` and `Mag` bones. The arms, skeleton and animations in the GLBs are fine.
- **Hands are IK-driven.** The hands follow fixed bone positions in the animation, so the gun cannot be scaled alone without the hands floating off it.
- **Flashlight.** `Flashlight` springs its beam direction toward the camera (`stiffness` 40, `damping` 8) and uses `origin` from the held model's lens, falling back to chest-left (0.22 m left, 0.32 m down) when there is no model.

## Goals / Non-Goals

**Goals:**
- Both weapons play and sound right with the new clips, with no snaps at the seams between clips.
- The first-person view never shows a floating arm end or hand.
- The beam points exactly where the camera looks, every frame.

**Non-Goals:**
- Editing or re-authoring the source meshes, animations or proportions. Only the pipeline's own clean-up (junk nodes, bone names, encoding, uniform scale) is allowed.
- The squad's third-person pistol (`squad_pistol.glb`, `squadPistol.ts`).
- The shotgun `Watch` inspect clip. It is left in the file's source but not shipped, or shipped unused if stripping it costs more than keeping it.
- A different ammo, damage or fire-rate balance.

## Decisions

**1. One clean-up script, run once, outputs committed.** A `scripts/fix-just-weapons-glb.mjs` takes each GLB together with its FBX and writes `pistol.glb` and `shotgun.glb` (the sources are not in the repo, as with `fix-lab-glb.mjs`; the script documents where they come from). It first rebuilds the gun meshes: it loads the FBX with three's `FBXLoader`, skins each gun part to the rest pose, converts the vertices into the GLB's own bind space (inverse of the GLB's joint-world times inverse-bind at its default pose, so skinning at rest lands them exactly where the FBX has them) and swaps them, with the FBX's normals, UVs and weights mapped to the GLB's joints by bone name, into the GLB's gun meshes. The arms, skeleton and clips stay as they are in the GLB. A part whose FBX bind matrix is corrupt (the shotgun's small sight part) keeps its GLB geometry and takes the factor measured on its sibling (0.01027). Then it removes `crosshair`, `Sun`, `Camera`, `camera_01`, `camera_target_02` and `pose_controller_03`, renames the gun bones to the names `glbWeapons.ts` expects (the "Armature|" clip prefix is still stripped in the loader, as today), re-encodes the textures (WebP) and compresses the meshes (meshopt). It also writes the two files so both reference one glove texture set. Alternative: load the raw 20 MB in the game and clean at runtime. Rejected: it adds a startup cost and the `startup-bundle` and `runtime-memory` specs both care.

**2. A uniform `modelScale` per weapon in `WEAPON_MODELS`.** The model's root group is scaled as a whole (arms and gun together) and offset toward the camera through the existing `ref` point. This keeps the IK-driven hands on the gun. Alternative: shrink only the gun. Rejected: floats the hands. **Spike result (lab, 1280x720, FOV 80 and the menu's 95):** with the rebuilt guns the authored placement already has both arms leaving the bottom edge at 80 and 95, but the weapon is small. The eye (`ref`, in model units, before the half turn) goes forward and slightly down: pistol `[0, 33.4, 5]` (the authored eye is `[0, 34, 0]`), shotgun `[0, 33.8, 1.5]` (its receiver is only 6.2 units from the authored eye, against 10.3 for the pistol, so it takes less). That makes the sleeves start behind the camera and the weapon about 1.7x larger on screen at 80, with both hands and arms still running off the bottom. One shared `modelScale` of 0.024 m per model unit keeps real-world proportions (the shotgun 42 units = 1.0 m, the pistol 11 units = 0.26 m, a hand 8 units = 0.19 m) and the same glove size in both weapons. The menu's FOV range is 70 to 95.

**Found when playing it (the first in-game screenshot showed streaked, blown-out gloves and slide):** (a) the viewmodel's fill light sat 10 cm from the new gun, which is only about 0.13 m from the eye (the old gun was about 0.44 m). Inverse-square falloff blew it out and exaggerated the glove and slide normal maps into stripes. The light moves to `[0.05, 0.22, 0.2]`, about 0.45 m from the grip, at the same intensity. A viewmodel light must be about that far from the gun. (b) The old sprint and lowered poses pitched the muzzle UP (positive x rotation) while dropping the gun; that works for the short old pistol but swings a 1 m shotgun barrel across the middle of the view. Sprint and lowered now pitch it DOWN: pistol sprint `p [0, -0.1, -0.1] r [-0.3, 0.45, -0.2]`, lowered `p [-0.018, -0.3, -0.1] r [-0.7, 0.3, 0]`; shotgun sprint `p [0.07, -0.1, -0.06] r [-0.3, 0.55, -0.2]`, lowered `p [0.029, -0.45, -0.06] r [-0.9, 0.3, 0]`. Checked at 95 degrees: both lowered poses are fully off screen, and in both sprints the gun is low across the body with the arms leaving through the bottom edge. Rest was checked in the game at 95 degrees at 16:9, 4:3 and 21:9 (both hands run off the bottom edge in each).

**3. Rest is the held last frame of `Take`, not the first frame of `Shoot`.** The new rest clip is built from `Take`'s last frame, so it covers every channel, not just `Shoot`'s. The seams were measured identical, so this is mostly insurance, but it makes rest independent of which clip was played last.

**4. Breathing is procedural, on the root.** The unused `feel.idle` gain drives a slow sine of about 2 to 3 mm in position and a fraction of a degree in rotation, per weapon, scaled to zero by the `reducedMotion` flag. Alternative: author an additive idle clip from `Take`'s last frame by rocking the forearm bones. Rejected for now: more code and a larger asset for a motion that the camera sway already hides.

**5. Pistol reload is one clip and one set of cues.** `ReloadClip` and `EmptyClipReload` collapse into `Reload`. `CUES.pistol.magOut`, `magIn` and `slide` are re-read from the `Mag_062` and `Up_061` tracks (read from the bone tracks in the spike: the magazine leaves the grip at 0.62 s, is held out until about 1.6 s and seats at 2.15 s; the slide releases at 3.1 s), and `slideSoft` is dropped because there is only one slide move, and so is `cockBack`: the pistol's `Take` has no slide movement (the slide offset stays at 0.18 units), so the rack-on-draw sound has nothing to sync to and its fit script is dropped with it. The reload plays at 1x. `WIELD_SPEED` and `SWITCH_SPEED` are re-derived or set to 1, since they sped up slow clips that no longer exist.

**6. Shotgun fire and pump are one clip.** `Fire` then `PostFire` after `pumpAfterShot` becomes a single `Shoot` (1.04 s; the pump rack is the quick move at 0.6 to 0.8 s, so the pump sound cue is 0.58 s). The cooldown is 0.85 s, when the pump is home (the clip runs to 1.04 s, but its last 0.2 s is settling), `CUES.shotgun.pump` is retimed into it, and the hull ejects on that cue as the `in-world-audio` casing requirement already says. The recoil-cancel check, which named `Fire` and `PostFire`, uses `Shoot`.

**7. Shotgun reload is `ReloadStart`, `Reload` x N, `ReloadEnd`.** This replaces `PriorToReload`, `ReloadOne` and `ReloadLastOne`. Each `Reload` is 0.71 s and loops cleanly (first and last pose match). The shell seats about 0.42 s into each `Reload`. `ReloadEnd` includes the pump rack (back at 0.1 s, home by 0.3 s, so the cue is 0.08 s), and `Take` racks the pump too (back at 0.3 s, cue 0.22 s, replacing the old `Unhide` and `Weild` cues). so the old "last shell" branch becomes "exit" with `ReloadEnd`. The `stop` flag in the reload state is never set today, so it is dropped rather than carried over. Firing still interrupts a reload at once, as it does now.

**8. The gun bone carries the muzzle; recoil comes from the springs.** `GlbWeapon` takes the bone name per weapon (`Base` in both; it was `weapon_039`) and the muzzle as a rest-pose point, which it converts into the bone's own space at load so the muzzle follows the clip. The old `Fire` clip threw the whole rig back about 0.35 m and the viewmodel cancelled a share of that (`recoilCancel`, `GlbWeapon.recoilDelta`). `Shoot` moves the gun bone only a few millimetres, so that mechanism is removed and the recoil springs carry the felt recoil instead (pistol about 2.5 cm back and 2 degrees of lift, shotgun about 6 cm and 4.5 degrees). These are starting values to tune in a playtest.

**9. The flashlight becomes a light only.** `FlashlightProp`, its test, `flashlight.glb`, its lens glow and the raise and lower logic in `viewmodel.ts` are deleted. `Flashlight.update` sets the beam direction from the camera on every frame (no spring state, no `stiffness` or `damping`) and always uses the chest-left origin. Alternative: keep the spring at a faster setting. Rejected: the player asked for none, and a spring at any value lags a fast turn.

**10. The weapons skip ambient occlusion.** On High the `n8ao` pass (1 m radius, tuned for the level) ran over every solid mesh, the weapons included. A gun held 0.13 to 0.3 m from the lens sits inside that radius, so the pass sampled the gun's own small features and the room behind it, and its depth-aware blur left streaks that slid across the gun as the view turned. It never showed in the lab (no post), nor in a Medium-tier headless run (AO is High-only); it was confirmed by the user switching `__post.setQuality('medium')`, which made it vanish, with the flashlight and the lab ruled out first. The existing way out is `userData.skipGtao` on a mesh (`skipsAo` in `post.ts`): a flagged mesh is drawn after the AO pass, depth-tested against the AO scene's copied depth, and neither shaded by AO nor feeding it. `GlbWeapon` flags every mesh of its model. Alternative: shrink the AO radius for near fragments. Rejected: it would change the look of the whole level to fix one object, and the old gun's AO was never wanted either.

## Risks / Trade-offs

- [Gun looks too large or sits wrong] -> The lab spike comes first, before any game code changes, and decides scale and offset by eye with the spec's screenshot criterion. A screenshot of the models from the author's page helps compare, but the lab view is what counts.
- [A 3.7 s pistol reload is a long lockout] -> Accepted by the user for tension. It is a single constant if it needs to change later.
- [`Shoot`'s kick is much smaller] -> The recoil springs in `viewmodel.ts` carry the felt recoil, retuned in the lab.
- [Doubled texture memory] -> About 20 images at 1024x1024 before dedup. The shared glove set saves 3 images, and WebP plus meshopt keeps the download near the old size. Verified with `?slot=scratch&memprobe`.
- [Four-map materials] -> The Colt and shotgun materials use base, metal-rough, normal and occlusion maps (3 on the old ones). With `dfgLUT` that is 5 units, inside the 8 the heaviest materials already use, and the viewmodel does not receive shadows, so the 16-unit budget in `texture-unit-budget` is untouched.
- [Overlap with `holster-until-the-drop` and `squad-sidearms`] -> Both touch the pistol and the viewmodel's enabled check. This change should land after `holster-until-the-drop`, or rebase onto it, and must keep its holster pose.
- [Credits and licence mix-ups] -> Remove the DJMaesen and MAR.COS. rows only after the models are gone, and check that no other asset uses their files.

## Migration Plan

1. Land the clean-up script and the new GLBs together with the loader changes, in one commit, so the game is never between models.
2. Existing saves hold ammo, not clip state, so nothing migrates.
3. Roll back by reverting that commit. The old GLBs stay in git history.

## Open Questions

- Whether the unused `Watch` clip is stripped from the shipped shotgun file (smaller) or left in for a future inspect animation.
