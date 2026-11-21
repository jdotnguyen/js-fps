import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.ts';
import { Animator, type GaitStyle } from './animator.ts';
import { planSpeech } from './speechActing.ts';
import type { Emote } from '../data/types/dialogue.ts';
import { bodyGeometryFromModel } from './bodyModel.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { buildBodyGeometry, triangleCount, woundCap, type BodyGeometry, type ExtraBone, type ExtraBoneDef, type Look, type Outfit, type PartGeometry } from './bodyGeometry.ts';
import { createBodyMaterials, MAX_BONES, MAX_BULGES, type BodyMaterials } from './bodyMaterial.ts';
import { rayCapsule } from './capsule.ts';
import { BodyDamage, DEFAULT_PROFILE, HERO_BASE_HP, HERO_PROFILE, POISE_WINDOW, SHAMBLER_BASE_HP, type HitResult, type LocomotionState } from './damage.ts';
import { BELLY_WOUND } from './heroSculpt.ts';
import { CastTells, NO_TELLS, type Tells } from './castTells.ts';
import { FootIkSolver } from './footIk.ts';
import { HandPhysicsSolver, type FingerName } from './handPhysics.ts';
import { LimbContactSolver, type ContactKind } from './limbContact.ts';
import type { ColliderQuery } from './motor.ts';
import { SLAM, SlamState } from './slam.ts';
import type { GoreSystem } from './gore.ts';
import { solveTwoBone } from './ik.ts';
import type { MocapLibrary } from './mocap.ts';
import { resolveProfile, sharedMotionProfiles, type Gender, type MotionProfileFile } from './motionProfiles.ts';
import { motionScene } from './motionScene.ts';
import { hasMocapPack } from './mocapPacks.ts';
import type { PoseLibrary } from './poses.ts';
import { footprintOf } from './separation.ts';
import { heldGripFor, type HeldGrip } from './heldGrip.ts';
import { HELD_GRIP_RADIUS, heldItemFor, heldTiltFor, levelHeld, makeHeld, MOUTH_IN_HEAD, mouthFromJaw, MUG_RIM, type HeldItem } from './heldProps.ts';
import { settleUprightTurn, Spring1D, stepUprightTurn, type UprightTurnState } from './springs.ts';
import { CRAWL_TURN, DRAG_TURN, newTurnState, settleTurn, stepTurn, type TurnState } from './turning.ts';
import { JOINT_INDEX, JOINTS, SEVER_JOINT, subtree, type JointName, type Region, type SeverableRegion, type Side } from './skeleton.ts';

/**
 * One procedural humanoid (ADR-0006): crew, squadmates, corpses and infected share this.
 *
 * Rendering note: the rigid parts are merged into one skinned mesh per material with
 * weight-1 skinning (each vertex follows exactly one joint). That keeps the body at 2 draw
 * calls instead of ~30, which the 300 draw-call budget (ADR-0015) needs with 10 humanoids
 * on screen. Joints are still Object3Ds (THREE.Bone) with the ADR's names, so pre-split
 * GLB parts can replace the procedural ones later.
 */

/** A leg hit that does not sever the leg staggers the body for this long, at this share of its speed (ADR-0019). */
export const STAGGER_TIME = 0.35;
export const STAGGER_SPEED = 0.3;
/** How far ahead of the body's origin (metres) the planted hands are when a crawler or dragger pivots. */
const PIVOT_REACH_CRAWL = 0.32;
const PIVOT_REACH_DRAG = 0.4;
/** Hero tier (ADR-0021): walk speed share, turn speed (rad/s), and how generous the weak-spot hit area is. */
const HERO_SPEED = 0.78; // x WALK_SPEED.enemy 0.8 = 0.62 m/s: one 1.6 m heavy stride per ~2.5 s
const HERO_TURN = 1.2;
const WEAK_SPOT_SLACK = 1.25;
/** Merge group for a piece: its imported surface, else its layer. Surface keys never clash with the layers (bodyModel.ts). */
const materialKey = (p: PartGeometry): string => p.surface ?? p.layer;
const isLegRegion = (r: Region): boolean => r.startsWith('thigh_') || r.startsWith('shin_');

export type Role = 'enemy' | 'npc' | 'corpse';
export type LifeState = 'alive' | 'falling' | 'gettingUp' | 'playingDead' | 'dead';

export interface HumanoidSpec {
  seed: string;
  outfit: Outfit;
  role: Role;
  /** Metres, default 1.78 (seeded ±4% when omitted). */
  height?: number;
  /** Width, default seeded 0.92..1.1. */
  build?: number;
  /** Infection stage 0..3 (fractions allowed). */
  infection?: number;
  /** Build growth geometry even at stage 0, so a scripted transformation can run. */
  transformable?: boolean;
  /** Hero tier: sculpted muscle, torn skin, tattered cloth. Use sparingly (budget). */
  hero?: boolean;
  /** Base HP before part fractions; already difficulty-scaled by the caller (ADR-0008). */
  baseHp?: number;
  /** Pose while standing still (npc) or lying (corpse). */
  pose?: string;
  /** Hand-set appearance for named characters (squad). */
  look?: Look;
  /**
   * Imported body model id (data/body-models.json, ADR-0026) in place of the procedural body. Ignored if the
   * context has no library or the model failed to load; outfit, look and hero sculpting do not apply to it.
   */
  model?: string;
  /**
   * The character's motion profile (src/data/motion-profiles.json, character-motion spec). Named characters have their own;
   * everyone else uses the default for their body's gender.
   */
  profile?: string;
  /** Gender for the default motion profile when the body has no imported model (an imported model's own gender wins). */
  gender?: Gender;
}

export type FootstepKind = 'walk' | 'jog' | 'pivot' | 'shamble' | 'heavy';

export interface FootstepEvent {
  x: number;
  y: number;
  z: number;
  side: Side;
  speed: number;
  kind: FootstepKind;
  actor: string;
}

export interface HumanoidContext {
  poses: PoseLibrary;
  gore: GoreSystem;
  /** Loaded imported body models (ADR-0026); bodies without one are procedural. */
  bodyModels?: BodyModelLibrary;
  /** Retargeted mocap clip library (Tier B); defaults to the shared compiled library. */
  mocap?: MocapLibrary;
  /** Motion profiles (tests); defaults to src/data/motion-profiles.json. */
  motionProfiles?: MotionProfileFile;
  /** World static/furniture colliders for general hand-vs-surface contact resolution. */
  colliders?: ColliderQuery | null;
  /** Optional world-space footstep callback fired on foot plants (audio / perception). */
  onFootstep?: (step: FootstepEvent) => void;
}

export interface BodyHit {
  humanoid: Humanoid;
  joint: JointName;
  region: Region;
  distance: number;
  point: THREE.Vector3;
}

const LOD_DISTANCE = 15;
/** Characters cast shadows within this distance of the camera; the quality tier sets it (render-quality spec). */
let characterShadowDistance = LOD_DISTANCE;

/** Set how far from the camera characters cast shadows (RENDER_TIERS `characterShadowDistance`). */
export function setCharacterShadowDistance(metres: number): void {
  characterShadowDistance = metres;
}

const TINY = 1e-4;
const WALK_SPEED: Record<Role, number> = { enemy: 0.8, npc: 1.4, corpse: 0 };

