# Design

## Context

See proposal.md for the motivation and the specs for the required behaviour. Constraints that shape the approach:

- R01 is cells x 0–3 by z 0–1 (4 m cells), with the dock window on the north wall (z = -2), `D_dock` at x = 0 and the R01w opening east. The current counter is a `half_wall` at (5.9, 1.8), 3 m wide, so x 4.4–7.4. `post_front` is at (6, 2.6), facing yaw 0 (the window).
- Doors only exist on 4 m cell edges, and the navmesh is baked once per level load from collision boxes (ADR-0028). A prop can't open and close in the navmesh.
- The navmesh needs gaps of at least 0.8 m (0.4 m erosion each side).
- A `playerFrame` shot overrides look assist and the look clamp (`Player.lookFramed` returns before either runs). Give springs back with a 0.12 s time constant (`GIVE_RETURN`) as soon as the mouse stops.
- A scripted walk already computes a steering point ahead on the route each frame (`PathFollower.update` → `tx/tz`).
- Held props support only the mug (`MUG_POSE` regex in `actors/heldProps.ts`).
- Animation clips are idle, walk, jog, crouch, kneel and pistol only. Gestures are hand-keyed poses in `poses.json`.
- `slice01.json` carries hand edits the generator can't reproduce, so level edits go into both it and `scripts/gen-slice01.mjs`.

## Goals / Non-Goals

**Goals:**
- Build the checkpoint from kit props in code, with no imported models except the existing `guard1` body.
- Reuse the framing system for the walk camera, rather than adding a second camera mode.
- Keep every scripted walk passing the existing walk suites unchanged.

**Non-Goals:**
- An opening staff gate, or doors off the 4 m grid.
- Detour tile-cache or dynamic navmesh obstacles.
- Splitting the letterbox-bar and skip requirements out of `intro-sequence` (see Decision 11).

## Decisions

### 1. Layout coordinates (approximate; final values come from `walks:suggest` and the walk tests)

```
 z=-2  ====window===========================+=======
                                            | rail        x ~ 7.9
                                            [gate 1.2 m]  z ~ -1.0 .. 0.2
                                            | rail
              queue      stop   (tray)     [ARCH]        z ~ 0.6 .. 1.6, 1.0 m clear
 z=1.8        +#########################+    scan   G     scan ~ (8.6, 1.1), guard ~ (9.4, 1.1)
              # x=4.4                   x=7.4
              #        JAY (6, 2.6)          sqA ~ (8.4, 2.6)   sqB ~ (9.3, 2.2)
              #        chair
              #      [desk]
 z=6   -------#====[CCTV 2x3]========------------------
```

- **Counter:** the front run stays as is. The return leg is a second `half_wall` (rot 90) from (4.4, 1.8) to the south wall, about 4.1 m long, with the same material and height. Two props were chosen over an `L` parameter on `half_wall`, because the colliders stay simple boxes and no kit change is needed.
- **Desk:** `office_desk` (no monitor, two keyboards) at (6.95, 5.1) facing north, the chair in front of it, and the CCTV bank above it at 1.84 m wide. The bank fits between the south wall's pilasters at x 6.0 and 7.9: centred on x 6 it straddled the pilaster on the cell edge, which the level-kit wall-clearance test rejects. The current `security_monitor` is removed from R01.
- **Jay's post:** `post_front` (and the player start) is at (6.95, 4.3), leaning back against the desk, yaw 2°. From there the dock door (about 45° left) and the guard past the arch (about 45° right) are both on screen, so everyone going through security is in view without turning. The chair is pushed aside to (5.45, 4.55). Jay's walk out waits 0.8 s, so the squad lead off first.

### 2. CCTV wall: one canvas for all six feeds

The new `cctv_wall` prop draws all six feeds into one `CanvasScreen`, mapped onto one merged mesh (one draw call). The live tile follows `camera:feed` the way `security_monitor` did. The original plan gave the live tile its own `feed:<id>` plane (two calls). It was dropped during implementation because R01 was already at 59 of its 60 calls, and the arch light bar needs one. Trade-off: a `cameraFeed` remote render can't show on this wall. No sequence renders the dock feed today, but one that needs to would split the tile back out for one extra call.

### 3. Detector line props

The new props are `metal_detector`, `rail`, `staff_gate` and `tray_table`.

