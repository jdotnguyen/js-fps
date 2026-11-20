# ADR-0029: Ambient life (activity spots, conversations, an ambient director)

Status: Accepted (Nov 20). Justin found the crew "too much random idling": most people stand and do nothing. He wants them to
sit in the cafeteria, lean on walls and tables, and talk to each other. He picked this design and asked for phase 1 first.
Phase 1 is In progress; phases 2 and 3 are Proposed.

## Context
- Level NPCs spawn in one pose and never move unless a sequence moves them. While idle, `NpcActor.ambientGesture()` blends to a
  small gesture every 5-12 s (glance, weight shift, head tilt) and the animator's idle layer breathes. The gestures are all
  standing poses, so people look like they are waiting for something.
- `poses.json` has no sitting or leaning poses (only standing poses plus `typing`, `crouchWork` and `kneel_revive`), and the
  mocap bake has no sitting clips either.
- The Commons (R02) has 7 dining tables with 6 seats each, a 6-stool window bar, and a sofa plus two armchairs. It holds 4 NPCs,
  all standing.
- Pieces already exist that this can build on: `Humanoid.speak()` (ADR-0027) moves the mouth and gestures for any pose, the
  navmesh (ADR-0028) can walk anyone anywhere, `NpcDirector.hold()` gives sequences priority over everything else, and
  `Humanoid` already skips foot IK for `sit_*` poses.

## Decision
The behaviour is stored in the places people use, not in the people: a chair says "someone can sit here, facing this way, in
this pose". NPCs claim a spot and use it. This is the smart-object approach (The Sims, Unreal Smart Objects, Source hint
nodes); it scales to every room without hand-scripting each person.

### Activity spots (phase 1)
- `PieceBuilder.spot(kind, x, y, z, yaw)` lets a kit piece declare where a body can be and which way it faces. The position is
  the body's origin (the feet, on the floor), not the seat. Because the spot comes out of the same generator call as the seat
  mesh, it carries the same random jitter.
- Kinds, each with a default base pose:
  - `sit_chair`: dining-table stools (seat top 0.49 m)
  - `sit_stool`: bar stools (0.80 m, feet on the footrest ring)
  - `sit_sofa`: sofas and armchairs (0.51 m, slouched)
  - `lean_wall`, `lean_counter`: authored in level data in phase 1; generated along walls and counters in phase 2
- Spots are emitted by `dining_table` (one per seat, facing the table), `bar_counter` (one per stool, facing the counter) and
  `sofa` (one per seat cushion).
- `Level.spots(room?)` returns them in world space with an id (`<room>:<prop index>:<n>`) and a group key (the prop), so people
  sharing a table are one natural group.
- A level NPC can say `spot: "<kind>"`. It takes the nearest free spot of that kind to its `at` position, and gets that spot's
  position, facing and default pose (an explicit `pose` still wins). A spot is held by at most one body. A kind with no free
  spot in reach (1.5 m) logs a warning and falls back to `at`.

### Poses (phase 1)
- New base poses: `sit_chair`, `sit_stool`, `sit_sofa`, `lean_wall` and `lean_counter`.
- New ambient variants of each: glance either way, look down, drink, lean in on the table, hands together, cross arms.
- A pose can `extends` another: it starts from that pose's joints and pelvis offset and overrides only what it lists. Every
  seated and leaning gesture therefore keeps its legs exactly where the base pose puts them, so a glance never straightens a
  seated body's legs.
- `AMBIENT_GESTURES` gets a list for each new base pose.
- A seated or leaning body:
  - does not give way to Jay
  - is exempt from actor separation, like a body working at a console
  - keeps foot IK off (already the case for `sit_*`)
  - keeps breathing but drops the idle weight shift, which would slide it across the seat
- Look-at pitch is measured from the body's own eye height (the pose's pelvis drop), so seated people look across the table and
  not down at it.

### Conversations (phase 1)
- NPCs that share a `chat` id talk to each other (`ai/chatter.ts`). One speaker at a time says an unvoiced, unsubtitled filler
  line through `Humanoid.speak()`. The text only sets the mouth rhythm, and the emote (neutral, question, relieved, now and
  then laugh) sets the gestures.
