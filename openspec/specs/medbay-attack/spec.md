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
She SHALL go through `D_R07_R08`, which SHALL close and seal right behind her, before Jay gets control back. As she starts to
run she SHALL shout "Don't shoot! Don't shoot!", and Okafor SHALL call after her as she reaches the door. Inside, she SHALL
stop and turn to face the door.

#### Scenario: She runs
- **WHEN** Jay enters the security office after the R06 cover wave is cleared
- **THEN** Priya runs from the security office into the medical bay through `D_R07_R08`, stumbling on the way

#### Scenario: She shouts, then he calls after her
- **WHEN** she starts to run
- **THEN** her "Don't shoot! Don't shoot!" begins within 0.5 s, and Okafor's "Hey- hey! It's us! It's us!" begins after it, no more than 0.5 s before she reaches `D_R07_R08`

#### Scenario: She turns at the door
- **WHEN** she is through `D_R07_R08`
- **THEN** she stops within 1.5 m inside the door, facing it, and does not go on to the beds

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
From her run until Okafor tells her to sit, Priya SHALL stay in the medical bay just inside `D_R07_R08`, in view through its
glass and away from the surgery door. The creature SHALL be heard in the surgery at least once before the attack and SHALL
NOT be seen.

#### Scenario: Seen through the glass
- **WHEN** control returns to Jay after her run
- **THEN** Priya is in the medical bay within 1.5 m of `D_R07_R08`, visible through its glass, and not in front of `D_R08_R08b`

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

#### Scenario: The blade goes through her
- **WHEN** the creature holds her after the impale
- **THEN** one blade passes through her torso, with its tip showing beyond her back and her chest on the blade within 10 cm

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
In the medical bay, the cart and its loose instruments SHALL be the only props within 2.5 m of the centre pane. A path
at least 1.2 m wide from the surgery door along the glass to the west end SHALL be free of props, so the creature's
walk, the carry and its exit do not route around furniture. Loose instruments SHALL NOT count as props for the path,
and SHALL NOT block or delay any walk, standing or fallen.

#### Scenario: Only the cart in front of the pane
- **WHEN** the level loads
- **THEN** no R08 prop other than the instrument cart and its loose instruments has a collider within 2.5 m of the centre pane's face

#### Scenario: Clear lane
- **WHEN** the creature walks from the surgery door to Priya, carries her to the cart, and walks back to the surgery
- **THEN** its path stays at least 0.6 m from every prop collider and never detours more than 1 m from the straight route

#### Scenario: Fallen instruments in the lane
- **WHEN** instruments lie on the floor of the lane after the slams
- **THEN** the creature walks back to the surgery on the same path and at the same time as with no instruments there

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
let out a long, tired exhale and a sniffle, clearly audible (no words). Once the surgery door has closed he SHALL, still at
the glass and after no more than a short beat, say "Gotta keep moving.". The intercom SHALL go off, and after a short beat
he SHALL say "Med lab's through there." He SHALL NOT walk back to the console first. No other line SHALL play in the
aftermath.

#### Scenario: Aftermath
- **WHEN** the creature turns to walk back into the surgery
- **THEN** Okafor walks to the glass, puts his hand on it and exhales and sniffles audibly
- **AND** once the surgery door has closed he says "Gotta keep moving." where he stands

#### Scenario: The last line
- **WHEN** "Gotta keep moving." has finished
- **THEN** the intercom goes off, he says "Med lab's through there." within about 2 s without walking to the console, and no other line plays before control returns

#### Scenario: Her cardigan
- **WHEN** the player looks through the centre pane from the viewing strip during the aftermath
- **THEN** Priya's cardigan is in view, draped on a chair in the medical bay

### Requirement: A rescue attempt comes before the creature
When the scene begins, Priya SHALL be standing just inside the medical bay door in the lit medical bay. The squad SHALL try
to reach her before the creature appears: Okafor at the door, Giles at the console. The creature SHALL come out of the
surgery only after the rescue's lines are done and the armory is open, and not before Jay has left the armory or 10 s have
passed.

#### Scenario: She is alive and talking first
- **WHEN** the scene plays without a skip
- **THEN** Priya and Okafor exchange at least eight lines before the surgery door opens

#### Scenario: Okafor goes to her at the door
- **WHEN** the rescue begins
- **THEN** Okafor walks to `D_R07_R08`, facing her through it, and Priya does not walk to the window

#### Scenario: The armory opens first
- **WHEN** the surgery door opens
- **THEN** `D_R07_R07a` is already open and Giles is no longer at its panel

