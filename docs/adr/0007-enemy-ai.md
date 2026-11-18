# ADR-0007: Enemy AI, navigation and variants

Status: Accepted (roster) / Proposed (behaviour numbers)

## Context
Enemies are slow, walking, zombie-like infected humanoids [Decided], plus a play-dead
variant [Decided]. A lunging variant is wanted only together with a dodge mechanic
[Decided as stretch]. Slow enemies must still feel threatening in tight corridors, and
they should go after the squad too so "cover me" moments work.

## Decision
A shared navgraph and pathfinder for all AI (enemies and squad), a finite-state machine per
enemy, and data-defined variants in `data/enemies.json`.

## Details

### Navigation
- Navgraph built automatically from kit `navNodes` and door sockets (ADR-0003). Edges link
  nodes with clear line of sight within 6 m; door edges are blocked while the door is not
  open.
- A* over the graph; then direct steering when there is line of sight to the target.
- Local steering: seek + separation + wall avoidance using colliders. Separation uses the per-body
  footprints and masses of ADR-0018 (not a fixed 0.8 m radius).
- Repath every 0.5 s or when a door changes state.
- Special movers: `vent` (enemy emerges from a vent spawn with an animation) and
  `ceiling_drop`.

### Perception
- Sight: 110 degree cone, 18 m in light, 8 m in darkness; the player's flashlight beam
  counts as light (shining at enemies alerts them).
- Hearing: gunshots 25 m, shove/impacts 8 m, footsteps 4 m (sprint 8 m); sound travels
  through open doors only (room graph distance).
- Alert propagates to enemies within 6 m.

### Shambler state machine
`Dormant -> Alerted (groan, 0.5-1.2 s) -> Approach -> Windup -> Attack -> Recover`
plus `Stagger`, `Crawl`, `Blind`, `Dead`.
| Parameter [Assumed] | Value |
|---|---|
| Walk speed | 1.3 m/s |
| Lurch burst | 2.4 m/s for 0.6 s, every 4-7 s (keeps them threatening) |
| Attack range | 1.4 m |
| Windup telegraph | 0.8 s (arms raise, scream) |
| Swipe damage | 15 (x difficulty) |
| Grab chance (if both arms) | 35% of attacks on the player |
| Stagger | from shotgun, shove, or losing a limb; 0.9 s |
- **Grab:** player locked, camera turned to enemy, struggle via mashing E (count by
  difficulty), 8 damage per second while held. A teammate within line of sight will
  prioritise shooting the grabber's arm off.
- **Target selection:** score = threat weight / distance; player weight 1.0, teammates
  0.6, a working teammate 0.9 (so specialists get attacked while doing tasks).

### Play-dead variant
- Spawns in a corpse pose among real corpse props (same humanoid builder, so
  indistinguishable at a glance; one subtle tell: slight breathing twitch visible when lit).
- Wakes when: player within 3 m, shot, or scripted. Get-up animation 1.2 s (vulnerable),
  then normal shambler behaviour with faster first lurch.

### Lunger variant (stretch; build only with dodge, ADR-0004)
- Crouched idle on walls/floor, telegraph 0.6 s (screech + glowing growths), leaps 7 m at
  9 m/s, 30 damage, 1.5 s recover (vulnerable, takes 1.5x damage).

### Spawning and limits
- Enemies placed in level JSON or spawned by sequences (ADR-0009) at `spawns`.
- Max 8 active; queued spawns wait. Corpses (dead enemies) persist up to 16, then fade.

### `data/enemies.json` (abridged)
```json
{ "shambler": { "baseHp": 100, "walk": 1.3, "lurch": [2.4, 0.6, 4, 7],
                "attack": { "range": 1.4, "windup": 0.8, "damage": 15, "grabChance": 0.35 },
                "sight": [110, 18, 8], "infectionStage": [2, 3] },
  "playdead": { "extends": "shambler", "wakeRadius": 3, "getUp": 1.2 } }
```

## Consequences
- The same navgraph and steering are reused by squad AI (ADR-0011).
- Lurches make slow enemies dangerous without making them fast.

## Alternatives rejected
- Navmesh (recast-navigation-js): better for open spaces, but a new WASM dependency;
  corridors suit a graph.
- Behaviour trees: more flexible but heavier than needed for three behaviours.

