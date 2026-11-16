import * as THREE from 'three';
import { toonBox, toonMat, boxGeo } from './toon.js';

const DARK = 0x2b2d42;

const TYPES = {
  grunt: { hp: 40, speed: 4.6, r: 0.55, scale: 1, color: 0xe4572e, melee: 10, score: 100 },
  shooter: { hp: 30, speed: 3.4, r: 0.55, scale: 1, color: 0x9b5de5, melee: 0, score: 150, range: 18 },
  brute: { hp: 170, speed: 2.7, r: 0.9, scale: 1.6, color: 0x2a9d8f, melee: 25, score: 400 },
};

const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfff7d6 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x16141f });
const shotGeo = new THREE.SphereGeometry(0.22, 10, 8);
const shotMat = new THREE.MeshBasicMaterial({ color: 0xff3d8b });
const SHOT_SPEED = 15;
const MAX_ALIVE = 22;

class Enemy {
  constructor(kind, x, z, hpScale) {
    const T = TYPES[kind];
    this.kind = kind;
    this.T = T;
    this.hp = T.hp * hpScale;
    this.pos = new THREE.Vector3(x, 0, z);
    this.dead = false;
    this.flashT = 0;
    this.attackT = 0.6;
    this.fireT = 1 + Math.random() * 1.5;
    this.avoidT = 0;
    this.avoidSide = 1;
    this.strafeSide = Math.random() < 0.5 ? -1 : 1;
    this.walkT = Math.random() * 6;

    // Unique body material so each enemy can flash white on its own.
    this.mat = toonMat(T.color, true);
    const g = (this.group = new THREE.Group());
    const part = (w, h, d, mat, px, py, pz) => {
      const m = toonBox(w, h, d, mat, { outline: 0.03 });
      m.position.set(px, py, pz);
      m.userData.enemy = this;
      g.add(m);
      return m;
    };

    this.body = part(0.85, 0.9, 0.55, this.mat, 0, 1.0, 0);
    this.head = part(0.6, 0.55, 0.55, this.mat, 0, 1.78, 0);
    this.head.userData.head = true;
    this.armL = part(0.22, 0.75, 0.22, DARK, -0.56, 1.05, 0);
    this.armR = part(0.22, 0.75, 0.22, DARK, 0.56, 1.05, 0);
    this.legL = part(0.28, 0.55, 0.3, DARK, -0.22, 0.275, 0);
    this.legR = part(0.28, 0.55, 0.3, DARK, 0.22, 0.275, 0);
    this.hitMeshes = [this.body, this.head, this.armL, this.armR, this.legL, this.legR];

    for (const sx of [-0.15, 0.15]) {
      const eye = new THREE.Mesh(boxGeo(0.16, 0.16, 0.04), eyeMat);
      eye.position.set(sx, 1.82, 0.29);
      const pupil = new THREE.Mesh(boxGeo(0.07, 0.07, 0.04), pupilMat);
      pupil.position.set(sx, 1.8, 0.31);
      g.add(eye, pupil);
    }

    if (kind === 'shooter') {
      const antenna = toonBox(0.08, 0.34, 0.08, DARK, { outline: 0.02 });
      antenna.position.set(0, 2.2, 0);
      const bulb = new THREE.Mesh(boxGeo(0.16, 0.16, 0.16), shotMat);
      bulb.position.set(0, 2.42, 0);
      g.add(antenna, bulb);
    } else if (kind === 'brute') {
      for (const sx of [-0.26, 0.26]) {
        const horn = toonBox(0.12, 0.3, 0.12, 0xfff7d6, { outline: 0.02 });
        horn.position.set(sx, 2.18, 0);
        g.add(horn);
      }
    }

    g.scale.setScalar(T.scale);
    g.position.copy(this.pos);
  }
}

function waveRoster(n) {
  const total = 4 + n * 2;
  const roster = [];
  let brutes = 0;
  for (let i = 0; i < total; i++) {
    const roll = Math.random();
    if (n >= 3 && roll < 0.12 && brutes < 1 + Math.floor(n / 4)) {
      roster.push('brute');
      brutes++;
    } else if (n >= 2 && roll < 0.4) {
      roster.push('shooter');
    } else {
      roster.push('grunt');
    }
  }
  return roster;
}

export class EnemyManager {
  constructor(scene, level, effects) {
    this.scene = scene;
    this.level = level;
    this.effects = effects;
    this.enemies = [];
    this.shots = [];
    this.pickups = [];
    this.rayTargets = level.solids.slice();
    this.tmp = new THREE.Vector3();
    this.reset();
  }

