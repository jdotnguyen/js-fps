# ADR-0014: Slice content: map, beat sheet and script outline

Status: Accepted (structure from Q&A) / Proposed (specific beats, names, map)

## Context
The slice is 10-15 minutes [Decided]: quiet opening then "the drop" [Decided], horror beats
including transformations and people killed behind glass [Decided], shambler and play-dead
enemies [Decided], the shotgun appearing partway [Decided], no squad deaths [Decided], and a
cliffhanger where the engineer reveals he is infected [Decided: Option A]. Future chapters
go back in time [Decided]. The overall story ending is open [Open].

## Setting placeholders [Assumed]
- Station: **Thalassa Deep Research Station**, ~3,000 m down. Name is a placeholder.
- Infection: unnamed in this slice; researchers called it "the bloom".
- The team: player (security officer, silent), August Giles (engineer), Dr. Tomas Okafor (medic).

## Map (rooms)
| ID | Room | Purpose |
|---|---|---|
| R01 | Docking ring corridor | Start, walk and talk, abyss windows |
| R02 | Commons | Normal life: crew eating, PA, quarantine notice |
| R03 | Observation gallery | Glass wall looking into R04 |
| R04 | Lab B (seen through glass) | Transformation set piece #1 |
| R05 | Lab junction | First contact, pistol and dismemberment teaching |
| R06 | Pressure door hall | "Cover me" defence |
| R07 | Security office + armory | Breathing room, shotgun, play-dead intro |
| R08 | Medical bay (seen through glass from R07) | Dragged-away kill, set piece #2 |
| R09 | Flooded maintenance tunnel | Wading, dying lights, mixed enemies, hint use |
| R10 | Valve room | Puzzle-lite: restore pressure to open R11 |
| R11 | Control room | Climax defence, then cliffhanger |

Flow is linear with small side rooms (lockers with ammo) for exploration.

## Beat sheet (target times)
1. **0:00-2:30 Quiet (R01-R02).** Shift change. A skippable on-rails intro (ADR-0017): the
   player guards the docking ring, Giles and Okafor arrive, banter sets personalities, and
   the player follows them to the kitchen. Learn move, look, flashlight, interact (badge door). Crew acts normally.
   PA announces a "routine quarantine" of Lab B. *Foreshadow 1:* Giles rubs his forearm and
   dismisses it.
2. **2:30-3:30 The drop (R03-R04).** In the gallery a researcher in R04 convulses and
   transforms behind the glass (stage 0 -> 3). Lights die, emergency red, alarm. Glass
   cracks but holds. Lockdown seals the way back. Checkpoint.
3. **3:30-5:30 First contact (R05).** A shambler breaks through a door. Pistol use. Okafor:
   "Legs! Take its legs!" Severed limb demonstrates the rule. Okafor sets the revive rule in
   one line: "You go down, I'll get you up. If I go down, we're both done." Two to three more trickle in.
   Checkpoint.
4. **5:30-7:30 Cover me (R06).** Sealed pressure door. Giles bypasses it (20 s task) while
   ~6 shamblers come from a vent and the corridor. First grab; a teammate shoots it off.
   Checkpoint.
5. **7:30-9:00 Breathing room (R07-R08).** Security office; Giles unlocks the armory: shotgun.
   Corpses on the floor; one is a play-dead and gets up as the player passes. Through the
   glass to R08, Okafor's nurse, Priya Anand, is dragged out of view by something unseen and killed (docs/characters.md); blood on the
   glass. *Foreshadow 2:* Giles goes ahead alone to a panel ("I'll get the panel, go"); a
   scream-like sound off-screen, he returns. *Foreshadow 3:* a fresh bandage on his
   forearm: "Cut it on the panel." Okafor offers to look; he refuses. Checkpoint.
6. **9:00-12:00 Flooded tunnel and valve (R09-R10).** The way from R07 into R09 runs
   through a med-lab biometric door that only Okafor can open (his specialist moment). Knee-deep water slows movement; dying
   lights; shamblers and play-deads among floating debris. The player must find and turn
   the valve (hint system teaches itself here). Checkpoint.
7. **12:00-13:30 Climax (R11).** Restore control room power (Giles, 30 s task) while
   ~14 enemies (max 8 active) come through two entrances. The shotgun shines.
