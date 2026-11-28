# Spec Delta

## ADDED Requirements

### Requirement: The pistol's slide rack is heard as two clicks
Whenever the support hand racks the pistol's slide, the game SHALL play a two-click rack sound: the first click as the slide is pulled back and the second as it snaps home, each within 0.1 s of the matching movement.

#### Scenario: End of a reload
- **WHEN** the player reloads the pistol, with an empty or a part-full magazine
- **THEN** two distinct clicks are heard as the hand pulls the slide back and lets it home, near the end of the reload

#### Scenario: End of a draw
- **WHEN** the pistol is drawn and the rack is not interrupted
- **THEN** the same two clicks are heard with the slide movement

### Requirement: Drawing the pistol racks the slide
Every time the pistol is drawn, the support hand SHALL rack the slide once the gun is up. The rack SHALL NOT delay when the player can fire, reload or switch, SHALL NOT change the ammunition, and SHALL be cut short by a shot, a reload or a switch, in which case a rack sound not yet started SHALL NOT play.

#### Scenario: Switching back to the pistol
- **WHEN** the player switches from the shotgun to the pistol and does nothing else
- **THEN** the pistol comes up, the support hand racks the slide, the gun settles into its rest pose, and the loaded and reserve rounds are unchanged

#### Scenario: Other draws
- **WHEN** the pistol is drawn on the drop's first duct bang, or comes up on loading a save with it in hand
- **THEN** the slide is racked in the same way

#### Scenario: Firing during the rack
- **WHEN** the player fires a loaded pistol during the draw, before the rack sound has started
- **THEN** the shot is fired at once, the rest of the rack is dropped and its sound does not play
