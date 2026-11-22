import * as THREE from 'three';
import { castSpec } from '../actors/castLooks.ts';
import { Humanoid, type HumanoidContext } from '../actors/humanoid.ts';
import type { Interactable } from '../actors/interaction.ts';
import type { ColliderQuery } from '../actors/motor.ts';
import { separate, type SepBody } from '../actors/separation.ts';
import type { TargetRef, Vec3Like } from '../script/types.ts';
import { PLAYER_RADIUS } from './giveWay.ts';
import type { Navigator, P3 } from './nav.ts';
import { NpcActor, type NpcEnv } from './npcActor.ts';
import { ChatGroup, type ChatMember } from './chatter.ts';
import { AmbientDirector, isAmbientEligible, type AmbientAgent, type AmbientSpot } from './ambientLife.ts';
import type { Squad, SquadId, SquadMate } from './squad.ts';
import type { KillTable } from '../data/types/kills.ts';
import { DockGuardRoutine } from './dockGuardRoutine.ts';
import { KillDirector } from './npcKills.ts';

/**
 * The NPC director (ADR-0009 NPC actions, ADR-0011 squad hand-over, ADR-0023 and intro-sequence spec cast).
 * Every named body the sequences can drive lives here: the squad (Giles, Okafor, lent by the
 * squad while a sequence drives them), the level's cast and crew (`Level.npcSpawns()`), and
 * bodies a sequence spawns. `command()` is `SequenceHost.npc`.
 *
 * Rules:
 * - Every command honours `instant: true` (a skipped scene): teleport, final pose, done.
 * - Every command returns a promise that settles when the action is over, for `wait`.
 * - A squadmate a sequence drives yields its AI until no sequence is running (or the
 *   sequence hands him back with `npcFollow` and no target, or gives him an `npcTask`).
 */

/** A level-placed NPC (the level agent's `Level.npcSpawns()` contract). */
export interface NpcSpawn {
  id: string;
  look: string;
  pos: THREE.Vector3 | Vec3Like;
  yaw: number;
  pose?: string | undefined;
  /** Built so `transform` can infect it. */
  transformable?: boolean | undefined;
  /** Conversation group (ADR-0029): NPCs sharing it talk to each other. */
  chat?: string | undefined;
  /** Imported body id (`data/body-models.json`) instead of the look's pick by NPC id. */
  model?: string | undefined;
  /** Activity spot initially claimed (ADR-0029). */
  spot?: string | undefined;
  /** Room id the NPC belongs to (ADR-0029 phase 2). */
  room?: string | undefined;
}

export interface ResolvedTarget {
  pos: Vec3Like;
  yaw?: number | undefined;
}

export interface NpcDirectorDeps {
  ctx: HumanoidContext;
  nav: Navigator | null;
  colliders: ColliderQuery | null;
  squad?: Squad | null;
  /**
   * Feet and eye of the player each step, and `wish`: the unit XZ direction Jay is trying to move
   * (zero when not moving; absent = nobody gives way to him).
   */
  player: () => { feet: THREE.Vector3; head: THREE.Vector3; wish?: { x: number; z: number } };
  /** Register an interactable (npcOffer); returns its remover. */
  interact?: ((item: Interactable) => () => void) | null;
  emit?: (name: string, payload: unknown) => void;
  warn?: (message: string) => void;
  /** Any sequence running? When none is, squadmates go back to their AI. */
  sequenceRunning?: () => boolean;
  /** Immovable circles NPCs keep out of (live enemies); the player and unscripted squadmates are built in. */
  obstacles?: (() => Iterable<{ x: number; z: number; r: number }>) | null;
  /** Track points for `attachToTrack` (level paths); null if unknown. */
  track?: (id: string) => P3[] | null;
  /** Authored walks (ADR-0028) for `via` and `attachToTrack`: control points and default speed. */
  walk?: (id: string) => { points: P3[]; speed?: number } | null;
  /** Scripted kill styles (`data/kills.json`, infection-kills spec) for the `kill` command. */
  kills?: Readonly<KillTable>;
  /** Subscribe to a bus event (a kill listens for its lines ending); returns the unsubscriber. */
  listen?: (name: string, fn: (payload: unknown) => void) => () => void;
  /** Play the first of `ids` that exists, at a world point; false when none does. */
  sfx?: (ids: readonly string[], at: Vec3Like) => boolean;
  /** Controllable level props (dock_chair, dock_wand) driven by scripted NPC routines. */
  setPropTransform?: (id: string, pos: { x: number; y: number; z: number }, yaw: number) => boolean;
  setPropVisible?: (id: string, visible: boolean) => boolean;
  propState?: (id: string) => { pos: THREE.Vector3; yaw: number; visible: boolean } | null;
}

/** Names a sequence may use for the squad. */
/** Largest push per pass on a pair with the player (he is immovable, so the other body clears him quickly). */
const PLAYER_MAX_PUSH = 0.06;
/** Poses of a body lying down: not a standing obstacle for Jay. */
const LYING_POSE = /^(corpse|squad_downed|squad_getUp|writhing|crawl|dragging|getUp)/;
/** A walker this close to its goal is not shoved, so scripted arrivals always land. */
const ARRIVE_LOCK = 0.8;
/**
 * `npcMoveTo { whenUnseen }`: half-angle of Jay's view cone, in degrees. The screen edge is about 56 degrees off
 * centre at the default 80 degree FOV (16:9) and under 65 at 100, so 70 also covers a body's width at the edge.
 */
const UNSEEN_HALF_ANGLE = 70;
/** Listen-look (ADR-0029): bodies this close (m) to a story speaker look at them. */
export const LISTEN_RANGE = 4.5;
/** Seconds the listen-look holds after a line ends (people keep looking a beat). */
const LISTEN_LINGER = 1.2;
/** A walker outweighs a standing body, so the standing one yields. */
const WALKER_MASS = 4;

const SQUAD_NAMES: Readonly<Record<string, SquadId>> = { giles: 'engineer', engineer: 'engineer', okafor: 'medic', medic: 'medic' };

