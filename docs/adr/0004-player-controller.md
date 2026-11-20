# ADR-0004: Player controller and interaction

Status: Accepted (role) / Proposed (feel numbers)

## Context
The player is a security officer, the strongest fighter on the team, silent in this slice
[Decided]. The opening is a real-time first-person "cutscene" where the player keeps
partial control [Decided]. Movement must suit tight, dark corridors and slow enemies.

## Decision
A grounded, slightly heavy first-person controller with aim mode, flashlight, interact,
shove, and an API that sequences use to restrict or guide control.

## Details

### Body and movement [Assumed]
| Parameter | Value |
|---|---|
| Capsule radius / height / eye height | 0.35 m / 1.75 m / 1.62 m |
| Walk speed | 3.2 m/s |
| Sprint speed (Shift) | 5.0 m/s, max 4 s, regen after 2 s idle |
| Aiming move speed | 50% of walk |
| Wading (water to knees) | 60% of walk, no sprint |
| Acceleration / deceleration | 18 / 22 m/s^2 (weighty but responsive) |
| Step height | 0.35 m |
| Jump (Space) | Added later at the owner's request (reverses the original removal). Takeoff 5 m/s at gravity 20 (about 0.58 m of arc at 60 Hz). **Reach 1.00 m** above the takeoff floor [Decided]: while jumping the motor's step allowance rises to ~0.42 m, sized from the arc so the top 4 frames reach 1.00 m (peak ~1.006 m), so desks (0.75) and counters (0.90) can be mounted and anything from ~1.02 m blocks. Only tops with standing headroom (1.75 m clear above) count. Ground only, locked on rails, downed, wading or scripted walks; a ceiling stops the rise. Spec: `openspec/.../player-movement` [Decided] |
| Crouch | Not in slice |
- Head bob scaled by speed (amplitude 0.03 m walk, 0.05 sprint), reduced-motion setting
  scales it to 0.
- Footsteps driven by distance travelled, surface from ADR-0003 `surfaces`. How they sound: [openspec/specs/in-world-audio](../../openspec/specs/in-world-audio/spec.md).

### Aim and look
- Mouse look with pointer lock; sensitivity, invert Y, FOV (70-95, default 80) in settings.
- RMB = aim mode: FOV eases to 80% of base over 0.15 s, spread reduced, laser sight on,
  movement 50%. Dead Space-style "over the sights" feel without a true ADS animation.
- Pitch clamp +/-85 degrees.

### Flashlight
- Spotlight attached to camera with spring lag (stiffness 40, damping 8) so beam trails
  slightly. Angle 26 degrees, penumbra 0.5, range 22 m. F toggles. No battery in slice.

### Health and damage
- 100 HP, no armour. Healing from med packs only (ADR-0008); the medic revives, he does not heal (ADR-0011).
- Damage feedback: red edge tint uniform, short camera kick, 0.3 s movement slow. Below 30 HP:
  desaturation. Audio feedback (the damage muffle): [openspec/specs/audio-mix](../../openspec/specs/audio-mix/spec.md).
- Grab: when an enemy grabs (ADR-0007), camera is turned toward it, movement locked,
  "Mash E" struggle prompt; a teammate can shoot it off.
- **Downed instead of death** [Decided]: at 0 HP the player collapses into a Downed state.
  Only the medic can revive. If the medic is himself down, or does not reach the player before
  the bleed-out timer ends, it is **game over**: fade, restart from the last checkpoint (ADR-0009).
- While downed [Assumed]: view drops to floor height, darkens and desaturates; the player can
  crawl at 0.6 m/s and fire the pistol (no reload); bleed-out timer from ADR-0008, and enemy
  hits drain it faster. The revive is a 3 s medic action; the player gets up with `reviveHp`.
- Revive limit per checkpoint by difficulty; going down past the limit is game over.

### Interaction
- E: raycast 2 m from camera vs interactables; prompt text from the object
  ("Swipe badge", "Open locker"). Some need a hold (0.6 s, radial progress).
- Interactables: doors (player-unlockable ones), lockers, pickups, valves, consoles,
  med stations.

### Shove (melee) [Decided]
- V: 0.25 s windup, 1.4 m cone, pushes enemies 1.5 m back and staggers them, 5 damage,
  1.2 s cooldown. Gives a "guard" tool against slow enemies and breaks grabs faster.

