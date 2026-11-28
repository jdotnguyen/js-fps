# Spec Delta

## MODIFIED Requirements

### Requirement: CAM 10 high-aimed Juggernaut face reveal and hard blackout to cliffhanger
After gunfire begins, fullscreen `CAM 10  CONCOURSE` (`[71.2, 2.0, 28.8]` -> `[70.0, 1.5, 38.6]`) SHALL cut in with both squadmates immediately aiming high (`r16_monster_face_aim` at `Y = 5.4`, then `juggernautHead` `+ 0.8 m`, where `juggernautHead` is the creature's aim point riding its head) so only the creature's face is lit. The `5.1 m` skinned `monster_juggernaut.glb` SHALL glide over `5.2 s` from `[64.8, 0, 34.6]` to `[68.2, 0, 34.6]` (`yaw: 95`, clear of the foreground right pillar), holding the posed frame its model was exported in, with its eyes, teeth and tongue in place on its head, and play its initial CCTV roar (`r16MonsterRoar`). Once the initial roar finishes, the scene SHALL cut hard to black (`CAM 10` off, Juggernaut and lights off) while keeping `sfx` un-hushed, fire a longer sustained angry roar in the dark (`r16MonsterRoarBlackout`, ~`5.5 s`), and hold on black for several seconds to let the roar register before hushed silence and `story:cliffhanger` fade in the `THALASSA` credit.

#### Scenario: Juggernaut face reveal on CAM 10 and cliffhanger handoff
- **WHEN** `CAM 10  CONCOURSE` cuts in during scripted gunfire
- **THEN** both squadmates keep their weapon flashlights pitched high on the creature's face as the `5.1 m` Juggernaut glides out beside the foreground right pillar without clipping, `r16MonsterRoar` plays to completion, and the scene cuts hard to black to play the sustained angry roar `r16MonsterRoarBlackout` over several seconds of black before hushed silence emits `story:cliffhanger` -> `title_card` (`THALASSA`) -> `stinger_priya` -> `endSlice`

#### Scenario: Juggernaut face parts and framing on CAM 10
- **WHEN** the Juggernaut glides out on `CAM 10`
- **THEN** its eyes, teeth and tongue show on its head, its body holds the same exported pose as before the rig, and its head marker ends the glide within 2 cm of where it ended before the rig
