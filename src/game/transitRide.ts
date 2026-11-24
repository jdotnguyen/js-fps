import * as THREE from 'three';
import type { EventBus, EventName } from '../core/events.ts';
import { PLAYER_TUNING } from '../actors/player.ts';
import { GLIDE_START_SPEED, RIG_GATE_FINAL_Z, RIG_GATE_START_Z, TRAIN_RIDE_HEIGHT } from '../world/kit/transitCommon.ts';

export type RideStage = 'idle' | 'gate_open' | 'pullout' | 'sea_tunnel' | 'arrival' | 'arrived';

export interface TransitRideLevel {
  propState(id: string): { pos: { x: number; y: number; z: number }; yaw: number } | null;
  setPropTransform(id: string, pos: { x: number; y: number; z: number }, yaw: number): boolean;
  anchor(id: string): { pos: { x: number; y: number; z: number }; yaw: number } | null;
}

export interface TransitRidePlayer {
  body: { x: number; y: number; z: number; vy: number; grounded: boolean };
  yaw: number;
  pitch: number;
  placeAtEye(eye: THREE.Vector3, yaw: number, pitch?: number): void;
  applyCamera(dt: number): void;
}

export interface TransitRideMate {
  id: string;
  motor: { x: number; y: number; z: number };
  body: { group: { position: THREE.Vector3 } };
  scripted: boolean;
  place(p: { x: number; y: number; z: number }, heading: number): void;
}

export interface TransitRideDeps {
  events: EventBus;
  level: TransitRideLevel;
  player: TransitRidePlayer;
  squad?: { mates: readonly TransitRideMate[] } | null;
}

const R15A_TRAIN_START = { x: 48, y: 0, z: 38 };
const R15A_PULLOUT_DIST = 14; // 38 -> 52 (+Z south through r15a_south at z=45.875; the tail clears the gate at 51.1)
const R15B_TRAIN_POS = { x: 128, y: 0, z: 40 };
const R16A_TRAIN_PARK = { x: 88, y: -0.6, z: 35 };
const R16A_GLIDE_DIST = 15; // 20 -> 35 (+Z south through r16a_north at z=30.125)

const GATE_LEAD_SECONDS = 1.6;
const PULLOUT_SECONDS = 3.8;
const DEFAULT_TUNNEL_SECONDS = 8.0;
const ARRIVAL_SECONDS = 9.0; // 3 * 15 m / 9 s = 5 m/s at the start (GLIDE_START_SPEED)
/** Extra free track the headlight beam may use past the dock before it would meet the R16a south wall (m). */
const DOCK_BEAM_MARGIN = 2.0;
const TUNNEL_SPEED = 20;
/** Stage 2 never runs shorter than this, so the slow-down and the gate's approach always fit. */
const MIN_TUNNEL_SECONDS = 3;
/** The Stage 2 slow-down (linear, ending at the Stage 3 start speed) lasts at most this long. */
const MAX_DECEL_SECONDS = 4;
/** The R16a gate starts to lift this long after the hand-off, once R16a is rendered. */
const R16_GATE_DELAY = 0.1;
/** The R16a gate lifts this fast: fully open well before the nose (about 1.5 s after the hand-off) reaches it. */
const R16_GATE_OPEN_SECONDS = 0.8;

/**
 * Coordinates the 3-stage hybrid abyssal transit ride:
 * 1) R15a south blast gate opens -> Train Car A pulls out ~17 m south through the portal.
 * 2) Seamless handoff to isolated R15b infinite-scrolling windowed glass sea-tunnel.
 * 3) Seamless handoff to Train Car B gliding ~15 m south through R16a north blast gate into R16a.
 */
export class TransitRideController {
  private readonly d: TransitRideDeps;
  private stage: RideStage = 'idle';
  private elapsed = 0;
  private tunnelSeconds = DEFAULT_TUNNEL_SECONDS;
  private trainZ = R15A_TRAIN_START.z;
  private rigGateArmed = false;
  private r16GateOpened = false;
  private readonly offStart: () => void;
  private readonly offReset: () => void;

  constructor(d: TransitRideDeps) {
    this.d = d;
    this.offStart = d.events.on('transit:start_ride' as EventName, (payload) => {
      const rec = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const secs = typeof rec['tunnelSeconds'] === 'number' && rec['tunnelSeconds'] > 0 ? rec['tunnelSeconds'] : DEFAULT_TUNNEL_SECONDS;
      this.start(secs);
    });
    this.offReset = d.events.on('level:reset' as EventName, () => this.reset());
  }

  get currentStage(): RideStage {
    return this.stage;
  }

