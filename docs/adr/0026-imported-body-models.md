# ADR-0026: Imported body models for the crowd

Status: Accepted (Nov 18)

## Context
Bodies are procedural (ADR-0006), with the plan from the start that real models could replace
pieces later. Justin found a rigged, textured zombie on Sketchfab ("Zombie Walk", CC-BY-NC) and
wants it as a **common infected**, not as a hero/elite [Decided]. Amended Nov 18: the hero tier now
uses the imported `necromorph` slasher body (`HERO_MODEL` in `enemyDirector.ts`; its clips are dropped like every model's, textures
re-encoded, 7.1 MB -> 0.74 MB); the sculpted procedural hero (ADR-0021) is the fallback if it fails to load.

## Decision
- A rigged GLB becomes a normal `Humanoid` body: same 21-joint skeleton, same procedural
  animator, hit capsules, severing, stumps, gore and AI. Nothing downstream knows the difference.
- At load (`bodyModel.ts`, once per model):
  1. Bones are mapped onto the game joints by name (this rig's `L_Shoulder`/`Spine3`, Mixamo's
     `mixamorig:LeftArm`, Bip-style names). Spine bones split lower half -> `spine`, upper -> `chest`;
     fingers -> `hand`, toes -> `foot`, rib/twist/helper bones -> their parent's joint.
  2. The mesh is re-posed into the game rest pose: turned to face -Z (left at -X), spine vertical,
     arms and legs hanging straight, feet forward. Then scaled to the reference 1.78 m.
  3. Skin weights are folded onto the game joints (smooth, up to 4 per vertex) and the joint
     positions become the body's `jointOffsets`, so the skeleton fits the mesh, not the reverse.
  4. Triangles are split by the joint that carries most of their weight: one piece per
     joint and material, which is what severing and debris need.
  5. Wound-cap radii are measured from the mesh just past each severable joint.
- The model's own animation clips are **not used** [Assumed]: the procedural shamble, lurch,
  stagger, crawl and deaths drive it like every other body. Blending in a baked walk is possible
  later but would fight the crawl/limp/lean layers.
- Textures render through the body shader (`SurfaceDef` in `bodyMaterial.ts`), so per-bone
  darkening (reduced gore) and a light infection tint (`sickTint`, default 0.3) still apply.
  Cut-out materials (hair cards) use alpha test, never blending.
- `data/body-models.json` lists models: url, which enemy variants may use them, `share` of those
  spawns (zombieWalk: shamblers and play-dead, 0.5) [Assumed], `sickTint`, and the credit.
- `EnemyDirector.spawn` picks per spawn from its own rng fork, so procedural spawns are unchanged.
  If a model fails to load the game logs it and stays procedural.

## Consequences
- Draw calls: one per model material plus the wet layer, so this zombie is 5 (procedural: 2).
  Measured in the actors sandbox (9 bodies, 5 of them the model): 194 calls vs 128, 3.7 ms vs
  3.2 ms per frame. Fine for the slice's crowd at share 0.5; revisit (atlas the textures) if a room
  ever holds 10+ model bodies.
- Licence: CC-BY-NC 4.0, so the game must stay free while it ships this model, and the credit
  must be shown (CREDITS.md). Before release, check the uploader's other work for game rips.

## Debug
- `?bodyModels=all` / `off` in the game forces every eligible spawn to the model / to procedural.
- Debug > Enemies > "spawn model shambler ahead".
- `/sandbox/actors.html?bodyModel=zombieWalk` puts the model on the sandbox crowd.

## Definition of done
- `bodyModel.test.ts`: joints placed and rest pose straight, every triangle kept, weights sum to 1,
  stumps on all 9 severable joints, a model humanoid takes head hits and loses a forearm.
- Seen in the sandbox: textured, shambling, limbs shot off with stumps and debris.

## Addendum: August Giles (Nov 18)
- August's body is the CC-BY "Mechanic 1" model (`mechanic` in `data/body-models.json`, `variants: []` so the
  crowd never picks it; `GILES.model` in `squadLooks.ts` selects it). Its exporter scrambled the bone names, so
  `scripts/fix-mechanic-glb.mjs` renames them (Mixamo-style) by node index before it ships.
- Imported bodies ignore `outfit`/`look`/`props`, so his beard, glasses and curly hair do not appear; the
  procedural look in `GILES` only applies if the model fails to load.

