# Playtest checklist: the action half (ADR-0014 beats 3-8)

Nothing here has been seen in a browser. Automated checks only prove the sequence logic (tsc clean, `src/script/action.test.ts`,
`world/slice01.test.ts`). Start with `npm run dev`, then use the dev URL (usually `http://localhost:5173/`).
Agents don't use that server: run `npm run playtest:serve` and use the URL it prints (`AGENTS.md`, Shared Machine).

## URLs
| URL | What it does |
|---|---|
| `/?level=slice01` | The full slice from the intro (about 25-30 min). New game plays the intro. |
| `/?level=slice01&debug&slot=scratch&jump=r11` | Skips to that point with the flags it needs. `jump` = `drop` (the Commons after the rounds, Voss breathing over the Lab B intercom; walk into the gallery to start the drop; needs `&debug`, without it the URL only opens the title and New game starts the intro), `r05` (first contact), `r06` (cover me), `r07` (armory + Priya), `r09` (med-lab door, tunnel, valve; you get the shotgun), `r10_flood` (in front of the valve: the flood cutscene), `r11` (Power Bay to the end of the slice), `r15a` (the powered departure bay; walk aboard), `transit_ride` (in Train Car A, the ride starts), `r16` and `r16b` (walk the lit arrival dock and concourse, no scene), `r16_finale` (the arrival finale), `stinger_priya` (the CAM 04 stinger). Press New game, the jump happens 0.4 s after play starts. `&slot=scratch` keeps the jump out of your saves. |
| `&debug` | Stats, lil-gui, the running-sequence overlay (shows the current step of each sequence), F1 fly cam. |
| `&seq=<id>` | Runs one sequence 1.2 s after play starts, applying its `debugSetup` flags. Useful: `stinger_priya`, `title_card`, `sec_glass`. Stand in the right room first (fly with F1), or combine with `jump`. |
| `&enemies=shambler:3,hero,playDead` | Debug-spawn enemies (existing). |
| `&give=card_l2` | Key items at the start (existing). |

Skip: hold the skip key during the stinger. The rest of the R11 to finale run cannot be skipped. Death restarts at the last checkpoint:
data checkpoints `cp_first_contact`, `cp_cover_me`, `cp_security`, `cp_flooded`, `cp_climax` (on room entry) plus sequence ones
`cp_contact_clear`, `cp_cover_done`, `cp_security_done`, `cp_valve`, `cp_r11_powered`, `cp_r16_arrived` (end of each beat).

## Tomas’s squad arrival

In a clear corridor with both squadmates following, walk straight ahead, stop until Tomas catches up, then double back past him and stop again. Watch his head against his coat buttons as he slows. On the second arrival he and Giles cross sides and stop close together: Tomas steps away from Giles still facing Jay, with no turn past Jay and back. When Jay walks past or straight at either of them while they stand, they step aside without turning their backs, and Jay gets through. Check once before the Lab B drop with his hands free.

Whenever Tomas stands idle (in the intro: after he walks in, at the scan arch and at his post), his arms hang at his sides with the palms toward his thighs. Look for palms turned forward or hands held out in front of his coat: both used to show, from his model's clipboard bind pose and from his idle capture.

In the demo corridor (`?level=demo&slot=scratch&physics=off`), walking from z = 6 to −6 and back used to turn Tomas from −156° through 0° to +129° over 3.25 s on the second arrival: Giles's keep-apart push steered him away from Giles, past Jay's back. He now holds −162° (16° off Jay) and settles 0.90 m from Giles.

## Per beat
**Walking into the Commons** (New game with `?slot=scratch`)
- As Jay comes through the door the view leaves the route, swings to the left side of the room, pans right across the tables without stopping, then turns round to Bram, who greets as it lands (about 5 s). No line turns the view before that.
- The kitchen radio fades out between 20 and 25 m: still there across the Commons (faint in the far corners), gone from the med deck, for example at the R07 to R09 door.

**Commons talk** (openspec commons-overheard-chatter; wear headphones, New game with `?slot=scratch`)
- During the intro the table groups murmur under the story lines and neither pair says a written line.
- After the intro, stand about 3 m from the two at the bar: they say four lines in turn, each from its own mouth, their murmur stops and the others drop back. Subtitles ("Crew") show only within about 6 m. Do the same with the pair by the wall; between the two, only the nearer one speaks.
- Walk off mid-line: that line finishes, nothing follows, and coming back repeats nothing. Let Giles's "come on" or a hint land during an exchange: it cuts the exchange off at once.
- After the briefing each pair has two more, at least 20 s apart. None starts while the researcher walks through. Listen over the radio for mush.
- From hydroponics, the dive bay and Admin with the Commons door closed, the murmur is faint or gone. Pausing lowers it. Stay five minutes: both pairs are still in their places.
- Load the autosave made as the intro ends: both pairs still have their pre-briefing exchange.
- From the drop on, and after loading `cp_drop`, there is no written exchange and no murmur.