- **`metal_detector`:** two posts and a header with a light bar. The bar has its own fixture material, because it animates and can't merge into the shared glow material. The arch has a solid box per post. In R01 the opening is **1.2 m**: at 1.0 and 1.1 m the navmesh (0.4 m erosion each side, 10 cm voxels) left no walkable strip, so the arch was a wall. Its frame, the rails and the gate use only materials R01 already has (`steelBrushed`, `steelDark`, `cleanTeal`), so they add no draw calls.
- **Arch events:** the arch listens for `detector:scan { id, result: "pass" | "alarm" }`, the same pattern `security_monitor` uses for `camera:feed`, and flashes green or red, then returns to idle.
- **Sounds:** scripts play them at an `arch` anchor (`sfx archPass` / `archAlarm` / `wandBeep`), so the prop stays silent and testable. With no recorded file, `sfx` falls back per the audio rules.
- **`staff_gate`:** a closed leaf with a solid box. It's only decoration.

### 4. Fixed staff gate

The gate is a closed prop, not a door, because x ≈ 7.9 is mid-cell and the navmesh can't toggle a prop. The arch is then the only way through, which is fine for a room that's a dead end after the intro. If the gate ever has to open, that's a separate change: off-grid doors with their own navmesh area flag.

### 5. Dock guard

- **NPC:** `dock_guard` goes in R01's `npcs`, with model `guard1`, look `crew`, placed at a `guard_post` anchor, facing west, holding the wand.
- **Story control:** he's added to `STORY_NPCS` so ambient life leaves him alone.
- **Speaker:** a new speaker `crew_guard`. The `crew_` prefix is already accepted by `intro.test.ts`.
- **Lines:** about 5 in the intro (scan prompts, the clear, the sigh at Giles) and 2–3 free-play reactions. VO follows `docs/voice-casting-standard.md`.
- **No body twin:** the Commons NPC `wall_1` moves from `guard1` to another crew body, which `crewBodies.test.ts` checks.

### 6. Wand and scan poses

- **Held props:** `heldProps.ts` changes from one mug regex to a pose-to-item table (`mug`, `wand`). The wand is a small procedural mesh in the right hand.
- **Poses:** hand-keyed in `poses.json`:
  - `arms_out` for the person being scanned
  - `idle_wand` for the guard at rest
  - `wand_up` and `wand_down`, short timed gestures the script chains (up, down, up) into the sweep. A pose-sequence player for NPCs would have been new code for one beat; the chain gives the same motion, and a skip lands each gesture on its base pose.
- **Recorded clip:** if the user supplies one later, it can replace the chain without changing anything else.

### 7. Intro script structure

- **Anchors:** `walkby_stop` moves to in front of Jay at (6, 1.15), and `walkby_queue` moves behind it at (4.7, 0.45). Added anchors: `arch` (sound source), `arch_scan` (the stop past the arch, at 8.6, 1.25), `guard_post` (9.75, 1.25, facing the arch from 1.15 m) and `arch_exit` (10.6, -0.3, the north lane past the guard, reached by the authored `checkpoint_exit` walk so the crew swing round him). `post_okafor` (8.2, 2.9) and `post_giles` (9.6, 3.4), 1.5 m apart, become the station-side waits. After playtesting found Giles, Okafor and the guard bumping, `world/dockCheckpoint.test.ts` checks that every checkpoint move clears whoever is standing still by a body width plus 0.15 m. Kept anchors: `post_front`, `dock_door`, `dock_window`, `counter_giles`, `counter_okafor`.
- **Authored walks:** `intro_okafor_arrive` and `intro_giles_arrive` each split into two legs, dock → counter and counter → arch → wait. `intro_okafor_counter`, `intro_giles_counter` and the first leg of `intro_jay_kitchen` are re-authored from the new spots with `npm run walks:suggest`.
- **Crew walks:** Ruiz and Sung keep using nav routing to their Commons spots. The arch is now on their route.
- **Beat order:**

```
door opens -> Ruiz to counter (Sung to queue) -> Ruiz exchange -> Ruiz to arch_scan
  -> scan(full, pass) -> Ruiz to Commons | Sung to counter -> exchange -> through arch (pass) -> Commons
door cycles -> Okafor to counter -> exchange -> arch (pass) -> wait | Giles to counter -> exchange
  -> arch (alarm) -> guard sigh + Okafor dry line -> wait
station-side banter (speaker shot) -> "Kitchen. Before he gets worse."
playerFrame heading -> parallel: Jay walk, banter + PA + forearm, squad walks
```

- **Kitchen arrival:** see §9. Bram's greeting and the speaker shots start as Jay walks into the Commons. The radio starts when he reaches `kitchen_stand`.
- **Running order:** Sung steps up and talks while Ruiz is scanned, under one speaker shot covering Ruiz, the guard and Sung. The airlock cycles (0.6 s) as soon as Sung leaves the counter, and Okafor and Giles walk in at 1.5 m/s while she is still at the arch, with the view following Okafor in.
- **Order the arrivals keep:** steps between moves wait on arrival (`wait: true`), so nobody crowds the arch.

