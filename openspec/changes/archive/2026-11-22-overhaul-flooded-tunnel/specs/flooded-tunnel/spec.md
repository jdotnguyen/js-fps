# Spec Delta

## Purpose

Defines the flooded maintenance tunnel (R09) and the pump room (R10): how the sump holds its water, what the player finds
and fights there, and how turning the valve seals the tunnel off for good in a staged cutscene before the creature in it
pries its way back through.

## ADDED Requirements

### Requirement: The tunnel is a sunken sump
R09's floor SHALL sit 1.2 m below the floor of the doors at both ends, with stairs down from the R07 door and stairs up
to the R10 door. Both doors SHALL stand on dry landings above the waterline. The water surface SHALL be 0.45 m below
deck level, about 0.75 m deep over the sump floor.

#### Scenario: Walking in from R07
- **WHEN** Jay walks through the R07 door into R09
- **THEN** he stands on a dry landing and walks down stairs into the water, getting deeper step by step

#### Scenario: Water stays in the sump
- **WHEN** either door of R09 is open
- **THEN** the waterline stays below the door's threshold, and no water shows on the floor beyond it

#### Scenario: No climbing out over the side
- **WHEN** Jay jumps from the sump floor toward a landing edge
- **THEN** he cannot get onto it, because it is more than his jump reach above the sump floor, and he must use the stairs

### Requirement: The flood has a visible source
R09 SHALL show where its water comes from: a burst pipe at the low point pours into the sump, and drips fall from the
pipe runs overhead. The pouring pipe SHALL be audible from where it is and SHALL keep the surface churning around it.

#### Scenario: Finding the leak
- **WHEN** Jay rounds the L-bend
- **THEN** he sees and hears the burst pipe pouring into the water, with the surface disturbed around it

### Requirement: The tunnel looks long-flooded
R09 SHALL show signs that the water has stood for a while:
- a tide mark on the walls above the current waterline
- darker, glossier wet materials near the water
- a thin mist on the surface
- floating junk (paper, a hard hat, a glove, cups, oil sheen)
- objects visible under the surface through the murk

#### Scenario: Looking along the wall
- **WHEN** Jay looks at an R09 wall
- **THEN** a grimy tide mark runs above the waterline, and the wall below it is darker and wetter than the wall above

#### Scenario: Floating junk
- **WHEN** the water is disturbed near a piece of floating junk
- **THEN** the junk bobs on the surface rather than sitting still

### Requirement: Failing lights and sparks in the tunnel
R09's ceiling tubes SHALL use the slow failing-tube pattern, with at least one tube hanging loose and swaying. A broken
fixture SHALL throw sparks when its tube stutters, and sparks that reach the water SHALL hiss and leave a small ring.

#### Scenario: A tube fails
- **WHEN** a failing tube in R09 goes dark and stutters back on
- **THEN** its broken neighbour throws sparks, and the sparks that fall into the water hiss as they land

### Requirement: The pickup on the wedged case
The R09 pistol-ammo pickup SHALL sit on a steel equipment case wedged against a pipe support in the water. The case top
SHALL stand above the waterline and within Jay's jump reach from the sump floor, and the pickup SHALL be collectable
from the case top.

#### Scenario: Jumping onto the case
- **WHEN** Jay jumps from the sump floor toward the case
- **THEN** he lands on its top and can pick up the ammo there

### Requirement: Tunnel encounters use the water
In R09, enemies of the tunnel group that spawn from the floor SHALL rise up out of the water, and the tunnel's
play-dead corpses SHALL lie face down in the water. Enemies wading anywhere in R09 SHALL disturb the water and be
audible from around the L-bend before they're visible.

#### Scenario: A shambler rises
- **WHEN** a floor spawn of the tunnel group activates in the sump
- **THEN** the shambler breaks the surface with a splash and stands up with water running off it

#### Scenario: Heard before seen
- **WHEN** a shambler wades toward Jay from beyond the L-bend
- **THEN** its sloshing and wake reach him before it comes into view

### Requirement: The pump room overlooks the sump
R10 SHALL be a pump room with pump machinery, moving pressure gauges, the valve and a grated overlook through which the
R09 stairs and water are visible.

#### Scenario: Looking back from the pump room
- **WHEN** Jay stands at R10's overlook
- **THEN** he can see down the R09 stairs to the water below

### Requirement: Turning the valve starts the flood cutscene
Turning the R10 valve SHALL start a sequence that puts Jay on rails with the letterbox bars, holsters his weapon and
holds his view on the turning wheel. While his view is held there, Giles and Okafor SHALL be placed in R10 behind him,
out of his view, wherever they were before.