export class NpcDirector {
  readonly group = new THREE.Group();
  /** Scene-level effects the NPCs own (the kill key light); add to the scene beside `group`. */
  readonly fx = new THREE.Group();
  private readonly deps: NpcDirectorDeps;
  private readonly actors = new Map<string, NpcActor>();
  /** Squadmates currently lent to a sequence. */
  private readonly held = new Set<SquadId>();
  /** Held squadmates who stay put after the scene ends (`npcFollow { stay: true }`, ADR-0023 rounds). */
  private readonly parked = new Set<SquadId>();
  private readonly levelSpawns = new Map<string, NpcSpawn>();
  private readonly spawned = new Set<string>();
  private readonly offers = new Map<string, () => void>();
  private timers: Array<{ left: number; fn: () => void }> = [];
  /** `npcMoveTo { whenUnseen }`: moves made the moment Jay cannot see the NPC, even while it is walking. */
  private readonly unseenMoves = new Map<string, { pos: P3; yaw: number | undefined }>();
  private resolver: ((ref: TargetRef) => ResolvedTarget | null) | null = null;
  private readonly env: NpcEnv;
  private readonly warned = new Set<string>();
  private readonly sep: SepBody[] = [];
  private readonly sepOwner: Array<NpcActor | null> = [];
  private readonly sepStart: Array<{ x: number; z: number }> = [];
  private readonly sepMate: Array<SquadMate | null> = [];
  private readonly solid: Array<{ x: number; z: number; r: number }> = [];
  private readonly solidSeen = new Set<unknown>();
  private readonly pairA: SepBody = { x: 0, z: 0, r: 0, mass: 1 };
  private readonly pairB: SepBody = { x: 0, z: 0, r: 0, mass: Infinity };
  private readonly pair: SepBody[] = [this.pairA, this.pairB];
  /** Background conversations (ADR-0029), by chat id. */
  private readonly chats = new Map<string, ChatGroup>();
  /** ADR-0029 phase 2: ambient crew wandering between activity spots. */
  private ambientLife: AmbientDirector | null = null;
  /** Dynamic table/bar conversations formed when wandering NPCs share a prop group. */
  private readonly dynamicChats = new Map<string, { key: string; group: ChatGroup }>();
  private readonly authoredEngaged = new Set<string>();
  /** Listen-look (ADR-0029): who is speaking a story line now and who spoke before ('player' for Jay). */
  private talker: string | null = null;
  private lastTalker: string | null = null;
  private talkGen = 0;
  private readonly talkHeads = new Map<string, THREE.Vector3>();

  /** Scripted infected kills (`kill` command). */
  readonly kills: KillDirector;
  /** Scripted dock guard return to the security booth desk (`npcTask return_to_desk`). */
  readonly dockGuard: DockGuardRoutine;

  constructor(deps: NpcDirectorDeps) {
    this.deps = deps;
    this.group.name = 'npcs';
    this.fx.name = 'npc-fx';
    this.dockGuard = new DockGuardRoutine({
      resolve: (ref) => this.resolver?.(ref) ?? (Array.isArray(ref) ? { pos: { x: ref[0] as number, y: ref[1] as number, z: ref[2] as number } } : null),
      walk: (id) => deps.walk?.(id) ?? null,
      playerFeet: () => this.deps.player().feet,
      ...(deps.setPropTransform ? { setPropTransform: deps.setPropTransform } : {}),
      ...(deps.setPropVisible ? { setPropVisible: deps.setPropVisible } : {}),
      ...(deps.propState ? { propState: deps.propState } : {}),
    });
    this.kills = new KillDirector(
      {
        ctx: deps.ctx,
        kills: deps.kills,
        emit: (n, p) => deps.emit?.(n, p),
        listen: deps.listen,
        sfx: deps.sfx,
        warn: (m) => this.warnOnce(m),
        resolve: (ref) => this.resolver?.(ref) ?? (Array.isArray(ref) ? { pos: { x: ref[0] as number, y: ref[1] as number, z: ref[2] as number } } : null),
        spawn: (id, look, at, yaw, pose) => {
          const a = this.create(id, look, at, yaw, pose, false);
          this.spawned.add(id);
          this.hold(id);
          a.ambient = false;
          return a;
        },
        hold: (id) => {
          this.hold(id);
          const a = this.actors.get(id);
          if (a) a.ambient = false;
        },
        exists: (id, actor) => this.actors.get(id) === actor,
        find: (id) => this.actors.get(id) ?? null,
        playerEye: () => this.deps.player().head,
      },
      this.fx,
    );
    this.env = { nav: deps.nav, colliders: deps.colliders, playerHead: new THREE.Vector3(), playerFeet: new THREE.Vector3(), camera: null, playerWish: { x: 0, z: 0 }, occupied: (x, z, r, self) => this.occupiedAt(x, z, r, self), bodies: (self, fn) => this.eachSolid((x, z, r, owner) => owner !== self && fn(x, z, r)) };
  }

  /** Target resolution for `to`/`at`/`target` fields (set by the game host: anchors, doors, npc:). */
  setResolver(fn: (ref: TargetRef) => ResolvedTarget | null): void {
    this.resolver = fn;
  }

  ids(): string[] {
    return [...new Set([...this.actors.keys(), ...Object.keys(SQUAD_NAMES)])];
  }

  has(id: string): boolean {
    return this.actors.has(id) || (id in SQUAD_NAMES && !!this.deps.squad);
  }

  /** Eye point of an NPC, for `npc:<id>` targets. */
  head(id: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const a = this.actor(id, false);
    return a ? a.head(out) : null;
  }

  /** The actor for an id, wrapping a squadmate on first use. */
  actor(id: string, warnMissing = true): NpcActor | null {
    const found = this.actors.get(id);
    if (found) return found;
    const sid = SQUAD_NAMES[id];
    const squad = this.deps.squad;
    if (sid && squad) {
      const mate = squad.mate(sid);
      const a = new NpcActor(id, mate.body, mate.motor);
      a.ambient = false; // the squad has its own idle behaviour
      // Both names point at the same body.
      for (const [name, s] of Object.entries(SQUAD_NAMES)) if (s === sid) this.actors.set(name, a);
      return a;
    }
    if (warnMissing) this.warnOnce(`npc: no NPC "${id}"`);
    return null;
  }

  isSquad(id: string): boolean {
    return id in SQUAD_NAMES;
  }

  private mateOf(id: string): SquadMate | null {
    const sid = SQUAD_NAMES[id];
    return sid && this.deps.squad ? this.deps.squad.mate(sid) : null;
  }

