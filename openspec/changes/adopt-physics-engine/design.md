# Design

## Context

See proposal.md (Why). These are the parts of the current code that shape the approach:

- **Collision.** `world/collision.ts` (`CollisionWorld`) holds the level as axis-aligned boxes in a 2 m hash. Each box has `enabled` (doors toggle it in `world/level.ts`) and a `surface`. Every collider is a box.
- **Movement.** `actors/motor.ts` moves the player, squad and enemies as cylinders against those boxes. Navigation is `recast-navigation`. Walk, jump and clearance tests (`slice01Walks`, `wallClearance`, and others) pin this behaviour down.
- **Debris.** `GoreSystem.addDebris(object, velocity, probes, radius, dispose)` is called only from `Humanoid.sever`. Pieces get gravity and spin, collide only with `floorY(x, z)`, are tipped flat by hand, and sleep after 3 to 5 s. The cap is `MAX_DEBRIS = 24`. Tests stub the whole system (`STUB_GORE`).
- **Death and play-dead.** `Humanoid.die` picks `corpseProne`, `corpseSupine` or `corpseSide` and adds a death twitch. `playDead(pose)` and `getUp()` (the `getUp` pose sequence) drive play-dead. Hit reactions are `Animator.kick` plus springs.
- **Loop and bundle.** The loop runs a fixed `SIM_STEP = 1/60` (`core/loop.ts`). `main.ts` already lazy-loads level code and `initNavmesh()`, and `vite.config.ts` splits `three` into its own chunk.
- **Constraints.** Target hardware is the developer's desktop PC. The MacBook Air M2 is best-effort: it runs the game if it can, otherwise with lower graphics settings. `runtime-memory` forbids memory growth over enemy churn and checkpoint restarts. `test-suite` caps test concurrency, and AGENTS.md asks tests to stay light because several agents share one machine.
- **Related work.** `voss-burst-death` and `import-lab-props` are archived. Voss's kill is now governed by the `infection-kills` spec and uses `GoreSystem.burst/chunks`. Imported props keep authored, static colliders (`imported-props` spec). `per-character-motion` (in progress) is reworking `humanoid.ts` and `animator.ts`, which Blocks 3 and 4 also change.
- **Existing hand physics.** `actors/handPhysics.ts` already runs wrist and finger springs that react to forearm motion and hit impulses, and `actors/limbContact.ts` resolves hand contact against bodies and the world. Both are animation-side springs, not a rigid-body engine.

## Goals / Non-Goals

**Goals:**
- Each block is independently shippable and switchable, and each one's off state matches today's behaviour exactly.
- The engine stays behind a small adapter, so the Block 0 choice does not leak into gameplay code.
- Existing systems stay the source of truth: `CollisionWorld` for the static world, the animator for poses, and `GoreSystem` for what gore exists.

**Non-Goals:**
- Moving the player, squad or enemy motors, hit-scan rays, line-of-sight checks or navigation onto the physics engine.
- Networked or bit-exact deterministic simulation (the game is single-player, and tests assert invariants instead).
- Physics on squadmates in this change. They cannot die in the slice, and their downed state stays authored.
- Destruction or fracture of level geometry, soft bodies, cloth, fluids.

## Decisions

### D1. Isolated blocks, each with its own gate

```
  B0 trial --> B1 world --> B2 debris --> B3 death ragdoll --> B4 powered --> B5 interaction
  (sandbox)    (no visible   (switch:      (switch:              (switch:       (switch:
               change)       debris)       ragdoll)              powered)       interact)
```

Each block ends with a gate: its specs' scenarios pass, the existing headless suite passes with physics off, the step-time and memory figures are recorded below, and a playtest note is filed. Later blocks depend only on earlier ones, never the reverse, so any block can be stopped or reverted on its own. Blocks are separate commits (or PRs), so they can be applied one at a time.
*Alternative:* one big switch-over. Rejected: it can't be reverted piece by piece.
*Sequencing:* Blocks 0 to 2 do not touch `humanoid.ts` or `animator.ts` and can start now. Blocks 3 and 4 start after `per-character-motion` is archived, so the two changes do not edit the same files at once.

### D2. Rapier first, Jolt only as a fallback, behind an adapter
Rapier is the default. Block 0 builds three cases with it in `actorsSandbox`: a limb thrown at a wall, a death ragdoll on stairs, and a pose-driven ragdoll taking a shoulder hit and recovering. Rapier passes if it meets every criterion below:

