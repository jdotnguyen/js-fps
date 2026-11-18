import * as THREE from 'three';

const MAX_PARTICLES = 320;
const PARTICLE_GRAVITY = 16;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.tracers = [];
    this.geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    this.mats = new Map();
  }

  mat(color) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.mats.set(color, m);
    }
    return m;
  }

  /** Chunky cube confetti. */
  burst(pos, color, count = 8, speed = 5) {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat(color));
      mesh.position.copy(pos);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const s = speed * (0.4 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vx: Math.cos(a) * s * (1 - up * 0.5),
        vy: s * (0.3 + up),
        vz: Math.sin(a) * s * (1 - up * 0.5),
        life: 0.35 + Math.random() * 0.35,
        max: 0.7,
      });
    }
  }

  tracer(from, to, color = 0xfff1a8) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= PARTICLE_GRAVITY * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.07, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 8;
      p.mesh.scale.setScalar(Math.min(1, p.life / 0.25));
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        t.line.material.opacity = (t.life / 0.07) * 0.9;
      }
    }
  }

  clear() {
    for (const p of this.particles) this.scene.remove(p.mesh);
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
    }
    this.particles.length = 0;
    this.tracers.length = 0;
  }
}
