# Design

## Context

See proposal.md (Why). Measured on today's asset (2026-11-26):

| Check | Today | Limit |
|---|---|---|
| Vertices the neck bone moves most, of 21,959 | 0 | |
| Neck-column vertices carrying chest or spine weight | 72 of 938 | 0 |
| Lower-face vertices leaning on joints other than head and jaw | 739 of 779 | 0 |
| Arm/torso blended vertices below the armpit | 105 | 0 |
| Triangles blending arm and torso | 4.0% | 3% |
| Cyber arm vertices shared between joints (under 90% on one) | 63% | |
| Torso vertices the arm test samples | 202 | 500 or more |
| Worst edge stretch, arms raised 30° | 4.15x | 2.5x |
| Open edges over 5 mm near the arms, at rest (edges of separate pieces) | 159 | |

Under a simulated look-at turn (head 22°, neck 8°), computed from the asset's bind pose with the chest held still, her
nose trails a rigid head by 11 mm on average (up to 26 mm), her mouth by 12 mm (up to 24 mm), her forehead by 3 mm and
her chin by under 1 mm. The cause is `scripts/fix-heins-glb.mjs`: it scores bones by distance divided by radius, with
0.23 m for the chest (`Spine1`) and 0.07 m for the neck, and has no neck rule. Bram had the same fault
(`openspec/changes/archive/2026-11-26-fix-bram-rig`).

The sources, both CC BY 4.0 from the page already in `CREDITS.md`:

- `bs-v1_cyborg.glb`, 339 MB: the same geometry the script was written for (16 meshes, 10 materials, 35 textures,
  147k triangles, no skin, no morph targets), with 4096 px textures.
- The OBJ inside `BS-V1 Cyber female Character .zip`, 11 MB: the same vertices (every GLB vertex matches one, as
  `(x, z, -y)` in the GLB's mesh space), 95% quads, no `.mtl`.

What the OBJ shows:

- Its face groups carry bone names in an Unreal-style scheme (`spine_01`-`spine_04`, `neck_01`, `neck_02`,
  `upperarm_twist_01_l`, finger and metacarpal joints). They read as each face's main bone in the artist's own rig;
  that is an inference, supported by their positions. Coverage: body, jacket and shoes ~100%, shirt 99%, head 96%,
  cyber arm 53%, cyber hand 9%, and none on hair, eyes, teeth or the mouth interior.
- Some labels are odd: jacket collar faces are labelled `head` and `neck_02`.
- The head is one surface with four openings: mouth (a 40-vertex rim), the two eyes (18 vertices each) and the neck.
  The eyeballs are two separate closed shapes.
- The jacket is one connected surface, and 60 edges below the armpit join an arm-labelled face to a torso-labelled one.
- The cyber arm and hand are 150 separate pieces: 15 labelled with one limb segment, 31 with several, 104 unlabelled.

`keep-crossed-arms` lands first. It gives her crossed-arm resting pose its own head-only gestures, keeps her wrists
anchored through them, and tests on her body that each wrist stays within 3 cm of where it would be without the gesture.
New weights and joints must keep those checks passing.

## Goals / Non-Goals

**Goals:**
- Heins meets every existing `imported-body-models` requirement, checked by the same tests as other scan bodies.
- A rebuild from the two source files reproduces the committed asset.
- Nothing is thrown away that eye or blink work would later need.

**Non-Goals:**
- Eye or lid bones, lip shapes, morph targets.
- Changes to `bodyModel.ts`, the animator or the shared 21-joint skeleton.
- Changing any other body's asset.

## Decisions

### D1. Both files, copied into `previews/hein_src/`

The GLB supplies geometry, UVs, materials and textures; the OBJ supplies labels and the original polygons. The script
becomes `node scripts/fix-heins-glb.mjs <source.glb> <source.obj> [out.glb]`, with the OBJ extracted from the zip.
`previews/` is gitignored, so the sources exist only on this machine, as with Bram's.

Alternative considered: commit the extracted labels as a data file. The rebuild still needs the GLB, so it buys little.

### D2. Keep her own build script

`scan-body.mjs`'s packer writes one material with one colour and one normal texture. Heins has ten materials, so moving
her onto that pipeline would mean building a texture atlas. Her script stays, and borrows `applyNeckRule` and
`splitArms`, which `scan-body.mjs` already exports. `splitArms` works on one mesh with a label per triangle, and her
script keeps one mesh per material. It runs on each material mesh where arm and torso faces share edges: the jacket (see
Context), plus the shirt or body skin if they turn out to have such edges.

### D3. Prove the baseline first

Run today's script unchanged on the new GLB and compare with the committed asset (bones, joint positions, triangles per
material, weights). Everything after is measured against that build, since decimation may not repeat exactly.

Result (2026-11-26, task 1.3): the same 54 bones in the same order. Every trunk, limb, foot and jaw joint is identical;
only finger joints differ, by 2-22 mm (`LeftHandMiddle1` most), because the hand rig fits them to the decimated hand
mesh. Triangles per material match within 0.6%, except the cyber hand: 1,941 here against 3,709 committed (the
simplifier stops short of its 1,500 budget at a high error, so the stopping point is not stable). Dominant-bone shares
per mesh match within 2 points, except the shoes (foot against calf, up to 3 points) and the body skin's left pinky
(2.5 points). File 1,668 KB against 1,881 KB committed. The source geometry is therefore the one the asset was built
from; the differences come from decimation, which D9 removes.