## Addendum: Dr. Okafor (Nov 18)
- Okafor's body is the CC-BY "doctor" model (`doctor` in `data/body-models.json`, `variants: []`; `OKAFOR.model` in
  `squadLooks.ts`): a Character Creator rig in purple scrubs. `scripts/fix-doctor-glb.mjs` renames its `CC_Base_*` bones,
  folds the scale-compensation helper nodes into the bones, rebuilds the inverse bind matrices from the node pose (35 of
  the source's 102 were identity), bakes its Z-up centimetre frame into Y-up metres, drops the baked animation, tangents
  and two unused UV sets, and re-encodes the 1024 px textures as JPEG (the normal map at 512). 19.7 MB -> about 0.6 MB,
  9,570 triangles.
- Like August, his procedural `look` (beard, stethoscope, glasses on head) is only the fallback if the model fails to load.

## Addendum: Priya Anand (Nov 18)
- Priya's body is the CC-BY "Modern Indian Woman" model (`priya` in `data/body-models.json`, `variants: []`; `model: 'priya'` on her
  `CAST` look in `castLooks.ts`): a rigged Mixamo-named avatar (~112k triangles across 14 meshes). `scripts/fix-priya-glb.mjs`
  drops the baked animation, tangents, unused UV/MR/AO maps, cornea meshes and opaque glasses lenses; merges eyeballs, teeth,
  and glasses frames + eyelashes; adds a `Jaw` bone under `Head` with lower-teeth and lower-lip/chin weights; decimates to
  ~16.7k triangles; and re-encodes textures as resized JPEGs. 20.6 MB -> about 1.2 MB.
- Her scrubs-and-cardigan `look` and props are the fallback only. The model is a different outfit from `docs/characters.md`.

## Addendum: Sung (Nov 18)
- Sung's body is the CC-BY "Construction Worker In Safety Gear" model (`sung` in `data/body-models.json`, `variants: []`; `model: 'sung'` on his `CAST` look in `castLooks.ts`). Like Priya's, it is an unrigged photogrammetry scan (~222k triangles across three chunks, 17 MB, wearing a hard hat, hi-vis vest and work gloves, with a rolled blueprint tube in the right hand).
- `scripts/fix-sung-glb.mjs` bakes its node transforms and `KHR_texture_transform` into Y-up metres facing +Z, welds the chunks by `(position, UV)`, trims the protruding ends of the blueprint tube outside the right glove, decimates to about 16k triangles, builds a 24-bone Mixamo-named skeleton with smooth skin weights and a jaw mask, and re-encodes the colour (1024 px) and normal (512 px) textures as JPEG (17 MB -> about 0.97 MB).
- His drysuit-and-harness `look` is the fallback only.

## Addendum: Katie Heins (Nov 18)
- Heins' body is the CC-BY "BS-V1 Cyborg" model by Blue Spirit (`heins` in `data/body-models.json`, `variants: []`; `model: 'heins'` on her `CAST`
  look in `castLooks.ts`): a cybernetic-armed woman in a dark jacket, an unrigged, unanimated A-pose mesh (~147k triangles, 10 materials, 35 PNGs, 35 MB).
  The file has no skeleton and no clips, so there was no baked animation to keep: the procedural animator drives it like every other body.
- `scripts/fix-heins-glb.mjs` bakes its Z-up root, merges the meshes per material, decimates each with its own budget (hair cards, face and
  hands get the largest share), builds a 24-bone Mixamo-named skeleton with smooth weights, adds a jaw (Head-material lower face and lower teeth only,
  so the high jacket collar does not follow it), drops emissive/metal-rough/specular maps, and re-encodes textures (the hair colour map stays a PNG
  because its strand cards are alpha-tested): 35 MB -> about 1.8 MB, ~24k triangles.
- Emissive circuitry on the arm and head is not rendered (the body shader has no emissive input). Her procedural look (security uniform) is the fallback only.
- The model's hair atlas (black roots, green tips) is recoloured by the script to a root-to-tip purple -> blue gradient, keeping the strand lines and
  alpha (`HAIR_GRADIENT`, default `#1c0a3d,#7a2fd0,#4f8cff`; `HAIR_GRADIENT=off` keeps the original green).

