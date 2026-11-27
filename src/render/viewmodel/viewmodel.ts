import * as THREE from 'three';
import { struckFrom, type HitInfo } from '../../actors/hit.ts';
import { CriticalSpring, hitStrength } from '../../actors/hitFlinch.ts';
import { PLAYER_TUNING, type Player } from '../../actors/player.ts';
import type { EventBus } from '../../core/events.ts';
import type { Input } from '../../core/input.ts';
import { disposeTexture } from '../materials.ts';
import type { ClipName, GlbWeapon, PlayOptions } from './glbWeapons.ts';
import type { WeaponId } from './rig.ts';

declare module '../../core/events.ts' {
  interface EventMap {
    'weapon:fired': { weapon: WeaponId };
    /** Where Jay's shot (its first pellet) struck the level, and the way it was travelling (normalised). */
    'weapon:impact': { weapon: WeaponId; x: number; y: number; z: number; dx: number; dy: number; dz: number };
    /** The impact was on armoured glass: chipped, never through (medbay-attack "Shooting the glass"). */
    'weapon:glass': { weapon: WeaponId; x: number; y: number; z: number };
    'weapon:dryFire': { weapon: WeaponId };
    /** `duration` (s) and `empty` are set for the pistol, whose reload is a fixed-length animation. */
    'weapon:reloadStart': { weapon: WeaponId; duration?: number; empty?: boolean };
    'weapon:reloaded': { weapon: WeaponId; loaded: number; reserve: number };
    /** A shotgun shell reaches the loading port (once per shell during a reload). */
    'weapon:shellInsert': { weapon: WeaponId };
    /** A sound moment inside a weapon animation (see CUES): the audio hangs its samples on these instead of guessing timings. */
    'weapon:cue': { weapon: WeaponId; cue: WeaponCue };
    'weapon:equipped': { weapon: WeaponId };
  }
}

/** Sound moments, each emitted at a fixed point of a GLB clip (seconds into it, see CUES). */
export type WeaponCue = 'magOut' | 'magIn' | 'slide' | 'pump';

/**
 * First-person weapon viewmodels (ADR-0005): the animated pistol and shotgun GLBs (skinned arms + gun,
 * glbWeapons.ts) driven by their own clips for firing, pumping, reloading and drawing, with procedural
 * sway / bob / recoil springs, aim and sprint poses layered on top. The state machine (ammo, switching,
 * cooldowns) is unchanged; clip lengths set the timings. Ammo here is a local stand-in until the weapon
 * state machine and weapons.json land.
 */

/** Seconds into the named clip at which a sound lands (read off the clips' bone tracks, swap-viewmodels-to-just-models design D5 to D7). */
export const CUES = {
  pistol: {
    /** Magazine leaves the grip (Reload). */
    magOut: 0.62,
    /** Fresh magazine seats. */
    magIn: 2.15,
    /**
     * Rack sound start, near the end of the reload: the slide starts back at 3.05 s and is home at 3.25 s, and the sample's
     * two clicks (0.07 s and 0.21 s into it) land on the pull and on the snap home.
     */
    slide: 3.04,
    /**
     * Drawing the pistol ends with the same rack: after Take, Reload plays from here (the support hand on its way to the
     * slide) to its end. `Take` itself never moves the slide.
     */
    rackFrom: 2.55,
    /** Cross-fade from the drawn pose into the rack, seconds. */
    rackFade: 0.2,
  },
  shotgun: {
    /** Pump sound start, into Shoot: the rack back begins about 0.6 s in. */
    pump: 0.58,
    /** The pump is home and the next shot may fire, into Shoot. */
    ready: 0.85,
    /** Pump sound start, into Take (the forend slides home as the gun comes up) and into ReloadEnd. */
    pumpDraw: 0.22,
    pumpEnd: 0.08,
    /** Shell-in sound / ammo tick, into each Reload: the shell seats in the tube about 0.07 s later, which is where the sample's transient is. */
    shell: 0.38,
  },
} as const;

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
/** Per-weapon motion character. The pistol's values reproduce the original stiff-ish behaviour; the shotgun is heavier and looser. */
interface Feel {
  /** Gain on the fast sway layer's position / rotation (negative position gain flips it to trail the view). */
  swayPos: number;
  swayRot: number;
  /** Slow, heavy inertia layer: the gun lags the view and dips on footsteps and shots. 0 = off. */
  weight: number;
  /** Breathing / idle drift gain. */
  idle: number;
  /** Walk-bob gain. */
  bob: number;
  /** Strafe lean gain. */
  strafe: number;
  /** Random roll twist kicked on each shot. */
  twist: number;
  /** Aim and sprint blends settle with a small overshoot instead of a hard ease. */
  soft: boolean;
}
interface Spec {
  feel: Feel;
  mag: number;
  startReserve: number;
  interval: number;
  recoilZ: number;
  recoilRx: number;
  kick: number;
  poses: PoseSet;
}

