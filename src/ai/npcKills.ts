import * as THREE from 'three';
import type { HumanoidContext } from '../actors/humanoid.ts';
import type { ClearBand, GoreClip } from '../actors/goreClip.ts';
import type { JointName } from '../actors/skeleton.ts';
import type { KillEvent, KillStyle, KillTable } from '../data/types/kills.ts';
import type { TargetRef, Vec3Like } from '../script/types.ts';
import { KillRun } from './killRun.ts';
import type { NpcActor } from './npcActor.ts';

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

interface ActiveKill {
  npc: string;
  actor: NpcActor;
  run: KillRun;
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
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** Push direction in the body's own frame (it faces -Z, its right is +X). */
function localDir(dir: KillEvent['dir'], out: THREE.Vector3): THREE.Vector3 {
  switch (dir) {
    case 'back':
      return out.set(0, 0, 1);
    case 'left':
      return out.set(-1, 0, 0);
    case 'right':
      return out.set(1, 0, 0);
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
    if (style.kind === 'converted') {
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
    body.beginKill();
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
    };
    k.run = new KillRun(style, cues, {
      beat: (id, index) => this.w.emit(`kill:${id}`, { npc, beat: id, index }),
      pose: (name, blend) => {
        if (!this.w.ctx.poses.has(name)) return this.w.warn(`kill ${npc}: unknown pose "${name}"`);
        if (body.alive || name.startsWith('corpse')) body.setPose(name, k.instant ? 0.01 : blend);
      },
      convulse: (target, rate) => body.killConvulse(target, rate),
      bulge: (i, path, t, radius, amp) => body.setBulge(i, path as JointName[], t, radius, amp),
      event: (e) => this.event(k, e),
      facesGlass: () => k.glass !== null && (this.atGlass(k) || k.instant),
      arrived: () => this.atGlass(k),
      creatureReady: () => k.creature === null || k.creature.body.alive,
      done: () => this.finish(k),
    });
    const listen = this.w.listen;
    if (listen) k.offs.push(listen('speech:ended', (p) => k.run.lineEnded(String((p as { id?: unknown } | null)?.id ?? ''))));
    this.active.set(npc, k);
    if (instant) {
      if (glass) actor.place(glass.stand, glass.yaw);
      k.run.finishNow();
    }
    return done;
  }

  update(dt: number): void {
    for (const k of [...this.active.values()]) {
      k.run.update(dt);
      // At the glass she leans the last few centimetres in, so her palms meet the pane (walks stop a little short).
      const g = k.glass;
      if (g && k.arrived && k.actor.body.alive && k.run.beatId !== 'scratch' && k.run.beatId !== 'panic') {
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
    for (const off of k.offs) off();
    this.active.delete(npc);
    k.resolve();
  }

  private finish(k: ActiveKill): void {
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
          gore.spurt(bone, new THREE.Vector3(), fwd.clone().setY(0.25).normalize().applyQuaternion(tmpQ), e.s ?? 3);
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
      case 'face':
        if (k.glass) {
          k.actor.turnTo(k.glass.yaw);
          body.setHeading(k.glass.yaw);
        }
        return;
    }
  }

  private glassMark(k: ActiveKill, e: KillEvent): void {
    const g = k.glass;
    if (!g) return;
    const kind = (e.kind ?? 'splat') as 'print' | 'splat' | 'streak';
    const body = k.actor.body;
    const p = (kind === 'print' ? body.jointWorld(e.hand === 'R' ? 'hand_R' : 'hand_L', tmpA) : body.jointWorld('chest', tmpA)).clone();
    // Onto the pane's face.
    if (g.clip.axis === 'z') p.z = g.at.z;
    else p.x = g.at.x;
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
        if (p.rest <= 0) p.hits = POUND.flurry[0] + Math.floor(Math.random() * (POUND.flurry[1] - POUND.flurry[0] + 1));
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