**Commons room sounds** (openspec commons-room-sounds; wear headphones, New game with `?slot=scratch`)
- Watch a diner get up and sit down at another table: that seat scrapes as they leave and the next as they sit. Crew walking between the bar stools, sofas and wall make no scrape. Loading a save puts everyone back without a sound.
- Stand by a table with people at it for a minute: cups and cutlery clink irregularly (about every 4-10 s) from in front of one of them.
- After the intro, with Bram at the servery, pans, plates and the tap are heard along the counter every 8-20 s. None during the intro, none while the researcher walks through, none while Bram is away from the station.
- Start a pair's exchange or take a squad line: sounds that start meanwhile are quieter and every word is easy to follow.
- From a neighbouring room with the Commons door closed, the sounds are muffled and faint, or gone. Quit to title: silence.
- From the drop on, and after loading `cp_drop`, nothing scrapes, clinks or clatters.
- Bram's brew: after the intro, stay in the Commons. Within a minute Bram walks to the coffee machine, works it for about 8 s (grinding, then pouring, from the machine), walks back and faces as before. The next one is two to three minutes of Commons time later; none starts while you are elsewhere. Check the walk and the hands-busy pose from the room and from beside the machine.
- Keep a pair talking, or let a squad line play, when a brew is due: Bram waits until the talk has ended. Leave mid-brew: Bram finishes and goes back.
- Stand between Bram and the machine: after about 12 s Bram gives up with no sound and goes home once you step aside.
- Load the autosave made as the intro ends: kitchen sounds and brews still happen.
- Load a checkpoint mid-brew (die, or load from the menu): silence, and Bram is at the station. Get a rounds change or the drop mid-brew: the sound stops at once and Bram does not walk back to the machine.

**The drop opening** (gallery-drop spec; `jump=drop` starts Jay in the Commons with the breathing on, but skips the rounds, so no marker shows there)
- After the third round the objective "Return to the observation gallery" shows its marker in the gallery, and the Lab B blinds are already up. Walk back through the Commons: Voss's hard breathing is faintly audible from the gallery: the intercom speaker hangs in there, so through the closed door it is a dull, muffled crackle, and it opens up as the door slides open and is clear inside, below her lines (`gain` 0.5 on the two breath steps in `drop_approach`). Step back out and let the door close: muffled again within a moment. Stand in the open doorway: nothing starts and the breathing goes on. Step into the gallery: the drop starts at once, with no bars, no walk and no view turn, and the marker goes. Try with Giles and Okafor close behind and again left far back in the Commons: they come in without ever popping into view, walk to the middle of the gallery near you, and the door seals only once all three are inside. Load a save from after the rounds: the breathing is back.
- Voss is already scratching her arm (her right hand on her left forearm, the right elbow forward of her body, never through her stomach) and says it is under her skin as you walk in. Okafor asks "Who's that in there? Is that Voss?" only after she finishes, and she keeps breathing hard and scratching until his line ends. She then runs to the glass and Okafor says she is seizing as she goes. Check the breath repeats without sounding looped, and that Heins says nothing about the blinds.
- Her staged run (voss-death-scene §4; she now waits beside the middle of the bench, behind the left of the middle pane): a jolt throws her left into the bench, her hip hits it and her left hand comes down on the top; she sweeps it, doubles over propped on her forearm with her right arm clutched to her stomach, and coughs blood twice over the bench, her right hand coming up to her chest. She pushes off with her left hand and crouch-walks to the glass: hips low, bent well forward, head hung looking at the floor, both hands holding her stomach (no forearm sinking into her belly or coat), between the bench and the gurney. Blood drips from her mouth the whole way, leaving drops on the floor behind her, and she gags twice (a wet retch, a small spray of blood with each). As she passes the cart she lurches into it hip-first, is jolted off it, and it goes over as she staggers on to the glass; her hands stay on her stomach (no slap). A deep bass hit and a flicker of the light on her come with the bench and the cart; you hear her gasp, grunt at each blow, cough and gag. Check her hand and hip meet the bench and her hip the cart (no gap, nothing through), that she never walks through the gurney or the cart, that her feet stay planted and you hear her steps.
- Props on cue (voss-death-scene §5): as her hand sweeps the bench, the flask and the beaker under it fly off west (the flask to the floor, the beaker onto its side on the bench); the rest of the bench glassware stays. As she lurches into the cart it goes over away from her, west toward the glass, in about 0.7 s, landing on its side, and its whole load spills out ahead of it onto the floor. The glass is heard clinking quieter under the crash (its sound is still a stand-in until §8). Play it again with `&physics=off`: the cart falls the same way on the same beat, and the swept and spilled things appear where they would have landed as the sweep and the fall start, and stay there. Load `cp_drop`: the cart lies on its side and everything it and the sweep threw lies where a played kill leaves it, silently.
- Her collapse after the burst: she falls forward onto the pane, slides down it onto her knees with her chest and cheek on the glass and her hands up on it, just east of the window frame, then crumples onto her left side along the foot of the wall, clear of where the creature stands to pound. Load `cp_drop`: she lies in the same place.
- From the end of his question the rest runs on a fixed clock, about 15 s: the run 6.5 s, the glass 3.6 s (her scream plays on into the arch), the arch 2.4 s, the burst 0.6 s, still 1.8 s. "She's seizing" and the flicker come as the run starts, her scream at the glass, the alarm at the arch, and Okafor and Giles as she goes still. Check each starts with its movement both with the squad close behind and left far back in the Commons (so his question comes late), and that she is at the glass before her palms hit it.
- Jay is free through the scene (move and look; fire and interact do nothing). Face away from the glass: the camera is never pulled. At the lights-out Jay cannot turn for about 3 s (no bars), the pistol comes up on the first duct bang, and the view is free again as the scraping starts. Die during the drop and reload: walk back into the gallery and the drop plays again from the start. Load after the rounds but before the drop: the blinds are up.