## Addendum: Director Hale (Nov 18)
- Hale's body is the CC-BY "A Man in suit" model by anuragk1229 (`hale` in `data/body-models.json`, `variants: []`; `model: 'hale'` on his `CAST`
  look in `castLooks.ts`). It is a rigged, unanimated T-pose avatar (~119k triangles, 11 meshes, 14 images, 15 MB) from the same exporter family as the old Priya model.
- `scripts/fix-hale-glb.mjs` clears the Sketchfab/FBX wrapper nodes, drops the end/eye bones, tangents, UV1 and the opaque cornea layers, adds a `Jaw` bone
  (lower lip/chin and lower teeth, ADR-0027), merges eyeballs and teeth, decimates (hair 4.5k, outfit 7k, head 3.4k, body 1.8k) and re-encodes textures as
  resized JPEGs: 15 MB -> about 1.1 MB, ~18k triangles.
- His procedural look (charcoal jacket, receding hair) is the fallback only.

## Addendum: Bram the cook (Nov 18)
- Bram's body (`bram` in `data/body-models.json`, `variants: []`; `model: 'bram'` on the `cook` `CAST` look in `castLooks.ts`, which `bram` aliases) is
  now the CC-BY "Chef T pose" model by Imran Aziz (bayharborbutcher), replacing his procedural body. It is an unrigged, unanimated T-pose scan
  (~551k triangles in 6 chunks, one material, 32 MB) in a cap, rolled-sleeve jacket and apron.
- `scripts/fix-bram-glb.mjs` (adapted from `fix-sung-glb.mjs`) bakes the wrapper nodes into Y-up metres facing +Z, welds the chunks, decimates to 16k
  triangles, builds a 24-bone Mixamo-named skeleton measured off the scan (arms along X) with smooth skin weights and a jaw mask, and re-encodes the colour
  (1024 px) and normal (512 px) textures as JPEG: 32 MB -> about 0.9 MB. The source is kept in `previews/chef_t_pose_src.glb`.
- His procedural kitchen-whites `look` is the fallback only.

## Addendum: Ines Ruiz (Nov 18)
- Ruiz's body is the CC-BY "Modern Service Technician" model by restore50 (`ruiz` in `data/body-models.json`, `variants: []`; `model: 'ruiz'` on her
  `CAST` look in `castLooks.ts`), replacing the procedural crew body. Same exporter as Sung's scan: unrigged, ~237k triangles across three chunks, 17 MB.
  It is a man in a vest and tie caught mid-stride (right leg planted, left leg trailing with the heel raised, left forearm raised holding a phone).
- `scripts/fix-ruiz-glb.mjs` is Sung's pipeline with this scan's skeleton: bakes transforms and `KHR_texture_transform`, welds the chunks, decimates to
  16k triangles, builds a 24-bone Mixamo-named skeleton and smooth skin weights with a jaw mask, and re-encodes the textures as JPEG (17 MB -> 0.91 MB).
  Both legs are measured to the same length so the feet land level once `bodyModel.ts` straightens them (ankles 1 mm apart; the trailing shoe still sits ~2 cm high).
- Her crew-blues `look` is the fallback only. The model's gender and outfit differ from `docs/characters.md`; the phone stays in her straightened left hand.
  The source is kept in `previews/modern_service_technician_src.glb`.

## Addendum: botanist crew bodies (Nov 18)
- The generic `botanist` crew look (`CREW` in `castLooks.ts`) now uses three CC-BY Half-Life-style scientist models (`botanist1`..`botanist3` in `data/body-models.json`, `variants: []`;
  `public/assets/models/crew/`): Geont's "scientist", "source scientist" and Scientist Broken's "Scientist". `castSpec` picks one per NPC id (`CREW_MODELS`, FNV-1a hash), so a botanist keeps the same body everywhere.
- All three are rigged ValveBiped avatars of ~5k triangles. `scripts/fix-scientist-glb.mjs` renames the bones to Mixamo-style names, drops the baked clip, tangents, UV1/UV2 and metallic-roughness maps
  (and the head normal map of "source scientist", which needs UV1), skins the loose glasses of "Scientist" to the Head bone, repacks the vertex buffers and re-encodes textures as JPEG: 3.2 / 1.8 / 7.3 MB -> 0.51 / 0.46 / 0.58 MB.
- Their procedural look (rolled olive coveralls) is the fallback only. Other crew looks (diver, exec, ...) stay procedural.