const SPECS: Record<WeaponId, Spec> = {
  // Pose positions place the model's reference point (glbWeapons.ts: the grip) in camera space, metres; rotations pivot about it.
  // The hip pose is the authored framing seen from a forward eye (design D2); aim puts the sights on the view axis. Sprint and
  // lowered pitch the muzzle DOWN (negative x): the old poses pitched it up, which swings a 1 m shotgun barrel across the view.
  pistol: {
    feel: { swayPos: 1, swayRot: 1, weight: 0, idle: 1, bob: 1, strafe: 0, twist: 0, soft: false },
    mag: 12,
    startReserve: 36,
    interval: 0.24,
    // The Shoot clip moves the gun a few millimetres (the old Fire clip threw it a third of a metre), so these springs carry the recoil.
    recoilZ: 1.6,
    recoilRx: 24,
    kick: 1.4,
    poses: {
      hip: { p: [0.012, -0.095, -0.126], r: [0, 0, 0] },
      aim: { p: [-0.004, -0.061, -0.126], r: [0, 0, 0] },
      sprint: { p: [0, -0.1, -0.1], r: [-0.3, 0.45, -0.2] },
      lowered: { p: [-0.018, -0.3, -0.1], r: [-0.7, 0.3, 0] },
    },
  },
  shotgun: {
    feel: { swayPos: -1.2, swayRot: 1.2, weight: 0.5, idle: 1, bob: 1.3, strafe: 0.6, twist: 3, soft: true },
    mag: 6,
    startReserve: 18,
    // Shoot is the recoil and then the pump; the next shot waits for the pump to be home.
    interval: CUES.shotgun.ready,
    recoilZ: 2.1,
    recoilRx: 38,
    kick: 3.6,
    poses: {
      hip: { p: [0.019, -0.076, -0.025], r: [0, 0, 0] },
      aim: { p: [-0.036, -0.055, -0.05], r: [0, 0, 0] },
      sprint: { p: [0.07, -0.1, -0.06], r: [-0.3, 0.55, -0.2] },
      lowered: { p: [0.029, -0.45, -0.06], r: [-0.9, 0.3, 0] },
    },
  },
};

export interface ViewmodelDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  player: Player;
  events: EventBus;
  /** The loaded GLB weapon rigs (loadWeaponModels in glbWeapons.ts). */
  models: Record<WeaponId, GlbWeapon>;
  /** Weapons can be used right now (playing, alive, control allows). */
  enabled: () => boolean;
  /** The viewmodel should be drawn at all (hidden on the title screen and in fly mode). */
  visible: () => boolean;
  /** Jay has a pistol in hand. While false no gun is shown; it is drawn when this turns true. Default: true. */
  armed?: () => boolean;
  reducedMotion: () => boolean;
  /** Weapons Jay carries (ADR-0005: the shotgun comes from the R07a armory). Default: all. */
  owns?: (id: WeaponId) => boolean;
}

/** A full-strength hit throws the weapon this far towards the blow, down and back (metres), and rolls and turns it (radians). */
const KNOCK = { x: 0.03, y: -0.018, z: 0.022, roll: 0.14, yaw: 0.06 };
const KNOCK_RATE = 18;

/** Breathing: one slow cycle every 4.2 s (the new weapon models have no idle clip). */
const BREATH_RATE = (Math.PI * 2) / 4.2;

const ease = (t: number): number => t * t * (3 - 2 * t);
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
type Reload =
  | { kind: 'pistol'; t: number; total: number; empty: boolean }
  | { kind: 'shotgun'; stage: 'enter' | 'shell' | 'exit'; t: number; shell: number; inserted: boolean }
  | null;

