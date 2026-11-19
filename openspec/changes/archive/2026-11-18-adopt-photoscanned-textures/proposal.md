# Adopt photoscanned CC0 textures

## Why

Every surface in js-fps uses textures generated in code (`src/render/tex/generators.ts`). They read as math rather than as a real, failing undersea station. Justin has picked and downloaded 22 CC0 PBR sets (ambientCG, Poly Haven, TextureCan) that match the "worn industrial, not clean sci-fi" direction.

## What changes

- An **import script** turns the raw downloads (kept outside the repo in `../textures`) into game-ready maps: colour, OpenGL normal, and one packed AO/Rough/Metal (ORM) image per set, resized per slot.
- A **texture manifest** maps each material slot to a set, with its physical tile size, albedo tint and resolution. Slots with no photo set keep their procedural generator as a fallback.
- **Materials load images instead of generating**, and turn on the ambient-occlusion channel the ORM texture already carries.
- **New material slots** for things the procedural kit couldn't do: heavy rust, wall tile, washroom tile, broken tile (Lab B after the outbreak), rusty treadplate, and a DANGER sign decal.
- **Tiled floors and walls** in `slice.ts` stop building each tile and grout line as geometry; one slab gets a tiled texture.
- **Per-area assignment**, so the station stops looking like one metal corridor.
- **A texture memory budget** and on-demand loading, so 22 sets don't all sit in GPU memory at once.

## Out of scope

- Decals for grime, water streaks, condensation and biofouling: a separate change once the base materials are in.
- New prop or furniture models, and the set-dressing rules.
- Swapping the procedural `steel` and `grating` (no photo sets picked yet).
- The lab sandbox level (`?level=lab`); it keeps working through the shared slot names.

## Impact

- `src/render/materials.ts`, `src/render/textures.ts`, new `src/render/tex/manifest.ts` and loader
- `src/world/kit/slice.ts` (tile floors and walls), `src/world/kit/structure.ts` (per-area material choice)
- `scripts/textures/` (new import script), `public/assets/textures/` (processed output)
- `CREDITS.md` (sources listed even though CC0 needs no credit)
- ADR-0002 gets a short addendum on texture sources
