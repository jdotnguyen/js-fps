# medbay-attack Specification

## Purpose
Defines the R08 medical bay scene as the player sees it: Priya runs from the squad into the medical bay and seals herself
in, the squad try and fail to reach her while she talks to Okafor over the intercom, then a creature kills her on the far
side of the glass while Jay, Okafor and Giles, shut in the dark security office, cannot reach her. Also covers the
aftermath and how the scene behaves when skipped or restored.

## Requirements

### Requirement: The attacker is a creature
The body that attacks Priya SHALL be the infected creature body used for the Lab B creature, not a human NPC look at an
infection stage.

#### Scenario: Not a scientist
- **WHEN** the attacker comes through the surgery door in R08
- **THEN** it has the creature body, with no lab coat or human outfit

### Requirement: Priya runs into the medical bay
Priya SHALL hide in the security office through the R06 cover fight. When Jay first enters the security office after the
fight, a cutscene SHALL play: Jay SHALL be held where he stands with the cutscene bars shown, the squad SHALL be brought into
the room behind him, and the view SHALL follow her as she panics and runs for the medical bay door, stumbling at least once.
She SHALL go through `D_R07_R08`, which SHALL close and seal right behind her, before Jay gets control back. A squadmate SHALL
call out as she runs.

#### Scenario: She runs
- **WHEN** Jay enters the security office after the R06 cover wave is cleared
- **THEN** Priya runs from the security office into the medical bay through `D_R07_R08`, stumbling on the way

#### Scenario: The door seals behind her
- **WHEN** Priya is through `D_R07_R08`
- **THEN** the door closes and is sealed by the lockdown at once, and Jay and the squad cannot open it

#### Scenario: Jay sees her go
- **WHEN** she starts to run
- **THEN** Jay is held with the cutscene bars shown, a squadmate calls out, the view follows her, and the squad is in the room behind him

#### Scenario: Jay cannot follow her
- **WHEN** Jay tries to move during the run
- **THEN** he does not move on his own until the door has sealed behind her; the cutscene moves him 3-4 running steps after her, toward the door, and no further

#### Scenario: No waiting at the door
- **WHEN** Jay steps into the security office while the squad is still talking after the R06 fight
- **THEN** that talk stops at once and the cutscene starts

#### Scenario: Her name is kept
- **WHEN** the run plays
- **THEN** Okafor does not say her name

### Requirement: She waits in the medical bay
From her run until Jay enters the security office, Priya SHALL stay in the medical bay in view through the glass, away from
both its doors. The creature SHALL be heard in the surgery at least once before the attack and SHALL NOT be seen.

#### Scenario: Seen through the glass
- **WHEN** Jay enters the security office after her run
- **THEN** Priya is in the medical bay, visible through the glass, and not in front of `D_R07_R08` or `D_R08_R08b`

#### Scenario: Something in the surgery
- **WHEN** Jay is in the security office before the attack
- **THEN** at least one creature sound plays from the surgery, and no creature is visible

### Requirement: Jay is shut in but free to move
When Jay enters the security office after her run, the scene SHALL begin. It SHALL wait until Jay and both squadmates are
inside, then seal `D_R06_R07`. From then until the aftermath ends, the player SHALL walk at a slow pace with looking free and
weapons on. The scene SHALL NOT move the player or hold him at a spot, and SHALL play the same wherever he stands.

#### Scenario: Sealed in
- **WHEN** the scene begins while Okafor is still in R06
- **THEN** while the bars are still up, after Jay has stepped in after her, both squadmates are placed just behind him inside the security office and `D_R06_R07` seals, so neither can be left on the R06 side

#### Scenario: Walking around
- **WHEN** the player walks during the attack
- **THEN** he moves at the slow pace, can go anywhere in the security office, and can fire

#### Scenario: Weapons with the bars
- **WHEN** the letterbox bars clear after Priya's run
- **THEN** Jay's weapons are enabled

#### Scenario: Not watching
- **WHEN** the player turns his back on the glass during the attack
- **THEN** every beat still begins at its normal time

### Requirement: The glass is armoured
The panes between the security office and the medical bay SHALL stop rounds. A hit SHALL leave a chip mark on the security
office side with a spark and a heavy thunk, and SHALL NOT pass into the medical bay. While the creature is in the medical
bay, a hit SHALL count as a bang for its notice. Shooting SHALL NOT change when any beat starts. Jay's rounds SHALL NOT harm
Okafor or Giles during the scene.

