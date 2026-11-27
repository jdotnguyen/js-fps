/** The R15a departure bay, the transit ride and the R16 arrival. Part of the sound registry (./index.ts). */

export const samples = {
  // R15a Departure Bay & 3-stage abyssal transit ride (r15a-train-ride-narrative).
  trainDoorClose: 'assets/audio/ambience/oneshot-train-door-close.mp3',
  blastGateOpen: 'assets/audio/ambience/oneshot-blast-gate-open.mp3',
  blastGateClose: 'assets/audio/ambience/oneshot-blast-gate-close.mp3',
  trainPullout: 'assets/audio/ambience/oneshot-train-pullout.mp3',
  trainTunnelCruise: 'assets/audio/ambience/emitter-train-tunnel-cruise.mp3',
  trainBrakeStop: 'assets/audio/ambience/oneshot-train-brake-stop.mp3',
  trainCommsRing: 'assets/audio/ambience/oneshot-train-comms-ring.mp3',
  trainPowerDown: 'assets/audio/ambience/oneshot-train-power-down.mp3',
  r16HorrorHit: 'assets/audio/ambience/oneshot-r16-horror-hit.mp3',
  r16MonsterRoar: 'assets/audio/ambience/oneshot-r16-monster-roar-cctv.wav',
  r16MonsterRoarBlackout: 'assets/audio/ambience/oneshot-r16-monster-roar-blackout.mp3',
} as const satisfies Record<string, string | readonly string[]>;