| Criterion | Pass bar |
|---|---|
| Ragdoll stability (joint limits hold, no jitter at rest) | must |
| Motor pose-matching (pose-driven case returns within 2 cm per bone by 0.6 s, as task 5.2 later requires) | must |
| Step time for 6 ragdolls + 24 debris on the target desktop PC | within the D8 budget |
| Runs under Node for headless tests | must |
| Download size (gzipped wasm + JS) | recorded |

If Rapier fails only the motor pose-matching case, Block 0 then builds the pose-driven case in Jolt and compares the two. Any other failure is a design problem to raise, not a reason to switch engines. The result is recorded in this file under "Block 0 result". Gameplay code talks only to `src/physics/engine.ts`, a narrow interface: create and destroy body, collider and joint; set motor target; step; read transforms; contact events; raycast. Only the chosen engine's adapter is kept.
*Why Rapier first:* its JavaScript API is typed and JS-first, its bindings are maintained by the engine authors, and it has far more web examples to work from. Jolt's JS build is a thin binding over the C++ API, with manual `destroy()` calls (leak risk under `runtime-memory`) and few web examples. Jolt's documented advantage is built-in animated ragdolls that drive constraint motors toward a pose, which matters only for Block 4 (researched November 2026).
*Alternative:* trial both engines on all three cases. Rejected: it roughly doubles Block 0 for a difference that matters in one block.

### D3. Static world mirrored from `CollisionWorld`, not authored twice
At level load, every `CollisionWorld` collider becomes a fixed cuboid with the same bounds and a back-reference to its id and surface. Colliders tagged `door:*` are flipped with the engine's collider enable call from the same place `level.ts` sets `collider.enabled` (one hook, not a second door system). A box added or removed later goes through the same mirror. `CollisionWorld` stays authoritative, and physics never writes back to it.
*Alternative:* derive physics colliders from render meshes. Rejected: it creates a second truth that tests don't cover and that differs from what the player collides with.