  start(tunnelSeconds = DEFAULT_TUNNEL_SECONDS): void {
    if (this.stage !== 'idle' && this.stage !== 'arrived') return;
    this.tunnelSeconds = Math.max(MIN_TUNNEL_SECONDS, tunnelSeconds);
    this.rigGateArmed = false;
    this.r16GateOpened = false;
    this.elapsed = 0;
    this.trainZ = R15A_TRAIN_START.z;
    this.lockMatesInCabin(R15A_TRAIN_START);
    this.setStage('gate_open');
    this.emit('transit:blast_gate', { gateId: 'r15a_south', open: true });
    this.emit('transit:train_door', { carId: 'r15a_train', open: false });
  }

  reset(): void {
    this.stage = 'idle';
    this.elapsed = 0;
    this.trainZ = R15A_TRAIN_START.z;
    this.releaseMates();
    this.d.level.setPropTransform('r15a_train', R15A_TRAIN_START, Math.PI);
    this.d.level.setPropTransform('r16a_train', R16A_TRAIN_PARK, Math.PI);
    this.emit('transit:tunnel_scroll', { active: false });
    this.emit('transit:rig_gate', { arm: false });
    this.rigGateArmed = false;
    this.r16GateOpened = false;
    for (const carId of ['r15a_train', 'r15b_train', 'r16a_train']) this.emit('transit:car_motion', { carId, speed: 0, clear: 8 });
    this.emit('transit:ride_state', { stage: 'idle' });
  }

  update(dt: number): void {
    if (this.stage === 'idle' || this.stage === 'arrived' || dt <= 0) return;
    this.elapsed += dt;

    if (this.stage === 'gate_open') {
      if (this.elapsed >= GATE_LEAD_SECONDS) {
        this.elapsed = 0;
        this.trainZ = R15A_TRAIN_START.z;
        this.setStage('pullout');
      }
      return;
    }

    if (this.stage === 'pullout') {
      const u = Math.min(1, this.elapsed / PULLOUT_SECONDS);
      const nextZ = R15A_TRAIN_START.z + R15A_PULLOUT_DIST * (u * u);
      const dz = nextZ - this.trainZ;
      this.trainZ = nextZ;
      this.d.level.setPropTransform('r15a_train', { x: R15A_TRAIN_START.x, y: R15A_TRAIN_START.y, z: nextZ }, Math.PI);
      this.carryPlayerZ(dz);
      this.emit('transit:car_motion', { carId: 'r15a_train', speed: dz / dt, clear: 8 });
      if (u >= 1) {
        this.emit('transit:car_motion', { carId: 'r15a_train', speed: 0, clear: 8 });
        this.handoffToCabin(
          { x: R15A_TRAIN_START.x, y: R15A_TRAIN_START.y, z: nextZ },
          R15B_TRAIN_POS,
        );
        this.elapsed = 0;
        this.setStage('sea_tunnel');
        this.emit('transit:train_door', { carId: 'r15b_train', open: false, instant: true });
        this.emit('transit:tunnel_scroll', { active: true, speed: TUNNEL_SPEED });
        this.emit('transit:car_motion', { carId: 'r15b_train', speed: TUNNEL_SPEED, clear: 8 });
      }
      return;
    }

    if (this.stage === 'sea_tunnel') {
      // Slow the hallway down early (design Decision 15): cruise, then a linear slow-down that ends exactly at the Stage 3
      // start speed, with the closed gate approaching so that it arrives where R16a's gate will be.
      const total = this.tunnelSeconds;
      const decel = Math.min(MAX_DECEL_SECONDS, total * 0.6);
      const e = Math.min(this.elapsed, total);
      const inDecel = e >= total - decel;
      const slope = (TUNNEL_SPEED - GLIDE_START_SPEED) / decel;
      const left = total - e;
      const speed = inDecel ? GLIDE_START_SPEED + slope * left : TUNNEL_SPEED;
      if (inDecel) {
        this.emit('transit:tunnel_scroll', { active: true, speed });
        this.emit('transit:car_motion', { carId: 'r15b_train', speed, clear: 8 });
      }
      if (!this.rigGateArmed) {
        // Distance the hallway still has to travel; arm the gate when it equals the gate's own travel.
        const remaining = inDecel
          ? GLIDE_START_SPEED * left + 0.5 * slope * left * left
          : GLIDE_START_SPEED * decel + 0.5 * slope * decel * decel + TUNNEL_SPEED * (total - decel - e);
        if (remaining <= RIG_GATE_START_Z - RIG_GATE_FINAL_Z) {
          this.rigGateArmed = true;
          this.emit('transit:rig_gate', { arm: true });
        }
      }
      if (this.elapsed >= this.tunnelSeconds) {
        const startZ = R16A_TRAIN_PARK.z - R16A_GLIDE_DIST;
        this.d.level.setPropTransform('r16a_train', { x: R16A_TRAIN_PARK.x, y: R16A_TRAIN_PARK.y, z: startZ }, Math.PI);
        // R16a's gate is still closed here, exactly where the rig's gate stopped; it lifts once R16a is rendered.
        this.emit('transit:rig_gate', { arm: false });
        this.rigGateArmed = false;
        this.emit('transit:train_door', { carId: 'r16a_train', open: false, instant: true });
        this.emit('transit:tunnel_scroll', { active: false });
        this.emit('transit:car_motion', { carId: 'r15b_train', speed: 0, clear: 8 });
        this.handoffToCabin(
          R15B_TRAIN_POS,
          { x: R16A_TRAIN_PARK.x, y: R16A_TRAIN_PARK.y, z: startZ },
        );
        this.trainZ = startZ;
        this.elapsed = 0;
        this.setStage('arrival');
      }
      return;
    }

    if (this.stage === 'arrival') {
      if (!this.r16GateOpened && this.elapsed >= R16_GATE_DELAY) {
        this.r16GateOpened = true;
        this.emit('transit:blast_gate', { gateId: 'r16a_north', open: true, seconds: R16_GATE_OPEN_SECONDS });
      }
      const u = Math.min(1, this.elapsed / ARRIVAL_SECONDS);
      const ease = 1 - (1 - u) ** 3;
      const nextZ = R16A_TRAIN_PARK.z - R16A_GLIDE_DIST + R16A_GLIDE_DIST * ease;
      const dz = nextZ - this.trainZ;
      this.trainZ = nextZ;
      this.d.level.setPropTransform('r16a_train', { x: R16A_TRAIN_PARK.x, y: R16A_TRAIN_PARK.y, z: nextZ }, Math.PI);
      this.carryPlayerZ(dz);
      this.emit('transit:car_motion', { carId: 'r16a_train', speed: dz / dt, clear: R16A_TRAIN_PARK.z - nextZ + DOCK_BEAM_MARGIN });
      if (u >= 1) {
        this.emit('transit:car_motion', { carId: 'r16a_train', speed: 0, clear: DOCK_BEAM_MARGIN });
        this.releaseMates();
        this.emit('transit:train_door', { carId: 'r16a_train', open: true });
        this.emit('transit:blast_gate', { gateId: 'r16a_north', open: false });
        this.setStage('arrived');
      }
    }
  }