#### Scenario: Shooting the glass
- **WHEN** the player fires at the centre pane while the creature is in the medical bay
- **THEN** the round leaves a chip mark on the security office side and a thunk plays
- **AND** nothing in the medical bay is hit, the creature's notice counts it as a bang, and no shout from Jay plays for it

#### Scenario: The squad is not hit
- **WHEN** the player fires through Okafor or Giles during the scene
- **THEN** neither takes damage

### Requirement: Banging on the glass changes nothing
From the start of the scene until the impale, an interact prompt on the medical bay glass SHALL let the player bang on it and shout any number of times.
Each bang SHALL thud on the glass and shake the view a little. A bang SHALL also play a short shout from Jay from a small
pool of lines, at most one every 2.5 s, and the shouts SHALL NOT use Priya's name. Apart from the attacker noticing him
(below), banging SHALL have no effect.

#### Scenario: Banging changes nothing
- **WHEN** the player bangs on the glass five times before the impale
- **THEN** five thuds play from the glass and the view shakes each time
- **AND** the glass does not crack, Priya is not saved, and the scene's beats start at the same times as with no bangs

#### Scenario: Shouts do not pile up
- **WHEN** the player bangs three times within 2 s
- **THEN** three thuds play and at most one shout from Jay plays

#### Scenario: Prompt goes with the impale
- **WHEN** the impale beat begins
- **THEN** the bang prompt is no longer offered

### Requirement: She backs away with her hands up
When the creature comes through the surgery door, Priya SHALL back away from it to the west end of the medical bay (to the
right of a player facing the glass), with her hands raised and facing the creature, pleading to be let out. She SHALL walk
there and SHALL NOT be moved instantly.

#### Scenario: Backing away
- **WHEN** the creature enters the medical bay
- **THEN** Priya walks backwards to the west end with her hands up, facing it, and her plea plays

### Requirement: It walks past him
The creature SHALL walk from the surgery door along the glass to Priya, on the medical bay side of the panes, passing the
player's side of the room.

#### Scenario: Along the glass
- **WHEN** the creature comes out of the surgery
- **THEN** it walks past the medical bay door and along the panes to the west end, staying between the glass and the cart

### Requirement: It notices him once
On its walk the creature SHALL stop once, turn its head and body toward the player through the glass, and hold still for
about 1.5 s before going on. The player's first bang after it enters SHALL bring the stare forward; otherwise it SHALL
happen where its path comes closest to the player. It SHALL show no reaction to any later bang.

#### Scenario: Stare on the first bang
- **WHEN** the creature has entered the medical bay and the player bangs on the glass for the first time
- **THEN** within 0.3 s the creature stops and turns to face the player, holds still for about 1.5 s, then goes on toward Priya

#### Scenario: Stare without a bang
- **WHEN** the player never bangs on the glass
- **THEN** the creature stops and stares at the player at the point of its walk nearest him

#### Scenario: Only once
- **WHEN** the player bangs again after the stare
- **THEN** the creature does not stop, turn or look toward the player

#### Scenario: The beat timing holds
- **WHEN** the scene plays with an early stare and with the stare at its authored point
- **THEN** the impale begins at the same time in both

### Requirement: It reaches her by walking
The creature SHALL get to Priya by walking the whole way. While the attack runs, it SHALL never be moved instantly or appear
somewhere it did not walk to. The impale SHALL begin only when it stands within reach of her.

#### Scenario: No jump
- **WHEN** the creature's position is sampled every frame from its entry to the end of the attack
- **THEN** it never moves more than 0.3 m between two frames

#### Scenario: In reach first
- **WHEN** the impale beat begins
- **THEN** the creature is already standing within arm's reach of Priya, in front of her

### Requirement: It impales her
At the west end the creature SHALL drive its claw into Priya's body, with an impact sound and heavy blood from the wound. It
SHALL then carry her on its arm to the instrument cart, leaving a trail of blood on the floor.

#### Scenario: The impale
- **WHEN** the impale beat plays
- **THEN** an impale sound plays from her body, blood sprays and runs from the wound, and her body is held on the creature's arm

#### Scenario: Carried to the cart
- **WHEN** the creature walks from the west end to the cart
- **THEN** Priya stays held on its arm with her feet off the floor or trailing, and blood drips onto the floor along the way