## Addendum: admin assistant (Nov 18)
- The generic `assistant` crew look (`CREW_MODELS` in `castLooks.ts`) now uses the CC-BY "Lady in a trenchcoat" model (`assistant` in `data/body-models.json`,
  `public/assets/models/crew/assistant.glb`). `scripts/fix-trenchcoat-glb.mjs` drops the file's duplicate second copy and re-encodes textures (hair/eyelash sheet stays PNG so its alpha cut-out survives). It has no jaw bone, so she does not mouth her lines yet.

## Amendment (Nov 18): no procedural crowd bodies
The crowd now rolls through three models in table order (`data/body-models.json`): Zombie Walk 1/3, then Zombie Monster Slasher Necromorph 1/2 of the rest, then the Zombie game character (the remainder), so every shambler and play-dead body is a model (a third each). The game character's right arm is mostly missing in the source. Costs: 5 draw calls per model body against 2 procedural. A procedural crowd is still reachable with `?bodyModels=off`.

## Addendum: Okafor and Ruiz re-cast (Nov 20)
- Justin replaced both bodies: Okafor should read as a wise Black doctor, and Ruiz (the first crew member through the intro, with a
  woman's voice) should be a woman. Both new bodies are CC-BY scans by restore50 (the uploader of Sung's scan), same exporter: unrigged,
  3-4 chunks fused into one shell, 5 identical UV sets, a fragmented texture atlas.
- **Shared pipeline.** `scripts/lib/scan-body.mjs` now holds the steps the per-scan scripts used to copy: bake + weld, texture-colour
  sampling (ImageMagick), triangle cuts with hole caps, island cleanup, region rotation, decimation, distance-field skinning with a jaw
  mask, and packing. It packs like the gltf-transform output of the other bodies (EXT_meshopt_compression, KHR_mesh_quantization for
  normals/UVs, EXT_texture_webp) using `meshoptimizer`'s encoder, so no external tool is needed.
- **Decimation by region and error bound.** A single triangle target spent the budget on hair and collapsed smooth skin into a few big
  facets. `decimate()` now simplifies regions separately (borders locked) to a relative error bound: about 1 mm on heads and hands,
  3 mm on shoes, 5 mm elsewhere. These atlases are fragmented (Ruiz: 68k UV-seam edges), so seams, not the error bound, set the floor:
  Ruiz is ~41k triangles and Okafor ~29k, above the 16k of earlier scans. Ruiz's body is in the generic `crew`/`engineer` pools
  (`CREW_MODELS`), so a room of crew can include it.
- **Okafor** (`doctor` slot, `scripts/fix-okafor-glb.mjs`, "White Coat Physician with Stethoscope"): shaved head, light-blue scrubs,
  long white lab coat, stethoscope. The head was yawed 26° to his left (face symmetry plane); the script turns it back 13°, not 26°,
  because the eyes are painted looking at the scanner and a full correction leaves him side-eyeing. Collar and stethoscope behind the
  neck are held still. The raised left forearm is fused to the coat front, so colour- and capsule-based rules give the sleeve to the
  forearm and the panel behind it to the torso; a few stretched triangles remain where they were joined. The coat skirt (white cloth
  away from the trouser legs, y 0.66-1.0 m) is blended half-way toward the hips so it swings less than the legs. To keep the main-cast
  hand rig (`handRig: true`), the skeleton carries 30 finger bones (measured off the scan: left hand fanned and pointing, right hand
  hanging, fingers mostly fused) and a forearm-twist bone per arm, all unweighted: `bodyModel.ts` auto-skins the fingers. 19 MB -> 0.7 MB.
- Okafor's raised left hand was scanned with its fingers bent 25-65° at the knuckles, across his body. The rig curls fingers but cannot
  open a bend baked into the mesh (and the bend tilted every calibrated curl axis), so the script fits each finger's centreline from its
  own vertices and swings index..pinky about the knuckle to lie along the hand's axis, keeping 15% of the bend: a relaxed open hand.
- `bodyModel.ts`'s finger auto-skin fallback dropped a share under 1% at the knuckle without renormalising (a vertex could sum to
  0.991); it now renormalises. Okafor's was the first hand to hit that case.
