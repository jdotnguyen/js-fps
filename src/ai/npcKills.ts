import * as THREE from 'three';
import { bladeCreatureProfile } from '../actors/bodyModelLibrary.ts';
import type { HumanoidContext } from '../actors/humanoid.ts';
import type { ClearBand, GoreClip } from '../actors/goreClip.ts';
import { JOINT_NAMES, type JointName } from '../actors/skeleton.ts';
import { beatTrack, clipSpeedAt, type KillBeat, type KillEvent, type KillStyle, type KillTable, type TouchPart } from '../data/types/kills.ts';
import type { TargetRef, Vec3Like } from '../script/types.ts';
import { KillRoute, yawAlong, type RouteKnot } from './killRoute.ts';
import { KillRun } from './killRun.ts';
import type { NpcActor } from './npcActor.ts';

declare module '../core/events.ts' {
  interface EventMap {
    /** A `mauled` victim says a line (her beat's `lines`), from her own head. */
    'kill:say': { npc: string; line: string };
    /** A `mauled` victim's voice stops now (a slam impact, or the throw into the glass). */
    'kill:cut': { npc: string };
    /** A slam impact landed (`n` counts from 1 in its beat) at `at`: sequences wait on it, the view jolts with it. */
    'kill:impact': { npc: string; n: number; at?: Vec3Like; instant?: boolean };
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
  /** Play the first of `ids` that exists at `at` (as `variant`, else a random one); false when none does. */
  sfx: ((ids: readonly string[], at: Vec3Like, gain?: number, variant?: number) => boolean) | undefined;
  /** A low creature growl or groan (a short slice of a recorded one) from `at`. */
  growl?: ((at: Vec3Like) => void) | undefined;
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
  /** Knock over loose props near a point (physics on only); `done` holds the ones already hit. */
  knock?: ((from: Vec3Like, travel: Vec3Like, reach: number, strength: number, done: Set<string>) => void) | undefined;
  /** Throw the loose props near a slam's impact up and away (physics on only; livelier-cart-slam D4). */
  burst?: ((at: Vec3Like, reach: number, strength: number, opts: { up?: number; along?: Vec3Like; toward?: Vec3Like; seed?: string }) => void) | undefined;
  /** A movable prop's pose (the cart a slam lands on), and moving it: its meshes, collision and body (D3). */
  propPose?: ((id: string) => { pos: THREE.Vector3; rotation: THREE.Quaternion } | null) | undefined;
  moveProp?: ((id: string, pos: THREE.Vector3, rotation: THREE.Quaternion) => void) | undefined;
  /** Lay out a prop group at its `after` poses (a skipped or restored kill, D11). */
  layOut?: ((group: string) => void) | undefined;
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

/** Seconds per half-swing, the pause before the first flurry (just the windup), hits per flurry, and between flurries. */
const POUND = { swing: 0.28, first: 0.2, flurry: [3, 6] as const, rest: [0.8, 2.2] as const };

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

/** `mauled`: the attacker's hand (or a fraction along its blade) closed on one of the victim's joints. */
interface Grip {
  hand: 'hand_L' | 'hand_R';
  joint: JointName;
  /** Optional 0..1 fraction along the blade (0 = hand root, 1 = blade tip; rig-necromorph design D9). */
  blade?: number;
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
  /** This slam's wind-up (s). */
  windup: number;
  /** The props it throws when it lands, and the prop it lands on and how that jumps (livelier-cart-slam D3, D4). */
  burst: KillEvent['burst'];
  prop: string | undefined;
  jolt: KillEvent['jolt'];
}

/** A prop a slam lands on (livelier-cart-slam D3): where it rests now, where it was placed, and the jump playing. */
interface PropJolt {
  id: string;
  /** Its pose when the kill first slammed on it; marks on it are kept relative to this. */
  base: { pos: THREE.Vector3; rotation: THREE.Quaternion };
  /** Where it rests between jumps (the slides and turns so far). */
  rest: { pos: THREE.Vector3; rotation: THREE.Quaternion };
  /** The jump playing: from `from` to `rest`, rocking up to `rock` rad about its bottom edge `edge` m toward the attacker. */
  play: { t: number; from: { pos: THREE.Vector3; rotation: THREE.Quaternion }; rock: number; side: number; edge: number } | null;
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
  /** The throw has landed: from now on her body is kept on her side of the pane (infection-kills "The body stays on her side"). */
  landed: boolean;
  /** The attacker's held pose (its last `attackerPose`), which it returns to after each slam. */
  attackerPose: string;
  /** The approach in the first beat (`haulTo` there): where it is going, how fast, and whether it has stared yet. */
  approach: { to: THREE.Vector3; speed: number; face: number | undefined; via: THREE.Vector3[] } | null;
  /** A `pin` being walked to during play (design D17): the grip waits until the attacker is there. */
  pinning: boolean;
  /** The grip has drawn her into the hand once; until then she is pulled in at most `MAUL.gripDraw` m a frame. */
  gripDrawn: boolean;
  /** `backTo`: she backs away to a mark, facing the attacker. */
  backing: { to: THREE.Vector3; speed: number } | null;
  stare: { t: number; done: boolean; active: boolean };
  /** Where the current `drag` is taking her (a streak from her hand runs that way). */
  dragTo: THREE.Vector3 | null;
  /** A `knock` sweeping for the rest of its beat: what it has hit, and where she was a frame ago (her travel). */
  knock: { beat: string | null; reach: number; strength: number; done: Set<string>; from: THREE.Vector3 } | null;
  /** Props the slams land on, by id. */
  props: Map<string, PropJolt>;
  /** The beat the route was last set up for, and the route carrying her through it (voss-death-scene D3). */
  routeBeat: KillBeat | null;
  route: KillRoute | null;
  /** Parts drawn onto marks (`touch`, D4): each eases in over `blend`, holds, and eases out. */
  touches: Array<{ part: TouchPart; target: THREE.Vector3; t: number; blend: number; hold: number }>;
  /** Route legs already warned about as off their clip's speed (once each per kill). */
  speedWarned: Set<string>;
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
export const MAUL = { gripStep: 0.5, gripDraw: 0.03, liftCarried: 0.5, haulMax: 1.4, walkMax: 2.2, rushMax: 8, windup: 0.32, strike: 0.1, hold: 0.08, lift: [-0.55, 0.15] as const, arc: 0.35, slideS: 0.9, reach: 0.7, inFront: 0.55, arriveSpare: 0.8, easeAllowance: 1.2 };
/** Crunch variants, rotated so two impacts in a row never use the same one (stand-ins until the recordings exist). */
const CRUNCHES = ['head_crunch_1', 'head_crunch_2', 'head_crunch_3'];
/**
 * A slammed prop's jump (livelier-cart-slam D3): seconds the rock lasts, and the seconds it takes to reach where it
 * then rests. The steel and rattle takes of the slam cycle with the impact count (D6).
 */
export const JOLT = { rockS: 0.32, slideS: 0.12 } as const;
const SLAM_VARIANTS = 3;
/**
 * Kill routes (voss-death-scene D3): how fast she turns toward the way she goes (rad/s), and the speed check: a leg more
 * than `speedTolerance` off its clip's own speed warns, unless both are slower than `speedFloor` (m/s; standing).
 */
export const ROUTE = { turn: 6, speedTolerance: 0.35, speedFloor: 0.05 } as const;
/** `touch` defaults (D4): seconds to ease onto the mark and off it again, and to hold it. */
export const TOUCH = { blend: 0.15, hold: 0.3 } as const;
const tmpA = new THREE.Vector3();
/** A landed body's joints stay at least this far in front of `Glass.at` (itself 6 cm off the pane), clearing limb thickness. */
const SIDE_MARGIN = 0;
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
    const onGlass = step['marks'] && typeof step['marks'] === 'object' ? (step['marks'] as Record<string, unknown>)['throwAt'] : undefined;
    const glass = this.glassFor(actor, step['glass'], style, onGlass, marks);
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
      landed: false,
      attackerPose: 'maul_grip',
      approach: null,
      stare: { t: 0, done: false, active: false },
      dragTo: null,
      knock: null,
      props: new Map(),
      pinning: false,
      gripDrawn: false,
      backing: null,
      routeBeat: null,
      route: null,
      touches: [],
      speedWarned: new Set(),
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
      clip: (id, blend, opts) => {
        if (!body.alive || k.instant) return null;
        const duration = body.playKillClip(id, blend, opts);
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
      inReach: (beat) => this.inReach(k, beat.reach ?? MAUL.reach),
      closeIn: () => this.closeIn(k),
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
      // Where a played kill's last route leaves her (voss-death-scene D3).
      this.restAtRouteEnd(k);
      // A mauled kill ends with her lying where she was thrown (medbay-attack "She lies where she was thrown").
      const rest = style.kind === 'mauled' && marks['rest'] !== undefined ? this.mark(k, 'rest') : null;
      if (rest) actor.place({ x: rest.x, y: actor.position.y, z: rest.z });
      if (style.kind === 'mauled') this.endMarks(k);
      k.run.finishNow();
    }
    return done;
  }