- Listeners look at the speaker's head, and now and then one laughs or nods in reply.
- After a 0.4-2.5 s beat the turn passes to someone else (never the same person twice in a row unless the group has two
  people). About one beat in six is a longer quiet moment.
- A member drops out of the conversation, and the others carry on, while they are:
  - more than 3 m from the group centre
  - busy with a sequence command
  - offering an item
  - not ambient
  - dead or infected
- When everyone has dropped out but one, the group falls silent.
- When Jay comes within 1.8 m in front of a chatting NPC, that NPC glances at him instead of the speaker, and looks back once
  he moves away. The room acknowledges him without stopping its conversations.
- The commons murmur ambience is the sound of the room; there is no per-group audio in phase 1.
- Everything is seeded per group (`Rng('chat:<id>')`), so a load or a skipped scene comes back the same.

### Population (phase 1, Commons)
- A believable mix in a social room is about 60% seated, 20% standing in small talking groups, 10% leaning and 10% moving or at
  a machine. This mix is the target for each room's static layout.
- The Commons goes from 4 to 12 bodies:
  - two tables talking (3 and 2)
  - one person eating alone with a mug
  - one at the window bar
  - one on the lounge sofa watching the window
  - two talking by the drinks station
  - one leaning on the wall by the vending machine
  - the cook (unchanged)
- `crew_1` is unchanged. The rounds sequence moves `crew_1` and the cook, and `quiet.test.ts` pins that.
- Walking lanes stay clear (the N-S aisle, the gallery and hydroponics lanes, the servery queue). The scripted-walk tests prove
  this.
- Crowd bodies come from a small set of imported models (ADR-0026). Looks are picked so that no extra copy of a named
  character's body (Priya, Heins, Hale) sits in the Commons with them.

### Ambient director (phase 2, Proposed)
- `ai/ambientLife.ts` runs NPCs that are ambient and not held by a sequence:
  - Each stays at a spot for 30-120 s, then picks the next one with a weighted roll (sit, join a group, fetch a coffee, lean,
    use a machine), books it, and walks there on the navmesh.
  - At most one body in five in a room moves at once; more than that looks frantic, which is just as fake as everyone standing
    still.
  - Moves start preferably out of Jay's view.
  - Seated people stand up and sit down with short transitions (about 0.8 s).
  - Conversations form and break up as people come together.
- Sequences always win: `hold()` frees the body's spot and conversation, and `release()` returns it to the director.
- Story NPCs (Priya, Heins, the squad) are `ambient: false` unless a sequence hands them over.
- Rooms out of reach (no line of sight, more than one room away) only advance timers.
- Wall and counter lean spots are generated from wall tiles and counters.

### Story beats (phase 3, Proposed)
- Rooms react to events, for example:
  - everyone glances up and goes quiet at the quarantine PA notice
  - a lunch rush fills the Commons after the briefing
  - the Commons empties as the alarm starts
- Each beat is a director "mood" per room (busy / quiet / alarmed) that reweights the activities. There is no scripting per
  person.

## Not doing
- A full utility AI or GOAP planner: a weighted roll over a handful of spots is enough for background crew.
- Detour crowd: same reason as ADR-0028; it would replace separation and give-way rather than join them.
- Voiced background chatter: it needs recorded or generated murmur lines; the room ambience covers it for now.

## Tests
- `world/spots.test.ts`:
  - dining tables, bar counters and sofas emit one spot per seat
  - each spot faces its table or counter and sits on its seat
- `ai/chatter.test.ts`:
  - turns pass between members and nobody talks over anyone
  - listeners look at the speaker
  - a member who walks off or is held by a sequence drops out
- `actors/idleLife.test.ts`:
  - every seated and leaning pose and its gestures exist
  - a seated body's legs do not move when it gestures
- `world/slice01.test.ts`:
  - every Commons NPC that asks for a spot gets one
  - no two NPCs share a spot
