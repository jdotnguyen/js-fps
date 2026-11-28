# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
