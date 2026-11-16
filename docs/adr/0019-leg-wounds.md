# ADR-0019: Leg wounds (stagger, limp, then dismember and fall)

Status: Proposed (implemented for review)

## Context
ADR-0006 [Decided] severing a leg makes a body fall and crawl at 55% speed, or drag at 40% with both
legs gone. Until a leg comes off, a leg hit did nothing: a shambler with a nearly destroyed thigh walked
exactly like a fresh one, so the first shots gave no feedback. Justin wants shots to the legs to show
effect first, and enough damage to dismember the leg and drop the body.

## Decision
A leg hit goes through three stages. The first two are new; the third is ADR-0006 unchanged.
1. **Stagger** (every leg hit that does not sever): the body flinches and nearly stops for a moment.
2. **Limp** (once a thigh or shin has lost 40% of its own HP): a visible limp gait and a slower walk, getting
   worse as the part nears severing.
3. **Sever, fall, crawl** (part HP reaches 0): the leg comes off, the body falls, then crawls (ADR-0006).

## Details [Assumed unless noted]
| Rule | Value |
|---|---|
| Part HP, severing, fall, crawl 55% / drag 40% | ADR-0006 [Decided], unchanged |
| Stagger | 0.35 s at 30% of walk speed on any non-severing hit to a thigh or shin, on top of the hit kick |
| Limp threshold | thigh or shin has lost 40% of its own HP |
| Limp strength | 0.4 at the threshold, rising to 1 at severing |
| Walk speed while limping | 1 - 0.25 x limp, so 90% at the threshold and 75% at the worst |
| Which leg | the more wounded one |
| Gait | the wounded leg takes a shorter stride and a stiffer knee, with a pelvis lean to that side (the existing lame-shambler animation, driven by damage instead of a seed) |

Thresholds are per part, not per leg total, because a thigh alone reaches 100% at the severing point; a
combined measure could never reach the limp threshold on one part before it severed.

Examples at base HP 100 (thigh and shin are 35 HP each) and the 18-damage pistol: the first hit to a leg
staggers and starts the limp, and the second takes the leg off. A 400-HP hero has 140 HP legs: the first two
pistol hits only stagger, the limp begins around the third, and severing takes about eight hits. The hero's own
tougher rules (HP, the weak spot, shrugging off limb hits) belong to ADR-0006's hero work and can raise those
numbers.

`BodyDamage.locomotion()` reports `limp` and `limpSide`, so the AI (ADR-0007) can read them to pick speed,
attacks and whether to keep advancing.

## Consequences
- Shots to the legs read at once, and the player can choose to cripple instead of kill.
- Slowing a walker by 10-25% is small next to the crawl, so a limping enemy is still a threat until the leg goes.
- Stagger is speed only (no animation of its own beyond the kick), so a rapid shotgun burst can hold a body in
  place. That is intended, but the AI may need a cap if it makes enemies trivial.

## Alternatives rejected
- A random knock-down on leg hits: unpredictable and it hides the progression the player is trying to read.
- Knock-down on the first heavy hit: with a pistol 18 against 35 HP, nearly every first shot would count.
- One limp value from combined thigh and shin HP: cannot be reached by hitting a single part, see above.

## Execution steps
1. `damage.ts`: leg wound, limp and slowdown in `locomotion()`, with tests. Done.
2. `humanoid.ts` and `animator.ts`: stagger, and the wounded leg drives the gait. Done.
3. ADR-0007 AI reads `limp` and `limpSide`; a staggered body does not start a new attack.
4. Hero: set its own thresholds with the hero damage rules.
5. A knock-down animation for very heavy hits, if it turns out to be wanted.

## Definition of done
- In the sandbox, one pistol hit to a thigh visibly slows a shambler into a limp, and a second severs the leg and
  drops it into a crawl.
- `damage.test.ts` and `tsc` pass.

## Open questions
- Should arm hits also flinch? (They currently only change grab strength.)
- Does a limp need its own sound (a drag or a grunt)?
