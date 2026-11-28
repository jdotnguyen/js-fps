# Design

## Context

See proposal.md (Why) for the playtest problems. Current state that shapes the approach:

- `sec_glass` (`action_security.json`) drives the whole attack from sequence steps: it spawns `r08_thing` as `kind: "lab"` at infection 3, fires `gore` at fixed coordinates, emits `glass:blood` / `glass` on the shared id `medbay`, and drags with `npcDrag` (`NpcActor.towBehind`, a rope `dist` m behind the dragger's root).
- The Lab B kill already has the right machinery: `kills.json` styles of timed beats (`KillRun` timing, `NpcKills` binding), victim poses, `kick` jolts, joint-anchored `gore`, `glass` marks placed at a joint on the pane face (`print` / `splat` / `streak`), a key light, a clear band, and per-beat sequence hooks. It has no notion of an attacker; the creature is something the kill spawns.
- The level is generated: `scripts/gen-slice01.mjs` places the three medbay panes (`wallProp(R07, 'glass_cracks' | 'glass_blood', x, 11, ...)`, all `id: 'medbay'`), the R08/R08b anchors and props. `slice01.json` is regenerated from it.
- The panes sit at about z 45.72 and Priya's glass mark is `priya_glass (0.3, 0, 46.62)`. Every gore step clips at z 46.05, 33 cm inside the room.
- Player control already supports `move: locked, look: free, weapons: false`. There is no melee; interact prompts on level boxes exist.
- `converted` is a one-beat style (`turn`, `writhing`, 7 s) that turns a body into an enemy.

After the first build (2026-11-21 playtest; see proposal Why):
- `pin` calls `place()` and puts the attacker straight at an offset from her, wherever its timed approach got to. That is the jump behind her.
- Gore particles are one `THREE.Points` cloud of untextured 0.026 m squares (`gore.ts`). The crack is a canvas star (`crackTexture`). `splat` glass marks are moved up to 0.55 m sideways and out of the clear band, so none land at the impact.
- Lab B's `drop` already does free movement in a sealed room: `playerControl move: slow, look: free, weapons: false`, `gatherIn R03`, then `doorState sealed`.
- In `cover_me` (`action_contact.json`), `D_R06_R07` opens before `waitGroup r06_cover`, so Jay is still fighting when the door opens.

## Goals / Non-Goals

**Goals:**
- Build `mauled` as a data style on the existing kill engine, so the R08 scene is one `kill` step plus sequence reactions to its beats, not about 40 hand-timed steps.
- Keep the attacker and victim physically joined by a grip in the hand, so no timing can put them 1.4 m apart again.
- Reuse the stinger's existing feed and camera, and the `converted` style, for the turn.

**Non-Goals:**
- No ragdoll or physics-engine dependency. The `adopt-physics-engine` change is in flight; this design keeps body motion kinematic so the two changes do not block each other.
- No new creature model. `lab_creature` is reused as is.
- No change to Lab B's `grownInside` behaviour or data.

## Decisions

**1. `mauled` is a new kill kind with an `attacker`, not a sequence of separate steps.**
The `kill` step gains `attacker: "<npc id>"`. A `mauled` style's beat events can drive both bodies: new events `pin` (attacker snaps to a victim-relative offset and yaw), `grip` (`hand` + victim `joint`, or `release`), `attackerPose` (a pose or loop on the attacker, e.g. `slamWindup` / `slamImpact`), `haulTo` (attacker walks to a named anchor with the victim gripped), `throw` (release and fly the victim to a glass point), and `slam` (one impact: drive the gripped head to the target surface, then fire the hooks). Beats get `until: 'impacts'` for slam.
*Alternative:* keep it in `sec_glass` and fix the numbers. Rejected because contact would still depend on hand-tuned coordinates and timings, which is what broke it.

**2. The grip moves the victim's root so the gripped joint follows the hand (kinematic attachment).**
Each frame while gripped: take the attacker's hand joint in world space and the victim's gripped joint in world space, and move the victim's root by the difference (clamped to 0.5 m per frame so a pose swap cannot teleport her). The victim's pose is set by the beat: `kill_impaled` (on the claw, arched), `kill_carried` (feet trailing), `kill_slammed` (held by the head at the cart). Her heading turns to point her body away from the hand. The gripped joint is the torso (`chest`) for impale and carry, and `head` for the slams (decision 16). `towBehind` is left alone for other uses.
*Alternative:* IK the attacker's arm to her head. Rejected for now: more work, and the reader's eye is on her, not its elbow. It can be layered on later without changing the spec.

**3. A slam is a timed lerp onto a target plane, and impacts are the beat's clock.**
`slam` reads a target anchor (`r08_cart_top`, a point and the surface height). The attacker plays `slamWindup` and then `slamImpact`; on the impact frame the gripped head is held at the surface for about 0.08 s. Then a `kick` on head/neck, a `gore spurt` from `head`, a `gore pool` on the cart top, a crunch sfx from a variant set, and the hook `kill:impact {n}`. Three slams per beat with growing strength; the victim's convulsion target falls to near 0 after the third.

**4. Voice stages are beat data.**
The beat's `line` list is keyed by impact (`lines: [sec_priya_06, sec_priya_07, sec_priya_03]`). An impact cuts any of her playing lines, with a 0.15 s fade, before the next starts, which meets the "silenced by the third" scenario. Lines that are not hers (Okafor, Giles, Jay) stay in `sec_glass` as parallel steps waiting on beat hooks (`waitEvent kill:beat grab`, etc.).

**5. Glass marks: give each pane its own id, add a `crack` mark, and stop using whole-pane smears.**
In `gen-slice01.mjs` the two remaining panes become `medbay_w` and `medbay_c` (the east edge becomes the glass door, decision 11); `glass_blood` props are removed from them, and `glass_cracks` stays per pane, unused in R08. A new glass mark kind `crack` (a star decal from a small set of drawn variants, rotated at random, on the pane face) goes next to `print` / `splat` / `streak` in the gore glass-mark renderer. The kill's glass is `anchor:medbay_c_glass`; marks are placed from the victim's joints exactly as Lab B does. The `streak` `dir: 'pull'` option stays in the engine but the R08 style no longer uses it (no drag). Decision 19 replaces the star crack and moves the throw's splatter onto the impact.
*Alternative:* reuse the existing `glass_cracks` whole-pane overlay for the crack. Rejected because its centre is fixed and it would not line up with her head.

**6. Fix the gore clip on the pane face.**
The kill derives its clip from the glass anchor (Lab B already does). `sec_glass` loses its hand-written `clipAt 46.05` steps entirely. Leftover sequence `gore` steps, if any, use `clipAt 45.72`.

**7. Glass bang uses an interact box, not a new input.**
A `glass_bang` interact box on the centre pane (gen script) emits `interact:medbay_bang`. With Jay free to move, a second box goes on the west pane, nearest Priya's retreat, and both emit the same event. A small looping listener inside `sec_glass` (enabled at the plead beat, disabled at impale) plays `glassThud` from the struck pane and a `cameraShake 0.08`. `playerControl` sets `interact: true` only for that window.
*Alternative:* add melee to the player. Rejected because it is out of scope and would leak into the rest of the game.

**8. The stinger reuses `converted` with a longer style, `convertedRise`.**
New style beats: `still` (corpse, 3-4 s, no convulsion), `twitch` (two kicks), `turn` (writhing, convulsion 0.7), `rise` (`getUp_0..2` at an unnatural rate), `face` (head turns to the camera). The `stinger_priya` sequence keeps its feed, fade and `endSlice`, and loses the `r08_thing` spawn, the `stinger_kill` walk and the begging lines. Because there is no drag, the feed moves from the surgery to the medical bay (decision 20). Static fires on the `face` hook plus 1.2 s.
*Alternative:* hand-steps in the stinger. Rejected so the body motion stays in one engine.

**9. Restore state.**
`action_restore` sets Priya's end state from the `sec_done` flag: corpse at `priya_rest` (her landing spot at the base of the centre pane, recorded or authored) in `corpseProne`, with the blood pool, and no attacker. From `cover_done` without `sec_done`, she is placed at `priya_wait` in R08 with `D_R07_R08` sealed. A new `glass:marks` restore replays a short saved list of the centre pane's marks (kind, point, size), recorded by the kill. A fixed authored end-state set is used instead if recording proves fiddly (see Open Questions).

**10. Jay watches from anywhere along the glass, and the slam happens across the cart from him.**
Jay is not held at a spot (decision 15). The viewing strip (x -1.5..1.5, z 44.6-45.7) is where the staging is checked: from its middle at eye height, the cart top at about (0, 47.4) is about 2.2-2.9 m away. `r07_glass_jay` (0.3, 45.25) is kept as the reference point for the sightline tests, not as a locked spot. The carry brings Priya from the west end along the far side of the cart. She is slammed face down onto the top, facing the glass, with the creature behind her also facing the glass, so a player at the glass sees both faces and the cart sits between her and the pane. The throw goes back over the cart into the centre pane at head height. She slides down into the gap between the pane and the cart and stays there. Giles stands at the west end of the strip and Okafor at the door, both off the line from the strip's middle to the cart.

**11. The east pane becomes the medical bay door.**
Nothing joins R07 and R08 today: all three edges are glass, so "The door refuses" has no door. `D_R07_R08` (`glass_slide`, `access: { sealed: true, text: 'lockdown' }`) replaces the east pane on cell (1, 11) south. It is the door Priya runs through and seals (decision 14), and the creature passes right behind it as it comes out along the glass, so Okafor is at the door with his hands on it as it goes by. The glass leaf keeps that view, and the solid jambs only narrow the east edge, which is not on the line to the cart.
*Alternative:* the west pane. Rejected because the creature enters and leaves through the east, and her run from R07 is shortest to the east.

**12. Room staging follows the dressing standard (clusters against walls, clear paths, props inside walls).**
Today several props are not in their room: the R07 console bank is in the north wall (its collider runs z 37.2-38.08, and the inner face is 38.25), the R08 lab bench is past the south wall (z 54.7, face 53.75), and the R08b specimen tank is half in the south wall. The SEC-07 lockers stand across the armory door, and the gurney stands in the lane the creature uses. The layout below fixes all of these. Coordinates are targets for `gen-slice01.mjs`; anything not listed is kept.

```
                        from R06 (bulkhead, x 0)
  x=-6                       |                    x=6          x=10
  +---[CCTV][CONSOLE BANK]--[  ]---[LOCKERS]-----+----[RACK]----+ z=38
  | body1  chair                                 | panel      R |
  |            chair         | spine             D (door)     R |  R07a
  |                          | (clear)   Giles's |            R |  rack faces
  | [desk+medkit]            |   panel ->        |   [shelf]    |  the door
  | [desk] body2  tipped chair      playdead     +--------------+ z=42
  |                                     bio      D---> R09
  |  - - - - - - - - viewing strip - - - - - - - |
  |          Giles      Jay           Okafor     |
  +=====[medbay_w]=====[medbay_c]=====[ D_R07_R08 ]+ z=46 (pane face 45.72)
  | cower <<<<<<<<<<< creature along the glass <<< ^ |
  | [bed]   ^throw      [cart]                   | |  lane: creature in,
  | [vitals]           (stage)                   | |  and back out
  | [bed]                                        | v
  |                                              D---> R08b  [bed] [shelf]
  | [shelf]   [lab bench]     [gurney]           |    (no tank)
  +----------------------------------------------+ z=54
```

| Room | Item | Target | Note |
| --- | --- | --- | --- |
| R07 | `console_bank` w3 | (-3.6, 0, 38.75), operators face north | out of the wall |
| R07 | `cctv_wall` | north wall above the bank, `camera: 'CAM 04  MEDBAY'` live | ties to the stinger feed and the admin booth's CAM 04 |
| R07 | chairs | one at the bank (-3.6, 0, 39.75), one shoved back and turned | the post was left in a hurry |
| R07 | `locker` SEC-07 ×2 | north wall east of the entry, about (3.4, 0, 38.53), facing south | off the armory door |
| R07 | `desk` (+ `health_r07`) | west wall, about (-5.35, 0, 42.6), long side on the wall | last stand cluster |
| R07 | bodies | `body_r07_1` slumped at the bank; `body_r07_2` to about (-4.0, 0, 42.0) by the desk; blood decals only there | out of the viewing strip |
| R07 | crate at (-5, 38.4) | removed | overlapped the bank |
| R07 | spine and viewing strip | x -1.5..1.5 from the entry to the glass, and z 44.6-45.7 across the room, left clear | squad and Jay paths |
| R07 | anchors | `r07_glass_jay` (0.3, 0, 45.25) facing the glass; `r07_glass_giles` about (-1.8, 0, 45.0); `r07_glass_okafor` about (3.1, 0, 45.1); new `r07_medbay_door` (4.0, 0, 45.35) facing the door | ids kept so existing steps still resolve |
| R07a | `armory_rack` w2.4 | east wall, centred z 40, facing the door, `empty: 2` | the Breacher is framed as the door opens |
| R07a | second rack w1.6 | north wall east part, mostly empty | looted |
| R07a | `storage_shelf` | south wall, with `ammo_r07a` on it | replaces the crate stack |
| R07a | `shotgun_pickup`, `r07_panel` | on the east rack; `r07_panel` to the north wall west end, about (6.9, 0, 38.9) | Giles's panel beat keeps a free wall |
| R08 | `instrument_cart` | centre (0, 0, 47.4), long side to the glass; `r08_cart_top` at its top centre | the only prop in the stage |
| R08 | `med_bed` ×2 | west wall, heads to the wall, about z 48.6 and 51.4 | |
| R08 | `console` (vitals) | west wall between the beds | |
| R08 | `lab_bench` w3.2 | south wall, riser on the wall, about (-1.6, 0, 53.35) | out of the wall |
| R08 | `storage_shelf` | south wall west, about (-4.6, 0, 53.45) | |
| R08 | `gurney` | parked along the south wall, about x 1.0-3.0 | out of the lane |
| R08 | stage | x -2.0..2.5, from the pane to z 48.6: only the cart | |
| R08 | lane | x 2.5..5.75, z 46.3..52.8, then west along the glass (z about 46.2-47.0, between the pane and the cart) to x -4.5, no props | creature in, along the glass, the carry and out |
| R08 | anchors | `priya_wait` about (2.0, 0, 48.6), off both doors, facing the glass; `priya_cower` at the west end about (-4.3, 0, 47.6), between the glass and the first bed; `r08_impale` 0.6 m east of `priya_cower`; `r08_throw_point` on the centre pane at head height; `priya_rest` in the gap between pane and cart (the old `r08_reach`); the old `r08_drag_*` and `priya_glass` anchors are removed | decision 16 |
| R08 | lights | slot 1 (cell 0, 12) steady key over the cart; slot 2 (cell 1, 12) flicker over the door and lane; slot 0 low over the beds; back slots off | the eye goes to the cart |
| R08b | `specimen_tank` | removed (a lab prop, and no free corner in a 4 m room without blocking the door or the stinger camera) | |
| R08b | `storage_shelf` | east wall below the stinger camera, out of frame | |
| R08b | `med_bed` | kept | the surgery stinger anchors go (decision 20) |
| R08 | `cam04_figure`, `cam04_look` | the admin-booth glimpse figure moves to the vitals console between the beds, about (-4.3, 0, 50.1), still facing the west wall | it stood inside the second bed after the move |
| R08 | `r08_along` | (3.8, 0, 46.7), right behind `D_R07_R08` (was `r08_drag_mid`) | the creature's first point on the glass, past Okafor at the door |
| R07 | `priya_r07_hide` | crouched behind the last-stand desk, about (-4.8, 0, 43.4) | where she hides until her run (decision 14) |
| R08b | `r08_lurk` | about (7.0, 0, 51.35), just inside the surgery door | it was inside the surgery bed before this change |
| R07 | `cctv_wall` | width 1.6, `y: 1.69`, between the console screen and the wall's trim rail at 2.52 m | `wallClearance.test.ts` |
| R07 | intercom grille, anchor `r07_intercom` | north wall beside the `cctv_wall`, about 1.9 m up | decision 25 |
| R07 | console bank screen | the lockdown order text | decision 27 |
| R08 | `priya_wait` | moves to the west beds, crouched, about (-4.6, 0, 49.9), between the two beds | section A and restore, decision 23 |
| R08 | `priya_door` | (3.6, 0, 46.3), R08 side of the glass in front of `D_R07_R08`, facing it | sections B-D |
| R08 | `priya_sit` | against the west wall by the first bed, about (-5.3, 0, 47.9) | sections E-F |
| R08 | `cardigan` | draped on a chair by the vitals console | decision 30 |
| R08 | lights (decision 24) | slots 0-2 also `backupScale: 1`, keeping their colour; back row and standby beacon as they are | lit on backup power |

**13. The attacker stares at Jay once (`noticed: 'stare'`).**
The game already teaches that noise wakes the infected (`perception.ts`), so a creature that ignores a bang a metre away would break that rule. But if the noise could pull it off her, players would hunt for a way to save her. So the noise gets one reaction, and it is a choice: the creature stops in the lane, turns to Jay, holds still for about 1.5 s, and goes back to her. After that it ignores the glass. The cart staging (decision 10) then reads as deliberate: it makes him watch.

The reaction is a field on the `mauled` style, `noticed: { kind: 'stare', at: <s into plead>, hold: 1.5, target: 'player' }`, not sequence steps, so the creature decides how it reacts and other monsters can differ. `orient` (a short animal head-snap that stops when the noise stops) is the expected second kind for a mindless creature and is not built here. A sequence brings the stare forward with the event `kill:notice`; `sec_glass`'s bang listener emits it on the first bang after the attacker enters R08. The approach is time-based: the attacker walks toward the victim and the stare's hold is taken out of a fixed approach budget (the walk speeds up slightly after an early stare, at most 1.4 m/s). So the impale begins at the same time either way, and skip and restore need nothing new. The approach now runs east to west along the glass (decision 16), so the authored stare point is where that path comes closest to the player's live position, not a fixed time. The attacker's head and body turn are an `attackerPose` (`stare`) plus a yaw toward the player's eye; no new animation system.

The bang adds a shout from Jay (pool `sec_jay_bang_01..04`, for example "Behind you!", "HEY! HERE!", "Turn around- turn around!", "Over here, you-!"), with a 2.5 s cooldown so mashing does not stack lines. The thud and shake play on every bang. The pool keeps Priya's name out so Okafor's one "Priya!" at the grab is the only time anyone says it.

**14. Priya runs in at the end of the cover job, before `cp_cover_done`.**
When `cover_me` starts, Priya is placed instantly at `priya_r07_hide` in R07 (out of sight behind the shut bulkhead). After `waitGroup r06_cover`, and before Giles's forearm lines, a short block plays: she stands, a squadmate calls out (Giles, or Okafor without her name), and a soft `playerLookAt` (weight 0.6, about 1 s) turns Jay toward the open bulkhead. She runs, with one stumble, along the clear spine to `D_R07_R08`. The door opens for her, she walks through to `priya_wait`, the door closes and becomes `sealed` with the lockdown text. The checkpoint that follows already records this. Restoring it places her at `priya_wait`, from `cover_done`.
The run is a new `run` locomotion clip plus a one-shot `stumble` for her body. Both are mocap sourced per `docs/mocap-sources.md` and reviewed in the cast motion sandbox. Until they land, a fast walk with a `kill_reach`-style lurch stands in.
*Alternative:* start the run when the door opens, mid-fight. Rejected because Jay is facing the wave and would miss it.
*Amended 2026-11-23 (playtest):* the run moved out of `cover_me`. In play it fired late (after the fight lines) and Jay could follow her through the open door. It is now the cutscene that opens `sec_glass`, on `trigger:r07_enter`. Jay is held (`move: locked`, so the bars show), `squadCatchUpIn` brings the squad in behind him, `playerFrame` follows her, the door opens as she reaches it, and it seals as soon as she is through at `priya_door`. Control then goes to the scene's slow free walk while she goes to `priya_wait` and crouches, and section A follows. `cp_cover_done` and its restore keep her hidden at `priya_r07_hide`, so the run replays on entry. Second pass, the same day: `cover_me` now sets `cover_done` and takes the checkpoint the moment the wave is cleared, before its closing talk. `sec_glass` opens with `stopSequence cover_me`, which cancels it and cuts every line still playing, so stepping into R07 starts the cutscene at once. During the run Jay takes 3-4 running steps after her (`playerWalkTo` toward `r07_medbay_door` with `distance: 2.8`, from wherever he stands).

**15. Jay is free in a sealed security office (the Lab B pattern).**
`sec_glass` keeps its trigger. It then runs `gatherIn R07` and seals `D_R06_R07`, and sets `playerControl move: slow, look: free, weapons: false, interact: true` instead of the `playerWalkTo` to a locked spot. The squad walk to `r07_glass_giles` and `r07_medbay_door`. The armory door is left open, and the scene does not wait for Jay to look, as in Lab B. When control returns, `D_R06_R07` goes back to `open`.
*Alternative:* keep the lock and the framing. Rejected by the playtest. Free movement is what made Lab B work.

**16. The new `mauled` beats: plead, impale, carry, slam, throw, still.**
- `plead`: Priya plays a hands-up backing walk (`kill_backaway`) from `priya_wait` to `priya_cower` as soon as the creature is out of the surgery. The attacker's approach is `haulTo r08_along`, then `haulTo r08_impale` along the glass, inside the approach budget (decision 13).
- `impale`: begins only on arrival (decision 17). The attacker poses `maul_impale` and grips her `chest` with its right hand. Events: an impale sound, a heavy `spurt` from `chest` for about 2 s, a `burst` of drops, and a floor `pool` under her.
- `carry`: `haulTo r08_around`, then `slamSpot` with the grip held. A short drip spurt and a few floor drops on the way.
- `slam` and `throw`: kept. On the slam beat the grip moves from `chest` to `head`, as authored.
- `still`: she stays at the throw's landing spot (`priya_rest`), and a `pool` grows under her. The attacker walks back through `r08_along` to the surgery and is despawned there, and `D_R08_R08b` closes.
The `reach` and `drag` beats are removed from the R08 style. `drag`, and `towBehind` for other users, stay in the engine.

**17. Beats that take hold wait for arrival, and `pin` never moves the attacker during play.**
A beat may declare `startWhen: 'inReach'` (attacker within `reach`, default 0.7 m, of a victim-relative point). `KillRun` holds the previous beat until that holds, up to the previous beat's `max`. If `max` runs out, the attacker is walked the rest of the way at the haul cap, and still never placed. `pin` becomes a skip/restore-only placement. During play it turns into a short walk (`moveTo` at the haul cap) to the offset, and the beat's first frames wait for it. A test samples the attacker's position every frame and fails on any step over 0.3 m.
*Alternative:* keep `pin` and blend its offset over 0.3 s. Rejected because a sliding body still reads as a cheat at that distance.

**18. Blood as drops: billboarded droplets with landing decals.**
The `Points` cloud is replaced by one instanced quad mesh, with each instance a camera-facing droplet sprite. It uses a soft round alpha with a darker rim, dark red (`#5a0605` to `#8a0b08`), and premultiplied alpha. Each instance is stretched along its screen-space velocity up to 4:1, with sizes from 4 to 18 mm. The ring buffer and clip logic stay. When a drop's floor test hits (the existing probe), or it crosses a registered glass plane or a prop top, it spawns a small decal from the existing splat textures and is retired. Decals share the existing glass-mark and pool budgets (`MAX_GLASS_MARKS` and a new floor-decal cap) so memory stays bounded (spec `runtime-memory`). Reduced gore keeps the shape, with dark blood and half the count. Lab B gets the new drops without data changes.
*Alternative:* textured `Points` with `sizeAttenuation`. Rejected because points cannot stretch along velocity and still look like square sprites at grazing angles.

**19. Impact splatter and a safety-glass crack.**
- **Splatter:** `throw` contact emits a `splat` glass mark at the contact point, with no sideways jitter and the clear band ignored, since the view no longer needs it after the slams. A ring of 6-10 small splats lands within 0.3 m. Two or three `streak` runs start under them. The slide adds a smear following her `chest` down the pane.
- **Crack:** the canvas star is replaced by a safety-glass crack drawn once per variant at 1024 px. It has a frosted crush disc (white, partial alpha), 20-40 radial fractures with jitter and branching, and 3-5 broken concentric rings. The fracture lines go into an alpha map and a normal map, so they shade with the room light and catch speculars as the view moves. The glass between the lines stays fully clear. A second, slightly offset copy on the pane's far face gives depth.
*Alternative:* real geometry or a shader refraction crack. Rejected for cost. A normal-mapped decal reads correctly at this distance.

**20. The stinger uses the medical bay camera.**
`stinger_priya` films from `cam04_pos` re-aimed at `priya_rest` (`cam04_look` moves). It is labelled `CAM 04  MEDBAY`, the same feed the R07 CCTV wall and the admin booth show. The corpse rises by the pane, facing the camera at the end. The surgery stinger anchors (`stinger_cam`, `stinger_look`, `stinger_enter`, `stinger_kill`, `priya_hide`) are removed. The admin booth's earlier CAM 04 glimpse (`cam04_figure`) is framed separately and keeps its own look point.

**21. Lines.**
Okafor's one "Priya!" (`sec_okafor_03`) moves from the grab hook to the impale hook. `sec_priya_05` ("Open it, open it, please-") plays as she backs away. Jay's shout (`sec_jay_01`) moves to the impale and `sec_okafor_08` to the carry. The line that used to hang on the drag moves to `still`. The full script, including the run call, is the line table in decision 29, which replaces the examples given here before.

### 2026-11-22: the security office rework

Decisions 22-31 come from the 2026-11-22 review (proposal Why). Where they conflict with decisions 14, 15 or 21, they win.

**22. Giles is not infected here.**
Giles's infection is dropped from the story, and the cliffhanger will be rewritten around someone else later. This change takes it out of the two rooms it owns:
- **R06 (`cover_me`):** the `flex_hand` anim, the `giles.infectionStage = 1` flag, `cover_giles_03`, `cover_okafor_01` and `cover_giles_04`.
- **R07 (`sec_glass`):** stage 2, `giles.bandaged`, `rub_forearm`, `giles_cut_01`, `sec_giles_05`, `sec_okafor_06`, `sec_okafor_07` and `sec_giles_04`.

The tunnel's and the climax's stage-3 flags, the code that reads the stage, and `docs/characters.md` are left as they are for the cliffhanger change. The tunnel sets stage 3 directly, so skipping stages 1 and 2 changes nothing there. The intro's arm line and `rub_forearm` stay.

**23. One scene from entry to aftermath, in sections.**
`armory_auto`, `sec_glass_near` and `sec_rescue` fold into `sec_glass`, which now starts when Jay enters R07 after `cover_done` (`trigger:r07_enter`).
- **Start:** `gatherIn R07`, then `D_R06_R07` seals. Control goes to `move: slow, look: free, weapons: false, interact: true` (decision 15) for the whole scene. The shotgun pickup still works with weapons off. It goes to the inventory, and Jay can draw it once control returns.
- **Sections:** each one starts when the previous one's lines and actions have finished, plus a short gap.

| Section | Plays | Ends with |
|---|---|---|
| A, enter | Priya crouched by the west beds, at `priya_wait`, which moves there. Flashlights find her, and she recognises Okafor. On line 6 she walks to `priya_door`, on the R08 side of the glass in front of `D_R07_R08` | lines 5-8 |
| B, the door | Okafor walks to `r07_medbay_door` and tries it: denied buzzer. Giles reads the lockdown order at the console bank (decision 27) and switches on the intercom | line 13 |
| C, triage | Okafor at the door, Priya at the glass in front of him, hands up, then turning | line 17 |
| D, the surgery | Priya's lines, then the tray drop and a score hush (decision 26) | her panicked breathing, at least 2 s |
| E, "Sit." | Okafor talks her down. She walks back and sits against the west wall by the beds, at `priya_sit`. In G she gets up from there and backs into the corner at `priya_cower` | line 23 |
| F, the armory | Giles goes to `r07_panel`, runs `bypass_short` on `D_R07_R07a`, which opens, and says line 25. The coffee exchange (lines 26-29) runs in parallel once the bypass starts | both the coffee lines and the bypass are done, then the creature waits for Jay to be out of R07a (at most 10 s; it comes out anyway after that) |
| G, it comes out | the surgery handle and door, then the `mauled` kill from its plead beat on, as decisions 13 and 16-21 describe | the throw and `still` |
| Aftermath | decision 30 | checkpoint `cp_security_done` |

The bang prompt is offered from section A, not only from the plead beat. A bang before G thuds and shakes as usual and plays a shout, and Priya flinches. The stare still waits for the creature (decision 13). The prompt still goes away at the impale.

**24. The medical bay stays lit: its own circuit.**
- **R08:** slots 0-2 in `gen-slice01.mjs` get `backupScale: 1` (the pump room's pattern) and keep their colour, so on backup power the room looks as it does on mains. The glow-only back row stays glow-only, and the standby beacon on the west wall stays, so the room still has its backup light.
- **R08b:** keeps its `dying` light on backup power, with no `backupScale`, so it is dim and unreliable and the creature comes out of the dark.
- **R07:** unchanged. Backup lamps plus its standby beacon. The beacon keeps Jay readable from R08 for the stare.

The 8-light pool across R07, R07a and R08 is unchanged in count, because no slots are added. The stinger's CAM 04 frame is checked again under these values.

**25. The intercom.**
The medical bay has room mics wired to the security office. Its speaker is a small wall grille on R07's north wall beside the `cctv_wall` (anchor `r07_intercom`), at about 1.9 m. The intercom has a station-wide id (`medbay`) and two states, off and live. A sequence step switches it, and switching plays a click from the grille, with a burst of static when it goes live.

While it is live:
- **What it carries:** every positioned voice and world sound that starts in R08 or R08b. That includes the kill's sounds, Priya's lines and the creature's sounds. *Amended 2026-11-23 (playtest):* not the monitor beep. Relayed every 0.8 s through the saturated chain it blared like an alarm the moment the intercom went live. It now plays with `relay: false` and is heard only faintly through the glass, still on the score's beat.
- **How it sounds:** each of those is also played from the grille, through a comms chain. The chain is band-limited like the radio channel (about 300-3400 Hz) and saturated, with a continuous crackle bed from `radio.ts`'s `crackleBuffer` under it, a little room reverb from R07, and distance falloff gentle enough to keep it clear anywhere in R07 and from R07a's doorway.
- **Overload:** a level follower on the relay drives extra saturation and crackle density when the input is loud, such as the scream, the impale or a slam, so the worst moments clip and distort. It never mutes.
- **The direct sound** through the glass is unchanged: kill sounds as authored, voices slightly dulled by the glass (`in-world-audio` and `voice-playback` as they are). The relay sits on top of it, and the mix is tuned so the relay is the clearer of the two.

Subtitles for a relayed line show while the player is in R07 or R07a, as radio subtitles do.

Before the intercom goes live in section B, Priya is heard only through the glass, dull and small. When it goes live, her breathing is suddenly close. The scene uses that contrast.

*Alternative:* play her lines on the radio channel, centred. Rejected because the sound should come from a place in the room, and the radio channel can't carry world sounds.

**26. The surgery is heard in steps, and the creature is not seen until G.**
Positioned one-shots in R08b, through the intercom once it is live:

| Section | Sound |
|---|---|
| A | a slow drip |
| C | a rattle of instruments |
| D | a tray hits the tile. The intercom spikes, and the score cuts to the beep alone for about 2 s |
| F | slow wet breathing, then a scrape that travels along the surgery's west wall |
| G | the door handle, then the door |

Priya reacts to each one: she freezes, and her line or breath cuts. The sounds come from a new `surgery_*` set in `src/audio/sounds.ts`, sourced per `docs/audio-assets.md`. Until the creature comes out, nothing in R08b is lit enough to show it. The first stinger hit is on the door opening.

**27. The lockdown order.**
The R07 console bank's screen shows:

```
MEDICAL DECK - LOCKDOWN IN EFFECT
Seal applied remotely: STATION ADMINISTRATION
Classification: CONTAINMENT (ROUTINE)
Local override: NOT AVAILABLE
```

Giles reads it in section B (line 10). It is in TAG's passive voice, and "routine" connects to Okafor's records requests, but nobody comments on it. The aftermath has no line about TAG, and `sec_okafor_05` is cut. The screen text is level data on the console prop (`text` and `detail`, as on the notice board), and it is the same before and after the scene.

**28. Okafor's voice is projected for the scene.**
From the start of section A to the end of the aftermath, Okafor's local lines are heard at the level they would have from about 3.5 m, wherever Jay stands in R07. They keep their real direction and R07's reverb, with a little more reverb send because he is raising his voice. If he is closer than 3.5 m, the real distance is used, so he never sounds louder than he would up close. This is a per-sequence override on one speaker (`voiceProject: { npc: 'okafor', at: 3.5 }`), cleared when the sequence ends. Voice propagation still applies past R07's walls.

**29. The script.**
Status per line: NEW, CHANGED, KEPT or MOVED.
- **`[IC]`:** heard through the intercom.
- **`[glass]`:** heard directly through the partition, before the intercom is live.
- **Delivery notes** in brackets go into the VO direction.
- **Names:** Okafor says no names except his one "Priya!" (rule 3).

| # | Section | Who | Line | Status |
|---|---|---|---|---|
| 1 | R06 | Giles | "Got it! Come on, sweetheart, open up." | KEPT `cover_giles_02` |
| 2 | R06 | Okafor | "The legs. Did you see? It kept coming until it couldn't stand." | KEPT `contact_after_01` |
| 3 | R06, run | Okafor | "Hey- hey! It's us! It's us!" | NEW |
| 4 | R06, run | Priya | [a sob as she stumbles, no words] | NEW |
| 5 | A | Priya `[glass]` | [a sharp gasp] "Tomas? ...Tomas." | NEW |
| 6 | A | Okafor | "It's me. Come to the door." | NEW |
| 7 | A | Priya `[glass]` | "I'm sorry- I saw the guns, I thought you were-" | NEW |
| 8 | A | Okafor | "I know." | NEW |
| 9 | B | Priya `[glass]` | "It locked. When I shut it, it just- locked." | NEW |
| 10 | B | Giles | "Hang on." [typing] "...Admin's sealed the medical deck. Remotely. I can't touch it from here." | NEW |
| 11 | B | Giles | "I can give you the intercom." | NEW |
| 12 | B | Priya `[IC]` | "...Tomas? Can you hear me?" | NEW |
| 13 | B | Okafor | "We hear you." | NEW |
| 14 | C | Okafor | "Show me your hands." [beat] "Turn around." | NEW |
| 15 | C | Okafor | "Anything scratch you? Bite you?" | NEW |
| 16 | C | Priya `[IC]` | "No. I hid. I just hid." | NEW |
| 17 | C | Okafor | "Good. You're fine." [beat, quieter] "You're fine." | NEW |
| 18 | D | Priya `[IC]` | "It's in the surgery. It's been in there since the lights went." | NEW |
| 19 | D | Priya `[IC]` | "It's been... moving things." | NEW |
| 20 | D | Priya `[IC]` | [fast, panicked breathing, a whimper] | NEW |
| 21 | E | Okafor | [voice low, tense, holding himself together] "Look at me. Not the door. Me." | NEW |
| 22 | E | Okafor | [the same; the second sentence gentle, close to breaking] "Back to the wall. By the beds. Sit." [beat] "...That's medical advice." | NEW |
| 23 | E | Priya `[IC]` | [a nervous, shaking laugh that falls apart into a sob before the line ends] "That's my line." | NEW |
| 24 | F | Giles | "Armory's on its own circuit. That one I can open." | NEW, replaces `sec_giles_01` |
| 25 | F | Giles | "Jay. Take it." | NEW, replaces `sec_giles_02` |
| 26 | F | Priya `[IC]` | "I made you a coffee. Before. It's still on the counter." | NEW |
| 27 | F | Okafor | "I'll drink it." | NEW |
| 28 | F | Priya `[IC]` | "It'll be cold." | NEW |
| 29 | F | Okafor | "I'll drink it cold." | NEW |
| 32 | G, emerge | Priya `[IC]` | [whispering] "Tomas. ...Tomas, it's out." | CHANGED `sec_priya_01` |
| 33 | G, plead | Priya `[IC]` | "Open it, open it, please-" | KEPT `sec_priya_05` |
| 34 | G, plead | Okafor | "Open it! Open the door!" | CHANGED `sec_okafor_02` |
| 35 | G, plead | Giles | "I can't- Tomas, I can't override it!" | CHANGED `sec_giles_06` |
| - | until impale | Jay | bang pool `sec_jay_bang_01..04` | KEPT |
| 36 | G, approach | Priya `[IC]` | "Tomas, please- please-" | KEPT `sec_priya_04` |
| 37 | G, impale | Okafor | "Priya!" | KEPT `sec_okafor_03`, MOVED |
| 38 | G, impale | Priya `[IC]` | [full scream] | KEPT `sec_priya_06` |
| 39 | G, impale | Jay | "Hey! HEY! Get off her!" | KEPT `sec_jay_01`, MOVED |
| 40 | G, carry | Okafor | "The door. Jay, the door!" | KEPT `sec_okafor_08` |
| 41 | G, slams 1-3 | Priya `[IC]` | [screaming] / [choking] / [cut-off cry] | KEPT `sec_priya_02`, `03`, `07` |
| 42 | G, throw | Giles | "Christ. Oh, Christ." | KEPT `sec_giles_07` |
| 43 | G, still | Jay | "...no." | KEPT `sec_jay_02`, MOVED |
| 44 | aftermath | Okafor | [flat, quiet] "I told her she was fine." | NEW |
| 45 | aftermath | Okafor | [after a long pause] "Med lab's through there." | NEW |

Numbers 30 and 31 were cut in review and are not used. The ids for the new lines are assigned when they are written (task 15.1).

**Cut:**
- `sec_okafor_01`, `04`, `05`, `06`, `07`
- `sec_giles_01`, `02`, `03`, `04`, `05`
- `giles_cut_01`, `cover_giles_03`, `cover_okafor_01`, `cover_giles_04`
- the old text of `sec_priya_01`

The data entries are deleted along with their mp3s and `vo-takes.json` rows, unless another sequence still uses them (task 15.1 checks).

**30. The aftermath.**
After `still`, the creature goes back through `r08_along` into the surgery, and `D_R08_R08b` closes.
1. **Silence.** No voice for at least 4 s. The intercom carries static, the monitor beep and the creature's breathing fading inside the surgery. Okafor stays at the door, with his hand on the glass (pose `hand_on_glass`).
2. **The intercom goes off.** Okafor walks to the console bank and switches the intercom off. Click. From here only the direct R08 ambience is heard through the glass.
3. **The notebook.** He takes out his notebook and writes, for about 4 s (anim `notebook_write`). Her cardigan (`cardigan` prop, draped on the chair by the vitals console) is in view behind the glass from the viewing strip.
4. **Line 44.** "I told her she was fine."
5. **A pause** of at least 3 s.
6. **Line 45.** "Med lab's through there." He turns toward `D_R07_R09`.
7. **The end.** `D_R06_R07` unseals, control resets, `sec_done` is set, the objective becomes `obj_medlab`, and checkpoint `cp_security_done` is recorded.

Giles stays at the west end of the strip throughout and says nothing. He takes no part in the aftermath.

**31. The `medbay` score.**
A new score in `src/data/scores.json`, generated like `labB` per the `adaptive-music` spec. Its beat is the R08 vitals monitor's interval (`med_beeps` is re-cut, if needed, to a steady 0.8 s), so the music and the monitor share one clock. The monitor itself never speeds up.

| Layer | Plays | Character |
|---|---|---|
| `drone` | from A | cold, low |
| `glass` | from A, louder the closer Jay is to the panes (distance-driven) | bowed glass or a glass harmonica, high and fragile |
| `priya` | C to F | a small, warm felt-piano or music-box motif, the only warm sound in the scene |
| `breath` | from D | sub-bass swells that follow the creature's breathing |
| `pulse` and `rise` | G, the walk past Jay | |
| `brutal` | impale to throw | ducks under each slam so the hits land dry (the existing "room for in-world hits" rule) |
| `hold` | aftermath | the `priya` motif once more, slowed and detuned, under the silence, ending before line 44 |

| Cue | When |
|---|---|
| `enter` | A |
| `door` | B |
| `triage` | C |
| `hush` | the tray drop: everything out except the beep |
| `sit` | E |
| `armory` | F |
| `emerge` | stinger `stab` on the door |
| `stare` | everything out except the beep, for the stare's hold |
| `impale` | |
| `slam` | |
| `throw` | |
| `still` | |
| `aftermath` | |
| `end` | when the intercom clicks off, the score ends with it |

The `labB` score has already ended in R06 (`trim-lab-wing-encounters`). The `medbay` score starts on `sec_glass` and resumes from checkpoints, as scores do.

### 2026-11-23: playtest fixes

Decisions 32-38 come from the 2026-11-23 playtest and explore session. Where they conflict with decisions 15, 23 or 30, they win.

**32. Resuming from pause is not a restore.**
`action_restore` is triggered by `game:mode { mode: 'playing' }`, and that event also fires on every resume from pause. If the player alt-tabbed during `sec_glass`, the resume ran the `cover_done && !sec_done` branch mid-scene:
- Priya was placed at `priya_r07_hide`, crouched;
- the intercom went off;
- `D_R06_R07` opened.

The scene then carried on with her in R07. The fix:
- `game:mode` carries `from`, the mode it left.
- `action_restore` (and any other restore keyed on play starting, such as `quiet_restore`) matches `from: 'title'`.

Death restarts already re-run the restore sequences through the runtime's own restart path (`dying`, `runtime.ts`), and that path is unchanged. A test pauses and resumes mid-`sec_glass` and checks Priya, the intercom and the doors are unchanged.

**33. The glass side comes from the victim's room.**
`glassFor` (`src/ai/npcKills.ts`) took the pane's normal from where the victim stood when the kill began, so a victim on the wrong side was thrown through the glass. Now the side comes from the room she belongs to: the side of the pane that faces her room's floor. Her live position is used only when no room is known. Her resting point is also clamped so that no part of the `kill_slide` or `corpseProne` pose crosses the pane. A test starts the kill with her placed in R07 and checks that she lands in R08.

**34. The partition is armoured; weapons come on with the bars.**
This supersedes "weapons off" in decision 15. When the bars clear after the run (the `slow` control step after `gatherIn`), Jay's weapons are enabled for the rest of the scene. The R07-R08 panes stop rounds:
- each hit leaves a chip-and-star mark on the R07 face, with a spark and a dull, heavy thunk;
- nothing passes into R08.

A round hitting the glass counts as a bang for the creature (`kill:notice` while `r08_thing_in`). It does not trigger Jay's shout pool. Shooting changes no beat timing, as with banging. Okafor and Giles take no damage from Jay's rounds during the scene. The bang prompt stays.

**35. "Turn around" is a gesture.**
Okafor's line 14 ("Show me your hands." [beat] "Turn around.") gets a staged turn:
1. **Hands.** On "Show me your hands", her hands rise slowly, palms out (`priya_hands_show`), and stay up through the turn.
2. **Hesitation.** On "Turn around", a 0.3 s pause with her eyes on Okafor.
3. **The turn away.** She turns slowly, at about 1.3 rad/s instead of the NPC default of 3.2. Her head lags the turn, and the existing turn-in-place steps move her feet.
4. **The freeze.** With her back to the glass she faces the surgery door, where the rattle just came from. Her head turns to it, her shoulders rise, and she holds about 0.6 s (`priya_hands_back_freeze`).
5. **The turn back.** Faster, at about 2.4 rad/s, eyes on Okafor as soon as she can see him (`priya_hands_turn_back`).
6. **Hands down** as she answers "No. I hid."

What this needs:
- a `turnRate` option on `npcLookAt`;
- a yaw-only target (`npcLookAt` toward an anchor behind her: `priya_turn_away`, in R08 toward `D_R08_R08b`);
- the two new poses in `src/data/poses.json`.

The steps are timed to the words in the clip, not to its end. Review the turn in the cast motion sandbox.

**36. Pacing.**
From section A to the armory runs about 70 s, and about 20 s of that is silence inside the clips. The pass:
- **Trim.** Pauses inside clips are capped at 0.6 s, except the written beats: the "..." in lines 5, 10, 17, 19 and 22, and the bracketed beats in lines 14 and 22. These are capped at 1.0 s. The trims are done on the master mp3s with `vo-takes.json` notes, so a re-generation keeps them. Worst offenders: `sec_priya_12` (3.0 s of silence), `sec_okafor_17` (2.8 s), `sec_priya_19` (2.3 s), `sec_priya_16` (2.2 s), `sec_giles_10` (2.2 s), `sec_priya_10` (1.5 s).
- **Overlap where people interrupt.** Okafor's "I know." steps on the tail of Priya's "I thought you were-". "We hear you." follows "Can you hear me?" with no gap.
- **Actions under lines.** Giles walks to the console during "It locked..." instead of waiting after it. The fixed 0.8 s wait after the intercom switch drops to 0.3 s (the click and static fill it). The 0.5 s and 0.6 s waits around the tray stay, because they are the hush.

Target: section A to the armory in no more than 80 s, with no lines cut. (The first estimate of 55-58 s was wrong: the lines alone are about 64 s, plus the 8 s armory bypass. Measured after the pass: about 78 s, down from about 88 s; accepted by the user 2026-11-23.) A sequence test measures that span against the clip durations.

**39. Okafor speaks to her at the glass.**
The playtest found the stretch from her death to Okafor at the console eerily empty: the 9.6 s still beat with only Jay's "...no.", then 4.5 s of silence at the glass. Now, about 2.4 s into the still beat (after Jay's line), Okafor walks to the glass, puts his hand on it and says a new line, `sec_okafor_22`, to her: [barely audible, his voice catching] "I'm here. ...I'm here." (echoing "Look at me. ... Me."). After the creature has gone and the door has closed he holds 1.2 s (was 4.5 s), then goes to the console. Rule 3 holds: no name. This supersedes the "at least 4 s of silence" in decision 30.

**40. The flooded tunnel is compiled before its door opens.**
Opening `D_R07_R09` stalled the frame (a 2-3 s freeze on the user's PC; 85 ms here with a warm shader cache): R09's standing water and floating junk compiled their shaders in that frame. The load warm-up does compile them, but against the canvas, where three keys them as sRGB output; the game draws into the post chain's linear target, so the frame the door opens compiles the linear variants. `medlab_door` now emits `render:warm { room: 'R09' }` as Okafor starts `tunnel_okafor_01`; the session compiles that room's group with a render target bound (`compileAsync`, so the link finishes off the main thread). Measured: nine programs compile at his line with no long task, and none when the door opens. Follow-up worth considering: the load warm-up has the same sRGB/linear mismatch for every room.

**41. The squad is put inside and the bulkhead seals during the bars.**
The playtest found Okafor sometimes talking from R06: `gatherIn` counted a squadmate in the doorway as inside, then the seal's collider could push him out, and a squadmate in Jay's view was never caught up. Now, at the end of Jay's scripted steps after her (bars up, the view on Priya), `squadCatchUpIn` with `force: true` places both squadmates at the entry spots just behind him whether or not they are in view or already inside, and `D_R06_R07` seals right then. The later seal after `gatherIn` is gone.

**37. The creature leaves through the door.**
The `still` beat's exit was a straight track from `r08_along` to `r08_lurk`, which met R08's east wall about 2 m south of `D_R08_R08b`. The creature slid along the wall and was then placed past the door. It also walked at 1.2 m/s in `maul_haul`, a pose made for the cut drag. The fix:
- New anchors `r08_surgery_in` (inside R08, in front of the door) and `r08_surgery_out` (inside R08b, past the door). The exit runs `r08_along`, `r08_surgery_in`, `r08_surgery_out`, `r08_lurk`.
- The creature walks at about 1.7 m/s in a new `maul_prowl` pose (arms loose, head low).
- Its head turns once toward the glass as it passes the viewing strip.

The entrance track (`along`, `lane`, `lane2` from `r08_lurk`) is checked the same way and goes through the same two anchors. A test checks that no segment of either track crosses a wall collider.

**38. Kill events cue only live scores.**
`ScorePlayer.onEvent` cued every score with a cue of that name, and loaded a released score to do it. Priya's kill emits `kill:still`, so Lab B's score, released in R06, restarted with its `hold` layer at 1.37 over her death, and played until the tunnel cued it again. Now a bus event cues only a score that is loaded (by a `score` step with `load` or a cue) and not released or fading out. Sequence `score` steps start scores as before. Lab B is loaded up front in `drop.json`, `rounds.json` and `action_tunnel.json`, so Voss's kill and the tunnel still drive it. After this fix, during Priya's death only the `medbay` score plays.

## Risks / Trade-offs

- [An early stare makes the remaining approach look rushed, or cannot be made up] -> Cap the catch-up walk at 1.4 m/s and author `at` and the attacker's entry so that even a stare on the very first frame after entry leaves enough distance to recover the 1.5 s within that cap. Task 2.9's "Fixed beat clock" test checks the earliest possible stare.
- [Free movement lets Jay miss the kill, from the armory or by looking away] -> Accepted, as in Lab B. Nothing is skipped. The run, the creature's walk past him and the noise all pull the eye to the glass.
- [Jay stands where the creature's walk along the glass is behind a squadmate] -> The squad hold the ends of the viewing strip, and the walk runs along the R08 side of the pane, so the creature is in front of anyone in the strip.
- [The impale reads as a punch without an arm IK] -> The claw hold is on her torso, so her body hangs off its arm. The heavy spurt and the impale sound sell the moment. Review in the cast motion sandbox before the scene.
- [Liquid drops cost more than points] -> Use one instanced draw call with the same ring buffer size, and cap decals. Check with `?memprobe` (spec `runtime-memory`).
- [Moving R08 props changes the CAM 04 framing] -> Re-check the stinger's opening frame from the re-aimed `cam04_pos` after any R08 move.

- [The kinematic grip looks stiff with no arm IK] -> Keep the hand close to the held joint with pose choice, cut most of the read to her body; add IK as follow-up if playtest asks.
- [Root clamping lags when the attacker turns fast] -> Cap the attacker's haul speed at 1.4 m/s and its turn rate during grip.
- [Head-through-cart clipping on impact] -> The target plane is authored per anchor; hold the head at the surface on impact rather than letting the pose drive it.
- [Graphic content with reduced gore] -> The `mauled` style honours the existing reduced-gore path (dark blood, fewer chunks); the head slams still play, with fewer spurts.
- [Overlap with `adopt-physics-engine`] -> This change touches only kill data/binding and NpcActor root placement. If that change lands first, a ragdoll throw can replace the kinematic flight in `throw` without touching the specs.
- [VO generation cost and casting drift] -> New lines follow `docs/voice-casting-standard.md`; generate in audition mode first.

- [The rescue drags, at 75-90 s before the creature] -> Each section ends on something going wrong: a door that refuses, a sound, her panic. Playtest it with a stopwatch, and cut lines before cutting sections.
- [The intercom and the direct sound through the glass double up or comb-filter] -> The relay comes from a grille on the far side of R07, with its own band-limiting, and the mix is tuned so the relay leads. If it still smears, add a few ms of delay on the relay.
- [The overload is too harsh on the scream] -> The follower drives saturation and crackle up to a cap, never clipping the master bus. Check the audio audit level for that moment.
- [The 'Sit.' callback reads as a joke] -> Delivery direction (line 22-23 notes) and placement straight after the tray drop. Reviewed in VO audition before the scene is built around it.
- [Removing Giles's stages 1-2 breaks a test or code path that expects them before the tunnel] -> Task 14.1 searches for readers of the stage flag and keeps their behaviour at the stage the tunnel sets.

## Migration Plan

Data and generator changes ship together; regenerate `slice01.json` with `node scripts/gen-slice01.mjs`. Rollback is reverting the change; the old `sec_glass` steps are kept only in git history.

## Open Questions

- Should the glass-mark restore be recorded marks or a fixed authored end state? Either meets the spec; decide during task 5.6 by what is simpler in `gore`.
- Decided: the cart is a new `instrument_cart` kit piece (about 1.0 x 0.55 m, top 0.9 m, lower shelf, instrument tray, casters), not a low gurney. A gurney is 2 m long and would put Priya's body across the stage.
- Whether the walls either side of the glass door can stay glass or must be solid. Decide by what the door tile allows; solid jambs are acceptable (decision 11).
- Optional: restraint straps on one R08 bed (`med_bed` `restraints: true`) to hint that patients were already turning. Not needed for any scenario.