### 8. Heading shot as a framing target

`playerFrame` gains `target: "heading"`, and framing gains `hold` (seconds before give returns) and `returnTime`.

- **Following the route:** the heading target is resolved each frame by the framing `follow` callback. While a scripted walk runs, it's the follower's steering point at eye height. When no walk runs, it's the last heading held fixed. Because the target is at eye height, pitch stays level. The shot's `duration` (about 0.8 s) smooths turns, and reduced motion scales it the way it already does.
- **Leeway:** `give: 35` gives ±35° sideways. The existing 0.75 vertical factor gives ±26°.
- **Hold and settle:** defaults are `hold: 0` and `returnTime: 0.12`, so the existing 6° shots don't change. The heading shot uses `hold: 0.5` and `returnTime: 0.3`, which settles in about 1 s.
- **Why not unlimited free look:** the user wants to face where the rails go, with some freedom. The alternative was free look plus an auto-face assist. It needs the look clamp switched off, a second steering path and an ADR reversal, for a result the user said they don't want.

### 9. Walking into the kitchen

Playtesting settled this: Jay faces along the rails for the whole walk, and only when he comes through the Commons door does the camera go back to speaker shots, turning to whoever speaks first and then following the conversation, Priya included. A branch of the walk's `parallel` waits for the existing `trigger:commons_enter` (40 s timeout), then starts a speaker shot with no initial aim. The squad's branch holds Bram's greeting until the same moment. They are out of sight behind the door meanwhile, so the first line lands as Jay walks in. The flag `intro_jay_in_kitchen`, which `waitFor` sets, covers Jay getting there first. It is reset after the walk, so watching and skipping end alike. Two earlier tries were dropped: soft nudges toward Bram and Priya, and following Okafor from the corridor corner (it turned the view away from the route too early). Priya's mug offer stays a normal framed shot with 6° give.

### 10. Intro length

The single-file arrivals add an estimated 25–35 s. There's no length cap. If the intro drags, cut the crew arrivals' exchanges first, never the kitchen.

### 11. Spec boundary

The letterbox bars, hold-to-skip and on-rails camera rules apply to every sequence (the briefing and the dawdle catch too). They live in `intro-sequence` for now, so ADR-0017 can be retired in full. When the briefing gets its own spec, move them to a shared capability (for example `cutscene-rails`) and point both specs at it.

## Risks / Trade-offs

- **[Walkers stall or grind at the arch]** → The opening is 1.2 m, the narrowest the navmesh routes through. `world/dockCheckpoint.test.ts` routes airlock → corridor through it, and both walk suites cover every move.
- **[R01 is at its draw-call budget: 60 of 60]** → Any further dressing in R01 has to save a call elsewhere first.
- **[Bodies bunch up in the single file]** → Every move toward the arch waits for the person ahead to arrive past it. Crowd steering only bends people round each other; it doesn't queue them.
- **[The heading target jitters at the start of a curve or on a re-route]** → The 0.8 s framing ease smooths it, and the follower's steering point is already smoothed along the route.
- **[A skip mid-scan leaves the arms_out or wand pose]** → End states send NPC actions with `instant: true` to their final pose. A skip test asserts the guard is back at `guard_post` in `idle_wand`.
- **[Draw calls]** → R01 gains about 5 calls: the CCTV wall (2), the arch light bar, the tray and the gate (both merged). Check against the 60-call budget with the level debug overlay before calling the room done.
- **[Free-play arch needs a weapon check]** → If the sequence `if` step can't test whether Jay is armed, add a host condition for it. That's covered in tasks.
- **[ADR-0017 is edited by two changes]** → The ADR retirement tasks are gated on `establish-audio-spec` being archived first.
- **[No recorded sounds yet]** → Light feedback carries the scan, and the sounds drop in when supplied.

## Migration Plan

1. Build the props and the R01 layout, then run the walk suites before any script changes.
2. Rewrite the intro script and dialogue, then update `intro.test.ts` and the anchor list in `slice01.test.ts`.
3. Add the heading shot, and speaker shots from the Commons door.
4. Do a browser pass: the intro watched and skipped at 0%, mid-scan, mid-walk and at the hand-off.
5. After `establish-audio-spec` is archived, retire ADR-0017, trim ADRs 0014, 0023, 0026, 0028 and 0029, then update `docs/adr/README.md` and the source comments.

Rollback is a git revert. Nothing is migrated in saves, because `cp_intro` and the flags keep their names.

## Open Questions

- Is the guard still at his post after the lockdown, if the player ever returns to R01? If not, the free-play arch reaction only applies in the quiet half.
- Final guard lines and timings get written and timed during the script task.
- Will the user supply a recorded wand-scan clip? Until then, hand-keyed poses stand in.
