# Physics

Rigid-body physics for severed limbs, ragdolls and pushable things. The plan is the
[`adopt-physics-engine`](../openspec/changes/adopt-physics-engine/) OpenSpec change, delivered in blocks that each
ship behind their own switch. The behaviour is specified in its `physics-world`, `severed-debris`, `ragdoll` and
`physical-interaction` specs.

## Engine

[Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`), chosen in Block 0. See "Block 0 result" in the change's
`design.md` for the trial, its scores, and why powered ragdolls use world-space pose driving rather than joint
motors.

Gameplay code never imports Rapier. It talks to `src/physics/engine.ts`, a small engine-agnostic interface;
`src/physics/rapierAdapter.ts` is its only implementation and the only file that imports the engine. A few Rapier
details the adapter handles:

- Ball-joint angle limits and all joint motors go through Rapier's raw joint set: its typed wrapper only limits
  single-axis joints.
- Releasing a motor needs a zero force cap; zero stiffness and damping alone still drag the joint.
- Queries (raycasts, overlaps) see colliders as of the last step. Create or move colliders, then step, then query.

## Switches

Each feature has its own switch, stored in the settings and off by default until its block's gate passes:
`debris`, `ragdoll`, `powered`, `interact`. A URL flag overrides them for one session:

| URL | Effect |
| --- | --- |
| `?physics=off` | Every feature off. The engine is never downloaded. |
| `?physics` | Every feature on. |
| `?physics=debris,ragdoll` | Exactly those features on. Unknown names log one warning. |

With every switch off the game behaves exactly as before. With a feature on, its fallback still applies until
the engine has loaded, and for good if the engine fails to load (one `[physics]` warning).

## How it runs

- **Loading.** `src/physics/load.ts` imports the engine when a level loads and any switch is on. It is its own
  bundle chunk (`physics`, about 1.66 MB gzipped), never part of the title screen. Nothing waits for it.
- **World.** `src/physics/world.ts` (`PhysicsWorld`) mirrors the level's player collision (`CollisionWorld`) as
  fixed boxes, so bodies hit exactly what the player hits. Every step it follows each box's `enabled` flag, so
  doors open and close for physics too. A door that closes on a body first moves the body out sideways.
- **Stepping.** One step per fixed simulation step, at the start of the in-play update, so a pause freezes physics
  and frame rate does not change how things fall.
- **Restarts.** New game, loads and death restarts rebuild the world empty, so nothing survives from the last
  attempt and nothing leaks.

## Debug view

With `?debug`, the lil-gui panel has a **Physics** folder: tick **show colliders** to draw them over the scene.

| Colour | Meaning |
| --- | --- |
| Grey | Level collision (open doors are hidden) |
| Green | Active body |
| Blue | Body asleep |
| Amber | Frozen body (a settled corpse made static) |
| Violet | Kinematic body (follows animation) |

The folder also shows the engine version and the step time (average and peak over the last 2 s), to compare with
the budget of 1.5 ms average and 3 ms peak at High on the target desktop PC.

## Sandbox trial

`/sandbox/actors.html?physics` runs the Block 0 trial in the actors sandbox: **J** throws a severed limb at a wall,
**K** shoots a shambler on the stairs, **L** spawns a powered shambler (again to shove it), **B** runs the timing
bench (6 ragdolls and 24 limbs), **X** clears. It uses the procedural body only.

## Tests

`src/physics/*.test.ts` run Rapier headlessly in Node: the adapter, the trial ragdoll cases, switches, loading,
the collider mirror (walls, doors, a door closing on a body), the fixed step, and leak-free restarts.
