# Playtest checklist: the action half (ADR-0014 beats 3-8)

Nothing here has been seen in a browser. Automated checks only prove the sequence logic (tsc clean, `src/script/action.test.ts`,
`world/slice01.test.ts`). Start with `npm run dev`, then use the dev URL (usually `http://localhost:5173/`).

## URLs
| URL | What it does |
|---|---|
| `/?level=slice01` | The full slice from the intro (about 25-30 min). New game plays the intro. |
| `/?level=slice01&debug&jump=r05` | Skips the quiet half; flags and position of that beat's data checkpoint. `jump` = `r05` (first contact), `r06` (cover me), `r07` (armory + Priya), `r09` (med-lab door, tunnel, valve; you get the shotgun), `r11` (climax + reveal + end). Press New game, the jump happens 0.4 s after play starts. |
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

**R09/R10 tunnel and valve** (`jump=r09`)
- Interact with the med-lab door: Okafor hesitates, badge task (5 s), door opens. In the tunnel: knee-deep water (visual + slower, sprint off), dying lights, shamblers and two play-deads, "Quiet. Something's in the water.", Giles coughs.
- Valve wheel in R10: shake, groan, then the quiet Mara lines (Jay keeps control, walk around). The R11 bulkhead unlocks.

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
