import * as THREE from 'three';
import type { HumanoidContext } from '../actors/humanoid.ts';
import type { ClearBand, GoreClip } from '../actors/goreClip.ts';
import type { JointName } from '../actors/skeleton.ts';
import type { KillEvent, KillStyle, KillTable } from '../data/types/kills.ts';
import type { TargetRef, Vec3Like } from '../script/types.ts';
import { KillRun } from './killRun.ts';
import type { NpcActor } from './npcActor.ts';

declare module '../core/events.ts' {
  interface EventMap {
    /** A `mauled` victim says a line (her beat's `lines`), from her own head. */
    'kill:say': { npc: string; line: string };
    /** A `mauled` victim's voice stops now (a slam impact, or the throw into the glass). */
    'kill:cut': { npc: string };
    /** A slam impact landed (`n` counts from 1 in its beat): sequences wait on it. */
    'kill:impact': { npc: string; n: number };
    /** Bring a `mauled` attacker's stare forward (the first bang on the glass); `npc` is the victim, or every kill. */
    'kill:notice': { npc?: string };
    /** The attacker stopped to stare at Jay. */
    'kill:noticed': { npc: string; attacker: string };
  }
}

/**
 * Scripted infected kills on NPCs (infection-kills spec), driven by the NPC director's `kill` command. Binds a `KillRun`
 * (pure beat timing) to the victim's body, the gore system, a key light, sounds and the creature that comes out.
 */
export interface KillWorld {
  ctx: HumanoidContext;
  kills: Readonly<KillTable> | undefined;
  emit: (name: string, payload: unknown) => void;
  /** Subscribe to a bus event; returns the unsubscriber. */
  listen: ((name: string, fn: (payload: unknown) => void) => () => void) | undefined;
  /** Play the first of `ids` that exists at `at`; false when none does. */
  sfx: ((ids: readonly string[], at: Vec3Like) => boolean) | undefined;
  warn: (m: string) => void;
  resolve: (ref: TargetRef) => { pos: Vec3Like; yaw?: number | undefined } | null;
  /** Spawn the creature body (a scripted spawn, removed on reset). */
  spawn: (id: string, look: string, at: Vec3Like, yaw: number, pose: string) => NpcActor | null;
  /** Hand a body back to scripted control (no ambient life) while it is in a kill. */
  hold: (id: string) => void;
  /** Is this actor still the live NPC with that id (not despawned or rebuilt)? */
  exists: (id: string, actor: NpcActor) => boolean;
  /** The live NPC with this id (a `mauled` kill's attacker). */
  find: (id: string) => NpcActor | null;
  /** Jay's eye (a `noticed` stare's target). */
  playerEye: () => Vec3Like | null;
}

/** The creature behind the glass after a kill: it hammers on the pane until the level lets it out (the contact scene). */
interface Pounder {
  id: string;
  actor: NpcActor;
  glass: Glass;
  t: number;
  /** Hits in this flurry, and the pause before the next. */
  hits: number;
  rest: number;
  windup: boolean;
}

/** Seconds per half-swing, hits per flurry, and the pause between flurries. */
const POUND = { swing: 0.28, flurry: [3, 6] as const, rest: [0.8, 2.2] as const };

interface Glass {
  /** Unit normal from the pane toward the victim's side. */
  n: THREE.Vector3;
  /** A point on the pane's victim-side face. */
  at: THREE.Vector3;
  clip: GoreClip;
  /** Where the victim stands to pound on it, and the yaw that faces it. */
  stand: THREE.Vector3;
  yaw: number;
  band: ClearBand | undefined;
}

/** `mauled`: the attacker's hand closed on one of the victim's joints. */
interface Grip {
  hand: 'hand_L' | 'hand_R';
  joint: JointName;
}

/** `mauled`: one slam, windup then the impact, with the head held on the surface for a moment. */
interface Slam {
  target: THREE.Vector3;
  t: number;
  /** Swinging down (the hand drives her head toward the surface), then struck (her head is on it). */
  striking: boolean;
  struck: boolean;
  /** The impact's effects wait until her head is on the surface (after the grip this frame). */
  pending: boolean;
}

/** `mauled`: thrown into the glass, then sliding down it. */
interface Throw {
  from: THREE.Vector3;
  to: THREE.Vector3;
  point: THREE.Vector3;
  t: number;
  s: number;
  hit: boolean;
  slide: number;
  rest: THREE.Vector3;
  arc: number;
}

interface ActiveKill {
  npc: string;
  actor: NpcActor;
  run: KillRun;
  /** `mauled`: the body that does the killing, its grip, the named marks from the kill step, and the floor height. */
  attacker: NpcActor | null;
  attackerId: string;
  grip: Grip | null;
  marks: Readonly<Record<string, unknown>>;
  floorY: number;
  slam: Slam | null;
  thrown: Throw | null;
  /** The attacker's held pose (its last `attackerPose`), which it returns to after each slam. */
  attackerPose: string;
  /** The approach in the first beat (`haulTo` there): where it is going, how fast, and whether it has stared yet. */
  approach: { to: THREE.Vector3; speed: number; face: number | undefined } | null;
  stare: { t: number; done: boolean; active: boolean };
  /** Where the current `drag` is taking her (a streak from her hand runs that way). */
  dragTo: THREE.Vector3 | null;
  glass: Glass | null;
  arrived: boolean;
  creature: NpcActor | null;
  creatureId: string;
  creatureLook: string;
  creatureT: number;
  instant: boolean;
  resolve: () => void;
  offs: Array<() => void>;
}