### Requirement: Staged in plain sight
The head slams SHALL happen on a steel instrument cart about 1.5 m behind the centre pane, in straight view from the viewing
strip along the glass in the security office. Priya SHALL be slammed on the cart's far side, facing the glass, with the
creature behind her. The throw SHALL be aimed at the centre pane at head height. Okafor and Giles SHALL stand at the ends
of the viewing strip, off the line from its middle to the cart.

#### Scenario: Close enough to see
- **WHEN** the slam beat plays and the player stands anywhere in the viewing strip
- **THEN** the cart and Priya's head are no more than 3 m from the player's eyes and in front of the centre pane

#### Scenario: Nothing in the way
- **WHEN** the slam beat plays
- **THEN** a ray from eye height at the middle of the viewing strip to the cart top hits no prop, wall or NPC before the centre pane

#### Scenario: Both faces
- **WHEN** an impact lands
- **THEN** Priya's face and the creature's face both point toward the glass, within 45 degrees

### Requirement: The door refuses
The partition between the security office and the medical bay SHALL include a glass medical bay door, sealed by the
lockdown: the door Priya sealed behind her. Okafor SHALL try that door when the rescue begins and again during the attack,
and the lockdown SHALL refuse him each time with the door's denied sound.

#### Scenario: Denied
- **WHEN** Okafor reaches the medical bay door during the attack
- **THEN** the door plays its denied sound and stays shut

#### Scenario: Denied on arrival
- **WHEN** Okafor first reaches the medical bay door after the squad enters the security office
- **THEN** the door plays its denied sound and stays shut, before the intercom is switched on

### Requirement: The stage and the lane stay clear
In the medical bay, the cart SHALL be the only prop within 2.5 m of the centre pane. A path at least 1.2 m wide from the
surgery door along the glass to the west end SHALL be free of props, so the creature's walk, the carry and its exit do not
route around furniture.

#### Scenario: Only the cart in front of the pane
- **WHEN** the level loads
- **THEN** no R08 prop other than the instrument cart has a collider within 2.5 m of the centre pane's face

#### Scenario: Clear lane
- **WHEN** the creature walks from the surgery door to Priya, carries her to the cart, and walks back to the surgery
- **THEN** its path stays at least 0.6 m from every prop collider and never detours more than 1 m from the straight route

### Requirement: The rooms around the scene are dressed in place
Every prop in the security office, the armory, the medical bay and the surgery SHALL lie inside its room's inner wall faces,
and no prop SHALL stand in a door's opening or within 1.2 m in front of it. The medical bay SHALL read as a medical bay: beds,
vitals and medical storage, and no laboratory tanks. The armory rack holding the shotgun SHALL face the armory door.

#### Scenario: Nothing in the walls
- **WHEN** the level loads
- **THEN** every prop collider in R07, R07a, R08 and R08b lies within its room's inner wall faces

#### Scenario: Doors are clear
- **WHEN** the level loads
- **THEN** no prop collider lies within 1.2 m in front of `D_R06_R07`, `D_R07_R07a`, `D_R07_R09`, `D_R07_R08` or `D_R08_R08b` on either side

#### Scenario: The shotgun is in view
- **WHEN** the armory door opens and the player stands in the doorway on the security office side
- **THEN** the shotgun on its rack is in front of the player, with the rack facing the door

### Requirement: Everyone reacts
The scene SHALL carry lines from Priya, Okafor, Giles and Jay. Okafor SHALL say Priya's name exactly once in the scene, at
the impale. Giles SHALL say he cannot override the lockdown. Jay SHALL shout at the creature during the impale or the carry,
and speak once, quietly, after the throw.

#### Scenario: Her name once
- **WHEN** the scene plays from Priya's run to Okafor's last aftermath line
- **THEN** Okafor's spoken lines contain "Priya" exactly once, and it plays within 1 s of the impale beginning

#### Scenario: No other names from Okafor
- **WHEN** the scene plays from Priya's run to Okafor's last aftermath line
- **THEN** none of Okafor's lines contain "August", "Giles" or "Jay", except the kept carry line "The door. Jay, the door!"

#### Scenario: All four voices
- **WHEN** the scene plays without a skip
- **THEN** at least one line from each of the nurse, medic, engineer and player speakers plays

### Requirement: She lies where she was thrown
After the throw, Priya SHALL be a corpse lying on the floor where she landed at the base of the centre pane, in a pool of
blood that spreads around her. The creature SHALL leave her there and walk back into the surgery through the surgery door at
a steady prowl, never passing through a wall, and the surgery door SHALL close behind it.

#### Scenario: Left on the floor
- **WHEN** the throw beat ends
- **THEN** Priya's body stays at the base of the centre pane for the rest of the slice, and a blood pool grows around it