## Execution steps
1. Navgraph generation + debug draw; A*; steering.
2. Perception.
3. Shambler FSM with lurch, windup, swipe, stagger, crawl/blind states (from ADR-0006).
4. Grab + struggle.
5. Play-dead.
6. Spawn system and limits.
7. (Stretch) Lunger + dodge.

## Definition of done
- Shamblers path around corners and through doors, never get stuck for more than 2 s.
- A play-dead in a pile of corpses reliably surprises a playtester.

## Open questions
- Lunger and dodge (stretch).

## Progress
### 2026-11-16: step 1 (navgraph, A*, steering) — `src/ai/nav.ts`
- `NavGraph` over any `ColliderQuery` (kit levels' `CollisionWorld`, the demo room's `BoxColliders`).
  Edges link nodes within 6 m whose straight line is clear at shin and chest height, down the
  middle and along both shoulders (0.3 m). Edges through a door's closed box are door edges,
  passable only while that door is open.
- Nodes: kit `navNodes`, a node 1.2 m either side of every door, and a 1.5 m grid fill at floor
  level (`World.navGraph()`); the demo room uses a 1 m grid. kit_test: 63 nodes, 592 edges, ~15 ms.
- `findPath`: straight line when clear, else A* from the nearest visible node, then string pulling.
- Local steering for the squad is separation + the ADR-0004 motor's wall sliding; enemy
  separation and repath-on-door-change land with step 3.
- Tests: `nav.test.ts` (pillar detour, open/closed door). Headless check on kit_test: every node
  reachable with doors open except one authored node at the vault's dead end (0, 0, -12): check
  that piece's nav node in the browser.
- Not verified in a browser yet (no dev server from the cloud session): debug draw of the graph
  is still to do.

### 2026-11-17: steps 2-6 (perception, shambler FSM, grab, play-dead, spawning) and game integration
Code: `src/ai/perception.ts`, `enemy.ts` (one enemy: body + state machine), `enemyDirector.ts` (all enemies:
spawning, noise, separation, grabs, slams, events), `spawner.ts` (queue and cap), `enemyData.ts` +
`src/data/enemies.json` (variants: `shambler`, `hero`, `playDead`), `enemyTargets.ts` (player and squad
adapters), `enemyGame.ts` (main-game wiring), `src/actors/shots.ts` (player hitscan, ADR-0005 numbers).
- **Perception** (every 0.2 s, staggered): 110 degree cone, 18 m when the target is lit (flashlight on) or
  the enemy is in the beam, 8 m otherwise, LOS by segment test against the level colliders (closed doors
  block). Anything within 1.6 m is felt whatever the cone (blind bodies rely on that and on sound). Hearing:
  gunshot 25 m, shove 8 m, footstep 4 m, sprint 8 m, through a clear line or a nav route (open doors only)
  no longer than 1.15 x the radius. Alerts spread 6 m. Memory: chase for 6 s after losing the target, then
  search the last known spot, give up after 14 s.
- **States**: dormant (idle or a slow wander near home) -> alerted (groan 0.5-1.2 s) -> chase (nav
  `findPath`, repath every 0.5 s when the goal moves or at once on any `door:state`; lurch 2.4 m/s for 0.6 s
  every 4-7 s x `enemyLurchInterval`) -> windup 0.8 s (arms out, slow tracking) -> swipe 15 / bite 10 ->
  recover 0.7 s; plus search, stagger, grab, playDead, waking, dead. A staggered body (leg flinch or AI
  stagger) never starts an attack. Crawlers/draggers bite at 1.0 m and never grab; bite-only (no arms) bites;
  blind bodies flail and follow sound. Walk speed comes from `Humanoid.steer` (limp, crawl, drag). Unsticking:
  no progress for 1 s drops the path and sidesteps 0.6 s. Movement: steer -> `separate()` (ADR-0018 radii,
  player and squadmates immovable) -> the ADR-0004 motor.
- **Stagger**: shove (`player:shove`), 3+ shotgun pellets on one body (with a small knock back), losing a
  limb, a hero slam nearby: 0.9 s (heroes shorter).
- **Grab**: 35% of strikes on the player with both arms, one grabber at a time, via `player.grab()`; 8 dps x
  `grabMul`. Ends when the player mashes free (grabber staggers 1 s), when the grabber loses an arm or takes
  30 damage while holding (a teammate shooting it off), or dies; `player.releaseGrab()` is called.
- **Play-dead**: spawns in a random corpse pose, immovable for separation. Wakes when a target is within 3 m,
  within 6 m while looking away, a gunshot within 2.5 m, being shot, or a script; gets up (the `getUp`
  sequence), then hunts with an immediate first lurch.
