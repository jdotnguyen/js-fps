# Design

## Context

See proposal.md (Why). The engine, world, switches and debris come from `adopt-physics-engine`; its design holds the engine trial ("Block 0 result").

- **Death and play-dead.** `Humanoid.die` picks `corpseProne`, `corpseSupine` or `corpseSide` and adds a death twitch. `playDead(pose)` and `getUp()` (the `getUp` pose sequence) drive play-dead. Hit reactions are `Animator.kick` plus springs.
- **Existing hand physics.** `actors/handPhysics.ts` runs wrist and finger springs that react to forearm motion and hit impulses, and `actors/limbContact.ts` resolves hand contact against bodies and the world. Both are animation-side springs, not a rigid-body engine.
- **Switches.** `ragdoll` and `powered` already exist in `core/settings.ts` and do nothing.

What the engine trial settled (`src/physics/trialRagdoll.ts`):
- **Bodies:** 14, not 11. The feet need their own bodies: fixed to the shins, they turned with a bent knee and dug into the floor.
- **Elbows:** tightly limited ball joints, not hinges. The animated elbow also twists and leans, which a hinge cannot follow.
- **Self-collision:** a ragdoll's own parts must not collide (`noCollideGroup`).
- **Pose drive:** joint motors cannot hold a standing pose against gravity. A world-space spring holds it within 1.9 cm and recovers from a shotgun-strength shove in a few frames.
- **Imported bodies:** untested. The trial used the procedural rig, whose rest rotations are identity.

## Goals / Non-Goals

**Goals:** each block switchable, with its off state matching the game without it. The animator stays the source of truth for poses.

**Non-Goals:** ragdolls on squadmates; any change to authored kills.

## Decisions

Numbering follows `adopt-physics-engine`, so older references stay readable.

### D6. Ragdoll built from the shared skeleton, hand-off by bone
`src/physics/ragdoll.ts` maps the `skeleton.ts` joint set to 14 bodies (see Context). Imported bodies use the same joint names (`bodyModel.ts`), so one mapping covers procedural and imported bodies, with joint frames taken from each rest pose. Severed subtrees are skipped when the ragdoll is built, and a sever during the ragdoll removes the joint and passes the bodies to `addDebris`. Each frame the ragdoll writes bone world transforms, and the animator is bypassed for those bones. Freezing copies the final pose into the animator as a one-off static pose and destroys the bodies. A touch (a shot, the player pushing, a stomp) rebuilds the ragdoll from the frozen pose.

### D7. Powered ragdoll as a blend weight, not a new state machine
`physicsWeight` (0 = pure animation, 1 = pure ragdoll) per body. Bodies are driven toward the animator's world pose by a damped spring on their velocity, with velocity and gravity feed-forward, and a kinematic pelvis while the body stands. The weight scales the spring's stiffness and damping down from the trial values (1600 1/s², 70 1/s). A hit sets a per-region spike in the weight that decays over 0.6 s, so the hit region goes slack and staggers before the spring brings it back. Death ramps the drive down over 0.3 to 0.8 s and frees the pelvis. Play-dead freezes like a corpse. `getUp` ramps the weight down while the `getUp` sequence starts from the frozen pose, which is the pose-matching step that stops popping. The existing `LifeState` values stay as they are.

### D8. Budgets
At most 6 active ragdolls. Above the step-time budget (1.5 ms average, 3 ms peak), the oldest active ragdoll freezes first, then the oldest active debris. `ragdolls.available()` is true when the switch is on, the engine has loaded and the budget allows it; otherwise `Humanoid.die` uses the authored poses.

### D12. Relation to the authored kills (`infection-kills`)
Every kill under the `infection-kills` spec keeps its body authored, as the `ragdoll` spec's "Authored kills stay authored" requires.

### D13. Powered ragdolls build on the existing hand physics
The ragdoll's arm bodies are driven to the animator's pose. `handPhysics.ts` keeps owning the wrists and fingers on top of that, fed by the ragdoll's forearm motion instead of the animator's. Hit impulses go to the ragdoll body first, and the hand springs react to the resulting forearm motion. `limbContact.ts` stays the source of hand-on-surface contact. Wrist and finger dynamics are not reimplemented in the engine.

## Risks / Trade-offs

- **[Ragdolls look floppy or jitter]** → Tight joint limits, damping, and freeze at rest. The pose drive, faded out over the death, is the real fix for limp-looking deaths.
- **[Imported bodies fold wrongly]** → Prove the death ragdoll on one imported body before building the rest.

## Open Questions

- Whether play-dead enemies are common enough for the blend work (`slice01` has one).
- Whether the world-space drive looks right in play; if not, revisit the skipped Jolt comparison.
