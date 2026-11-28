# Spec Delta

## ADDED Requirements

### Requirement: A squad mate's pistol shows only while aiming
Giles and Okafor SHALL each hold a pistol in the right hand while in the aim pose (`aim_pistol`), and SHALL show no pistol in any other pose. The pistol SHALL appear once the blend into the aim pose is at least half done, and disappear once the blend out of it is at least half done. It SHALL never show at the same time as a mug or the scanning wand.

#### Scenario: Raising the gun
- **WHEN** Giles goes from idle into the aim pose because an infected appears
- **THEN** the pistol is in his right hand by the time the aim pose is reached

#### Scenario: Back to work
- **WHEN** combat ends and Okafor blends from the aim pose back to idle
- **THEN** the pistol is gone from his hand by the end of the blend

#### Scenario: Coffee in hand
- **WHEN** Giles is in a mug pose
- **THEN** he holds the mug and no pistol

### Requirement: The pistol sits in each mate's own grip
The held pistol's grip SHALL sit in the palm of the body holding it, with the fingers wrapped round the grip, wherever that rig's palm and knuckles are. It SHALL fit both bodies without per-character tuning. No finger SHALL pass more than 3 mm into the grip. The trigger guard SHALL stay clear of the palm.

#### Scenario: Two different hands
- **WHEN** Giles and Okafor, whose knuckles sit 8.6 cm and 12.6 cm from the wrist, each aim the pistol
- **THEN** each pistol sits in that character's own palm and both grip checks pass

### Requirement: The pistol points along the aim
While a mate aims at a target, the pistol's barrel SHALL point within 5 degrees of the line from the muzzle to the target's aim point. The pistol SHALL stay steady in the hand while the body breathes and shifts.

#### Scenario: Aiming at an infected
- **WHEN** Okafor aims at an infected 6 m away
- **THEN** the line from the pistol's muzzle along its barrel passes within 5 degrees of that infected's aim point

### Requirement: The slide kicks back on each shot
Each squad shot SHALL kick the pistol's slide back and return it within 0.15 s. The slide SHALL rest closed at all other times.

#### Scenario: One shot
- **WHEN** Giles fires once
- **THEN** his pistol's slide moves back and is closed again within 0.15 s

### Requirement: The pistol flashes and lights its surroundings on each shot
Each squad shot SHALL show a muzzle flash at the shooting mate's pistol muzzle and SHALL light the surroundings near the muzzle, as the player's own muzzle flash does. The flash and its light SHALL be gone within 0.06 s of the shot. The light SHALL NOT cast shadows, and firing SHALL NOT change the number of lights in the scene.

#### Scenario: Covering fire in a dark corridor
- **WHEN** Okafor fires in a dark corridor
- **THEN** a flash shows at his pistol's muzzle and the walls and bodies near it light up for an instant

#### Scenario: Back to dark
- **WHEN** 0.06 s have passed since Giles's last shot
- **THEN** his pistol shows no flash and the squad muzzle light is dark
