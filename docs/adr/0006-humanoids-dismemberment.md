# ADR-0006: Humanoid bodies and dismemberment

Status: Accepted (dismemberment) / Proposed (rules and numbers)

## Context
Strategic dismemberment is the core combat mechanic [Decided]. Enemies are slow infected
humanoids [Decided]; one plays dead [Decided]. Set pieces show people transforming and
being killed behind glass [Decided]. Everything starts procedural [Decided].

## Decision
One shared `buildHumanoid(spec)` builds segmented rigid-part bodies for crew, squadmates,
corpses and infected. Parts are joints in a hierarchy, animated procedurally, and each
severable part has its own HP.

## Details

### Body structure
```
pelvis -> spine -> chest -> neck -> head
chest -> shoulder_L -> upperArm_L -> foreArm_L -> hand_L   (and _R)
pelvis -> thigh_L -> shin_L -> foot_L                       (and _R)
```
- Each joint is an `Object3D`; each part a mesh with its own geometry (lathe/capsule
  segments, displaced with seeded noise). Clothing layers are separate meshes (suit, vest,
  lab coat panels).
- `spec` controls: height, build, outfit (`security`, `engineer`, `medic`, `lab`, `crew`),
  infection stage 0-3 (0 = human; 3 = swollen growths, split skin, exposed bone, elongated
  fingers), seed.
- Infected geometry adds growth meshes (noise-displaced spheres) at shoulders, jaw, spine.
- Triangle target: 6-10k per humanoid. LOD: drop growths and smooth segments beyond 15 m.

### Animation
- Procedural: gait cycle (phase-driven legs, counter-swinging arms, pelvis sway), shambler
  limp variants (seeded asymmetry), look-at for head/neck, simple two-bone IK for feet on
  floor and hands on targets (consoles, door panels), additive hit reactions.
- Pose library in `data/poses.json`: idle, typing, crouch-working, slumped corpse variants,
  dragging, writhing, get-up keyframes. Interpolated with quaternion slerp.

### Hitboxes
- One capsule per part (pre-computed radius and length). Ray vs capsule is analytic and
  fast; no mesh raycasts.

### Damage rules [Decided]
| Part | HP (x enemy base) | Damage taken multiplier |
|---|---|---|
| Upper arm, forearm | 0.30 each | 1.0 |
| Thigh, shin | 0.35 each | 1.0 |
| Head | 0.25 | 1.0 |
| Torso (chest + pelvis) | 2.0 | 0.5 |
- Base HP: shambler 100 (scaled by difficulty).
- Severing a part detaches it and everything below it (shooting a thigh removes the leg).
- **Death:** 3 limbs severed (head counts), or torso HP depleted. Torso shooting works but
  costs about 3x the ammo, so dismemberment is the efficient path.
- **Effects of losing parts:**
  - One leg: falls, then crawls at 55% speed, low profile (harder to hit), still grabs.
  - Both legs: drags with arms at 40% speed.
  - One arm: grab damage -40%, cannot grab with that side.
  - Both arms: can't grab, only lunges to bite (short range, low damage).
  - Head: does **not** kill. Becomes blind: flails, tracks sound only, wanders.
    This is the "Dead Space twist" that teaches limbs over heads.

### Severing
- The detached chain becomes debris: simple rigid-body integration (velocity, gravity,
  angular velocity, floor bounce with friction, sleep after 3 s). Max 24 active debris,
  oldest fade out.
- Stump: cap mesh at the joint (dark red/black, bone stub), fluid particle spurt for 1.5 s,
  floor decal.
- Gore setting: **Full** (default) or **Reduced** (no detached parts; limbs go limp and
  darken; dark fluid only). [Assumed]

### Transformation set pieces
- Infection stage can be animated over time for a scripted body (0 -> 3 over ~6 s):
  growth meshes scale in, skin material lerps, limbs elongate via joint scale, plus
  convulsion procedural noise on joints. Used for the lab scene and the final engineer
  reveal.

## Consequences
- Rigid segments are easy to sever but can look stiff at joints; mitigated by overlapping
  joint "sleeves" and clothing.
- GLB swap later: pre-split models per part, same joint names, so the system is unchanged.

## Alternatives rejected
- Skinned meshes with runtime mesh cutting: much harder, slow to iterate, no artist yet.
- Ragdoll physics library (cannon-es/rapier): new dependency and tuning cost; simple debris
  is enough for the slice.

