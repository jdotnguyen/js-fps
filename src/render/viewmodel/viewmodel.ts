import * as THREE from 'three';
import { PLAYER_TUNING, type Player } from '../../actors/player.ts';
import type { EventBus } from '../../core/events.ts';
import type { Input } from '../../core/input.ts';
import { createHandMaterials } from './hand.ts';
import { createWeaponMaterials, mesh, cylZ } from './parts.ts';
import { buildPistol, PISTOL_LEFT_PLACEMENT } from './pistol.ts';
import type { WeaponId, WeaponRig } from './rig.ts';
import { buildShotgun, PUMP_CENTER_Z, SHOTGUN_RIGHT_PLACEMENT } from './shotgun.ts';

declare module '../../core/events.ts' {
  interface EventMap {
    'weapon:fired': { weapon: WeaponId };
    'weapon:dryFire': { weapon: WeaponId };
    'weapon:reloadStart': { weapon: WeaponId };
    'weapon:reloaded': { weapon: WeaponId; loaded: number; reserve: number };
    'weapon:equipped': { weapon: WeaponId };
  }
}

/**
 * First-person weapon viewmodels (ADR-0005): the detailed SEC-9 and Breacher with their hands,
 * procedural sway / bob / recoil / aim / sprint poses, switching, firing and reload choreography.
 * Ammo here is a local stand-in until the weapon state machine and weapons.json land.
 */

type V3 = [number, number, number];
interface Pose {
  p: V3;
  r: V3;
}
interface PoseSet {
  hip: Pose;
  aim: Pose;
  sprint: Pose;
  lowered: Pose;
}
interface Spec {
  mag: number;
  startReserve: number;
  interval: number;
  recoilZ: number;
  recoilRx: number;
  kick: number;
  poses: PoseSet;
}

const SPECS: Record<WeaponId, Spec> = {
  pistol: {
    mag: 12,
    startReserve: 36,
    interval: 0.18,
    recoilZ: 0.55,
    recoilRx: 2.6,
    kick: 0.7,
    poses: {
      hip: { p: [0.085, -0.13, -0.3], r: [0.02, 0.06, 0] },
      aim: { p: [0.0, -0.088, -0.23], r: [0, 0, 0] },
      sprint: { p: [0.07, -0.19, -0.2], r: [0.5, 0.45, -0.2] },
      lowered: { p: [0.06, -0.32, -0.14], r: [0.7, 0.3, 0] },
    },
  },
  shotgun: {
    mag: 6,
    startReserve: 18,
    interval: 0.75,
    recoilZ: 1.5,
    recoilRx: 6.5,
    kick: 2.4,
    poses: {
      hip: { p: [0.17, -0.2, -0.2], r: [0.03, 0.1, 0] },
      aim: { p: [0.05, -0.135, -0.22], r: [0, 0.02, 0] },
      sprint: { p: [0.15, -0.28, -0.1], r: [0.65, 0.5, -0.25] },
      lowered: { p: [0.12, -0.42, -0.05], r: [0.8, 0.3, 0] },
    },
  },
};

export interface ViewmodelDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  player: Player;
  events: EventBus;
  /** Weapons can be used right now (playing, alive, control allows). */
  enabled: () => boolean;
  /** The viewmodel should be drawn at all (hidden on the title screen and in fly mode). */
  visible: () => boolean;
  reducedMotion: () => boolean;
}