### Dodge (stretch, paired with the lunger enemy) [Decided as stretch]
- Ctrl + direction (or double-tap direction): 0.35 s dash of 3 m, 0.2 s invulnerability,
  1.5 s cooldown. Built only if the lunger (ADR-0007) is built.

### Control API for sequences
```js
player.control.set({ move: 'free'|'slow'|'locked', look: 'free'|'clamped'|'locked',
                     weapons: true|false, flashlight: true|false, interact: true|false });
player.lookAt(target, { duration: 0.8, weight: 0.85 }); // eases view, player can resist 15%
player.clampLook(center, 40);   // degrees cone, used for "soft lock" moments
player.walkTo(pos, speed);      // rare, for forced beats
```
Every sequence that changes control must restore it on end or cancel (sequencer guarantees
this via a control stack).

### Input map
- `data/keymap.json` (rebinding UI later). Keyboard + mouse only for the slice.
  Gamepad [Open].

## Consequences
- Jay can stand on any top up to 1.00 m with headroom (desks, counters, crates). Anything meant to stop him must be
  taller than 1.00 m or have something low over it. Dodge is still the only burst move.
- Enemies step up only 0.35 m (the navmesh climb), so they cannot follow Jay onto a counter. Accepted for now
  [Decided]; revisit if playtests show fights being cheesed (options: enemies reach up, no-climb props).

## Alternatives rejected
- Arcade movement from INKSHOT (fast, jumpy): wrong genre feel.
- Third-person over-the-shoulder like Dead Space: Justin asked for an FPS.

## Execution steps
1. Port pointer lock + input; build controller with acceleration and capsule collision.
2. Flashlight with lag; head bob and footsteps.
3. Aim mode and FOV easing.
4. Interaction raycast and prompt events.
5. Health, damage feedback hooks, death/restart.
6. Control API + control stack.
7. Shove. (Dodge waits for ADR-0007 lunger.)

## Definition of done
- Walking the test level feels heavy but not sluggish; no snagging on door frames or stairs.
- A test sequence can lock movement, soft-lock look and restore control cleanly.

## Open questions
- Gamepad support.

## Implementation note (2026-11-15, Claude) — awaiting Justin's walk test
Built: `src/actors/` — `motor.ts` (cylinder vs ADR-0003 `{min,max}` boxes, 0.35 m step-up,
0.4 m snap-down, rounded-corner sliding, sub-stepped), `control.ts` (control stack),
`vitals.ts` (health / Downed / bleed-out / revive limit), `interaction.ts` (2 m ray, taps and
holds), `player.ts` (movement, sprint stamina, aim FOV easing, head bob, step smoothing,
footstep events, damage feedback, grab + mash, shove, `lookAt` / `clampLook` / `walkTo`),
`debugSequences.ts`. Demo room collision in `src/world/demoRoomColliders.ts`; HUD in
`src/ui/hud/playerHud.ts`. Free camera kept as F1 fly mode under `?debug`.

Verified: `tsc` clean; 81/81 unit tests (18 new: walls, sliding, ledges, stairs up/down,
off-centre door entry, tunnelling, head clearance, falls, control stack restore, vitals);
headless walk of the demo room (3.2 / 5.0 m/s, stops at door, crates, locker; hold-to-use;
move lock; bleed-out; grab escape; plate/grate footsteps).

Not yet verified: in-browser feel, `npm run build` on macOS, `?debug` budget stats, console.
Test with `npm run dev`, then `/?debug&seq=control-test` (DoD: lock + soft-lock + restore).

Gaps / decisions taken:
- ~~Collision is a linear box scan~~ Done: `world/collision.ts` `CollisionWorld` (2 m spatial hash) implements
  `ColliderQuery`; `BoxColliders` remains for hand-built test rooms.
- Revive comes from the debug panel until the medic (ADR-0011). Revives reset per checkpoint.
- Death restarts from the slot's autosave, healed to `checkpointHeal` (ADR-0008 number).
- Low HP shows as a pulsing red grade.
- Interact ray is not occluded by walls; fine while interactables sit on wall faces.
- Shove emits `player:shove`; enemy push and stagger is ADR-0007. Dodge still deferred.
- Game over is a 1.4 s fade, 1 s hold, restart.