#### Scenario: Jay is in the armory
- **WHEN** the rescue lines are done while the player is inside the armory
- **THEN** the surgery door stays shut until he steps out of the armory or 10 s pass, whichever comes first

### Requirement: Okafor checks her over and talks her down
Through the glass, Okafor SHALL ask Priya to show her hands and turn around, ask if anything scratched or bit her, and tell
her she is fine. After the surgery noise frightens her, he SHALL talk her down with "Sit down by the beds. Breathe with me.
In... and out.", and she SHALL answer "...Okay. Okay." on a shaky breath.

#### Scenario: Her own words back
- **WHEN** the tray falls in the surgery and her panicked breathing has played
- **THEN** Okafor's "Sit down by the beds. Breathe with me. In... and out." plays, then Priya's "...Okay. Okay."

#### Scenario: No medical advice
- **WHEN** the scene plays from Priya's run to the creature coming out
- **THEN** no line contains "medical advice" or "That's my line"

#### Scenario: She sits
- **WHEN** Okafor tells her to sit
- **THEN** she walks to the west wall by the beds and sits there until the creature comes out

#### Scenario: The rescue is tight
- **WHEN** the scene plays from Priya's first line to the armory opening
- **THEN** no pause inside a line is longer than 0.6 s, except written beats, which are at most 1.0 s
- **AND** Giles walks to the console while Priya is speaking, and the span is no more than 80 s (about 78 s with no lines cut; accepted 2026-11-23)

### Requirement: She turns around when asked
When Okafor asks her to turn around, Priya SHALL turn on the spot with her hands still raised: slowly, after a hesitation.
She SHALL do neither before he has asked: her hands come up after "Show me your hands." ends, and the turn starts after
"Turn around." ends.
With her back to the glass she SHALL freeze briefly, facing the surgery door, then turn back more quickly. She SHALL lower
her hands when she answers.

#### Scenario: She turns around
- **WHEN** Okafor has said "Turn around."
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
creature gone, the surgery door closed, the centre pane cracked and marked, the other panes clean, the cart skewed and its
loose instruments lying in a fixed scattered layout on the floor and the cart, whether or not physics is on. Restoring a
checkpoint between her run and the attack SHALL put her waiting in the medical bay with `D_R07_R08` sealed, and the
instruments on the cart.

#### Scenario: Skipped mid-slam
- **WHEN** the player skips the scene during the slam beat
- **THEN** Priya lies dead at her resting spot, the creature is not present, and the scene's flags are set as if it had played
- **AND** the cart is skewed and the instruments lie in the scattered layout

#### Scenario: Restore after R08
- **WHEN** the player dies later in the action half and restores to a checkpoint after the scene
- **THEN** Priya's corpse lies at her resting spot and the attack does not replay
- **AND** the instruments lie in the scattered layout, with none on the corpse

#### Scenario: Restore before the attack
- **WHEN** the player restores to `cp_cover_done`
- **THEN** Priya is hiding in the security office, `D_R07_R08` is sealed, and her run plays when Jay enters the room
- **AND** the instruments are back on the cart and the cart stands where it was placed

### Requirement: The cart carries loose instruments
The instrument cart SHALL carry at least eight loose instruments: on its top a steel dish, thin tools, a wrapped pack,
vials and a steel bowl, and on its shelf a box and a basin. Each SHALL rest on the surface it stands on, neither
floating above it nor sunk into it, and SHALL stay still until the slams.

#### Scenario: At rest before the attack
- **WHEN** the medical bay has been loaded with physical interaction on and the attack has not begun
- **THEN** every loose instrument on the cart is where it was placed, with none sunk, floating, jittering or fallen

#### Scenario: Seen with physics off
- **WHEN** the player looks at the cart through the centre pane with every physics feature switched off
- **THEN** the instruments are on the cart, standing still

### Requirement: The slams scatter the cart's load
With physical interaction on, each head slam SHALL throw the loose instruments near the impact up and outward. The
hits SHALL build: the first SHALL make the top's small items jump, by the second most of the top SHALL be off the cart,
and the third SHALL also tip out the shelf. No instrument SHALL pass through the glass, a wall or the floor.

#### Scenario: First slam
- **WHEN** the first slam lands
- **THEN** the small instruments on the cart top leave its surface and at least one lands back on it

#### Scenario: Swept off
- **WHEN** the second slam has landed and 1 s has passed
- **THEN** at least half of the instruments that started on the cart top are on the floor

#### Scenario: Shelf tipped out
- **WHEN** the third slam has landed and 2 s have passed
- **THEN** at least one item from the shelf is on the floor