8. **13:30-15:00 Cliffhanger (R11).** Doors sealed; silence; relief banter. Giles at the
   final console. Lights come back on and show a fluid trail behind him. He says quietly,
   "I didn't want you to see this." The player's look is soft-locked on him, his arm
   convulses and begins to change. Okafor, blindsided, steps toward him; Giles says "Stay back,
   Tomas." Cut to black. Title card. (ADR-0022)

## Script outline
- About 80-110 lines in `data/dialogue/slice01.json`: ~40 story, ~20 hints, ~40 barks.
- Giles: dry, competent, deflects with humour (makes the reveal hurt).
- Okafor: calm, clinical, the first to understand what the bloom is.
- PA and unknown voices for atmosphere.
- Lines are written after systems work (step 5 below), so they fit real timings.

## Checkpoints
`cp_first_contact` (R05), `cp_cover_me` (R06), `cp_security` (R07), `cp_flooded` (R09),
`cp_climax` (R11).

## Execution steps
1. Block out all rooms in level JSON with structural kit only; walk it for pacing
   (target 12 min on Standard by a first-time player).
2. Place lights, atmosphere, doors, triggers, spawns, checkpoints.
3. Prop dressing per room.
4. Sequences for each beat.
5. Write dialogue and hints; placeholder VO.
6. Encounter tuning on all difficulties.
7. Cliffhanger polish.

## Definition of done
- A first-time player finishes in 10-15 min on Standard.
- All three foreshadowing beats are noticed by at least one playtester, and the reveal
  still lands.

## Open questions
- Overall story ending, the bloom's origin, station and title names.

## Amendment (2026-11-16): the quiet half grows, Priya survives R08
Supersedes beat 1, the 2:30 timing of beat 2, the Priya part of beat 5 and adds a stinger.
- **Beat 1 becomes the quiet half** (ADR-0023), roughly 10-12 min: on-rails intro (ADR-0017)
  -> free time in the commons -> on-rails briefing in R03 with Katie Heins and Director Hale,
  Lab B blinds down -> morning rounds through three hubs in any order (R12 hydroponics, R13
  dive bay, R14 TAG admin office), with the Level 2 Card backtrack and a security-camera
  foreshadow -> the PA calls the team back to the gallery. The horror waits until the player
  has lived in the station [Decided].
- **Beat 2, the drop**, now starts there, with the blinds up. Flashlight is taught earlier, in
  the dive bay (ADR-0025).
- **Beat 5, R08** [Decided]: clear glass; Priya's attack is extremely gruesome, mean-spirited
  even, and reads as a death. Expect several passes. **She survives it**; the player and the
  squad believe she is dead.
- **Stinger after the title card** [Decided]: a security-camera feed shows Priya alive, hurt
  and hiding. Something (the R08 attacker or not) comes into frame and kills her, slowly, on
  purpose. The player endures not being able to save her a second time.
- Okafor's "Routine means the paperwork was filed" line moves here from the intro [Assumed].
- **Length**: no hard cap; 10-15 min was a guideline [Decided]. Estimate now ~25-30 min.

## Progress (2026-11-17): slice01 blocked out (map as built)
`src/data/levels/slice01.json`, generated by `node scripts/gen-slice01.mjs` (edit the room table
there and re-run; do not hand-edit the JSON). Boot with `?level=slice01` (`&debug` for overlays).
One deck, 4 m grid; cell (x, z) is world (4x, 0, 4z), +z is south. New kit in `world/kit/slice.ts`.

