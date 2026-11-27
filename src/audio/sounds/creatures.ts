/** Creature voices, gaits and movement. Part of the sound registry (./index.ts). */

export const samples = {
  // Zombie voices (Dragon Studio, see CREDITS.md). Variant order is [sound-2, call, sfx]; src/audio/zombieVoices.ts
  // plays them in turn and the boot splash uses ZOMBIE_SPLASH_VARIANT.
  zombieVoice: [
    'assets/audio/zombies/zombie-sound-2.mp3',
    'assets/audio/zombies/zombie-call.mp3',
    'assets/audio/zombies/zombie-sfx.mp3',
  ],
  // The Juggernaut's gait touchdowns (openspec juggernaut-walk-and-roar D8; ElevenLabs, scripts/footsteps-generate.ts).
  juggernautStep: [1, 2, 3, 4].map((i) => `assets/audio/footsteps/foot-juggernaut-step-${i}.mp3`),
  juggernautKnuckle: [1, 2, 3].map((i) => `assets/audio/footsteps/foot-juggernaut-knuckle-${i}.mp3`),
  // The Lab B creature's escape through the vents (trim-lab-wing-encounters; ElevenLabs, scripts/ambience-generate.ts).
  ventCoverRip: 'assets/audio/ambience/oneshot-vent-cover-rip.mp3',
  ventCoverBurst: 'assets/audio/ambience/oneshot-vent-cover-burst.mp3',
  ductBang: [1, 2, 3, 4].map((i) => `assets/audio/ambience/oneshot-duct-bang-${i}.mp3`),
  ductScrape: [1, 2].map((i) => `assets/audio/ambience/oneshot-duct-scrape-${i}.mp3`),
  creatureLand: [1, 2].map((i) => `assets/audio/ambience/oneshot-creature-land-${i}.mp3`),
  grateClatter: 'assets/audio/ambience/oneshot-grate-clatter.mp3',
} as const satisfies Record<string, string | readonly string[]>;

/** The `zombieVoice` clip the boot splash plays while the logo shambles in. */
export const ZOMBIE_SPLASH_VARIANT = 2;