  /** Lend a squadmate to the sequence: his AI stops until released. */
  private hold(id: string): void {
    const m = this.mateOf(id);
    if (!m) return;
    m.scripted = true;
    this.held.add(m.id);
  }

  private release(id: string): void {
    const m = this.mateOf(id);
    if (!m || !this.held.has(m.id)) return;
    this.held.delete(m.id);
    this.parked.delete(m.id);
    m.scripted = false;
    m.thinkNow();
    const a = this.actor(id, false);
    a?.stopMove();
    a?.lookAt(null);
    if (m.body.idlePose !== 'idle' && !m.task) m.body.setPose('idle', 0.5);
    if (a) a.basePose = 'idle';
  }

  /** Give every squadmate back to the AI (the scene ended). */
  releaseAll(): void {
    for (const id of [...this.held]) this.release(id === 'engineer' ? 'giles' : 'okafor');
  }

  /** Scene step `squadRegroup` (squad-tasks spec). A moved squadmate drops the walk he was on. */
  regroup(distance?: number): SquadId[] {
    const moved = this.deps.squad?.regroup(distance) ?? [];
    for (const id of moved) this.actor(id === 'engineer' ? 'giles' : 'okafor', false)?.stopMove();
    return moved;
  }

  /** Scene step `gatherIn` timed out or was skipped (scene-gathering spec). */
  placeSquadIn(inside: (p: { x: number; y: number; z: number }) => boolean): SquadId[] {
    const moved = this.deps.squad?.placeIn(inside) ?? [];
    for (const id of moved) this.actor(id === 'engineer' ? 'giles' : 'okafor', false)?.stopMove();
    return moved;
  }

  /** Scene step `squadCatchUpIn` (morning-briefing spec): bring unseen stragglers outside the room inside. */
  catchUpSquadIn(inside: (p: { x: number; y: number; z: number }) => boolean, entry?: Vec3Like | null): SquadId[] {
    const moved = this.deps.squad?.catchUpIn(inside, entry) ?? [];
    for (const id of moved) this.actor(id === 'engineer' ? 'giles' : 'okafor', false)?.stopMove();
    return moved;
  }

  /** Where a squadmate's feet are, for room tests (`gatherIn`). */
  squadFeet(id: 'giles' | 'okafor'): { x: number; y: number; z: number } | null {
    const m = this.mateOf(id);
    return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null;
  }

  isHeld(id: SquadId): boolean {
    return this.held.has(id);
  }

  /** Held and staying put between scenes (`npcFollow { stay: true }`). */
  isParked(id: SquadId): boolean {
    return this.parked.has(id);
  }

  /** The scene ended: squadmates go back to following Jay, except those told to stay. */
  private releaseUnparked(): void {
    for (const id of [...this.held]) if (!this.parked.has(id)) this.release(id === 'engineer' ? 'giles' : 'okafor');
  }

  // ------------------------------------------------------------------ cast from the level

  /** Spawn the level's cast and crew with their idle poses (`Level.npcSpawns()`). */
  spawnFromLevel(spawns: readonly NpcSpawn[]): void {
    for (const s of spawns) {
      if (this.isSquad(s.id)) {
        // The squad already exists; a level entry only says where they stand.
        const a = this.actor(s.id, false);
        a?.place(s.pos, s.yaw);
        continue;
      }
      this.levelSpawns.set(s.id, s);
      this.create(s.id, s.look, s.pos, s.yaw, s.pose, s.transformable === true, s.model);
    }
    // ADR-0029: NPCs sharing a chat id talk to each other.
    const byChat = new Map<string, string[]>();
    for (const s of spawns) if (s.chat && !this.isSquad(s.id)) byChat.set(s.chat, [...(byChat.get(s.chat) ?? []), s.id]);
    for (const [chat, ids] of byChat) {
      if (ids.length < 2) {
        this.warnOnce(`npc chat "${chat}": only ${ids[0]} is in it`);
        continue;
      }
      this.chats.set(chat, new ChatGroup(chat, ids.map((id) => this.chatMember(id))));
    }
  }

  /** A conversation's view of a level NPC, looked up by id each time (reset rebuilds bodies). */
  private chatMember(id: string): ChatMember {
    const get = (): NpcActor | null => this.actors.get(id) ?? null;
    return {
      id,
      feet: () => get()?.position ?? { x: Infinity, z: Infinity },
      head: (out) => get()?.head(out) ?? null,
      available: () => {
        const a = get();
        return !!a && a.ambient && !a.busy && !a.offering && !a.givingWay && a.body.state === 'alive' && a.body.infection < 1 && a.body.group.visible;
      },
      speak: (text, emote, seconds, seed) => get()?.body.speak(text, emote, seconds, seed),
      stopSpeaking: () => get()?.body.stopSpeaking(),
      lookAt: (fn) => {
        const a = get();
        if (a) a.socialLook = fn;
      },
    };
  }

  // ------------------------------------------------------------------ listen-look

  /** Eye point of a talker ('player' is Jay), or null if there is no such body. */
  private talkerHead(id: string): THREE.Vector3 | null {
    if (id === 'player') return this.env.playerHead;
    let out = this.talkHeads.get(id);
    if (!out) {
      out = new THREE.Vector3();
      this.talkHeads.set(id, out);
    }
    return this.head(id, out);
  }