  update(dt: number): void {
    for (const k of [...this.active.values()]) {
      k.run.update(dt);
      if (!k.run.over) {
        this.updateRoute(k, dt);
        if (k.touches.length > 0) this.updateTouches(k, dt);
      }
      if (k.slam) this.updateSlam(k, dt);
      this.updateStare(k, dt);
      if (k.backing) this.updateBacking(k, dt);
      if (k.knock) this.updateKnock(k);
      if (k.props.size > 0) this.updateJolts(k, dt);
      if (k.pinning && k.attacker && !k.attacker.busy) k.pinning = false;
      const ap = k.approach;
      if (ap && ap.via.length > 0 && k.attacker && Math.hypot(ap.via[0]!.x - k.attacker.position.x, ap.via[0]!.z - k.attacker.position.z) < 0.6) ap.via.shift();
      // At the glass she leans the last few centimetres in, so her palms meet the pane (walks stop a little short).
      const g = k.glass;
      // (Not while a mauled attacker holds her, throws her or drags her: then the grip or the flight places her.)
      const free = k.grip === null && k.thrown === null && k.actor.body.carried === null;
      // A route beat owns her position (D3): no lean.
      if (g && free && !k.route && k.arrived && k.actor.body.alive && k.run.beatId !== 'scratch' && k.run.beatId !== 'panic') {
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
      else if (k.grip && k.attacker && !k.pinning) this.applyGrip(k);
      if (k.landed) this.keepOnSide(k);
      if (k.slam?.pending) {
        k.slam.pending = false;
        this.impact(k, k.slam);
      }
    }
  }

  /** The gripped joint of `npc`'s victim and the attacker's hand (or blade grip point) holding it (tests, debug). */
  gripPoints(npc: string): { joint: THREE.Vector3; hand: THREE.Vector3 } | null {
    const k = this.active.get(npc);
    if (!k?.grip || !k.attacker) return null;
    const g = k.grip;
    const hand = g.blade ? k.attacker.body.bladePoint(g.hand === 'hand_L' ? 'L' : 'R', g.blade, new THREE.Vector3()) : k.attacker.body.jointWorld(g.hand, new THREE.Vector3());
    return { joint: k.actor.body.jointWorld(g.joint, new THREE.Vector3()), hand };
  }

  private applyGrip(k: ActiveKill): void {
    const g = k.grip!;
    const a = k.attacker!;
    const v = k.actor;
    const slam = k.slam;
    const holding = slam !== null && slam.struck && slam.t < slam.windup + MAUL.strike + MAUL.hold;
    const gripWorld = g.blade ? a.body.bladePoint(g.hand === 'hand_L' ? 'L' : 'R', g.blade, tmpA) : a.body.jointWorld(g.hand, tmpA);
    const target = holding ? slam.target : gripWorld.clone();
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
    // A new grip draws her into the hand over a few frames (never a snap), then holds her there.
    const cap = k.gripDrawn ? MAUL.gripStep : MAUL.gripDraw;
    for (let i = 0; i < 2; i++) {
      const j = v.body.jointWorld(g.joint, tmpB);
      const d = tmpQv.copy(target).sub(j);
      const len = d.length();
      if (len < 0.08) k.gripDrawn = true;
      if (len < 1e-4) break;
      if (len > cap) d.multiplyScalar(cap / len);
      const p = v.position;
      const top = g.joint === 'chest' ? MAUL.liftCarried : MAUL.lift[1];
      const y = Math.min(k.floorY + top, Math.max(k.floorY + MAUL.lift[0], p.y + d.y));
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
    k.gripDrawn = false;
  }

  /** `startWhen: inReach`: the attacker stands within `reach` m of her, and is not stopped staring. */
  private inReach(k: ActiveKill, reach: number): boolean {
    const a = k.attacker;
    if (!a || k.instant) return true;
    if (k.stare.active) return false;
    const v = k.actor.position;
    return Math.hypot(a.position.x - v.x, a.position.z - v.z) <= reach;
  }

  /** The beat before ran out of time: walk the attacker in to just in front of her, at the haul cap. */
  private closeIn(k: ActiveKill): void {
    const a = k.attacker;
    if (!a) return;
    const v = k.actor.position;
    const d = new THREE.Vector3(a.position.x - v.x, 0, a.position.z - v.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    d.normalize().multiplyScalar(MAUL.inFront);
    // Facing her: looking back along d.
    const yaw = Math.atan2(d.x, d.z);
    void a.moveTo({ x: v.x + d.x, y: a.position.y, z: v.z + d.z }, { speed: MAUL.haulMax, yaw });
  }

  /** A route or touch mark's world point: a kill step mark, `glass` (her stand point at the pane), or a room anchor. */
  private routeMark(k: ActiveKill, name: string): THREE.Vector3 | null {
    if (name === 'glass') {
      if (k.glass) return k.glass.stand.clone();
      this.w.warn(`kill ${k.npc}: mark "glass" but the kill has no glass`);
      return null;
    }
    if (k.marks[name] !== undefined) return this.mark(k, name);
    const r = this.w.resolve(`anchor:${name}`);
    if (!r) {
      this.w.warn(`kill ${k.npc}: no mark or anchor "${name}"`);
      return null;
    }
    return new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z);
  }

  /** A route mark's facing as the route takes it: a yaw (degrees in the data), or the point of a mark. */
  private routeFace(k: ActiveKill, face: string | number | undefined): RouteKnot['face'] {
    if (face === undefined) return undefined;
    if (typeof face === 'number') return { yaw: THREE.MathUtils.degToRad(face) };
    const at = this.routeMark(k, face);
    return at ? { at: { x: at.x, z: at.z } } : undefined;
  }

  /**
   * Follow the current beat's route (voss-death-scene D3): a new beat sets one up from where she stands (and turns her
   * feet on), and every frame places her on it at the beat's time, turning toward its facing at `ROUTE.turn`.
   */
  private updateRoute(k: ActiveKill, dt: number): void {
    const beat = k.run.beat;
    if (beat !== k.routeBeat) {
      k.routeBeat = beat;
      this.startRoute(k, beat);
    }
    const r = k.route;
    const a = k.actor;
    if (!r || k.instant || !a.body.alive) return;
    const t = k.run.beatTime;
    const p = r.pointAt(t);
    a.place({ x: p.x, y: a.position.y, z: p.z });
    const want = r.yawAt(t, p, a.body.heading);
    const h = a.body.heading;
    const d = Math.atan2(Math.sin(want - h), Math.cos(want - h));
    const turn = ROUTE.turn * dt;
    a.body.turnHeading(h + THREE.MathUtils.clamp(d, -turn, turn));
  }

  private startRoute(k: ActiveKill, beat: KillBeat | null): void {
    const body = k.actor.body;
    k.route = null;
    if (!beat?.route || k.instant || !body.alive) {
      body.setKillFeet(false);
      return;
    }
    const knots: RouteKnot[] = [];
    const names: string[] = [];
    for (const m of beat.route) {
      const at = this.routeMark(k, m.mark);
      if (!at) continue;
      knots.push({ x: at.x, z: at.z, t: m.t, face: this.routeFace(k, m.face) });
      names.push(m.mark);
    }
    if (knots.length === 0) {
      body.setKillFeet(false);
      return;
    }
    k.actor.stopMove();
    const p = k.actor.position;
    k.route = new KillRoute({ x: p.x, z: p.z }, body.heading, knots);
    body.setKillFeet(true);
    this.checkRouteSpeed(k, beat, k.route, names);
  }

  /**
   * Warn once for each leg of a route whose speed is more than `ROUTE.speedTolerance` off the speed of the clip playing
   * over it (its own travel, at the piece's playback speed): her feet would slide (D3).
   */
  private checkRouteSpeed(k: ActiveKill, beat: KillBeat, route: KillRoute, names: readonly string[]): void {
    const track = beatTrack(beat);
    if (!track) return;
    route.legs.forEach((leg, i) => {
      const mid = (leg.t0 + leg.t1) / 2;
      let piece: (typeof track)[number] | null = null;
      for (const s of track) if (s.at <= mid + 1e-9) piece = s;
      if (!piece?.clip) return;
      const own = k.actor.body.killClipRootSpeed(piece.clip, piece.from, piece.to);
      if (own === null) return;
      const clipSpeed = own * clipSpeedAt(piece.speed, mid - piece.at);
      if (Math.max(clipSpeed, leg.speed) < ROUTE.speedFloor) return;
      if (Math.abs(leg.speed - clipSpeed) <= ROUTE.speedTolerance * clipSpeed) return;
      const key = `${beat.id}:${i}`;
      if (k.speedWarned.has(key)) return;
      k.speedWarned.add(key);
      const off = clipSpeed > 1e-6 ? `${Math.round((Math.abs(leg.speed - clipSpeed) / clipSpeed) * 100)}%` : 'far';
      this.w.warn(`kill ${k.npc}: beat "${beat.id}" route leg to "${names[i]}" goes ${leg.speed.toFixed(2)} m/s, ${off} off its clip "${piece.clip}" (${clipSpeed.toFixed(2)} m/s); her feet will slide`);
    });
  }

  /** A skipped or restored kill: she ends at the last mark of the last route beat, facing as she would arrive (D3). */
  private restAtRouteEnd(k: ActiveKill): void {
    const beats = k.run.style.beats;
    for (let i = beats.length - 1; i >= 0; i--) {
      const route = beats[i]!.route;
      if (!route?.length) continue;
      const last = route[route.length - 1]!;
      const at = this.routeMark(k, last.mark);
      if (!at) return;
      const face = this.routeFace(k, last.face);
      let yaw: number | undefined;
      if (face && 'yaw' in face) yaw = face.yaw;
      else if (face) yaw = yawAlong(face.at.x - at.x, face.at.z - at.z);
      else {
        const prev = route.length > 1 ? this.routeMark(k, route[route.length - 2]!.mark) : null;
        if (prev && Math.hypot(at.x - prev.x, at.z - prev.z) > 0.01) yaw = yawAlong(at.x - prev.x, at.z - prev.z);
      }
      k.actor.place({ x: at.x, y: k.actor.position.y, z: at.z }, yaw);
      return;
    }
  }

  /** Ease each touch in, hold it, and ease it out (D4); the body puts the part there. */
  private updateTouches(k: ActiveKill, dt: number): void {
    const body = k.actor.body;
    const ease = (u: number): number => THREE.MathUtils.smoothstep(u, 0, 1);
    k.touches = k.touches.filter((tc) => {
      tc.t += dt;
      const end = 2 * tc.blend + tc.hold;
      if (tc.t >= end || !body.alive) {
        body.setKillTouch(tc.part, null);
        return false;
      }
      const w = tc.blend <= 1e-6 ? 1 : ease(tc.t / tc.blend) * ease((end - tc.t) / tc.blend);
      body.setKillTouch(tc.part, tc.target, w);
      return true;
    });
  }

  /** The joint a touch puts on its mark. */
  private static touchJoint(part: TouchPart): JointName {
    switch (part) {
      case 'hip_L':
        return 'thigh_L';
      case 'hip_R':
        return 'thigh_R';
      case 'knee_L':
        return 'shin_L';
      case 'knee_R':
        return 'shin_R';
      default:
        return part;
    }
  }

  /** `backTo`: she backs away toward the mark, facing the attacker; her beat's poses step (not a walk cycle). */
  private updateBacking(k: ActiveKill, dt: number): void {
    const b = k.backing!;
    const v = k.actor;
    if (!v.body.alive || k.grip) {
      k.backing = null;
      return;
    }
    const p = v.position;
    const dx = b.to.x - p.x;
    const dz = b.to.z - p.z;
    const len = Math.hypot(dx, dz);
    const step = Math.min(len, b.speed * dt);
    const a = k.attacker;
    const yaw = a ? Math.atan2(-(a.position.x - p.x), -(a.position.z - p.z)) : v.body.heading;
    v.place({ x: p.x + (len > 1e-6 ? (dx / len) * step : 0), y: p.y, z: p.z + (len > 1e-6 ? (dz / len) * step : 0) });
    let dh = yaw - v.body.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    v.body.setHeading(v.body.heading + Math.sign(dh) * Math.min(Math.abs(dh), 4 * dt));
    if (len - step < 0.02) k.backing = null;
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
    // Arrive with time to spare: a walk eases into its turns and its stop, so it runs slower than its nominal speed.
    const left = (first.s ?? first.max) - k.run.beatTime - MAUL.arriveSpare;
    let dist = 0;
    let from: { x: number; z: number } = a.position;
    for (const p of [...ap.via, ap.to]) {
      dist += Math.hypot(p.x - from.x, p.z - from.z);
      from = p;
    }
    const speed = Math.min(MAUL.haulMax, Math.max(ap.speed, left > 0.05 ? (dist / left) * MAUL.easeAllowance : MAUL.haulMax));
    const track = ap.via.length > 0 ? { track: [...ap.via.map((p) => ({ x: p.x, y: a.position.y, z: p.z })), { x: ap.to.x, y: a.position.y, z: ap.to.z }] } : {};
    void a.moveTo({ x: ap.to.x, y: a.position.y, z: ap.to.z }, { speed, ...track, ...(ap.face !== undefined ? { yaw: ap.face } : {}) });
  }

  private updateSlam(k: ActiveKill, dt: number): void {
    const s = k.slam!;
    const a = k.attacker;
    s.t += dt;
    if (!s.striking && s.t >= s.windup) {
      s.striking = true;
      a?.body.setPose(this.w.ctx.poses.has('maul_impact') ? 'maul_impact' : 'kill_glass_0', MAUL.strike);
    }
    if (!s.struck && s.t >= s.windup + MAUL.strike) {
      s.struck = true;
      s.pending = true;
    }
    if (s.struck && !s.pending && s.t >= s.windup + MAUL.strike + MAUL.hold) {
      k.slam = null;
      a?.body.setPose(k.attackerPose, 0.3);
    }
  }

  /** One slam lands: her head on the surface, the hooks, the blood, the sound. */
  private impact(k: ActiveKill, s: Slam): void {
    const n = k.run.impact();
    const body = k.actor.body;
    this.w.emit('kill:impact', { npc: k.npc, n, at: { x: s.target.x, y: s.target.y, z: s.target.z }, instant: k.instant });
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
    // The steel under her and its instruments jumping, a different take each time (livelier-cart-slam D6).
    const variant = (n - 1) % SLAM_VARIANTS;
    this.w.sfx?.(['cartSlam', 'metalKnock'], s.target, undefined, variant);
    this.w.sfx?.(['cartRattle'], s.target, 0.8, variant);
    const pj = s.prop ? k.props.get(s.prop) : undefined;
    if (s.burst && this.w.burst) {
      // Mostly along the surface's long axis, some toward the glass (D4).
      const along = pj ? new THREE.Vector3(1, 0, 0).applyQuaternion(pj.rest.rotation) : undefined;
      this.w.burst(s.target, s.burst.reach, s.burst.strength, {
        ...(s.burst.up !== undefined ? { up: s.burst.up } : {}),
        ...(along ? { along } : {}),
        ...(k.glass ? { toward: k.glass.at } : {}),
        seed: `${k.npc}:slam:${n}`,
      });
    }
    if (pj && s.jolt) this.startJolt(k, pj, s.jolt);
  }

  /** The prop a slam lands on, first seen: where it stands now is its base. */
  private slamProp(k: ActiveKill, id: string): PropJolt | null {
    const known = k.props.get(id);
    if (known) return known;
    const pose = this.w.propPose?.(id);
    if (!pose) return null;
    const pj: PropJolt = { id, base: { pos: pose.pos.clone(), rotation: pose.rotation.clone() }, rest: pose, play: null };
    k.props.set(id, pj);
    return pj;
  }

  /** A mark on a slammed prop, carried with it: placed relative to the prop's base, shown where the prop rests now. */
  private onProp(pj: PropJolt, at: THREE.Vector3): THREE.Vector3 {
    const local = at.clone().sub(pj.base.pos).applyQuaternion(pj.base.rotation.clone().invert());
    return local.applyQuaternion(pj.rest.rotation).add(pj.rest.pos);
  }

  /** Start a prop's jump: it slides and turns to a new rest, and rocks up on its far side and back. */
  private startJolt(k: ActiveKill, pj: PropJolt, j: NonNullable<KillEvent['jolt']>): void {
    const from = { pos: pj.rest.pos.clone(), rotation: pj.rest.rotation.clone() };
    const [sx, sz] = j.slide ?? [0, 0];
    pj.rest = {
      pos: from.pos.clone().add(new THREE.Vector3(sx ?? 0, 0, sz ?? 0).applyQuaternion(from.rotation)),
      rotation: from.rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(j.yaw ?? 0))),
    };
    // Which side of it the attacker is on, in its own frame: that edge stays down, the far side lifts.
    const a = k.attacker?.position;
    const side = a ? Math.sign(a.clone().sub(from.pos).applyQuaternion(from.rotation.clone().invert()).z) || 1 : 1;
    pj.play = { t: 0, from, rock: THREE.MathUtils.degToRad(j.rock ?? 0), side, edge: j.edge ?? 0 };
  }

