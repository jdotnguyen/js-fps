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