  reset() {
    for (const e of this.enemies) this.dispose(e);
    for (const s of this.shots) this.scene.remove(s.mesh);
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.enemies.length = 0;
    this.shots.length = 0;
    this.pickups.length = 0;
    this.queue = [];
    this.wave = 0;
    this.active = false;
    this.breakT = 1.2;
    this.spawnT = 0;
    this.refreshTargets();
  }

  dispose(e) {
    this.scene.remove(e.group);
    e.mat.dispose();
  }

  refreshTargets() {
    this.rayTargets = this.level.solids.slice();
    for (const e of this.enemies) this.rayTargets.push(...e.hitMeshes);
  }

  startWave(game) {
    this.wave++;
    this.queue = waveRoster(this.wave);
    this.active = true;
    this.spawnT = 0.8;
    game.onWaveStart(this.wave);
  }

  spawn(kind, playerPos) {
    const far = this.level.spawns.filter(([x, z]) => Math.hypot(x - playerPos.x, z - playerPos.z) > 14);
    const pool = far.length ? far : this.level.spawns;
    const [sx, sz] = pool[Math.floor(Math.random() * pool.length)];
    const e = new Enemy(
      kind,
      sx + (Math.random() - 0.5) * 3,
      sz + (Math.random() - 0.5) * 3,
      1 + 0.06 * (this.wave - 1),
    );
    this.scene.add(e.group);
    this.enemies.push(e);
    this.refreshTargets();
    this.effects.burst(this.tmp.set(e.pos.x, 1, e.pos.z), 0xffffff, 8, 4);
  }

  /** Returns true if this hit killed the enemy. */
  damage(e, amount, point, game) {
    if (e.dead) return false;
    e.hp -= amount;
    e.flashT = 0.08;
    e.mat.emissive.setHex(0xffffff);
    this.effects.burst(point, e.T.color, 3, 3.5);
    if (e.hp > 0) return false;

    e.dead = true;
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.dispose(e);
    this.refreshTargets();
    this.effects.burst(this.tmp.set(e.pos.x, e.pos.y + e.T.scale, e.pos.z), e.T.color, 16, 7);
    this.effects.burst(this.tmp, DARK, 6, 5);
    game.addScore(e.T.score);
    game.sfx.kill();
    if (e.kind === 'brute' || Math.random() < 0.16) this.dropPickup(e.pos);
    return true;
  }