#### Scenario: It leaves through the door
- **WHEN** the creature walks from her body to the surgery
- **THEN** its path goes through `D_R08_R08b`, no part of it crosses a wall, and it is never placed instantly

#### Scenario: Out of the office
- **WHEN** control returns after the aftermath lines
- **THEN** `D_R06_R07` is no longer sealed

### Requirement: The aftermath belongs to Priya and Okafor
While the creature walks back to the surgery, Okafor SHALL go to the glass and put his hand on it. At the glass he SHALL
let out a long, tired exhale and a sniffle, clearly audible (no words). Once the surgery door has closed he SHALL leave
the glass after no more than a short beat, set off for the console and say "Gotta keep moving." as he does. He SHALL then
say "I told her she was fine." while still walking, before he reaches the console. At the console he SHALL switch the
intercom off and write in his notebook, and after a pause of at least 3 s after that line has finished he SHALL say
"Med lab's through there." No other line SHALL play in the aftermath.

#### Scenario: Aftermath
- **WHEN** the creature turns to walk back into the surgery
- **THEN** Okafor walks to the glass, puts his hand on it and exhales and sniffles audibly; once the surgery door has closed he leaves the glass after a short beat, begins to walk to the console and says "Gotta keep moving."
- **AND** he says "I told her she was fine." right after, while still walking, and no more than about 4 s pass between the exhale and that line
- **AND** he switches the intercom off and writes in his notebook only after reaching the console

#### Scenario: The last line
- **WHEN** "I told her she was fine." has finished
- **THEN** at least 3 s pass with no voice, then Okafor says "Med lab's through there.", and no other line plays before control returns

#### Scenario: Her cardigan
- **WHEN** the player looks through the centre pane from the viewing strip during the aftermath
- **THEN** Priya's cardigan is in view, draped on a chair in the medical bay

### Requirement: A rescue attempt comes before the creature
When the scene begins, Priya SHALL be crouched by the beds in the lit medical bay. The squad SHALL try to reach her before
the creature appears: Okafor at the door, Giles at the console. The creature SHALL come out of the surgery only after the
rescue's lines are done and the armory is open, and not before Jay has left the armory or 10 s have passed.

#### Scenario: She is alive and talking first
- **WHEN** the scene plays without a skip
- **THEN** Priya and Okafor exchange at least eight lines before the surgery door opens

#### Scenario: The armory opens first
- **WHEN** the surgery door opens
- **THEN** `D_R07_R07a` is already open and Giles is no longer at its panel

#### Scenario: Jay is in the armory
- **WHEN** the rescue lines are done while the player is inside the armory
- **THEN** the surgery door stays shut until he steps out of the armory or 10 s pass, whichever comes first

### Requirement: Okafor checks her over and talks her down
Through the glass, Okafor SHALL ask Priya to show her hands and turn around, ask if anything scratched or bit her, and tell
her she is fine. After the surgery noise frightens her, he SHALL talk her down with "Sit." and "That's medical advice.", and
she SHALL answer "That's my line." with a laugh that breaks.

#### Scenario: Her own words back
- **WHEN** the tray falls in the surgery and her panicked breathing has played
- **THEN** Okafor's "That's medical advice." plays, then Priya's "That's my line."

#### Scenario: She sits
- **WHEN** Okafor tells her to sit
- **THEN** she walks to the west wall by the beds and sits there until the creature comes out

#### Scenario: The rescue is tight
- **WHEN** the scene plays from Priya's first line to the armory opening
- **THEN** no pause inside a line is longer than 0.6 s, except written beats, which are at most 1.0 s
- **AND** Giles walks to the console while Priya is speaking, and the span is no more than 80 s (about 78 s with no lines cut; accepted 2026-11-23)

### Requirement: She turns around when asked
When Okafor asks her to turn around, Priya SHALL turn on the spot with her hands still raised: slowly, after a hesitation.
With her back to the glass she SHALL freeze briefly, facing the surgery door, then turn back more quickly. She SHALL lower
her hands when she answers.

#### Scenario: She turns around
- **WHEN** Okafor says "Turn around."
- **THEN** Priya, hands raised, turns until her back is to the glass, holds facing the surgery door, and turns back to face
  him before "Anything scratch you?" ends
- **AND** her feet step through the turn rather than her body spinning in place

#### Scenario: Triage
- **WHEN** the triage section plays
- **THEN** Okafor's lines ask for her hands, ask her to turn, ask about a scratch or bite, and end with "You're fine."