| Room | Name | Area | Notes |
|---|---|---|---|
| R01 / R01w / R01a | Docking ring, ring walk, dock airlock | dock | Guard post, 3-tile dock window with the supply sub outside, abyss window on the walk, dock door `D_dock` |
| R02 | Commons | commons | Kitchen counter, coffee machine, tray, radio, tables, sofas, quarantine notice, TAG posters, TV `commons_tv`, map station |
| R03 / R04 | Observation gallery / Lab B | gallery / labs | Glass wall with blinds `labb` (down), briefing screen `brief_screen` |
| R05, R06 | Lab junction, pressure door hall | labs | `D_R03_R05` locked until `drop:done`; `D_R04_R05` sealed (the shambler's door); `D_R06_R07` bulkhead, engineer `bypass_short` |
| R07 / R07a | Security office / armory | security | Glass into R08; armory `D_R07_R07a` engineer; `D_R07_R09` medic `biometric` |
| R08 / R08b | Medical bay / surgery (hidden) | medbay | Seen through glass only; `D_R08_R08b` sealed (the drag exit) |
| R09, R10 | Flooded tunnel, valve room | tunnel | Water at 0.45 m (visual + "water" footsteps); valve use trigger unlocks `D_R10_R11` |
| R11 | Control room | control | Entrances `D_R10_R11` and `D_R13d_R11` (sealed until the climax opens it) |
| R12a-e | Hydroponics vestibule, grow hall, seed lab, nutrient room, storeroom | hydroponics | `hydro_store` needs `card_l2`; `hydro_vent` needs `vent_driver` |
| R13a-e | Dive access, moon pool, suit room, maintenance corridor, dive lockers | dive_bay | R13d is the dim corridor (`area:dark`) |
| R14a-e | Reception, open office, Director's office, meeting room, security booth | admin | `P_card_l2` on Hale's desk; security monitor `admin_cam` (CAM 04 MEDICAL BAY) |

- **Trigger emits** (`trigger:fired` carries them; doors/props can listen by name):
  enter `trigger:walk_window`, `trigger:commons_enter`, `trigger:commons_to_gallery`,
  `trigger:gallery_enter`, `trigger:gallery_brief_spot`, `trigger:hydro_enter`,
  `trigger:hydro_store_enter`, `trigger:dive_enter`, `area:dark` (R13d, once),
  `trigger:admin_enter`, `trigger:hale_office`, `trigger:security_booth`, `trigger:r05_enter`,
  `trigger:r06_enter`, `trigger:r06_door`, `trigger:r07_enter`, `trigger:r07_playdead`,
  `trigger:r08_glass`, `trigger:r07_armory`, `trigger:r09_enter`, `trigger:r09_mid`,
  `trigger:r10_enter`, `trigger:r11_enter`; use: `commons:radio`, `commons:coffee`,
  `commons:notice`, `round:hydro_log`, `round:hydro_alarm`, `round:dive_case`, `valve:r10_main`.
- **Anchors**: all of ADR-0017's list plus the drafts' (`post_front`, `dock_window`, `dock_door`,
  `walkby_stop`, `post_okafor`, `post_giles`, `walk_mid`, `walk_window`, `abyss_window_walk`,
  `kitchen_door`, `counter`, `counter_okafor`, `counter_giles`, `kitchen_stand`, `cook_stand`,
  `radio`, `coffee_machine`, `priya_start`, `priya_enter`, `priya_stand`, `priya_offer`,
  `priya_exit`, `brief_jay`, `brief_giles`, `brief_okafor`, `brief_heins`, `brief_screen`,
  `labb_blinds`, `labb_glass`, `labb_victim`, `drop_jay`), checkpoint spots for sequence-driven
  saves (`cp_intro`, `cp_briefing`, `cp_round_hydro`, `cp_round_dive`, `cp_round_admin`),
  set-piece points (`r06_panel`, `r07_panel`, `r07_glass`, `shotgun_pickup`, `okafor_biometric`,
  `priya_r08`, `r08_drag_exit`, `valve_r10`, `giles_final`, `final_console`, `r11_hold`,
  `hydro_log`, `hydro_alarm`, `hydro_store_moment`, `dive_case_pickup`, `dive_case_locker`,
  `dark_corridor`, `hale_desk`, `hale_stand`, `admin_cam_monitor`, `admin_cam_view`, ...).
  Run `level.anchorIds()` for the full list.
- **NPCs at load**: giles, okafor, ruiz, sung (dock airlock), priya (outside the commons' south
  door), cook, crew_1-3, heins, researcher_b, botanist_1-3, diver_1-2, maint_1, assistant,
  exec_1-2, hale.
- **Spawn groups** (all `active: false`): `r05_contact` (Lab B door, vent, floor),
  `r06_cover` (two wall vents, ceiling, corridor; 6 total), `r07_playdead` (one play-dead,
  `on: trigger:r07_enter`; other bodies are anchors `body_r07_*` for dressing), `r09_tunnel`
  (floor, two play-deads, vent), `r11_climax` (both entrances, ceiling vents, a hero; 14 total).
- **Checkpoints in data** (auto on entering the room): `cp_first_contact`, `cp_cover_me`,
  `cp_security`, `cp_flooded`, `cp_climax`. Quiet-half checkpoints are taken by sequences
  (their rooms are visited before the save would make sense), using the `cp_*` anchors.
- Supplies: pistol/shotgun ammo and medkits at `ammo_r05`, `health_r07`, `ammo_r07a`,
  `ammo_r09`, `health_r10`, `ammo_r11`. No weapon pickup kind exists yet; `shotgun_pickup`
  marks the armory rack.
- Verified headlessly (`world/slice01.test.ts`): schema, every draft anchor, per-room draw calls
  <= 60 (worst R02 58, R01 56), <= 300 visible from any room (worst 231 from R12a), a body
  walking the whole critical path through the real colliders and doors (card backtrack, valve).
  **Not seen in a browser**: looks, lighting, prop scale/placement, frame rate.

## Progress (Part B built): the action half, beats 3-8
Sequences in `src/data/sequences/action_*.json` (all headless-tested in `src/script/action.test.ts`):

| Beat | Sequence (trigger) | What it does |
|---|---|---|
| 3 | `contact` (`trigger:r05_enter`, needs `drop_done`) | Seals `D_R05_R06` (a locked door would let Jay unlock it himself); three knocks on the sealed Lab B door; Giles "Is that one of the lab techs?", Okafor "Not any more."; the door gives, group `r05_contact` (1); "Legs! Take its legs!" (new story line `contact_okafor_03`); after the kill "The legs. Did you see?" and the revive rule; group `r05_trickle` (3: vent x2, floor); door unlocks; `contact_done`, `cp_contact_clear`. |
| 4 | `cover_me` (`trigger:r06_door`, needs `contact_done`) | Giles walks to the panel and the 20 s `bypass` task runs while `r06_cover` (6) comes; the bulkhead opens when the task ends; once all six are dead: flexes his hand, the numb-hand line, Okafor glances, "Fine. Go on."; stage 1; `cover_done`, `cp_cover_done`. |
| 5 | `armory_auto` (`trigger:r07_enter`), `sec_glass_near`, `sec_rescue`, `sec_glass` | Priya is placed in R08; Giles opens the armory on his own (8 s task) so the shotgun pickup (a `weapon_shotgun` supply, pistol only before) is reachable. The glass scene starts when the armory is open AND Jay is at the glass (`trigger:r08_glass`, either order; trying the biometric door early forces it). It waits for the play-dead (max 20 s, then removes it), locks Jay (no move, no weapons), and plays Priya's attack (below), Okafor's "Routine means the paperwork was filed", Giles to the armory panel alone, the strangled cry, back with "Cut it on the panel", Okafor's offer refused. Stage 2; `sec_done`, `cp_security_done`. |
| 6 | `medlab_door` (`door:denied` `D_R07_R09`), `tunnel_enter` (`trigger:r09_enter`), `valve_turn` (`valve:r10_main`) | Okafor hesitates, 5 s `biometric` task, door opens. The tunnel spawns `r09_tunnel`, "Quiet. Something's in the water.", Giles's valve question and a cough; stage 3. Wading slowdown is the existing `water` surface (x0.6). The valve: shake, groan, the Mara moment (`valve_quiet_*`, Jay keeps control), `cp_valve`. |
| 7 | `climax` (`trigger:r11_enter`, needs `valve_done`), `climax_hero` | Both entrances forced open, 14 enemies in `r11_climax` (director cap 8 alive, one hero), Giles's 30 s `power_restore`, Okafor's "Two entrances", Giles's "Halfway!" at 50 % task progress (new `waitFor match/min`), the hero call. Won when the job AND the group are done; both doors seal; `climax_done`, emits `climax:won`. |
| 8 | `cliffhanger` (`climax:won`, skippable), `title_card`, `stinger_priya` (skippable) | Banter, lights back on (`tint none`) and the fluid trail revealed (stage 4), view soft-locked on Giles, "I didn't want you to see this", the three plain confession lines, Jay's "...Giles.", the transformation starts (`transform giles to 1`, 9 s), Okafor steps toward him, "Stay back, Tomas.", fade to black. Title card (`THALASSA` / `SLICE ONE`, [Assumed] placeholder). Then a fullscreen CCTV feed of the surgery: Priya hurt and hiding, the attacker walks in slowly, gore, static, off, fade, `endSlice` (thank-you toast, back to the title after 5 s). |

- **Priya's attack** (extremely gruesome, reads as death, she survives): she comes to the glass pleading, a thing from the surgery grabs her through the pane; blood climbs the glass in three levels (`glass:blood`, new `glass_blood` prop on the R07 glass), the pane cracks (`glass_cracks` id `medbay`), gore bursts/splash/chunks/pools (new `gore` action), she is hauled across the floor along `r08_drag_*` leaving pools, then moved (instantly, out of sight) to the surgery and the attacker removed. [Assumed] the choreography is a first pass; every beat is one step in `action_security.json` (`sec_glass`) so Justin can iterate by editing data.
- **New systems**: actions `waitGroup`, `gore`, `titleCard`; `waitFor` takes `match`/`min` payload filters; a counted `loop` now applies its body when skipped; host `gore`/`titleCard`; `ui/titleCard.ts`; kit props `glass_blood` and `fluid_trail`; sequence `action_restore` re-applies doors from flags on every `game:mode playing` (a page reload or a death restore resets doors to the authored state); debug `?debug&jump=r05|r06|r07|r09|r11` (flags + position at that beat's data checkpoint); objectives `obj_hold_door`, `obj_armory` (optional, completes when the shotgun is picked up), `obj_medlab`, `obj_valve`, `obj_power`.
- **Death**: every gameplay sequence is `resumeFromCheckpoint` and keyed on `unless: <beat>_done` flags, not `once`, because level triggers latch and are not reset by a death restart. Each finished beat takes a sequence checkpoint (`cp_contact_clear`, `cp_cover_done`, `cp_security_done`, `cp_valve`) beside the data checkpoints on room entry. The climax now takes `cp_climax_won` just before `climax:won` (flags `climax_done`, the cleared group and `giles.infectionStage` are saved with it); on a load `reveal_restore` (`game:mode playing`, needs `climax_done`, unless `reveal_done`) re-places Giles and Okafor, puts R11 back to `dying`/emergency and replays the reveal (it does nothing when `seq:cliffhanger` is already set, so pause/resume is safe; `reveal_done` is set before `endSlice`). action_restore seals the doors. A manual save taken mid-reveal carries `seq:cliffhanger` and will not replay it (accepted).
- **[Assumed]**: all timings; Giles opens the armory himself rather than on interaction; the glass scene locks Jay's weapons and movement; D_R05_R06 is locked during first contact; the play-dead is removed if still lying after 20 s; the title text; `endSlice` returns to the title after 5 s.
- **Done since**: Giles's bandage (flag `giles.bandaged`, set in `sec_glass` once he is back from the armory panel) and his stage-3 veins and sweat (overlay meshes, `actors/castTells.ts`, driven by `squad.applyTells` from the flags every 0.5 s, so a load or restart restores them); the `gore` action takes `clipAxis`/`clipAt`/`clipKeep` and the gore system stops particles and chunks on that plane (`actors/goreClip.ts`; `sec_glass` clips at z 46.05 keeping the bay side); the climax checkpoint (above); a radio in the ruined R05 junction (`r05_radio`, on after first contact, off at `trigger:r06_enter`).
- **Done (drag, reveal restore)**: Priya's drag in `sec_glass` is now a rope, not waypoints: `npcDrag { npc, by, pose?, distance? }` makes her trail 1.1 m behind `r08_thing` (catch-up 2.6 m/s, so no pop) in `corpseSupine`; `npcDrag stop` (and any skip or `NpcDirector.reset`) lets go. `Humanoid.carried` forces a held pose and no gait; `npcMoveTo`/`attachToTrack` take `pose` for the same. `attachToTrack`'s `track` also accepts comma-separated refs (`anchor:a,anchor:b`), built into a polyline through the nav graph (`NpcDirector.trackPoints`); level paths still win if `deps.track` knows the id. `reveal_restore` now replays the reveal after a manual save mid-reveal and after a death restart into `cp_climax_won` (see ADR-0009 progress).
- **Not done / weak**: the rope ignores walls (it is 1.1 m and the route is open); none of it has been seen in a browser (see `docs/PLAYTEST.md`).