const smooth = (e0: number, e1: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

interface CapsuleBinding {
  joint: JointName;
  bone: THREE.Bone;
  region: Region;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

export class Humanoid {
  readonly group = new THREE.Group();
  readonly spec: Readonly<HumanoidSpec>;
  readonly damage: BodyDamage;
  readonly triangles: number;
  /** Imported body model in use, or null for a procedural body. */
  readonly modelId: string | null;
  readonly bones: Readonly<Record<JointName, THREE.Bone>>;

  state: LifeState;
  /** Facing angle (radians); 0 faces -Z. */
  heading = 0;
  /** Current ground speed (m/s). */
  speed = 0;
  /** Extra speed factor from the AI (lurch bursts, ADR-0007). */
  speedScale = 1;
  /** A downed body being moved by a script (dragged, carried): hold this pose, never a walking gait. */
  carried: string | null = null;
  /** World point the head turns toward, or null. */
  lookTarget: THREE.Vector3 | null = null;
  /** World points the hands reach for (consoles, panels), or null. */
  readonly handTargets: { L: THREE.Vector3 | null; R: THREE.Vector3 | null } = { L: null, R: null };
  /** 0..1 blend weights for `handTargets` two-bone IK (1 = full reach). */
  readonly handTargetWeights: { L: number; R: number } = { L: 1, R: 1 };
  /** Keep feet planted on the floor (crouching, kneeling work poses). */
  plantFeet = false;
  /** Standing-still pose for npcs; animation picks walk/crawl variants itself. */
  idlePose: string;

  private readonly ctx: HumanoidContext;
  private readonly rng: Rng;
  private readonly geo: BodyGeometry;
  private readonly materials: BodyMaterials;
  private readonly meshes: THREE.SkinnedMesh[] = [];
  private readonly boneList: THREE.Bone[] = [];
  private readonly boneIndex = new Map<string, number>();
  private readonly extras = new Map<ExtraBone, THREE.Bone>();
  private readonly animator: Animator;
  private readonly handPhysics: HandPhysicsSolver;
  private readonly limbContact = new LimbContactSolver();
  private readonly capsules: CapsuleBinding[] = [];
  private readonly detached = new Set<JointName>();
  private readonly stumpsOn = new Set<JointName>();
  private readonly hitboxes: THREE.Object3D[] = [];
  private infectionLevel: number;
  private transformAnim: { from: number; t: number; dur: number } | null = null;
  /** A scripted kill in progress (infection-kills spec): convulsion eases toward `target` at `rate` per second. */
  private kill: { target: number; rate: number } | null = null;
  /** Joint positions in bind-pose body space (the space the body shader's `position` lives in), for lumps and wounds. */
  private readonly bindJoint = new Map<JointName, THREE.Vector3>();
  /** Bind-space z of the body's front surface (its most -Z skin or cloth) at each joint, found on first use. */
  private readonly frontZ = new Map<JointName, number>();
  private castTells: CastTells | null = null;
  private stateTimer = 0;
  private pendingPool = -1;
  private near = true;
  /** Whether the body's meshes cast shadows (within the tier's character shadow distance). */
  private castsShadow = true;
  private readonly velocity = new THREE.Vector3();
  private time = 0;
  private trail = 0;
  private readonly glowPhase: number;
  private readonly tendrilRest = new Map<ExtraBone, THREE.Quaternion>();

  constructor(spec: HumanoidSpec, ctx: HumanoidContext) {
    this.spec = spec;
    this.ctx = ctx;
    this.rng = new Rng(`humanoid:${spec.seed}`);
    const height = spec.height ?? 1.78 * this.rng.range(0.96, 1.04);
    const build = spec.build ?? this.rng.range(0.92, 1.1);
    this.infectionLevel = THREE.MathUtils.clamp(spec.infection ?? 0, 0, 3);
    this.damage = spec.hero
      ? new BodyDamage(spec.baseHp ?? HERO_BASE_HP, HERO_PROFILE)
      : new BodyDamage(spec.baseHp ?? SHAMBLER_BASE_HP, DEFAULT_PROFILE);
    this.slam = spec.hero ? new SlamState() : null;
    this.idlePose = spec.pose ?? (spec.role === 'enemy' ? 'shamble' : 'idle');
    this.state = spec.role === 'corpse' ? 'dead' : 'alive';
    this.glowPhase = this.rng.range(0, Math.PI * 2);
    this.group.name = `humanoid:${spec.seed}`;

    const model = spec.model ? ctx.bodyModels?.get(spec.model) : undefined;
    this.modelId = model ? (spec.model ?? null) : null;
    this.geo = model ? bodyGeometryFromModel(model, height, this.rng.int(0, 1e6)) : buildBodyGeometry({
      outfit: spec.outfit,
      height,
      build,
      infectable: this.infectionLevel > 0 || spec.transformable === true,
      hero: spec.hero === true,
      seed: spec.seed,
      ...(spec.look ? { look: spec.look } : {}),
    });
    this.triangles = triangleCount(this.geo.parts);
    this.materials = createBodyMaterials(this.geo.surfaces);
    this.bones = this.buildSkeleton();
    this.buildMeshes();
    this.buildCapsules();
    this.animator = new Animator(this.jointBones(), ctx.poses, this.idlePose, this.rng.fork('anim'), ctx.mocap);
    this.motionGender = (spec.model ? ctx.bodyModels?.table?.[spec.model]?.gender : undefined) ?? spec.gender ?? 'm';
    this.motionFormal = spec.role === 'npc' && (spec.outfit === 'medic' || spec.seed === 'director-hale');
    this.hasVariants = Boolean(spec.profile && (ctx.motionProfiles ?? sharedMotionProfiles()).profiles[spec.profile]?.variants);
    const motion = this.resolveMotion();
    this.animator.setMotion(motion);
    const ownInitial = motion.poses[this.idlePose];
    if (ownInitial && ctx.poses.has(ownInitial)) {
      this.idlePose = ownInitial;
      this.animator.setPose(ownInitial, 0);
    }
    // Hold the character's clip pack while this body exists (released in dispose).
    if (spec.profile && hasMocapPack(spec.profile)) {
      this.mocapPack = spec.profile;
      this.animator.mocapLibrary.retainPack(spec.profile);
    }
    this.handPhysics = new HandPhysicsSolver(spec.seed, this.geo.handBones ?? [], this.extras, this.animator.motion.hands);
    this.applyBoneScales();
    this.group.updateMatrixWorld(true);
    this.prevWorldPos.copy(this.group.position);
  }

  // ---------------------------------------------------------------- queries

  get infection(): number {
    return this.infectionLevel;
  }

  get locomotion(): LocomotionState {
    return this.damage.locomotion();
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  /** Ground footprint circle and mass for body-vs-body separation (ADR-0018). */
  get footprint(): { r: number; mass: number } {
    return footprintOf(this.spec.hero === true, this.geo.scale.w);
  }

  get poseName(): string {
    return this.animator.poseName;
  }

  /** World position of a joint (e.g. 'head' for AI line of sight). */
  jointWorld(name: JointName, out = new THREE.Vector3()): THREE.Vector3 {
    return this.bones[name].getWorldPosition(out);
  }

  // ---------------------------------------------------------------- control

  setPose(name: string, blend = 0.4): void {
    // The character's profile or a scene variant may give it its own version of the pose (character-motion spec). Its own
    // version also blends at the character's tempo (Okafor's slow, steady glance).
    const own = this.animator.motion?.poses[name];
    if (own && this.ctx.poses.has(own)) {
      name = own;
      blend /= Math.max(0.5, this.animator.tempo);
    }
    this.idlePose = name;
    this.animator.setPose(name, blend);
  }

  /**
   * Explicitly override what the right hand holds (`'wand'`, `'mug'`, or `null` for empty hand); pass `undefined`
   * to follow the current pose again. Applies synchronously so prop handoffs never show zero or two items.
   */
  setHeldItem(item: HeldItem | null | undefined): void {
    this.heldOverride = item;
    this.syncHeld();
  }

  /** Show the item the pose holds (or the explicit `heldOverride`) while alive; hide the rest. */
  private syncHeld(): void {
    this.heldFor = `${this.idlePose}|${this.state}|${String(this.heldOverride)}`;
    const want = this.state === 'alive' ? (this.heldOverride !== undefined ? this.heldOverride : heldItemFor(this.idlePose)) : null;
    this.heldNow = want;
    if (want && !this.heldItems.has(want)) {
      // A mug in a hand with finger bones: its rig's own grip frame (D4) and the wrap solved for it, handle turned into the opening (D5).
      if (want === 'mug') this.mugGrip = heldGripFor(this.geo.handBones);
      const mesh = makeHeld(want, want === 'mug' ? (this.mugGrip?.frame ?? null) : null);
      this.heldItems.set(want, mesh);
      this.bones.hand_R.add(mesh);
    }
    for (const [item, mesh] of this.heldItems) mesh.visible = item === want;
  }

  /** The item in the right hand right now, if any (tests). */
  get holding(): HeldItem | null {
    for (const [item, mesh] of this.heldItems) if (mesh.visible) return item;
    return null;
  }

  /** Is the body holding a mug right now (tests)? */
  get holdingMug(): boolean {
    return this.holding === 'mug';
  }

  /**
   * Act out a spoken line (ADR-0027): the jaw follows the text's syllables for `duration` seconds and the emote picks the
   * hand and body gestures. Does nothing for the dead and the infected.
   */
  speak(text: string, emote: Emote | null, duration: number, seed = text): void {
    if (this.state !== 'alive' || this.infectionLevel >= 1) return;
    const plan = planSpeech(text, emote, duration, seed);
    // A mug in the right hand: gesture with the free left hand (upright-mug-grip D3b).
    if (heldItemFor(this.idlePose) === 'mug') plan.side = 1;
    this.animator.speak(plan);
  }

  /** The line ended or was cut off. */
  stopSpeaking(): void {
    this.animator.stopSpeaking();
  }

  get speaking(): boolean {
    return this.animator.speaking;
  }

  setInfection(stage: number): void {
    this.transformAnim = null;
    this.infectionLevel = THREE.MathUtils.clamp(stage, 0, 3);
  }

  /** Bandage / veins / sweat overlays for named characters (ADR-0022); built on first use. */
  setTells(t: Tells): void {
    if (!this.castTells) {
      if (t.bandage === NO_TELLS.bandage && t.veins === 0 && t.sweat === 0) return;
      this.castTells = new CastTells((name) => this.bones[name]);
    }
    this.castTells.set(t);
  }

  get tells(): Readonly<Tells> {
    return this.castTells?.current ?? NO_TELLS;
  }

  /** Scripted transformation 0 -> 3 (ADR-0006 set pieces): growths, skin, elongation, convulsions. */
  startTransformation(duration = 6): void {
    this.transformAnim = { from: this.infectionLevel, t: 0, dur: duration };
  }

  get transforming(): boolean {
    return this.transformAnim !== null;
  }

  // ---------------------------------------------------------------- scripted kills (infection-kills spec)

  /** Hand the body to a scripted kill: no mocap, foot IK, hand contact or idle life fight the authored beats. */
  beginKill(): void {
    this.transformAnim = null;
    this.kill = { target: 0, rate: 2 };
  }

  get killing(): boolean {
    return this.kill !== null;
  }

  /** The convulsion the body eases toward (0..1), at `rate` per second. */
  killConvulse(target: number, rate = 1.5): void {
    if (this.kill) {
      this.kill.target = THREE.MathUtils.clamp(target, 0, 1);
      this.kill.rate = rate;
    }
  }

  /** Current convulsion strength (tests, debug). */
  get convulsion(): number {
    return this.animator.convulse;
  }

  /** An additive jolt through `joint` and its parents; `dir` in body (group) space, the body faces -Z. */
  killKick(joint: JointName, dir: THREE.Vector3, strength: number): void {
    this.animator.kick(joint, dir, strength);
  }

  /**
   * Lump `i` under the skin, `t` (0..1) of the way along the joint chain `path`, pushed a little to the body's front.
   * `radius` 0 turns it off.
   */
  setBulge(i: number, path: readonly JointName[], t: number, radius: number, amp: number): void {
    if (i < 0 || i >= MAX_BULGES) return;
    const u = this.materials.uniforms;
    const slot = u.uBulge.value[i]!;
    // Each point of the path sits just under the body's own front surface there, so thick torsos, coats and thin limbs
    // all show the lump (on the bone line it can be 10 cm behind a heavy torso's skin).
    const pts = path
      .map((j) => {
        const b = this.bindJoint.get(j);
        return b ? b.clone().setZ(this.frontAt(j) + radius * 0.45) : undefined;
      })
      .filter((p): p is THREE.Vector3 => p !== undefined);
    if (radius <= 0 || pts.length === 0) {
      slot.set(0, 0, 0, 0);
      u.uBulgeAmp.value[i] = 0;
      return;
    }
    const k = THREE.MathUtils.clamp(t, 0, 1) * (pts.length - 1);
    const a = pts[Math.floor(k)]!;
    const b = pts[Math.min(pts.length - 1, Math.floor(k) + 1)]!;
    const f = k - Math.floor(k);
    slot.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f, radius);
    u.uBulgeAmp.value[i] = amp;
  }

  /** The front surface's bind-space z near a joint: the most -Z vertex in a small slab round it (the joint's own z if none). */
  private frontAt(j: JointName): number {
    const cached = this.frontZ.get(j);
    if (cached !== undefined) return cached;
    const c = this.bindJoint.get(j);
    if (!c) return 0;
    let front = c.z;
    for (const m of this.meshes) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - c.y) > 0.05 || Math.abs(pos.getX(i) - c.x) > 0.06) continue;
        const z = pos.getZ(i);
        if (z < front) front = z;
      }
    }
    this.frontZ.set(j, front);
    return front;
  }

  clearBulges(): void {
    for (let i = 0; i < MAX_BULGES; i++) this.setBulge(i, [], 0, 0, 0);
  }

  /** Tear the chest open (radius in metres; 0 heals it, as a checkpoint reload does). */
  tearChest(radius: number): void {
    const c = this.bindJoint.get('chest');
    const t = this.materials.uniforms.uTear.value;
    if (!c || radius <= 0) t.set(0, 0, 0, 0);
    else t.set(c.x, c.y - 0.02, this.frontAt('chest') + radius * 0.72, radius); // under the front surface: the opening is ~0.7 of the radius
  }

  get chestTorn(): boolean {
    return this.materials.uniforms.uTear.value.w > 0;
  }

  /** Die where she stands, into `pose`: no random corpse pose and no long death twitch (the kill twitches her itself). */
  killDie(pose: string, blend = 0.5): void {
    this.state = 'dead';
    this.speed = 0;
    this.transformAnim = null;
    this.animator.convulse = 0;
    this.animator.deathTwitch = 0;
    this.idlePose = pose;
    this.animator.setPose(pose, blend);
    this.charge = 0;
    if (this.kill) this.kill.target = 0;
  }

  /** The kill is over (or undone by a reload). */
  endKill(): void {
    this.kill = null;
    this.animator.convulse = 0;
  }

  /** Back to a living body after a checkpoint reload rebuilt the scene before the kill. */
  reviveAfterKill(pose: string): void {
    this.endKill();
    this.clearBulges();
    this.tearChest(0);
    this.state = 'alive';
    this.setPose(pose, 0.01);
  }

  /** A body lying still that gets up when disturbed (ADR-0007 play-dead). */
  playDead(pose = 'corpseProne'): void {
    this.state = 'playingDead';
    this.animator.setPose(pose, 0.01);
  }

  getUp(): void {
    if (this.state !== 'playingDead' || this.locomotion.mode !== 'walk') return;
    this.state = 'gettingUp';
    this.animator.playSequence('getUp', () => {
      if (this.state === 'gettingUp') this.state = 'alive';
    });
  }

  /**
   * Steer toward a world-space direction (xz) at walk speed for the current body state.
   * Stand-in mover until ADR-0007 owns navigation; pass null to stop.
   */
  move(desired: THREE.Vector3 | null, dt: number): void {
    this.steer(desired, dt);
    this.group.position.addScaledVector(this.velocity, dt);
  }

  /**
   * Turn and accelerate toward `desired` without moving; returns this frame's world velocity
   * for a caller that moves the body itself (the squad moves through the collision motor).
   */
  steer(desired: THREE.Vector3 | null, dt: number, opts: { maxSpeed?: number; turnRate?: number; accel?: number } = {}): Readonly<THREE.Vector3> {
    const loc = this.locomotion;
    const slamming = this.slam?.busy === true;
    const canMove = this.state === 'alive' && !slamming;
    // A hit to a leg makes the body flinch and nearly stop for a moment (ADR-0019).
    const flinch = this.staggerTimer > 0 ? STAGGER_SPEED : 1;
    const heroMul = this.spec.hero ? HERO_SPEED : 1;
    const max = canMove ? (opts.maxSpeed ?? WALK_SPEED[this.spec.role] * this.speedScale * heroMul) * loc.speedMul * flinch : 0;
    // Winding up a slam: the hero stands its ground but keeps aiming at the target (ADR-0021).
    if (slamming && this.state === 'alive' && desired && this.slam?.phase === 'windup') {
      let diff = Math.atan2(-desired.x, -desired.z) - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const turn = SLAM.windupTurn * dt;
      this.heading += THREE.MathUtils.clamp(diff, -turn, turn);
    }
    let target = 0;
    const heading0 = this.heading;
    const heavy = loc.mode !== 'walk';
    const turnParams = loc.mode === 'crawl' ? CRAWL_TURN : DRAG_TURN;
    this.turnError = 0;
    if (desired && canMove && desired.x * desired.x + desired.z * desired.z > 1e-6) {
      const want = Math.atan2(-desired.x, -desired.z);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (heavy) {
        // Crawlers and draggers pivot on the spot until they face the target, then move off (ADR-0020).
        const step = stepTurn(this.turn, diff, dt, turnParams);
        this.heading += step.dHeading;
        this.turnError = diff;
        target = max * step.speedFactor;
      } else {
        const rate = opts.turnRate ?? (this.spec.hero ? HERO_TURN : 2.2);
        this.heading += stepUprightTurn(this.uprightTurn, diff, rate, dt);
        this.turn.vel = 0;
        this.turn.inPlace = false;
        target = max * THREE.MathUtils.clamp(Math.cos(diff), 0, 1);
      }
    } else if (heavy) {
      this.heading += settleTurn(this.turn, dt, turnParams);
    } else {
      this.heading += settleUprightTurn(this.uprightTurn, dt);
      this.turn.vel = 0;
      this.turn.inPlace = false;
    }
    // Pivoting crawlers swing round their planted hands, not their hips: keep a point ahead of the body fixed.
    if (heavy && this.turn.inPlace) {
      const reach = loc.mode === 'crawl' ? PIVOT_REACH_CRAWL : PIVOT_REACH_DRAG;
      this.group.position.x += reach * (Math.sin(this.heading) - Math.sin(heading0));
      this.group.position.z += reach * (Math.cos(this.heading) - Math.cos(heading0));
    }
    // A pivoting body stops at once instead of coasting forward.
    this.speed += (target - this.speed) * Math.min(1, dt * (this.turn.inPlace ? 9 : (opts.accel ?? 4)));
    if (this.speed < 1e-3) this.speed = 0;
    this.velocity.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).multiplyScalar(this.speed);
    this.group.rotation.y = this.heading;
    return this.velocity;
  }

  /** Face a heading instantly (spawns and teleports). */
  setHeading(h: number): void {
    this.heading = h;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.uprightTurn.vel = 0;
    this.uprightTurn.error = 0;
    this.prevWorldPos.copy(this.group.position);
    this.prevWorldVel.set(0, 0, 0);
    this.footIk.reset();
    this.limbContact.reset();
    this.handPhysics.reset();
    this.resetFootsteps();
    this.group.rotation.y = h;
  }

  /** Feed an external separation push (world XZ metres) so the torso reacts with a subtle counter-lean. */
  nudgeImpulse(dx: number, dz: number, dt = 1 / 60): void {
    if (this.state !== 'alive' || dt <= 0) return;
    const vx = dx / dt;
    const vz = dz / dt;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    // Character right = (+cos, -sin), forward = (-sin, -cos).
    const localX = vx * c - vz * s;
    const localZ = -vx * s - vz * c;
    this.animator.nudgeImpulse(localX, localZ);
  }

  /** World-space foot-locking weight (0..1) for diagnostics and unit tests. */
  footLockWeight(side: Side): number {
    return this.footIk.lockWeight(side);
  }

  /** Whether this body carries preserved individual finger bones. */
  get hasFingerRig(): boolean {
    return this.handPhysics.hasFingerRig;
  }

  /** Whether this body carries preserved forearm twist bones. */
  get hasForeArmTwists(): boolean {
    return this.handPhysics.hasForeArmTwists;
  }

  /** Diagnostic getter for unit tests: current MCP curl (0..1+) of one finger. */
  fingerCurl(side: Side, finger: FingerName): number {
    return this.handPhysics.fingerCurl(side, finger);
  }

  /** Diagnostic getter for unit tests: current phalanx curls [mcp, pip, dip] of one finger. */
  fingerPhalanxCurls(side: Side, finger: FingerName): [number, number, number] {
    return this.handPhysics.fingerPhalanxCurls(side, finger);
  }

  /** Diagnostic getter for unit tests: magnitude of the inertial wrist spring offset (rad). */
  wristSpringMagnitude(side: Side): number {
    return this.handPhysics.wristSpringMagnitude(side);
  }

  /** Diagnostic getter for unit tests: latest extracted forearm pronation/supination twist (rad). */
  foreArmTwist(side: Side): number {
    return this.handPhysics.foreArmTwist(side);
  }

  /** Diagnostic getter for unit tests: smoothed hand contact weight (0..1) from LimbContactSolver. */
  handContactWeight(side: Side): number {
    return this.limbContact.contactOf(side).weight;
  }

  /** Diagnostic getter for unit tests: active hand contact kind ('none' | 'body' | 'world'). */
  handContactKind(side: Side): ContactKind {
    return this.limbContact.contactOf(side).kind;
  }

  // ---------------------------------------------------------------- hits

  private readonly rayTmpA = new THREE.Vector3();
  private readonly rayTmpB = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly scaleTmp = new THREE.Vector3();

  /** Nearest hit capsule along a normalised world ray, or null (ADR-0006 hitboxes). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = Infinity): BodyHit | null {
    // Broad phase: a sphere around the pelvis big enough for any pose.
    this.bones.pelvis.getWorldPosition(this.center);
    const reach = 1.5 * this.geo.scale.y;
    const oc = this.rayTmpA.subVectors(origin, this.center);
    const b = oc.dot(dir);
    const c = oc.lengthSq() - reach * reach;
    if (c > 0 && (b > 0 || b * b - c < 0)) return null;

    let best: BodyHit | null = null;
    for (const cap of this.capsules) {
      if (this.damage.isSevered(cap.region) || this.detached.has(cap.joint)) continue;
      const m = cap.bone.matrixWorld;
      const a = this.rayTmpA.copy(cap.a).applyMatrix4(m);
      const bb = this.rayTmpB.copy(cap.b).applyMatrix4(m);
      this.scaleTmp.setFromMatrixColumn(m, 0);
      const r = cap.r * this.scaleTmp.length();
      const t = rayCapsule(origin, dir, a, bb, r);
      if (t >= 0 && t <= maxDist && (!best || t < best.distance)) {
        best = { humanoid: this, joint: cap.joint, region: cap.region, distance: t, point: origin.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }

  /** Apply weapon damage at a hit (ADR-0005 calls this). `dir` is the shot direction. */
  applyHit(hit: BodyHit, amount: number, dir: THREE.Vector3): HitResult {
    const wasWalking = this.locomotion.mode === 'walk';
    const weak = this.isWeakSpot(hit);
    const result = this.damage.apply(hit.region, amount, weak);
    const gore = this.ctx.gore;
    gore.burst(hit.point, dir.clone().multiplyScalar(-0.6).add(new THREE.Vector3(0, 0.4, 0)), 22);
    if (this.rng.chance(0.35)) gore.chunks(hit.point, dir.clone().multiplyScalar(0.4), 1);

    const localDir = dir.clone().applyQuaternion(this.group.quaternion.clone().invert());
    const hitKick = Math.min(0.9, (amount / 18) * 0.38);
    this.animator.kick(hit.joint, localDir, hitKick);
    if (hit.joint.endsWith('_L') || hit.joint.endsWith('_R')) {
      const side: Side = hit.joint.endsWith('_L') ? 'L' : 'R';
      this.handPhysics.impulseWrist(side, -localDir.z * hitKick * 8, 0, localDir.x * hitKick * 6);
    } else {
      this.handPhysics.impulseWrist('L', -localDir.z * hitKick * 4, 0, localDir.x * hitKick * 3);
      this.handPhysics.impulseWrist('R', -localDir.z * hitKick * 4, 0, localDir.x * hitKick * 3);
    }
    // Stagger (ADR-0019, ADR-0021): crowd bodies on every leg hit; tough bodies only when enough damage lands
    // close together, or on any weak-spot hit, which also cancels a slam.
    if (result.applied > 0 && !result.severed && this.state === 'alive') {
      const poise = this.damage.profile.poise;
      this.poiseDamage += result.applied;
      this.poiseTimer = POISE_WINDOW;
      if (weak) {
        this.staggerTimer = STAGGER_TIME * 2;
        this.animator.kick('spine', localDir, 0.9);
        this.slam?.cancel();
      } else if (poise === 0 ? isLegRegion(hit.region) : this.poiseDamage >= poise) {
        this.staggerTimer = STAGGER_TIME;
        this.poiseDamage = 0;
      }
    }
    if (weak) gore.burst(hit.point, dir.clone().multiplyScalar(-0.9).add(new THREE.Vector3(0, 0.2, 0)), 40);

    if (result.severed) this.sever(result.severed, dir);
    if (this.state === 'playingDead') this.getUp();

    if (result.killedBy === 'torso') {
      // Torso destroyed: it bursts.
      gore.burst(hit.point, dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.8, 0)), 90);
      gore.chunks(hit.point, dir.clone().multiplyScalar(0.6), 9);
    }
    if (result.severed || result.killed) this.slam?.cancel();
    if (result.killed) {
      this.die(result.killedBy === 'limbs' && !wasWalking);
    } else if (wasWalking && this.locomotion.mode !== 'walk' && (this.state === 'alive' || this.state === 'gettingUp')) {
      // Lost a leg: fall, then crawl/drag.
      this.state = 'falling';
      this.stateTimer = 0.75;
      this.animator.setPose(this.locomotion.mode === 'crawl' ? 'crawl' : 'dragging', 0.65);
    }
    return result;
  }

  // ---------------------------------------------------------------- per frame

  /**
   * Ask a hero to slam a target (world position). Starts only in range, roughly facing it, off cooldown
   * and walking (ADR-0021). Returns whether it started.
   */
  tryAttack(target: THREE.Vector3): boolean {
    if (!this.slam || this.state !== 'alive' || this.locomotion.mode !== 'walk' || this.staggerTimer > 0) return false;
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    let diff = Math.atan2(-dx, -dz) - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return this.slam.start(Math.hypot(dx, dz), diff);
  }

  /** Inside a hit flinch (ADR-0019) or an AI stagger: the AI starts no new attack (ADR-0007). */
  get staggered(): boolean {
    return this.staggerTimer > 0;
  }

  /** Flinch for at least `seconds` (shove, shotgun blast, lost limb: ADR-0007). Cancels a hero's windup. */
  stagger(seconds: number): void {
    if (this.state !== 'alive') return;
    this.staggerTimer = Math.max(this.staggerTimer, seconds);
    if (this.slam?.phase === 'windup') this.slam.cancel();
  }

  /** Damage without a ray hit (shove, scripts, debug kill): no gore burst, but death still applies. Use torso or head. */
  hurt(region: Region, amount: number): HitResult {
    const wasWalking = this.locomotion.mode === 'walk';
    const result = this.damage.apply(region, amount);
    if (result.killed) this.die(result.killedBy === 'limbs' && !wasWalking);
    return result;
  }

  /** Swipe animation for a crowd attack (ADR-0007): the arm on `side` lashes forward and the chest follows. */
  strike(side: Side, strength = 0.8): void {
    this.strikeDir.set(0, 0.2, -1);
    this.animator.kick(`foreArm_${side}`, this.strikeDir, strength);
    this.animator.kick(`upperArm_${side}`, this.strikeDir, strength * 0.8);
    this.animator.kick('chest', this.strikeDir, strength * 0.4);
    this.handPhysics.impulseWrist(side, strength * 7.5, (side === 'R' ? 1 : -1) * strength * 3, 0);
  }
  private readonly strikeDir = new THREE.Vector3();

  /** World point where a slam landed this frame (y = 0), once; null otherwise. Callers apply `slamFalloff`. */
  consumeSlamImpact(): THREE.Vector3 | null {
    const p = this.slamImpact;
    this.slamImpact = null;
    return p;
  }

  /** A heavy foot came down this frame (hero stomp: the caller can shake the camera). */
  get footfall(): boolean {
    return this.animator.footfall;
  }

  /** Is a torso hit on the hero's belly wound? The hit point is tested in spine space against the painted wound (heroSculpt). */
  private isWeakSpot(hit: BodyHit): boolean {
    // Any torso capsule counts: in the hunch the chest capsule covers the belly from the front.
    if (!this.spec.hero || hit.region !== 'torso') return false;
    const local = this.bones.spine.worldToLocal(this.rayTmpA.copy(hit.point));
    if (local.z > -0.02) return false;
    const x = (local.x - BELLY_WOUND.x) / (BELLY_WOUND.rx * WEAK_SPOT_SLACK);
    const y = (local.y - BELLY_WOUND.y) / (BELLY_WOUND.ry * WEAK_SPOT_SLACK);
    return x * x + y * y <= 1;
  }

  /** 0..1 lunge (AI lurch bursts and attacks, ADR-0007): lean in, arms out, jaw wide. */
  charge = 0;

  update(dt: number, cameraPosition: THREE.Vector3 | null = null): void {
    this.time += dt;
    if (this.heldFor !== `${this.idlePose}|${this.state}|${String(this.heldOverride)}`) this.syncHeld();
    this.updateTimers(dt);
    if (this.slam) {
      if (this.state !== 'alive' || this.locomotion.mode !== 'walk') this.slam.cancel();
      if (this.slam.update(dt)) {
        this.group.updateMatrixWorld();
        const f = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
        this.slamImpact = this.group.position.clone().addScaledVector(f, SLAM.reach * this.geo.scale.y * 0.9);
        this.slamImpact.y = 0;
        this.animator.kick('chest', new THREE.Vector3(0, 0, -1), 0.5);
        this.ctx.gore.burst(this.slamImpact.clone().setY(0.1), new THREE.Vector3(0, 1.2, 0), 26);
      }
    }
    this.updateSceneMotion(dt);
    this.updateInfection(dt);
    this.updateKinematics(dt);
    this.chooseAnimation();
    const moving = this.state === 'alive' || this.state === 'falling' || this.state === 'gettingUp';
    const lying = Humanoid.LYING_POSE.test(this.idlePose) || this.carried !== null;
    this.animator.setWound(this.locomotion.limpSide, this.locomotion.limp);
    this.animator.infect = this.infectionLevel / 3;
    this.animator.twitchy = moving && (this.spec.role === 'enemy' || this.infectionLevel >= 1);
    this.animator.idleLife = this.state === 'alive' && this.spec.role === 'npc' && !this.locomotion.blind && !lying && !this.kill ? 1 : 0;
    const uprightAlive = this.state === 'alive' && this.locomotion.mode === 'walk' && !lying && this.spec.role !== 'corpse';
    this.animator.useMocap = uprightAlive && !(this.spec.role === 'npc' && this.locomotion.blind) && this.slam?.busy !== true && !this.kill;
    this.animator.charge = this.state === 'alive' && this.locomotion.mode === 'walk' ? Math.max(this.charge, this.speedScale > 1.2 ? 1 : 0) : 0;
    this.updateBloodTrail(dt);
    if (this.lookTarget && this.state === 'alive' && !this.locomotion.blind) {
      this.group.updateMatrixWorld();
      this.animator.lookLocal = this.group.worldToLocal(this.rayTmpA.copy(this.lookTarget)).divideScalar(this.geo.scale.y);
    } else {
      this.animator.lookLocal = null;
    }
    this.animator.update(dt);
    const cameraDist = cameraPosition ? this.group.position.distanceTo(cameraPosition) : null;
    if (cameraDist !== null) {
      this.near = cameraDist < LOD_DISTANCE;
      const casts = cameraDist < characterShadowDistance;
      if (casts !== this.castsShadow) {
        this.castsShadow = casts;
        for (const m of this.meshes) m.castShadow = casts;
      }
    }
    this.applyBoneScales();
    this.updateTendrils();
    this.updateCloth(dt);
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 2.3 + this.glowPhase) * Math.sin(this.time * 0.7 + this.glowPhase);
    this.materials.uniforms.uGlow.value = smooth(0.8, 3, this.infectionLevel) * pulse * (this.state === 'dead' ? 0.3 : 1) * 0.9;
    this.solveIk(dt);
    const ikTargetL = this.speed <= 0.1 && this.limbAttached('L', true) ? this.handTargets.L : null;
    const ikTargetR = this.speed <= 0.1 && this.limbAttached('R', true) ? this.handTargets.R : null;
    const handContactEligible =
      this.state === 'alive' &&
      this.spec.role !== 'corpse' &&
      !lying &&
      !this.transformAnim &&
      !this.kill &&
      this.locomotion.mode === 'walk' &&
      this.near;
    this.limbContact.solve({
      group: this.group,
      bones: this.bones,
      capsules: this.capsules,
      ...(this.geo.torsoHulls ? { torsoHulls: this.geo.torsoHulls } : {}),
      colliders: this.ctx.colliders ?? null,
      scaleY: this.geo.scale.y,
      attachedL: this.limbAttached('L', true) && !this.animator.limp.has(JOINT_INDEX.hand_L),
      attachedR: this.limbAttached('R', true) && !this.animator.limp.has(JOINT_INDEX.hand_R),
      skipL: ikTargetL !== null,
      skipR: ikTargetR !== null,
      enabled: handContactEligible,
      dt,
    });
    // A favoured (injured) arm moves less and more slowly, contact pushes included (character-motion, design D12).
    this.animator.guardArm(dt);
    this.handPhysics.update({
      group: this.group,
      bones: this.bones,
      dt,
      alive: this.state !== 'dead' && this.state !== 'playingDead',
      corpse: this.spec.role === 'corpse',
      poseName: this.animator.poseName,
      speed: this.speed,
      accelFwd: this.animator.accelFwd,
      accelLat: this.animator.accelLat,
      infect: this.infectionLevel / 3,
      twitchy: this.animator.twitchy,
      speechEmote: this.animator.speechEmote,
      speechWeight: this.animator.speechWeight,
      speechPulse: this.animator.speechPulse,
      speechPrimarySide: this.animator.speechPrimarySide,
      limpL: !this.limbAttached('L', true) || this.animator.limp.has(JOINT_INDEX.hand_L),
      limpR: !this.limbAttached('R', true) || this.animator.limp.has(JOINT_INDEX.hand_R),
      ikTargetL,
      ikTargetR,
      contactL: this.limbContact.contactOf('L'),
      contactR: this.limbContact.contactOf('R'),
      cameraDist,
      clipFingers: this.animator.clipFingers,
      clipFingerWeight: this.animator.clipFingerW,
      // The wand keeps the radius wrap; a mug uses its solved contact pose (a hand without finger bones has nothing to wrap).
      heldRadiusR: this.heldNow === 'wand' ? HELD_GRIP_RADIUS.wand : null,
      heldGripR: this.heldNow === 'mug' ? this.mugGrip : null,
    });
    this.levelHeldMug(dt);
    this.updateFootsteps(dt);
  }

  /** How far the held mug leans from vertical (radians), eased toward the pose's tilt so a sip never snaps. */
  private readonly heldTilt = new Spring1D({ f: 2.2, z: 1 });
  private heldTiltReady = false;
  private readonly towardFace = new THREE.Vector3();

  /**
   * Keep a held mug upright, or tipped toward the face in a drink pose (held-props spec, upright-mug-grip D3), by swinging the
   * right hand after everything else has moved it (pose, hold clip, contact, wrist springs, speech).
   */
  private levelHeldMug(dt: number): void {
    const mug = this.heldNow === 'mug' ? this.heldItems.get('mug') : undefined;
    const limpR = !this.limbAttached('R', true) || this.animator.limp.has(JOINT_INDEX.hand_R) || this.animator.limp.has(JOINT_INDEX.foreArm_R);
    if (!mug?.visible || this.state !== 'alive' || limpR) {
      this.heldTiltReady = false;
      return;
    }
    const want = heldTiltFor(this.animator.poseName);
    if (!this.heldTiltReady) {
      this.heldTilt.reset(want);
      this.heldTiltReady = true;
    } else if (dt > 0) {
      this.heldTilt.step(want, Math.min(dt, 0.05));
    }
    // From in front of the body back toward the face (the body faces -Z).
    this.towardFace.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    const tilt = Math.max(0, this.heldTilt.value);
    this.heldSwing = levelHeld(this.bones.hand_R, mug, tilt, this.towardFace);
    const reach = THREE.MathUtils.clamp(tilt / heldTiltFor('drink'), 0, 1);
    if (reach > 0.01) this.reachMugToMouth(mug, tilt, reach);
  }

  /** This body's mouth in its head bone's frame (measured from its jaw mesh once, on the first sip). */
  private mouth: { y: number; z: number } | null = null;
  private readonly reachTmp = { mouth: new THREE.Vector3(), rim: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3(), target: new THREE.Vector3(), elbow: new THREE.Vector3(), handQ: new THREE.Quaternion(), parentQ: new THREE.Quaternion() };

  /**
   * Drink poses (upright-mug-grip D3c): move the leveled mug so its rim is at the mouth, solving the right arm with two-bone IK
   * (the elbow keeps its side) and keeping the hand's leveled orientation. `weight` blends from the authored arm (0) to the reach (1).
   */
  private reachMugToMouth(mug: THREE.Object3D, tilt: number, weight: number): void {
    const t = this.reachTmp;
    const hand = this.bones.hand_R;
    const upper = this.bones.upperArm_R;
    const lower = this.bones.foreArm_R;
    this.group.updateMatrixWorld(true);
    // The mouth, a little in front of the lips.
    this.mouth ??= mouthFromJaw(this.geo.parts, this.geo.jointOffsets.jaw) ?? MOUTH_IN_HEAD;
    this.bones.head.localToWorld(t.mouth.set(0, this.mouth.y, this.mouth.z));
    t.mouth.addScaledVector(this.towardFace, -0.015);
    // The rim point nearest the face, on the leveled mug.
    const e = mug.matrixWorld.elements;
    t.up.set(e[4]!, e[5]!, e[6]!);
    const worldScale = t.up.length();
    t.up.divideScalar(worldScale);
    t.side.copy(this.towardFace).addScaledVector(t.up, -this.towardFace.dot(t.up));
    if (t.side.lengthSq() < 1e-8) return;
    t.side.normalize();
    mug.localToWorld(t.rim.set(0, MUG_RIM.y, 0)).addScaledVector(t.side, MUG_RIM.r * worldScale);
    // Where the hand must go for that rim to sit at the mouth.
    hand.getWorldPosition(t.target).add(t.mouth).sub(t.rim);
    hand.getWorldQuaternion(t.handQ);
    lower.getWorldPosition(t.elbow);
    solveTwoBone(upper, lower, hand, t.target, t.elbow.addScaledVector(this.towardFace, 0.1), weight);
    // Keep the hand's leveled orientation through the arm's new angles, then level out what the solve left.
    hand.parent!.getWorldQuaternion(t.parentQ).invert();
    hand.quaternion.copy(t.parentQ.multiply(t.handQ));
    hand.updateMatrixWorld(true);
    levelHeld(hand, mug, tilt, this.towardFace);
  }

  /** How far (radians) the last frame's leveling had to swing the right hand to keep the held mug at its tilt (tests). */
  heldSwing = 0;

  private static readonly LYING_POSE = /^(corpse|squad_downed|squad_getUp|writhing|crawl|dragging|getUp)/;
  private static readonly SEATED_POSE = /^sit_/;
  private readonly uprightTurn: UprightTurnState = { vel: 0, error: 0 };
  private readonly prevWorldPos = new THREE.Vector3();
  private readonly prevWorldVel = new THREE.Vector3();
  private readonly curWorldVel = new THREE.Vector3();
  private readonly footIk = new FootIkSolver();
  /** ADR-0029: a mug in the right hand while the pose is a mug or drink pose (made on first use). */
  private readonly heldItems = new Map<HeldItem, THREE.Mesh>();
  /** The solved mug wrap for this body's hand, or null for a hand without finger bones. */
  private mugGrip: HeldGrip | null = null;
  private heldFor = '';
  /** Explicit held-item override (`undefined` follows pose; `null` forces empty hand). */
  private heldOverride: HeldItem | null | undefined = undefined;
  /** What the right hand holds now (for the hand solver's grip). */
  private heldNow: HeldItem | null = null;
  private readonly footPlanted: [boolean, boolean] = [true, true];
  private readonly footCooldown: [number, number] = [0, 0];
  private readonly footPosTmp = new THREE.Vector3();
  private footReady = false;
  private fallbackStride = 0;
  private fallbackSide: Side = 'L';

  private resetFootsteps(): void {
    this.footPlanted[0] = true;
    this.footPlanted[1] = true;
    this.footCooldown[0] = 0;
    this.footCooldown[1] = 0;
    this.footReady = false;
    this.fallbackStride = 0;
  }

  /**
   * Fire footstep events synced to actual foot-plant contacts from mocap/pivot curves
   * (plus hero stomp `footfall` and a stride-distance fallback for non-mocap upright gaits).
   */
  private updateFootsteps(dt: number): void {
    this.footCooldown[0] = Math.max(0, this.footCooldown[0] - dt);
    this.footCooldown[1] = Math.max(0, this.footCooldown[1] - dt);

    const onFootstep = this.ctx.onFootstep;
    if (!onFootstep || !this.group.visible || this.state !== 'alive' || this.carried !== null || this.spec.role === 'corpse') {
      this.footReady = false;
      return;
    }
    const lying = Humanoid.LYING_POSE.test(this.idlePose);
    if (this.locomotion.mode !== 'walk' || lying || this.transformAnim || this.kill) {
      this.footReady = false;
      return;
    }

    const contacts = this.animator.footContacts;
    if (!this.footReady) {
      this.footPlanted[0] = contacts[0] >= 0.5;
      this.footPlanted[1] = contacts[1] >= 0.5;
      this.footReady = true;
      return;
    }

    const emitStep = (side: Side, kind: FootstepKind): void => {
      const idx = side === 'L' ? 0 : 1;
      this.bones[`foot_${side}`].getWorldPosition(this.footPosTmp);
      onFootstep({
        x: this.footPosTmp.x,
        y: this.group.position.y + 0.05,
        z: this.footPosTmp.z,
        side,
        speed: this.speed,
        kind,
        actor: this.spec.seed,
      });
      this.footCooldown[idx] = 0.22;
    };

    // Hero heavy gait drives its own stomp timing via `animator.footfall`.
    if (this.animator.gait === 'heavy') {
      if (this.animator.footfall) {
        const side = this.fallbackSide;
        this.fallbackSide = side === 'L' ? 'R' : 'L';
        emitStep(side, 'heavy');
      }
      return;
    }

    // Contact-synced footsteps for mocap walks/jogs/shambles and turn-in-place pivot steps.
    if (this.animator.useMocap || this.animator.pivotWeight > 0.2) {
      for (let idx = 0; idx < 2; idx++) {
        const side: Side = idx === 0 ? 'L' : 'R';
        if (!this.limbAttached(side, false)) {
          this.footPlanted[idx] = false;
          continue;
        }
        const c = contacts[idx]!;
        if (this.footPlanted[idx]) {
          if (c < 0.42) this.footPlanted[idx] = false;
        } else if (c >= 0.58) {
          this.footPlanted[idx] = true;
          const stepping = this.speed > 0.15 || this.animator.pivotWeight > 0.25;
          if (stepping && this.footCooldown[idx]! <= 0) {
            const kind: FootstepKind =
              this.speed <= 0.2
                ? 'pivot'
                : this.animator.gait === 'shamble' || this.animator.gait === 'flail'
                  ? 'shamble'
                  : this.animator.jogWeight > 0.45
                    ? 'jog'
                    : 'walk';
            emitStep(side, kind);
          }
        }
      }
      return;
    }

    // Stride-distance fallback for non-mocap upright gaits (e.g. blind flailing NPCs).
    if (this.speed > 0.15) {
      this.fallbackStride += this.speed * dt;
      if (this.fallbackStride >= 0.68) {
        this.fallbackStride -= 0.68;
        const side = this.fallbackSide;
        this.fallbackSide = side === 'L' ? 'R' : 'L';
        if (this.limbAttached(side, false)) {
          emitStep(side, this.animator.gait === 'shamble' || this.animator.gait === 'flail' ? 'shamble' : 'walk');
        }
      }
    }
  }

  /** Derive character-local forward/lateral acceleration from actual world movement for inertial lean/bank. */
  private updateKinematics(dt: number): void {
    const pos = this.group.position;
    if (dt <= 1e-5) return;
    const dx = pos.x - this.prevWorldPos.x;
    const dz = pos.z - this.prevWorldPos.z;
    const dist = Math.hypot(dx, dz);
    this.prevWorldPos.copy(pos);
    if (dist > 2.5) {
      // Teleport: reset velocity & foot pins cleanly without a lean spike.
      this.prevWorldVel.set(0, 0, 0);
      this.animator.accelFwd = 0;
      this.animator.accelLat = 0;
      this.footIk.reset();
      this.resetFootsteps();
      return;
    }
    // Fall back to commanded steering velocity when caller updates `steer()` without moving `group.position`.
    const vx = dist > 1e-5 ? dx / dt : this.velocity.x;
    const vz = dist > 1e-5 ? dz / dt : this.velocity.z;
    this.curWorldVel.set(vx, 0, vz);
    const ax = THREE.MathUtils.clamp((vx - this.prevWorldVel.x) / dt, -14, 14);
    const az = THREE.MathUtils.clamp((vz - this.prevWorldVel.z) / dt, -14, 14);
    this.prevWorldVel.lerp(this.curWorldVel, 1 - Math.exp(-12 * dt));
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    this.animator.accelFwd = -ax * s - az * c;
    this.animator.accelLat = ax * c - az * s;
  }

  private readonly swayQ = new THREE.Quaternion();
  private readonly swayE = new THREE.Euler();

  /** Tendrils writhe constantly; harder when the body lunges or convulses. */
  private updateTendrils(): void {
    if (!this.near) return;
    const t = this.time;
    const agitation = 1 + 1.5 * Math.max(this.charge, this.animator.convulse) + (this.state === 'dead' ? -0.7 : 0);
    for (const e of this.geo.extraBones) {
      if (e.kind !== 'tendril') continue;
      const bone = this.extras.get(e.name);
      if (!bone) continue;
      const [, ti, si] = e.name.split('_');
      const k = Number(si) + 1;
      const ph = Number(ti) * 2.1 + this.glowPhase;
      this.swayE.set(
        0.45 * agitation * Math.sin(t * (1.6 + 0.3 * k) + ph + k * 0.9) * (0.4 + 0.25 * k),
        0.3 * Math.sin(t * 1.1 + ph * 1.7),
        0.5 * agitation * Math.sin(t * (2.1 + 0.4 * k) + ph * 1.3 + k * 1.2) * (0.4 + 0.25 * k),
      );
      this.swayQ.setFromEuler(this.swayE);
      const rest = this.tendrilRest.get(e.name);
      if (rest) bone.quaternion.copy(rest).multiply(this.swayQ);
      else bone.quaternion.copy(this.swayQ);
    }
  }

  private readonly clothQ = new THREE.Quaternion();
  private readonly clothE = new THREE.Euler();
  private readonly clothWorld = new THREE.Quaternion();
  private readonly clothUp = new THREE.Quaternion();
  private clothLag = 0;
  private staggerTimer = 0;
  private poiseDamage = 0;
  private poiseTimer = 0;
  /** Hero slam attack (ADR-0021); null for crowd bodies. */
  readonly slam: SlamState | null;
  private slamImpact: THREE.Vector3 | null = null;
  private slamPhaseShown: string = 'idle';
  private readonly turn: TurnState = newTurnState();
  /** Heading error to the target (rad, + = left) while a crawler or dragger is steering, else 0. */
  private turnError = 0;

  /**
   * Coat tails: each chain bone sways on its own phase, trails behind the walk, and is eased toward
   * hanging straight down so the hunched spine does not hold the cloth out at an angle.
   */
  private updateCloth(dt: number): void {
    const t = this.time;
    const dead = this.state === 'dead';
    // Lag follows speed with a delay, so the tails swing out when the body lurches and fall back after.
    this.clothLag += (this.speed - this.clothLag) * Math.min(1, dt * 3);
    const trail = THREE.MathUtils.clamp(this.clothLag / 1.3, 0, 2);
    const amp = dead ? 0.25 : 1 + 0.8 * Math.max(this.charge, this.animator.convulse);
    this.group.getWorldQuaternion(this.clothUp);
    for (const e of this.geo.extraBones) {
      if (e.kind !== 'cloth') continue;
      const bone = this.extras.get(e.name);
      if (!bone || !bone.parent) continue;
      const [, ci, si] = e.name.split('_');
      const k = Number(si) + 1;
      const ph = Number(ci) * 1.9 + this.glowPhase;
      this.clothE.set(
        // Trailing back (+Z) is a negative turn about X.
        -0.1 * trail * k + 0.07 * amp * Math.sin(t * (1.1 + 0.25 * k) + ph + k),
        0.05 * amp * Math.sin(t * 0.8 + ph * 1.4),
        0.08 * amp * Math.sin(t * (1.4 + 0.3 * k) + ph * 1.3 + k * 1.1),
      );
      this.clothQ.setFromEuler(this.clothE);
      // Gravity: the rotation that would bring this bone back to the body's upright, blended in.
      bone.parent.getWorldQuaternion(this.clothWorld).invert().multiply(this.clothUp);
      bone.quaternion.identity().slerp(this.clothWorld, k === 1 ? 0.55 : 0.3).multiply(this.clothQ);
    }
  }

  /** Crawlers and draggers smear blood behind them. */
  private updateBloodTrail(dt: number): void {
    if (this.state !== 'alive' || this.locomotion.mode === 'walk' || this.speed < 0.05) return;
    this.trail += this.speed * dt;
    if (this.trail < 0.45) return;
    this.trail = 0;
    this.ctx.gore.pool(this.jointWorld('pelvis'), 0.28);
  }

  showHitboxes(on: boolean): void {
    for (const h of this.hitboxes) h.visible = on;
  }

  private motionGender: Gender = 'm';
  private motionFormal = false;
  private hasVariants = false;
  private sceneVersion = -1;
  private sceneCheck = 0;

  /** This body's motion profile with the scene variants in effect (character-motion spec). */
  private resolveMotion(): ReturnType<typeof resolveProfile> {
    const profile = this.spec.profile;
    const scene = profile
      ? { sequences: motionScene.sequences, task: motionScene.tasks.get(profile) ?? null, stage: motionScene.stage, flag: (n: string) => Boolean(motionScene.flags()[n]) }
      : undefined;
    return resolveProfile(this.animator.mocapLibrary, this.ctx.motionProfiles ?? sharedMotionProfiles(), profile, this.motionGender, this.motionFormal, scene);
  }

  /** Re-resolve scene variants when the scene changes (and a few times a second, for story flags); cross-fade over 0.3 s. */
  private updateSceneMotion(dt: number): void {
    if (!this.hasVariants) return;
    this.sceneCheck -= dt;
    if (motionScene.version === this.sceneVersion && this.sceneCheck > 0) return;
    this.sceneVersion = motionScene.version;
    this.sceneCheck = 0.25;
    const next = this.resolveMotion();
    if (next.variants.join('|') === this.animator.motion.variants.join('|')) return;
    this.animator.setMotion(next, 0.3);
  }

  /** Show a concealed injury at this weight (0..1, see injury.ts): Giles's favoured left arm. */
  setInjury(weight: number, side: Side = 'L'): void {
    this.animator.injuryTarget = THREE.MathUtils.clamp(weight, 0, 1);
    this.animator.injurySide = side;
  }

  /** Infection stage for the involuntary finger twitch of characters whose hands twitch (Giles). */
  setHandTwitchStage(stage: number): void {
    this.handPhysics.twitchStage = stage;
  }

  get injuryWeight(): number {
    return this.animator.injuryW;
  }

  /** The clip pack this body holds, if its character has one. */
  private mocapPack: string | null = null;

  dispose(): void {
    if (this.mocapPack) {
      this.animator.mocapLibrary.releasePack(this.mocapPack);
      this.mocapPack = null;
    }
    this.castTells?.dispose();
    this.group.removeFromParent();
    for (const m of this.meshes) m.geometry.dispose();
    this.materials.body.dispose();
    this.materials.wet.dispose();
    for (const m of Object.values(this.materials.surfaces)) m.dispose();
    for (const p of this.geo.parts) p.geometry.dispose();
    for (const h of this.hitboxes) if (h instanceof THREE.LineSegments) h.geometry.dispose();
  }

  // ---------------------------------------------------------------- internals: build

  private materialFor(key: string): THREE.MeshStandardMaterial {
    if (key === 'body' || key === 'wet') return this.materials[key];
    const m = this.materials.surfaces[key];
    if (!m) throw new Error(`humanoid: no surface material ${key}`);
    return m;
  }

  private jointBones(): THREE.Bone[] {
    return JOINTS.map((j) => this.bones[j.name]);
  }

  private buildSkeleton(): Record<JointName, THREE.Bone> {
    const w = this.geo.scale.w;
    const out = {} as Record<JointName, THREE.Bone>;
    for (const j of JOINTS) {
      const bone = new THREE.Bone();
      bone.name = j.name;
      const at = this.geo.jointOffsets[j.name] ?? j.offset;
      bone.position.set(at[0] * w, at[1], at[2]);
      out[j.name] = bone;
      if (j.parent) out[j.parent].add(bone);
      this.boneIndex.set(j.name, this.boneList.length);
      this.boneList.push(bone);
    }
    for (const e of this.geo.extraBones) {
      const bone = new THREE.Bone();
      bone.name = e.name;
      bone.position.set(e.offset[0], e.offset[1], e.offset[2]);
      if (e.rest) {
        bone.rotation.set(e.rest[0], e.rest[1], e.rest[2]);
        this.tendrilRest.set(e.name, bone.quaternion.clone());
      }
      const parent = (out as Record<string, THREE.Bone | undefined>)[e.parent] ?? this.extras.get(e.parent as ExtraBone);
      if (!parent) throw new Error(`bone ${e.name}: parent ${e.parent} not built yet`);
      parent.add(bone);
      this.extras.set(e.name, bone);
      this.boneIndex.set(e.name, this.boneList.length);
      this.boneList.push(bone);
    }
    if (this.boneList.length > MAX_BONES) throw new Error(`humanoid has ${this.boneList.length} bones (max ${MAX_BONES})`);
    out.root.scale.setScalar(this.geo.scale.y);
    this.group.add(out.root);
    return out;
  }

  private boneOf(name: PartGeometry['bone']): THREE.Bone {
    const i = this.boneIndex.get(name);
    const bone = i === undefined ? undefined : this.boneList[i];
    if (!bone) throw new Error(`no bone ${name}`);
    return bone;
  }

  private buildMeshes(): void {
    this.group.updateMatrixWorld(true);
    // Bind-pose joint positions in the space the merged geometry is built in (bone world at build time).
    for (const j of JOINTS) {
      const bone = this.bones[j.name];
      if (bone) this.bindJoint.set(j.name, bone.getWorldPosition(new THREE.Vector3()));
    }
    const layers = new Map<string, THREE.BufferGeometry[]>();
    for (const part of this.geo.parts) {
      const bone = this.boneOf(part.bone);
      const g = part.geometry.clone().applyMatrix4(bone.matrixWorld);
      const key = materialKey(part);
      if (!layers.has(key)) layers.set(key, []);
      if (g.getAttribute('skinIndex')) {
        // Imported pieces arrive smooth-skinned onto the joints (bodyModel.ts); joint index = bone index.
        layers.get(key)!.push(g);
        continue;
      }
      const count = g.getAttribute('position').count;
      const index = this.boneIndex.get(part.bone) ?? 0;
      const si = new Uint16Array(count * 4);
      const sw = new Float32Array(count * 4);
      const chain = part.chain;
      const pos = part.geometry.getAttribute('position');
      for (let v = 0; v < count; v++) {
        si[v * 4] = index;
        sw[v * 4] = 1;
        if (!chain) continue;
        // Blend the two chain bones whose pivots bracket this vertex's height.
        const y = pos.getY(v);
        let k = 0;
        while (k + 1 < chain.ys.length && y <= (chain.ys[k + 1] as number)) k++;
        const hi = chain.ys[k] as number;
        const lo = chain.ys[k + 1];
        const next = chain.bones[k + 1];
        const cur = this.boneIndex.get(chain.bones[k] as string) ?? index;
        si[v * 4] = cur;
        if (lo !== undefined && next !== undefined && y < hi) {
          const w = THREE.MathUtils.clamp((hi - y) / (hi - lo), 0, 1);
          si[v * 4 + 1] = this.boneIndex.get(next) ?? cur;
          sw[v * 4] = 1 - w;
          sw[v * 4 + 1] = w;
        }
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      layers.get(key)!.push(g);
    }
    const skeleton = new THREE.Skeleton(this.boneList);
    for (const [key, list] of layers) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) throw new Error('humanoid: geometry merge failed (attribute mismatch)');
      const mesh = new THREE.SkinnedMesh(merged, this.materialFor(key));
      mesh.name = `${this.group.name}:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Poses reach ~1.9 m from the feet in any direction; a fixed sphere avoids per-frame bounds.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.3);
      mesh.bind(skeleton);
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private buildCapsules(): void {
    const w = this.geo.scale.w;
    const mat = new THREE.LineBasicMaterial({ color: 0x4fd6d0, transparent: true, opacity: 0.7, depthTest: false });
    for (const j of JOINTS) {
      if (!j.capsule || !j.region) continue;
      const bone = this.bones[j.name];
      const a = new THREE.Vector3(...j.capsule.a);
      const b = new THREE.Vector3(...j.capsule.b);
      const r = j.capsule.r * w;
      this.capsules.push({ joint: j.name, bone, region: j.region, a, b, r });
      // Debug draw (ADR-0006 step 2).
      const len = a.distanceTo(b);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.CapsuleGeometry(r, len, 2, 8)), mat);
      wire.position.addVectors(a, b).multiplyScalar(0.5);
      wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      wire.visible = false;
      wire.renderOrder = 10;
      bone.add(wire);
      this.hitboxes.push(wire);
    }
  }

  // ---------------------------------------------------------------- internals: state

  private updateTimers(dt: number): void {
    if (this.staggerTimer > 0) this.staggerTimer -= dt;
    if (this.poiseTimer > 0) {
      this.poiseTimer -= dt;
      if (this.poiseTimer <= 0) this.poiseDamage = 0;
    }
    if (this.state === 'falling') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'alive';
    }
    if (this.pendingPool >= 0) {
      this.pendingPool -= dt;
      if (this.pendingPool < 0) this.ctx.gore.pool(this.jointWorld('spine'), 1.1);
    }
  }

  private updateInfection(dt: number): void {
    const anim = this.transformAnim;
    if (anim) {
      anim.t += dt;
      const s = Math.min(1, anim.t / anim.dur);
      this.infectionLevel = anim.from + (3 - anim.from) * smooth(0, 1, s);
      this.animator.convulse = s < 1 ? 0.35 + 0.65 * Math.sqrt(Math.sin(Math.PI * Math.min(1, s * 1.15))) : 0;
      if (anim.t >= anim.dur + 0.5) {
        this.transformAnim = null;
        this.animator.convulse = 0;
      }
    }
    if (this.kill) {
      const c = this.animator.convulse;
      const step = this.kill.rate * dt;
      this.animator.convulse = c + THREE.MathUtils.clamp(this.kill.target - c, -step, step);
    }
    this.materials.uniforms.uInfect.value = this.infectionLevel / 3;
  }

  private chooseAnimation(): void {
    const loc = this.locomotion;
    let gait: GaitStyle = 'none';
    if (this.state === 'alive' && !this.carried) {
      if (loc.mode === 'crawl') gait = 'crawl';
      else if (loc.mode === 'drag') gait = 'drag';
      else if (loc.blind) gait = 'flail';
      else if (this.spec.hero) gait = 'heavy';
      else if (this.speed > 0.05 || this.spec.role === 'enemy') gait = this.spec.role === 'enemy' ? 'shamble' : 'walk';
    }
    this.animator.gait = gait;
    this.animator.speed = this.carried ? 0 : this.speed;
    const crawling = gait === 'crawl' || gait === 'drag';
    this.animator.turnRate = crawling ? this.turn.vel : this.uprightTurn.vel;
    this.animator.turnError = crawling ? this.turnError : this.uprightTurn.error;
    if (this.state !== 'alive' || this.animator.sequencePlaying) return;
    const phase = this.slam?.phase ?? 'idle';
    if (phase !== this.slamPhaseShown) {
      this.slamPhaseShown = phase;
      if (phase === 'windup') this.animator.setPose('slamWindup', SLAM.windup * 0.75);
      else if (phase === 'strike') this.animator.setPose('slamImpact', SLAM.strike);
    }
    if (phase === 'windup' || phase === 'strike') return;
    if (phase === 'recover' && (this.slam?.t ?? 0) < SLAM.recover * 0.45) return; // hold the impact, then heave back up
    let pose = this.idlePose;
    if (loc.mode === 'crawl') pose = 'crawl';
    else if (loc.mode === 'drag') pose = 'dragging';
    else if (loc.blind) pose = 'blindFlail';
    else if (this.spec.role === 'npc' && this.speed > 0.05) pose = 'walk';
    else if (this.spec.role === 'enemy') pose = this.spec.pose ?? 'shamble';
    if (this.carried) pose = this.carried;
    if (this.kill) pose = this.idlePose; // a kill stagger keeps its authored upper body; the legs still step

    this.animator.setPose(pose, 0.45);
  }

  private die(prone: boolean): void {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.speed = 0;
    this.animator.convulse = 0;
    this.transformAnim = null;
    const pose = prone || this.locomotion.mode !== 'walk'
      ? 'corpseProne'
      : this.rng.pick(['corpseProne', 'corpseSupine', 'corpseSide']);
    this.animator.setPose(pose, 0.7);
    this.animator.deathTwitch = 3 + this.infectionLevel * 1.5;
    this.charge = 0;
    this.pendingPool = 0.9;
  }

  // ---------------------------------------------------------------- internals: severing

  private sever(region: SeverableRegion, dirWorld: THREE.Vector3): void {
    const jointName = SEVER_JOINT[region];
    const bone = this.bones[jointName];
    const gore = this.ctx.gore;
    const def = JOINTS[JOINT_INDEX[jointName]];
    const towardChild = new THREE.Vector3(0, jointName === 'head' ? 1 : -1, 0);
    const world = bone.getWorldPosition(new THREE.Vector3());

    if (gore.mode === 'reduced') {
      // No detached parts: the limb goes limp and dark; dark fluid only.
      const sub = new Set(subtree(jointName));
      for (const j of sub) {
        this.animator.limp.add(JOINT_INDEX[j]);
        const idx = this.boneIndex.get(j);
        if (idx !== undefined) this.materials.uniforms.uDark.value[idx] = 1;
      }
      for (const e of this.geo.extraBones) {
        if (sub.has(this.rootJointOf(e))) {
          const idx = this.boneIndex.get(e.name);
          if (idx !== undefined) this.materials.uniforms.uDark.value[idx] = 1;
        }
      }
      gore.spurt(bone, new THREE.Vector3(), towardChild.clone().negate(), 1.0, true);
      gore.pool(world, 0.45, true);
      return;
    }

    this.group.updateMatrixWorld(true);
    const debris = this.buildDebris(jointName, (this.modelId ? this.ctx.bodyModels?.get(this.modelId)?.stumpRadius[jointName] : undefined) ?? def?.segment?.r0 ?? 0.05);
    for (const j of subtree(jointName)) this.detached.add(j);
    this.stumpsOn.add(jointName);
    this.applyBoneScales();

    const velocity = dirWorld.clone().multiplyScalar(2.2).add(new THREE.Vector3(0, 1.6, 0)).add(this.velocity);
    gore.addDebris(debris.object, velocity, debris.probes, debris.radius, debris.dispose);
    const stump = this.extras.get(`stump_${jointName}`);
    if (stump) gore.spurt(stump, new THREE.Vector3(), towardChild, 1.5);
    gore.spurt(debris.object, new THREE.Vector3(), towardChild.clone().negate(), 0.7);
    gore.chunks(world, dirWorld.clone().multiplyScalar(0.5), 5);
    gore.pool(world, 0.55);
  }

  private buildDebris(rootJoint: JointName, capRadius: number): {
    object: THREE.Group;
    probes: THREE.Vector3[];
    radius: number;
    dispose: () => void;
  } {
    const root = this.bones[rootJoint];
    const inv = root.matrixWorld.clone().invert();
    const chain = new Set(subtree(rootJoint).filter((j) => !this.detached.has(j)));
    const layers = new Map<string, THREE.BufferGeometry[]>();
    const push = (key: string, g: THREE.BufferGeometry): void => {
      if (!layers.has(key)) layers.set(key, []);
      layers.get(key)!.push(g);
    };
    const m = new THREE.Matrix4();
    for (const part of this.geo.parts) {
      const owner = part.bone;
      let include = chain.has(owner as JointName);
      if (!include) {
        const extra = this.extraDef(owner as ExtraBone);
        if (extra && chain.has(this.rootJointOf(extra))) {
          include = extra.kind !== 'stump' || this.stumpsOn.has(extra.name.slice('stump_'.length) as JointName);
        }
      }
      if (!include) continue;
      m.multiplyMatrices(inv, this.boneOf(owner).matrixWorld);
      push(materialKey(part), part.geometry.clone().applyMatrix4(m));
    }
    // Cut face on the severed end, facing back toward the body.
    const dirY: 1 | -1 = rootJoint === 'head' ? -1 : 1;
    for (const g of woundCap(capRadius * this.geo.scale.w, dirY, this.rng.int(0, 1e6))) push('wet', g);

    const object = new THREE.Group();
    object.name = `debris:${rootJoint}`;
    root.matrixWorld.decompose(object.position, object.quaternion, object.scale);
    const geos: THREE.BufferGeometry[] = [];
    for (const [key, list] of layers) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.materialFor(key));
      mesh.castShadow = true;
      object.add(mesh);
      geos.push(merged);
    }
    const probes: THREE.Vector3[] = [];
    let radius = 0.03;
    for (const cap of this.capsules) {
      if (!chain.has(cap.joint)) continue;
      m.multiplyMatrices(inv, cap.bone.matrixWorld);
      probes.push(cap.a.clone().applyMatrix4(m), cap.b.clone().applyMatrix4(m));
      radius = Math.max(radius, cap.r * 0.8);
    }
    if (probes.length === 0) probes.push(new THREE.Vector3());
    return { object, probes, radius, dispose: () => geos.forEach((g) => g.dispose()) };
  }

  private extraDef(name: ExtraBone): ExtraBoneDef | undefined {
    return this.geo.extraBones.find((e) => e.name === name);
  }

  /** The joint an extra bone ultimately hangs from (tendril chains are extras of extras). */
  private rootJointOf(e: ExtraBoneDef): JointName {
    let parent = e.parent;
    for (let guard = 0; guard < 16; guard++) {
      const up = this.extraDef(parent as ExtraBone);
      if (!up) return parent as JointName;
      parent = up.parent;
    }
    return parent as JointName;
  }

  // ---------------------------------------------------------------- internals: scale + IK

  private applyBoneScales(): void {
    const inf = this.infectionLevel;
    const elongHand = 1 + 0.45 * smooth(1.8, 3, inf);
    const elongArm = 1 + 0.12 * smooth(2, 3, inf);
    for (const s of ['L', 'R'] as const) {
      this.bones[`hand_${s}`].scale.set(1, elongHand, 1);
      this.bones[`foreArm_${s}`].scale.set(1, elongArm, 1);
    }
    for (const j of this.detached) this.bones[j].scale.setScalar(TINY);
    const growth = this.near ? smooth(0.6, 3, inf) : 0;
    const shards = smooth(1.6, 2.6, inf);
    for (const e of this.geo.extraBones) {
      const bone = this.extras.get(e.name);
      if (!bone) continue;
      let s = 1;
      if (e.kind === 'growth') s = growth;
      else if (e.kind === 'shards') s = shards;
      else if (e.kind === 'ribs') s = smooth(1.9, 2.7, inf);
      else if (e.kind === 'tendril') s = e.name.endsWith('_0') ? (this.near ? smooth(1.3, 2.8, inf) : 0) : 1;
      else if (e.kind === 'cloth' || e.kind === 'finger' || e.kind === 'twist') s = 1;
      else s = this.stumpsOn.has(e.name.slice('stump_'.length) as JointName) ? 1 : 0;
      bone.scale.setScalar(Math.max(TINY, s));
    }
  }

  private readonly ikPole = new THREE.Vector3();

  private limbAttached(side: Side, arm: boolean): boolean {
    const a = arm ? `upperArm_${side}` as const : `thigh_${side}` as const;
    const b = arm ? `foreArm_${side}` as const : `shin_${side}` as const;
    return !this.damage.isSevered(a) && !this.damage.isSevered(b);
  }

  private solveIk(dt: number): void {
    if (this.state !== 'alive' || this.transformAnim || this.kill) {
      this.footIk.reset();
      return;
    }
    const lying = Humanoid.LYING_POSE.test(this.idlePose) || this.carried !== null;
    const seated = Humanoid.SEATED_POSE.test(this.idlePose);
    const uprightAlive = this.spec.role !== 'corpse' && this.locomotion.mode === 'walk' && !lying && !seated && !this.animator.sequencePlaying;
    const forcePlant = this.plantFeet && this.locomotion.mode === 'walk' && this.speed <= 0.1;
    // Continuous world-space foot-locking IK for upright living humanoids (cast, crew, and enemies).
    let solved = this.footIk.solve({
      group: this.group,
      bones: this.bones,
      scaleY: this.geo.scale.y,
      scaleW: this.geo.scale.w,
      contactL: this.animator.footContacts[0],
      contactR: this.animator.footContacts[1],
      attachedL: this.limbAttached('L', false),
      attachedR: this.limbAttached('R', false),
      enabled: uprightAlive && this.near,
      forcePlant,
      dt,
    });

    if (this.speed <= 0.1) {
      const doHands = (this.handTargets.L !== null && this.limbAttached('L', true)) || (this.handTargets.R !== null && this.limbAttached('R', true));
      if (doHands) {
        if (!solved) this.group.updateMatrixWorld(true);
        for (const s of ['L', 'R'] as const) {
          const target = this.handTargets[s];
          const weight = THREE.MathUtils.clamp(this.handTargetWeights[s], 0, 1);
          if (!target || weight <= 1e-4 || !this.limbAttached(s, true)) continue;
          const x = s === 'L' ? -1 : 1;
          this.group.localToWorld(this.ikPole.set(x * 0.7, 0.9, 0.8));
          solveTwoBone(this.bones[`upperArm_${s}`], this.bones[`foreArm_${s}`], this.bones[`hand_${s}`], target, this.ikPole, weight);
          solved = true;
        }
      }
    }
    if (solved) this.group.updateMatrixWorld(true);
  }
}