**The Lab B escape** (end of the drop, in the gallery; `jump=drop`; trim-lab-wing-encounters, rig-necromorph)
- After Voss dies the blade creature unfolds out of her chest into its hunched blade stance (no human get-up) and, without taking a step or sliding, bangs on the glass in front of it as soon as it is up, centred where she stood (clear of the window frames), in flurries: both arms rear up, then swing forward together so its wrists hit the pane with the blades upright along it (no blade tip poking at the glass, nothing clipping through), each bang heard as the wrists land. Giles: "Is that one of the lab techs?" Okafor: "Not any more." Then Lab B's lights die out and the room goes quiet: you hear only the vent cover being torn off and the creature banging and scraping away through the ducts, moving off toward the Lab Junction. The lights flicker back: Lab B is empty, its ceiling grate hangs open, and a loud jump stinger hits.
- Check the bangs sound above and beyond the lab, getting quieter, and that nothing else (hum, alarm) plays in the dark. Load `cp_drop`: the creature is gone, the grate is open, and none of this replays.
- Holstered until the drop (holster-until-the-drop): on a new game no pistol is in view through the dock, Commons, briefing and rounds (the flashlight beam still shows when on), fire, reload and aim do nothing. `?slot=scratch&jump=drop` shows no pistol either. In the drop the pistol stays out of view through the blackout, the vent rip and the creature vanishing, and is drawn (the `Take` clip, no rack sound) on the first duct bang (the one nearest the gallery, before the stinger). After the drop, `cp_drop` and `?jump=r05` and later come back armed. A load or death from before the drop shows no pistol.