const ease = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const approach = (v: number, goal: number, step: number): number => (v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Damped spring state. */
class Spring {
  x = 0;
  v = 0;
  private readonly k: number;
  private readonly c: number;
  constructor(k: number, c: number) {
    this.k = k;
    this.c = c;
  }
  step(dt: number): void {
    this.v += (-this.k * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
  kick(v: number): void {
    this.v += v;
  }
}

type Phase = 'idle' | 'lowering' | 'raising';
type Reload = { kind: 'pistol'; t: number; total: number; empty: boolean } | { kind: 'shotgun'; t: number; shell: number; entering: boolean; stop: boolean } | null;

export class Viewmodel {
  readonly group = new THREE.Group();
  private readonly d: ViewmodelDeps;
  private readonly rigs: Record<WeaponId, WeaponRig>;
  private readonly ammo: Record<WeaponId, { loaded: number; reserve: number }>;
  private current: WeaponId = 'pistol';
  private pending: WeaponId | null = null;
  private phase: Phase = 'raising';
  private phaseT = 0;
  private holster = 1;
  private sprintBlend = 0;
  private aimBlend = 0;
  private cooldown = 0;
  private sinceShot = 99;
  private reload: Reload = null;
  private prevFire = false;
  private prevR = false;
  private prev1 = false;
  private prev2 = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private time = 0;
  private readonly recZ = new Spring(420, 26);
  private readonly recRx = new Spring(380, 24);
  private readonly recRy = new Spring(380, 24);
  private readonly swayX = new Spring(90, 12);
  private readonly swayY = new Spring(90, 12);
  private readonly flash: THREE.Group;
  private readonly flashLight: THREE.PointLight;
  private flashT = 0;
  private readonly fill: THREE.PointLight;
  private readonly carriedMag: THREE.Object3D;
  private readonly shellProp: THREE.Group;
  private magFall = { t: -1, y: 0, vy: 0, vz: 0, z: 0, rx: 0 };

  constructor(deps: ViewmodelDeps) {
    this.d = deps;
    const wm = createWeaponMaterials();
    const hm = createHandMaterials();
    const t0 = performance.now();
    this.rigs = { pistol: buildPistol(wm, hm, { voxel: 0.0021 }), shotgun: buildShotgun(wm, hm, { voxel: 0.0021 }) };
    console.info(`[boot] viewmodels built in ${(performance.now() - t0).toFixed(0)} ms`);
    this.ammo = {
      pistol: { loaded: SPECS.pistol.mag, reserve: SPECS.pistol.startReserve },
      shotgun: { loaded: SPECS.shotgun.mag, reserve: SPECS.shotgun.startReserve },
    };
    this.group.name = 'viewmodel';
    this.group.frustumCulled = false;
    for (const id of ['pistol', 'shotgun'] as const) {
      const rig = this.rigs[id];
      rig.root.rotation.order = 'YXZ';
      rig.root.visible = id === this.current;
      this.group.add(rig.root);
      rig.root.traverse((o) => {
        o.frustumCulled = false;
        o.renderOrder = 10;
      });
      rig.setAmmo(this.ammo[id].loaded, this.ammo[id].reserve);
    }

    // Muzzle flash: crossed additive quads plus a short-lived point light.
    this.flash = new THREE.Group();
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc47a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), flashMat);
      q.rotation.z = (i * Math.PI) / 3;
      this.flash.add(q);
    }
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.12, 12, 1, true), flashMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.06;
    this.flash.add(cone);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 7, 2);
    this.flashLight.castShadow = false;
    this.group.add(this.flashLight);

    // Soft fill so hands read in dark rooms (the flashlight cone rarely reaches them).
    this.fill = new THREE.PointLight(0xffe2cc, 0.55, 1.6, 2);
    this.fill.position.set(0.05, 0.12, -0.05);
    this.group.add(this.fill);

    // Props used by reload choreography.
    const pistolMag = this.rigs.pistol.mag;
    this.carriedMag = pistolMag ? pistolMag.clone(true) : new THREE.Group();
    this.carriedMag.visible = false;
    this.rigs.pistol.root.getObjectByName('grip-tilt')?.add(this.carriedMag);
    this.shellProp = new THREE.Group();
    const wmShell = wm.shell;
    this.shellProp.add(mesh(cylZ(0.0095, 0.05, 14), wmShell, 'shell-hull'));
    const brass = mesh(cylZ(0.0099, 0.014, 14), wm.brass, 'shell-brass');
    brass.position.z = 0.019;
    this.shellProp.add(brass);
    this.shellProp.visible = false;
    this.rigs.shotgun.root.add(this.shellProp);

    this.limitSpotNearField();
    this.equipFlash(this.current);
    deps.scene.add(this.group);
    this.lastYaw = deps.player.yaw;
    this.lastPitch = deps.player.pitch;
  }

  /**
   * The flashlight sits a hand's width from the gun, so inverse-square falloff blows the viewmodel out.
   * Clamp spot-light distance in the viewmodel materials' shaders to a "typical wall" distance.
   */
  private limitSpotNearField(): void {
    const seen = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        const prior = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader, renderer) => {
          prior.call(mat, shader, renderer);
          if (!shader.fragmentShader.includes('#include <lights_pars_begin>')) return;
          const chunk = THREE.ShaderChunk.lights_pars_begin;
          const at = chunk.indexOf('void getSpotLightInfo');
          if (at < 0) return;
          const head = chunk.slice(0, at);
          const tail = chunk.slice(at).replace('float lightDistance = length( lVector );', 'float lightDistance = max( length( lVector ), 1.8 );');
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_pars_begin>', head + tail);
        };
        mat.customProgramCacheKey = () => 'vm-spot-clamp';
        mat.needsUpdate = true;
      }
    });
  }

  get weapon(): WeaponId {
    return this.current;
  }

  /** Current loaded / reserve for HUD or saves. */
  ammoOf(id: WeaponId): { loaded: number; reserve: number } {
    return this.ammo[id];
  }

  // ---- per frame -----------------------------------------------------------------------

  update(frameDt: number): void {
    const dt = Math.min(frameDt, 1 / 20);
    const { camera, player, input } = this.d;
    this.group.visible = this.d.visible();
    if (!this.group.visible) {
      this.prevFire = input.isDown('fire');
      return;
    }
    this.time += dt;
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);

    const active = this.d.enabled();
    this.holster = approach(this.holster, active ? 0 : 1, dt / 0.25);
    this.aimBlend = player.aimBlend;
    this.sprintBlend = approach(this.sprintBlend, player.sprinting ? 1 : 0, dt / 0.18);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;

    const fireDown = input.isDown('fire') && input.locked;
    const rDown = input.isDown('reload');
    const d1 = input.isDown('weapon1');
    const d2 = input.isDown('weapon2');
    if (active && this.holster < 0.4) {
      const wheel = input.consumeWheel();
      if (d1 && !this.prev1) this.requestSwitch('pistol');
      if (d2 && !this.prev2) this.requestSwitch('shotgun');
      if (wheel !== 0) this.requestSwitch(this.current === 'pistol' ? 'shotgun' : 'pistol');
      if (rDown && !this.prevR) this.startReload();
      if (fireDown && !this.prevFire) this.tryFire();
    }
    this.prevFire = fireDown;
    this.prevR = rDown;
    this.prev1 = d1;
    this.prev2 = d2;

    this.updateSwitch(dt);
    this.updateReload(dt);
    this.updateWeaponAnim(dt);
    this.updatePose(dt);
    this.updateFlash(dt);
  }

  // ---- switching -----------------------------------------------------------------------

  private requestSwitch(to: WeaponId): void {
    if (to === this.current && this.pending === null) return;
    if (this.phase !== 'idle' && this.pending !== null) return;
    if (to === this.current) return;
    this.pending = to;
    if (this.phase === 'idle') {
      this.phase = 'lowering';
      this.phaseT = 0;
    }
    this.cancelReload();
  }

  private updateSwitch(dt: number): void {
    if (this.phase === 'idle') return;
    this.phaseT += dt / 0.175;
    if (this.phase === 'lowering' && this.phaseT >= 1) {
      if (this.pending) {
        this.rigs[this.current].root.visible = false;
        this.current = this.pending;
        this.pending = null;
        this.rigs[this.current].root.visible = true;
        this.equipFlash(this.current);
        this.d.events.emit('weapon:equipped', { weapon: this.current });
      }
      this.phase = 'raising';
      this.phaseT = 0;
    } else if (this.phase === 'raising' && this.phaseT >= 1) {
      this.phase = 'idle';
      this.phaseT = 0;
    }
  }

  private lowerAmount(): number {
    let k = 0;
    if (this.phase === 'lowering') k = ease(clamp01(this.phaseT));
    else if (this.phase === 'raising') k = 1 - ease(clamp01(this.phaseT));
    return Math.max(k, ease(this.holster));
  }

  private equipFlash(id: WeaponId): void {
    this.flash.removeFromParent();
    this.rigs[id].muzzle.add(this.flash);
  }

  // ---- fire / reload -------------------------------------------------------------------

  private canAct(): boolean {
    return this.phase === 'idle' && this.sprintBlend < 0.35 && this.holster < 0.2;
  }

  private tryFire(): void {
    if (!this.canAct() || this.cooldown > 0) return;
    const id = this.current;
    const st = this.ammo[id];
    const rig = this.rigs[id];
    if (this.reload) {
      // Shotgun reloads are interruptible by firing (ADR-0005).
      if (this.reload.kind === 'shotgun' && st.loaded > 0) this.reload.stop = true;
      else return;
    }
    if (st.loaded <= 0) {
      this.cooldown = 0.25;
      this.sinceShot = 0;
      this.dryTrigger = 0.12;
      this.d.events.emit('weapon:dryFire', { weapon: id });
      return;
    }
    const spec = SPECS[id];
    st.loaded--;
    rig.setAmmo(st.loaded, st.reserve);
    this.cooldown = spec.interval;
    this.sinceShot = 0;
    this.dryTrigger = 0.1;
    const aimDamp = 1 - 0.45 * this.aimBlend;
    this.recZ.kick(spec.recoilZ * aimDamp);
    this.recRx.kick(spec.recoilRx * aimDamp);
    this.recRy.kick((Math.random() - 0.5) * spec.recoilRx * 0.5);
    this.d.player.addKick(spec.kick * (this.d.reducedMotion() ? 0.3 : 1));
    this.flashT = id === 'pistol' ? 0.055 : 0.085;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(id === 'pistol' ? 0.7 : 1.5);
    this.d.events.emit('weapon:fired', { weapon: id });
  }

  private dryTrigger = 0;

  private startReload(): void {
    if (!this.canAct() || this.reload) return;
    const id = this.current;
    const st = this.ammo[id];
    const spec = SPECS[id];
    if (st.loaded >= spec.mag || st.reserve <= 0) return;
    if (id === 'pistol') this.reload = { kind: 'pistol', t: 0, total: st.loaded === 0 ? 1.7 : 1.4, empty: st.loaded === 0 };
    else this.reload = { kind: 'shotgun', t: 0, shell: 0, entering: true, stop: false };
    this.d.events.emit('weapon:reloadStart', { weapon: id });
  }

  private cancelReload(): void {
    this.reload = null;
    this.carriedMag.visible = false;
    this.shellProp.visible = false;
    this.magFall.t = -1;
    const mag = this.rigs.pistol.mag;
    if (mag) {
      mag.visible = true;
      mag.position.set(0, 0, 0);
      mag.rotation.set(0, 0, 0);
    }
  }

  private reloadBlend = 0;

  private updateReload(dt: number): void {
    const r = this.reload;
    const target = r ? 1 : 0;
    this.reloadBlend = approach(this.reloadBlend, target, dt / 0.15);
    // Left-hand slide along the grip axis and right-hand shell run, reset when idle.
    const pistolRig = this.rigs.pistol;
    const shotRig = this.rigs.shotgun;
    const leftHand = pistolRig.root.getObjectByName('hand-left');
    const rightHand = shotRig.root.getObjectByName('hand-right');
    const gripMag = pistolRig.mag;
    const slideDown = (s: number): void => {
      if (!leftHand) return;
      leftHand.position.set(PISTOL_LEFT_PLACEMENT.pos[0], PISTOL_LEFT_PLACEMENT.pos[1] - Math.cos(0.28) * s, PISTOL_LEFT_PLACEMENT.pos[2] + Math.sin(0.28) * s);
    };
    if (!r) {
      slideDown(0);
      rightHand?.position.set(...SHOTGUN_RIGHT_PLACEMENT.pos);
      this.slideLockedBack = this.ammo.pistol.loaded === 0;
      if (this.magFall.t >= 0 && gripMag) this.stepMagFall(dt, gripMag);
      return;
    }
    r.t += dt;
    if (r.kind === 'pistol') {
      const u = r.t / r.total;
      // Phases: 0-.14 hand drops, mag falls; .14-.42 grabs fresh mag; .42-.7 insert; .7-.86 slide release; rest settle.
      const hand = u < 0.14 ? ease(u / 0.14) : u < 0.42 ? 1 : u < 0.7 ? 1 - ease((u - 0.42) / 0.28) : 0;
      slideDown(0.13 * hand);
      if (gripMag && u >= 0.08 && this.magFall.t < 0 && gripMag.visible && u < 0.42) {
        this.magFall = { t: 0, y: 0, vy: 0.0, vz: 0, z: 0, rx: 0 };
      }
      if (this.magFall.t >= 0 && gripMag) this.stepMagFall(dt, gripMag);
      const carry = u >= 0.14 && u < 0.7;
      this.carriedMag.visible = carry;
      if (carry) this.carriedMag.position.set(0, -0.13 * hand, 0);
      if (u >= 0.7 && gripMag) {
        gripMag.visible = true;
        gripMag.position.set(0, 0, 0);
        gripMag.rotation.set(0, 0, 0);
        this.magFall.t = -1;
      }
      if (r.empty && u >= 0.74 && u < 0.86) this.slideLockedBack = false;
      if (u >= 1) this.finishPistolReload();
    } else {
      this.updateShotgunReload(r, rightHand);
    }
  }

  private slideLockedBack = false;

  private stepMagFall(dt: number, mag: THREE.Object3D): void {
    const f = this.magFall;
    f.t += dt;
    f.vy -= 9.8 * dt * 1.2;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    f.rx += 3.5 * dt;
    mag.position.set(0, f.y, f.z);
    mag.rotation.set(f.rx, 0, f.rx * 0.5);
    if (f.t > 0.45) mag.visible = false;
  }

  private finishPistolReload(): void {
    const st = this.ammo.pistol;
    const spec = SPECS.pistol;
    const take = Math.min(spec.mag - st.loaded, st.reserve);
    st.loaded += take;
    st.reserve -= take;
    this.rigs.pistol.setAmmo(st.loaded, st.reserve);
    this.carriedMag.visible = false;
    this.reload = null;
    this.slideLockedBack = false;
    this.d.events.emit('weapon:reloaded', { weapon: 'pistol', loaded: st.loaded, reserve: st.reserve });
  }

  private updateShotgunReload(r: Extract<NonNullable<Reload>, { kind: 'shotgun' }>, rightHand: THREE.Object3D | undefined): void {
    const st = this.ammo.shotgun;
    const rig = this.rigs.shotgun;
    const rest = SHOTGUN_RIGHT_PLACEMENT.pos;
    if (r.entering) {
      this.shellProp.visible = false;
      if (r.t >= 0.25) {
        r.entering = false;
        r.t = 0;
      }
      return;
    }
    const cycle = 0.5;
    const u = clamp01(r.t / cycle);
    // 0-.55 hand runs to the shell, grabs and carries it up to the port; .55-.75 insert; .75-1 hand returns.
    const out = u < 0.55 ? ease(u / 0.55) : u < 0.75 ? 1 : 1 - ease((u - 0.75) / 0.25);
    const off: V3 = [-0.03, -0.09, -0.07];
    rightHand?.position.set(rest[0] + off[0] * out, rest[1] + off[1] * out, rest[2] + off[2] * out);
    const port: V3 = [0, -0.04, -0.152];
    const inHand: V3 = [rest[0] + off[0] * out - 0.004, rest[1] + off[1] * out + 0.01, rest[2] + off[2] * out - 0.02];
    const ins = clamp01((u - 0.55) / 0.2);
    this.shellProp.visible = u < 0.76;
    this.shellProp.position.set(lerp(inHand[0], port[0], ease(ins)), lerp(inHand[1], port[1], ease(ins)), lerp(inHand[2], port[2], ease(ins)));
    this.shellProp.rotation.set(0.35 * (1 - ins), 0, 0);
    if (r.t >= cycle) {
      st.loaded++;
      st.reserve--;
      rig.setAmmo(st.loaded, st.reserve);
      r.shell++;
      r.t = 0;
      if (st.loaded >= SPECS.shotgun.mag || st.reserve <= 0 || r.stop) {
        this.reload = null;
        this.shellProp.visible = false;
        this.d.events.emit('weapon:reloaded', { weapon: 'shotgun', loaded: st.loaded, reserve: st.reserve });
      }
    }
  }

  // ---- weapon animation (slide / pump / trigger) ----------------------------------------

  private updateWeaponAnim(dt: number): void {
    this.dryTrigger = Math.max(0, this.dryTrigger - dt);
    for (const id of ['pistol', 'shotgun'] as const) {
      const rig = this.rigs[id];
      if (!rig.root.visible) continue;
      let s = 0;
      const t = this.sinceShot;
      if (id === 'pistol') {
        const back = clamp01(t / 0.035);
        const fwd = clamp01((t - 0.035) / 0.085);
        s = t < 0.035 ? ease(back) : 1 - ease(fwd);
        if (t > 0.12) s = 0;
        if (this.ammo.pistol.loaded === 0 && this.slideLockedBack) s = 1;
        if (this.ammo.pistol.loaded === 0 && !this.reload && t > 0.12) s = 1;
        rig.mover.position.z = rig.moverTravel * s;
      } else {
        // Pump cycles after each shot: back, then forward.
        const a = clamp01((t - 0.2) / 0.2);
        const b = clamp01((t - 0.42) / 0.22);
        s = t < 0.2 ? 0 : t < 0.42 ? ease(a) : 1 - ease(b);
        if (this.reload) s = this.reload.kind === 'shotgun' ? 0 : s;
        rig.mover.position.z = PUMP_CENTER_Z + rig.moverTravel * s;
      }
      const pull = this.dryTrigger > 0 ? 1 : 0;
      rig.setTrigger(pull);
    }
  }

  // ---- pose ----------------------------------------------------------------------------

  private updatePose(dt: number): void {
    const { player } = this.d;
    const reduced = this.d.reducedMotion();
    const rig = this.rigs[this.current];
    const poses = SPECS[this.current].poses;
    const aimE = ease(this.aimBlend);
    const sprintE = ease(this.sprintBlend) * (1 - aimE);
    const lower = this.lowerAmount();

    let pos = mix3(poses.hip.p, poses.aim.p, aimE);
    let rot = mix3(poses.hip.r, poses.aim.r, aimE);
    pos = mix3(pos, poses.sprint.p, sprintE);
    rot = mix3(rot, poses.sprint.r, sprintE);
    pos = mix3(pos, poses.lowered.p, lower);
    rot = mix3(rot, poses.lowered.r, lower);

    // Sway: the gun trails the view slightly.
    const dyaw = ((player.yaw - this.lastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const dpitch = player.pitch - this.lastPitch;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    const swayScale = reduced ? 0.25 : 1 - 0.6 * aimE;
    this.swayX.kick(THREE.MathUtils.clamp(-dyaw / Math.max(dt, 1e-3), -6, 6) * 0.035 * swayScale);
    this.swayY.kick(THREE.MathUtils.clamp(dpitch / Math.max(dt, 1e-3), -6, 6) * 0.03 * swayScale);
    this.swayX.step(dt);
    this.swayY.step(dt);
    this.recZ.step(dt);
    this.recRx.step(dt);
    this.recRy.step(dt);

    // Bob and breathing.
    const speed = Math.hypot(player.velocity.x, player.velocity.y);
    const ampGoal = reduced ? 0 : Math.min(1, speed / PLAYER_TUNING.walkSpeed) * (player.sprinting ? 1.5 : 1);
    this.bobAmp = approach(this.bobAmp, ampGoal, dt * 4);
    this.bobPhase += speed * dt * (player.sprinting ? 2.6 : 2.2);
    const bob = this.bobAmp * (1 - 0.7 * aimE);
    const breathe = reduced ? 0 : Math.sin(this.time * 1.7) * 0.0006;
    pos = [
      pos[0] + Math.sin(this.bobPhase) * 0.004 * bob + this.swayX.x * 0.06,
      pos[1] + Math.abs(Math.cos(this.bobPhase)) * -0.004 * bob + breathe + this.swayY.x * 0.05,
      pos[2] + this.recZ.x * 1.0,
    ];
    rot = [
      rot[0] + this.recRx.x * 0.1 + this.swayY.x * 0.5 + Math.sin(this.bobPhase * 2) * 0.006 * bob,
      rot[1] + this.recRy.x * 0.05 + this.swayX.x * 0.5 + Math.cos(this.bobPhase) * 0.01 * bob,
      rot[2] + this.swayX.x * -0.2,
    ];

    // Reload tilt.
    const rl = ease(this.reloadBlend);
    if (this.current === 'pistol') {
      rot = [rot[0] + 0.12 * rl, rot[1] + 0.18 * rl, rot[2] - 0.3 * rl];
      pos = [pos[0] - 0.02 * rl, pos[1] + 0.03 * rl, pos[2] + 0.02 * rl];
    } else {
      rot = [rot[0] + 0.15 * rl, rot[1] - 0.05 * rl, rot[2] + 0.5 * rl];
      pos = [pos[0] - 0.05 * rl, pos[1] + 0.03 * rl, pos[2] + 0.03 * rl];
    }

    rig.root.position.set(pos[0], pos[1], pos[2]);
    rig.root.rotation.set(rot[0], rot[1], rot[2]);
    rig.setLaser(this.current === 'pistol' ? ease(this.aimBlend) * (1 - lower) : 0);
  }

  private updateFlash(dt: number): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = this.flashT > 0;
      const m = this.rigs[this.current].muzzle;
      m.getWorldPosition(this.flashLight.position);
      this.group.worldToLocal(this.flashLight.position);
      this.flashLight.intensity = this.flashT > 0 ? (this.current === 'pistol' ? 6 : 14) : 0;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}
