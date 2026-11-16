# ADR-0011: Squad AI and specialists

Status: Accepted (behaviour goals, medic revive rule) / Proposed (numbers)

## Context
Two squadmates fight alongside the player, effectively but less effectively than the player
[Decided]. They are specialists who unlock things a guard cannot [Decided] and give audible
hints [Decided]. They act on their own, with no commands [Decided]. Nobody on the team dies
in this slice [Decided]. The engineer is secretly infected and is the cliffhanger reveal
[Decided]. The second specialist is a **medic whose role is to revive the player**; if the
medic is down when the player goes down, nobody can revive and it is game over [Decided].

## Decision
Each squadmate runs a utility-scored behaviour selector over Follow, Combat, Task, Revive and
Downed. Their combat role is **support**: they cripple and stagger, the player does most of
the killing [Decided]. The medic is the player's only safety net, so protecting him is part
of the play.

## Details

### Roles
| | August Giles (Engineer) | Dr. Tomas Okafor (Medic) |
|---|---|---|
| Weapon | Compact rivet pistol | Sidearm |
| Specialist actions | Bypass doors, restore power, reroute systems, unlock lockers | Revives the player (only he can); revives Giles; opens biometric med-lab locks [Decided] |
| Does not | Heal or revive | Heal the player outside of revives |
| Combat style | Front-mid range, aims at legs | Stays 4-8 m behind the player, aims at arms, prioritises grabbers |
| Story | Hidden infection, foreshadowed | Explains the infection |

### Being significant but not the hero [Decided]
- Damage = player weapon damage x `squadDamage`; accuracy `squadAccuracy` (ADR-0008).
- Prefer limb shots that cripple (legs) or save (arms of a grabber) over kills. Targets
  prefer enemies threatening the player, the working teammate or the medic.
- **Kill-share guard:** if squad kills in the current fight exceed 35% of the total, their
  damage halves until the player catches up. Invisible to the player.
- Fire rate 50-60% of the player's weapon; they reload often and call it out.

### Behaviour selector
Scored every 0.25 s; highest wins with hysteresis.
- **Follow:** formation slots out of the player's aim cone (15 degrees); sidestep if aimed
  through. Soft collision so the player can push past. Catch-up teleport if > 25 m away and
  not visible. The medic's slot is always behind the player.
- **Combat:** positions near walls, not in doorways; back off when an enemy is within 2 m
  (the medic backs off at 4 m); shove if grabbed (no struggle for NPCs).
- **Task (Giles):** walk to the panel, working pose, progress on the panel screen. Durations
  from task data (`bypass_short` 8 s, `bypass_long` 20 s, `power_restore` 30 s). If an enemy
  comes within 3 m the task pauses, he calls for help, defends, then resumes. Progress never
  resets.
- **Revive (Okafor):** top priority when the player is downed. Paths to the player, kneels,
  3 s revive with a progress ring on the player's screen. Being hit pauses the revive.
  Enemies weight a reviving medic at 1.0 (as high as the player), so the player must cover
  him from the floor with the pistol. He also revives a downed Giles (3 s) when safe.
- **Downed:**
  - Giles: falls for 6 s, gets up at 50% HP on his own, or sooner if revived.
  - Okafor: falls for `medicDownedTime` (ADR-0008) and gets up on his own. Nobody can revive
    him. While he is down the player has **no safety net**: medic icon flashes, Giles barks
    ("Doc's down! Don't you go down too!").
  - Neither can die in the slice; the player can lose, they cannot.
- Enemy target weights: player 1.0, medic 0.7 (1.0 while reviving), working Giles 0.9,
  otherwise 0.6.

### Hints and chatter
- From ADR-0010. Idle chatter in quiet areas carries story and foreshadowing.

### Engineer reveal hooks
- `giles.infectionStage` exists from the start (0). Visual tells: forearm rubbing, a bandage
  after his off-screen moment, a cough, voice rasp (ADR-0010). The final sequence uses
  `transform` (ADR-0006) on him.

## Consequences
- The revive rule turns the medic into the thing the player protects, which reinforces the
  "team contributes as much as me" goal without making him a fighter.
- "Can squadmates die" is settled for the slice: no. Player failure (game over) is settled.

## Alternatives rejected
- Medic heals on demand: removes tension and overlaps med packs.
- Player commands: Justin chose autonomous teammates.

## Execution steps
1. Squad entity with humanoid body, outfits and weapon.
2. Follow with formation slots and aim-cone avoidance.
3. Combat targeting with role preferences and the kill-share guard.
4. Giles tasks with pause/resume and panel progress.
5. Player downed state (ADR-0004) + Okafor revive + game-over rule.
6. Squad downed/get-up; Okafor revives Giles; biometric lock task (`biometric` 5 s, same pause/resume as Giles's tasks).
7. Reveal hooks.

## Definition of done
- In a test fight with 6 shamblers on Standard, the player gets >= 65% of kills and nobody
  blocks the player's fire for more than a moment.
- Going down with Okafor up leads to a revive; going down while he is down is game over.
- A "cover me" task completes with pauses when enemies reach Giles.

## Open questions
- Whether squadmates can die in later chapters.