const CREATURE_GROW = 2.2;
/** Poses a body lies in (held through `carried` on a raised corpse). */
const LYING_KILL_POSE = /^(corpse|writhing)/;
/**
 * `mauled` tuning (design decisions 2-3): the grip never moves her more than `gripStep` m a frame (a pose swap cannot
 * teleport her), the attacker hauls and drags at most `haulMax` m/s, a slam winds up for `windup` s and holds her head on
 * the surface for `hold` s, and her root stays within `lift` m of the floor while held.
 */
export const MAUL = { gripStep: 0.5, haulMax: 1.4, windup: 0.32, strike: 0.1, hold: 0.08, lift: [-0.55, 0.15] as const, arc: 0.35, slideS: 0.9 };
/** Crunch variants, rotated so two impacts in a row never use the same one (stand-ins until the recordings exist). */
const CRUNCHES = ['head_crunch_1', 'head_crunch_2', 'head_crunch_3'];
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQv = new THREE.Vector3();

/** Push direction in the body's own frame (it faces -Z, its right is +X). */
function localDir(dir: KillEvent['dir'], out: THREE.Vector3): THREE.Vector3 {
  switch (dir) {
    case 'back':
      return out.set(0, 0, 1);
    case 'left':
      return out.set(-1, 0, 0);
    case 'right':
      return out.set(1, 0, 0);
    case 'up':
      return out.set(0, 1, 0);
    default:
      return out.set(0, 0, -1);
  }
}

export class KillDirector {
  private readonly w: KillWorld;
  private readonly active = new Map<string, ActiveKill>();
  /** The kill's cold white key light (blood reads red under the alarm tint). Always in the scene, so lights never recompile. */
  readonly light: THREE.SpotLight;
  private lightOn = 0;
  private dipFrames = 0;
  private readonly pounders: Pounder[] = [];

  constructor(w: KillWorld, parent: THREE.Object3D) {
    this.w = w;
    this.light = new THREE.SpotLight(0xe8f2ff, 0, 7, THREE.MathUtils.degToRad(34), 0.55, 1.6);
    this.light.name = 'kill-key-light';
    this.light.castShadow = false;
    parent.add(this.light, this.light.target);
  }

  /** Kills in progress, by victim id (tests, debug). */
  running(npc: string): KillRun | null {
    return this.active.get(npc)?.run ?? null;
  }

  start(npc: string, actor: NpcActor, step: Readonly<Record<string, unknown>>, instant: boolean): Promise<void> {
    const kind = typeof step['kind'] === 'string' ? step['kind'] : 'grownInside';
    const style: KillStyle | undefined = this.w.kills?.[kind];
    if (!style) {
      this.w.warn(`kill ${npc}: no kill style "${kind}"`);
      return Promise.resolve();
    }
    this.cancel(npc);
    const body = actor.body;
    const attackerId = typeof step['attacker'] === 'string' ? step['attacker'] : '';
    const attacker = style.kind === 'mauled' ? (attackerId ? this.w.find(attackerId) : null) : null;
    // A restored or skipped kill (instant) needs no attacker: it only lays down the end state.
    if (style.kind === 'mauled' && !attacker && !instant) {
      this.w.warn(`kill ${npc}: a mauled kill needs an "attacker" that exists (got "${attackerId}")`);
      return Promise.resolve();
    }
    if (style.kind === 'converted' && style.beats.length === 1) {
      // Converted: the victim's own body becomes the infected, the old transformation (no creature).
      const dur = style.beats.reduce((s, b) => s + (b.s ?? b.max), 0);
      if (instant || dur <= 0) body.setInfection(3);
      else body.startTransformation(dur);
      return Promise.resolve();
    }
    const cues: Record<string, string> = {};
    const lines = step['lines'];
    if (lines && typeof lines === 'object') for (const [k, v] of Object.entries(lines)) if (typeof v === 'string') cues[k] = v;
    this.w.hold(npc);
    actor.stopMove();
    actor.followTarget(null);
    actor.lookAt(null);
    // A multi-beat converted kill on a corpse (the stinger: the bloom raises Priya): the body moves again.
    if (style.kind === 'converted' && !body.alive) body.reviveAfterKill(style.beats[0]!.poses[0]!);
    body.beginKill();
    if (attacker) {
      // The attacker is held for the whole kill: scripted, no ambient life, nothing else moves it.
      this.w.hold(attackerId);
      attacker.stopMove();
      attacker.followTarget(null);
      attacker.lookAt(null);
      // Its authored upper body holds while it walks (the grip arm does not swing to a walking gait).
      attacker.body.beginKill();
    }
    const marks = step['marks'] && typeof step['marks'] === 'object' ? (step['marks'] as Record<string, unknown>) : {};
    const glass = this.glassFor(actor, step['glass'], style);
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const k: ActiveKill = {
      npc,
      actor,
      glass,
      arrived: glass === null,
      creature: null,
      creatureId: typeof step['creatureId'] === 'string' ? step['creatureId'] : `${npc}_creature`,
      creatureLook: typeof step['creature'] === 'string' ? step['creature'] : (style.creature ?? 'lab_creature'),
      creatureT: 0,
      instant,
      resolve,
      offs: [],
      run: null as unknown as KillRun,
      attacker,
      attackerId,
      grip: null,
      marks,
      floorY: actor.position.y,
      slam: null,
      thrown: null,
      attackerPose: 'maul_grip',
      approach: null,
      stare: { t: 0, done: false, active: false },
      dragTo: null,
    };
    k.run = new KillRun(style, cues, {
      beat: (id, index) => this.w.emit(`kill:${id}`, { npc, beat: id, index }),
      pose: (name, blend) => {
        if (!this.w.ctx.poses.has(name)) return this.w.warn(`kill ${npc}: unknown pose "${name}"`);
        // A raised corpse (multi-beat converted): it is alive again, so lying poses are held as a carried body's are.
        if (style.kind === 'converted' && body.alive) {
          body.carried = LYING_KILL_POSE.test(name) ? name : null;
          if (body.carried) return;
        }
        if (body.alive || name.startsWith('corpse')) body.setPose(name, k.instant ? 0.01 : blend);
      },
      // A captured clip (a raised corpse getting up): only on a living body, and never in a skipped scene.
      // The clip may move the body's origin under where it lies: the actor follows (the body is not teleported).
      clip: (id, blend) => {
        if (!body.alive || k.instant) return null;
        const duration = body.playKillClip(id, blend);
        if (duration !== null) actor.place(actor.position.clone());
        return duration;
      },
      clipPhase: (u) => body.killClipPhase(u),
      convulse: (target, rate) => body.killConvulse(target, rate),
      bulge: (i, path, t, radius, amp) => body.setBulge(i, path as JointName[], t, radius, amp),
      event: (e) => this.event(k, e),
      facesGlass: () => k.glass !== null && (this.atGlass(k) || k.instant),
      arrived: () => this.atGlass(k),
      creatureReady: () => k.creature === null || k.creature.body.alive,
      done: () => this.finish(k),
      say: (line) => {
        if (!k.instant) this.w.emit('kill:say', { npc, line });
      },
      cutVoice: () => this.w.emit('kill:cut', { npc }),
    });
    k.run.warn = (m) => this.w.warn(`kill ${npc}: ${m}`);
    const listen = this.w.listen;
    if (listen) k.offs.push(listen('speech:ended', (p) => k.run.lineEnded(String((p as { id?: unknown } | null)?.id ?? ''))));
    // "It notices him": a script brings the stare forward (the first bang on the glass).
    if (listen && style.noticed) k.offs.push(listen('kill:notice', (p) => {
      const who = (p as { npc?: unknown } | null)?.npc;
      if (who === undefined || who === npc) this.notice(k);
    }));
    this.active.set(npc, k);
    if (instant) {
      if (glass) actor.place(glass.stand, glass.yaw);
      if (style.kind === 'mauled') this.endMarks(k);
      k.run.finishNow();
    }
    return done;
  }