interface PendingCue {
  at: number;
  weapon: WeaponId;
  cue: WeaponCue;
}

export class Viewmodel {
  readonly group = new THREE.Group();
  private readonly d: ViewmodelDeps;
  private readonly rigs: Record<WeaponId, GlbWeapon>;
  private readonly ammo: Record<WeaponId, { loaded: number; reserve: number }>;
  private current: WeaponId = 'pistol';
  private pending: WeaponId | null = null;
  private phase: Phase = 'idle';
  private phaseT = 0;
  private holster = 1;
  /** The gun is shown (see `ViewmodelDeps.armed`). */
  private gunOut = true;
  private sprintBlend = 0;
  private aimBlend = 0;
  private cooldown = 0;
  private reload: Reload = null;
  private prevFire = false;
  private prevR = false;
  private prev1 = false;
  private prev2 = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private bobPhase = 0;
  private breathPhase = 0;
  private bobAmp = 0;
  private time = 0;
  private wasVisible = false;
  /** Actions are held off until this time (the draw clip). */
  private busyUntil = 0;
  /** After a one-shot clip, go back to the rest pose at this time. */
  private restAt = Infinity;
  /** The pistol's draw goes on into the slide rack at this time. */
  private rackAt = Infinity;
  private cues: PendingCue[] = [];
  private readonly recZ = new Spring(420, 26);
  private readonly recRx = new Spring(380, 24);
  private readonly recRy = new Spring(380, 24);
  private readonly swayX = new Spring(90, 12);
  private readonly swayY = new Spring(90, 12);
  /** Heavy-weapon inertia: slower and looser than the sway layer. */
  private readonly wX = new Spring(34, 6);
  private readonly wY = new Spring(34, 6);
  private readonly recRz = new Spring(300, 20);
  /** A hit's knock: towards the blow (x), and its share of down, back and twist. */
  private readonly knockSide = new CriticalSpring(KNOCK_RATE);
  private readonly knockHard = new CriticalSpring(KNOCK_RATE);
  private lean = 0;
  private stepSide = 1;
  private aimSm = 0;
  private aimV = 0;
  private sprSm = 0;
  private sprV = 0;
  private readonly flash: THREE.Group;
  private readonly flashLight: THREE.PointLight;
  private flashT = 0;
  private readonly fill: THREE.PointLight;
  private readonly tmp = new THREE.Vector3();
  private readonly offFootstep: () => void;

