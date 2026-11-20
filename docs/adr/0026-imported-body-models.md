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