#### Scenario: On her side of the glass
- **WHEN** the slams have ended and every instrument has come to rest
- **THEN** every instrument lies inside the medical bay, on the floor, the cart or other furniture, and none is past the pane

#### Scenario: Some come at the glass
- **WHEN** the three slams play
- **THEN** at least one instrument strikes the centre pane or lands within 0.5 m of its foot

### Requirement: The cart jolts on each slam
On each slam the cart SHALL dip and rock and move a few centimetres along the floor, coming to rest skewed from where
it stood. It SHALL never move more than 0.25 m from its first place, and the slam target SHALL stay on its top.

#### Scenario: Skewed after the slams
- **WHEN** the slam beat ends
- **THEN** the cart has turned or moved from where it stood, by no more than 0.25 m at any corner

#### Scenario: Her head still lands on the top
- **WHEN** the third slam lands
- **THEN** Priya's head is above the cart's top surface

### Requirement: The slams build in rhythm
The three slams SHALL NOT be evenly spaced. The gap before the third SHALL be the longest, with the creature holding
its wind-up before it.

#### Scenario: Uneven gaps
- **WHEN** the slam beat plays
- **THEN** the gap between the second and third impacts is at least 0.3 s longer than the gap between the first and second

### Requirement: Each slam sounds different
Each slam SHALL layer a head impact, a heavy steel impact from the cart and a rattle of instruments, with no two
slams in a row playing the same steel impact. No slam SHALL play a glass-breaking sound.

#### Scenario: Three different impacts
- **WHEN** the three slams play
- **THEN** each plays a head impact, a steel impact and a rattle, and the second steel impact differs from the first and the third from the second

#### Scenario: No glass breaks
- **WHEN** the slam beat plays
- **THEN** no glass-breaking sound plays

### Requirement: Instruments sound where they land
With physical interaction on, each loose instrument SHALL play a landing sound for its material where it strikes
the floor, the glass, the cart or another instrument, louder the faster it strikes. When the steel dish lands hard,
it SHALL be heard spinning down to rest where it landed. The intercom SHALL carry these sounds while it is live.

#### Scenario: Landing on the floor
- **WHEN** a steel tool thrown by a slam lands on the floor
- **THEN** a metal landing sound plays from where it landed

#### Scenario: The dish spins down
- **WHEN** a slam throws the steel dish and it lands on the floor
- **THEN** a spinning-down sound plays from where it landed, once

#### Scenario: Soft landing is quieter
- **WHEN** one instrument lands at 4 m/s and another at 1 m/s
- **THEN** the first one's landing sound is louder

#### Scenario: Heard over the intercom
- **WHEN** the instruments land while the player stands at the far side of the security office with his back to the glass
- **THEN** their landing sounds are heard from the intercom speaker

#### Scenario: Settled instruments are quiet
- **WHEN** every instrument has come to rest
- **THEN** no landing sound plays until something moves them again

### Requirement: The slams jolt the view
Each slam SHALL shake the player's view slightly, wherever he stands in the security office, without moving him or
taking control.

#### Scenario: Shake on the slam
- **WHEN** a slam lands while the player stands in the security office
- **THEN** his view shakes briefly, and his position and control are unchanged

### Requirement: Her landing clears the instruments
When Priya is thrown to the foot of the centre pane, any instrument lying where she lands SHALL be knocked aside, so
that no instrument shows through her body.

#### Scenario: Instrument under her
- **WHEN** an instrument lies at the foot of the centre pane where Priya's body comes to rest
- **THEN** it is knocked clear of her body as she lands

### Requirement: Default settings show the scatter
A player who has never changed the physics settings SHALL see the cart's load scatter, including a player whose saved
settings were stored before physical interaction was switched on by default.

#### Scenario: Fresh player
- **WHEN** the scene plays with no saved settings and no `physics` URL flag
- **THEN** the slams throw the instruments

#### Scenario: Settings saved earlier
- **WHEN** the scene plays with settings saved before physical interaction was on by default, and no `physics` URL flag
- **THEN** the slams throw the instruments

#### Scenario: Physics off
- **WHEN** the scene plays with `?physics=off`
- **THEN** the slams play with their impact sounds, the instruments stay on the cart, and nothing errors

### Requirement: It screams over her body
After throwing Priya, the creature SHALL face the glass and scream over her body, seen and heard, before it walks back to the surgery.

#### Scenario: The scream after the throw
- **WHEN** the creature's scream sounds after Priya is thrown
- **THEN** the creature rears with its jaw open and its blades raised, in view from the security office

#### Scenario: Then it leaves
- **WHEN** the scream's rearing ends
- **THEN** the creature walks back to the surgery at the same time as before