  /**
   * A story line started (`speech:started`; ADR-0029 / npc-conversation-gaze). Everyone within LISTEN_RANGE of the speaker
   * looks at them; the speaker looks at `addressee` when explicitly named and in range, else whoever spoke last if close,
   * else at Jay if he is close. `speaker` is an NPC id or 'player'; anything else (the PA, the radio) is ignored.
   */
  lineStarted(speaker: string, addressee?: string | null): void {
    const at = speaker === 'player' ? this.env.playerFeet : this.actor(speaker, false)?.position;
    if (!at) return;
    this.talkGen++;
    if (this.talker && this.talker !== speaker) this.lastTalker = this.talker;
    this.talker = speaker;
    const near = (p: { x: number; z: number } | null | undefined): boolean => !!p && Math.hypot(p.x - at.x, p.z - at.z) <= LISTEN_RANGE;
    const posOf = (id: string | null | undefined): { x: number; z: number } | null | undefined =>
      !id ? null : id === 'player' ? this.env.playerFeet : this.actor(id, false)?.position;
    const toSpeaker = (): THREE.Vector3 | null => this.talkerHead(speaker);
    const explicit = addressee && addressee !== speaker && near(posOf(addressee)) ? addressee : null;
    const answer =
      explicit ??
      (this.lastTalker && this.lastTalker !== speaker && near(posOf(this.lastTalker))
        ? this.lastTalker
        : near(this.env.playerFeet) && speaker !== 'player'
          ? 'player'
          : null);
    const seen = new Set<NpcActor>();
    for (const [id, a] of this.actors) {
      if (seen.has(a)) continue;
      seen.add(a);
      if (a.body.state !== 'alive' || !a.body.group.visible) continue;
      const self = id === speaker || this.actor(speaker, false) === a;
      if (self) {
        a.talkLook = answer ? () => this.talkerHead(answer) : null;
        continue;
      }
      a.talkLook = near(a.position) ? toSpeaker : null;
    }
  }

  /** `speaker`'s line ended: looks linger a moment, then go back to whatever the body was doing. */
  lineEnded(speaker: string): void {
    if (speaker !== this.talker) return; // the PA or an overlapping line ending does not end the conversation
    const gen = this.talkGen;
    this.timers.push({
      left: LISTEN_LINGER,
      fn: () => {
        if (gen !== this.talkGen) return; // another line started meanwhile
        for (const a of this.actors.values()) a.talkLook = null;
      },
    });
  }

  /** Conversation state (tests, debug): who is talking in each group. */
  chatState(): Record<string, { speaking: string | null; engaged: readonly string[] }> {
    const out: Record<string, { speaking: string | null; engaged: readonly string[] }> = {};
    for (const [id, g] of this.chats) out[id] = { speaking: g.speaking, engaged: g.engaged };
    for (const [id, d] of this.dynamicChats) out[`dyn:${id}`] = { speaking: d.group.speaking, engaged: d.group.engaged };
    return out;
  }

  /**
   * ADR-0029 phase 2: enable the ambient director over the level's activity spots.
   * Story NPCs and desk workers stay put; everyone else in multi-spot rooms periodically
   * walks between free seats and counters on the navmesh.
   */
  enableAmbientLife(spots: readonly AmbientSpot[]): void {
    const agents: AmbientAgent[] = [];
    for (const s of this.levelSpawns.values()) {
      if (!s.room || !isAmbientEligible(s.id, s.pose)) continue;
      const id = s.id;
      agents.push({
        id,
        room: s.room,
        initialSpot: s.spot ?? null,
        available: () => {
          const a = this.actors.get(id);
          return !!a && a.ambient && !a.busy && !a.offering && !a.givingWay && a.body.state === 'alive' && a.body.infection < 1;
        },
        feet: () => {
          const a = this.actors.get(id);
          return a ? { x: a.motor.x, y: a.motor.y, z: a.motor.z } : { x: 0, y: 0, z: 0 };
        },
        walkTo: (pos, yaw, speed, onDone) => {
          const a = this.actors.get(id);
          if (!a) {
            onDone();
            return;
          }
          void a.moveTo(pos, { yaw, speed }).then(onDone);
        },
        settle: (pos, yaw, pose) => {
          const a = this.actors.get(id);
          if (!a) return;
          const resolved = this.deps.ctx.poses.has(pose) ? pose : 'idle';
          a.settleAt(pos, yaw, resolved, 0.75);
        },
      });
    }
    this.ambientLife = agents.length ? new AmbientDirector(spots, agents) : null;
  }

  /** Back to the level's starting layout (new game, load): scripted spawns go, cast return. */
  reset(): void {
    this.dockGuard.reset(this.actors.get('dock_guard'));
    this.kills.reset();
    for (const id of [...this.spawned]) this.remove(id);
    // A body a kill tore open or killed is rebuilt from scratch (the Lab B researcher alive at her desk again).
    for (const s of this.levelSpawns.values()) {
      const b = this.actors.get(s.id)?.body;
      if (b && (b.killing || b.chestTorn || !b.alive)) this.remove(s.id);
    }
    for (const close of this.offers.values()) close();
    this.offers.clear();
    this.talker = null;
    this.lastTalker = null;
    this.talkGen++;
    for (const a of this.actors.values()) a.talkLook = null;
    this.timers = [];
    this.parked.clear();
    for (const a of this.actors.values()) a.untow();
    for (const s of this.levelSpawns.values()) {
      const a = this.actors.get(s.id) ?? this.create(s.id, s.look, s.pos, s.yaw, s.pose, s.transformable === true, s.model);
      a.stopMove();
      a.followTarget(null);
      a.lookAt(null);
      a.offering = null;
      if (a.body.infection > 0) a.body.setInfection(0); // the Lab B researcher is human again
      a.resetPose(s.pose && this.deps.ctx.poses.has(s.pose) ? s.pose : 'idle');
      a.place(s.pos, s.yaw);
    }
    for (const g of this.chats.values()) g.reset();
    for (const d of this.dynamicChats.values()) d.group.reset();
    this.dynamicChats.clear();
    this.ambientLife?.reset();
    this.releaseAll();
  }

  private create(id: string, look: string, at: Vec3Like, yaw: number, pose: string | undefined, transformable: boolean, model?: string): NpcActor {
    this.remove(id);
    const spec = { ...castSpec(look, id, (m) => this.warnOnce(m)), ...(model ? { model } : {}) };
    let idle = pose ?? spec.pose ?? 'idle';
    if (!this.deps.ctx.poses.has(idle)) {
      this.warnOnce(`npc "${id}": unknown pose "${idle}", using idle`);
      idle = 'idle';
    }
    const body = new Humanoid({ ...spec, role: 'npc', pose: idle, ...(transformable ? { transformable: true } : {}) }, this.deps.ctx);
    const a = new NpcActor(id, body);
    a.place(at, yaw);
    this.actors.set(id, a);
    this.group.add(body.group);
    return a;
  }

  private remove(id: string): void {
    const a = this.actors.get(id);
    if (!a || this.isSquad(id)) return;
    this.offers.get(id)?.();
    this.offers.delete(id);
    a.stopMove();
    this.group.remove(a.body.group);
    a.body.dispose();
    this.actors.delete(id);
    this.spawned.delete(id);
  }