  constructor(deps: ViewmodelDeps) {
    this.d = deps;
    this.rigs = deps.models;
    this.ammo = {
      pistol: { loaded: SPECS.pistol.mag, reserve: SPECS.pistol.startReserve },
      shotgun: { loaded: SPECS.shotgun.mag, reserve: SPECS.shotgun.startReserve },
    };
    this.group.name = 'viewmodel';
    // Each footfall thumps the heavy layer: a small dip, alternating side to side.
    this.offFootstep = deps.events.on('player:footstep', (f) => {
      const w = SPECS[this.current].feel.weight;
      if (w === 0 || this.d.reducedMotion()) return;
      this.stepSide = -this.stepSide;
      this.wY.kick(-0.45 * w * (f.sprint ? 1.5 : 1));
      this.wX.kick(0.07 * w * this.stepSide);
    });
    this.group.frustumCulled = false;
    for (const id of ['pistol', 'shotgun'] as const) {
      const rig = this.rigs[id];
      rig.root.visible = id === this.current;
      this.group.add(rig.root);
    }

    // Muzzle flash: crossed additive quads plus a short-lived point light. Camera-aligned, placed at the muzzle each frame.
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
    this.flash.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 11;
    });
    this.group.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 7, 2);
    this.flashLight.castShadow = false;
    this.group.add(this.flashLight);

    // Soft fill so hands read in dark rooms (the flashlight cone rarely reaches them). It sits about 0.45 m from the grip, behind
    // and above the camera: the new models are held ~0.13 m from the eye, and with the light as close as it used to be (10 cm
    // from the gun) inverse-square falloff blew the gloves out and exaggerated their normal maps into streaks.
    this.fill = new THREE.PointLight(0xffe2cc, 0.55, 1.6, 2);
    this.fill.position.set(0.05, 0.22, 0.2);
    this.group.add(this.fill);

    this.limitSpotNearField();
    deps.scene.add(this.group);
    this.lastYaw = deps.player.yaw;
    this.lastPitch = deps.player.pitch;
  }

  /**
   * The flashlight is carried at the chest, a hand's width from the gun, so inverse-square falloff blows the viewmodel out.
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

  /** True while a pistol or shotgun reload animation is in progress. */
  get reloading(): boolean {
    return this.reload !== null;
  }

  /** Is this weapon carried? (switching skips the others) */
  owns(id: WeaponId): boolean {
    return id === 'pistol' || (this.d.owns?.(id) ?? true);
  }

  /** Switch to a weapon now (picked up, or a restart took the current one away). */
  equip(id: WeaponId): void {
    if (!this.owns(id)) return;
    this.requestSwitch(id);
  }

  /** Current loaded / reserve for HUD or saves. */
  ammoOf(id: WeaponId): { loaded: number; reserve: number } {
    return this.ammo[id];
  }

  /** Ammo pickup (ADR-0005 step 6): add to a weapon's reserve. */
  addReserve(id: WeaponId, n: number): void {
    const st = this.ammo[id];
    st.reserve = Math.max(0, st.reserve + Math.round(n));
  }

  /** Magazine size of a weapon. */
  magSize(id: WeaponId): number {
    return SPECS[id].mag;
  }

  /** A hit lands on the player: knock the weapon off its pose towards the blow; it settles within about 0.4 s. */
  knock(hit: Pick<HitInfo, 'side' | 'dir'>, severity: number): void {
    const k = hitStrength(severity, this.d.reducedMotion());
    this.knockSide.kick(struckFrom(hit).x * k);
    this.knockHard.kick(k);
  }

  // ---- per frame -----------------------------------------------------------------------

  update(frameDt: number): void {
    const dt = Math.min(frameDt, 1 / 20);
    const { camera, player, input } = this.d;
    this.group.visible = this.d.visible();
    if (!this.group.visible) {
      this.prevFire = input.isDown('fire');
      this.wasVisible = false;
      return;
    }
    this.time += dt;
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    // Unarmed (holster-until-the-drop): the gun is out of view, and drawn the moment Jay is armed.
    let drew = false;
    const armed = this.d.armed?.() ?? true;
    if (armed !== this.gunOut) {
      this.gunOut = armed;
      this.rigs[this.current].root.visible = armed;
      if (armed && this.phase === 'idle') {
        this.startDraw(this.current);
        drew = true;
      }
    }
    // First frame on screen (new game, back from the title or fly mode): the weapon is drawn.
    if (!this.wasVisible) {
      this.wasVisible = true;
      if (this.phase === 'idle' && this.gunOut && !drew) this.startDraw(this.current);
    }

    const active = this.d.enabled();
    this.holster = approach(this.holster, active ? 0 : 1, dt / 0.25);
    this.aimBlend = player.aimBlend;
    this.sprintBlend = approach(this.sprintBlend, player.sprinting ? 1 : 0, dt / 0.18);
    this.cooldown = Math.max(0, this.cooldown - dt);

    const fireDown = input.isDown('fire') && input.locked;
    const rDown = input.isDown('reload');
    const d1 = input.isDown('weapon1');
    const d2 = input.isDown('weapon2');
    if (active && this.holster < 0.4) {
      const wheel = input.consumeWheel();
      if (d1 && !this.prev1) this.requestSwitch('pistol');
      if (d2 && !this.prev2) this.requestSwitch('shotgun');
      if (wheel !== 0) this.requestSwitch(this.current === 'pistol' ? 'shotgun' : 'pistol');
    }
    // A restart to before the armory takes the shotgun back out of Jay's hands.
    if (!this.owns(this.current) && this.pending === null) this.requestSwitch('pistol');
    if (active && this.holster < 0.4) {
      if (rDown && !this.prevR) this.startReload();
      if (fireDown && !this.prevFire) this.tryFire();
    }
    this.prevFire = fireDown;
    this.prevR = rDown;
    this.prev1 = d1;
    this.prev2 = d2;

    this.updateSwitch(dt);
    this.updateReload(dt);
    this.updateTimeline();
    this.rigs[this.current].update(dt);
    this.updatePose(dt);
    this.updateFlash(dt);
  }

  // ---- clip timeline (cues, pump, return to rest) ----------------------------------------

  private schedule(delay: number, weapon: WeaponId, cue: WeaponCue): void {
    this.cues.push({ at: this.time + delay, weapon, cue });
  }

  private clearTimeline(): void {
    this.cues.length = 0;
    this.restAt = Infinity;
    this.rackAt = Infinity;
  }

  /** Play a one-shot clip on the current weapon; afterwards it settles back to the rest pose. */
  private playOnce(clip: ClipName, opts: PlayOptions & { thenRest?: boolean } = {}): number {
    const rig = this.rigs[this.current];
    rig.play(clip, opts);
    const len = rig.duration(clip) / (opts.speed ?? 1);
    this.restAt = opts.thenRest === false ? Infinity : this.time + len;
    return len;
  }

  private updateTimeline(): void {
    const rig = this.rigs[this.current];
    for (let i = this.cues.length - 1; i >= 0; i--) {
      const c = this.cues[i]!;
      if (this.time < c.at) continue;
      this.cues.splice(i, 1);
      this.d.events.emit('weapon:cue', { weapon: c.weapon, cue: c.cue });
    }
    if (this.time >= this.rackAt) {
      this.rackAt = Infinity;
      const { rackFrom, rackFade, slide } = CUES.pistol;
      rig.play('Reload', { fade: rackFade, from: rackFrom });
      this.restAt = this.time + rig.duration('Reload') - rackFrom;
      this.schedule(slide - rackFrom, 'pistol', 'slide');
    }
    if (this.time >= this.restAt && !this.reload && this.phase === 'idle') {
      this.restAt = Infinity;
      rig.playRest(0.12);
    }
  }

  // ---- switching -----------------------------------------------------------------------

  private requestSwitch(to: WeaponId): void {
    if (to === this.current && this.pending === null) return;
    if (this.phase !== 'idle' && this.pending !== null) return;
    if (to === this.current) return;
    if (!this.owns(to)) return;
    this.pending = to;
    if (this.phase === 'idle') {
      this.phase = 'lowering';
      this.phaseT = 0;
      this.cancelReload();
      this.clearTimeline();
      this.playOnce('Hide', { fade: 0.04, thenRest: false });
    }
  }

  /**
   * Bring a weapon up with its Take clip. The shotgun's racks the pump as it comes up; the pistol goes on to rack its
   * slide, which like any rest-bound clip a shot, a reload or a switch cuts short.
   */
  private startDraw(id: WeaponId): void {
    this.cancelReload();
    this.clearTimeline();
    const rig = this.rigs[id];
    rig.play('Take', { fade: 0 });
    const len = rig.duration('Take');
    if (id === 'pistol') this.rackAt = this.time + len;
    else this.restAt = this.time + len;
    this.busyUntil = this.time + Math.min(len, 0.5);
    if (id === 'shotgun') this.schedule(CUES.shotgun.pumpDraw, 'shotgun', 'pump');
  }

  private updateSwitch(dt: number): void {
    if (this.phase === 'idle') return;
    if (this.phase === 'lowering') {
      this.phaseT += dt / this.rigs[this.current].duration('Hide');
      if (this.phaseT >= 1) {
        if (this.pending) {
          this.rigs[this.current].root.visible = false;
          this.current = this.pending;
          this.pending = null;
          this.rigs[this.current].root.visible = true;
          this.startDraw(this.current);
          this.d.events.emit('weapon:equipped', { weapon: this.current });
          this.phaseT = 0;
          this.phase = 'raising';
          this.raiseLen = this.rigs[this.current].duration('Take');
        } else {
          this.phase = 'idle';
        }
      }
    } else {
      this.phaseT += dt / Math.max(this.raiseLen, 0.05);
      if (this.phaseT >= 1) {
        this.phase = 'idle';
        this.phaseT = 0;
        this.wY.kick(-0.5 * SPECS[this.current].feel.weight);
      }
    }
  }

  private raiseLen = 0.3;

  // ---- fire / reload -------------------------------------------------------------------

  private canAct(): boolean {
    return this.phase === 'idle' && this.sprintBlend < 0.35 && this.holster < 0.2 && this.time >= this.busyUntil;
  }

  private tryFire(): void {
    if (!this.canAct() || this.cooldown > 0) return;
    const id = this.current;
    const st = this.ammo[id];
    const rig = this.rigs[id];
    if (this.reload) {
      // Shotgun reloads are interruptible by firing (ADR-0005): drop out of the reload and shoot.
      if (this.reload.kind === 'shotgun' && st.loaded > 0) this.endReload();
      else return;
    }
    if (st.loaded <= 0) {
      this.cooldown = 0.25;
      this.dryTrigger = 0.12;
      this.recZ.kick(0.05);
      this.d.events.emit('weapon:dryFire', { weapon: id });
      return;
    }
    const spec = SPECS[id];
    st.loaded--;
    this.cooldown = spec.interval;
    this.dryTrigger = 0.1;
    this.clearTimeline();
    rig.play('Shoot', { fade: 0.02 });
    this.restAt = this.time + rig.duration('Shoot');
    // The shotgun's Shoot racks the pump about 0.6 s in: the sound, and the spent hull, come with it.
    if (id === 'shotgun') this.schedule(CUES.shotgun.pump, 'shotgun', 'pump');
    const aimDamp = 1 - 0.45 * this.aimBlend;
    this.recZ.kick(spec.recoilZ * aimDamp);
    this.recRx.kick(spec.recoilRx * aimDamp);
    this.recRy.kick((Math.random() - 0.5) * spec.recoilRx * 0.5);
    this.d.player.addKick(spec.kick * (this.d.reducedMotion() ? 0.3 : 1));
    if (spec.feel.twist > 0 && !this.d.reducedMotion()) {
      this.recRz.kick((Math.random() - 0.5) * spec.feel.twist);
      this.wY.kick(-0.6 * spec.feel.weight);
      this.wX.kick((Math.random() - 0.5) * 0.5 * spec.feel.weight);
    }
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
    const rig = this.rigs[id];
    this.clearTimeline();
    if (id === 'pistol') {
      // One reload for a part-full and an empty magazine, at its authored speed.
      const empty = st.loaded === 0;
      this.reload = { kind: 'pistol', t: 0, total: rig.duration('Reload'), empty };
      rig.play('Reload', { fade: 0.08 });
      this.schedule(CUES.pistol.magOut, 'pistol', 'magOut');
      this.schedule(CUES.pistol.magIn, 'pistol', 'magIn');
      this.schedule(CUES.pistol.slide, 'pistol', 'slide');
      this.d.events.emit('weapon:reloadStart', { weapon: id, duration: this.reload.total, empty });
    } else {
      this.reload = { kind: 'shotgun', stage: 'enter', t: 0, shell: 0, inserted: false };
      rig.play('ReloadStart', { fade: 0.1 });
      this.d.events.emit('weapon:reloadStart', { weapon: id });
    }
  }

  /** Leave a reload in progress (fired mid-reload): what has been loaded so far stays. */
  private endReload(): void {
    const r = this.reload;
    if (!r) return;
    this.reload = null;
    const st = this.ammo[this.current];
    this.d.events.emit('weapon:reloaded', { weapon: this.current, loaded: st.loaded, reserve: st.reserve });
  }

  private cancelReload(): void {
    this.reload = null;
    this.cues = this.cues.filter((c) => c.cue === 'pump');
  }

  private updateReload(dt: number): void {
    const r = this.reload;
    if (!r) return;
    r.t += dt;
    if (r.kind === 'pistol') {
      if (r.t >= r.total) this.finishPistolReload();
    } else {
      this.updateShotgunReload(r);
    }
  }

  private finishPistolReload(): void {
    const st = this.ammo.pistol;
    const spec = SPECS.pistol;
    const take = Math.min(spec.mag - st.loaded, st.reserve);
    st.loaded += take;
    st.reserve -= take;
    this.reload = null;
    this.rigs.pistol.playRest(0.1);
    this.d.events.emit('weapon:reloaded', { weapon: 'pistol', loaded: st.loaded, reserve: st.reserve });
  }

  /** ReloadStart, then Reload per shell (the shell seats at CUES.shotgun.shell), then ReloadEnd, which racks the pump. */
  private updateShotgunReload(r: Extract<NonNullable<Reload>, { kind: 'shotgun' }>): void {
    const st = this.ammo.shotgun;
    const rig = this.rigs.shotgun;
    if (r.stage === 'enter') {
      if (r.t >= rig.duration('ReloadStart')) {
        r.stage = 'shell';
        r.t = 0;
        r.inserted = false;
        rig.play('Reload', { fade: 0.05 });
      }
    } else if (r.stage === 'shell') {
      if (!r.inserted && r.t >= CUES.shotgun.shell) {
        r.inserted = true;
        st.loaded++;
        st.reserve--;
        r.shell++;
        this.d.events.emit('weapon:shellInsert', { weapon: 'shotgun' });
      }
      if (r.t >= rig.duration('Reload')) {
        r.t = 0;
        r.inserted = false;
        if (st.loaded >= SPECS.shotgun.mag || st.reserve <= 0) {
          r.stage = 'exit';
          rig.play('ReloadEnd', { fade: 0.05 });
          this.schedule(CUES.shotgun.pumpEnd, 'shotgun', 'pump');
        } else {
          rig.play('Reload', { fade: 0 });
        }
      }
    } else if (r.t >= rig.duration('ReloadEnd')) {
      this.reload = null;
      rig.playRest(0.1);
      this.d.events.emit('weapon:reloaded', { weapon: 'shotgun', loaded: st.loaded, reserve: st.reserve });
    }
  }

  // ---- pose ----------------------------------------------------------------------------

  private lowerAmount(): number {
    return ease(this.holster);
  }

  private updatePose(dt: number): void {
    const { player } = this.d;
    const reduced = this.d.reducedMotion();
    this.dryTrigger = Math.max(0, this.dryTrigger - dt);
    const rig = this.rigs[this.current];
    const poses = SPECS[this.current].poses;
    const feel = SPECS[this.current].feel;
    let aimE = ease(this.aimBlend);
    let sprintE = ease(this.sprintBlend) * (1 - aimE);
    if (feel.soft) {
      // Settle into aim / sprint on a slightly underdamped spring: a little overshoot, then rest.
      const k = 190;
      const c = 20;
      this.aimV += (k * (aimE - this.aimSm) - c * this.aimV) * dt;
      this.aimSm += this.aimV * dt;
      this.sprV += (k * (sprintE - this.sprSm) - c * this.sprV) * dt;
      this.sprSm += this.sprV * dt;
      aimE = THREE.MathUtils.clamp(this.aimSm, -0.02, 1.06);
      sprintE = THREE.MathUtils.clamp(this.sprSm, -0.02, 1.06);
    } else {
      this.aimSm = aimE;
      this.sprSm = sprintE;
      this.aimV = this.sprV = 0;
    }
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
    if (feel.weight > 0) {
      // The gun lags the view: turn right and it trails left, look up and it dips.
      this.wX.kick(THREE.MathUtils.clamp(dyaw / Math.max(dt, 1e-3), -8, 8) * 0.05 * feel.weight * swayScale);
      this.wY.kick(THREE.MathUtils.clamp(-dpitch / Math.max(dt, 1e-3), -8, 8) * 0.04 * feel.weight * swayScale);
    }
    this.swayX.step(dt);
    this.swayY.step(dt);
    this.wX.step(dt);
    this.wY.step(dt);
    this.recRz.step(dt);
    this.recZ.step(dt);
    this.recRx.step(dt);
    this.recRy.step(dt);

    // Bob and strafe lean (the clips carry their own breathing).
    const speed = Math.hypot(player.velocity.x, player.velocity.y);
    const ampGoal = reduced ? 0 : Math.min(1, speed / PLAYER_TUNING.walkSpeed) * (player.sprinting ? 1.5 : 1);
    this.bobAmp = approach(this.bobAmp, ampGoal, dt * 4);
    this.bobPhase += speed * dt * (player.sprinting ? 2.6 : 2.2);
    const bob = this.bobAmp * (1 - 0.7 * aimE);
    const m = reduced ? 0 : 1;
    const lateral = player.velocity.x * Math.cos(player.yaw) - player.velocity.y * Math.sin(player.yaw);
    const leanGoal = THREE.MathUtils.clamp(lateral / PLAYER_TUNING.walkSpeed, -1.4, 1.4) * feel.strafe * m;
    this.lean += (leanGoal - this.lean) * (1 - Math.exp(-dt * 7));
    const B = feel.bob;
    const W = feel.weight;
    pos = [
      pos[0] + Math.sin(this.bobPhase) * 0.004 * bob * B + this.swayX.x * 0.06 * feel.swayPos + this.wX.x * 0.1 * W - this.lean * 0.005,
      pos[1] + Math.abs(Math.cos(this.bobPhase)) * -0.004 * bob * B + this.swayY.x * 0.05 * feel.swayPos + this.wY.x * 0.1 * W,
      pos[2] + this.recZ.x * 1.0,
    ];
    rot = [
      rot[0] + this.recRx.x * 0.1 + this.swayY.x * 0.5 * feel.swayRot + Math.sin(this.bobPhase * 2) * 0.006 * bob * B + this.wY.x * 0.9 * W,
      rot[1] + this.recRy.x * 0.05 + this.swayX.x * 0.5 * feel.swayRot + Math.cos(this.bobPhase) * 0.01 * bob * B - this.wX.x * 1.0 * W,
      rot[2] + this.swayX.x * -0.2 * feel.swayRot + this.recRz.x * 0.08 + Math.sin(this.bobPhase) * 0.006 * bob * (B - 1) - this.lean * 0.045,
    ];

    // Breathing (weapon-viewmodels, "The rest pose is never frozen"): the whole weapon drifts about 1.6 mm and 0.15 degrees, calmer
    // when aimed, and not at all with reduced motion.
    if (!reduced) {
      this.breathPhase += dt * BREATH_RATE;
      const b = this.breathPhase;
      const k = feel.idle * (1 - 0.6 * aimE);
      pos = [pos[0] + Math.sin(b * 0.7) * 0.0008 * k, pos[1] + Math.sin(b) * 0.0016 * k, pos[2]];
      rot = [rot[0] + Math.sin(b + 0.8) * 0.0025 * k, rot[1] + Math.sin(b * 0.6) * 0.0012 * k, rot[2] + Math.sin(b * 0.8 + 1.7) * 0.0016 * k];
    }

    this.knockSide.step(dt);
    this.knockHard.step(dt);
    const side = this.knockSide.x;
    const hard = this.knockHard.x;
    rig.root.position.set(pos[0] + side * KNOCK.x, pos[1] + hard * KNOCK.y, pos[2] + hard * KNOCK.z);
    // Roll and turn follow the side: a blow from the left tips the gun's top and muzzle left.
    rig.root.rotation.set(rot[0], rot[1] - side * KNOCK.yaw, rot[2] - side * KNOCK.roll);
  }

  private updateFlash(dt: number): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = this.flashT > 0;
      // The muzzle follows the recoil animation; the flash itself stays camera-aligned (forward = -Z).
      const rig = this.rigs[this.current];
      rig.root.updateWorldMatrix(true, true);
      rig.muzzle.getWorldPosition(this.tmp);
      this.group.worldToLocal(this.tmp);
      this.flash.position.copy(this.tmp);
      this.flashLight.position.copy(this.tmp);
      this.flashLight.intensity = this.flashT > 0 ? (this.current === 'pistol' ? 6 : 14) : 0;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }

  /** Detach listeners, remove from scene, and dispose weapon/muzzle GPU resources. */
  dispose(): void {
    this.offFootstep();
    this.group.removeFromParent();
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const texSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geoms.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!(m instanceof THREE.Material)) continue;
        mats.add(m);
        const rec = m as unknown as Record<string, unknown>;
        for (const slot of texSlots) {
          const t = rec[slot];
          if (t instanceof THREE.Texture) textures.add(t);
        }
      }
    });
    for (const g of geoms) g.dispose();
    for (const t of textures) disposeTexture(t);
    for (const m of mats) m.dispose();
    this.flashLight.dispose();
    this.fill.dispose();
    this.group.clear();
  }
}
