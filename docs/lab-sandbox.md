# Underground laboratory sandbox (parked)

A walkable test level built from a third-party model, kept for later. **It is not part of the slice**: the slice stays on `slice01`, and nothing loads the lab unless you ask for it.

- **Run it:** `npm run dev`, then open `/?level=lab`.
- **Source:** "Location underground laboratory" by bazz4r, CC-BY-4.0 ([Sketchfab](https://sketchfab.com/3d-models/location-underground-laboratory-7f70eebd1f044277b91c197fb17c513e)). Credited in `CREDITS.md`. The original 18.6 MB GLB is not in the repo; keep your own copy to rebuild.
- **Rebuild:** `node scripts/fix-lab-glb.mjs <source.glb>` rewrites `public/assets/models/lab/` (`underground_lab.glb`, `.colliders.bin`, `.json`).
- **Code:** `src/world/labWorld.ts` (a `World`), hooked in `src/main.ts`; `src/world/labWorld.test.ts` checks the baked files and walking.

## What it is
About 74 x 53 m, several levels (hub at y = -4.9, west gallery at -1.9, upper decks). One grey material, no textures. The script merges 630 meshes into 30 tiles, converts the spec/gloss materials, bakes ~8,400 box colliders by voxelising the mesh (stairs become steps, thin props are chunky), and picks a spawn point, the floor levels and ~31 ceiling lamp positions.

## What it lacks for real use
No rooms, doors, access gating, triggers, objectives, NPC or enemy spawns, checkpoints, map outlines, or authored lighting and atmosphere. The intro, briefing and rounds scenes are written against `slice01`'s layout. Enemy nav samples every floor level but links levels only by line of sight, and is untested.

## If it comes back
Decide how much of `slice01` to move over (rooms and doors, hubs, scripted scenes), or use it only as a look for an existing level. Likely work: author rooms/doors/triggers as level data over the lab's geometry, replace the flat grey with real materials, and tune lighting.