  // ------------------------------------------------------------------ commands

  private target(ref: unknown, action: string, npc: string): ResolvedTarget | null {
    if (ref === undefined || ref === null) return null;
    const r = this.resolver?.(ref as TargetRef) ?? (Array.isArray(ref) ? { pos: { x: ref[0] as number, y: ref[1] as number, z: ref[2] as number } } : null);
    if (!r) this.warnOnce(`${action} ${npc}: cannot resolve ${JSON.stringify(ref)}`);
    return r;
  }

  private getter(ref: unknown): (() => THREE.Vector3 | null) | null {
    if (ref === undefined || ref === null || ref === 'none') return null;
    if (ref === 'player') return () => this.env.playerHead;
    const out = new THREE.Vector3();
    return () => {
      const r = this.resolver?.(ref as TargetRef);
      return r ? out.set(r.pos.x, r.pos.y, r.pos.z) : null;
    };
  }

  private after(seconds: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ left: seconds, fn: resolve }));
  }

  /** Make the `whenUnseen` moves whose NPC is out of Jay's view: outside his view cone, or behind a wall. */
  private placeUnseen(eye: P3, forward: { x: number; z: number } | null): void {
    const clear = (a: P3, b: P3): boolean => (this.deps.nav ? this.deps.nav.direct(a, b, 0) : true);
    const cone = Math.cos(THREE.MathUtils.degToRad(UNSEEN_HALF_ANGLE));
    for (const [npc, to] of this.unseenMoves) {
      const a = this.actor(npc);
      if (!a) {
        this.unseenMoves.delete(npc);
        continue;
      }
      const p = a.position;
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const len = Math.hypot(dx, dz) || 1;
      const fl = forward ? Math.hypot(forward.x, forward.z) || 1 : 1;
      const inCone = !forward || (dx * forward.x + dz * forward.z) / (len * fl) > cone;
      const seen = inCone && clear({ x: eye.x, y: eye.y - 1.25, z: eye.z }, p);
      if (seen) continue;
      a.place(to.pos, to.yaw);
      this.unseenMoves.delete(npc);
    }
  }

  /** `SequenceHost.npc`: run one NPC action. Resolves when it is done. */
  command(action: string, step: Readonly<Record<string, unknown>>): Promise<void> {
    const npc = String(step['npc'] ?? '');
    const instant = step['instant'] === true;
    // Any later command for this NPC replaces a move still waiting to be unseen.
    this.unseenMoves.delete(npc);
    switch (action) {
      case 'spawn': {
        const at = this.target(step['at'], action, npc);
        if (!at) return Promise.resolve();
        if (this.isSquad(npc)) {
          this.hold(npc);
          this.actor(npc)?.place(at.pos, at.yaw);
          return Promise.resolve();
        }
        this.create(npc, String(step['kind'] ?? npc), at.pos, at.yaw ?? 0, undefined, true);
        this.spawned.add(npc);
        return Promise.resolve();
      }
      case 'despawn':
        if (this.isSquad(npc)) {
          this.warnOnce(`despawn: the squad cannot be despawned (${npc})`);
          return Promise.resolve();
        }
        this.remove(npc);
        return Promise.resolve();
      default:
        break;
    }
    const a = this.actor(npc);
    if (!a) return Promise.resolve();
    this.ambientLife?.interrupt(npc);
    switch (action) {
      case 'npcMoveTo': {
        const at = this.target(step['to'], action, npc);
        if (!at) return Promise.resolve();
        this.hold(npc);
        // Off-stage move: it happens the moment Jay cannot see the NPC, even mid-walk, so no one pops out of
        // view (intro-sequence spec "She walks out"). Skipped or restored (`instant`), it happens now.
        if (step['whenUnseen'] === true && !instant) {
          this.unseenMoves.set(npc, { pos: { x: at.pos.x, y: at.pos.y, z: at.pos.z }, yaw: at.yaw });
          return Promise.resolve();
        }
        const via = typeof step['via'] === 'string' ? step['via'] : undefined;
        const walk = via ? (this.deps.walk?.(via) ?? null) : null;
        if (via && !walk) this.warnOnce(`npcMoveTo: no walk "${via}"`);
        const speed = typeof step['speed'] === 'number' ? step['speed'] : walk?.speed;
        const pose = typeof step['pose'] === 'string' ? step['pose'] : undefined;
        return a.moveTo(at.pos, { ...(speed !== undefined ? { speed } : {}), ...(at.yaw !== undefined ? { yaw: at.yaw } : {}), ...(pose ? { pose } : {}), ...(walk ? { curve: walk.points } : {}), instant });
      }
      case 'npcDrag': {
        // `by` pulls the body along on a rope (ADR-0014 beat 7, Priya); `stop` or a skip lets go.
        const by = String(step['by'] ?? '');
        if (step['stop'] === true || instant || !by) {
          a.untow();
          return Promise.resolve();
        }
        if (!this.actors.has(by)) {
          this.warnOnce(`npcDrag: no npc "${by}"`);
          return Promise.resolve();
        }
        this.hold(npc);
        const dist = typeof step['distance'] === 'number' ? step['distance'] : undefined;
        const pose = typeof step['pose'] === 'string' ? step['pose'] : undefined;
        a.towBehind(() => this.actors.get(by)?.position ?? null, { ...(dist !== undefined ? { dist } : {}), ...(pose ? { pose } : {}) });
        return Promise.resolve();
      }
      case 'npcAnim': {
        this.hold(npc);
        const name = String(step['anim'] ?? 'idle');
        if (name === 'rub_forearm' || name === 'flex_hand' || name === 'cough') this.deps.emit?.('squad:tell', { id: SQUAD_NAMES[npc] ?? npc, tell: name });
        return a.playAnim(name, { instant, has: (p) => this.deps.ctx.poses.has(p) });
      }
      case 'npcLookAt':
        this.hold(npc);
        a.lookAt(this.getter(step['target']));
        return Promise.resolve();
      case 'npcFollow': {
        const tgt = step['target'];
        if (this.isSquad(npc)) {
          // Hand the squadmate back to his own follow AI, or hold him still.
          if (step['stay'] === true) {
            // Stay here (or follow `target`) until a later npcFollow, even between scenes.
            this.hold(npc);
            const mate = this.mateOf(npc);
            if (mate) this.parked.add(mate.id);
            if (tgt === undefined || tgt === 'none') a.stopMove();
            else a.followTarget(tgt === 'player' ? () => this.env.playerFeet : this.getter(tgt));
          } else if (step['stop'] === true) {
            this.hold(npc);
            a.stopMove();
          } else if (tgt === undefined || tgt === 'player') this.release(npc);
          else {
            this.hold(npc);
            a.followTarget(this.getter(tgt));
          }
          return Promise.resolve();
        }
        if (step['stop'] === true || tgt === undefined) a.followTarget(null);
        else {
          a.followTarget(tgt === 'player' ? () => this.env.playerFeet : this.getter(tgt));
          if (instant) {
            const p = tgt === 'player' ? this.env.playerFeet : this.getter(tgt)?.();
            if (p) a.place({ x: p.x + 1, y: p.y, z: p.z + 1 });
          }
        }
        return Promise.resolve();
      }
      case 'npcTask':
        return this.task(npc, a, step, instant);
      case 'kill':
        this.ambientLife?.interrupt(npc);
        return this.kills.start(npc, a, step, instant);
      case 'transform': {
        const to = typeof step['to'] === 'number' ? step['to'] : 3;
        const dur = typeof step['duration'] === 'number' ? step['duration'] : 0;
        if (instant || dur <= 0 || to < a.body.infection) {
          a.body.setInfection(to);
          return Promise.resolve();
        }
        a.body.startTransformation(dur);
        return this.after(dur).then(() => a.body.setInfection(to));
      }
      case 'attachToTrack': {
        const walk = this.deps.walk?.(String(step['track'] ?? '')) ?? null;
        if (walk) {
          // An authored walk (ADR-0028): a smooth curve, routed onto its start if needed.
          this.hold(npc);
          const end = walk.points[walk.points.length - 1]!;
          const speed = typeof step['speed'] === 'number' ? step['speed'] : walk.speed;
          const pose = typeof step['pose'] === 'string' ? step['pose'] : undefined;
          return a.moveTo(end, { curve: walk.points, instant, ...(speed !== undefined ? { speed } : {}), ...(pose ? { pose } : {}) });
        }
        const pts = this.trackPoints(String(step['track'] ?? ''), a.position);
        if (!pts?.length) {
          this.warnOnce(`attachToTrack: no track "${String(step['track'])}"`);
          return Promise.resolve();
        }
        this.hold(npc);
        const last = pts[pts.length - 1]!;
        const speed = typeof step['speed'] === 'number' ? step['speed'] : undefined;
        const pose = typeof step['pose'] === 'string' ? step['pose'] : undefined;
        return a.moveTo(last, { track: pts, instant, ...(speed !== undefined ? { speed } : {}), ...(pose ? { pose } : {}) });
      }
      case 'npcOffer':
        return this.offer(npc, a, step, instant);
      case 'npcOfferEnd':
        this.endOffer(npc, a);
        return Promise.resolve();
      default:
        this.warnOnce(`npc: unknown action ${action}`);
        return Promise.resolve();
    }
  }

  /**
   * Points of a track: the level's own path if `deps.track` knows the id, else a comma-separated
   * list of target refs (`anchor:a,anchor:b`) joined into one polyline, each leg following the
   * nav graph where it can and a straight line where it cannot.
   */
  trackPoints(spec: string, from: Vec3Like): P3[] | null {
    const own = this.deps.track?.(spec) ?? null;
    if (own?.length) return own;
    const refs = spec.split(',').map((s) => s.trim()).filter(Boolean);
    if (!refs.length || !refs.every((r) => r.startsWith('anchor:') || r.startsWith('npc:'))) return null;
    const out: P3[] = [];
    let prev: P3 = { x: from.x, y: from.y, z: from.z };
    for (const ref of refs) {
      const t = this.resolver?.(ref as TargetRef);
      if (!t) return null;
      const next: P3 = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
      const leg = this.deps.nav?.findPath(prev, next, { radius: 0.25 }) ?? null;
      if (leg?.length) for (const p of leg) out.push({ x: p.x, y: p.y, z: p.z });
      else out.push(next);
      prev = next;
    }
    return out;
  }

  /** `npcTask`: squad panel jobs run in the squad AI (pause/resume, defend); others just work. */
  private task(npc: string, a: NpcActor, step: Readonly<Record<string, unknown>>, instant: boolean): Promise<void> {
    const kind = String(step['task'] ?? 'bypass');
    if (npc === 'dock_guard' && kind === 'return_to_desk') {
      return this.dockGuard.start(a, instant);
    }
    const args = (step['args'] ?? {}) as Record<string, unknown>;
    const at = args['at'] !== undefined ? this.target(args['at'], 'npcTask', npc) : null;
    const duration = typeof args['duration'] === 'number' ? args['duration'] : undefined;
    const panel = typeof args['panel'] === 'string' ? args['panel'] : null;
    const mate = this.mateOf(npc);
    const squad = this.deps.squad;
    if (mate && squad) {
      // The squad AI runs tasks (so threats pause them); the sequence lets go of him.
      this.release(npc);
      if (instant) {
        if (at) a.place(at.pos, at.yaw);
        const t = squad.startTask(mate.id, kind, { at: at?.pos ?? null, ...(at?.yaw !== undefined ? { yaw: at.yaw } : {}), panel, ...(duration !== undefined ? { duration } : {}) });
        t.finish();
        mate.task = null;
        return Promise.resolve();
      }
      const t = squad.startTask(mate.id, kind, { at: at?.pos ?? null, ...(at?.yaw !== undefined ? { yaw: at.yaw } : {}), panel, ...(duration !== undefined ? { duration } : {}) });
      return new Promise((resolve) => t.whenDone(resolve));
    }
    // Crew: walk over, work for the duration, done.
    const secs = duration ?? 5;
    const emitDone = (): void => this.deps.emit?.('npc:taskDone', { npc, task: kind, panel });
    if (instant) {
      if (at) a.place(at.pos, at.yaw);
      emitDone();
      return Promise.resolve();
    }
    const walk = at ? a.moveTo(at.pos, at.yaw !== undefined ? { yaw: at.yaw } : {}) : Promise.resolve();
    return walk
      .then(() => a.playAnim('typing'))
      .then(() => this.after(secs))
      .then(() => {
        a.resetPose('idle');
        emitDone();
      });
  }

  /**
   * `npcOffer` (intro-sequence spec): the NPC holds the item out and an interact prompt appears on
   * them; using it emits `event`. The action (actions.ts) owns the timeout and flags; this
   * only does the body and the prompt. `instant` is the skip end state: handed over.
   */
  private offer(npc: string, a: NpcActor, step: Readonly<Record<string, unknown>>, instant: boolean): Promise<void> {
    const item = String(step['item'] ?? 'item');
    const event = typeof step['event'] === 'string' ? step['event'] : null;
    if (!this.isSquad(npc)) a.ambient = false;
    else this.hold(npc);
    if (instant) {
      this.endOffer(npc, a);
      return Promise.resolve();
    }
    a.offering = item;
    const pose = this.deps.ctx.poses.has(`offer_${item}`) ? `offer_${item}` : 'offer_mug';
    void a.playAnim(pose, { has: (p) => this.deps.ctx.poses.has(p) });
    this.offers.get(npc)?.();
    if (this.deps.interact) {
      // In front of the chest, where the outstretched hand ends up; generous so it is easy to hit.
      const p = a.position;
      const h = a.body.heading;
      const cx = p.x - Math.sin(h) * 0.45;
      const cz = p.z - Math.cos(h) * 0.45;
      const box = { min: [cx - 0.45, p.y + 0.7, cz - 0.45] as const, max: [cx + 0.45, p.y + 1.7, cz + 0.45] as const };
      const remove = this.deps.interact({
        id: `offer:${npc}`,
        prompt: typeof step['prompt'] === 'string' ? step['prompt'] : `Take ${item}`,
        box,
        enabled: () => a.offering === item,
        use: () => {
          this.endOffer(npc, a);
          if (event) this.deps.emit?.(event, { npc, item });
        },
      });
      this.offers.set(npc, remove);
    }
    return Promise.resolve();
  }

  private endOffer(npc: string, a: NpcActor): void {
    this.offers.get(npc)?.();
    this.offers.delete(npc);
    if (a.offering === null && a.body.idlePose !== 'offer_mug') return;
    a.offering = null;
    a.ambient = !this.isSquad(npc);
    a.resetPose('idle');
  }

  /** Is there an open offer from this NPC (tests, HUD)? */
  offering(npc: string): string | null {
    return this.actors.get(npc)?.offering ?? null;
  }

  // ------------------------------------------------------------------ solid bodies

  /** Is this actor a standing, visible body (not towed, carried, downed, lying or hidden)? */
  private isStanding(a: NpcActor, mate: SquadMate | null): boolean {
    if (!a.body.group.visible || a.towed || a.gripped || a.body.carried !== null || mate?.downed) return false;
    return a.body.state === 'alive' && !LYING_POSE.test(a.body.idlePose);
  }

  /** Calls `fn` for every standing body: cast, spawned NPCs and every squadmate (`owner` is the actor, if one exists). */
  private eachSolid(fn: (x: number, z: number, r: number, owner: NpcActor | null) => void): void {
    const seen = this.solidSeen;
    seen.clear();
    const mateFor = (a: NpcActor): SquadMate | null => this.mateOf(a.id);
    for (const a of this.actors.values()) {
      if (seen.has(a)) continue;
      seen.add(a);
      const mate = mateFor(a);
      if (mate) seen.add(mate);
      if (this.isStanding(a, mate)) fn(a.motor.x, a.motor.z, a.body.footprint.r, a);
    }
    if (this.deps.squad) {
      for (const mate of this.deps.squad.mates) {
        if (seen.has(mate)) continue;
        const a = this.actors.get(mate.id === 'engineer' ? 'giles' : 'okafor') ?? null;
        if (a) continue; // counted through its actor above
        if (mate.downed || !mate.body.group.visible || mate.body.carried !== null || mate.body.state !== 'alive' || LYING_POSE.test(mate.body.idlePose)) continue;
        fn(mate.motor.x, mate.motor.z, mate.body.footprint.r, null);
      }
    }
  }

  /**
   * Circles Jay collides with (the contract with `Player.setBodies`): every visible, standing or
   * walking humanoid, cast, spawned and every squadmate (scripted or AI). Towed or carried bodies,
   * downed and lying ones and hidden ones are left out. The returned array is reused: read it now.
   */
  solidBodies(): Iterable<{ x: number; z: number; r: number }> {
    let n = 0;
    this.eachSolid((x, z, r) => {
      let b = this.solid[n];
      if (!b) {
        b = { x: 0, z: 0, r: 0 };
        this.solid[n] = b;
      }
      b.x = x;
      b.z = z;
      b.r = r;
      n++;
    });
    this.solid.length = n;
    return this.solid;
  }

  /** Is another standing body in this circle (give-way spots)? */
  private occupiedAt(x: number, z: number, r: number, self: NpcActor): boolean {
    let hit = false;
    this.eachSolid((bx, bz, br, owner) => {
      if (owner !== self && Math.hypot(bx - x, bz - z) < r + br) hit = true;
    });
    return hit;
  }

  // ------------------------------------------------------------------ per step

  update(dt: number, camera: THREE.Vector3 | null, cameraForward: { x: number; z: number } | null = null): void {
    const p = this.deps.player();
    this.env.playerFeet.copy(p.feet);
    this.env.playerHead.copy(p.head);
    const wish = this.env.playerWish!;
    wish.x = p.wish?.x ?? 0;
    wish.z = p.wish?.z ?? 0;
    this.env.camera = camera;
    if (this.timers.length) {
      const due: Array<() => void> = [];
      this.timers = this.timers.filter((t) => {
        t.left -= dt;
        if (t.left > 0) return true;
        due.push(t.fn);
        return false;
      });
      for (const fn of due) fn();
    }
    if (this.unseenMoves.size) this.placeUnseen(camera ?? p.head, cameraForward);
    // The scene is over: squadmates go back to following Jay.
    if (this.held.size > this.parked.size && this.deps.sequenceRunning && !this.deps.sequenceRunning()) this.releaseUnparked();
    this.ambientLife?.update(dt, { eye: camera, forward: cameraForward });
    this.dockGuard.update(dt);
    this.kills.update(dt);
    const seen = new Set<NpcActor>();
    for (const [id, a] of this.actors) {
      if (seen.has(a)) continue;
      seen.add(a);
      const mate = this.mateOf(id);
      // Squadmates update through the squad unless held.
      if (mate && !mate.scripted) continue;
      a.update(dt, this.env);
    }
    // After every body has moved and posed: a gripped victim is put back in the attacker's hand.
    this.kills.lateUpdate(dt);
    this.authoredEngaged.clear();
    for (const g of this.chats.values()) {
      g.update(dt);
      if (g.engaged.length >= 2) for (const id of g.engaged) this.authoredEngaged.add(id);
    }
    if (this.ambientLife) {
      const groups = this.ambientLife.settledGroups();
      const activeGroups = new Set<string>();
      for (const [gid, ids] of groups) {
        const free = ids.filter((id) => !this.authoredEngaged.has(id)).sort();
        if (free.length < 2) continue;
        activeGroups.add(gid);
        const key = free.join(',');
        let entry = this.dynamicChats.get(gid);
        if (!entry || entry.key !== key) {
          entry?.group.reset();
          entry = { key, group: new ChatGroup(`dyn:${gid}:${key}`, free.map((id) => this.chatMember(id))) };
          this.dynamicChats.set(gid, entry);
        }
        entry.group.update(dt);
      }
      for (const [gid, entry] of [...this.dynamicChats]) {
        if (activeGroups.has(gid)) continue;
        entry.group.reset();
        this.dynamicChats.delete(gid);
      }
    }
    this.separateActors();
  }

  /**
   * Actor separation (ADR-0018) for scripted NPCs and lent squadmates: a soft push apart from each
   * other, enemies and the squad AI's own mates; then a separate pass against the player. Excluded: dragged/carried bodies and
   * anyone working in place (`separationExempt`), hidden far bodies. A walker with a goal outweighs
   * standing bodies and is not pushed at all within ARRIVE_LOCK of its end point, so `npcMoveTo`
   * still arrives; teleports (`instant`) just place the body, separation then eases overlap out.
   * The player pair is its own pass: Jay is immovable but never skips a pair, so any body he overlaps
   * (walkers near their goal and the squad AI's mates included) is pushed out of him, up to
   * PLAYER_MAX_PUSH per step. Exempt, downed and obstacle bodies are not moved.
   */
  private separateActors(): void {
    let n = 0;
    const put = (x: number, z: number, r: number, mass: number, owner: NpcActor | null, mate: SquadMate | null = null): void => {
      let b = this.sep[n];
      if (!b) {
        b = { x: 0, z: 0, r: 0, mass: 1 };
        this.sep[n] = b;
        this.sepStart[n] = { x: 0, z: 0 };
      }
      b.x = x;
      b.z = z;
      b.r = r;
      b.mass = mass;
      this.sepOwner[n] = owner;
      this.sepMate[n] = mate;
      const st = this.sepStart[n]!;
      st.x = x;
      st.z = z;
      n++;
    };
    const seen = new Set<NpcActor>();
    for (const a of this.actors.values()) {
      if (seen.has(a)) continue;
      seen.add(a);
      if (!a.body.group.visible) continue;
      const mate = this.mateOf(a.id);
      const fp = a.body.footprint;
      const m = a.motor;
      if (a.separationExempt || mate?.downed) {
        // Still a solid thing others keep out of, unless it is being carried.
        if (!a.towed && !a.gripped && a.body.carried === null) put(m.x, m.z, fp.r, Infinity, null);
        continue;
      }
      if (mate && !mate.scripted) {
        put(m.x, m.z, fp.r, Infinity, null, mate); // the squad AI steers itself (Jay's pass moves it)
        continue;
      }
      const goal = a.goalDistance;
      const mass = goal === null ? fp.mass : goal < ARRIVE_LOCK ? Infinity : Math.max(fp.mass, WALKER_MASS);
      put(m.x, m.z, fp.r, mass, a);
    }
    // Squadmates the sequences never touched are still bodies in the room.
    if (this.deps.squad) {
      for (const mate of this.deps.squad.mates) {
        if (seen.has(this.actors.get(mate.id === 'engineer' ? 'giles' : 'okafor') as NpcActor)) continue;
        if (!mate.body.group.visible) continue;
        put(mate.motor.x, mate.motor.z, mate.body.footprint.r, Infinity, null, mate);
      }
    }
    const extra = this.deps.obstacles?.();
    if (extra) for (const o of extra) put(o.x, o.z, o.r, Infinity, null);
    this.sep.length = n;
    this.sepOwner.length = n;
    this.sepStart.length = n;
    this.sepMate.length = n;
    if (n >= 2) {
      separate(this.sep, { iterations: 2, maxPush: 0.02 });
      for (let i = 0; i < n; i++) {
        const a = this.sepOwner[i];
        if (!a) continue;
        const b = this.sep[i]!;
        const st = this.sepStart[i]!;
        const dx = b.x - st.x;
        const dz = b.z - st.z;
        if (dx * dx + dz * dz > 1e-10) a.nudge(dx, dz, this.deps.colliders);
      }
    }
    // Jay: immovable, but every movable body paired with him is pushed clear (no pair is skipped).
    const jay = this.env.playerFeet;
    for (let i = 0; i < n; i++) {
      const owner = this.sepOwner[i];
      const mate = this.sepMate[i];
      if (!owner && !mate) continue;
      const m = owner ? owner.motor : mate!.motor;
      const A = this.pairA;
      const B = this.pairB;
      A.x = m.x;
      A.z = m.z;
      A.r = this.sep[i]!.r;
      A.mass = 1;
      B.x = jay.x;
      B.z = jay.z;
      B.r = PLAYER_RADIUS;
      separate(this.pair, { iterations: 1, maxPush: PLAYER_MAX_PUSH });
      if (A.x === m.x && A.z === m.z) continue;
      if (owner) owner.nudge(A.x - m.x, A.z - m.z, this.deps.colliders);
      else mate!.nudge(A.x - m.x, A.z - m.z, this.deps.colliders);
    }
  }

  private warnOnce(m: string): void {
    if (this.warned.has(m)) return;
    this.warned.add(m);
    (this.deps.warn ?? ((x: string) => console.warn(`[npc] ${x}`)))(m);
  }
}
