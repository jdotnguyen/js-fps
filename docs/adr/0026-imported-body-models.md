# ADR-0026: Imported body models for the crowd

Status: Accepted (Nov 18)

## Context
Bodies are procedural (ADR-0006), with the plan from the start that real models could replace
pieces later. Justin found a rigged, textured zombie on Sketchfab ("Zombie Walk", CC-BY-NC) and
wants it as a **common infected**, not as a hero/elite [Decided]. Heroes stay procedural
(sculpted, ADR-0021).

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
- Priya's body is the CC-BY "Mujer 2 con bolsa" model (`priya` in `data/body-models.json`, `variants: []`; `model: 'priya'` on her
  `CAST` look in `castLooks.ts`). Unlike the other two it is **not rigged**: a photogrammetry-style scan of a woman in an olive jacket,
  denim shorts and trainers, about 668k triangles in seven chunks, in a walking pose with a shopping bag in one hand.
  `scripts/fix-priya-glb.mjs` bakes its node transforms into Y-up metres facing +Z, drops the bag, welds the chunks, merges vertices
  on a 2 cm grid (the scan's non-manifold fuzz locks meshoptimizer's simplifier at ~45k triangles otherwise), decimates to about 14k
  triangles, and builds a 23-bone Mixamo-named skeleton from joint positions measured off the scan (the `J` table in the script).
  Skin weights are a softmax over distance to each bone segment divided by the bone's radius, smoothed over the mesh. The texture is
  re-encoded as a 1024 px JPEG. 24 MB -> about 0.9 MB.
- `bodyModel.ts` straightens her stride and arms from those bones like any rigged model, but the weights are automatic: arms and legs
  bend where the bones are, and the jacket sleeves share the torso mesh, so big arm swings can drag the jacket.
- Her scrubs-and-cardigan `look` and props are the fallback only. The model is a different outfit from `docs/characters.md`.