#### Scenario: Squadmates left behind
- **WHEN** Jay turns the valve while Okafor is still in R09
- **THEN** after the view turns around, Okafor is standing in R10 with Giles, and Jay never saw either appear

### Requirement: A red beacon turns the view around
During the flood cutscene, after the wheel has turned, a red beacon behind Jay SHALL switch on with a klaxon. Its light
SHALL visibly sweep the wall and wheel in front of him before his view turns to face the R09 door and overlook.

#### Scenario: The beacon comes on
- **WHEN** the wheel finishes turning
- **THEN** red light sweeps across the wheel, the klaxon sounds, and the view then turns around to the door

### Requirement: The door seals in the creature's face
In the cutscene the R09–R10 door SHALL stand open when the view turns, so the stairs are seen through it. R09's water SHALL
NOT rise. The creature SHALL be the elite (the hero-tier body with blade arms). It SHALL charge up the stairs, shrieking,
and the door SHALL slam shut just before it arrives and stay sealed. It SHALL pound on the door, then walk back down out of
sight, so the danger seems past. After the cutscene, R09 SHALL be unreachable for the rest of the playthrough.

#### Scenario: The door seals
- **WHEN** the elite reaches the top of the stairs
- **THEN** the door has just slammed shut in front of it, it pounds on it, and the tunnel's water stays at its authored level

#### Scenario: Enemies left in the tunnel
- **WHEN** Jay turns the valve with two tunnel shamblers still alive
- **THEN** neither is left in play after the cutscene, and the group's fight counts as over

### Requirement: The cutscene's lines and music follow the slam
The squad's panic lines SHALL be spoken before the door seals, and the call to seal it SHALL end as the leaves meet. No
line about the door or the charge SHALL start after the door has sealed. A music stinger SHALL land a single hit on the
slam. The score SHALL keep playing from the alarm through the pounds and the last line, then fade out.

#### Scenario: The call to seal it
- **WHEN** Okafor shouts to seal the door
- **THEN** the door starts closing during the line and the leaves meet as it ends

#### Scenario: Nothing is said too late
- **WHEN** the door has sealed
- **THEN** the only line still to come is Giles's quiet "Is it gone?" after the pounding, spoken with the view free

#### Scenario: The hit lands on the slam
- **WHEN** the leaves meet
- **THEN** the stinger's single hit and the slam sound land together, and the music carries on under the pounding

### Requirement: The elite pries its way back through at the R11 door
After the valve, when Jay first reaches the R11 bulkhead, a jump-scare sting SHALL play and the view SHALL whip round to
the R09–R10 door. The elite's blade arms SHALL stab into the seam between the door's leaves, clamp together, and wrench
the leaves partway apart from the middle. The door SHALL then slam shut on its arms, shearing both forearms off into the
pump room. The ambush SHALL happen once per save, in a fully lit R10.

#### Scenario: The ambush
- **WHEN** Jay walks up to the R11 bulkhead after the valve cutscene
- **THEN** blades force the door behind him open from the middle, the door slams back on them, and the severed forearms drop onto the pump-room floor

#### Scenario: The door never opens fully
- **WHEN** the elite wrenches the leaves apart
- **THEN** the gap stays too narrow to pass, and the door stays sealed throughout

#### Scenario: Only once
- **WHEN** Jay walks away from the bulkhead and back again, or reloads after the ambush
- **THEN** the ambush does not play again

### Requirement: The flood cutscene can be skipped once seen
The flood cutscene SHALL be skippable with the hold-to-skip control only once the player has watched it through in this
save. Skipping SHALL leave the same state as watching to the end: Giles and Okafor in R10, the door sealed, the beacon on,
the tunnel enemies gone, the valve lines played and the Valve Room checkpoint saved.

#### Scenario: First time
- **WHEN** the player turns the valve for the first time in a save
- **THEN** holding the skip key does not skip the cutscene

#### Scenario: Skipped on a replay
- **WHEN** the player has already watched the cutscene and skips it partway through
- **THEN** the end state matches a full watch

### Requirement: Checkpoints restore the right water
Restoring the Flooded Tunnel checkpoint SHALL bring back R09 at its authored water level with the R09–R10 door closed
but openable. Restoring the Valve Room checkpoint SHALL bring back R09 at the same authored level, the R09–R10 door
sealed and the beacon on, with Giles and Okafor in R10.

#### Scenario: Dying after the valve
- **WHEN** Jay dies after the valve cutscene and restarts from the Valve Room checkpoint
- **THEN** R09's water is at its authored level behind the sealed door, and the cutscene does not play again
