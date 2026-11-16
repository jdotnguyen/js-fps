# ADR-0003: Modular level kit and data-driven levels

Status: Accepted (hybrid kit) / Proposed (dimensions, schema)

## Context
Justin wants interior corridors with far more polygons [Decided], a hybrid asset approach
that starts procedural because he has no 3D experience [Decided], and swappable pieces so
real models can replace procedural ones later [Decided].

## Decision
A grid-snapped modular kit. Every piece has one ID, one pivot convention and two possible
sources: a procedural generator (now) and a GLB file (later). Levels are JSON lists of
rooms made of pieces.

## Details

### Grid and dimensions [Assumed]
- Cell = 4 m x 4 m footprint. Corridor interior 3 m wide, 3.2 m floor-to-ceiling.
- Rooms are multiples of cells (e.g. 3x2 cells = 12 m x 8 m).
- Doors are 2 m wide, 2.4 m tall. Rotation in 90 degree steps.

### Piece contract
```js
// world/kit/<family>.js
export default {
  id: 'corridor_straight',
  footprint: [1, 1],             // cells
  generate(params, rng) {
    return {
      object,        // THREE.Group, origin at floor centre, facing -Z
      colliders,     // [{ min:[x,y,z], max:[x,y,z] }] simplified boxes
      sockets,       // [{ name:'north', pos, dir }] for connections + nav nodes
      lightSlots,    // [{ pos, kind:'ceiling'|'wall'|'emergency' }]
      navNodes,      // [{ pos }] walkable points for ADR-0007
      surfaces,      // [{ box, material:'metal'|'grate'|'rubber'|'water' }] for footsteps
    };
  },
};
```
`world/registry.js` resolves an ID: if `kit-manifest.json` lists a GLB for it, load the GLB
(colliders/sockets come from named empties `COL_*`, `SOCKET_*`, `LIGHT_*`, `NAV_*` in the
file); otherwise call the generator.

### Initial kit (procedural)
Structure: `corridor_straight`, `corridor_corner`, `corridor_t`, `corridor_end`,
`corridor_window` (abyss view), `door_frame` + door types (`pressure_slide`, `bulkhead`,
`glass_slide`), room tiles (`floor`, `floor_grate`, `wall_plain`, `wall_panel`,
`wall_window`, `wall_glass_partition`, `wall_vent`, `ceiling`, `ceiling_pipes`),
`stairs`, `catwalk`.
Props: pipe runs, cable bundles, ribs/frames, crates, lockers, consoles with screens, chairs,
desks, gurney, specimen tank, cryo/med bed, vending machine, ceiling fixtures, emergency
beacons, vent grates, valves, debris piles, corpse poses (uses ADR-0006 humanoid).

### Detail techniques (where the polygons come from)
- `RoundedBoxGeometry` for bevelled panels, `ExtrudeGeometry` with bevel for wall plates,
  `TubeGeometry`/`TorusGeometry` for pipes and elbows, `LatheGeometry` for tanks and valves.
- Repetitive detail (bolts, grates, ribs, cable clips) as `InstancedMesh`.
- Static pieces in a room are merged per material with `BufferGeometryUtils.mergeGeometries`
  after placement, so detail does not cost draw calls.
- Seeded variation: panel layouts, wear, missing panels, cable sag differ per instance.

### Level JSON schema (abridged)
```json
{
  "id": "slice01",
  "seed": 1337,
  "playerStart": { "room": "R01", "pos": [0, 0, 2], "yaw": 180 },
  "squadStart": { "engineer": [1, 0, 3], "medic": [-1, 0, 3] },
  "rooms": [{
    "id": "R06",
    "name": "Pressure Door Hall",
    "atmosphere": { "fog": "#06090b", "fogDensity": 0.07, "ambient": "emergency",
                    "reverb": "metal_hall", "ambience": "hull_groan" },
    "pieces": [{ "kit": "corridor_straight", "cell": [0, 0, 3], "rot": 90, "params": {} }],
    "props":  [{ "kit": "console", "pos": [2.1, 0, -1.4], "rot": 270 }],
    "lights": [{ "slot": "auto", "pattern": "flicker", "color": "#ff3b2f", "intensity": 2 }],
    "triggers": [{ "id": "t_r06_enter", "box": [[-2,0,-2],[2,3,2]], "on": "enter",
                   "emit": "trigger:r06_enter", "once": true }],
    "spawns": [{ "id": "s_r06_vent", "pos": [0, 2.8, -6], "kind": "vent" }]
  }],
  "doors": [{ "id": "D_R05_R06", "kit": "pressure_slide", "between": ["R05", "R06"],
              "cell": [0, 0, 2], "rot": 0, "state": "locked",
              "unlockBy": "engineer", "task": "bypass_short" }],
  "checkpoints": [{ "id": "cp_cover_me", "room": "R06", "pos": [0,0,0], "yaw": 0 }]
}
```

### Rooms, doors and culling
- Each room is a `THREE.Group`. Render and enable lights only for the current room and
  rooms connected through open or glass doors (portal-by-adjacency). Rooms seen through
  windows can opt in with `"visibleFrom": ["R03"]`.
- Doors: states `open`, `closed`, `locked`, `jammed`, `sealed`; unlock sources `player`,
  `engineer`, `medic`, `script`. Emit `door:*` events. Door panels show state colour on a
  screen material.

### Collision
- Static colliders are axis-aligned boxes per piece (rotated pieces get recomputed AABBs).
  Player and actors are capsules approximated as vertical cylinders vs boxes, with
  step-up up to 0.35 m and ramp handling for stairs. [Assumed]
- Spatial hash (2 m cells) for fast collider and raycast queries.
- If detailed geometry later needs exact collision, adopt `three-mesh-bvh` (new
  dependency; ask first).

### Authoring
- Hand-written JSON for the slice. Debug overlay shows grid, room IDs, socket arrows,
  colliders, triggers, light slots and nav nodes.
- A visual level editor is deferred. [Open]

## Consequences
- The 4 m grid constrains layouts but makes procedural and GLB pieces interchangeable.
- GLB authors (Justin later) only need to follow the pivot + named-empty convention; it will
  be documented in `docs/kit-authoring.md` when the first GLB is added.

## Alternatives rejected
- Freeform CSG level geometry: hard to swap with art later and to collide against.
- Tilemap with 2D extrusion: too flat for pipes, catwalks and multi-height spaces.

## Execution steps
1. Registry + manifest + level loader + validation.
2. Structural kit pieces with AO vertex colours and merged geometry.
3. Collision (spatial hash, capsule vs AABB, steps) ported from legacy `level.js`.
4. Doors and triggers with events.
5. Room adjacency culling + light-slot assignment to the ADR-0002 pool.
6. Prop kit pieces.
7. A test level with 4 rooms, one locked door and one window.

## Definition of done
- Test level loads from JSON, can be walked end to end, debug overlays work.
- Changing one piece ID in JSON changes the geometry with no code change.
- Draw calls per visible room <= 60 after merging.

## Open questions
- Visual level editor (later chapters).