  update(dt: number): void {
    for (const k of [...this.active.values()]) {
      k.run.update(dt);
      if (k.slam) this.updateSlam(k, dt);
      this.updateStare(k, dt);
      // At the glass she leans the last few centimetres in, so her palms meet the pane (walks stop a little short).
      const g = k.glass;
      // (Not while a mauled attacker holds her, throws her or drags her: then the grip or the flight places her.)
      const free = k.grip === null && k.thrown === null && k.actor.body.carried === null;
      if (g && free && k.arrived && k.actor.body.alive && k.run.beatId !== 'scratch' && k.run.beatId !== 'panic') {
        const p = k.actor.position;
        const f = Math.min(1, dt * 6);
        const x = p.x + (g.stand.x - p.x) * f;
        const z = p.z + (g.stand.z - p.z) * f;
        if (Math.hypot(g.stand.x - p.x, g.stand.z - p.z) > 0.005) k.actor.place({ x, y: p.y, z }, g.yaw);
      }
      const c = k.creature;
      if (c && k.creatureT < CREATURE_GROW) {
        k.creatureT = Math.min(CREATURE_GROW, k.creatureT + dt);
        const f = k.creatureT / CREATURE_GROW;
        c.body.group.scale.setScalar(0.6 + 0.4 * (1 - (1 - f) ** 2));
      }
    }
    this.updatePounders(dt);
    if (this.dipFrames > 0) {
      this.dipFrames--;
      this.light.intensity = 0;
      if (this.dipFrames === 0) this.light.intensity = this.lightOn;
    }
  }

  /**
   * After every body has moved and posed this frame: a gripped victim goes back into the attacker's hand (her gripped
   * joint onto its hand, or onto the slam surface while an impact holds), and a thrown one flies and slides.
   */
  lateUpdate(dt: number): void {
    for (const k of this.active.values()) {
      if (k.thrown) this.updateThrow(k, dt);
      else if (k.grip && k.attacker) this.applyGrip(k);
      if (k.slam?.pending) {
        k.slam.pending = false;
        this.impact(k, k.slam);
      }
    }
  }

  /** The gripped joint of `npc`'s victim and the attacker's hand holding it (tests, debug). */
  gripPoints(npc: string): { joint: THREE.Vector3; hand: THREE.Vector3 } | null {
    const k = this.active.get(npc);
    if (!k?.grip || !k.attacker) return null;
    return { joint: k.actor.body.jointWorld(k.grip.joint, new THREE.Vector3()), hand: k.attacker.body.jointWorld(k.grip.hand, new THREE.Vector3()) };
  }