- **Hero**: no lurch; `Humanoid.tryAttack` at slam range; the impact applies `slamFalloff` x 45 to every
  target in reach, knocks them back up to 4.5 m/s, and staggers crowd bodies within the radius.
- **Spawning**: `rooms[].spawns[]` gained optional `group`, `active` (false = wait for the group), `variant`,
  `count`, `interval`, `yaw`, `outfit`, `infection`, `on` (an event name that triggers it). `corpse` spawns
  default to play-deads; `vent`/`ceiling` spawns come out prone, get up and hunt the player; `door` spawns
  arrive hunting. Max 8 alive; the rest queue and feed in round-robin across points (R11: two points of
  `count: 7` give 14 with 8 at a time). Corpses capped at 16 (oldest removed). New sequence actions
  `spawnGroup { group, wait? }` (with `wait` it ends on that group's `group:cleared`; skipped it just spawns)
  and `despawnGroup { group }`. Cleared groups are stored in the playthrough flags (`group:<id>` =
  `cleared`) and not respawned after a checkpoint restart.
- **Events**: `enemy:spawned`, `enemy:alerted`, `enemy:died`, `enemy:attack { id, target, kind, amount }`,
  `enemy:grab`, `enemy:grabReleased`, `enemy:slam`, `enemy:hit`, `combat:first` (once per session, first
  alert with a target), `group:cleared { group }` and `group:cleared:<group>`.
- **Squad API** (ADR-0011): `director.list` (each with `position`, `alive`, `grabbing`, `state`, `target`,
  `body`), `director.grabber`, `raycast` / `applyHit(hit, amount, dir, by)`, `addTarget(squadTarget(...))`.
  Squadmates are registered as targets (weight 0.6) and obstacles; their hits arrive only as `enemy:attack`
  (the squad owns their health).
- **Difficulty**: HP x `enemyHp` at spawn, lurch interval x `enemyLurchInterval`; damage to the player is
  raw and Vitals applies `playerDamageTaken` (no separate enemy damage multiplier exists in ADR-0008).
- **Weapons**: `weapon:fired` now does hitscan (pistol 18, shotgun 8 x 9 with 6-12 m falloff, ADR-0005
  spread hip/aim) against the level colliders and enemy capsules; gore bursts, severing, pools and the
  sandbox's death behaviour come from `Humanoid.applyHit`. Shots are heard 25 m.

How to try: `npm run dev`, then `/?level=kit_test&enemies=shambler:3,hero,playDead` (spawns near the player
when play starts, preferring the view direction; works on the demo room too). `?debug` adds an Enemies folder:
spawn shambler / hero / play-dead ahead, kill all, remove all, freeze AI, ignore player, and live counts of
states and queued spawns. `__enemies` in the console is the director.

Verified headless only (no browser from this session): 31 tests in `perception.test.ts`, `spawner.test.ts`,
`enemy.test.ts` and `enemySim.test.ts` (kit_test built in Node: a corridor shambler paths through D1 to the
player and attacks in under 20 s; with D1 closed it waits, opening the door makes it repath and come through;
a sequence `spawnGroup` waits for `group:cleared`). 8 enemies (one hero) cost about 0.13 ms of AI per step on
the Node VM, bodies another 0.13 ms.

Gaps:
- Nothing here has been seen in a browser: animation of the windup/swipe (uses `charge` and arm kicks, no
  dedicated poses), the groan and slam sounds, debug spawning, and the feel of the numbers.
- Enemies never open doors (as specified). kit_test's auto doors close 1.2 s after the player walks away, so a
  pursuer is cut off behind them; decide whether shamblers should push open unlocked auto doors.
- `vent` and `ceiling_drop` movers are a prone spawn plus get-up, not an emerge/drop animation.
- No bullet-hole decals or sparks on walls yet (ADR-0005 step 2); `ShotReport.wall` gives the point.
- Squad damage and the "teammate prioritises the grabber's arm" behaviour belong to the squad AI.
- The ADR-0009 `spawn`/`despawn` npc actions still go to the NPC system; enemies use `spawnGroup`.
- Separation's player circle is immovable; heroes do not shove the player (ADR-0018 open question).
- Lunger (step 7) not started. Debug draw of the navgraph still to do.
- A leftover empty file `scratch_enemy/h.ts` at the repo root (created by mistake; deleting is not allowed
  from this session) can be deleted.
