/** The dock checkpoint, the dive bay launch hall and the supply sub. Part of the sound registry (./index.ts). */

export const samples = {
  // Dock checkpoint (dock-checkpoint spec): the walk-through arch and the guard's hand wand. Generate with
  // `npm run ambience:generate -- --id archPass` (and archAlarm, wandBeep, which is also cut by hand: see the manifest).
  archPass: 'assets/audio/ambience/oneshot-arch-pass.mp3',
  archAlarm: 'assets/audio/ambience/oneshot-arch-alarm.mp3',
  wandBeep: 'assets/audio/ambience/oneshot-wand-beep.mp3',
  // Dive bay launch hall (rebuild-dive-bay): `npm run ambience:generate -- --id <name>` for each. Until a file exists
  // the `launch_bay` bed falls back to the procedural water rumble and the trunk / leak one-shots stay silent.
  ambLaunchBay: 'assets/audio/ambience/bed-launch-bay.mp3',
  winchClunk: 'assets/audio/ambience/oneshot-winch-clunk.mp3',
  trunkChirp: 'assets/audio/ambience/oneshot-trunk-chirp.mp3',
  trunkHatch: 'assets/audio/ambience/oneshot-trunk-hatch.mp3',
  trunkVent: 'assets/audio/ambience/oneshot-trunk-vent.mp3',
  // Supply sub docking (intro-sequence spec, fix-supply-sub-docking): muffled underwater ElevenLabs SFX.
  subPass: 'assets/audio/ambience/oneshot-sub-pass.mp3',
  subClamp: 'assets/audio/ambience/oneshot-sub-clamp.mp3',
} as const satisfies Record<string, string | readonly string[]>;
