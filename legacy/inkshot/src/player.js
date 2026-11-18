import * as THREE from 'three';
import { moveAndCollide } from './level.js';

export const PLAYER_R = 0.4;
export const PLAYER_H = 1.75;
const EYE = 1.6;
const WALK = 7;
const SPRINT = 10.5;
const JUMP = 8;
const GRAVITY = 24;
const MAX_PITCH = Math.PI / 2 - 0.05;

export class Player {
  constructor(camera) {
    this.camera = camera;
    camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(); // feet
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.sensitivity = 0.0022;
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 14);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.onGround = true;
    this.sync();
  }

  look(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * this.sensitivity));
  }

  update(dt, colliders) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * side;
    let wz = -cos * fwd - sin * side;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }

    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? SPRINT : WALK;
    const blend = Math.min(1, (this.onGround ? 14 : 4) * dt);
    this.vel.x += (wx * speed - this.vel.x) * blend;
    this.vel.z += (wz * speed - this.vel.z) * blend;

    if (this.onGround && k.has('Space')) {
      this.vel.y = JUMP;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    this.onGround = moveAndCollide(this.pos, this.vel, dt, PLAYER_R, PLAYER_H, colliders);
    this.sync();
  }

  sync() {
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
