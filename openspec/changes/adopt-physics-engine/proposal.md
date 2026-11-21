# Proposal

## Why

Dismemberment is Thalassa's core combat mechanic, but everything after the cut is faked. Severed limbs only collide with `floorY(x, z)` in `GoreSystem`, so they fly through walls, sink into benches and get tipped flat by hand. Every kill ends in one of three authored corpse poses (`Humanoid.die`). For a game aiming at immersive, high-fidelity horror, bodies and pieces have to collide with the real world, fall in a physically believable way, and stay interactive afterwards. This change adds a rigid-body physics engine. It is delivered as a series of isolated blocks: each one is shippable, can be turned off on its own, and leaves the game exactly as it is today when off.

## What Changes

- **Engine trial (Block 0).** Rapier (`@dimforge/rapier3d-compat`) is the default engine. A sandbox trial checks it on one shambler: a severed-limb throw, a death ragdoll and a pose-driven ragdoll. Jolt (`jolt-physics`) is tried only if Rapier fails the pose-driven ragdoll case, since that is the one case where Jolt's built-in motor-driven ragdolls are a documented advantage. The trial records the result and the reasons. Nothing in the game changes.
- **Physics world (Block 1).** One engine-agnostic `PhysicsWorld` for each level. It is loaded lazily as its own bundle chunk, steps on the existing fixed `SIM_STEP`, and mirrors the level's `CollisionWorld` boxes as static colliders, with door colliders following their `enabled` state. A debug overlay draws its colliders. Gameplay does not change: the player, squad and enemy motors, rays and navigation stay on the existing systems.
- **Severed debris (Block 2).** `GoreSystem.addDebris` pieces become dynamic bodies, one capsule per severed chain built from the existing probes and radius. They collide with walls, props and each other, and their landing point drives the pools and splats. The current floor-only model stays as the fallback.
- **Death ragdolls (Block 3).** A killed humanoid hands its body to a ragdoll built from its skeleton. Joints that have been severed are left out. The ragdoll settles and then freezes into a static pose, so idle corpses cost nothing. The authored corpse poses stay as the fallback.
- **Powered ragdolls (Block 4).** Joint motors drive the ragdoll toward the animator's pose, so hits push the body physically and recover. Death fades the motors out instead of switching instantly, and play-dead and get-up blend between ragdoll and animation.
- **Interaction (Block 5).** The player's capsule pushes debris and corpses, corpses can be stomped, and selected imported props (trolleys, gas cylinders) can become dynamic. Each item is opted in individually.
- **Budgets and switches.** A cap on active ragdolls and on the physics step time, a per-block switch (URL flag and settings value), and the fallback whenever the engine is off, failed to load or has not finished loading.
- **New runtime dependency:** one physics engine, chosen in Block 0. Its WebAssembly is fetched only when a level that uses physics loads.

## Capabilities

### New Capabilities
- `physics-world`: the engine host, covering loading, stepping, the static collider mirror, door sync, switches, fallback, budgets and debug view.
- `severed-debris`: how severed limbs and gore chunks move, collide, settle and leave marks.
- `ragdoll`: physical bodies for humanoids, covering death ragdolls, settling and freezing, severed-joint handling, powered (pose-driven) ragdolls, and blending with play-dead and get-up.
- `physical-interaction`: the player and the world acting on physical bodies, covering pushing debris, stomping corpses and dynamic props.

### Modified Capabilities
(none: `runtime-memory` and `test-suite` requirements apply unchanged, and the design records the measurements they require)

## Impact

- **Code:** new `src/physics/` (engine adapter, world, collider mirror, ragdoll builder); `src/actors/gore.ts` (debris backend); `src/actors/humanoid.ts` (`die`, `playDead`, `getUp`, hit reactions); `src/actors/animator.ts` (motor targets); `src/world/level.ts` (door sync hook); `src/main.ts` (lazy load, stepping); `src/sandbox/actorsSandbox.ts` (trial and tuning); `vite.config.ts` (engine chunk).
- **Dependencies:** `@dimforge/rapier3d-compat` (Apache-2.0), or `jolt-physics` (MIT) only if Block 0's fallback is taken. The game bundle grows only by the lazily loaded engine chunk.
- **Other work:** authored kills (`infection-kills`, including Voss's burst) stay authored; the chunks from her burst become physical once Block 2 lands. Imported props keep authored static colliders; Block 5 only opts in props it names. `per-character-motion` is reworking `humanoid.ts` and `animator.ts`, so Blocks 3 and 4 wait for it to be archived. Powered ragdolls build on the existing hand physics (`handPhysics.ts`, `limbContact.ts`) rather than replacing it.
- **Target hardware:** the developer's desktop PC. The MacBook Air M2 is best-effort.
- **Tests:** existing headless tests run with physics off and must stay green. New physics tests run the engine in Node, cap their own memory use, and assert invariants (inside the room, settled, frozen) rather than exact positions.
- **Performance and memory:** must meet `runtime-memory` (no growth over enemy churn). Physics step time is measured on the heaviest slice scene and recorded for each block.
