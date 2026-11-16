import * as THREE from 'three';
import { toonBox } from './toon.js';

const GUN_DARK = 0x2b2d42;

const WEAPONS = [
  { name: 'RIFLE', mag: 30, rate: 0.095, dmg: 14, spread: 0.012, pellets: 1, reload: 1.3, auto: true, kick: 0.01, muzzleZ: -0.56, tracer: 0xfff1a8 },
  { name: 'SHOTGUN', mag: 6, rate: 0.7, dmg: 11, spread: 0.065, pellets: 9, reload: 1.8, auto: false, kick: 0.045, muzzleZ: -0.64, tracer: 0xffc078 },
];

const HOLD = new THREE.Vector3(0.26, -0.24, -0.6);

function buildModel(index) {
  const g = new THREE.Group();
  const part = (w, h, d, color, x, y, z) => {
    const m = toonBox(w, h, d, color, { outline: 0.008, shadow: false });
    m.position.set(x, y, z);
    g.add(m);
  };
  if (index === 0) {
    part(0.1, 0.14, 0.5, 0x3a86ff, 0, 0, 0);
    part(0.05, 0.05, 0.3, GUN_DARK, 0, 0.02, -0.39);
    part(0.07, 0.16, 0.08, GUN_DARK, 0, -0.13, 0.15);
    part(0.06, 0.18, 0.09, 0xffd166, 0, -0.14, -0.06);
    part(0.03, 0.05, 0.08, 0xffd166, 0, 0.09, 0.1);
  } else {
    part(0.12, 0.13, 0.46, 0xff7b00, 0, 0, 0.02);
    part(0.05, 0.05, 0.42, GUN_DARK, -0.03, 0.02, -0.41);
    part(0.05, 0.05, 0.42, GUN_DARK, 0.03, 0.02, -0.41);
    part(0.14, 0.07, 0.16, 0xffd166, 0, -0.05, -0.32);
    part(0.08, 0.16, 0.09, GUN_DARK, 0, -0.13, 0.17);
  }
  return g;
}

export class Arsenal {
  constructor(aspect) {
    // The gun lives in its own scene, drawn after the world with depth cleared.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.models = WEAPONS.map((_, i) => {
      const m = buildModel(i);
      this.holder.add(m);
      return m;
    });
    this.flash = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
    );
    this.holder.add(this.flash);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 150;
    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();
    this.end = new THREE.Vector3();

    this.trigger = false;
    this.fresh = false;
    this.reset();
  }

  reset() {
    this.idx = 0;
    this.ammo = WEAPONS.map((w) => w.mag);
    this.cool = 0;
    this.reloadT = 0;
    this.switchT = 0;
    this.kick = 0;
    this.flashT = 0;
    this.bobT = 0;
    this.trigger = false;
    this.fresh = false;
    this.models.forEach((m, i) => (m.visible = i === 0));
  }

  get weapon() { return WEAPONS[this.idx]; }

  press() { this.trigger = true; this.fresh = true; }
  release() { this.trigger = false; }

  refreshHud(game) {
    game.hud.setWeapon(this.weapon.name, this.ammo[this.idx], this.weapon.mag, this.reloadT > 0);
  }

  switchTo(i, game) {
    const n = ((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    if (n === this.idx) return;
    this.idx = n;
    this.reloadT = 0;
    this.switchT = 0.25;
    this.models.forEach((m, j) => (m.visible = j === n));
    this.refreshHud(game);
  }

  cycle(step, game) { this.switchTo(this.idx + step, game); }

  reload(game) {
    if (this.reloadT > 0 || this.ammo[this.idx] === this.weapon.mag) return;
    this.reloadT = this.weapon.reload;
    game.sfx.reload();
    this.refreshHud(game);
  }

  fire(game) {
    const w = this.weapon;
    const cam = game.camera;
    this.ammo[this.idx]--;
    this.cool = w.rate;
    this.kick = 1;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;

    cam.updateMatrixWorld();
    cam.getWorldDirection(this.fwd);
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(cam.matrixWorld, 1);
    const origin = cam.position;
    this.muzzle.copy(origin)
      .addScaledVector(this.right, 0.22)
      .addScaledVector(this.up, -0.18)
      .addScaledVector(this.fwd, 0.7);

    let hitEnemy = false;
    let killed = false;
    for (let i = 0; i < w.pellets; i++) {
      const sx = (Math.random() + Math.random() - 1) * w.spread;
      const sy = (Math.random() + Math.random() - 1) * w.spread;
      this.dir.copy(this.fwd).addScaledVector(this.right, sx).addScaledVector(this.up, sy).normalize();
      this.raycaster.set(origin, this.dir);
      const hit = this.raycaster.intersectObjects(game.enemies.rayTargets, false)[0];
      if (hit) {
        this.end.copy(hit.point);
        const enemy = hit.object.userData.enemy;
        if (enemy) {
          hitEnemy = true;
          const dmg = w.dmg * (hit.object.userData.head ? 2 : 1);
          if (game.enemies.damage(enemy, dmg, hit.point, game)) killed = true;
        } else {
          game.effects.burst(hit.point, 0xfff7e0, 2, 2.5);
        }
      } else {
        this.end.copy(origin).addScaledVector(this.dir, 80);
      }
      game.effects.tracer(this.muzzle, this.end, w.tracer);
    }

    if (hitEnemy) {
      game.hud.hitMarker(killed);
      if (!killed) game.sfx.hit();
    }
    if (this.idx === 0) game.sfx.rifle();
    else game.sfx.shotgun();
    game.player.pitch = Math.min(Math.PI / 2 - 0.05, game.player.pitch + w.kick);
    this.refreshHud(game);
    if (this.ammo[this.idx] === 0) this.reload(game);
  }

  update(dt, game) {
    const w = this.weapon;
    this.cool -= dt;
    if (this.switchT > 0) this.switchT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.ammo[this.idx] = w.mag;
        this.refreshHud(game);
      }
    }

    const wants = this.trigger && (w.auto || this.fresh);
    if (wants && this.cool <= 0 && this.reloadT <= 0 && this.switchT <= 0) {
      if (this.ammo[this.idx] > 0) {
        this.fire(game);
      } else {
        if (this.fresh) game.sfx.empty();
        this.reload(game);
      }
    }
    this.fresh = false;

    // View-model animation: bob, recoil, and a dip for reload / switch.
    const player = game.player;
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const bob = player.onGround ? Math.min(1, speed / 7) : 0;
    this.bobT += dt * speed * 1.3;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashT -= dt;

    let dip = 0;
    if (this.reloadT > 0) dip = Math.sin(Math.PI * (1 - this.reloadT / w.reload));
    if (this.switchT > 0) dip = Math.max(dip, this.switchT / 0.25);

    const recoil = this.kick * (this.idx === 0 ? 0.04 : 0.1);
    this.holder.position.set(
      HOLD.x + Math.cos(this.bobT) * 0.01 * bob,
      HOLD.y - Math.abs(Math.sin(this.bobT)) * 0.014 * bob - dip * 0.22,
      HOLD.z + recoil,
    );
    this.holder.rotation.set(recoil * 2 - dip * 0.9, 0, 0);
    this.flash.visible = this.flashT > 0;
    this.flash.position.set(0, 0.02, w.muzzleZ - 0.06);
    this.flash.scale.setScalar(this.idx === 0 ? 1 : 1.7);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