  private updateJolts(k: ActiveKill, dt: number): void {
    for (const pj of k.props.values()) {
      const p = pj.play;
      if (!p) continue;
      p.t += dt;
      const u = Math.min(1, p.t / JOLT.slideS);
      const ease = 1 - (1 - u) ** 3;
      const pos = p.from.pos.clone().lerp(pj.rest.pos, ease);
      const rot = p.from.rotation.clone().slerp(pj.rest.rotation, ease);
      const r = Math.min(1, p.t / JOLT.rockS);
      // Up fast, down slower: a sine over the rock, damped toward its end.
      const angle = -p.side * p.rock * Math.sin(Math.PI * r) * (1 - 0.5 * r);
      if (angle !== 0) {
        // About the bottom edge on the attacker's side: turn about the prop's X through that pivot.
        const pivot = new THREE.Vector3(0, 0, p.side * p.edge);
        const tip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
        pos.add(pivot.clone().sub(pivot.clone().applyQuaternion(tip)).applyQuaternion(rot));
        rot.multiply(tip);
      }
      if (r >= 1 && u >= 1) {
        pj.play = null;
        this.w.moveProp?.(pj.id, pj.rest.pos.clone(), pj.rest.rotation.clone());
      } else this.w.moveProp?.(pj.id, pos, rot);
    }
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
      k.landed = true;
    }
  }