### D4. Fallback is the current code, kept on purpose
`GoreSystem` gets a debris backend interface with two implementations: `floorDebris` (today's code, moved unchanged) and `physicsDebris`. `Humanoid.die` checks `ragdolls.available()` and otherwise uses the authored poses. "Available" means the switch is on, the engine has loaded, and the ragdoll budget allows it. Headless tests and `STUB_GORE` keep using the fallback, so existing tests don't change.

### D5. Debris bodies from the existing probes
`addDebris` already gets object-local probes and a radius. The physics backend builds one capsule from the first probe to the last with that radius (or a ball if there is only one probe), with CCD turned on, and mass from length times a fixed density. Contact events report the first impact point and normal to `GoreSystem`, which calls `pool`/`splat` there, using the same `GoreClip` checks. Sleep uses the engine's own sleeping, plus a hard 6 s cutoff that makes the body static.

### D6. Ragdoll built from the shared skeleton, hand-off by bone
`src/physics/ragdoll.ts` maps the `skeleton.ts` joint set to roughly 11 bodies: pelvis, spine, chest, head, upper and lower arms, upper and lower legs. Hands and feet are merged into the forearm and shin. Imported bodies use the same joint names (`bodyModel.ts`), so one mapping covers procedural and imported bodies. Severed subtrees are skipped when the ragdoll is built, and a sever during the ragdoll removes the joint and passes the bodies to `addDebris`. Each frame the ragdoll writes bone world transforms, and the animator is bypassed for those bones. Freezing copies the final pose into the animator as a one-off static pose and destroys the bodies. A touch (a shot, the player pushing, a stomp) rebuilds the ragdoll from the frozen pose.

### D7. Powered ragdoll as a blend weight, not a new state machine
Block 4 adds `physicsWeight` (0 = pure animation, 1 = pure ragdoll) per body, plus joint motors that track the animator's local rotations. A hit sets a per-region spike in the weight that decays over 0.6 s. Death ramps motor strength down over 0.3 to 0.8 s. Play-dead freezes like a corpse. `getUp` ramps the weight down while the `getUp` sequence starts from the frozen pose, which is the pose-matching step that stops popping. The existing `LifeState` values stay as they are.

### D8. Stepping and budgets
`PhysicsWorld.step()` runs inside the existing fixed-step loop, once per `SIM_STEP`, before gore and animation are read, and is skipped while paused. Step time is measured as a rolling average. The budget is the `physics-world` spec's: 1.5 ms average and 3 ms peak per frame on the target desktop PC. Above budget, the oldest active ragdoll freezes first, then the oldest active debris. Caps: 6 active ragdolls, 24 debris (unchanged), and a dynamic-prop cap set in Block 5.

### D9. Switches
`core/settings.ts` gains `physics: { debris, ragdoll, powered, interact }`. Defaults are off until each block's gate passes, then on. URL overrides: `?physics=off` or `?physics=debris,ragdoll`. All switches off means the engine is never fetched (D10).

### D10. Lazy engine chunk
The engine is imported with `import()` from `src/physics/load.ts`, which starts when a level begins loading if any switch is on, and runs in parallel with the existing navmesh init. `vite.config.ts` gives it its own chunk. Until the load finishes, `available()` returns false.

### D11. Player interaction (Block 5)
The player motor stays as it is. A kinematic capsule follows it and pushes dynamic bodies, without the engine feeding back into the player. There is no player stomp today (the existing stomp is the hero enemy's attack, ADR-0021), so Block 5 adds a player stomp action with an input binding, a short animation of the view and the legs, damage through the existing `damage.ts`, and audio from the `audio-assets` pipeline. Dynamic props are opt-in through a `dynamic: { mass }` field on kit or level prop data. Their authored stand-in box becomes the dynamic collider, and its static mirror entry is removed.

### D12. Relation to the authored kills (`infection-kills`)
`voss-burst-death` is archived, so there is no non-goal left to narrow. Voss's kill, and every kill under the `infection-kills` spec, keeps its body authored, as the `ragdoll` spec's "Authored kills stay authored" requires. Its `chunks()` and any severed parts use whichever debris backend is active.

### D13. Powered ragdolls build on the existing hand physics
Block 4 drives the ragdoll's arm bodies to the animator's pose. `handPhysics.ts` keeps owning the wrists and fingers on top of that, fed by the ragdoll's forearm motion instead of the animator's. Hit impulses go to the ragdoll body first, and the hand springs react to the resulting forearm motion. `limbContact.ts` stays the source of hand-on-surface contact. Block 4 does not reimplement wrist or finger dynamics in the engine.

## Risks / Trade-offs

- **[Ragdolls look floppy or jitter]** → Block 0 scores stability first. Use tight joint limits, damping, and freeze at rest. Block 4's motors are the real fix for limp-looking deaths.
- **[WASM memory leaks across checkpoint restarts]** → All engine objects are owned by `PhysicsWorld`, which is destroyed and rebuilt on every level or checkpoint load. Add a leak test that counts bodies and colliders after restarts, and run the `runtime-memory` churn measurement for each block.
- **[Two collision worlds drift apart]** → The mirror is built only from `CollisionWorld`, plus a test that compares collider counts and bounds and checks door toggles.
- **[Tests get heavier on a shared machine]** → Physics tests use small dedicated scenes, not `slice01`, and the existing suite stays on the fallback.
- **[Download size grows]** → The engine is a lazy chunk, with its size recorded in Block 0 and again at each gate. The title screen is never affected.
- **[Bodies tunnel through thin walls at shotgun speed]** → CCD on debris, and a minimum collider thickness checked by the mirror test.
- **[Dynamic props soft-lock paths]** → Props are opt-in only. Walk tests run with each dynamic prop pushed into the worst spot. The `physical-interaction` spec requires paths to stay open.
- **[Authored scenes change unexpectedly]** → Authored kills and sequence poses are never ragdolled unless their data asks for it.

## Migration Plan

1. Apply the blocks in order, one commit or PR each, with each switch defaulting to off.
2. At a block's gate, flip its default to on in the same PR that records its measurements.
3. Rollback: set the switch default to off (instant, no code removed). For a full revert, revert that block's commit. Later blocks have not been applied yet, or check `available()` and fall back.

## Measurements

Fill in at each gate (heaviest slice scene, High, target desktop PC, scratch slot). A note on the MacBook Air M2 is welcome but does not gate.

| Block | Engine chunk (gz) | Physics step avg / peak | JS heap delta | Notes |
|---|---|---|---|---|
| B0 | 1.66 MB (compat build, wasm inlined; 4.3 MB raw) | 0.48 / 1.50 ms: bench of 6 ragdolls (14 bodies each) + 24 limbs, 108 bodies, 78 joints | not measured | Sandbox `?physics` [B], 2026-11-21, this Windows machine, pane hidden (background tab); re-measure with the pane visible at the B1 gate |
| B1 | | | | |
| B2 | | | | |
| B3 | | | | |
| B4 | | | | |
| B5 | | | | |

## Block 0 result

**Recommendation: keep Rapier, with one design change.** Rapier meets every D2 bar except pose-matching through joint motors, which it cannot do on a ragdoll chain under gravity. Driving each body toward its animated pose in world space meets that bar instead. Block 4 (D7) should use world-space pose driving, not joint motors. Awaiting the author's sign-off (task 1.8); Jolt (task 1.7) is optional, see below.

Scores against the D2 table (2026-11-21, `@dimforge/rapier3d-compat` 0.21.0, procedural shambler, 14-body trial ragdoll in `src/physics/trialRagdoll.ts`, tests in `src/physics/trialRagdoll.test.ts`, browser panel `/sandbox/actors.html?physics`):

| Criterion | Bar | Result |
|---|---|---|
| Ragdoll stability | must | **Pass.** Dropped flat: settles in 2.7 s, no body below the floor, joints stay attached (0 cm gap). Chest shot on stairs: falls back along the shot, rests on the steps, settles in 6 s (under the 8 s freeze window). No jitter at rest. |
| Pose-matching | returns within 2 cm per bone by 0.6 s | **Joint motors: fail.** Spherical-joint motors cannot hold a standing pose against gravity: the spine and chest sag, leaving 6-34 cm error depending on stiffness and solver iterations (4-32). Rapier's exact multibody joints would fix the chain, but its JS build exposes no motors on them. **World-space drive: pass.** Each body is pulled to its animated pose by a damped spring with velocity and gravity feed-forward (kinematic pelvis): it holds within 1.9 cm, a shotgun-strength shove pushes it 5.3 cm, and it is back within 3 cm in 0.03 s. In the browser it holds within 0.3-0.6 cm. |
| Step time, 6 ragdolls + 24 debris | within the D8 budget (1.5 ms average, 3 ms peak) | **Pass.** 0.48 ms average, 1.50 ms peak (see Measurements). |
| Runs under Node | must | **Pass.** Initialises in about 32 ms; all physics tests run headlessly. |
| Download size | recorded | 1.66 MB gzipped lazy chunk (compat build). |

What the trial changed in the plan:
- **Bodies:** 14, not 11. The feet need their own bodies: fixed to the shins, they turned with a bent knee and dug into the floor.
- **Elbows:** tightly limited ball joints, not hinges. The animated elbow also twists and leans, which a hinge cannot follow.
- **Self-collision:** a ragdoll's own parts must not collide (`noCollideGroup`), or the overlapping limb and torso shapes push each other apart.
- **Hit reactions (Block 4, D7):** the world-space drive is stiff (recovers in a few frames). A visible stagger needs the per-region stiffness drop D7 already plans.
- **Imported bodies:** untested. The trial uses the procedural rig, whose rest rotations are identity. Imported models need joint frames taken from their rest pose (Block 3).

**Jolt (task 1.7).** By D2's rule, failing the motor bar triggers a Jolt comparison of the pose-driven case. The world-space drive meets the outcome the bar describes, and it is also what Jolt itself offers as "drive to pose using kinematics". A Jolt trial would only test whether its constraint motors make a better-looking powered ragdoll. Recommendation: skip it unless Block 4 playtests show the world-space drive looks wrong.

Detailed findings:
- Initialises under Node in about 32 ms and in the browser (sandbox panel), so headless physics tests work.
- Size: the compat build inlines its WebAssembly, so the lazy chunk is about 4.3 MB raw and 1.66 MB gzipped. The non-compat `@dimforge/rapier3d` loads a separate .wasm file (3.1 MB raw) and would need Vite WebAssembly support; revisit only if the chunk size matters.
- Limits and motors: Rapier's typed wrapper exposes angle limits only on single-axis joints, and `getImpulseJoint` returns joints without their motor methods. The raw joint set has per-axis `jointSetLimits` and `jointConfigureMotorPosition` for every joint, and the adapter uses those. Ball joints get per-axis angle limits, not a true swing cone like Jolt's SwingTwist constraint. On the death ragdolls (flat and stairs) these held without visible over-rotation.
- Releasing a motor needs a zero force cap. Zero stiffness and damping alone still drag the axis (measured).
- Adapter tests (`src/physics/rapierAdapter.test.ts`) pass: landing and sleep, zero live objects after destroy, CCD contact on a thin wall with no tunnelling, raycasts with disabled colliders, hinge and ball limits holding, and a ball-joint motor holding a pose and releasing it.

## Open Questions

- Whether the play-dead variant ships in this slice. It changes only when Block 4 is scheduled, not the design.
- Exact density and friction per surface (`concrete`, `metal`, `grate`, `rubber`, `water`). These are tuned in the sandbox during Block 2.
- Whether the engine's raycast against trimesh colliders built from render meshes should replace `CollisionWorld.raycast` for cosmetic hits only (bullet decals, blood splats, flashlight and sound-occlusion probes), so they land on real surfaces instead of collision boxes. Gameplay rays stay on `CollisionWorld` (Non-Goals). If yes, it is a follow-up change after Block 1, and `three-mesh-bvh` is not needed. If the engine is off, cosmetic rays fall back to `CollisionWorld`.
