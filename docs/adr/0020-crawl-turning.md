# ADR-0020: Turn-then-move steering for crawlers and draggers

Status: Proposed (implemented for review)

## Context
Bodies that crawl (one leg lost) or drag (both legs lost) rotated at a fixed rate while still sliding forward, and
the limb cycle only advanced with ground speed. A body turning on the spot therefore pivoted like a statue with
frozen limbs, and one turning on the move slid sideways through the turn. Justin called it floaty and asked
for natural movement: actually turn around, then move forward.

## Decision
Heavy movers (`locomotion.mode` crawl or drag) use turn-then-move steering from `src/actors/turning.ts`:
1. If the target is well off the heading they stop and pivot in place.
2. The limbs act out the pivot (the turn drives the crawl cycle).
3. They move off only once they face the target, steering gently while moving.
4. The pivot happens around the planted hands, not the hips.
Walkers (including limping ones) keep the existing smooth turn.

## Details [Assumed]
| Rule | Crawl | Drag |
|---|---|---|
| Stop and pivot above a heading error of | 40 deg (0.7 rad) | 34 deg (0.6 rad) |
| Move off again below | 11 deg (0.2 rad) | 11 deg (0.2 rad) |
| Top turn speed pivoting / moving | 1.6 / 0.6 rad/s | 1.2 / 0.45 rad/s |
| Pivot point ahead of the body origin | 0.32 m | 0.4 m |
| Limb drive while pivoting | 0.28 m/s per rad/s of turn | 0.22 m/s per rad/s |

- Two thresholds (start and end) stop the body flickering between pivoting and moving near the boundary.
- Turn speed eases toward what is wanted (8 per second) instead of jumping, and never carries the heading past
  the target.
- While moving, speed falls up to 50% as the heading error grows toward the pivot threshold. A pivoting body
  brakes at once.
- Animation (crawl): the arm on the outside of the turn pulls harder and the inner arm mostly anchors. The head
  turns toward the target first, with the neck, chest and spine following (60% / 20% / 20% / 10% of the error, up
  to 60 degrees), so the body appears to follow the head.
- Animation (drag): same lead; both arms keep hauling.

## Consequences
- Crawlers become slower to change direction, which reads as weight and gives the player a window to move.
- A pursuing crawler that the player circles will keep stopping to re-aim; this is intended.
- The planted-hands pivot moves the body origin a little during a turn, so anything reading the body position
  (separation, AI) sees it shift by up to about 0.4 m.
- Tuning is by eye: the numbers above are the first guess.

## Alternatives rejected
- Keep the fixed turn rate and only slow the speed: the limbs still freeze.
- Root motion from keyframed turning clips: needs animation clips the project does not have.
- Foot IK planting: a bigger change than the visible problem needs.

## Execution steps
1. `turning.ts` and tests. Done.
2. `humanoid.move` and the crawl and drag gaits use it. Done.
3. Tune thresholds and the limb drive by watching a crawler turn in the sandbox.
4. If it reads well, give walkers a milder turn-first rule for very sharp turns.

## Definition of done
- A crawler turned around by the player stops, pivots with moving arms, then crawls off in a straight line.
- No sliding sideways during the turn; `turning.test.ts` and `tsc` pass.

## Open questions
- Should the hero, when it has a slam attack, use the same rule at a larger turn radius?