## Execution steps
1. `buildHumanoid` with outfits and seeds; pose library and gait.
2. Capsule hitboxes + debug draw.
3. Part HP, severing, debris, stumps, decals, gore setting.
4. Locomotion states for missing limbs.
5. Infection stage animation.

## Definition of done
- In a test room, shooting each part produces the correct sever and behaviour change.
- 8 humanoids animating at once keeps the M2 at 60 fps on Medium.

## Open questions
- None blocking.

## Progress
Implemented on 2026-11-15; **pending the on-device performance check** below.

- Code: `src/actors/` (`humanoid.ts` entry point; `skeleton`, `bodyGeometry`, `bodyMaterial`,
  `animator`, `poses`, `ik`, `capsule`, `damage`, `gore`), pose data in `src/data/poses.json`
  (validated by `src/data/types/poses.ts`).
- Test room: `npm run dev`, then open `/sandbox/actors.html` (add `?debug` for stats/GUI,
  `?nopost` to skip post-processing). Kept out of `main.ts` on purpose. Mouse shoots, 1/2
  pistol/shotgun, H hitboxes, G gore Full/Reduced, T transforms the engineer, R resets.
- Implementation note [Assumed]: the rigid parts are merged into one skinned mesh per material
  with weight-1 skinning (each vertex follows exactly one joint), so a body is 2 draw calls
  instead of ~30 (the 300 draw-call budget can't absorb 10 x 30). Joints are still named
  `THREE.Bone`s, so the GLB part-swap plan is unchanged. Severing collapses the joint's bone
  and spawns a separate debris mesh.
- Verified: 23 unit tests (damage table, sever chains, locomotion rules, death by limbs/torso,
  ray-capsule, 6-10k triangle budget for every outfit, pose data); headless browser run of the
  test room: sever of every part type, crawl/drag/blind/bite-only states, death poses, Reduced
  gore, play-dead get-up sequence, typing/crouch IK, infection 0 -> 3 transformation, debris
  settling flat, pools and spurts. 8 bodies: ~9.2k triangles each, ~35 draw calls for the whole
  room, animation + IK about 0.16 ms per frame on CPU.
- Not yet verified: 60 fps on the M2 at Medium (needs Justin's machine).
- Known gaps: no wall collision for debris (floor only, until ADR-0003 collision is wired in);
  the LOD drops growths and shadows beyond 15 m but does not swap to smoother segments; the
  gore mode is a `GoreSystem.mode` field until ADR-0012 adds the setting; base HP takes a plain
  number, and ADR-0008 supplies the difficulty multiplier.

### Progress: gore pass and hero tier

Crowd tier (10–13.5k triangles each, up to ~24 on screen):
- Jaw joint, wet/crusted/meat body shader, infected motion (head snaps, spasms, stumbling, lunge, death twitch), tendrils, exposed ribs, instanced gore chunks, blood trails.
- Triangle budget per crowd body is now 8–15k (was ~3–4k).

Hero tier (`spec.hero`, ~60k triangles each, 2–3 on screen, tough and slow):
- `src/actors/heroSculpt.ts`: sculpted muscle (pecs, abs, delts, biceps, quads, calves), wound craters with raised crusted rims, wet muscle-fibre shading (negative `aRot` means wet), scar ridges, shirt/trouser rags painted on the body, cloth strips for coat tails, lapels, collar, tie and sleeve rags.
- High-resolution gaunt head (hollow cheeks, brow, sockets), fangs, smaller eyes, jaw baked slightly open.
- `hulk` pose in `poses.json`. Sandbox `?rim` adds key and rim lights for judging the sculpt.

Hero face (neck and hunch): hero bodies carry per-body joint offsets (`BodyGeometry.jointOffsets`), so the head joint sits 7 cm higher than the shared skeleton's (`HERO_NECK_EXTRA` in `skeleton.ts`). The hero neck mesh is longer and thicker at the base with tendon cords, and the root scale is adjusted so the hero keeps its requested height. The `hulk` pose has a shallower hunch (spine -12, chest -6) with the head tilted up to compensate. Angles are untested by eye; tune them in `poses.json` from the sandbox.

Body separation: see ADR-0018 (`src/actors/separation.ts`, applied in the sandbox; `?nosep` compares).

Known gaps: coat reads as flat strips; hero has no gait or attack of its own; cloth does not sway; 60 fps on the M2 not measured; face visibility after the neck change needs a visual check.