**R05 first contact** (`jump=r05`)
- No enemies. The Lab B bulkhead stays sealed. Bangs and scrapes cross the ceiling overhead along the coolant line toward R06; Okafor gives the revive rule as they start.
- Lab wing look (openspec rebuild-lab-wing): clean slate walls under red lockdown lights with one white work light. The west vent and the floor drain grate are dressing now. The coolant line runs along the ceiling from Lab B into R06; after the drop, one bloom mass and a wall patch sit where it leaves the room.
- Die in R05 (debug): you restart in R05 and the beat replays from the first bang.
- Look back through the glass (openspec two-way-glass-visibility): the Lab B bulkhead no longer opens in play, so check this with the `?debug` fly camera (F1) from inside Lab B, looking north. The Observation Gallery (walls, sofa, console, lit fixtures) and the glass panes are drawn, with the cracks and Voss's blood on the glass; no black void and no commons crew floating beyond it.
- **Blackout** (openspec station-blackout): the last bang sounds from the R06 end of the room. Within 2 s the radio chatter starts: four voices (Station Ops, Docking Ring, Hydroponics, Launch Hall) one after another, each starting about 1 s before the last ends, two cut off mid-word, all with subtitles. Okafor: "That's the whole station." The PA announces the power failure from the Lab Junction speaker (also heard in Lab B), then the power-down sound and every room drops to dim, warm backup lights (darker than the drop's red), beacons on the walls, tubes silent, beacons humming. With the flashlight off, the "Flashlight" prompt shows. The door to R06 closes and `cp_contact_clear` saves. Reload it: still dark, and the chatter does not replay.
- No radio music in the Lab Junction any more; the kitchen radio in the Commons is the only one.

**Flashlight** (openspec station-blackout, player-flashlight spec; no model since swap-viewmodels-to-just-models)
- Press F with the pistol out: the beam fades in within about a quarter second from low and to the left of the view (the chest). No flashlight model or hand appears. F again fades it out.
- Switch to the shotgun and holster with the light on: the beam stays and comes from the same point each time.
- Spin the mouse fast, look up and down, land from a jump: the lit spot is on the crosshair on every frame (no lag, no overshoot, no drifting on after you stop).

**Weapon viewmodels** (openspec swap-viewmodels-to-just-models; models by JUST, rebuilt by `scripts/fix-just-weapons-glb.mjs`)
- Draw the pistol and the shotgun: the same gloves on both, both arms leaving through the bottom or side edge, no loose hand or forearm end. Try 16:9, 4:3 and 21:9 windows, and the field of view slider at 70 and 95 (the menu range), at rest, aiming, sprinting, reloading and switching.
- The pistol reload is one 3.7 s motion, empty or not: the magazine sound as it leaves the grip (about 0.6 s), the seat (about 2.2 s) and the slide (two clicks, about 3.1 s and 3.25 s: pulled back, then home) line up with what you see, and the pistol is full when it ends.
- Drawing the pistol (switching back from the shotgun, the drop's first duct bang, loading a save with it) ends with the support hand racking the slide, with the same two clicks. Firing during the rack shoots at once and drops the rest of it.
- The shotgun fires and pumps in one motion (the pump sound and the hull about 0.6 s after the shot), and the next shot is ready at 0.85 s. Reload from empty: opening, one motion per shell with the shell sound as it seats, then the closing rack. Fire mid-reload: it shoots at once and keeps the shells already in.
- On High (the tier with ambient occlusion), turn slowly in a dark or red-lit room with a weapon out: no streaks or repeating pattern slides across the gun or gloves, and it looks the same on Medium. To compare live, start with `&debug` in the URL (the handles `__post` and `__water` only exist then) and run `__post.setQuality('medium')` or `'high'` in the console. The weapons are flagged `skipGtao`, so AO neither shades nor reads them.
- Look at the gun in a dark room and under a red emergency light: the gloves and slide are lit evenly, not blown out, and show no streaks or repeated stripes (the viewmodel fill light must stay about 0.45 m from the grip).
- Sprint with each weapon: the gun is carried low across the body with the muzzle down, the view stays clear, and both arms leave through the bottom edge. Holster or open a menu: the gun drops fully out of view.
- Stand still with a weapon out: it drifts slowly and slightly (breathing). With reduced motion on, it stays still.
- Recoil is now carried by springs, since the new `Shoot` clips barely move the gun (starting values, pistol about 2.5 cm back and 2 degrees of lift, shotgun about 6 cm and 4.5 degrees): say if it feels weak or too much.

**Hale's office** (openspec end-scene-when-player-leaves, scene-presence spec). The scene `admin_hale` is bound to the Director's Office (`R14c`) by its `room` field. Walk in with the briefing done, then try these on a scratch slot (`?slot=scratch`):
- Stay put: Hale, Jay ("Everything all right, Director?") and Hale's last two lines all play.
- Step out through the glass door in the middle of any line: that line finishes, fading as you walk off, and nobody says anything more, Jay included. Hale drops the gesture and the look and idles. Go and stand in the open office with the door open: still silent.
- Leave in the pause before Jay's line: Jay does not say it.
- Walk back in: nothing restarts. The card still comes with the desk exchange and completes the Admin round.
- The Commons walk-by (`researcher_walkby`, bound to `R02`; after the first round, on entering the Commons): a lab researcher crosses the room and Jay greets them ("Morning, Doctor.", then "...Rough night, I guess."). Leave the Commons before or between the two lines: Jay says nothing more, and the researcher is gone, not left standing there.
- The round conversations (openspec room-bound-round-scenes): hydroponics (`R12a` and `R12b`), the dive bay (`R13a` and `R13b`), reception (`R14a`) and the storeroom (`R12e`). Walk in and stay: every line plays. Walk out through the doors while a botanist, Sung or the assistant is mid-line: the line already playing finishes and fades as you walk away, and nothing more is said, Jay's reply included. Leaving the dive bay still closes and vents the sample trunk. Walk back in: nothing restarts.
- Authoring: put `"room": "<room id>"` (or a list, `["R12a", "R12b"]`, for a scene that spans a vestibule and the hall beyond it) on a sequence for a stationary talk-to-an-NPC scene that should end when Jay leaves. Leave it off for scenes where the squad walks and talks with him, which keep the earshot rule for Jay's lines. A `room` that is not in the level warns when sequences load.

**Dive bay corridor** (dive-bay spec): the Launch Hall door to the maintenance corridor (R13d) says "This door won't open. Out of service." during the rounds. In the R11 climax the corridor still opens from the Control Room.

**R06 cover me** (`jump=r06`)
- Walk to the bulkhead: Giles runs to the panel, "Cover me". Bangs start behind you over the corridor and come closer across the ceiling to the ruptured duct, with small shakes; then a second of silence, the grate is kicked out and falls with a clatter, and the escaped Lab B blade creature drops out (a hard landing, a shake), unfolding into its hunched stance. Okafor: "Legs! Take its legs!" It has 90 health, twice the usual. Check its attacks read as blade windups and slashes, grabs spread the blades wide so neither blocks your view, shots hitting the blades register on its forearms, and taking its legs drops it into a crawl/drag. The 20 s job pauses while it is on Giles. The door opens when the job ends; "The legs. Did you see?" plays after the kill, then Priya's run (below).
- Check it comes at Giles or Jay and that one creature fills enough of the bypass; the bulkhead stays shut until the job is done.
- One source (trim-lab-wing-encounters): the vent grate under the ruptured duct (`r06_vent`, spawn `r06_duct`). From the hold point (`r06_hold`, north of the pump skid) you should see Giles at the panel and the grate without turning more than about 75°. The trench and the east vent are dressing. Load `cp_cover_done`: the grate lies on the floor.
- The status board over the bulkhead reads COMPARTMENT 3 LOCKDOWN in red and turns green when the bulkhead opens; after a death it should be red again.
- Giles on the line: the coolant line comes down the wall into the power box he works on (`r06_panel`, south wall left of the bulkhead). Check he faces the box, and that the dropped pipe and the DANGER sign don't hide his hands.

**R06 run and R07 medical bay** (`jump=r06`, `jump=r07`; change `overhaul-priya-r08-death`, design D22-D31)
- Stepping into the security office after the R06 fight starts a cutscene. The bars come in, you can't move, and the squad is behind you. The view follows Priya as she bolts from behind the last-stand desk (Okafor: "Hey- hey! It's us!", no name), sobs as she stumbles, and runs through the glass door into the medical bay. The door opens as she reaches it and seals right behind her, then control comes back and she goes to the beds. You take 3-4 running steps after her, and that's all. Stepping in while the squad is still talking after the fight cuts them off and starts the cutscene at once. The vitals monitor beep is heard only faintly through the glass, and the intercom doesn't carry it. No numb-hand beat any more: Giles is not infected (D22).
- Light: the medical bay is fully lit on backup power (its own circuit) while the security office is dark (backup lamps, the west-wall beacon) and the surgery is a dark hole with a dying light. Jay should still be readable from the bay side.
- Enter the security office: the bulkhead seals behind the squad, you walk slowly with your weapon drawn as soon as the bars clear, and Okafor is clear but sounds across the room wherever you stand. The vitals monitor beeps steadily (every 0.8 s) and the score is on that beat. Shoot the glass (D34): each round leaves a small star chip on your side, sparks and thunks, and nothing passes into the bay; with the creature in the bay a shot counts as a bang (it may stare), and Jay does not shout for it. Alt-tab or Esc mid-scene, then come back (D32): Priya stays where she was, the intercom stays on, the bulkhead stays sealed.
- "Show me your hands." then "Turn around." (D35): two lines. Her hands come up only after the first has finished; after "Turn around." has finished she glances at Okafor, turns slowly away (feet stepping, not spinning) until her back is to the glass, freezes facing the surgery door with her shoulders up, then turns back faster as Okafor asks "Anything scratch you?". Hands drop as she answers.
- The rescue, in order: Priya crouched by the beds recognises Okafor ("Tomas? ...Tomas."), comes to the door; Okafor tries it (denied buzzer); Giles reads the console ("Admin's sealed the medical deck. Remotely.") and switches on the intercom: a click, static, then her voice clear and crackly from the grille by the CCTV wall. Triage ("Show me your hands... You're fine. ...You're fine."). The surgery: a drip, a rattle, then the tray crashes and the music drops to the monitor alone; her panicked breathing. "Sit. ...That's medical advice." / "That's my line." must play tense, not as a joke. Giles opens the armory (the one door he can), "Jay. Take it."; the coffee lines play over the intercom while you are in the armory. Time it: about 75-90 s from entry to the surgery door (D36 trimmed the pauses inside the clips with `npm run vo:tighten`; "I know." and "We hear you." step on the line before; Giles walks to the console while she says "It locked").
- The surgery door: the handle, a stinger, the blade creature comes out with its blades clear of the doorway. If you are still in the armory it waits for you (up to 10 s). She gets up and backs into the west corner; it prowls/rushes along the glass past you with planted feet and stares once (a bang brings the stare forward). Okafor shouts at the door ("Open it! Open the door!", denied again); Giles cannot override it.
- The kill: the blade impales straight through Priya's chest with the tip showing past her back (Okafor's one "Priya!"), the carry on the blade, three slams on the cart, the throw into the centre pane, then the creature rears up facing the glass and screams over her body (blades high, jaw wide, trembling) before walking back into the surgery. Every sound of it comes through the intercom, clear from anywhere in the room; the scream and the slams should distort the speaker, not go silent. The bang prompt goes at the impale.
- The slams (openspec `livelier-cart-slam`): the third comes after a longer wind-up. On the first the small instruments hop and some land back; by the second most of the top is off; the third tips out the shelf. At least one should come at the glass. The cart rocks and slides a few centimetres each time and ends skewed, with her head still on its top. Each hit is a different steel boom with a rattle, no breaking glass; every instrument clinks where it lands, and the kidney dish spins down. The view dips slightly on each hit (less with reduced motion). Nothing should show through her body where she lands, or float or sink on the cart before the attack. Try `?physics=off` too: the instruments stay on the cart, the slams still sound.
- Aftermath: she lies where she landed by the pane; the creature walks back into the surgery. At least 4 s of silence with only static, the monitor and its breathing on the intercom; Okafor's hand on the glass; once the surgery door has closed he says "Gotta keep moving." where he stands, the intercom clicks off, then "Med lab's through there." with no walk to the console. Giles says nothing. The bulkhead unseals; the objective is the med-lab door.
- Load `cp_cover_done`: Priya is crouched in the bay, door sealed, and the scene plays from the start, the instruments back on the cart. Load `cp_security_done`: her body by the centre pane in its pool, intercom off, the cart skewed and its instruments on the floor (the same with `?physics=off`), and no clinks on load.
- Where to iterate: lines `src/data/dialogue/slice01_action.json` (delivery notes in `direction`), the scene `sec_glass` in `src/data/sequences/action_security.json`, the kill `mauled` in `src/data/kills.json`, the score `src/audio/scores/medbay.ts` with its cues in `src/data/scores.json`, the intercom `src/audio/intercom.ts`.
- Scripted pass, 2026-11-23 (Playwright, `?slot=scratch`, no ears on it; task 13.3 still needs a human run):
  - Fixed on the way: Priya's run and the walks that gate a section now wait (`"wait": true`), so she runs to the door and walks through it before it seals, instead of walking into the west pane. The bang loop no longer shouts on its own every 30 s. Her walk back to sit runs alongside section F, so there is no 9 s gap after "That's my line.". Blood drops render (the billboard was wound backwards and culled), and drops that strike the glass keep the clear band and stop at the floor.
  - Measured: the creature never moves more than 0.05 m in a frame (no jump). The intercom overload reaches full on the scream and slams, and the master bus peaks at 0.89. On backup power, R07 measures a mean luma of about 15-18 and R08 about 64-95 (0-255). The rescue runs about 112 s from entry to the surgery door against the 75-90 s target.
  - Open: the "[E] Bang on the glass" prompt stays after the scene ends, because `playerControl reset` turns interaction back on and use triggers have no flag gate. In the CAM 04 stinger, her body at `priya_rest` is next to a glass mullion, so when she rises it reads as a head beside the column. R08 under backup power reads very bright from the security office.

**R09 flooded sump and R10 pump room** (`jump=r09`, `jump=r10_flood`; openspec overhaul-flooded-tunnel)
- Interact with the med-lab door: Okafor hesitates, badge task (5 s), door opens. Walk down the stairs into the water: it gets deeper step by step (slower, no sprint past the knees), the first wet step splashes, then wading steps and a slosh while you move.
- The water: lit by the tubes, reflecting the tunnel (Medium and High), murky with depth (the lower steps fade). Rings from your steps, a wake from the shamblers before they round the bend, splashes from shots, drips and the burst pipe; floating junk bobs. Try Low: no reflection, the rest the same.
- Failing tubes (slow stutters, dark spells), the loose tube swinging, the broken fixture at the bend throwing sparks that hiss in the water. Shamblers rise out of the water; the two play-deads float face down.
- Jump in the water (heavier, a splash). The ammo is on the steel case by the bend: jump onto it from the water. Drop back in: a landing splash. Get downed in the water: the view stays above the surface.
- From the pump room, look down through the low window into the sump bay and through the door's porthole.
- The valve (`jump=r10_flood`; openspec overhaul-valve-cutscene, rig-necromorph): bars, view on the wheel (valve grind); the R09 door stands open; the score starts under the alarm; red beacons, alarm blast and klaxon; the view turns to the open door; then a huge scream from far down the R09 hall (echoing, before anyone speaks) as the elite visibly rears up with blades raised and jaw wide; Jay runs to the gap between the pump units while Okafor and Giles panic-run to flank the doorway and raise their pistols; the elite drops straight from the scream into a low, roaring charge up the hall throwing large stomp and kick water sprays on every step while Okafor and Giles fire slow, staggered aimed pistol shots that do not stop it; Okafor: "Something's coming up the stairs!", "Seal it now!" and the door closes during the line, firing stops cleanly before the seal, and the leaves meet as it ends with one big music hit on the slam. Control and view come back at the slam: it pounds twice with the music still going, then walks back down, and Giles asks "Is it gone?" while you can move; the music fades after. No line about the door starts after it has sealed. R09's water does not rise. Not skippable the first time; on a replay (or after restoring an earlier checkpoint) hold to skip at any point: same end state. `cp_valve` is taken at the slam; the R11 bulkhead unlocks.
- The ambush: walk into the area beside the two doors (the R09 door and the R11 bulkhead), even while the pounding or Giles's line is still going: every line is cut and the music ends at once. A bang and a jump-scare sting, the view whips round to the R09 door while Okafor and Giles recoil into brace poses: the elite's blades stab cleanly into the seam, clamp and track the opening leaves without clipping as it wrenches them apart from the middle (the door stays sealed, screen red, gap still too narrow to pass); it leans in and thrusts both blades deep into the pump room; the door slams back and shears both forearms (with their blades) off into the pump room (they stay on the floor); it shrieks; Okafor: "Its arms...". Once per save. R10 stays fully lit on backup power.
- Reload after `cp_valve`: the door sealed, beacons and klaxon on, no cutscene (the ambush still to come if it had not played).

**R11 to the end of the slice** (`/?level=slice01&debug&slot=scratch&jump=r11`; openspec `fix-r13d-r16-finale`)
- The one URL that plays everything from the Power Bay: the power-up, the walk through R13d, boarding, the train ride, the R16 arrival finale, the title card and the stinger. Click to start. It needs no other parameter, and every `jump=` URL should carry `&slot=scratch` so your saves are left alone. `&power=on` is for looking at the energised Power Bay only: by the script's conditions it skips the Power Bay scene.
- Power Bay: no enemies. The scene starts as you open the bulkhead from R10 (`jump=r11` starts it for you). Jay and Okafor whisper, Giles walks to the terminal and only then does Okafor walk in; Giles diagnoses it, three generator phases light the banks, `D_R13d_R11` opens. Both then walk straight through R13d into the boarding bay, with no turn toward the corridor's dead end.
- Departure Boarding Bay: Giles works the console with Okafor beside him, and you hear both. You can follow or not; the script boards you.
- Ride: R16 is never lit from here on, except the flickers. The power-loss announcement is heard in full, ending before the train appears at the R16 dock. About 5 s into it, just after it says traction power is lost, Giles says they have lost her, over the announcement.
- Arrival: the gate sounds and Okafor speaks during the glide ("Lost her" is not repeated), and the finale starts as the train stops, with no long silence.
- After Okafor orders Jay to stay and says he and August will clear the platform, the cabin fades straight to black and CAM 09 comes up: no pillar shot, no flicker, no dragged body, and neither Jay's warning nor Giles's "air runs out" line. The creature is not seen before CAM 10.
- Title card "THALASSA", then the CAM 04 medbay stinger, "End of slice" and back to the title. Escape on the end credits, even while they are still fading in, goes straight to the main menu with no frame of the train.

**Transit ride and the R16a arrival** (`jump=transit_ride`, `jump=r16`; openspec `r16a-perpendicular-train-arrival`)
- `/?level=slice01&debug&slot=scratch&jump=transit_ride`: you start in Train Car A in R15a and the 3-stage ride runs (14 m pull-out, a lit closed hallway that slows early to a bright gate, a 9 s glide into R16a), then the arrival finale takes over. The game starts paused: click to resume, or the ride never advances.
- R16 is turned so the train never has to turn: R16b (the concourse) lies WEST of the R16a dock, R16c south of R16b. In R16a the track runs north to south along the east edge, the platform is 4 m wide, and wide stairs on the west edge climb 0.6 m onto R16b. Check: standing in R16b between the first pillar pair (on the dock's centre line) looking east, you see the whole right side of the train across the platform, the entry gate on your left (north) and a dark, unlit tunnel bore on your right (south) that fades to black within a few metres. The platform rail has a gap at the car door and reaches both walls; you cannot reach the track at the car's tail or nose.
- `/?level=slice01&debug&jump=r16`: you stand on the R16a platform beside the car facing west up the stairs (no ride needed). `jump=r16b` stands you in the concourse on the dock's centre line. Walk along R16b to the south wall door (east of the booth bays) into R16c.
- `/?level=slice01&debug&slot=scratch&jump=r16_finale` (openspec `juggernaut-walk-and-roar`): press a key at the loading screen and F at the flashlight tip, and the arrival finale runs from inside Train Car B. On CAM 10, about 33 s in:
  - The Juggernaut walks out from behind the right-hand pillar over about 5 s. You hear heavy footfalls and knuckle thuds, its hands and feet stay planted between steps, and it acts the CCTV roar as it walks, while Giles and Okafor keep firing with their lights on its face.
  - It stops and rears up: head down, then up and forward, jaw wide, hands off the floor, trembling. It roars the long roar on camera. As it walks out, Giles and Okafor back away about 1.6 m toward the stairs, still facing it with their lights on its face, firing slowly and quietly. As it rears up, Giles yells "What the fuck is that?!" and Okafor yells it over him, both loud, before the long roar drowns them and their quieter shots.
  - On the roar's last loud beat the feed cuts hard to black, and the menu theme starts from its first bar as it does, with no roar in the dark. About a second later the THALASSA card comes up; the theme gives way as the stinger's music comes in.
  - The console shows no `[shaders]` line.
- **Continue at Arrival Terminal:** reach the finale, reload the page and Continue. You are in the parked car with Giles and Okafor, R16 dark, and the finale plays again from the start.

## Load from title, squad gathering (unify-checkpoint-restore)
- **Continue after a page reload:** play to the Valve Room (`cp_valve` toast), reload the page, Continue. Giles and Okafor should stand a few metres from Jay in R10 and follow him. Open the bulkhead into R11: the Power Bay scene plays with the squad nearby (not a far whisper) and no enemies.
- **Quit to title, then load an earlier save:** doors, lights and room triggers should match that save, not the session you quit (for example, load a save from before R05 and the R05 fight plays again when you walk in).
- **Death restart still works as before:** die mid-fight in R06; the fight replays from its checkpoint with the squad beside you.
- **Running ahead into the Observation Gallery:** sprint in ahead of the squad. `D_R02_R03` stays open until Giles and Okafor are inside, then seals. Step back out before it seals: it waits for you. If a squadmate is stuck, after 8 s he appears inside near you (watch he does not pop in where you are looking).
- **Regroup:** leave Giles far behind out of sight (for example, run through the tunnel), then start cover-me, the med-lab door or the Power Bay scene. He should be near you when the scene starts, never teleporting in view.
- **Debug jumps:** `?level=slice01&debug&jump=r11` and the other `jump=` values show the room instead of a black screen, with the squad beside you.

## Pause and tutorial pop-ups (openspec `freeze-scene-on-pause`)

Use `?level=slice01&debug&slot=scratch`. "Freezes" means the picture holds, the scene falls silent at once with no
click, and on resume both carry on from that moment, with nothing playing late or all at once.

- Pause half way through a spoken line (the intro is easiest), wait, resume: the line carries on from the same word, in
  step with the speaker's mouth and the subtitle.
- Pause for a minute while the Lab B score and a room's loops play: each carries on from where it was.
- Pause while a klaxon is due on the score's beat (security fight): it still lands on a beat.
- Pause half way through a reload, wait 10 s: no motion or sound until you resume, then the rest of the reload.
- Pause while a door is sliding: it stays part way open and finishes after resume.
- Die, pause during the fade: the menu stays open and the restart comes only after you resume.
- Pause while the `THALASSA` title card is up: it is still there on resume and stays its remaining time.
- Pause while the intro's theme plays: the menu theme plays under the menu; on resume the intro's music carries on
  without a doubled or echoing copy.
- Pause during a gunfight with a voice line sounding: only the menu theme is heard, and menu hovers and clicks sound.
  Clicking about the menu never brings a scene sound back.
- In the pause menu lower the voice volume and resume: the held line carries on quieter.
- Open the map (M) during a line: the line waits until the map closes. Same at a save station.
- With tutorial prompts on, trigger Fire / Reload as an enemy screams: scream and picture stop, no menu theme, and both
  carry on when you press fire or reload. Dismiss the Look pop-up with the mouse alone: sound returns.
- Open the pause menu over a pop-up, then resume: the menu theme plays only while the menu is open, and the pop-up comes
  back with the scene still silent.
- Pause during a line and load another save: nothing of that line or its echo is heard. Do the same loading a save from
  another level.
- Pause during a fight and quit to title: no shot, scream or voice follows you to the title screen.
- Start a new game, switch tabs during the intro before clicking into the game, come back: the pause menu is open and the
  intro resumes from where you left it.

## Being hit (openspec `player-hit-feedback`)

Wear headphones; `?level=slice01&debug&slot=scratch&jump=r05`. Take swipes from a creature on each side, a bite (cut a leg off) and a slam (R11's hero), at full health and below 30, with Reduced motion off and on.

- A swipe jolts the view away from the arm you see swinging, and the crosshair comes back to the target by itself. A bite pitches down and forward, a slam dips and shakes, a grab trembles. The weapon is knocked towards the blow and still fires; try it aiming down sights. Reduced motion: about a third of each.
- Claw streaks draw on along the swing on the struck side, a bite smears low, a slam crushes along the bottom; the crosshair area stays clear; no more than three show; all gone in about 1.5 s. In a dark room they dim with the frame. Check High and Low, Film grain off, pause (they hold), restart and quit to title (they clear).
- At full health a hit flashes red towards its side and the frame keeps its colour. Below 30 it desaturates and pulses, with a heartbeat and Jay's breathing under dialogue; a medkit or going down ends both.
- The impact is heard first, then Jay: a breath for a nick, a grunt, a cry for a big hit or the one that downs him; one reaction for a flurry, none while held, never a subtitle. The hit dulls the world for a moment; Jay and anyone else speaking stay clear.

## Visor HUD (openspec `visor-hud`)

`?level=slice01&debug&slot=scratch&jump=r05`, plus one New game with `?slot=scratch` for the opening. Check at 1280x720 and full screen.

- The opening: no panels on the title or under the letterbox bars. When the bars go, the rim, then the panel frames, then the readouts come on. No weapon panel until Jay draws the pistol.
- Fire, reload and dry fire: each shot blinks a pip out; a pistol reload empties the row and refills it over the reload; the shotgun seats shell by shell; an empty trigger flashes the row with `EMPTY · [R]`. Swap weapons: the panel glitches over. Pick up ammo for the held weapon: `+N` rises beside the reserve.
- Take a hit from each side: that panel jolts and tears, the other barely stirs, a pale chip holds and drains, the heart rate climbs and below 30 the trace turns red and uneven. A medkit fills the bar with `+N`. Sprint: the stamina bar appears, amber once spent. Go down: the countdown and revives sit in the biomonitor; the revive fills the bar.
- Turn quickly and walk: the panels trail the view by a few pixels. Reduced motion: they stay put. Reduced flashing: the tear is one offset and the boot-up a fade.
- Stand still at full health and a full magazine: after 6 s the panels dim; a hit, shot, reload, sprint, swap or pickup wakes them. Check the dim numbers still read in a bright room. Settings → HUD: opacity, scale and Calm HUD apply at once and survive a restart.
- Pause mid-chip and mid-reload, wait, resume: both carry on from where they were. The map, pause menu and title show no visor; the game-over fade covers it. Continue from the title: the visor boots after the loading screen.
- Nothing overlaps the objective list, toasts or subtitles, at HUD scale 100% and 150%.

## [Assumed] choices to confirm or change
Giles opens the armory himself during the rescue; Jay walks slowly with no weapons during Priya's scene; the door to R06 stays locked until the creature has passed overhead; the title text; the whole time budget (about 0.5 min R05, 1.5 min R06, 2.5 min R07, 2 min tunnel, 2.5 min climax, 2 min reveal and stinger); `endSlice` returns to the title.

## Weak spots
- Giles's tells are cheap overlays (`src/actors/castTells.ts`): a gauze cuff on the LEFT forearm (set by `giles.bandaged`, which since overhaul-priya-r08-death only the climax restore sets; it sits over the sleeve, so check it is not buried or floating), and at stage 3 four dark veins on the forearm below the cuff, three on the left face and two on the neck, plus nine sweat beads on the forehead and lip. Look at him in torchlight in the tunnel. Sizes and placement were computed from the bone geometry, never seen; tune the numbers in `castTells.ts`.
- Gore near the glass: the R08 kill takes its clip from the centre pane (`medbay_c_glass`, face z 45.72, clip at 45.78), so spray stops on the bay side. Check no red shows on Jay's side. There is no drag any more: after the throw she lies where she landed at the base of the pane.
- The attacker is the creature body (`lab_creature`). The stinger films from `cam04_pos` toward `cam04_stinger_look` (her resting spot `priya_rest`); adjust the anchors in `src/data/levels/slice01/rooms/R08.json`.
- Voice: the rescue lines (decision 29 in `openspec/changes/overhaul-priya-r08-death/design.md`) carry their delivery in `direction`. Any line without a recording plays the synth voice; check the clips flagged by `vo-generate` by ear and trim dead air.
- Checkpoint restore: doors come back from flags (`action_restore`) but enemies/NPC positions come from the beat replay. After a death in R07 the scene replays from the start. After `sec_done`, the restore plays the kill instantly: Priya dead in the surgery, no creature, and the centre pane's end marks (two prints, the crack and splat, the streak) from an authored set.
- Quiet half after a load (`quiet_restore`, `src/data/sequences/quiet_restore.json`): the TAG FM radio comes back in the room named by `radio_place`, the commons TV/cook/seat changes, blinds up, Voss transformed, red lights and cracked glass after the drop. Pausing and resuming must not restart the song (the host keeps a same-track-same-spot radio playing).
- Silent researcher (`researcher_walkby`): after the first round, the next commons entry sends a `lab` crew member from the south door to the gallery side; Jay says "Morning, Doctor." and "...Rough night, I guess." with no answer. Check the walk path and that she despawns out of sight.
- TAG FM in the ruined junction: the radio on the R05 console starts when the first fight ends and stops on entering R06 (`trigger:r06_enter`). Check it is audible but not overpowering, and its position on the console.
- Performance: R07 has 2 extra overlay meshes (pane cracks, unused by the R08 scene), R11 one (trail); check frame rate in the tunnel.
- The `loop` skip change (counted loops apply their body) touches the earlier skippable scenes too; re-skip the intro and the briefing once to be sure.

## Shader compiles during play (openspec `stop-midgame-shader-stalls`)
A shader program compiled during play stalls the frame that first draws it, about 0.6 s each on a cold cache. The loading screen has to build every one. In a `&debug` session each miss is warned once in the console:

`[shaders] compiled during play: MeshStandardMaterial "humanoid-wet" (not prepared by the loading screen)`

To check, open `/?level=slice01&debug&slot=scratch&jump=r05` with the console showing, play (or move the view through the rooms and fight), and expect no `[shaders]` line. Changing graphics quality and the F1 fly camera are exempt and not reported. A warm shader cache hides the stall but not the warning.

When a line appears:
- **The light count changed.** Many names at once, often materials that were already on screen: some real light was hidden, added or removed. A light never hangs from a node play can hide or remove (`render-lighting` spec).
- **A material the warm-up did not see.** One or a few names: it has no mesh in the scene at load, or its model arrives late. Add it to the session's warm set, or load it before the loading screen ends.
- **A new render path.** A pass that draws into the screen instead of a render target, or a new shadow, capture or post program: warm it through `compileForPlay` or by drawing it during the warm frames.

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
