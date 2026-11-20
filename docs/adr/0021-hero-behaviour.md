# ADR-0021: Hero tier behaviour (heavy gait, slam attack, toughness, weak spot)

Status: Proposed (implemented in the actors sandbox for review)

## Context
The hero tier (ADR-0006, `spec.hero`) had its own look but moved and died like a shambler. Justin is happy
with fewer, bigger, tougher monsters if that buys detail, and the handoff asked for a heavy slow gait, a slam
attack, and damage rules for a tougher unit: 400+ HP, shrugs off limb hits, with a weak spot such as the belly.

## Decision
Heroes get four things, all keyed off `spec.hero`:
1. A damage profile (`HERO_PROFILE` in `damage.ts`) instead of the shambler tables.
2. A weak spot: the painted belly wound (`BELLY_WOUND` in `heroSculpt.ts`), tested by hit position.
3. A heavy gait (`heavy` gait style in `animator.ts`) at reduced speed and turn rate, with no lurch bursts.
4. A slam attack with pure timing and hit rules (`slam.ts`), started by the AI through `Humanoid.tryAttack`.

## Details [Assumed unless noted]

### Damage
| Rule | Shambler (ADR-0006) | Hero |
|---|---|---|
| Base HP | 100 | 400 |
| Torso pool | 2.0 x base = 200 | 1.2 x base = 480 |
| Damage taken: limbs and head | 1.0 | 0.5 |
| Damage taken: torso | 0.5 | 0.15 |
| Damage taken: weak spot (goes to the torso pool) | - | 2.0 |
| Stagger | every leg hit (ADR-0019) | 30 damage within 0.4 s, or any weak-spot hit (which also cancels a slam) |

Against the 18-damage pistol: a body shot does 2.7 and a belly shot 36, so the belly kills in 14 shots
(measured in the sandbox) against about 180 shots to the body. A thigh takes about 16 hits to sever. Severing,
crawling and limb deaths (ADR-0006, ADR-0019) still apply, so crippling a hero is possible but slow.

The weak-spot area is the painted wound ellipse, made 25% more generous, tested in spine space for a hit on any
torso capsule. In the hunched pose the chest and pelvis capsules cover the belly from the front, so testing only
the spine capsule missed every belly shot.

### Movement
- Walk speed 49% of a shambler's (0.64 m/s; was 72%, 0.94 m/s, Nov 18): one 1.6 m heavy stride per 2.5 s, the cycle length of the necromorph's own walk clips, so the feet do not slide, turn speed 1.2 rad/s (shambler 2.2). No lurch bursts.
- Heavy gait: 1.55 m strides, the knee lifted through the swing and the foot driven down, a big pelvis roll
  onto the planted leg with the shoulders countering, arms hanging and swinging late. The body drops sharply
  as each foot lands. `Humanoid.footfall` reports each landing; the sandbox shakes the camera within 8 m.
- A wounded leg (ADR-0019) shortens its stride in the heavy gait too.

### Slam
| Rule | Value |
|---|---|
| Starts when | target within 2.2 m and within 0.5 rad of the heading, off cooldown, walking, not staggered |
| Windup (the warning) | 0.8 s, arms raised overhead and jaw wide; can still turn at 0.9 rad/s to track |
| Strike | 0.16 s |
| Impact | 1.25 m in front, radius 1.3 m, 45 damage, full within 0.65 m, smooth falloff to the edge |
| Recover (the punish window) | 1.0 s, held crouched for the first 45% |
| Cooldown | 2.6 s |
| Cancelled by | a weak-spot hit, losing a limb, falling, dying |

The impact is reported once (`consumeSlamImpact()` returns the floor point); the caller applies
`slamFalloff(distance)` to the player and anything else in reach. The sandbox shows the damage the player would
have taken and shakes the camera. Player health and knockback belong to ADR-0004 and ADR-0008.

## Consequences
- Heroes reward aim: the belly is fast, everything else is very slow, and a belly hit interrupts a slam.
- The windup and recovery give the player a readable rhythm: back off during the windup, punish during the recovery.
- The weak spot is a fixed place on every hero. A second hero type (the Choir Elder) should get its own.
- The impact pose brings the hands to about 0.55 m above the floor, not to the floor; that reads as a crash at
  game distance but could be deepened.

## Alternatives rejected
- Weak spot as its own hit capsule: capsules follow joints and are built for rays; the belly sits between three
  torso capsules in the hunch. Testing the hit point against the painted wound keeps visuals and rules together.
- Making limbs immune: removes the ADR-0006 promise that any body can be crippled.
- Root-motion slam clip: there is no animation pipeline; two poses plus timing are enough for a first pass.

## Execution steps
1. `damage.ts` profile, weak spot and poise, with tests. Done.
2. `slam.ts` and tests; `Humanoid.tryAttack`, impact and slam poses. Done.
3. Heavy gait and footfalls; sandbox AI, camera shake and HUD. Done.
4. ADR-0007 AI calls `tryAttack` and applies `slamFalloff` to the player and squad; knockback (ADR-0004).
5. Slam sound and a floor decal or dust (ADR-0013).

## Definition of done
- In the sandbox the hero stomps in, winds up, slams in front of the camera and is open while recovering.
- Belly shots read as `WEAK SPOT` in the HUD and kill in about 14 pistol shots; body shots barely mark it.
- `damage.test.ts` and `slam.test.ts` pass; `tsc` is clean.

## Open questions
- Should a slam also knock nearby shamblers aside (via ADR-0018 masses)?
- Should the hero enrage (faster windup) below some torso HP?

## Progress
### 2026-11-17: steps 4-5 (game AI, sound)
The `hero` variant (`src/data/enemies.json`) chases through the navgraph without lurching and calls
`Humanoid.tryAttack` in slam range; it keeps tracking through the windup. On impact the director applies
`slamFalloff` x 45 to every target (player through `Player.damage`, squadmates via `enemy:attack`), knocks
them back (up to 4.5 m/s, the player through `player.velocity`) and staggers shamblers in the radius, which
answers the first open question with "yes". `enemy:slam` plays a slowed `metalKnock`; the floor burst from
`humanoid.ts` stands in for dust. Try `/?level=kit_test&enemies=hero`. Not seen in a browser yet.
