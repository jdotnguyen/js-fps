# Tasks

## 1. Build and place the wall speakers

- [x] 1.1 Add the wall-mounted speaker to the modular kit with a metal housing, recessed grille and bracket. Register its dimensions for wall clearance and check the grille's world position on two differently oriented walls.
- [x] 1.2 Place speakers beside the docking window, along the walk to the Commons, in the gallery and around the rounds routes. Regenerate the slice and verify wall clearance and room coverage against the generated level.

## 2. Route station announcements through the fixtures

- [x] 2.1 Add the PA channel to dialogue types, content validation and the voice preview. Migrate the four Station PA entries and verify the library resolves each to its existing recording.
- [x] 2.2 Give each fixed scene cue its fixture reference. Resolve the repeat and gallery summons from the listener's area at playback start. Test the same quarantine line in both contexts, including a delayed start, a doorway crossing and an invalid fixture.
- [x] 2.3 Route the announcement and docking chime through the selected grille, with speaker filtering, attenuation and room reverb. Check voice mute on the dry and wet signal and exercise a local voice and a headset line as routing regressions.
- [x] 2.4 Exercise the existing speech lifecycle with the PA channel. Check simultaneous PA and squad subtitles, the squad's uninterrupted line, and cleanup when the intro is skipped or the player quits mid-announcement.

## 3. Listen in the game

- [x] 3.1 Run the intro in a scratch slot with stereo headphones. Locate the box by ear during Halcyon's docking. Follow the quarantine notice from ahead to behind on the Commons walk and tune its level until Giles is easy to follow with subtitles off.
- [x] 3.2 Trigger both rounds cues from different wings, cross a doorway mid-line and listen to the gallery lockdown over the crew. Verify each line finishes at its original fixture and the nearby dialogue stays intelligible.
- [x] 3.3 Run the affected dialogue, sequence and level tests and the production build. Verify the channel data, generated placements and runtime routing pass together.

### Playtest observations

The scratch browser played the Halcyon recording at the dock grille. The test advanced past the checkpoint exchanges to exercise the authored Commons walk. Jay passed the corridor box during the notice, with its position fixed from first word to last. Giles measured about 8 dB above the PA during that scene. In the gallery, Heins also measured about 8 dB above the lockdown announcement. These figures compare the active portions of the individual voices at the voice output.

The repeat selected the sample-store box in Dive Bay and the summons selected the director's office box in Admin. Each retained its source as Jay crossed into the adjoining room. Tasks 3.1 and 3.2 were closed at the user's direction based on the available playtest results. Stereo headphone listening remains unverified.