  dropPickup(pos) {
    const mesh = toonBox(0.5, 0.5, 0.5, 0x4ade80, { outline: 0.04 });
    const cross = new THREE.Mesh(boxGeo(0.52, 0.16, 0.16), eyeMat);
    const cross2 = new THREE.Mesh(boxGeo(0.16, 0.52, 0.16), eyeMat);
    mesh.add(cross, cross2);
    mesh.position.set(pos.x, pos.y + 0.7, pos.z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, baseY: pos.y + 0.7, life: 16, t: 0 });
  }

  update(dt, game) {
    const player = game.player;

    // --- wave flow ---
    if (this.queue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.enemies.length < MAX_ALIVE) {
        this.spawn(this.queue.pop(), player.pos);
        this.spawnT = Math.max(0.35, 1.1 - this.wave * 0.05);
      }
    } else if (!this.enemies.length) {
      if (this.active) {
        this.active = false;
        this.breakT = 3.5;
        game.onWaveCleared(this.wave);
      }
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave(game);
    }

    for (const e of this.enemies) this.updateEnemy(e, dt, game);
    this.separate();
    for (const e of this.enemies) e.group.position.copy(e.pos);

    this.updateShots(dt, game);
    this.updatePickups(dt, game);
  }

  updateEnemy(e, dt, game) {
    const player = game.player;
    const T = e.T;
    const dx = player.pos.x - e.pos.x;
    const dz = player.pos.z - e.pos.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const nx = dx / dist;
    const nz = dz / dist;

    // Decide where to walk.
    let mx = nx;
    let mz = nz;
    let moving = true;
    if (e.kind === 'shooter') {
      if (dist < T.range * 0.45) {
        mx = -nx; mz = -nz; // back off
      } else if (dist < T.range * 0.85) {
        mx = -nz * e.strafeSide; mz = nx * e.strafeSide; // circle
      }
    } else if (dist < T.r + 0.5) {
      moving = false;
    }
    if (e.avoidT > 0) {
      e.avoidT -= dt;
      const ax = -mz * e.avoidSide * 0.9 + mx * 0.35;
      const az = mx * e.avoidSide * 0.9 + mz * 0.35;
      const al = Math.hypot(ax, az) || 1;
      mx = ax / al;
      mz = az / al;
    }

    if (moving) {
      const step = T.speed * dt;
      const ox = e.pos.x;
      const oz = e.pos.z;
      this.slide(e, mx * step, mz * step);
      const moved = Math.hypot(e.pos.x - ox, e.pos.z - oz);
      if (moved < step * 0.35 && e.avoidT <= 0) {
        // Stuck on something: sidestep for a moment.
        e.avoidT = 0.5 + Math.random() * 0.5;
        e.avoidSide = Math.random() < 0.5 ? -1 : 1;
        if (e.kind === 'shooter') e.strafeSide *= -1;
      }
      e.walkT += dt * T.speed * 2.2;
    }

    // Hop onto low blocks.
    let ground = 0;
    for (const b of this.level.low) {
      if (e.pos.x > b.min.x && e.pos.x < b.max.x && e.pos.z > b.min.z && e.pos.z < b.max.z) {
        ground = Math.max(ground, b.max.y);
      }
    }
    e.pos.y += (ground - e.pos.y) * Math.min(1, 12 * dt);

    // Pose.
    e.group.rotation.y = Math.atan2(dx, dz);
    const swing = Math.sin(e.walkT) * 0.6;
    e.legL.rotation.x = swing;
    e.legR.rotation.x = -swing;
    if (e.kind === 'shooter') {
      e.armL.rotation.x = -swing * 0.5;
      e.armR.rotation.x = -1.4;
    } else {
      e.armL.rotation.x = -1.3 + swing * 0.3;
      e.armR.rotation.x = -1.3 - swing * 0.3;
    }
    e.body.position.y = 1.0 + Math.abs(Math.sin(e.walkT)) * 0.05;

    if (e.flashT > 0) {
      e.flashT -= dt;
      if (e.flashT <= 0) e.mat.emissive.setHex(0x000000);
    }

    // Attacks.
    e.attackT -= dt;
    if (T.melee && dist < T.r + 1.0 && Math.abs(player.pos.y - e.pos.y) < 1.9 && e.attackT <= 0) {
      e.attackT = 0.9;
      game.damagePlayer(T.melee);
    }
    if (e.kind === 'shooter') {
      e.fireT -= dt;
      if (e.fireT <= 0 && dist < T.range * 1.2) {
        e.fireT = 1.6 + Math.random() * 0.8;
        this.fireShot(e, player, game);
      }
    }
  }

  slide(e, dx, dz) {
    const r = e.T.r;
    const p = e.pos;
    p.x += dx;
    for (const b of this.level.tall) {
      if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z) {
        p.x = dx > 0 ? b.min.x - r : b.max.x + r;
      }
    }
    p.z += dz;
    for (const b of this.level.tall) {
      if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z) {
        p.z = dz > 0 ? b.min.z - r : b.max.z + r;
      }
    }
  }

  separate() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.T.r + b.T.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const px = (dx / d) * push;
        const pz = (dz / d) * push;
        if (px || pz) {
          this.slide(a, -px, -pz);
          this.slide(b, px, pz);
        }
      }
    }
  }

  fireShot(e, player, game) {
    const from = new THREE.Vector3(e.pos.x, e.pos.y + 1.3, e.pos.z);
    const vel = new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z).sub(from).normalize();
    from.addScaledVector(vel, 0.7);
    vel.multiplyScalar(SHOT_SPEED);
    const mesh = new THREE.Mesh(shotGeo, shotMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.shots.push({ mesh, vel, life: 4 });
    game.sfx.enemyShot();
  }

  updateShots(dt, game) {
    const player = game.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const p = s.mesh.position;
      p.addScaledVector(s.vel, dt);
      s.life -= dt;
      let gone = s.life <= 0 || p.y < 0;

      const dy = p.y - (player.pos.y + 0.9);
      if (!gone && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 0.6 && Math.abs(dy) < 1.0) {
        game.damagePlayer(10);
        gone = true;
      }
      if (!gone) {
        for (const b of this.level.colliders) {
          if (b.containsPoint(p)) {
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        this.effects.burst(p, 0xff3d8b, 5, 3);
        this.scene.remove(s.mesh);
        this.shots.splice(i, 1);
      }
    }
  }

  updatePickups(dt, game) {
    const player = game.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt;
      k.life -= dt;
      k.mesh.rotation.y += dt * 2;
      k.mesh.position.y = k.baseY + Math.sin(k.t * 3) * 0.12;
      k.mesh.visible = k.life > 3 || Math.floor(k.life * 6) % 2 === 0; // blink before expiring
      const near =
        Math.hypot(k.mesh.position.x - player.pos.x, k.mesh.position.z - player.pos.z) < 1.2 &&
        Math.abs(k.baseY - 0.7 - player.pos.y) < 2;
      if (near && player.health < 100) {
        game.heal(25);
        game.sfx.pickup();
        k.life = 0;
      }
      if (k.life <= 0) {
        this.scene.remove(k.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }
}