  /**
   * After the throw lands: no joint of her body may be past the pane (infection-kills "The body stays on her side"). The
   * slide and corpse poses lie her out from a root only 0.6 m off the glass, so a long pose can reach back through it.
   */
  private keepOnSide(k: ActiveKill): void {
    const g = k.glass;
    if (!g) return;
    let least = Infinity;
    for (const j of JOINT_NAMES) least = Math.min(least, k.actor.body.jointWorld(j, tmpA).sub(g.at).dot(g.n));
    if (least >= SIDE_MARGIN) return;
    const p = k.actor.position.clone().addScaledVector(g.n, SIDE_MARGIN - least);
    k.actor.place({ x: p.x, y: k.actor.position.y, z: p.z });
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
      k.landed = true;
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
    // One crack centred where her head struck, and the splatter from it (medbay-attack "Crack centred on the impact",
    // infection-kills "Splatter at the impact").
    const at = th.point.clone();
    if (k.glass) {
      if (k.glass.clip.axis === 'z') at.z = k.glass.at.z;
      else at.x = k.glass.at.x;
    }
    this.impactMarks(at, n, MAUL.slideS, () => Math.random());
    this.w.sfx?.(['body_glass_hit', 'creature_glass_hit', 'glassThud'], th.point);
    this.w.sfx?.(['blood_splat_glass', 'glassThud'], th.point);
  }

