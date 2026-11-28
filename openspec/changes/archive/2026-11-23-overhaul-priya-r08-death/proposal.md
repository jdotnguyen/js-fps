# Proposal

## Why

Priya's attack at the medical bay glass (R08, `sec_glass`) is meant to be the moment Okafor's calm cracks, and it does not land. In the first playtest:
- the attacker is a researcher in a lab outfit at infection 3, not a creature;
- it never touches her, and the gore fires at fixed points while it stands about 1.4 m off (it reads as 10 ft through the fog);
- the drag is a rope 1.1 m from the creature's feet, so she looks towed, not held;
- one `glass:blood` event paints the same canvas smear on all three panes at once, and `glass: cracked` cracks all three.

Justin has also decided (2026-11-20) that the scene shows her death in full: the creature kills her and smashes her head into a table. A survivable attack no longer fits, so the post-title stinger has to change too.

The first version of this change was built and played on 2026-11-21. The face slams and the throw work. These did not:
- the creature walks past her, then jumps behind her to grab her (the grab places it instantly);
- the blood particles are flat squares;
- the crack is a drawn white star;
- no blood lands where she hits the glass;
- the ankle drag to the surgery looks wrong.

Justin also wants Jay free to walk around during the scene, as in Voss's death, and wants Priya's arrival to be part of the scene.

A review on 2026-11-22 found that the rest of the security office script no longer fits the game:
- The station blackout (`station-blackout`) now puts R07 and R08 on backup power, so the medical bay is as dark as everything else and the glass no longer frames anything.
- The script was written for a lit station and a long R06 wave. Priya still sits typing at a console in R08 when Jay arrives, and Giles opens the armory with "Christmas came early, Jay." right after she has fled from the squad.
- There is no moment between Priya and Okafor while she is alive, so her death has nothing to break.
- The aftermath is a run of leftovers: a strangled cry from Giles, a second "August?", a third version of his panel excuse, a line about "routine" that answers a notice board in another room, and Giles walking to a door he already opened.
- Justin has dropped Giles's infection: he is no longer infected. The cliffhanger will be rewritten around a different character later. The intro's arm line stays, because nothing hangs on it.

## What Changes