  private applyGrip(k: ActiveKill): void {
    const g = k.grip!;
    const a = k.attacker!;
    const v = k.actor;
    const slam = k.slam;
    const holding = slam !== null && slam.struck && slam.t < MAUL.windup + MAUL.strike + MAUL.hold;
    const target = holding ? slam.target : a.body.jointWorld(g.hand, tmpA).clone();
    // Her body hangs away from the hand: she faces away from the attacker.
    const j0 = v.body.jointWorld(g.joint, tmpB);
    const ax = j0.x - a.position.x;
    const az = j0.z - a.position.z;
    if (Math.hypot(ax, az) > 0.05) {
      const h = Math.atan2(-ax, -az);
      let dh = h - v.body.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(dh) > 0.02) v.body.setHeading(v.body.heading + Math.sign(dh) * Math.min(Math.abs(dh), 0.25));
    }
    for (let i = 0; i < 2; i++) {
      const j = v.body.jointWorld(g.joint, tmpB);
      const d = tmpQv.copy(target).sub(j);
      const len = d.length();
      if (len < 1e-4) break;
      if (len > MAUL.gripStep) d.multiplyScalar(MAUL.gripStep / len);
      const p = v.position;
      const y = Math.min(k.floorY + MAUL.lift[1], Math.max(k.floorY + MAUL.lift[0], p.y + d.y));
      v.place({ x: p.x + d.x, y, z: p.z + d.z });
    }
  }

  private mark(k: ActiveKill, name: string | undefined): THREE.Vector3 | null {
    const ref = name ? k.marks[name] : undefined;
    const r = ref !== undefined ? this.w.resolve(ref as TargetRef) : null;
    if (!r) {
      this.w.warn(`kill ${k.npc}: no mark "${name}" on the kill step`);
      return null;
    }
    return new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z);
  }

  private release(k: ActiveKill): void {
    k.grip = null;
  }

  /** Is the attacker stopped and staring at Jay right now (tests, debug)? */
  staring(npc: string): boolean {
    return this.active.get(npc)?.stare.active ?? false;
  }

  /** Bring the stare forward (once, only during the first beat while it approaches). */
  private notice(k: ActiveKill): void {
    if (k.stare.done || k.instant || !k.attacker || k.run.beat !== k.run.style.beats[0]) return;
    this.beginStare(k);
  }

  private beginStare(k: ActiveKill): void {
    const a = k.attacker!;
    const n = k.run.style.noticed!;
    k.stare.done = true;
    k.stare.active = true;
    k.stare.t = 0;
    a.stopMove();
    const eye = this.w.playerEye();
    if (eye) {
      const yaw = Math.atan2(-(eye.x - a.position.x), -(eye.z - a.position.z));
      a.turnTo(yaw);
    }
    a.body.setPose(n.pose ?? 'stare', 0.35);
    this.w.emit('kill:noticed', { npc: k.npc, attacker: k.attackerId });
  }

  private updateStare(k: ActiveKill, dt: number): void {
    const n = k.run.style.noticed;
    const a = k.attacker;
    if (!n || !a || k.instant) return;
    const first = k.run.style.beats[0]!;
    if (!k.stare.done && k.run.beat === first && k.run.beatTime >= n.at) this.beginStare(k);
    if (!k.stare.active) return;
    k.stare.t += dt;
    if (k.stare.t < n.hold && k.run.beat === first) return;
    k.stare.active = false;
    a.body.setPose(k.attackerPose, 0.4);
    a.turnTo(null);
    // Back to her, making up the hold so the grab still starts on time (at most MAUL.haulMax).
    const ap = k.approach;
    if (!ap || k.run.beat !== first) return;
    const left = (first.s ?? first.max) - k.run.beatTime - 0.25;
    const dist = Math.hypot(ap.to.x - a.position.x, ap.to.z - a.position.z);
    const speed = Math.min(MAUL.haulMax, Math.max(ap.speed, left > 0.05 ? dist / left : MAUL.haulMax));
    void a.moveTo({ x: ap.to.x, y: a.position.y, z: ap.to.z }, { speed, ...(ap.face !== undefined ? { yaw: ap.face } : {}) });
  }

  private updateSlam(k: ActiveKill, dt: number): void {
    const s = k.slam!;
    const a = k.attacker;
    s.t += dt;
    if (!s.striking && s.t >= MAUL.windup) {
      s.striking = true;
      a?.body.setPose(this.w.ctx.poses.has('maul_impact') ? 'maul_impact' : 'kill_glass_0', MAUL.strike);
    }
    if (!s.struck && s.t >= MAUL.windup + MAUL.strike) {
      s.struck = true;
      s.pending = true;
    }
    if (s.struck && !s.pending && s.t >= MAUL.windup + MAUL.strike + MAUL.hold) {
      k.slam = null;
      a?.body.setPose(k.attackerPose, 0.3);
    }
  }

  /** One slam lands: her head on the surface, the hooks, the blood, the sound. */
  private impact(k: ActiveKill, s: Slam): void {
    const n = k.run.impact();
    const body = k.actor.body;
    this.w.emit('kill:impact', { npc: k.npc, n });
    if (k.instant) return;
    body.killKick('head', localDir('up', tmpA), 0.6 + 0.3 * n);
    body.killKick('neck', localDir('up', tmpA), 0.4 + 0.2 * n);
    const head = body.jointWorld('head', tmpA).clone();
    const gore = this.w.ctx.gore;
    const bone = body.bones['head'];
    bone.getWorldQuaternion(tmpQ).invert();
    // Clipped at the pane: none of it reaches Jay's side of the glass.
    gore.spurt(bone, new THREE.Vector3(), new THREE.Vector3(0, 0.6, 0).add(head.clone().sub(k.attacker?.position ?? head).setY(0).normalize()).normalize().applyQuaternion(tmpQ), 0.6 + 0.3 * n, undefined, k.glass?.clip);
    gore.pool(s.target.clone(), 0.25 + 0.15 * n);
    const order = CRUNCHES.slice((n - 1) % CRUNCHES.length).concat(CRUNCHES.slice(0, (n - 1) % CRUNCHES.length));
    if (this.w.sfx && !this.w.sfx([...order, 'kill_crunch', 'fleshTear'], head)) this.w.warn(`kill ${k.npc}: no head crunch sound yet`);
    this.w.sfx?.(['cart_impact', 'metalKnock'], s.target);
  }

  private startThrow(k: ActiveKill, e: KillEvent): void {
    const point = this.mark(k, e.mark);
    if (!point) return;
    k.grip = null;
    const v = k.actor;
    // The way into the room from the pane: the glass's own normal when the kill has one, else back toward where she was.
    const n = k.glass ? k.glass.n.clone() : v.position.clone().sub(point).setY(0).normalize();
    // Back first into the pane: she faces away from it.
    v.body.setHeading(Math.atan2(-n.x, -n.z));
    const from = v.position.clone();
    const to = point.clone().addScaledVector(n, 0.32).setY(k.floorY);
    // Where she comes to rest at the foot of the pane: far enough out that she can kneel and reach up the glass.
    const rest = point.clone().addScaledVector(n, 0.6).setY(k.floorY);
    k.thrown = { from, to, point, t: 0, s: e.s ?? 0.5, hit: false, slide: 0, rest, arc: e.arc ?? MAUL.arc };
    if (k.instant) {
      v.place(rest);
      k.thrown = null;
    }
  }

  private updateThrow(k: ActiveKill, dt: number): void {
    const th = k.thrown!;
    const v = k.actor;
    if (!th.hit) {
      th.t = Math.min(1, th.t + dt / th.s);
      const p = th.from.clone().lerp(th.to, th.t);
      p.y = k.floorY + 4 * th.arc * th.t * (1 - th.t);
      v.place(p);
      if (th.t < 1) return;
      // Contact: her head (or upper back) meets the pane at the aimed point.
      const head = v.body.jointWorld('head', tmpA);
      const d = tmpQv.copy(th.point).sub(head);
      const y = Math.min(k.floorY + MAUL.lift[1], Math.max(k.floorY + MAUL.lift[0], v.position.y + d.y));
      v.place({ x: v.position.x + d.x * 0.6, y, z: v.position.z });
      th.hit = true;
      this.contact(k, th);
      return;
    }
    th.slide = Math.min(1, th.slide + dt / MAUL.slideS);
    const p = v.position.clone();
    const f = Math.min(1, dt * 5);
    p.x += (th.rest.x - p.x) * f;
    p.z += (th.rest.z - p.z) * f;
    p.y = p.y + (k.floorY - p.y) * Math.min(1, th.slide * 1.6);
    v.place(p);
    if (th.slide >= 1) {
      v.place({ x: p.x, y: k.floorY, z: p.z });
      k.thrown = null;
    }
  }

  /** Thrown into the glass: the crack and splat where her head struck, the sound, and her voice stops. */
  private contact(k: ActiveKill, th: Throw): void {
    this.w.emit('kill:cut', { npc: k.npc });
    this.w.emit('kill:thrown', { npc: k.npc, at: { x: th.point.x, y: th.point.y, z: th.point.z } });
    if (k.instant) return;
    const body = k.actor.body;
    body.killKick('chest', localDir('fwd', tmpA), 1.2);
    body.killKick('head', localDir('fwd', tmpA), 0.9);
    const n = k.glass?.n ?? new THREE.Vector3(0, 0, 1);
    const band = k.glass?.band;
    // One crack centred where her head struck, and the blood from it (medbay-attack "Crack centred on the impact").
    const at = th.point.clone();
    if (k.glass) {
      if (k.glass.clip.axis === 'z') at.z = k.glass.at.z;
      else at.x = k.glass.at.x;
    }
    this.w.ctx.gore.glassMark(at, n, 'crack', 0.7);
    this.w.ctx.gore.glassMark(at.clone(), n, 'splat', 0.42, band ? { band } : {});
    this.w.sfx?.(['body_glass_hit', 'creature_glass_hit', 'glassThud'], th.point);
    this.w.sfx?.(['blood_splat_glass', 'glassThud'], th.point);
  }

  /**
   * A mauled kill's marks as it leaves them (a restore or a skip, medbay-attack "Skip and restore give the end state"):
   * an authored set on its pane, from its marks - her two palm prints where she pleaded, the crack and splat where her
   * head struck (`throwAt`), and the streak her hand left as she was dragged off toward `exit`. Nothing on other panes.
   */
  private endMarks(k: ActiveKill): void {
    const g = k.glass;
    if (!g) return;
    const gore = this.w.ctx.gore;
    const onPane = (p: THREE.Vector3): THREE.Vector3 => {
      const q = p.clone();
      if (g.clip.axis === 'z') q.z = g.at.z;
      else q.x = g.at.x;
      return q;
    };
    const side = new THREE.Vector3(-g.n.z, 0, g.n.x);
    for (const s of [-0.22, 0.24]) gore.glassMark(onPane(g.at.clone().addScaledVector(side, s).setY(k.floorY + 1.3)), g.n, 'print', 0.22);
    const hit = this.mark(k, 'throwAt');
    if (hit) {
      gore.glassMark(onPane(hit), g.n, 'crack', 0.7);
      gore.glassMark(onPane(hit), g.n, 'splat', 0.42, g.band ? { band: g.band } : {});
    }
    const exit = k.marks['exit'] !== undefined ? this.mark(k, 'exit') : null;
    const from = onPane(g.at.clone().setY(k.floorY + 1.1));
    const along = exit ? exit.clone().sub(from).setY(0) : side.clone();
    along.addScaledVector(g.n, -along.dot(g.n));
    gore.glassMark(from, g.n, 'streak', 1.1, { along, run: 0.05 });
  }

  /** New game or load: every kill stops where it is (the director rebuilds the bodies). */
  reset(): void {
    for (const npc of [...this.active.keys()]) this.cancel(npc);
    this.pounders.length = 0;
    this.lightOn = 0;
    this.dipFrames = 0;
    this.light.intensity = 0;
  }

  private cancel(npc: string): void {
    const k = this.active.get(npc);
    if (!k) return;
    k.actor.gripped = false;
    k.actor.body.carried = null;
    k.attacker?.body.endKill();
    for (const off of k.offs) off();
    this.active.delete(npc);
    k.resolve();
  }

  private finish(k: ActiveKill): void {
    k.actor.gripped = false;
    k.actor.body.carried = null;
    k.attacker?.body.endKill();
    k.grip = null;
    k.slam = null;
    k.thrown = null;
    for (const off of k.offs) off();
    k.offs.length = 0;
    k.actor.body.endKill();
    this.setLight(k, 'off');
    if (this.active.get(k.npc) === k) this.active.delete(k.npc);
    if (k.creature) k.creature.body.group.scale.setScalar(1);
    this.startPounding(k);
    this.w.emit('kill:done', { npc: k.npc });
    k.resolve();
  }

  private glassFor(actor: NpcActor, ref: unknown, style: KillStyle): Glass | null {
    if (ref === undefined || ref === null) return null;
    const r = this.w.resolve(ref as TargetRef);
    if (!r) {
      this.w.warn(`kill ${actor.id}: cannot resolve glass ${JSON.stringify(ref)}`);
      return null;
    }
    const me = actor.position;
    const dx = me.x - r.pos.x;
    const dz = me.z - r.pos.z;
    // The pane is axis-aligned: its normal is the dominant axis toward the victim.
    const alongZ = Math.abs(dz) >= Math.abs(dx);
    const sign = (alongZ ? dz : dx) >= 0 ? 1 : -1;
    const n = alongZ ? new THREE.Vector3(0, 0, sign) : new THREE.Vector3(sign, 0, 0);
    const at = new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z).addScaledVector(n, 0.06);
    const clip: GoreClip = { axis: alongZ ? 'z' : 'x', at: alongZ ? at.z : at.x, keep: sign > 0 ? 'above' : 'below' };
    const standOff = style.glassStand ?? 0.5;
    const stand = at.clone().addScaledVector(n, standOff).setY(me.y);
    // Facing the pane: looking along -n.
    const yaw = Math.atan2(n.x, n.z);
    const band = style.clearBand ? { min: me.y + style.clearBand.min, max: me.y + style.clearBand.max } : undefined;
    return { n, at, clip, stand, yaw, band };
  }

  /** Reached the glass: the walk is over and she is by her spot (walks stop a little short; she leans the rest). */
  private atGlass(k: ActiveKill): boolean {
    if (k.arrived) return true;
    const g = k.glass;
    if (!g) return true;
    const p = k.actor.position;
    if (!k.actor.busy && Math.hypot(g.stand.x - p.x, g.stand.z - p.z) < 0.5) k.arrived = true;
    return k.arrived;
  }

  private forward(k: ActiveKill, out: THREE.Vector3): THREE.Vector3 {
    if (k.glass) return out.copy(k.glass.n).negate();
    const h = k.actor.body.heading;
    return out.set(-Math.sin(h), 0, -Math.cos(h));
  }

  private event(k: ActiveKill, e: KillEvent): void {
    const body = k.actor.body;
    const gore = this.w.ctx.gore;
    switch (e.do) {
      case 'pose':
        if (e.pose) body.setPose(e.pose, k.instant ? 0.01 : (e.blend ?? 0.25));
        return;
      case 'sfx': {
        if (k.instant || !e.id) return;
        const at = body.jointWorld(e.joint ?? 'head', tmpA);
        if (this.w.sfx && !this.w.sfx(e.id, at)) this.w.warn(`kill ${k.npc}: no sound "${e.id.join('" or "')}" yet`);
        return;
      }
      case 'kick':
        if (k.instant || !e.joint) return;
        body.killKick(e.joint, localDir(e.dir, tmpA), e.strength ?? 0.6);
        return;
      case 'gore': {
        if (k.instant) return;
        const at = body.jointWorld(e.joint ?? 'chest', tmpA).clone();
        const fwd = this.forward(k, tmpB);
        const clip = k.glass?.clip;
        if (e.kind === 'burst') gore.burst(at, fwd.clone().multiplyScalar(1.6).setY(0.35), e.count ?? 120, undefined, clip);
        else if (e.kind === 'chunks') gore.chunks(at, fwd.clone().setY(0.4), e.count ?? 12, clip);
        else if (e.kind === 'pool') gore.pool(at.setY(0), e.size ?? 1.4);
        else if (e.kind === 'spurt') {
          const bone = body.bones[e.joint ?? 'chest'];
          bone.getWorldQuaternion(tmpQ).invert();
          gore.spurt(bone, new THREE.Vector3(), fwd.clone().setY(0.25).normalize().applyQuaternion(tmpQ), e.s ?? 3, undefined, clip);
        }
        return;
      }
      case 'glass':
        if (!k.instant) this.glassMark(k, e);
        return;
      case 'tear':
        body.tearChest(e.radius ?? 0.16);
        return;
      case 'die':
        body.killDie(e.pose ?? 'corpseSupine', k.instant ? 0.01 : (e.blend ?? 0.5));
        return;
      case 'creature':
        this.spawnCreature(k, e);
        return;
      case 'light':
        this.setLight(k, e.state ?? 'on');
        return;
      case 'toGlass': {
        const g = k.glass;
        if (!g || k.instant) {
          k.arrived = true;
          return;
        }
        void k.actor.moveTo(g.stand, { speed: e.speed ?? 1.5, yaw: g.yaw });
        return;
      }
      case 'stinger':
        // adaptive-music: the score plays it on the victim's hit (a skipped kill plays none).
        if (!k.instant && e.id?.[0]) this.w.emit('score:stinger', { id: e.id[0], npc: k.npc });
        return;
      case 'face': {
        // Toward a mark (the stinger's camera), else to face the glass.
        const at = e.mark ? this.mark(k, e.mark) : null;
        const p = k.actor.position;
        const yaw = at ? Math.atan2(-(at.x - p.x), -(at.z - p.z)) : k.glass?.yaw;
        if (yaw === undefined) return;
        k.actor.turnTo(yaw);
        if (k.instant || !at) body.setHeading(yaw);
        if (at) k.actor.lookAt(() => at);
        return;
      }
      case 'infect':
        body.setInfection(e.stage ?? 3);
        return;
      case 'pin': {
        const a = k.attacker;
        if (!a) return;
        // Behind her and to her right, in her own frame (she faces -Z rotated by her heading); facing the way she faces.
        const h = body.heading;
        const v = k.actor.position;
        const behind = e.behind ?? 0.45;
        const side = e.side ?? 0;
        a.stopMove();
        // `away`: its back to her (it drags her by the ankle, its hand trailing behind it).
        a.place({ x: v.x + Math.sin(h) * behind + Math.cos(h) * side, y: v.y, z: v.z + Math.cos(h) * behind - Math.sin(h) * side }, e.facing === 'away' ? h + Math.PI : h);
        return;
      }
      case 'attackerPose':
        if (k.attacker && e.pose) {
          k.attackerPose = e.pose;
          k.attacker.body.setPose(e.pose, k.instant ? 0.01 : (e.blend ?? 0.25));
        }
        return;
      case 'grip':
        if (e.release) this.release(k);
        else if (e.joint) {
          k.grip = { hand: e.hand === 'L' ? 'hand_L' : 'hand_R', joint: e.joint };
          k.actor.gripped = true;
          k.actor.stopMove();
        }
        return;
      case 'haulTo':
      case 'drag': {
        const a = k.attacker;
        const at = this.mark(k, e.mark);
        if (!a || !at) return;
        // Dragged along the floor: she holds the beat's lying pose, her legs never step.
        if (e.do === 'drag') {
          k.actor.body.carried = k.run.style.beats.find((b) => b.id === k.run.beatId)?.poses[0] ?? 'corpseProne';
          k.dragTo = at.clone();
        }
        // On arrival it turns to face `faceMark` (the cart it will slam her on), else it keeps the way it walked.
        const face = e.faceMark ? this.mark(k, e.faceMark) : null;
        const yaw = face ? Math.atan2(-(face.x - at.x), -(face.z - at.z)) : Math.atan2(-(at.x - a.position.x), -(at.z - a.position.z));
        // In the first beat this is the approach: a stare can interrupt it, and the walk then makes up the time.
        if (k.run.beat === k.run.style.beats[0]) k.approach = { to: at.clone(), speed: Math.min(e.speed ?? 1.0, MAUL.haulMax), face: face ? yaw : undefined };
        if (k.instant) a.place(at.setY(a.position.y), yaw);
        else if (!k.stare.active) void a.moveTo({ x: at.x, y: a.position.y, z: at.z }, { speed: Math.min(e.speed ?? 1.0, MAUL.haulMax), ...(face ? { yaw } : {}) });
        return;
      }
      case 'slam': {
        const at = this.mark(k, e.mark);
        if (!at) return;
        k.slam = { target: at, t: 0, striking: false, struck: false, pending: false };
        k.attacker?.body.setPose(this.w.ctx.poses.has('maul_windup') ? 'maul_windup' : 'kill_glass_1', k.instant ? 0.01 : MAUL.windup * 0.8);
        return;
      }
      case 'throw':
        this.startThrow(k, e);
        return;
    }
  }

  private glassMark(k: ActiveKill, e: KillEvent): void {
    const g = k.glass;
    if (!g) return;
    const kind = (e.kind ?? 'splat') as 'print' | 'splat' | 'streak' | 'crack';
    const body = k.actor.body;
    // Marks come from where she touches the glass: her palm, her head, or (Lab B) her chest.
    const from: JointName = kind === 'print' || e.dir === 'pull' ? (e.hand === 'R' ? 'hand_R' : 'hand_L') : kind === 'crack' ? 'head' : 'chest';
    const p = body.jointWorld(from, tmpA).clone();
    // Onto the pane's face.
    if (g.clip.axis === 'z') p.z = g.at.z;
    else p.x = g.at.x;
    if (e.dir === 'pull') {
      // A hand pulled along the pane: the streak runs from it the way she is dragged, on the glass.
      const toward = k.dragTo ?? k.attacker?.position ?? null;
      const pull = (toward ? toward.clone().sub(k.actor.position) : new THREE.Vector3(-g.n.z, 0, g.n.x)).setY(0);
      pull.addScaledVector(g.n, -pull.dot(g.n));
      this.w.ctx.gore.glassMark(p, g.n, 'streak', e.size ?? 0.9, { along: pull, ...(e.s !== undefined ? { run: e.s } : {}) });
      if (!k.instant) this.w.sfx?.(['glass_squeak', 'creak'], p);
      return;
    }
    if (kind === 'crack') {
      this.w.ctx.gore.glassMark(p, g.n, 'crack', e.size ?? 0.6);
      return;
    }
    const side = new THREE.Vector3(-g.n.z, 0, g.n.x);
    const rng = (a: number, b: number): number => a + Math.random() * (b - a);
    if (kind === 'splat') {
      p.addScaledVector(side, rng(-0.55, 0.55));
      // Above the face or low on the pane; the clear band moves anything that lands in it.
      p.y = Math.random() < 0.5 ? rng(g.band ? g.band.max + 0.1 : 1.9, (g.band?.max ?? 1.8) + 0.45) : rng(0.35, g.band ? g.band.min - 0.05 : 1.0);
    } else if (kind === 'streak') {
      p.addScaledVector(side, rng(-0.25, 0.25));
      p.y = g.band ? g.band.min - 0.02 : p.y - 0.2;
    }
    this.w.ctx.gore.glassMark(p, g.n, kind, e.size ?? 0.25, { ...(g.band ? { band: g.band } : {}), ...(e.s !== undefined ? { run: e.s } : {}) });
  }

  private setLight(k: ActiveKill, state: 'on' | 'off' | 'dip'): void {
    if (state === 'off' || k.instant) {
      this.lightOn = 0;
      this.dipFrames = 0;
      this.light.intensity = 0;
      return;
    }
    if (state === 'dip') {
      this.dipFrames = 2;
      return;
    }
    const body = k.actor.body;
    const chest = body.jointWorld('chest', tmpA);
    const n = k.glass?.n ?? this.forward(k, tmpB).negate();
    // Just inside the room by the glass, high, looking down at her front.
    const from = k.glass ? k.glass.at.clone().addScaledVector(n, 0.25) : chest.clone().addScaledVector(n, -1.2);
    this.light.position.set(from.x, chest.y + 1.1, from.z);
    this.light.target.position.copy(chest);
    this.light.target.updateMatrixWorld();
    this.lightOn = 26;
    this.light.intensity = this.lightOn;
  }

  /** Is a creature hammering on the glass (tests, debug)? */
  pounding(id: string): boolean {
    return this.pounders.some((p) => p.id === id);
  }

  private startPounding(k: ActiveKill): void {
    const c = k.creature;
    const g = k.glass;
    if (!c || !g || this.pounding(k.creatureId)) return;
    // Beside her body, not on it.
    const side = new THREE.Vector3(-g.n.z, 0, g.n.x);
    const spot = g.stand.clone().addScaledVector(side, 0.75).addScaledVector(g.n, -0.05);
    if (k.instant) c.place(spot, g.yaw);
    else void c.moveTo(spot, { speed: 1.1, yaw: g.yaw });
    this.pounders.push({ id: k.creatureId, actor: c, glass: g, t: 0, hits: 0, rest: k.instant ? 0.5 : 1.2, windup: true });
  }

  private updatePounders(dt: number): void {
    for (let i = this.pounders.length - 1; i >= 0; i--) {
      const p = this.pounders[i]!;
      if (!this.w.exists(p.id, p.actor)) {
        this.pounders.splice(i, 1);
        continue;
      }
      const body = p.actor.body;
      if (p.actor.busy || !body.alive) continue; // still walking to the glass
      if (p.rest > 0) {
        p.rest -= dt;
        if (p.rest <= 0) {
          p.hits = POUND.flurry[0] + Math.floor(Math.random() * (POUND.flurry[1] - POUND.flurry[0] + 1));
          // infection-kills "Creature blows are reported": the score makes room for the flurry (adaptive-music).
          this.w.emit('creature:pound', { npc: p.id });
        }
        else if (p.rest < 0.25) body.setPose('kill_glass_1', 0.2);
        continue;
      }
      p.t += dt;
      if (p.t < POUND.swing) continue;
      p.t = 0;
      p.windup = !p.windup;
      if (p.windup) {
        body.setPose('kill_glass_1', POUND.swing * 0.8);
        continue;
      }
      // The blow lands on the glass.
      body.setPose('kill_glass_0', POUND.swing * 0.5);
      body.killKick('chest', tmpA.set(0, 0, 1), 0.5);
      const at = body.jointWorld(Math.random() < 0.5 ? 'hand_L' : 'hand_R', tmpB).clone();
      if (p.glass.clip.axis === 'z') at.z = p.glass.at.z;
      else at.x = p.glass.at.x;
      this.w.sfx?.(['creature_glass_hit', 'glassThud'], at);
      p.hits--;
      if (p.hits <= 0) {
        p.rest = POUND.rest[0] + Math.random() * (POUND.rest[1] - POUND.rest[0]);
        if (Math.random() < 0.6) this.w.sfx?.(['creature_clicks', 'zombieVoice'], body.jointWorld('head', tmpB));
      }
    }
  }

  private spawnCreature(k: ActiveKill, e: KillEvent): void {
    if (k.creature) return;
    const body = k.actor.body;
    const at = body.jointWorld('chest', tmpA).clone().setY(k.actor.position.y);
    const yaw = k.glass?.yaw ?? body.heading;
    const c = this.w.spawn(k.creatureId, k.creatureLook, at, yaw, 'shamble');
    if (!c) return;
    k.creature = c;
    if (k.instant) {
      k.creatureT = CREATURE_GROW;
      return;
    }
    // Curled at her chest, small, then it unfolds and stands (the burst covers the first moments).
    k.creatureT = 0;
    c.body.group.scale.setScalar(0.6);
    c.body.playDead(e.pose ?? 'getUp_0');
    c.body.getUp();
  }
}
