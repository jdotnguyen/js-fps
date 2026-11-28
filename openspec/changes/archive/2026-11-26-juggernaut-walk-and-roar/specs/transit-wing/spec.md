# Spec Delta

## MODIFIED Requirements

### Requirement: CAM 10 high-aimed Juggernaut face reveal and hard blackout to cliffhanger
After gunfire begins, fullscreen `CAM 10  CONCOURSE` (`[71.2, 2.0, 28.8]` -> `[70.0, 1.5, 38.6]`) SHALL cut in with both squadmates immediately aiming high (`r16_monster_face_aim` at `Y = 5.4`, then `juggernautHead` `+ 0.8 m`, where `juggernautHead` is the creature's aim point riding its head) so only the creature's face is lit. The `5.1 m` skinned `monster_juggernaut.glb` SHALL walk on its creature gait from `[64.8, 0, 34.6]` to `[68.2, 0, 34.6]` (`yaw: 95`, clear of the foreground right pillar) over about `5.2 s`, with its eyes, teeth and tongue in place on its head, acting its walking roar as the initial CCTV roar (`r16MonsterRoar`) plays. Giles and Okafor SHALL keep firing as it walks. Once it stops, it SHALL act its long roar on camera as the sustained angry roar (`r16MonsterRoarBlackout`) plays. The squadmates SHALL keep firing, slowly (0.65 s between shots) and quietly (0.6 of the gunshot's level as it walks, 0.4 under the long roar), and SHALL back away about 1.6 m from it while it walks out, still facing it so their lights stay on its face. As it rears up, Giles (`r16_giles_05`) and then Okafor (`r16_okafor_04`) SHALL yell "What the fuck is that?!" on the radio channel, loud (line gain 1.3), before the long roar drowns them. On the roar's last beat the scene SHALL cut hard to black with dead silence (`CAM 10` off, Juggernaut and lights off, every bus hushed). About a second later, `story:cliffhanger` SHALL fade in the `THALASSA` credit.

#### Scenario: Juggernaut face reveal on CAM 10 and cliffhanger handoff
- **WHEN** `CAM 10  CONCOURSE` cuts in during scripted gunfire
- **THEN** both squadmates keep their weapon flashlights pitched high on the creature's face as the `5.1 m` Juggernaut walks out beside the foreground right pillar without clipping, acting its roar to `r16MonsterRoar`
- **AND** the squadmates back away facing it, their lights on its face, firing slowly and quietly
- **AND** Giles and then Okafor yell "What the fuck is that?!", and it acts its long roar to `r16MonsterRoarBlackout` on camera over their quieter fire
- **AND** the scene cuts hard to black and silence, then `story:cliffhanger` -> `title_card` (`THALASSA`) -> `stinger_priya` -> `endSlice`

#### Scenario: Juggernaut face parts and framing on CAM 10
- **WHEN** the Juggernaut walks out on `CAM 10`
- **THEN** its eyes, teeth and tongue show on its head, its hands and feet stay planted between steps, and it ends its walk within 5 cm of `[68.2, 0, 34.6]`

#### Scenario: No roar in the dark
- **WHEN** the scene has cut to black after the long roar
- **THEN** no creature sound plays until the `THALASSA` card
