# Playtest checklist: the action half (ADR-0014 beats 3-8)

Nothing here has been seen in a browser. Automated checks only prove the sequence logic (tsc clean, `src/script/action.test.ts`,
`world/slice01.test.ts`). Start with `npm run dev`, then use the dev URL (usually `http://localhost:5173/`).

## URLs
| URL | What it does |
|---|---|
| `/?level=slice01` | The full slice from the intro (about 25-30 min). New game plays the intro. |
| `/?level=slice01&debug&jump=r05` | Skips the quiet half; flags and position of that beat's data checkpoint. `jump` = `r05` (first contact), `r06` (cover me), `r07` (armory + Priya), `r09` (med-lab door, tunnel, valve; you get the shotgun), `r10_flood` (in front of the valve: the flood cutscene), `r11` (climax + reveal + end). Press New game, the jump happens 0.4 s after play starts. |
| `&debug` | Stats, lil-gui, the running-sequence overlay (shows the current step of each sequence), F1 fly cam. |
| `&seq=<id>` | Runs one sequence 1.2 s after play starts, applying its `debugSetup` flags. Useful: `cliffhanger`, `stinger_priya`, `title_card`, `sec_glass`, `climax`. Stand in the right room first (fly with F1), or combine with `jump`. |
| `&enemies=shambler:3,hero,playDead` | Debug-spawn enemies (existing). |
| `&give=card_l2` | Key items at the start (existing). |

Skip: hold the skip key during the reveal (`cliffhanger`) or the stinger. The rest cannot be skipped. Death restarts at the last checkpoint:
data checkpoints `cp_first_contact`, `cp_cover_me`, `cp_security`, `cp_flooded`, `cp_climax` (on room entry) plus sequence ones
`cp_contact_clear`, `cp_cover_done`, `cp_security_done`, `cp_valve` (end of each beat).

## Per beat
**R05 first contact** (`jump=r05`)
- Three knocks, Giles/Okafor lines, the sealed Lab B door gives and one shambler comes. "Legs! Take its legs!" plays. Shoot a leg: the "The legs. Did you see?" line plays only after the kill, then the revive-rule line.
- 3 more arrive (vent x2, floor). The door to R06 stays locked until all are dead ("Sealed from the other side."), then opens; `cp_contact_clear` toast.
- Lab wing look (openspec rebuild-lab-wing): clean slate walls under red lockdown lights with one white work light; the three sources are the gallery door, the west vent and the floor drain grate by the south wall (`r05_drain`), so check the floor shambler climbs out of the grate. The coolant line runs along the ceiling from Lab B into R06; after the drop, one bloom mass and a wall patch sit where it leaves the room.
- Die mid-fight: you should restart in R05 and the fight replays from the knocks.
- Look back through the glass (openspec two-way-glass-visibility): once the Lab B bulkhead is open, step into Lab B and look north. The Observation Gallery (walls, sofa, console, lit fixtures) and the glass panes are drawn, with the cracks and Voss's blood on the glass; no black void and no commons crew floating beyond it. If the gallery's door to the commons stands open, the doorway shows black (known, accepted).

