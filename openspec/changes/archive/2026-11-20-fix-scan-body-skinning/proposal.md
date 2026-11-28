# Proposal

## Why

Okafor and Ruiz now use unrigged scans skinned by `scripts/lib/scan-body.mjs`, and both break as soon as they move. Their arms drag a band of coat or coveralls with them, and their mouths smear sideways when they turn their heads. The scans fuse each arm to the torso (one shared surface, no inner sleeve or coat side), and the skinning blends arm and body weights across that surface: 10.7% of Okafor's triangles and 4.2% of Ruiz's carry mixed weights. The neck joint owns almost none of the skin (0.1%), so the chest holds the chin and mouth corners while the head turns away from them. Both characters are in the intro, close to the camera, in poses that move the arms a lot (`lean_back`, `lean_back_mug`, `idle_hips`, `talk_gesture`, walking) and with look-at head turns.

## What Changes

- The scan pipeline separates each arm from the torso. It finds the seam where the sleeve meets the body, splits the shared surface along it, and caps both openings (the arm's inner side and the torso's side) with a flat patch of the neighbouring cloth texel. After the split, no triangle joins an arm to the torso, and arm and body weights do not blend below the shoulder.
- The scan pipeline gives the neck joint the skin between the collar and the underside of the jaw. Chest and spine weights stop at the collar. The lower face (mouth, chin, jaw line) is weighted to the head and jaw only.
- `doctor.glb` (Okafor) and `ruiz.glb` are rebuilt with both fixes. (During implementation Okafor was re-cast to a rigged model instead; see ADR-0026.)
- New tests check scan bodies for arm/torso separation and neck ownership, so a rebuilt body cannot quietly regress.
- Out of scope: Sung's, Heins's and Bram's bodies. They come from their own older scripts, and porting them to the shared pipeline is a follow-up change. Also out of scope: limiting arm motion in the animator, and the generic crew pools that borrow named bodies.

## Capabilities

### New Capabilities
- `imported-body-models`: how an imported character model becomes a skinned game body (ADR-0026). This change adds the requirements for scan-derived bodies: limbs separable from the torso, and neck, head and jaw ownership of the face and neck.

### Modified Capabilities
- None (no specs exist yet).

## Impact

- Code: `scripts/lib/scan-body.mjs` (new arm-seam split and cap step, neck and face weighting rules), `scripts/fix-okafor-glb.mjs` and `scripts/fix-ruiz-glb.mjs` (per-scan seam settings, rebuilt outputs).
- Assets: `public/assets/models/squad/doctor.glb`, `public/assets/models/squad/ruiz.glb`.
- Tests: `src/actors/bodyModel.test.ts` (separation and neck checks for scan bodies).
- Docs: an ADR-0026 addendum.
- `src/actors/bodyModel.ts` and the animator are not expected to change. No new dependencies.