- **BREAKING (story canon):** Priya dies on screen in R08. The bloom keeps her body moving: the stinger shows her corpse turning (converted), not Priya alive, begging and being killed. Supersedes the 2026-11-16 amendment in `docs/characters.md` ("attacked ... appears dead, but survives").
- **Lead-in:** Priya is hiding in the security office (R07) when the R06 cover wave is cleared and the bulkhead stands open. She sees the armed squad, panics, and runs and stumbles into the medical bay through `D_R07_R08`, which seals behind her. Until the attack she waits in the medical bay in view through the glass, while the creature is only heard in the surgery.
- **Jay free in a sealed room:** as in Lab B, the scene waits until the squad is in the security office, seals `D_R06_R07`, and lets Jay walk slowly with weapons off and looking free. He is no longer locked at the glass, and he can still bang on it.
- New scripted kill kind `mauled`: a creature attacker in contact with the victim. Beats in order: plead, impale, carry, slam ×3, throw, still.
  - **Plead:** when the creature comes out of the surgery, Priya backs away to the west end of R08 (Jay's right as he faces the glass) with her hands up, begging to be let out through the door she sealed. The creature strolls from the surgery door along the glass, past Jay, stopping once to stare at him, and on to her.
  - **Impale:** it drives its claw into her, with an impale sound and heavy blood, and carries her on its arm to the cart. The attacker only takes hold once it has walked into reach, and it is never placed instantly.
  - **Slam and throw:** kept as built. It grips her head for three slams on the cart, then throws her into the centre pane.
  - **Still:** she lies where she landed at the base of the pane, in spreading blood. The creature walks back into the surgery. There is no reach and no drag.
- The R08 attacker uses the creature body (`lab_creature`), not the `lab` NPC look.
- A steel instrument cart (the `instrument_cart` kit piece) stands in clear sight about 1.6 m behind the centre pane. This is where the head slams happen. It is seen from a viewing strip along the glass rather than from one locked spot.
- The partition has the door Okafor tries: a sealed glass door (`D_R07_R08`, `glass_slide`) in place of the east pane. It is now the door Priya sealed herself.
- The rooms around the scene are re-staged as a medical bay and a security office that read on sight (as built). The R08 lane now runs from the surgery door along the glass to the west end, for the creature's walk, the carry and its exit.
- **Glass marks are local and land where she touches the glass:** a splatter of blood on the pane at the throw impact that runs down it, a crack there, and a smear as she slides down. The crack looks like broken safety glass (a frosted centre, fine fractures and rings that catch the light), not a flat star. Only the struck pane changes. The two medbay panes have their own ids (`medbay_w`, `medbay_c`).
- **Blood reads as liquid in every kill:** soft, rounded drops of varied size, stretched along their path, that leave marks where they land. This replaces the square point particles.
- The gore clip plane is on the pane face (about z 45.72).
- **Helplessness for Jay:** an interact prompt on the glass lets him bang on it until the impale. It thuds, shakes the camera a little and plays a shout from Jay. The first bang makes the creature stop and stare at him for about 1.5 s (it stares anyway as it passes him if he never bangs). Nothing he does changes the outcome or the timing. Okafor's door attempt is refused by the lockdown with an audible denied buzzer.
- More lines from everyone. Okafor says her name exactly once (character rule 3), now at the impale. The call when she runs does not use her name. Priya's voice gets worse with each slam and stops at the third.
- The stinger is the medical bay feed (CAM 04) on her corpse by the pane. It drops Priya's begging lines (`stinger_priya_01`, `_02`, `_04`, `_05`) and the second attacker.
- **The medical bay stays lit in the blackout.** R08's main lights are on the medical circuit and stay at full strength on backup power. The surgery (R08b) stays dark, and the security office (R07) stays on backup, with its standby beacon keeping Jay visible from the lit side. The lit room seen from the dark one is the stage.
- **A rescue attempt before the creature (about 75-90 s).** The squad enters R07 and finds Priya through the glass. Okafor goes to the sealed door, and Giles finds that administration has sealed the medical deck remotely. He opens the medbay intercom instead. Okafor checks her over through the glass and tells her she is fine. She tells them something has been in the surgery since the lights went. A tray falls in there, and he talks her down with her own words from the intro ("Sit. That's medical advice." / "That's my line."). Giles opens the one door he can, the armory, and Jay takes the shotgun, while Priya and Okafor talk about the coffee she made him. Then the surgery door opens.
- **The creature is only heard until it comes out.** Sounds from the dark surgery build in steps through the rescue: a drip, a rattle, the tray, breathing and a scrape along the wall, then the handle.
- **A medbay intercom carries everything in R08.** Once Giles turns it on, Priya's voice, the surgery sounds and every sound of her death come out of a speaker in R07 with a comms tone and crackle, clear anywhere in the room, and the feed distorts on the loudest moments. Okafor turns it off at the end.
- **Okafor's voice is projected.** During the scene he is always clear, but sounds across the room, never right beside Jay.
- **A new `medbay` score**, locked to the tempo of the R08 vitals monitor, with a fragile motif for Priya that comes back slowed and detuned in the aftermath.
- **A new aftermath, about Priya and Okafor only.** Static and the monitor beep on the intercom. Okafor turns it off and writes in his notebook, with her cardigan on the chair behind the glass. "I told her she was fine." A long pause. "Med lab's through there."
- **Giles is no longer infected in R06 or R07.** The R06 numb-hand beat (`cover_giles_03`, `cover_okafor_01`, `cover_giles_04`, `flex_hand`, stage 1) and all R07 infection beats (stage 2, bandage, `rub_forearm`, `giles_cut_01`, `sec_giles_05`, `sec_okafor_06`, `sec_okafor_07`, `sec_giles_04`) are cut, along with the leftover aftermath lines and walks.
- **About 28 new or changed lines** for Priya, Okafor and Giles, with new VO.

## Capabilities

### New Capabilities
- `medbay-attack`: the R08 scene as the player sees it. Covers Priya's run in and the seal; her wait; Jay free in the sealed office; her retreat; the creature's walk past Jay and its stare; the walk-up with no snapping; the impale and carry; staging and sightline from the viewing strip; the door refusal; the cleared lane and room layout; the cast's lines; the corpse left by the pane; skip and restore.
- `slice-stinger`: the post-title medical bay feed. Priya's corpse by the pane is turned by the bloom on camera, then the feed cuts.

### Modified Capabilities
- `infection-kills`: the kill kinds go from two to three (`mauled` added). New requirements cover the stare (`noticed: stare`), the `mauled` beat order, taking hold only once in reach, contact, the hold (impaled, then by the head), a voice that worsens, glass marks and splatter at points of contact, safety-glass cracks, and blood that looks like liquid in every kill.
- `in-world-audio`: a live room intercom relays a room's sounds to a speaker in another room, with a comms tone, crackle and overload.
- `voice-playback`: voices in a room with a live intercom are also heard from its speaker. A scene can project a speaker's voice so it stays clear at a fixed apparent distance.
- `adaptive-music`: the new `medbay` score and how it follows the scene.
- `station-power`: a room on its own circuit keeps its main lights on backup power.
- `render-lighting`: a light on its own circuit is exempt from the 30% backup-light cap and keeps its own colour. This covers the medical bay and the pump room, which already works this way in code.
- `security-medbay`: the medical bay is lit on backup power while the security office and the surgery stay dark.

## Impact

- Data: `src/data/kills.json` (`mauled` beats reworked), `src/data/poses.json` (victim poses for hands-up retreat, impaled, carried; the creature's impale and carry poses), `src/data/sequences/action_contact.json` (`cover_me`: Priya's run before `cp_cover_done`), `src/data/sequences/action_security.json` (`sec_glass`: gather and seal, free movement, reworked kill hooks), `action_restore.json` / `quiet_restore.json` (Priya waiting, or her corpse at the resting spot), `src/data/sequences/action_climax.json` (`stinger_priya` on CAM 04), `src/data/dialogue/slice01_action.json` (the run call, Okafor's name moved to the impale), and `src/data/levels/slice01.json` regenerated from `scripts/gen-slice01.mjs` (Priya's R07 hiding spot, wait and cower spots, the lane along the glass, the resting spot, the CAM 04 framing).
- Code: `src/ai/npcKills.ts` / `killRun.ts` (arrival-gated beats, no instant `pin` during play, a claw hold on the torso, removal of reach and drag from the R08 style), `src/actors/gore.ts` (liquid drops with landing marks, impact splatter, safety-glass crack), `src/data/types/kills.ts`.
- Motion: a panicked run with a stumble for Priya, and a hands-up backing walk, sourced per `docs/mocap-sources.md` and reviewed in the cast motion sandbox. This may share work with `per-character-motion`.
- Audio: impale and flesh sounds in `src/audio/sounds.ts`, creature sounds from the surgery, and VO for the changed lines through `scripts/vo-generate.ts`.
- Docs: `docs/characters.md` (Priya's end: she lies by the glass, not dragged), `docs/HANDOFF.md`, `docs/PLAYTEST.md` (R06/R07 checklist, stinger description).
- Related: `priya-commons-exit` parks Priya at her medbay spot after the intro. This change moves her into R07 for the run.
- 2026-11-22 additions:
  - Data: `action_security.json` (`armory_auto`, `sec_glass_near` and `sec_rescue` folded into the rescue), `action_contact.json` (the R06 infection beat cut), `slice01.json` dialogue and `src/data/scores.json` (`medbay`), and `gen-slice01.mjs` (R08's circuit, the intercom speaker, the lockdown console text, the cardigan).
  - Code: the intercom relay and the projected voice in `src/audio/`.
  - Audio: surgery sounds, intercom static, and the `medbay` score, per `docs/audio-assets.md`.
  - VO: the new lines, per `docs/voice-casting-standard.md`.
- 2026-11-23 playtest fixes (design decisions 32-38):
  - Resuming from pause no longer re-runs `action_restore`. Before this fix, a resume mid-scene put Priya back in her R07 hiding spot, cut the intercom and opened `D_R06_R07`. That was also why the throw landed in R07 (`checkpoint-restore`).
  - The kill takes the glass side from the victim's room, not from where she stands.
  - The partition is armoured, and Jay's weapons come on when the bars clear.
  - Priya turns around when Okafor asks: a hesitant, hands-up turn that freezes facing the surgery door.
  - The rescue is paced tighter: pauses inside clips are trimmed, interruptions overlap, and actions play under lines.
  - The creature leaves through the surgery door, on its own walk.
  - Kill events cue only scores that are loaded. Before this fix, Lab B's score restarted over Priya's death (`adaptive-music`).
- Out of scope:
  - The Lab B `grownInside` kill. It gets the new blood drops, but its beats and data do not change.
  - The R09 med-lab door.
  - The final room and the cliffhanger. Giles's infection after R07 (`action_tunnel.json`, `action_climax.json`, the infection-driven code) and its write-up in `docs/characters.md` wait for the cliffhanger rewrite.
