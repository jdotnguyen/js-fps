# ADR-0018: Actor separation (body-vs-body collision)

Status: Proposed (sandbox implementation merged for review)

## Context
Humanoids have hit capsules for shots (ADR-0006) and the player has a level collider motor (ADR-0004),
but nothing keeps one body out of another. In the actors sandbox every enemy walks to the same point
(the camera), so they stack into one overlapping mass, and a hero (2.15 m, build 1.25) disappears into
the crowd around it. ADR-0007 lists "separation (radius 0.8 m)" under local steering, but `src/ai/` is not
built yet, and a single fixed radius cannot fit both a crowd body and a hero.

Justin saw this in the sandbox and asked for the fix to be recorded as a decision and a spec [Decided].

## Decision
One pure module, `src/actors/separation.ts`, gives every humanoid a ground footprint circle and pushes
overlapping circles apart each frame. It is a soft position constraint, not a physics engine. It runs
after steering and before animation. ADR-0007's AI calls the same function, so nothing here is
sandbox-only.

## Details

### Footprint and mass [Assumed]
| Body | Radius (m, at build 1) | Mass |
|---|---|---|
| Crowd humanoid | 0.28 x build | 1 |
| Hero | 0.36 x build | 4 |
| Immovable (corpse, seated NPC, play-dead, player) | any | Infinity |

Radius scales with `build` because build scales body width. A hero at build 1.25 is 0.45 m, about 0.9 m
across, which is wider than the old fixed 0.8 m spacing.

### Algorithm [Assumed]
- Up to 3 relaxation passes per frame over all pairs (O(n^2); n stays under ~24 by the ADR-0007 spawn
  limit; a spatial hash replaces the loop if n grows).
- For an overlapping pair, push each body along the line between centres by `overlap x 0.8`, capped at
  0.08 m per pass, shared by inverse mass. So a hero moves a crowd body about four times as far as the
  crowd body moves it, and immovable bodies never move.
- 0.02 m of overlap is tolerated (slop) so bodies standing shoulder to shoulder do not jitter.
- Two bodies on exactly the same spot escape in a direction taken from their indices (deterministic, so
  replays and tests agree).
- `separate()` returns the deepest overlap left, so callers can tell when it has converged.

### Where it runs
1. AI/steering moves bodies.
2. `separate()` over every body plus the player circle (radius 0.35, immovable).
3. Level collision (the ADR-0004 motor resolve, or the sandbox room clamp) runs last, so separation can
   never push a body through a wall. A body wedged against a wall can still overlap a neighbour; that is
   accepted.
4. Animation reads the final position.

### Which bodies move
- Move: enemies in `alive`, `falling` or `gettingUp`.
- Immovable: corpses, NPCs, `playingDead`, `dead`, the player. Severed parts and gibs are debris
  (ADR-0006 budget of 24) and do not take part.

### Sandbox
`sandbox/actors.html` applies it by default. `?nosep` turns it off to compare with the old overlap.

## Consequences
- Crowds queue around a target and the hero visibly shoves them aside.
- The footprint is a circle, so a hero's outstretched slam arm can still pass through a neighbour.
  Per-limb collision is out of scope.
- Bodies pushed into a wall by a stronger neighbour may squeeze together.
- Steering still has to avoid walking into each other on purpose (ADR-0007 keeps its seek and wall
  avoidance); this pass only fixes what steering misses.

## Alternatives rejected
- Rigid-body physics (Rapier or cannon): heavy dependency and a determinism cost for a small number of
  upright bodies.
- Fixed 0.8 m radius for everyone (ADR-0007 as written): too tight for the hero, too loose for crowd bodies.
- Using the hit capsules: they follow the animated pose and are built for rays, so the footprint would
  wobble with the animation.
- Steering-only avoidance: cannot fix bodies that are knocked back, staggered or spawned overlapping.

## Execution steps
1. `separation.ts` with unit tests. Done.
2. Sandbox integration with `?nosep`. Done.
3. ADR-0007 AI calls `separate()` after steering, and its fixed 0.8 m figure is replaced by this ADR's radii.
4. Hero: slam attack and knockback reuse the same mass model (hero item 4 in the ADR-0006 progress list).
5. Measure the cost on the M2 with 8 crowd bodies and 3 heroes (ADR-0015).

## Definition of done
- In the sandbox, 8 crowd bodies and the hero converging on the camera end up in a ring with no visible
  clipping, and the hero is not pushed around by them.
- `separation.test.ts` passes; `tsc` is clean.
- The pass costs under 0.1 ms per frame at 12 bodies.

## Open questions
- Should heroes also push the player (a shove that moves the player circle)? Needs ADR-0004.
- Per-limb hit reach for the hero's slam (see ADR-0006).

## Progress
### 2026-11-17: step 3 (game AI)
`EnemyDirector.update` (`src/ai/enemyDirector.ts`) steers every enemy, then runs `separate()` over their
planned positions with these radii and masses (play-deads and corpses immovable), plus the player (0.35 m) and
the squadmates (0.3 m) as immovable circles, then moves each enemy through the ADR-0004 motor, so walls win.
Hero slams stagger and push crowd bodies within the slam radius. Not yet measured in a browser.
