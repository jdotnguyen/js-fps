/** The Commons: chairs, tables, kitchen, coffee and the conversation murmur. Part of the sound registry (./index.ts). */

export const samples = {
  // Commons room sounds (in-world-audio spec; CC0 cuts built by scripts/commons-sounds-generate.ts, see CREDITS.md).
  // Recorded only. The short clips are loudness-matched with a limiter; src/audio/commonsSounds.ts sets the level.
  chairScrape: [1, 2, 3, 4].map((i) => `assets/audio/ambience/oneshot-commons-chair-${i}.mp3`),
  tableClink: [1, 2, 3, 4, 5, 6].map((i) => `assets/audio/ambience/oneshot-commons-table-${i}.mp3`),
  kitchenClatter: [1, 2, 3, 4].map((i) => `assets/audio/ambience/oneshot-commons-kitchen-${i}.mp3`),
  coffeeBrew: [1, 2].map((i) => `assets/audio/ambience/oneshot-commons-coffee-${i}.mp3`),
  // Commons conversation murmur (in-world-audio spec; ElevenLabs, scripts/ambience-generate.ts). Recorded only.
  murmurA: 'assets/audio/ambience/emitter-murmur-a.mp3',
  murmurB: 'assets/audio/ambience/emitter-murmur-b.mp3',
  murmurC: 'assets/audio/ambience/emitter-murmur-c.mp3',
} as const satisfies Record<string, string | readonly string[]>;
