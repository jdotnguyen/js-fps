# ADR-0028: Navmesh pathing and authored walks

Status: Accepted (Nov 19-20). Justin chose the navmesh (B) and authored curve walks for cutscenes (C) after a
replay of every scripted walk showed actors walking into walls. Supersedes the navigation part of ADR-0007.

## Context
Scripted walks (`playerWalkTo`, `npcMoveTo`) and all AI used the ADR-0007 point navgraph. Replaying the 43 scripted
walks in slice01 through the real colliders showed why people walked into walls:
- Routes were planned for a thinner body (0.25 m NPCs, 0.3 m Jay) than the 0.35 m motor body, so 32 of 43 routes clipped
  door frames and corners.
- When no route was found the walker silently went in a straight line at the target, through the wall.
- One part of the map (around R07/R08, about 41 graph points) was cut off from the rest, seven points linked to nothing,
  and some anchors (`gallery_door`, `counter`) could not see any graph point at all.
- Walkers chased waypoints at a constant speed and turned sharply at each one, which read as robotic even when it worked.

## Decision
- **Walking (`ai/walkPath.ts`).** One follower for Jay's scripted walks and every NPC move. Routes are made dense and
  smooth: nav routes have their corners rounded with arcs that are checked clear of the colliders at body radius plus
  6 cm (an arc shrinks, and a corner stays sharp, if it would clip). The follower projects the walker onto the route
  (never backwards), steers at a point a little ahead (0.55 m on straights, 0.2 m in tight turns so it doesn't cut in),
  and runs a speed profile: down to half speed through tight turns, braking at 1.6 m/s² into them and into the arrival,
  speeding up at 1.8 m/s² from a stand, and keeping its speed across re-plans. A route that can't be found is a
  warning in the console (`[nav] ... walking straight`), not a silent straight line.
- **Authored walks (C).** Rooms in the level data get `walks`: `{ id, points, speed? }`, points being anchor ids or feet
  positions, walked as a centripetal Catmull-Rom curve through every point. Sequences use one with `via` on
  `npcMoveTo` / `playerWalkTo`, or by id with `attachToTrack`. The walker is routed onto the curve's start if it is more
  than 0.75 m away, and on from its end if `to` is elsewhere. If it is shoved off the curve and stalls, it routes
  straight to the spot instead. Use these where the route matters to the shot (the forced look at the window, two
  squadmates walking side by side); everything else keeps plain nav routes.
- **Authoring.** `npm run walks:suggest -- <id> <start> [via...] <end>` searches a route that keeps a comfortable
  distance from walls (people walk down the middle of a passage and swing wide of door frames; a shortest path hugs every
  corner), boils it down to a few control points and checks the curve. Paste the result into the room in
  `scripts/gen-slice01.mjs` (`walk(...)`) and `src/data/levels/slice01.json`, then tweak by hand.
- **Navmesh (B), `ai/navmesh.ts`.** Kit levels path on a Recast/Detour navmesh (`recast-navigation` 0.44, WASM loaded
  with the level, about 50 ms) built from the collision boxes at first use (slice01: 745 polygons, ~130 ms). Voxels are
  10 cm across and 5 cm up; the walkable area is shrunk by 0.4 m (the 0.35 m body plus 5 cm), so routes keep bodies off
  walls by construction; 1.75 m headroom; 0.35 m steps (the motor's). Two steps beyond Recast's stock pipeline:
  floor inside any solid box is cleared (boxes rasterise as shells, which would leave hollow walkable insides under
  counters and walls), and each doorway is marked as its own area (1 + door index, a 0.6 m strip either side of the leaf),
  so a closed door switches its polygons off before each query and the door's state never needs a rebuild. Door leaves
  themselves are left out of the mesh input.
  It sits behind a small `Navigator` interface (`findPath`, `direct`, `nodes`, `doors`, `world`, `edgeCount`) that the
  ADR-0007 navgraph also implements, so enemies, squad, NPCs, guidance and Jay switched together; the demo room, lab and
  corner sandboxes and the unit-test rooms keep the navgraph. `direct` is still a collider line check (with closed doors).
  `nodes` are walkable points about a metre apart over the mesh, for the squad's and spawner's spot searches.
- **Goals off the floor.** An anchor in a nook, against furniture or inside it is routed to the nearest walkable spot
  (within 1.6 m) plus a last straight step towards it when that line is clear; a walker that runs out of route, or stalls
  in its last metre, counts as arrived, so a `wait` never hangs on an unreachable spot. In slice01 `priya_hide` (a nook
  narrower than a body) and `stinger_kill` (inside the R08b desk) are such anchors; the scripted-walk test lists them.
- **Crowds.** Scripted walkers steer round other bodies (cast and squad, ADR-0018's solid bodies) as well as Jay: from
  2 m out they bend away from the nearest body ahead, committing to one side until it is passed (head-on, both bend to
  the same hand so they part), and ease off to 55% when close. Detour's crowd simulation was not used: it would have
  replaced, not joined, the existing separation, give-way and Jay-avoidance behaviour.
- **Intro.** The intro's walks are authored walks; which ones, and why, is in the `intro-sequence` and `dock-checkpoint` specs
  and the archived `dock-security-checkpoint` change.

## Tests
- `world/slice01Walks.test.ts`: every authored curve clears the walls at body radius with doors open, sequences only
  name walks that exist, and a body follows each one to its end without scraping.
- `world/slice01ScriptedWalks.test.ts`: every scripted walk in every slice01 sequence (from the same actor's previous
  anchor in that file) is routed and walked to the spot without getting stuck or grinding a wall.
- `ai/walkPath.test.ts`: curve sampling, corner rounding against a pillar, the speed profile and arrival.
- `ai/npcs.test.ts`: two people walking head-on pass each other without touching, and both arrive.
- Tests and `walks:suggest` load slice01 through `world/headlessSlice.ts`, which also loads the navmesh WASM.

## Consequences
- Gaps narrower than 0.8 m are not walkable for AI or scripted walks (the body needs 0.7 m; the rest is margin).
- The navmesh is built once per level load; doors toggle polygon flags. Moving geometry (a fallen locker, a barricade)
  would need Detour's tile cache, not used yet.
- A walk is now as good as its route: the follower can't fix a route through a wall, which is why missing routes warn.
- Authored walks name anchors, so moving an anchor moves the walk; the walk test catches one that ends up in a wall.
- slice01.json has hand edits the generator doesn't reproduce yet (material params), so walks were added to both.