- **Blackout** (openspec station-blackout): kill the last trickle monster. Within 2 s the radio chatter starts: four voices (Station Ops, Docking Ring, Hydroponics, Launch Hall) one after another, each starting about 1 s before the last ends, two cut off mid-word, all with subtitles. Okafor: "That's the whole station." The PA announces the power failure from the Lab Junction speaker (also heard in Lab B), then the power-down sound and every room drops to dim, warm backup lights (darker than the drop's red), beacons on the walls, tubes silent, beacons humming. With the flashlight off, the "Flashlight" prompt shows. The door to R06 closes and `cp_contact_clear` saves. Reload it: still dark, and the chatter does not replay.
- No radio music in the Lab Junction any more; the kitchen radio in the Commons is the only one.

**Flashlight** (openspec station-blackout, player-flashlight spec; no model since swap-viewmodels-to-just-models)
- Press F with the pistol out: the beam fades in within about a quarter second from low and to the left of the view (the chest). No flashlight model or hand appears. F again fades it out.
- Switch to the shotgun and holster with the light on: the beam stays and comes from the same point each time.
- Spin the mouse fast, look up and down, land from a jump: the lit spot is on the crosshair on every frame (no lag, no overshoot, no drifting on after you stop).

**Weapon viewmodels** (openspec swap-viewmodels-to-just-models; models by JUST, rebuilt by `scripts/fix-just-weapons-glb.mjs`)
- Draw the pistol and the shotgun: the same gloves on both, both arms leaving through the bottom or side edge, no loose hand or forearm end. Try 16:9, 4:3 and 21:9 windows, and the field of view slider at 70 and 95 (the menu range), at rest, aiming, sprinting, reloading and switching.
- The pistol reload is one 3.7 s motion, empty or not: the magazine sound as it leaves the grip (about 0.6 s), the seat (about 2.2 s) and the slide (about 3.1 s) line up with what you see, and the pistol is full when it ends.
- The shotgun fires and pumps in one motion (the pump sound and the hull about 0.6 s after the shot), and the next shot is ready at 0.85 s. Reload from empty: opening, one motion per shell with the shell sound as it seats, then the closing rack. Fire mid-reload: it shoots at once and keeps the shells already in.
- On High (the tier with ambient occlusion), turn slowly in a dark or red-lit room with a weapon out: no streaks or repeating pattern slides across the gun or gloves, and it looks the same on Medium. To compare live, start with `&debug` in the URL (the handles `__post` and `__water` only exist then) and run `__post.setQuality('medium')` or `'high'` in the console. The weapons are flagged `skipGtao`, so AO neither shades nor reads them.
- Look at the gun in a dark room and under a red emergency light: the gloves and slide are lit evenly, not blown out, and show no streaks or repeated stripes (the viewmodel fill light must stay about 0.45 m from the grip).
- Sprint with each weapon: the gun is carried low across the body with the muzzle down, the view stays clear, and both arms leave through the bottom edge. Holster or open a menu: the gun drops fully out of view.
- Stand still with a weapon out: it drifts slowly and slightly (breathing). With reduced motion on, it stays still.
- Recoil is now carried by springs, since the new `Shoot` clips barely move the gun (starting values, pistol about 2.5 cm back and 2 degrees of lift, shotgun about 6 cm and 4.5 degrees): say if it feels weak or too much.

**Hale's office** (openspec end-scene-when-player-leaves, scene-presence spec). The scene `admin_hale` is bound to the Director's Office (`R14c`) by its `room` field. Walk in with the briefing done, then try these on a scratch slot (`?slot=scratch`):
- Stay put: Hale, Jay ("Everything all right, Director?") and Hale's last two lines all play.
- Step out through the glass door in the middle of any line: that line, its subtitle and its voice stop at once, and nobody says anything more, Jay included. Hale drops the gesture and the look and idles. Go and stand in the open office with the door open: still silent.
- Leave in the pause before Jay's line: Jay does not say it.
- Walk back in: nothing restarts. The card still comes with the desk exchange and completes the Admin round.
- The Commons walk-by (`researcher_walkby`, bound to `R02`; after the first round, on entering the Commons): a lab researcher crosses the room and Jay greets them ("Morning, Doctor.", then "...Rough night, I guess."). Leave the Commons before or between the two lines: Jay says nothing more, and the researcher is gone, not left standing there.
- Authoring: put `"room": "<room id>"` on a sequence for a stationary talk-to-an-NPC scene that should end when Jay leaves. Leave it off for scenes where the squad walks and talks with him, which keep the earshot rule for Jay's lines. A `room` that is not in the level warns when sequences load.

**Dive bay corridor** (dive-bay spec): the Launch Hall door to the maintenance corridor (R13d) says "This door won't open. Out of service." during the rounds. In the R11 climax the corridor still opens from the Control Room.

**R06 cover me** (`jump=r06`)
- Walk to the bulkhead: Giles runs to the panel, "Cover me", 6 enemies from two vents, the ceiling and the corridor. The 20 s job pauses while enemies are on him. Door opens when the job ends; the stage-1 tell (flexes hand, numb-hand line, Okafor "August?") only after all 6 are dead.
- Check the enemies really come at Giles and Jay, not only at one of you; the bulkhead stays shut until the job is done.
- Four sources (rebuild-lab-wing): the ruptured ceiling duct (`r06_duct`), the drain trench along the west wall (`r06_trench`, two), the east vent low on the south-east wall (`r06_vent_e`, two) and the corridor door behind you (`r06_corridor`). The hold point (`r06_hold`) is the spot north of the pump skid; from there you should see Giles at the panel and the trench and duct without turning more than about 75°.
- The status board over the bulkhead reads COMPARTMENT 3 LOCKDOWN in red and turns green when the bulkhead opens; after a death it should be red again.
- Giles on the line: the coolant line comes down the wall into the power box he works on (`r06_panel`, south wall left of the bulkhead). Check he faces the box, and that the dropped pipe and the DANGER sign don't hide his hands.

**R07 armory and Priya** (`jump=r07`)
- Enter: Giles opens the armory on his own (8 s). Pick up the shotgun (press 2). Pistol only before it. One play-dead on the floor rises as you pass.
- Walk to the glass wall: you are locked in place facing the medical bay. Priya runs to the glass, a thing takes her. Look for: blood climbing the glass in three steps, the pane cracking, gore (spray, chunks, floor pools), a drag trail to the east door, the sounds. She must read as dead. Okafor says her name once and gets back to work.
- Then Giles "I'll get the panel, go", a strangled cry from the armory, Okafor "August? Talk to me", Giles back with "Cut it on the panel", Okafor offers, Giles refuses. Controls return; the objective is the med-lab door.
- This is the scene to iterate on: all of it is `sec_glass` in `src/data/sequences/action_security.json`, one step per effect.

**R09 flooded sump and R10 pump room** (`jump=r09`, `jump=r10_flood`; openspec overhaul-flooded-tunnel)
- Interact with the med-lab door: Okafor hesitates, badge task (5 s), door opens. Walk down the stairs into the water: it gets deeper step by step (slower, no sprint past the knees), the first wet step splashes, then wading steps and a slosh while you move.
- The water: lit by the tubes, reflecting the tunnel (Medium and High), murky with depth (the lower steps fade). Rings from your steps, a wake from the shamblers before they round the bend, splashes from shots, drips and the burst pipe; floating junk bobs. Try Low: no reflection, the rest the same.
- Failing tubes (slow stutters, dark spells), the loose tube swinging, the broken fixture at the bend throwing sparks that hiss in the water. Shamblers rise out of the water; the two play-deads float face down.
- Jump in the water (heavier, a splash). The ammo is on the steel case by the bend: jump onto it from the water. Drop back in: a landing splash. Get downed in the water: the view stays above the surface.
- From the pump room, look down through the low window into the sump bay and through the door's porthole.
- The valve (`jump=r10_flood`): bars, view on the wheel (valve grind); the R09 door stands open; the score starts under the alarm; red beacons, alarm blast and klaxon; the view turns to the door; Okafor: "Something's coming up the stairs!", then the elite (blade-armed hero body) shrieks and charges; "Seal it now!" and the door closes during the line, the leaves meet as it ends with one big music hit on the slam. It pounds twice with the music still going, then walks back down; control comes back and Giles asks "Is it gone?"; the music fades after. No line about the door starts after it has sealed. R09's water does not rise. Not skippable the first time; on a replay (or after restoring an earlier checkpoint) hold to skip at any point: same end state. Then `cp_valve`, the R11 bulkhead unlocks.
- The ambush: walk up to the R11 bulkhead. A bang and a jump-scare sting, the view whips round to the R09 door: the elite's blades stab into the seam, clamp together and wrench the leaves part-way apart from the middle (the door stays sealed, screen red, gap too narrow to pass); it lunges into the gap, the door slams back and shears both forearms off into the pump room (they stay on the floor); it shrieks; Okafor: "Its arms...". Once per save. R10 stays fully lit on backup power.
- Reload after `cp_valve`: the door sealed, beacons and klaxon on, no cutscene (the ambush still to come if it had not played).

**R11 climax** (`jump=r11`)
- Both entrances open. Giles works at the console for 30 s, 14 enemies, never more than 8 alive, one hero (Okafor: "Big one. Shotgun, Jay. Now."). Check the shotgun feels good, ammo is enough (3 pickups in the room), and the fight is winnable on Hard. "Halfway!" at 50 %.
- Won when the job AND all 14 are done: doors seal.

**Reveal, title card, stinger** (`jump=r11`, or `&seq=cliffhanger` in R11)
- Banter, "Lights in three, two...", the lights come up, the teal fluid trail is on the floor behind Giles, you cannot look far from him, "I didn't want you to see this", the plain confession, Okafor steps toward him, "Stay back, Tomas." as his arm begins to change, black.
- Title card "THALASSA / SLICE ONE" (placeholder). Then a fullscreen security feed of the surgery: Priya alive and hurt, the thing walks in slowly, she begs, it kills her, static, off, "End of slice" toast, back to the title after 5 s.
- Try skipping both: the end state must match (lights up, trail, black, then the stinger plays the last frame and ends).

## Load from title, squad gathering (unify-checkpoint-restore)
- **Continue after a page reload:** play to the Valve Room (`cp_valve` toast), reload the page, Continue. Giles and Okafor should stand a few metres from Jay in R10 and follow him. Walk into R11: Giles says "Thirty seconds..." nearby (not a far whisper), enemies come through both entrances, and the climax ends in the reveal.
- **Quit to title, then load an earlier save:** doors, lights and room triggers should match that save, not the session you quit (for example, load a save from before R05 and the R05 fight plays again when you walk in).
- **Death restart still works as before:** die mid-fight in R06 and in R11; the fight replays from its checkpoint with the squad beside you.
- **Running ahead into the Observation Gallery:** sprint in ahead of the squad. `D_R02_R03` stays open until Giles and Okafor are inside, then seals. Step back out before it seals: it waits for you. If a squadmate is stuck, after 8 s he appears inside near you (watch he does not pop in where you are looking).
- **Regroup:** leave Giles far behind out of sight (for example, run through the tunnel), then start cover-me, the med-lab door or the climax. He should be near you when the scene starts, never teleporting in view.
- **Climax arena:** during the R11 fight, step out through the north entrance into the maintenance corridor: the door to the Launch Hall must be sealed. Kill the last enemy from the corridor: "Power! Doors sealing" and the seal wait until you walk back into R11, then the reveal plays with Giles in front of you.
- **Debug jumps:** `?level=slice01&debug&jump=r11` and the other `jump=` values show the room instead of a black screen, with the squad beside you.

## [Assumed] choices to confirm or change
Giles opens the armory himself; Jay is locked (no moving, no weapons) during Priya's scene; the first-contact door is locked until the fight ends; the play-dead is removed after 20 s if it has not risen; the title text; the whole time budget (about 0.5 min R05, 1.5 min R06, 2.5 min R07, 2 min tunnel, 2.5 min climax, 2 min reveal and stinger); `endSlice` returns to the title.

## Weak spots
- Giles's tells are cheap overlays (`src/actors/castTells.ts`): a gauze cuff on the LEFT forearm (set by `giles.bandaged` in `sec_glass`; it sits over the sleeve, so check it is not buried or floating), and at stage 3 four dark veins on the forearm below the cuff, three on the left face and two on the neck, plus nine sweat beads on the forehead and lip. Look at him in torchlight in the tunnel. Sizes and placement were computed from the bone geometry, never seen; tune the numbers in `castTells.ts`.
- Gore near the glass: every `gore` step in `sec_glass` carries `clipAxis z / clipAt 46.05 / clipKeep above`, so spray and chunks stop on the bay side of the pane (they pool on the glass instead of passing through). Check no red shows on Jay's side; move `clipAt` if the pane is not at z 46. Priya's drag is a rope (`npcDrag`): she should lie on her back (`corpseSupine`) and slide 1.1 m behind the thing at every corner of the route (mid, turn, exit), no walking legs, no popping at the start; check her body does not clip the wall at the turn (`r08_drag_turn`), and that skipping the scene leaves her at `priya_hide`. If the pose looks wrong try `corpseProne` in `sec_glass`.
- The attacker is the `lab` NPC look at infection 3, not a real enemy. The stinger's camera is `stinger_cam` in the surgery (R08b); adjust anchors in `scripts/gen-slice01.mjs` and re-run it.
- Enemy pathing with the new open bulkheads (R11 entrances) and Giles's task safety: watch for enemies ignoring Jay and chewing Giles, or Giles never finishing.
- Checkpoint restore: doors come back from flags (`action_restore`) but enemies/NPC positions come from the beat replay. After a death in R07 Priya is re-placed in R08 by the scene. Nothing saves the glass blood/cracks of the R07 pane.
- Reload after the climax win (`cp_climax_won`, taken just before the reveal): load the autosave from the title or reload the page; the reveal (`reveal_restore` -> `cliffhanger`) should replay with no fight, R11 lights dying, Giles/Okafor placed at the console, Giles at stage 3 with bandage. Pause/resume mid-reveal must not restart it. Also test: save manually during the reveal (pause menu) and load it: the reveal should start over (not a dead scene); pausing and resuming during the reveal, the title card or the stinger must not restart it; a death restart into `cp_climax_won` replays the reveal too.
- Quiet half after a load (`quiet_restore`, `src/data/sequences/quiet_restore.json`): the TAG FM radio comes back in the room named by `radio_place`, the commons TV/cook/seat changes, blinds up, Voss transformed, red lights and cracked glass after the drop. Pausing and resuming must not restart the song (the host keeps a same-track-same-spot radio playing).
- Silent researcher (`researcher_walkby`): after the first round, the next commons entry sends a `lab` crew member from the south door to the gallery side; Jay says "Morning, Doctor." and "...Rough night, I guess." with no answer. Check the walk path and that she despawns out of sight.
- TAG FM in the ruined junction: the radio on the R05 console starts when the first fight ends and stops on entering R06 (`trigger:r06_enter`). Check it is audible but not overpowering, and its position on the console.
- Performance: R07 has 6 extra overlay meshes (glass), R11 one (trail); check frame rate in R11 with 8 enemies and the hero, and in the tunnel.
- The `loop` skip change (counted loops apply their body) touches the earlier skippable scenes too; re-skip the intro and the briefing once to be sure.

## Session load timings
The session logs one line when a load finishes: `[session] ready in N ms (total ... | stage ms | ...)`. A stage marked `(prepared)` took its inputs from the title preload (openspec `preload-during-title`).

Baseline before the title preload (2026-11-23, desktop PC with the RX 7900 XTX, Vite dev server, High, `/?level=slice01&slot=scratch&nosplash&memprobe`; stage times are wall clock from the session's own timer, not frame times):

| Stage | Cold GPU shader cache | Warm (reload) |
|---|---|---|
| renderer | 40 ms | 30 ms |
| textures+audio | 2211 ms | 2242 ms |
| level (build, body models in parallel) | 5693 ms | 5549 ms |
| navmesh+cast | 136 ms | 137 ms |
| simulation | 362 ms | 363 ms |
| texture-upload | 808 ms | 808 ms |
| shaders+warm | 15771 ms | 918 ms |
| **total** | **25021 ms** | **10048 ms** |

The cold run was the first load after the shader code changed, so the GPU driver's shader cache was empty. Every later load of the same shaders is warm. Both runs also overlapped the title music render (about 10 s here, because `?nosplash` skips the title window it normally renders in).

## Title preload (openspec `preload-during-title`)
While the splash and the title menu show, the game prepares the first load in the background: the session and engine chunks, models, mocap packs, sounds and samples, the textures, and the default level (`slice01`) built in memory with its navmesh. It makes no renderer; the only GL context is a probe that reads the GPU's limits and is released at once. The splash can't be skipped any more (the audio-unlock click stays), so the work has time to run.

- Check: open the game, wait for the title, then New game and Continue. The console line `[session] ready in N ms (total ... | stage ms (prepared) | ...)` marks every stage that used the title's work. Compare with the baseline above.
- Edge cases to try by hand: change the graphics quality on the title, then start (the textures and world rebuild for the new quality); Load a save on another level (that level builds in the loading screen, the shared work is still used); click New game before the title has finished preparing (the load waits for work already running instead of starting it again); Quit to title and start again.
- Watch the splash: while the level builds in slices behind it, the splash animation should not visibly stutter. The build holds while you move the mouse or press a key in the menu.
- URLs that skip the title (`?level=`, `&debug&jump=`, `?enemies=`, `?vmlab`) don't prepare anything; `?nosplash` alone still shows the title and does.

### Title preload: measured result (2026-11-23, same machine and URL style as the baseline above)
New game on `slice01` at High, started from the title after the splash (Playwright, one tab, fresh profile for the cold column):

| Stage | Baseline (warm) | With title preload (warm) | Title preload (cold GPU cache) |
|---|---|---|---|
| renderer | 30 ms | 45 ms | 55 ms |
| textures+audio | 2242 ms | 3 ms (prepared) | 9 ms (prepared) |
| level | 5549 ms | 10 ms (prepared) | 10 ms (prepared) |
| navmesh+cast | 137 ms | 7 ms | 7 ms |
| simulation | 363 ms | 525 ms | 460 ms |
| texture-upload | 808 ms | 808 ms | 807 ms |
| shaders+warm | 918 ms | 1144 ms | 12455 ms |
| **total** | **10048 ms** | **2542 ms** | **13802 ms** |

Quit to title and start again: 2019 ms, every prepared stage hit again. Changing quality to Medium on the title, then New game: textures and level adopted (prepared); the 8.3 s shader stage is Medium's own programs compiling on a cold cache.

What it costs: the preparation runs behind the splash and loader, and the main thread is busy for about 6 s of it in chunks of 80-690 ms (32 long tasks in the first 9 s). With a click at 0.3 s the splash cards showed 36 frames over 50 ms (worst 450 ms). With a click after the preparation finished, the splash held 60 fps with no frame over 33 ms.

### Title preload: keeping the splash smooth (2026-11-23)
The preparation works in 6 ms slices (`TITLE_SLICE_MS`) and the body models wait for the splash to end. Measured with an immediate click (a Playwright tab, the splash's whole 9 s): frames over 50 ms 36 to 9, over 100 ms 19 to 3, worst frame 450 ms to 217 ms; tasks of 100 ms or more in a Chrome trace 24 to 5. The preparation now finishes about 11 s after load instead of 8.8 s. A New game after a few seconds on the menu still adopts everything (textures, level, navmesh and cast all prepared; the stages outside shader compile add up to about 1.3 s).

What is left to see: a few short stalls from single room-geometry builds and single sounds. If they bother you, the next steps are cutting the room build into steps the way the merge now is, and synthesizing the sounds in a worker.
