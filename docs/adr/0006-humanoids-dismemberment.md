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