- **Ruiz** (`ruiz` slot, `scripts/fix-ruiz-glb.mjs` rewritten, "Blue Overalls Technician"): long curly dark hair, navy coveralls and a
  tool belt, mid-stride, carrying an ~80 cm toolbox. The box, its handle posts and the grip ends poking out of her fist are cut by region +
  texture colour; the openings are capped with a flat patch of the neighbouring cloth or skin texel. Below the hip joint the cloth is
  biased onto the thighs so straightening the stride leaves no bulge, and the trailing ankle sits along the shin so both legs measure
  0.871 m and the feet land level. 26 MB -> 0.8 MB.
- The previous sources (Chenchanchong "doctor", restore50 "Modern Service Technician") are retired, and so is
  `scripts/fix-doctor-glb.mjs`. The new sources are kept (gitignored) in `previews/sources/`.
- Fallback looks (`OKAFOR` in `squadLooks.ts`, `ruiz` in `castLooks.ts`) now follow the scans: Okafor deep brown and clean-shaven without
  the glasses on his head; Ruiz with curly hair and navy coveralls.

## Addendum: scan-body skinning fixes (Nov 20, openspec `fix-scan-body-skinning`)
- Requirements now live in `openspec/specs/imported-body-models` (in the change until it is archived). Okafor's and Ruiz's arms
  dragged a band of coat with them, and their mouths smeared when the head turned.
- **Neck and lower face.** Capsules alone let the wide chest capsule win up to the chin (the neck joint owned 0.1% of the skin), so
  `skinScan` takes a `neck` option, applied after smoothing and before the jaw mask:
  `{ collarY, jawLineY, axis: [x, z], radius, margin, faceRadius, include(rgb) }`, measured per scan in the source frame.
  - Neck column (horizontal distance to `axis` below `radius`, above `collarY`, where `include` holds): neck -> head gradient from
    `collarY` to `jawLineY`, nothing else.
  - Lower face (2.5 cm or more in front of the axis, within `faceRadius`, above `jawLineY - margin`, outside the column, any colour,
    because lips and mouth shadows fail a skin test): head only, then the jaw mask moves the mouth and chin onto the jaw.
  - `include` keeps what sits next to the neck on the chest: Okafor's is "skin" (his coat collar and stethoscope stay put); Ruiz's
    is "not navy" (her throat and the hair beside it turn with the head, the coverall collar does not). Both rules blend in over
    1-2 cm.
  - Okafor: collar 1.58, jaw line 1.66, axis (-0.033, -0.04), radius 0.075, margin 0.03, face radius 0.17.
    Ruiz: collar 1.52, jaw line 1.635, axis (0.045, -0.005), radius 0.065, margin 0.015, face radius 0.17.
  - `bodyModel.test.ts` checks it per scan body: no chest or spine weight in the neck column, and the mouth and chin at least 97%
    head and jaw.
  - Hair on the shoulders still follows the chest (out of scope).
- **Arms cut off the torso below the armpit.** The scans are one closed shell where an arm touched the body, so smoothing blended
  a band of coat into each sleeve. Three shared steps in `scripts/lib/scan-body.mjs`, run after decimation:
  - `labelArms(body, { J, BONES, color, adjust, override })` labels each triangle body / left arm / right arm from the capsule
    scores, cleans up by majority vote, keeps the hand-connected arm component and absorbs stray body islands.
    `override(x, y, z, rgb)` forces a label (0 body, 1 left, 2 right) where the scores get it wrong.
  - `splitArms(body, labels, { armpitY: { Left, Right }, torsoAxis, J, pick, bulge, blend, band })` duplicates the vertices arm
    and body triangles share below `armpitY` (source frame) and caps both sides. The body's cap stays in view once `bodyModel`
    straightens the arm away from it, so it is a membrane (`membraneCap`): a zipper across the opening with interior points every
    2 cm, Delaunay flips and relaxation in cylindrical coordinates about the torso axis (a bare zipper read as a fan of splinters).
    Within `band` (default 4 cm) of the cut and over the cap, the torso's radius is relaxed toward an ellipse fitted to the torso
    per height plus a harmonic correction (at most 2.5 cm out), so the crease the arm pressed in fills out instead of leaving a
    dent; normals there are recomputed. `bulge` pushes the cap out further by that fraction of each point's distance to the rim
    (default 0). The arm's cap folds each rim vertex onto the arm's bone axis (a 5 mm grid shared by both sides, so it is
    watertight and every point rides on its own bone). `pick(rim, centre)` chooses the one rim texel a cap is painted with. `blend`
    (default 4 cm) is the band under each armpit where the skin mask eases into the shoulder blend.
  - `skinScan({ ..., arms })` masks weights below the armpit: arm vertices use only their arm's chain (upper arm, forearm, every
    hand bone), body vertices none of it. Smoothing ignores the arm caps (they would pull the armpit corner onto the bone axis).
  - Ruiz: armpit 1.35 both sides, `blend` 6 cm; tool-belt pouches stay on the body (`override`: between y 0.84 and 1.12, anything
    over 7 cm off the forearm/hand axis, or over 4.5 cm off it and neither navy nor skin); caps painted navy (skin at a hand).
    (Okafor went through the same steps until he was re-cast to a rigged model, below.)
  - `bodyModel.test.ts` checks it per scan body (now Ruiz) with the upper arms raised 30°: no mixed arm/body vertex below the armpit line
    (13 cm under `upperArm_*`), at most 3% mixed triangles, no torso vertex moving, no edge of 3 mm or more past 2.5x, and no
    open edge round the arms over 5 mm. `src/actors/scanBody.test.ts` covers the split, caps and mask on a synthetic box.
  - `previews/scan-pose.py <glb>...` (gitignored dev script) renders rest, 30° raise, mixed weights, stretch, look-at turns and
    an open jaw per GLB; `previews/zrender.py` renders one view with a depth buffer, per-pixel texture and optional joint turns
    (`foreArm_L:x:80`), which shows slivers and fins as the game does.

