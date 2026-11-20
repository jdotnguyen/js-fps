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
- Idle chatter in quiet areas carries story and foreshadowing.

### Engineer reveal hooks
- `giles.infectionStage` exists from the start (0). Visual tells: forearm rubbing, a bandage
  after his off-screen moment, a cough, voice rasp. The final sequence uses
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

## Progress
### 2026-11-16: steps 1-2 (squad entity, follow) — `src/ai/squad.ts`
- Giles and Okafor spawn as humanoids with their ADR-0022 looks (`actors/squadLooks.ts`), move
  through the player's collision motor, and are placed near Jay on new game, load and restart
  (any jump of more than 4 m).
- Follow: every 0.25 s each picks a target: a formation slot (Giles 1.4 m right / 1.8 m back,
  Okafor 1.0 m left / 3.2 m back, mirrored to the near side if needed) when Jay can see it and it
  is somewhere to stand; else a point on Jay's breadcrumb trail (2.6 / 4.2 m back); else beside
  him. Targets inside Jay's 15 degree aim cone, or whose straight route crosses it, are rejected.
- Aim cone: a mate in the cone sidesteps the minimum distance that clears it, committed to one
  side, at a quick-hop speed. Measured: 0 s in the cone while Jay holds his aim; up to ~1 s while
  Jay spins 180 degrees on the spot with Okafor straight in front of him.
- Speed scales with distance from walk (1.4 m/s) to just over Jay's sprint (5.2 m/s). Soft
  separation from Jay (1.1 m) and each other (0.9 m); Jay never collides with them.
- Catch-up teleport when more than 25 m away and out of Jay's view, onto his trail behind him.
- Tests: `squad.test.ts` (follow down the demo corridor, no wall clipping, out of the aim when
  held, regroup after a restart). Headless walk through kit_test: max 7 m behind, no teleports,
  no wall clipping.
- Known gaps: walk animation is not speed-matched, so they may look like they glide when running;
  during the intro cutscene they still follow instead of being scripted (host `npc:*` actions are
  still stubs); not yet seen in a browser.
### 2026-11-16: calmer follow (Justin's playtest note: too fast, scrambling when he turns)
- Within 3 m (10 ft) of Jay, or on reaching their spot near him, they stop and stay put until he
  is more than 4.5 m away. Hook for later: an object they need to use nearby will override this.
- Speeds: 1.3 m/s walk; brisk 2.4 m/s past 6 m behind; 3.4 m/s jog past 12 m. Gentler
  acceleration and turning (3.2 rad/s); idle turn toward Jay only when he is well off to the side.
- They clear the line of fire only when Jay aims (aim held 0.35 s), with a step, not a hop.
- Headless kit_test walk: up to ~12 m behind while Jay walks 24 m, no teleports or clipping, and
  no movement at all while he turns on the spot for 25 s.
### 2026-11-17: steps 3-7 (combat, tasks, revive, downed, biometric, reveal hooks) + scripted NPCs
Code: `src/ai/squadBrain.ts` (pure pieces), `src/ai/squad.ts` (selector and bodies),
`src/ai/squadEnemies.ts` (wiring to the ADR-0007 enemy director), `src/ai/npcs.ts` +
`src/ai/npcActor.ts` (NPC director, sequence `npc*` actions), `src/actors/castLooks.ts`.
- **Selector** (every 0.25 s, after the follow think): revive > task > combat > follow; downed
  overrides everything. A squadmate a sequence drives (`scripted`) skips its AI entirely and is
  not moved by restart placement or the catch-up teleport.
- **Combat:** targets scored by threat (grabbing Jay +3, the medic +4 for grabbers; near Jay, the
  medic, or a working Giles), distance and stickiness, line of sight through the navgraph. Aim:
  Giles legs (torso once legs are gone), Okafor arms, grabbers' arms for both. Fire every ~0.33 s
  (55% of the pistol), 10-round mag, 2.2 s reload (`squad:reloading`). Damage = 18 x
  `squadDamage`, hit chance `squadAccuracy`. **Kill-share guard:** above 35% of a fight's kills
  their damage halves; a fight ends after 8 s with nobody in combat. Back off from enemies within
  2 m (Okafor 4 m). Shots go through `EnemyDirector.applyHit` with `by` = the mate's id, so gore,
  severing and alerting work like the player's.
- **Tasks:** `squad.startTask(id, kind, { at, yaw, panel, duration })` or sequence `npcTask`
  (`args: { at, panel, duration }`). Durations: bypass_short 8, bypass/bypass_long 20,
  power_restore 30, reroute 12, unlock_locker 6, biometric 5 (Okafor). Walk there, work pose,
  pause while an enemy is within 3 m (he turns and shoots), resume, never reset. Events
  `squad:taskStarted/Progress (every 10%)/Paused/Resumed/Done` with `{ id, task, panel, progress }`.
- **Revive:** Jay downed -> Okafor jogs over, kneels, 3 s (`squad:reviveProgress` for the ring),
  a hit pauses it 0.6 s, then `player.revive()` and `squad:revived`. He revives a downed Giles
  (3 s) when no enemy is within 6 m. **Game-over rule:** Jay going down while Okafor is down emits
  `squad:gameOver` and kills Jay (`player.damage(1e6)` drains the bleed-out).
- **Downed:** mates have 100 HP (`squad.damageMate`, wired from enemy hits). Giles 6 s, Okafor
  `medicDownedTime`, both up at 50 HP; `squad:downed`, `squad:up`, `squad:noSafetyNet`. Enemy
  weights: medic 0.7 (1.0 reviving), working Giles 0.9, else 0.6; downed mates are not targets.
- **Reveal hooks:** the `giles.infectionStage` flag (0-3, 4 = reveal) drives `speech.setRasp`
  (0 / 0 / 0.25 / 0.45 / 0.6), `setLaugh(false)` at 4, and idle tells (rub_forearm, flex_hand,
  cough) with `squad:tell`. The body's `transform` is the sequence action.
- **Barks:** no lines written here; every beat above is a `squad:*` event for the bark system.
- Tests: `squadBrain.test.ts` (7), `squad.test.ts` (10: a 6-shambler corridor fight where Jay gets
  >= 65% of kills with the guard, revive, game over, Giles down/revived/up at 6 s, cover-me task
  pause/resume, biometric 5 s, reveal ladder, scripted yield), `npcs.test.ts` (9).
- Known gaps: not seen in a browser; poses (aim, kneel, downed, gestures) are first-pass numbers;
  squad shots have no tracer, muzzle flash or sound yet (`squad:fired` is there to hook);
  `setLaugh` has no SpeechManager implementation and no SpeechManager is wired in main.ts yet, so
  rasp/laugh only take effect once the dialogue system passes one in (`Squad` dep `speech`);
  stage 2's rolled sleeve/bandage is not a geometry change yet; enemies currently only grab Jay,
  so the squad's shove-off-a-grabber path is unused; medic "4-8 m behind" in combat relies on his
  follow slot (3.2 m) rather than a combat position.
