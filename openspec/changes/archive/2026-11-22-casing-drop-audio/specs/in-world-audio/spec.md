# Spec Delta

## ADDED Requirements

### Requirement: Spent casings land after the gun ejects them
Each pistol shot SHALL eject a spent brass casing, and each shotgun pump SHALL eject a spent hull on the pump motion, not on the shot. The casing SHALL be heard landing 0.35 s to 0.7 s after it leaves the gun, from a point on the floor 0.4 m to 1.5 m to the shooter's right. A dry fire SHALL eject nothing. Inserting shells during a reload SHALL eject nothing.

#### Scenario: Pistol shot
- **WHEN** Jay fires the pistol once while standing on a concrete floor
- **THEN** a single brass casing is heard landing to his right about half a second after the shot

#### Scenario: Shotgun hull on the pump
- **WHEN** Jay fires the shotgun and the pump animation racks it
- **THEN** the hull is heard landing after the pump's rack-back, not at the moment of the shot

#### Scenario: Dry fire
- **WHEN** Jay pulls the trigger on an empty pistol
- **THEN** no casing sound plays

### Requirement: Casing sound follows the surface it lands on
The landing sound SHALL be chosen from the acoustic surface at the landing point, not from the surface under the shooter. Concrete and metal plate SHALL ring and bounce. Metal plate SHALL ring longest. Rubber and carpet SHALL give a short dull tick with no bounce, clearly quieter than the same casing on concrete. A point with no surface tag SHALL use metal plate, as footsteps do.

#### Scenario: Standing on the edge of a carpet
- **WHEN** Jay stands on bare floor at the edge of the office carpet with the carpet to his right, and fires the pistol
- **THEN** the casing makes the soft carpet tick, not the hard-floor ring

#### Scenario: Deck plate against carpet
- **WHEN** Jay fires the same number of pistol shots once on metal plate and once on carpet
- **THEN** the casings on plate ring and bounce, and the casings on carpet are short, dull and clearly quieter

### Requirement: Casings fall through grates
A casing landing on a grate SHALL rattle on the grate. When the grate covers a floor or water below, within 3 m, the casing SHALL sometimes fall through and land again on that lower surface, more quietly and duller, after the extra fall time. A grate over nothing within 3 m SHALL play only the rattle.

#### Scenario: Grate over a lower deck
- **WHEN** Jay fires a burst of pistol shots while standing on a grate above a lower deck
- **THEN** each casing rattles on the grate, and some are heard again, fainter, landing on the deck below

### Requirement: Casings in water
A casing that lands where standing water is at least 2 cm deep and shallower than 45 cm SHALL make a small water plip instead of a floor sound. Where the water is 45 cm or deeper, the casing SHALL land silently.

#### Scenario: Shallow flooded corridor
- **WHEN** Jay fires the pistol while wading ankle-deep
- **THEN** each casing makes a small plip and no hard-floor ring

#### Scenario: Thigh-deep water
- **WHEN** Jay fires the pistol while standing thigh-deep
- **THEN** no casing sound plays

### Requirement: Brass and hulls sound different
Pistol brass SHALL sound bright and metallic on every surface. Shotgun hulls SHALL sound duller and lower, a plastic clack with a metal-base knock and fewer bounces. The two SHALL NOT share recordings.

#### Scenario: Same floor, both guns
- **WHEN** Jay fires the pistol and then the shotgun on the same concrete floor
- **THEN** the pistol casing tings and rolls, and the shotgun hull clacks once or twice

### Requirement: Casing sounds vary and stay clean under rapid fire
Consecutive casing landings SHALL NOT repeat the same recording at the same pitch. No more than 4 casing sounds SHALL play at once. When a fifth starts, the oldest SHALL fade out within 50 ms rather than cut off. Casing sounds SHALL be positional at the landing point and audible up to 8 m.

#### Scenario: Emptying a magazine
- **WHEN** Jay fires a full pistol magazine as fast as he can
- **THEN** each casing is distinct, the clatter never builds into a wash, and no casing sound clicks or pops off

#### Scenario: Out of range
- **WHEN** a casing lands more than 8 m from the listener
- **THEN** it is not heard

### Requirement: Casings are not a noise to enemies
A landing casing SHALL NOT count as a noise for infected hearing. The gunshot that ejected it already does.

#### Scenario: Noises from one shot
- **WHEN** Jay fires one pistol shot and its casing lands
- **THEN** the infected hear exactly one noise, the gunshot, and nothing for the casing