  dispose(): void {
    this.offStart();
    this.offReset();
  }

  private setStage(stage: RideStage): void {
    this.stage = stage;
    this.emit('transit:ride_state', { stage });
  }

  private carryPlayerZ(dz: number): void {
    if (dz === 0) return;
    this.d.player.body.z += dz;
    this.d.player.applyCamera(0);
    for (const m of this.d.squad?.mates ?? []) {
      m.motor.z += dz;
      m.body.group.position.z += dz;
    }
  }

  private handoffToCabin(fromOrigin: { x: number; y: number; z: number }, toOrigin: { x: number; y: number; z: number }): void {
    const { player } = this.d;
    const dx = Math.max(-0.85, Math.min(0.85, player.body.x - fromOrigin.x));
    const dy = Math.max(TRAIN_RIDE_HEIGHT + 0.04, Math.min(TRAIN_RIDE_HEIGHT + 0.25, player.body.y - fromOrigin.y));
    const dz = Math.max(-3.6, Math.min(3.6, player.body.z - fromOrigin.z));
    player.placeAtEye(
      new THREE.Vector3(toOrigin.x + dx, toOrigin.y + dy + PLAYER_TUNING.eyeHeight, toOrigin.z + dz),
      player.yaw,
      player.pitch,
    );
    for (const m of this.d.squad?.mates ?? []) {
      const mdx = Math.max(-0.8, Math.min(0.8, m.motor.x - fromOrigin.x));
      const mdz = Math.max(-3.4, Math.min(3.4, m.motor.z - fromOrigin.z));
      m.place({ x: toOrigin.x + mdx, y: toOrigin.y + TRAIN_RIDE_HEIGHT + 0.08, z: toOrigin.z + mdz }, Math.PI);
    }
  }

  private lockMatesInCabin(origin: { x: number; y: number; z: number }): void {
    const mates = this.d.squad?.mates ?? [];
    for (let i = 0; i < mates.length; i++) {
      const m = mates[i]!;
      m.scripted = true;
      const inCabin = Math.abs(m.motor.x - origin.x) < 1.3 && Math.abs(m.motor.z - origin.z) < 4.5;
      if (!inCabin) {
        const sx = i % 2 === 0 ? -0.55 : 0.55;
        const sz = i % 2 === 0 ? -1.8 : -2.2;
        m.place({ x: origin.x + sx, y: origin.y + TRAIN_RIDE_HEIGHT + 0.08, z: origin.z + sz }, Math.PI);
      }
    }
  }

  private releaseMates(): void {
    for (const m of this.d.squad?.mates ?? []) {
      m.scripted = false;
    }
  }

  private emit(name: string, payload: Record<string, unknown>): void {
    this.d.events.emit(name as EventName, payload as never);
  }
}
