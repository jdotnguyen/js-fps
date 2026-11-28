# Design

## Context

See proposal.md for motivation.

- The shipped `pistol.glb` has three gun textures (material `Colt`) at 1024 px WebP. It was built by `scripts/fix-just-weapons-glb.mjs` from a Sketchfab glTF and the author's FBX, both kept outside the repo.
- A 2048 px glTF download (`animatedpistol.glb`, about 18 MB) was compared with the shipped model:
  - The gun meshes' texture coordinate area, centroid and bounds match.
  - Its colour map shrunk to 1024 px differs from the shipped one by an RMSE of 0.009.
  - Its gun textures include the decals.
- Its gun geometry is the broken Sketchfab geometry that the script exists to replace.
- The author's folder download holds the same colour map flipped vertically, with roughness, metalness and AO as separate files.

## Goals / Non-Goals

**Goals:**
- One repeatable step that produces the final gun textures from the 2048 px source.
- Geometry, skin, clips and the arm textures in the shipped model stay as they are.

**Non-Goals:**
- Per-quality-tier texture sizes for the viewmodel.
- Added detail maps or new shader samplers.

## Decisions

### Take the textures from the 2048 px glTF

Its roughness, metalness and AO are already packed and it is oriented like the shipped textures. The folder download would need flipping and repacking for no gain.

### Swap textures in a separate step instead of rebuilding from the new download

The step takes a built `pistol.glb` and the 2048 px glTF, replaces the three `Colt` textures, repairs them and writes the model. The full rebuild runs the same step after its geometry work and fails without the 2048 px file, so decals and 1024 px textures cannot come back unnoticed.

Alternative: pass the new download as the script's geometry input. Rejected: it would also change the arm textures, and the FBX in the new folder download has not been checked against the one the geometry step expects.

### Repair from the lossless source, then encode once

The step always starts from the source PNGs, so running it again gives the same result and WebP loss does not accumulate.

### Fill decals by copying nearby clean metal

Each decal on a metal face (three on the slide, one on the magazine) is covered with metal from the same part, using the same source on the colour and roughness/metal textures. Instead of a feathered edge, the copy gets a smooth correction that makes it meet its surroundings (a harmonic fill of the difference around the rim, each rim point taken as the median of a small patch). Grain and scratches come from the source; shading comes from the target. A plain feather would have left the source's tone visible as a soft rectangle.

The cut-off pieces sit where an island meets the unpainted background, so their colour is replaced by clean rows of the same columns without blending, which carries the edge straight through. Their roughness footprints are blended like the larger fills.

The code is in `scripts/lib/pistolTextures.mjs`, apart from the build script, so the test can read the repair regions.

Alternative: manual content-aware fill in an image editor. Rejected: not repeatable, and separate fills on the two textures may not line up. It remains the fallback for any region where copied patches leave a visible seam, with the filled patch then committed as a script input.

### Keep WebP quality 88 and raise the pistol's size budget to 3.0 MB

An estimate at quality 88 puts the file at about 2.64 MB, over the current 2.5 MB test limit. Lowering quality would give back some of the sharpness this change is for. The shotgun keeps 2.5 MB.

## Risks / Trade-offs

- [About 50 MB more GPU texture memory on every quality tier] -> Measure with the memory probe and record the figure below. The budgets target the desktop PC.
- [The normal map may hold a decal footprint that was not visible at 1024 px] -> Check it at 2048 px; repair it the same way if it does.
- [The 2048 px source lives outside the repo] -> Name the file and its Sketchfab page in the script header so it can be downloaded again.

## Memory Measurement

Method (2026-11-25): `window.__memprobe.sample()` in a Playwright browser at 3840x2160, High, on the RX 7900 XTX, dev server, at `/?level=slice01&debug&slot=scratch&jump=drop&memprobe` (the R03 drop) with `gunDrawn` set so the pistol is up, 20 s after the level was playing, two samples 5 s apart. The tree was `a97d09c` plus other agents' uncommitted work.

The "after" run repeated the method with the new model, then loaded the old one in the same browser (by serving the saved old file in place of it), because other agents had changed the tree since the baseline.

| | Baseline, old model | Later run, old model | Later run, new model | Difference (same run) |
| --- | --- | --- | --- | --- |
| GPU textures | 671 textures, 2,293.9 MB | 671 textures, 2,293.9 MB | 671 textures, 2,344.2 MB | +50.3 MB (+2.2%) |
| JS heap, no forced collection | 527-532 MB | 542-545 MB | 583-584 MB | +39 MB (+7%) |
| Decoded audio | 494 MB | 503 MB | 503 MB | none |

Nothing rose by more than 15%. The GPU increase is the three 2048 px textures. The heap figures were not taken after a forced garbage collection, and the model that ran second in that browser read lower, so the heap difference may be mostly noise; a rerun with forced collection and the order reversed did not load (the dev server was serving an empty copy of a file another agent was saving).