  /**
   * A mauled kill's marks as it leaves them (a restore or a skip, medbay-attack "Skip and restore give the end state"):
   * the throw's marks where her head struck (`throwAt`), as the live kill leaves them, in a fixed pattern. Nothing on
   * other panes.
   */
  private endMarks(k: ActiveKill): void {
    const g = k.glass;
    if (!g) return;
    const onPane = (p: THREE.Vector3): THREE.Vector3 => {
      const q = p.clone();
      if (g.clip.axis === 'z') q.z = g.at.z;
      else q.x = g.at.x;
      return q;
    };
    const hit = this.mark(k, 'throwAt');
    let seed = 0;
    if (hit) this.impactMarks(onPane(hit), g.n, 0.05, () => ((seed = (seed * 9301 + 49297) % 233280) / 233280));
  }

  /**
   * Where her head struck the pane (infection-kills "Splatter at the impact"): one safety-glass crack and a splat on the
   * point itself (no jitter, no clear band: after the slams the view no longer needs it), a ring of small splats within
   * 0.3 m, two or three runs starting under them, and the smear her body leaves sliding down over `run` s.
   */
  private impactMarks(at: THREE.Vector3, n: THREE.Vector3, run: number, rand: () => number): void {
    const gore = this.w.ctx.gore;
    gore.glassMark(at.clone(), n, 'crack', 0.7);
    gore.glassMark(at.clone(), n, 'splat', 0.42);
    const side = new THREE.Vector3(-n.z, 0, n.x);
    const ring = 6 + Math.floor(rand() * 5);
    const drops: THREE.Vector3[] = [];
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + rand() * 0.6;
      const d = 0.12 + rand() * 0.17;
      const p = at.clone().addScaledVector(side, Math.cos(a) * d);
      p.y += Math.sin(a) * d;
      drops.push(p);
      gore.glassMark(p, n, 'splat', 0.06 + rand() * 0.07);
    }
    // Runs from the lowest drops, down the pane.
    const low = [...drops].sort((p, q) => p.y - q.y).slice(0, 2 + Math.floor(rand() * 2));
    for (const p of low) gore.glassMark(p.clone(), n, 'streak', 0.35 + rand() * 0.45, { run: Math.max(run, 0.05) * 4 + 2 });
    // The smear down to the floor as she slides.
    const smear = Math.max(0.2, at.y - 0.4);
    gore.glassMark(at.clone(), n, 'streak', smear, { run: Math.max(0.05, run) });
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
    k.attacker?.body.stopPerformance();
    k.attacker?.body.endKill();
    for (const off of k.offs) off();
    this.active.delete(npc);
    k.resolve();
  }

  private finish(k: ActiveKill): void {
    k.actor.gripped = false;
    k.actor.body.carried = null;
    k.attacker?.body.stopPerformance();
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

  private glassFor(actor: NpcActor, ref: unknown, style: KillStyle, onGlass?: unknown, marks: Readonly<Record<string, unknown>> = {}): Glass | null {
    if (ref === undefined || ref === null) return null;
    const r = this.w.resolve(ref as TargetRef);
    if (!r) {
      this.w.warn(`kill ${actor.id}: cannot resolve glass ${JSON.stringify(ref)}`);
      return null;
    }
    const me = actor.position;
    const dx = me.x - r.pos.x;
    const dz = me.z - r.pos.z;
    // The pane is axis-aligned. A second point on it (the throw's aim) gives its plane: the axis it barely moves along is
    // the normal. Otherwise the normal is the dominant axis toward the victim (she starts in front of it, as in Lab B).
    const other = onGlass !== undefined ? this.w.resolve(onGlass as TargetRef) : null;
    const alongZ = other ? Math.abs(other.pos.z - r.pos.z) <= Math.abs(other.pos.x - r.pos.x) : Math.abs(dz) >= Math.abs(dx);
    // The side is her room's (infection-kills "Thrown from the wrong side"): the kill's floor marks are authored in it, so
    // they outvote wherever she happens to stand. With no marks off the pane, her own side, as before.
    let vote = 0;
    for (const [name, m] of Object.entries(marks)) {
      if (name === 'throwAt') continue;
      const p = this.w.resolve(m as TargetRef)?.pos;
      const off = p ? (alongZ ? p.z - r.pos.z : p.x - r.pos.x) : 0;
      if (Math.abs(off) > 0.15) vote += Math.sign(off);
    }
    const sign = (vote !== 0 ? vote : alongZ ? dz : dx) >= 0 ? 1 : -1;
    const n = alongZ ? new THREE.Vector3(0, 0, sign) : new THREE.Vector3(sign, 0, 0);
    const at = new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z).addScaledVector(n, 0.06);
    const band = style.clearBand ? { min: me.y + style.clearBand.min, max: me.y + style.clearBand.max } : undefined;
    // The clip carries the band too, so drops striking the pane keep it clear like the authored marks do.
    const clip: GoreClip = { axis: alongZ ? 'z' : 'x', at: alongZ ? at.z : at.x, keep: sign > 0 ? 'above' : 'below', ...(band ? { band } : {}) };
    const standOff = style.glassStand ?? 0.5;
    const stand = at.clone().addScaledVector(n, standOff).setY(me.y);
    // Facing the pane: looking along -n.
    const yaw = Math.atan2(n.x, n.z);
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
        if (this.w.sfx && !this.w.sfx(e.id, at, e.gain)) this.w.warn(`kill ${k.npc}: no sound "${e.id.join('" or "')}" yet`);
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
      case 'touch': {
        if (k.instant || !e.part || !e.mark) return;
        // `glass`: the point on the pane's face nearest the part now.
        let target: THREE.Vector3 | null;
        if (e.mark === 'glass') {
          const g = k.glass;
          if (!g) return this.w.warn(`kill ${k.npc}: touch on "glass" but the kill has no glass`);
          const p = body.jointWorld(KillDirector.touchJoint(e.part), new THREE.Vector3());
          target = p.addScaledVector(g.n, -p.clone().sub(g.at).dot(g.n));
        } else target = this.routeMark(k, e.mark);
        if (!target) return;
        k.touches = k.touches.filter((tc) => tc.part !== e.part);
        k.touches.push({ part: e.part, target, t: 0, blend: e.blend ?? TOUCH.blend, hold: e.hold ?? TOUCH.hold });
        return;
      }
      case 'layout':
        // Only a skipped or restored kill: a played one leaves things where they fell (livelier-cart-slam D11).
        if (k.instant && e.prop) this.w.layOut?.(e.prop);
        return;
      case 'knock':
        // A skipped or restored kill moves nothing (physical-interaction "Restored kill").
        if (!k.instant) k.knock = { beat: k.run.beatId, reach: e.reach ?? 1, strength: e.strength ?? 1, done: new Set(), from: k.actor.position.clone() };
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
        const spot = { x: v.x + Math.sin(h) * behind + Math.cos(h) * side, y: v.y, z: v.z + Math.cos(h) * behind - Math.sin(h) * side };
        const yaw = e.facing === 'away' ? h + Math.PI : h;
        // Placed only for a skip or a restore; in play it walks there (design D17), and the grip waits for it.
        if (k.instant) a.place(spot, yaw);
        else {
          k.pinning = true;
          void a.moveTo(spot, { speed: MAUL.haulMax, yaw });
        }
        return;
      }
      case 'attackerPose':
        if (k.attacker && e.pose) {
          k.attackerPose = e.pose;
          if (e.gait !== undefined) k.attacker.body.gaitRate = k.instant ? 1 : e.gait;
          if (e.charge !== undefined) k.attacker.body.charge = k.instant ? 0 : e.charge;
          k.attacker.body.setPose(e.pose, k.instant ? 0.01 : (e.blend ?? 0.25));
        }
        return;
      case 'attackerPerf':
        if (k.attacker && e.perf) {
          if (k.instant) k.attacker.body.stopPerformance();
          else k.attacker.body.playPerformance(e.perf, ...(e.hold !== undefined ? [{ hold: e.hold }] : []));
        }
        return;
      case 'grip':
        if (e.release) this.release(k);
        else if (e.joint) {
          k.grip = { hand: e.hand === 'L' ? 'hand_L' : 'hand_R', joint: e.joint, ...(e.blade !== undefined ? { blade: e.blade } : {}) };
          k.actor.gripped = true;
          k.actor.stopMove();
        }
        return;
      case 'attackerLook': {
        const a = k.attacker;
        if (!a) return;
        const at = e.mark ? this.mark(k, e.mark) : null;
        a.lookAt(at ? () => at : null);
        // Looking at a mark turns the whole body to it (it stares at Jay's side of the glass); none: free again.
        a.turnTo(at && !k.instant ? Math.atan2(-(at.x - a.position.x), -(at.z - a.position.z)) : null);
        return;
      }
      case 'haulTo':
      case 'walkTo':
      case 'drag': {
        const a = k.attacker;
        const at = this.mark(k, e.mark);
        if (!a || !at) return;
        // Hauling (or dragging) her is slow; walking away with nothing held is not (D37).
        // The approach in the first beat is a rush: it holds nothing yet, so it may run (the lab creature breaking in on R08).
        const cap = (k.run.beat === k.run.style.beats[0] && e.do !== 'drag') || e.do === 'walkTo' ? MAUL.rushMax : MAUL.haulMax;
        // Dragged along the floor: she holds the beat's lying pose, her legs never step.
        if (e.do === 'drag') {
          k.actor.body.carried = k.run.style.beats.find((b) => b.id === k.run.beatId)?.poses[0] ?? 'corpseProne';
          k.dragTo = at.clone();
        }
        // On arrival it turns to face `faceMark` (the cart it will slam her on), else it keeps the way it walked.
        const face = e.faceMark ? this.mark(k, e.faceMark) : null;
        const yaw = face ? Math.atan2(-(face.x - at.x), -(face.z - at.z)) : Math.atan2(-(at.x - a.position.x), -(at.z - a.position.z));
        // In the first beat this is the approach: a stare can interrupt it, and the walk then makes up the time.
        k.pinning = false;
        const via = (e.via ?? []).map((m) => this.mark(k, m)).filter((p): p is THREE.Vector3 => p !== null);
        if (k.run.beat === k.run.style.beats[0]) k.approach = { to: at.clone(), speed: Math.min(e.speed ?? 1.0, cap), face: face ? yaw : undefined, via: via.map((p) => p.clone()) };
        const track = via.length > 0 ? { track: [...via.map((p) => ({ x: p.x, y: a.position.y, z: p.z })), { x: at.x, y: a.position.y, z: at.z }] } : {};
        if (k.instant) a.place(at.setY(a.position.y), yaw);
        else if (!k.stare.active) void a.moveTo({ x: at.x, y: a.position.y, z: at.z }, { speed: Math.min(e.speed ?? 1.0, cap), ...track, ...(face ? { yaw } : {}) });
        return;
      }
      case 'slam': {
        const at = this.mark(k, e.mark);
        if (!at) return;
        // On a prop the slam moves (the cart), the mark rides with it.
        const pj = e.prop && !k.instant ? this.slamProp(k, e.prop) : null;
        const target = pj ? this.onProp(pj, at) : at;
        const windup = e.windup ?? MAUL.windup;
        k.slam = { target, t: 0, striking: false, struck: false, pending: false, windup, burst: e.burst, prop: e.prop, jolt: e.jolt };
        k.attacker?.body.setPose(this.w.ctx.poses.has('maul_windup') ? 'maul_windup' : 'kill_glass_1', k.instant ? 0.01 : windup * 0.8);
        return;
      }
      case 'throw':
        this.startThrow(k, e);
        return;
      case 'backTo': {
        const at = this.mark(k, e.mark);
        if (!at) return;
        k.actor.stopMove();
        if (k.instant) k.actor.place({ x: at.x, y: k.actor.position.y, z: at.z });
        else k.backing = { to: at, speed: Math.min(e.speed ?? 0.6, 1.2) };
        return;
      }
    }
  }

  private updateKnock(k: ActiveKill): void {
    const n = k.knock!;
    if (k.run.beatId !== n.beat) {
      k.knock = null;
      return;
    }
    const p = k.actor.position;
    // Her travel since the last frame; standing still, the way she faces (toward the glass).
    const travel = tmpQv.copy(p).sub(n.from).setY(0);
    if (travel.lengthSq() < 1e-8) this.forward(k, travel);
    this.w.knock?.(p, travel, n.reach, n.strength, n.done);
    n.from.copy(p);
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
    this.pounders.push({ id: k.creatureId, actor: c, glass: g, t: 0, hits: 0, rest: POUND.first, windup: true });
  }

  /**
   * Where the creature appears and pounds from, without a step: square to the pane where she stood at it. A profiled
   * blade creature stands at its profile distance, so its forearms bang flat on the glass without clipping through
   * (design D9).
   */
  private poundSpot(c: NpcActor, g: Glass): THREE.Vector3 {
    const dist = c.body.blade ? bladeCreatureProfile().poundDistance : undefined;
    return dist !== undefined ? g.at.clone().addScaledVector(g.n, dist).setY(g.stand.y) : g.stand.clone();
  }

  private updatePounders(dt: number): void {
    for (let i = this.pounders.length - 1; i >= 0; i--) {
      const p = this.pounders[i]!;
      if (!this.w.exists(p.id, p.actor)) {
        this.pounders.splice(i, 1);
        continue;
      }
      const body = p.actor.body;
      if (body.state !== 'alive') continue; // still unfolding: a pose now would cut the get-up off for good
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
      // The blow lands on the glass. A blade creature bangs both forearms flat on it, blades upright along the pane, in a
      // quicker slam so the bang sounds as its wrists meet the glass (design D9).
      body.setPose('kill_glass_0', POUND.swing * (body.blade ? 0.3 : 0.5));
      body.killKick('chest', tmpA.set(0, 0, 1), body.blade ? 0.12 : 0.5);
      const at = body.blade
        ? body.bladePoint('L', 0, tmpB).clone().add(body.bladePoint('R', 0, tmpA)).multiplyScalar(0.5)
        : body.jointWorld(Math.random() < 0.5 ? 'hand_L' : 'hand_R', tmpB).clone();
      if (p.glass.clip.axis === 'z') at.z = p.glass.at.z;
      else at.x = p.glass.at.x;
      // The blow's sound sits just on the creature's side of the pane, so a room mic on that side hears it.
      const axis = p.glass.clip.axis;
      const side = Math.sign(p.actor.position[axis] - p.glass.at[axis]) || 1;
      at[axis] = p.glass.at[axis] + side * 0.15;
      this.w.sfx?.(['creature_glass_hit', 'glassThud'], at, 1.8);
      p.hits--;
      if (p.hits <= 0) {
        p.rest = POUND.rest[0] + Math.random() * (POUND.rest[1] - POUND.rest[0]);
        if (Math.random() < 0.6) this.w.sfx?.(['creature_clicks', 'zombieVoice'], body.jointWorld('head', tmpB));
        if (Math.random() < 0.85) this.w.growl?.(body.jointWorld('head', tmpB));
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
    // Behind a pane it appears on the spot it will pound from, a few centimetres off her chest.
    if (k.glass) c.place(this.poundSpot(c, k.glass), yaw);
    if (k.instant) {
      k.creatureT = CREATURE_GROW;
      return;
    }
    // Curled at her chest, small, then it unfolds and stands (the burst covers the first moments).
    k.creatureT = 0;
    c.body.group.scale.setScalar(0.6);
    c.body.playDead(e.pose ?? 'getUp_0');
    c.body.getUp();
    this.w.growl?.(c.body.jointWorld('head', tmpB));
  }
}