### D4. Labels gate the weights

Labels move to GLB vertices by position (with no decimation, D9, every GLB vertex keeps its own). Bone names map onto
her skeleton: `pelvis` to Hips; `spine_01`-`02` to Spine; `spine_03`-`04` to Spine1;
`neck_*` to Neck; `head` to Head; `clavicle` to Shoulder; upper arm, forearm, thigh and calf with their twists to
their bones; hand and metacarpals to Hand; finger joints to the finger chains; `foot` and `ball` to Foot and ToeBase.

A labelled vertex may take weight only from its labelled bones and their direct parent and child. Capsule scores and
smoothing run inside that gate, so the chest cannot reach the face again. Unlabelled vertices follow their material:
hair, eyes and the upper mouth to the head; unlabelled cyber parts by D7.

Alternatives considered: use labels as the weights directly (hard creases at every joint); keep capsule weights and
only patch the face, as Bram's fix did (leaves the jacket, arm and joint guesses as they are).

### D5. Neck, collar and face rules on top

The shared neck rule runs after smoothing: the neck column blends from neck to head, and the face in front of it is head
only. The jacket collar, whatever its label says, blends from chest at its base to neck at its top and takes no head
weight, as on Bram.

### D6. Jaw from the mouth opening

The lip rim splits into an upper and a lower half. The lower lip, chin and jaw line go to the jaw with a ramp to the
head toward the jaw hinge; the upper lip stays on the head. The mouth interior and teeth split the same way. This
replaces today's mask by height, which gives the jaw only a third of the band at the mouth line.

### D7. Rigid cyber arm and hand

Each connected piece is weighted wholly to one bone: the one its labels agree on, or else the bone segment nearest its
middle. A piece that spans a joint along its length (a cable or piston) blends only within the elbow or wrist band. The
cyber fingers take the finger bones the shared hand rig places.

### D8. Joints from label boundaries

For each joint, the middle of the ring where the parent's and child's labels meet is compared with today's hand-measured
position. A joint moves where they differ by more than 2 cm and the new position reads better in the sandbox. Where the
boundary is not a clean ring, today's position stays.

### D9. Full source detail

Heins is kept at full fidelity (user decision, 2026-11-26): the script's own size budgets go, and only the app's real
limits stay.

- No decimation on any part: about 147k triangles, from about 24k today. The head keeps its eyelid and lip rims and the
  eyeballs stay two whole shells.
- A mesh over 65,535 vertices is written with 32-bit indices. The 16-bit cap was only the script's packing;
  `bodyModel.ts` already switches to 32-bit indices for larger meshes.
- Every kept texture stays at its source resolution, up to 4096 px.
- Kept as real limits: four bone weights per vertex (three.js skinning), `MAX_BONES = 96` in `bodyMaterial.ts`, and body
  materials sampling only a colour and a normal map. Her metallic, roughness and emissive maps would need runtime code
  and texture units that High's heaviest lit materials already use up; that is a later change.

The cost: the game cannot load GPU-compressed textures (`gltf.ts` sets up only the mesh decoder), so each 4096 px texture
takes about 89 MB of GPU memory with mipmaps, and her 17 textures up to about 1.5 GB while she is loaded (estimate). The
GLB grows to tens of MB. The desktop GPU has 24 GB, so this is a cost, not a block. `runtime-memory` asks for it to be
measured and the reason given when it rises more than 15%; task 4.2 measures it and records it here.

### D10. The arm test counts only openings that posing creates

The shared arm test welds vertices by their posed position and fails on any edge over 5 mm that belongs to only one
triangle near the arms. Her body is layered open pieces, so 159 such edges exist at rest and no weighting can close
them. The check changes to count only edges that are open when the arms rise but were closed at rest: exactly the
openings an uncapped cut or a torn seam makes. This applies to every body on the list; Ruiz has no open edges either way.
The 500 torso-vertex floor stays, since her undecimated torso passes it.

Alternative considered: give Heins her own copy of the test. Rejected because the two copies would drift apart.

## Risks / Trade-offs

- [Wrong labels put weight on the wrong bone] -> Gate with parent and child, override the collar, and check every pose
  in the cast motion sandbox.
- [Splitting the jacket along the artist's labels opens a visible slit or cuts a flap off the side] -> Cap both sides as
  scan bodies do; inspect under raised and crossed arms; move the seam by override where it reads wrong.
- [Moved joints shift crossed arms, hand placement or foot contact] -> Re-run her pose and motion tests, and change a
  joint only with a reason (D8).
- [Rigid parts open gaps at the elbow or wrist when bent] -> Check at 90° and full bend; widen the blend for the pieces
  that bridge a joint.
- [Full-detail textures cost up to about 1.5 GB of GPU memory and lengthen her load] -> Measure in a scratch session
  (task 4.2) and record it. A lower quality tier can downsize her textures later without changing High.
- [The sources exist on one machine] -> Document the download page and file names in the script header.
- [Shared checkout: other agents edit these files] -> Re-read before editing and commit only this change's hunks.

## Migration Plan

Commit the regenerated asset with the script and tests. Reverting that commit restores today's Heins; nothing else
depends on her weights.
