/** The station blackout and the R11 power bay. Part of the sound registry (./index.ts). */

export const samples = {
  // The station blackout (station-power spec; ElevenLabs, scripts/ambience-generate.ts). Recorded only, no procedural fallback.
  lockdownAlarm: 'assets/audio/ambience/oneshot-lockdown-alarm.mp3',
  powerDown: 'assets/audio/ambience/oneshot-power-down.mp3',
  backupHum: 'assets/audio/ambience/emitter-backup-hum.mp3',
  // R11 Power Bay (detail-r11-power-bay / r11-power-bay-narrative): switchgear breaker throw, phased generator rumbles, and hum loop.
  breakerClunk: 'assets/audio/ambience/oneshot-breaker-clunk.mp3',
  generatorHum: 'assets/audio/ambience/emitter-generator-hum.mp3',
  generatorPhase1: 'assets/audio/ambience/oneshot-generator-phase-1.mp3',
  generatorPhase2: 'assets/audio/ambience/oneshot-generator-phase-2.mp3',
  generatorPhase3: 'assets/audio/ambience/oneshot-generator-phase-3.mp3',
  heavyBulkheadOpen: 'assets/audio/ambience/oneshot-heavy-bulkhead-open.mp3',
  powerBayHum: 'assets/audio/ambience/emitter-power-bay-hum.mp3',
} as const satisfies Record<string, string | readonly string[]>;
