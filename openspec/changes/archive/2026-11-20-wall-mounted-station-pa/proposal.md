# Wall-mounted station PA

## Why

The Halcyon docking announcement and the quarantine notice sound centred in the player's head. On the walk to the Commons, the quarantine voice competes with Giles even though the crew are supposed to talk over a station broadcast.

## What Changes

- Give all four Station PA recordings a spatial loudspeaker treatment with distance falloff and a modest amount of room reverb.
- Add a reusable 3D wall speaker. Its grille marks the point the sound comes from.
- Place a speaker to one side of the dock window and one on the walk toward the Commons. Let the crew remain the easiest voices to follow during the quarantine notice.
- Cover the rounds repeat, gallery summons and lockdown. Each broadcast plays from one fixture for its duration, including when the player crosses a doorway.

## Capabilities

### New Capabilities

### Modified Capabilities

- `voice-playback` defines Station PA playback, source selection and the mix during overlapping conversation.
- `level-kit` defines the visible speaker fixture and its sound origin.
- `audio-mix` includes the station loudspeaker in the room reverb mix.

## Impact

Touches dialogue channel data and validation, Web Audio voice routing, scripted speech, the modular prop kit, and authored placements in the slice level generator. The existing voice recordings, subtitle events and scene timing serve all five announcement cues.