### Requirement: The lockdown is administration's
The security office console SHALL show that the medical deck was sealed remotely by station administration, classed as
routine containment, with no local override. Giles SHALL read it out in substance when his override fails, before he
switches on the intercom. The aftermath SHALL NOT mention it.

#### Scenario: Giles reads the order
- **WHEN** Okafor's first door attempt has been refused
- **THEN** Giles goes to the console and his line says administration has sealed the medical deck remotely and he cannot override it from there

#### Scenario: On the screen
- **WHEN** the player looks at the console bank screen at any time in the scene
- **THEN** it shows the lockdown order with "STATION ADMINISTRATION" and "ROUTINE"

### Requirement: The medical bay is heard through its intercom
Giles SHALL switch on the medical bay intercom during the rescue. From then until Okafor switches it off in the aftermath,
Priya's voice, the surgery's sounds and every sound of her death SHALL be heard from the intercom speaker in the security
office, clear anywhere in that room.

#### Scenario: Before and after the switch
- **WHEN** Priya speaks just before Giles switches the intercom on, and again just after
- **THEN** the first line is heard only dull through the glass, and the second clearly from the intercom speaker with crackle

#### Scenario: Her death on the intercom
- **WHEN** the impale, the slams and the throw play while the player stands at the far side of the security office with his back to the glass
- **THEN** each of their sounds and her voice are heard clearly from the intercom speaker

#### Scenario: Switched off
- **WHEN** Okafor switches the intercom off
- **THEN** a click plays from the speaker and nothing more is heard from it

### Requirement: The surgery is heard before the creature is seen
Sounds from the dark surgery SHALL build through the rescue, at least one per section from the start to the creature coming
out, ending with the door handle and the door. One of them SHALL be a loud fall that silences the music. Priya SHALL react
to each. The creature SHALL NOT be visible before the surgery door opens.

#### Scenario: The tray
- **WHEN** Priya has said the creature has been moving things
- **THEN** a metal tray falls in the surgery, the music cuts to the monitor alone for about 2 s, and her panicked breathing plays

#### Scenario: She reacts
- **WHEN** a surgery sound plays while Priya is speaking
- **THEN** her line cuts or pauses and she turns toward the surgery door

#### Scenario: Not seen
- **WHEN** the player looks into the medical bay at any time before the surgery door opens
- **THEN** no part of the creature is visible

### Requirement: Okafor is heard across the room
During the scene, Okafor's voice SHALL stay clear wherever the player stands in the security office, at about the loudness
of a man 3.5 m away raising his voice, and SHALL keep coming from where Okafor stands. It SHALL NOT sound closer than he is.

#### Scenario: From the far corner
- **WHEN** Okafor speaks at the medical bay door while the player stands in the far corner of the security office
- **THEN** his line is as loud as from 3.5 m and comes from his direction

#### Scenario: Close by
- **WHEN** the player stands 1 m from Okafor as he speaks
- **THEN** his line is no louder than an ordinary line from 1 m

### Requirement: Giles is not infected in the scene
Giles SHALL show no sign of infection from the R06 cover fight to the end of the scene: no hand flexing or forearm rubbing, no
pain sound, no bandage, and no line about his hand or arm.

#### Scenario: No arm lines
- **WHEN** the R06 cover fight and the security office scene play without a skip
- **THEN** none of Giles's or Okafor's lines mention Giles's hand, arm, a cut or a scratch, and Giles plays no flex or rub animation

### Requirement: Skip and restore give the end state
Skipping the scene or restoring a checkpoint after it SHALL leave Priya's corpse at its resting spot by the centre pane, the
creature gone, the surgery door closed, the centre pane cracked and marked, and the other panes clean. Restoring a
checkpoint between her run and the attack SHALL put her waiting in the medical bay with `D_R07_R08` sealed.

#### Scenario: Skipped mid-slam
- **WHEN** the player skips the scene during the slam beat
- **THEN** Priya lies dead at her resting spot, the creature is not present, and the scene's flags are set as if it had played

#### Scenario: Restore after R08
- **WHEN** the player dies later in the action half and restores to a checkpoint after the scene
- **THEN** Priya's corpse lies at her resting spot and the attack does not replay

#### Scenario: Restore before the attack
- **WHEN** the player restores to `cp_cover_done`
- **THEN** Priya is hiding in the security office, `D_R07_R08` is sealed, and her run plays when Jay enters the room
