# Dock guard routine

## Why

Jay can watch the guard for much of the opening. Between arrivals the guard holds the wand ready, and after the queue clears he stays in the same spot. Giving him a recognizable way of waiting and a job to return to makes the checkpoint feel staffed.

## What Changes

- Give the dock guard a relaxed wand-low stance and a visible response when someone approaches. Let his gaze and weight lead his reach during Ruiz's scan.
- After Giles clears the arch, have the guard walk to the security desk, put down the wand, pull the existing chair up to the keyboard, and sit facing the CCTV wall.
- Resolve the guard, wand and chair to that seated arrangement when the intro is skipped. Let him acknowledge Jay's later arch alarms from his seat.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dock-checkpoint` owns the guard's performance during arrivals, the return to the booth, and his position for subsequent alarms.

## Impact

Touches R01 staging, the intro and arch scripts, NPC motion selection, chair and wand handling, and their verification. Uses the shared cast skeleton and the motion profile work in `per-character-motion` for guard-specific overrides.