## Addendum: Okafor re-cast to a rigged model (Nov 20)
- Even with the split, Okafor's scan read as splintered: his left forearm was scanned across his coat, so straightening it leaves a
  torso-sized opening and a crumpled elbow. Justin chose BrushDip's "Doctor - Sketchfab Weekly - 13 Mar'23" (CC BY 4.0) instead:
  hand-modelled and rigged (3ds Max Biped, 33 joints), arms modelled apart from the body, grey hair and beard, round glasses, lab
  coat over a blue shirt and tie. Okafor keeps his name (Justin: the surname can be his husband's, to be worked into the story).
- `scripts/fix-doctor-glb.mjs` (the name of the retired Character Creator script, reused) builds `doctor.glb`; the scan script
  `scripts/fix-okafor-glb.mjs` is retired. It keeps the artist's skin weights and does no decimation (12.6k triangles):
  - bakes the bind pose from the inverse bind matrices (the node pose is the clipboard animation's) through Sketchfab's wrapper into
    metres, facing +Z, feet at 0, 1.80 m tall, and renames the Biped bones to the Mixamo names (`Clavicle` -> `Shoulder`,
    `Calf` -> `Leg`, `Toe0` -> `ToeBase`; the root, `Bip001` and the prop dummies fold into Hips and the hands);
  - adds a Jaw bone (hinge 1.592 m) and weights the lower lip, chin and beard below the mouth line (1.601 m) to it;
  - replaces the mitten fingers (one bone for all four) with thumb..pinky chains: the four fingers are split along the palm's width
    by 1D k-means and reassigned to the nearest fitted centreline twice, and each chain is the centroid of slices along its finger.
    The fingers are modelled bent 40-70° at the knuckles around the clipboard, which tilted the calibrated curl axes (the hand rig
    test caught the right index curling outward), so each finger is swung toward the hand's axis keeping 20% of the bend. The chains
    are unweighted; `bodyModel.ts` auto-skins the fingers as for the scans. A forearm-twist bone per arm as before.
  - drops the glasses' lenses (a transmission material the game does not render), the clipboard and the pen (unskinned props on the
    hand dummies);
  - packs the body (1024 px) and head (512 px) texture sets side by side into one 1536x1024 atlas at full resolution, WebP q95,
    moving tiled UVs (mirrored shoe and hand, buttons) into [0, 1] per triangle; the material stays double-sided, as in the source,
    because the lapels, hem and cuffs are single sheets (`packBody` gained a `doubleSided` option). 3.7 MB -> 0.57 MB.
- The source's one animation (3.4 s, writing on the clipboard) is not used: bodies are animated by the shared retargeted clip
  library, not their own clips.
- Okafor is no longer a scan body: `bodyModel.test.ts` keeps the neck rule check on him and runs the arm-separation checks on Ruiz
  only (the artist's shoulder blend covers 3.5% of triangles, above the scan limit of 3%, by design).
- Fallback look (`OKAFOR` in `squadLooks.ts`) follows the model: grey hair and beard, glasses.
