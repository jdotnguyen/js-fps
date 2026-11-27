/** Door motion and access feedback. Part of the sound registry (./index.ts). */

export const samples = {
  // Door motion and access feedback (ElevenLabs, scripts/doors-generate.ts).
  doorPressureOpen: 'assets/audio/doors/door-pressure-open.mp3',
  doorPressureClose: 'assets/audio/doors/door-pressure-close.mp3',
  doorGlassOpen: 'assets/audio/doors/door-glass-open.mp3',
  doorGlassClose: 'assets/audio/doors/door-glass-close.mp3',
  doorBulkheadOpen: 'assets/audio/doors/door-bulkhead-open.mp3',
  doorBulkheadClose: 'assets/audio/doors/door-bulkhead-close.mp3',
  doorDenied: 'assets/audio/doors/door-denied.mp3',
  doorUnlocked: 'assets/audio/doors/door-unlocked.mp3',
} as const satisfies Record<string, string | readonly string[]>;
