# Spec Delta

## ADDED Requirements

### Requirement: Uniform train car dimensions across all ride stages
Train Car A (`r15a_train`), the Stage 2 tunnel car (`r15b_train`), and Train Car B (`r16a_train`) SHALL all share identical interior and exterior shell dimensions (`length: 9`, `width: 3`, `height: 2.9`) so the cabin walls, windshield, benches, roof ribs, hanging straps, and cabin lights never shift relative to the player during Stage 1 -> Stage 2 or Stage 2 -> Stage 3 handoffs.

#### Scenario: Standing in the cabin across both stage handoffs
- **WHEN** Jay stands anywhere inside the cabin (such as the center aisle) through the Stage 1 -> Stage 2 handoff and the Stage 2 -> Stage 3 handoff
- **THEN** his distance to the front windshield, rear bulkhead, roof ribs, and hanging straps remains unchanged across each handoff, with no visible cabin jump or repositioning

## MODIFIED Requirements

### Requirement: Stage 2 infinite scrolling lit hallway, slowing early into a closed gate
After Stage 1 pull-out, the ride SHALL hand off seamlessly into an isolated, infinite-scrolling lit hallway that matches the shrouds, fades to black at its open ends, starts scrolling at Stage 1's pull-out exit speed, accelerates smoothly to cruise speed, and then slows smoothly near its end while a closed blast gate arrives where R16a's closed gate will be.

#### Scenario: Riding through the hallway
- **WHEN** Stage 2 of the transit ride is active
- **THEN** Jay remains inside the clean train cabin while lit rib bars, guide strips and wall-panel seams scroll past outside the cabin windows, and the hallway ahead fades to black with no visible hard edge

#### Scenario: Smooth acceleration from Stage 1 pull-out into tunnel cruise
- **WHEN** Stage 1 pull-out hands off to Stage 2
- **THEN** the hallway scroll begins at Stage 1's exit speed (`2 * 14 / 3.8 ≈ 7.37 m/s`) rather than jumping instantaneously to cruise speed, and ramps smoothly up to cruise speed (`20 m/s`) over the opening acceleration window

#### Scenario: One continuous hallway
- **WHEN** Jay rides from the R15a pull-out through Stage 2 and into the R16a glide-in
- **THEN** the same lit hallway is visible throughout, with no open water, ocean floor or windows to the outside

#### Scenario: Slowing early into a visible gate
- **WHEN** Stage 2 nears its end
- **THEN** after cruise, the hallway scroll slows smoothly (never speeding up again) to the Stage 3 start speed (`5.0 m/s`), and a bright closed blast gate with lit signals emerges from the fog and arrives deterministically at `10.125 m` ahead of the car at the exact moment of the Stage 2 -> Stage 3 handoff

#### Scenario: Nothing crosses the car or the bore
- **WHEN** a car passes through an open blast gate or stands in its cabin
- **THEN** no static gate geometry, room wall or ceiling light shaft is inside the car body or its path

### Requirement: The R16a gate lifts after the cut, clear of the car
At the Stage 2 to Stage 3 hand-off, R16a's blast gate SHALL be closed at the exact distance (`10.125 m` ahead of the car center) where the rig's gate arrived with zero frame-timing drift, and SHALL lift (animated, fast) once R16a is rendered, fully open before the car's nose or a player standing at the front of the cabin reaches it, without touching the car roof or pushing the player back.

#### Scenario: Gate lifts as the glide begins
- **WHEN** the hand-off to R16a has happened
- **THEN** the closed gate sits at the exact position where the rig's gate arrived (no shutter snap), begins to lift within 0.1 s, is fully open within about 1 s, and the car passes through without clipping the shutter or the player being pushed back
