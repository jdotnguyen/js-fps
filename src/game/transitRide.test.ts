import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { PLAYER_TUNING } from '../actors/player.ts';
import { GLIDE_START_SPEED, RIG_GATE_FINAL_Z, TRAIN_RIDE_HEIGHT } from '../world/kit/transitCommon.ts';
import { TransitRideController } from './transitRide.ts';

test('TransitRideController runs 3-stage hybrid ride, carries player, and resets cleanly', () => {
  const events = new EventBus();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  for (const ev of ['transit:blast_gate', 'transit:train_door', 'transit:tunnel_scroll', 'transit:ride_state', 'transit:car_motion', 'transit:rig_gate', 'render:warm'] as const) {
    events.on(ev as never, (payload) => emitted.push({ event: ev, payload }));
  }

  const props = new Map<string, { pos: { x: number; y: number; z: number }; yaw: number }>([
    ['r15a_train', { pos: { x: 48, y: 0, z: 38 }, yaw: Math.PI }],
    ['r16a_train', { pos: { x: 88, y: -0.6, z: 35 }, yaw: Math.PI }],
  ]);
  const player = {
    body: { x: 48, y: 0.08 + TRAIN_RIDE_HEIGHT, z: 38, vy: 0, grounded: true },
    yaw: Math.PI,
    pitch: 0,
    placeAtEye(eye: THREE.Vector3, yaw: number, pitch = 0) {
      this.body.x = eye.x;
      this.body.y = eye.y - PLAYER_TUNING.eyeHeight;
      this.body.z = eye.z;
      this.yaw = yaw;
      this.pitch = pitch;
    },
    applyCamera() {},
  };

  const makeMate = (id: string, z: number) => ({
    id,
    motor: { x: 48, y: 0.08 + TRAIN_RIDE_HEIGHT, z },
    body: { group: { position: new THREE.Vector3(48, 0.08 + TRAIN_RIDE_HEIGHT, z) } },
    rideLocked: false,
    place(p: { x: number; y: number; z: number }) {
      this.motor.x = p.x;
      this.motor.y = p.y;
      this.motor.z = p.z;
      this.body.group.position.set(p.x, p.y, p.z);
    },
  });
  const squad = { mates: [makeMate('engineer', 36.5), makeMate('medic', 36.0)] };

  const ctrl = new TransitRideController({
    events,
    level: {
      propState: (id) => props.get(id) ?? null,
      setPropTransform: (id, pos, yaw) => {
        props.set(id, { pos: { ...pos }, yaw });
        return true;
      },
      anchor: () => null,
    },
    player,
    squad,
  });

  ctrl.start(2.0);
  assert.equal(ctrl.currentStage, 'gate_open');
  assert.equal(squad.mates[0]!.rideLocked, true, 'squad locked to cabin during ride');
  // Gate lead (1.6 s) -> pullout (3.8 s)
  for (let i = 0; i < 20; i++) ctrl.update(0.1);
  assert.equal(ctrl.currentStage, 'pullout');

  for (let i = 0; i < 40; i++) ctrl.update(0.1);
  assert.equal(ctrl.currentStage, 'sea_tunnel');
  assert.equal(props.get('r15a_train')!.pos.z, 52, 'Train Car A pulled out +14 m south');
  assert.equal(player.body.x, 128, 'player handed off seamlessly to Stage 2 tunnel cabin');
  assert.equal(player.body.z, 40);
  assert.equal(squad.mates[0]!.motor.x, 128, 'Giles handed off to Stage 2 tunnel cabin');

  // Sea tunnel (2.0 s) -> arrival (6.2 s)
  for (let i = 0; i < 26; i++) ctrl.update(0.1);
  assert.equal(ctrl.currentStage, 'arrival');
  assert.equal(player.body.x, 88, 'player handed off to Stage 3 R16a train cabin');
  assert.ok(Math.abs(player.body.y - (-0.52 + TRAIN_RIDE_HEIGHT)) < 0.05, 'player y matches the lifted R16a car floor');
  assert.ok(Math.abs(squad.mates[0]!.motor.y - (-0.6 + 0.08 + TRAIN_RIDE_HEIGHT)) < 0.05, 'squad stands on the lifted car floor');

  for (let i = 0; i < 95; i++) ctrl.update(0.1);
  assert.equal(ctrl.currentStage, 'arrived');
  assert.equal(props.get('r16a_train')!.pos.z, 35, 'Train Car B docked at R16a z=35');
  assert.equal(player.body.z, 35, 'player carried smoothly to R16a dock');
  assert.equal(squad.mates[0]!.rideLocked, false, 'squad released on arrival');
  // The arrival door stays closed: nothing opens Train Car B's door until a script emits `transit:train_door`.
  const doorEvents = emitted.filter((e) => e.event === 'transit:train_door').map((e) => e.payload as { carId: string; open: boolean });
  assert.equal(doorEvents.some((e) => e.carId === 'r16a_train' && e.open), false, 'Train Car B\'s door stays closed on arrival');
  assert.ok(doorEvents.some((e) => e.carId === 'r16a_train' && !e.open), 'it was sealed at the hand-off');
  const closedAtArrival = doorEvents.length;
  for (let i = 0; i < 20; i++) ctrl.update(0.1);
  assert.equal(emitted.filter((e) => e.event === 'transit:train_door').length, closedAtArrival, 'no door event follows the arrival');

  // Reset restores both train props and idle state.
  events.emit('level:reset' as never, {} as never);
  assert.equal(ctrl.currentStage, 'idle');
  assert.equal(props.get('r15a_train')!.pos.z, 38);
  assert.equal(props.get('r16a_train')!.pos.z, 35);
  assert.ok(emitted.some((e) => e.event === 'transit:blast_gate'));
  assert.ok(emitted.some((e) => e.event === 'transit:train_door'));
  assert.ok(emitted.some((e) => e.event === 'transit:tunnel_scroll'));

  // Stage 2 starts at Stage 1's exit speed, ramps smoothly to cruise (20 m/s), then slows smoothly to Stage 3's start speed.
  const scroll = emitted.filter((e) => e.event === 'transit:tunnel_scroll').map((e) => e.payload as { active: boolean; speed?: number });
  const ramp = scroll.filter((e) => e.active && typeof e.speed === 'number').map((e) => e.speed!);
  const pulloutEndSpeed = (2 * 14) / 3.8;
  assert.ok(ramp.length >= 15, 'the hallway scroll updates smoothly over many frames');
  assert.ok(Math.abs(ramp[0]! - pulloutEndSpeed) < 0.01, `Stage 2 starts at Stage 1 exit speed (${ramp[0]})`);
  const peakIdx = ramp.indexOf(Math.max(...ramp));
  assert.ok(peakIdx > 0 && peakIdx < ramp.length - 1, 'Stage 2 has distinct ramp-up and slow-down phases');
  assert.equal(ramp[peakIdx], 20, 'Stage 2 reaches cruise speed (20 m/s)');
  for (let i = 1; i <= peakIdx; i++) assert.ok(ramp[i]! >= ramp[i - 1]! - 1e-9, 'the ramp-up never slows down');
  for (let i = peakIdx + 1; i < ramp.length; i++) assert.ok(ramp[i]! <= ramp[i - 1]! + 1e-9, 'the slow-down never speeds up again');
  assert.ok(Math.abs(ramp[ramp.length - 1]! - GLIDE_START_SPEED) < 0.9, 'the slow-down ends at the Stage 3 start speed (' + ramp[ramp.length - 1] + ')');

  // The closed gate is driven analytically with wallZ and lands at RIG_GATE_FINAL_Z at hand-off before releasing.
  const rigGate = emitted.filter((e) => e.event === 'transit:rig_gate').map((e) => e.payload as { arm: boolean; wallZ?: number });
  const armed = rigGate.filter((g) => g.arm);
  assert.ok(armed.length >= 5, 'rig_gate receives analytical wallZ updates while armed');
  assert.ok(armed.every((g) => typeof g.wallZ === 'number'), 'armed rig_gate events include wallZ');
  for (let i = 1; i < armed.length; i++) assert.ok(armed[i]!.wallZ! <= armed[i - 1]!.wallZ! + 1e-9, 'rig_gate wallZ moves monotonically toward the car');
  assert.ok(Math.abs(armed[armed.length - 1]!.wallZ! - RIG_GATE_FINAL_Z) < 1e-6, `rig_gate lands exactly at RIG_GATE_FINAL_Z (${armed[armed.length - 1]!.wallZ})`);
  assert.equal(rigGate[rigGate.length - 1]!.arm, false, 'rig_gate is released at the hand-off');
  const r16 = emitted.filter((e) => e.event === 'transit:blast_gate' && (e.payload as { gateId: string }).gateId === 'r16a_north').map((e) => e.payload as { open: boolean; instant?: boolean });
  assert.ok(r16.length >= 2, 'R16a gate events');
  assert.deepEqual(r16[0], { gateId: 'r16a_north', open: true, seconds: 0.8 }, 'the R16a gate lifts quickly, animated, once R16a is rendered (not an instant swap)');

  // Headlight feed: the cars report speed and clear track ahead, and stop (beam off) when docked or reset.
  const motion = emitted.filter((e) => e.event === 'transit:car_motion').map((e) => e.payload as { carId: string; speed: number; clear: number });
  assert.ok(motion.some((e) => e.carId === 'r15a_train' && e.speed > 1), 'Train Car A reports its pull-out speed');
  assert.ok(motion.some((e) => e.carId === 'r15b_train' && e.speed === 20), 'the tunnel car reports the ride speed');
  const glide = motion.filter((e) => e.carId === 'r16a_train' && e.speed > 0);
  assert.ok(glide.length > 5, 'Train Car B reports its glide-in speed');
  assert.ok(glide[glide.length - 1]!.clear < glide[0]!.clear, 'clear track ahead of Train Car B shrinks as it nears the dock');
  assert.ok(glide.every((e) => e.clear <= 17.1), 'beam clearance never exceeds the free track ahead plus the dock margin');
  const lastB = motion.filter((e) => e.carId === 'r16a_train');
  assert.equal(lastB[lastB.length - 1]!.speed, 0, 'docked car and reset both report standstill');

  // Shader and texture warm-up: R15b warms at departure, R16a and R16b warm staggered during Stage 2 slow-down.
  const warmed = emitted.filter((e) => e.event === 'render:warm').map((e) => (e.payload as { room: string }).room);
  assert.deepEqual(warmed, ['R15b', 'R16a', 'R16b'], 'R15b, R16a and R16b are warmed ahead of their handoffs');
});
