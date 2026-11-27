import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.ts';
import { Animator, type GaitStyle } from './animator.ts';
import { planSpeech } from './speechActing.ts';
import type { Emote } from '../data/types/dialogue.ts';
import type { LoudnessEnvelope } from '../audio/loudness.ts';
import { bodyGeometryFromModel } from './bodyModel.ts';
import { bladeCreatureProfile, type BodyModelLibrary } from './bodyModelLibrary.ts';
import { buildBodyGeometry, triangleCount, woundCap, type BodyGeometry, type ExtraBone, type ExtraBoneDef, type Look, type Outfit, type PartGeometry } from './bodyGeometry.ts';
import { createBodyMaterials, DRY, MAX_BONES, MAX_BULGES, type BodyMaterials } from './bodyMaterial.ts';
import { stepWetHeight, wetLine } from './wetness.ts';
import { rayCapsule } from './capsule.ts';
import { BodyDamage, DEFAULT_PROFILE, HERO_BASE_HP, HERO_PROFILE, POISE_WINDOW, SHAMBLER_BASE_HP, type HitResult, type LocomotionState } from './damage.ts';
import { BELLY_WOUND } from './heroSculpt.ts';
import { CastTells, NO_TELLS, type Tells } from './castTells.ts';
import { ANKLE_CLEARANCE, FootIkSolver } from './footIk.ts';
import { HandPhysicsSolver, type FingerName } from './handPhysics.ts';
import { LimbContactSolver, type ContactKind } from './limbContact.ts';
import type { ColliderQuery } from './motor.ts';
import { SLAM, SlamState } from './slam.ts';
import type { GoreSystem } from './gore.ts';
import { solveTwoBone } from './ik.ts';
import { clipRootSpeed, type MocapLibrary } from './mocap.ts';
import type { TouchPart } from '../data/types/kills.ts';
import { resolveProfile, sharedMotionProfiles, type Gender, type MotionProfileFile } from './motionProfiles.ts';
import { motionScene } from './motionScene.ts';
import { hasMocapPack, loadMocapPacks } from './mocapPacks.ts';
import type { PoseLibrary } from './poses.ts';
import { footprintOf } from './separation.ts';
import { heldGripFor, type HeldGrip, type SolvedItem } from './heldGrip.ts';
import { ManualCaster, shadowCasters, type ShadowCasterSet } from '../render/shadowCasters.ts';
import { contactBodies, type ContactSample } from '../render/contactShadows.ts';
import { HELD_GRIP_RADIUS, heldDuringBlend, heldItemFor, heldTiltFor, levelHeld, makeHeld, MOUTH_IN_HEAD, mouthFromJaw, MUG_RIM, pistolGripFrameFor, type HeldItem } from './heldProps.ts';
import { AIM_CLAMP, aimSwing, ARM_AIM_CLAMP, ARM_AIM_EASE, MUZZLE_FLASH_TIME, pistolParts, SLIDE_CYCLE, slideOffset, type HeldPistolParts } from './squadPistol.ts';
import { settleUprightTurn, Spring1D, stepUprightTurn, type UprightTurnState } from './springs.ts';
import { CRAWL_TURN, DRAG_TURN, newTurnState, settleTurn, stepTurn, type TurnState } from './turning.ts';
import { JOINT_INDEX, JOINTS, SEVER_JOINT, subtree, type JointName, type Region, type SeverableRegion, type Side, type Vec3T } from './skeleton.ts';
import { bladeLayerFor, type BladeLayer } from './blade/layer.ts';
import { BladeMotion, legGeometry } from './blade/motion.ts';

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
   * Imported body model id (data/bodyModelFiles.ts, ADR-0026) in place of the procedural body. Ignored if the
   * context has no library or the model failed to load; outfit, look and hero sculpting do not apply to it.
   */
  model?: string;
  /**
   * The character's motion profile (src/data/motionFiles.ts, character-motion spec). Named characters have their own;
   * everyone else uses the default for their body's gender.
   */
  profile?: string;
  /** Gender for the default motion profile when the body has no imported model (an imported model's own gender wins). */
  gender?: Gender;
}

export type FootstepKind = 'walk' | 'jog' | 'pivot' | 'shamble' | 'heavy' | 'lift';

export interface FootstepEvent {
  x: number;
  y: number;
  z: number;
  side: Side;
  speed: number;
  kind: FootstepKind;
  actor: string;
  /** Extra water splash amount 0..1 (blade creature stomps and lifts throw large sprays at any depth; design D6c). */
  splash?: number;
}

export interface HumanoidContext {
  poses: PoseLibrary;
  gore: GoreSystem;
  /** Loaded imported body models (ADR-0026); bodies without one are procedural. */
  bodyModels?: BodyModelLibrary;
  /** Retargeted mocap clip library (Tier B); defaults to the shared compiled library. */
  mocap?: MocapLibrary;
  /** Motion profiles (tests); defaults to src/data/motionFiles.ts. */
  motionProfiles?: MotionProfileFile;
  /** Load a character's clip pack into the library (tests); defaults to the bundled packs (mocapPacks.ts). */
  loadMocapPack?: (lib: MocapLibrary, name: string) => Promise<void>;
  /** Moving shadow casters the body joins (tests); defaults to the shared set (shadow-rich-rooms D4). */
  shadowCasters?: ShadowCasterSet;
  /** World static/furniture colliders for general hand-vs-surface contact resolution. */
  colliders?: ColliderQuery | null;
  /** Optional world-space footstep callback fired on foot plants (audio / perception). */
  onFootstep?: (step: FootstepEvent) => void;
  /** Depth of standing water at a body's feet (standing-water spec: Bodies stay wet); absent where a world has none. */
  waterDepth?: (x: number, feetY: number, z: number) => number;
  /** A body moving in standing water this frame (its slosh, in-world-audio spec): world feet position and speed (m/s). */
  onWade?: (actor: string, x: number, y: number, z: number, speed: number, dt: number) => void;
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

const tmpClipShift = new THREE.Vector3();

export class Humanoid {
  readonly group = new THREE.Group();
  readonly spec: Readonly<HumanoidSpec>;
  readonly damage: BodyDamage;
  readonly triangles: number;
  /** Imported body model in use, or null for a procedural body. */
  readonly modelId: string | null;
  /** The blade creature's layer (jaw, belly arms), or null for every other body (openspec rig-necromorph). */
  readonly blade: BladeLayer | null;
  readonly bones: Readonly<Record<JointName, THREE.Bone>>;

  state: LifeState;
  /** Facing angle (radians); 0 faces -Z. */
  heading = 0;
  /** Current ground speed (m/s). */
  speed = 0;
  /** Moving away from where it faces (a backward walk with `steer({ face })`): the walk cycle plays in reverse. */
  backward = false;
  /** Extra speed factor from the AI (lurch bursts, ADR-0007). */
  speedScale = 1;
  /** A downed body being moved by a script (dragged, carried): hold this pose, never a walking gait. */
  carried: string | null = null;
  /** World point the head turns toward, or null. */
  lookTarget: THREE.Vector3 | null = null;
  /** World points the hands reach for (consoles, panels), or null. */
  readonly handTargets: { L: THREE.Vector3 | null; R: THREE.Vector3 | null } = { L: null, R: null };
  /** Optional outward world surface normals for `handTargets` (vertical wall panels/scanners), or null for default tabletop tilt. */
  readonly handTargetNormals: { L: THREE.Vector3 | null; R: THREE.Vector3 | null } = { L: null, R: null };
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
  /** Geometry made only for a warm-up sample (`toWarmSample`). */
  private readonly sampleGeometries: THREE.BufferGeometry[] = [];
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
  private kill: { target: number; rate: number; screamJaw: boolean } | null = null;
  /** A kill route carries the body: feet plant and step (setKillFeet). */
  private killFeet = false;
  /** Parts put on world points by a kill's `touch` events, with their weights. */
  /** Parts a kill puts on a mark (`touch`): a fixed point, or (`plane`) the nearest point of a plane to where the pose puts it. */
  private readonly killTouches = new Map<TouchPart, { target: THREE.Vector3; weight: number; plane: THREE.Plane | null }>();
  /** This frame's kill foot contacts, and last frame's posed (FK) feet in world space, for the contacts a take lacks. */
  private readonly killContacts: [number, number] = [1, 1];
  private killFootPrev: [THREE.Vector3, THREE.Vector3] | null = null;
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
    // A creature body's own layer (rig-necromorph): its jaw and belly arms, driven over the animated joints.
    const rig = spec.model ? ctx.bodyModels?.table?.[spec.model]?.rig : undefined;
    if (rig === 'blade') {
      const profile = bladeCreatureProfile();
      this.animator.creature = new BladeMotion(spec.seed, legGeometry(this.geo.jointOffsets as Record<JointName, Vec3T>, profile.ankleHeight), this.geo.scale.y);
      this.animator.poseMap = profile.poseMap;
      this.animator.performances = profile.performances ?? null;
      this.animator.setPose(this.idlePose, 0);
    }
    this.blade = rig === 'blade' ? bladeLayerFor(bladeCreatureProfile(), this.geo.creatureBones, (n) => (this.bones as Record<string, THREE.Bone>)[n] ?? this.extras.get(n as ExtraBone), spec.seed) : null;
    this.motionGender = (spec.model ? ctx.bodyModels?.table?.[spec.model]?.gender : undefined) ?? spec.gender ?? 'm';
    this.motionFormal = spec.role === 'npc' && (spec.outfit === 'medic' || spec.seed === 'director-hale');
    this.hasVariants = Boolean(spec.profile && (ctx.motionProfiles ?? sharedMotionProfiles()).profiles[spec.profile]?.variants);
    // A character whose pack was released (its last body went, as on a restart) waits for it quietly; see holdMocapPack.
    const packPending = Boolean(spec.profile && hasMocapPack(spec.profile) && !this.animator.mocapLibrary.hasPack(spec.profile));
    const motion = this.resolveMotion(packPending);
    this.animator.setMotion(motion);
    const ownInitial = motion.poses[this.idlePose];
    if (ownInitial && ctx.poses.has(ownInitial)) {
      this.idlePose = ownInitial;
      this.animator.setPose(ownInitial, 0);
    }
    // Hold the character's clip pack while this body exists (released in dispose).
    if (spec.profile && hasMocapPack(spec.profile)) this.holdMocapPack(spec.profile);
    this.handPhysics = new HandPhysicsSolver(spec.seed, this.geo.handBones ?? [], this.extras, this.animator.motion.hands);
    this.applyBoneScales();
    this.group.updateMatrixWorld(true);
    this.prevWorldPos.copy(this.group.position);
    // A body deforms every animated frame, so cached shadow maps in its reach redraw while it moves (shadow-rich-rooms D4).
    this.shadowCaster = new ManualCaster((out) => {
      if (!this.castsShadow || !this.group.visible || !this.group.parent || this.bodyDisposed) return false;
      const s = this.geo.scale.y;
      out.center.copy(this.group.position);
      out.center.y += 0.9 * s;
      out.radius = 1.3 * s;
      return true;
    });
    this.unregisterCaster = (ctx.shadowCasters ?? shadowCasters).add(this.shadowCaster);
    this.unregisterContact = contactBodies.add(this);
  }

  private readonly shadowCaster: ManualCaster;
  private readonly unregisterCaster: () => void;
  private readonly unregisterContact: () => void;
  private readonly casterPos = new THREE.Vector3(Infinity, 0, 0);
  private readonly casterQuat = new THREE.Quaternion();

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

  /** The soft contact shadow under the body (render-lighting "Characters are grounded", shadow-rich-rooms D8). */
  contactShadow(out: ContactSample): boolean {
    if (this.bodyDisposed || !this.group.visible || !this.group.parent) return false;
    out.at.copy(this.group.position);
    const lying = Humanoid.LYING_POSE.test(this.idlePose) || this.state === 'dead' || this.state === 'playingDead';
    out.radius = lying ? 0.85 * this.geo.scale.y : this.footprint.r * 1.7;
    out.real = this.castsShadow;
    return true;
  }

  /** Slows (or speeds) the stepping of the locomotion cycle without changing the ground speed. */
  set gaitRate(v: number) {
    this.animator.gaitRate = v;
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
    this.syncHeld(true);
  }

  /**
   * Follow the item the pose holds (or the explicit `heldOverride`) while alive. The mug and the wand change with the pose; a
   * pistol appears or goes at the pose blend's midpoint (squad-sidearms D2), unless `now` (an override, or death) says at once.
   */
  private syncHeld(now = false): void {
    this.heldFor = `${this.idlePose}|${this.state}|${String(this.heldOverride)}`;
    const want = this.state === 'alive' ? (this.heldOverride !== undefined ? this.heldOverride : heldItemFor(this.idlePose)) : null;
    this.heldFrom = now || this.state !== 'alive' ? want : this.heldNow;
    this.heldTarget = want;
    this.showHeld(heldDuringBlend(this.heldFrom, want, this.animator.blendProgress));
  }

  /** Show one held item (making it on first use) and hide the rest. */
  private showHeld(item: HeldItem | null): void {
    this.heldNow = item;
    if (item && !this.heldItems.has(item)) {
      // A mug or pistol in a hand with finger bones: its rig's own grip frame (D4) and the wrap solved for it.
      if (item === 'mug' || item === 'pistol') this.solvedGrips[item] = heldGripFor(this.geo.handBones, item);
      const grip = item === 'mug' || item === 'pistol' ? (this.solvedGrips[item]?.frame ?? (item === 'pistol' ? pistolGripFrameFor(this.geo.handBones) : null)) : null;
      const mesh = makeHeld(item, grip);
      this.heldItems.set(item, mesh);
      this.bones.hand_R.add(mesh);
    }
    for (const [held, mesh] of this.heldItems) mesh.visible = held === item;
  }

  /** The held pistol's muzzle, ejection port and slide while it shows, else null (squad-sidearms D4). */
  get pistol(): HeldPistolParts | null {
    const held = this.heldNow === 'pistol' ? this.heldItems.get('pistol') : undefined;
    return held?.visible ? pistolParts(held) : null;
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
   * hand and body gestures. Does nothing for the dead and the infected. A kill victim whose kill screams with her jaw
   * (`setKillScreamJaw`) follows a recorded scream's `loudness` with it instead (voss-death-scene D11); without a
   * recording the line acts as any other.
   */
  speak(text: string, emote: Emote | null, duration: number, seed = text, loudness?: LoudnessEnvelope): void {
    if (this.state !== 'alive' || this.infectionLevel >= 1) return;
    const plan = planSpeech(text, emote, duration, seed);
    // A mug in the right hand: gesture with the free left hand (upright-mug-grip D3b).
    if (heldItemFor(this.idlePose) === 'mug') plan.side = 1;
    this.animator.speak(plan);
    if (this.kill?.screamJaw && emote === 'scream' && loudness) this.animator.screamLine(loudness);
    else this.animator.endScream();
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
    this.kill = { target: 0, rate: 2, screamJaw: false };
  }

  get killing(): boolean {
    return this.kill !== null;
  }

  /** This kill's victim screams with the recording: her jaw follows its loudness (kill style `screamJaw`, D11). */
  setKillScreamJaw(on: boolean): void {
    if (this.kill) this.kill.screamJaw = on;
  }

  /**
   * A kill beat's captured clip plays once on this body, blending in over `blend` s (a raised corpse gets up). Any
   * carried pose is dropped so the clip owns the body. Returns the clip's length (s), or null if this body has no
   * such clip in its library or character pack.
   */
  playKillClip(id: string, blend: number, opts: { from?: number; inPlace?: boolean } = {}): number | null {
    const duration = this.animator.playClip(id, blend, opts);
    if (duration === null) return null;
    this.carried = null;
    // The clip starts where the body lies: move the origin under it (the animator already moved the pose back). In place
    // (a route beat), the route keeps the origin and the shift is zero.
    const shift = tmpClipShift.copy(this.animator.clipShift).multiplyScalar(this.geo.scale.y).applyQuaternion(this.group.quaternion);
    this.group.position.add(shift);
    this.prevWorldPos.add(shift);
    return duration;
  }

  /**
   * How fast a kill clip of this body travels across the floor between `from` and `to` s of the take, played at speed
   * 1, in m/s at this body's size (the route speed check, voss-death-scene D3); null when the body has no such clip.
   */
  killClipRootSpeed(id: string, from?: number, to?: number): number | null {
    const lib = this.animator.mocapLibrary;
    if (!lib.has(id)) return null;
    const clip = lib.get(id);
    return clipRootSpeed(clip, from ?? 0, to ?? clip.duration) * this.geo.scale.y;
  }

  /**
   * A kill route carries the body (voss-death-scene D5): while on, its feet plant from the playing clip's foot contacts
   * (or, for a pose or a take without them, wherever a foot is down on the floor), held where they landed until they
   * lift or the leg would overstretch, and each landing plays a footstep through the NPC footstep path. Off, a kill
   * keeps today's free feet and silence.
   */
  setKillFeet(on: boolean): void {
    if (this.killFeet === on) return;
    this.killFeet = on;
    this.footIk.reset();
    this.resetFootsteps();
    this.killFootPrev = null;
  }

  get killFeetOn(): boolean {
    return this.killFeet;
  }

  /**
   * Put one part of the body on a world point during a kill (`touch`, voss-death-scene D4), at `weight` 0..1 (the kill
   * eases it in and out); `null` lets go of that part at once. With `plane`, the part goes onto the plane instead, at the
   * point of it nearest to where the pose puts the part this frame, so it slides along a pane as she moves.
   */
  setKillTouch(part: TouchPart, target: THREE.Vector3 | null, weight = 1, plane: THREE.Plane | null = null): void {
    if (!target || weight <= 0) {
      this.killTouches.delete(part);
      return;
    }
    const t = this.killTouches.get(part);
    if (t) {
      t.target.copy(target);
      t.weight = Math.min(1, weight);
      t.plane = plane;
    } else this.killTouches.set(part, { target: target.clone(), weight: Math.min(1, weight), plane });
  }

  /** This frame's kill foot contacts [left, right] (0..1) while a route carries the body (tests, debug). */
  get killFootContacts(): readonly [number, number] {
    return this.killContacts;
  }

  /** Progress through the kill clip (0..1). */
  killClipPhase(u: number): void {
    this.animator.clipPhase(u);
  }

  /**
   * A kill beat's pose layer (voss-death-scene D6): `pose` on `joints` only, over the clip or pose the rest of the body
   * plays; `null` eases it off.
   */
  setKillLayer(joints: readonly JointName[] | null, pose: string | null, blend = 0.15): void {
    this.animator.setLayer(joints, pose ?? undefined, blend);
  }

  /** How fast her head turns to what she looks at in this kill beat (1 = normal; the wait's laboured glances are slower). */
  setKillHeadPace(pace: number): void {
    this.animator.lookPace = pace;
  }

  /** How far the kill's pose layer is on (0..1; tests). */
  get killLayerWeight(): number {
    return this.animator.layerWeight;
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
    this.animator.endScream();
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
    this.animator.endScream();
    this.animator.convulse = 0;
    this.animator.setLayer(null);
    this.animator.lookPace = 1;
    this.killTouches.clear();
    this.setKillFeet(false);
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

  /** Imported-model surface materials on this body (for corpse blood overlays). */
  surfaceMaterials(): readonly THREE.MeshStandardMaterial[] {
    return Object.values(this.materials.surfaces);
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
  steer(desired: THREE.Vector3 | null, dt: number, opts: { maxSpeed?: number; turnRate?: number; accel?: number; face?: number } = {}): Readonly<THREE.Vector3> {
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
    // `face`: keep turning toward that heading while moving along `desired` (backing away from a target while facing it).
    const facing = opts.face !== undefined && !heavy;
    if (desired && canMove && desired.x * desired.x + desired.z * desired.z > 1e-6) {
      const want = facing ? opts.face! : Math.atan2(-desired.x, -desired.z);
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
        target = facing ? max : max * THREE.MathUtils.clamp(Math.cos(diff), 0, 1);
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
    if (facing && desired && desired.x * desired.x + desired.z * desired.z > 1e-6) {
      this.velocity.set(desired.x, 0, desired.z).normalize().multiplyScalar(this.speed);
      this.backward = this.velocity.x * -Math.sin(this.heading) + this.velocity.z * -Math.cos(this.heading) < -0.3 * this.speed;
    } else {
      this.velocity.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).multiplyScalar(this.speed);
      this.backward = false;
    }
    this.group.rotation.y = this.heading;
    return this.velocity;
  }

  /**
   * Turn to a heading as part of continuous motion (a kill route turning her a little each frame, voss-death-scene D3):
   * unlike `setHeading`, planted feet, contacts and footsteps carry on.
   */
  turnHeading(h: number): void {
    this.heading = h;
    this.uprightTurn.vel = 0;
    this.uprightTurn.error = 0;
    this.group.rotation.y = h;
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
    this.smoothAccelX = 0;
    this.smoothAccelZ = 0;
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

  /**
   * A player stomp (physical-interaction "Corpses can be stomped"). A living body takes an ordinary hit; a corpse's
   * limb loses HP and comes off as debris once it reaches its sever threshold. `dir` is the way the part is thrown.
   */
  stompHit(hit: BodyHit, amount: number, dir: THREE.Vector3): HitResult {
    if (this.alive) return this.applyHit(hit, amount, dir);
    const result = this.damage.applyToCorpse(hit.region, amount);
    this.ctx.gore.burst(hit.point, dir.clone().multiplyScalar(0.4).add(new THREE.Vector3(0, 0.6, 0)), 18);
    if (result.severed) this.sever(result.severed, dir);
    return result;
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

  /**
   * Scripted cut (a closing door shears an arm off): lose `region` and everything below it, with the
   * severed piece thrown along `dir` (world) and blood at the cut. Kills only by the usual limb rule.
   */
  cut(region: SeverableRegion, dir: THREE.Vector3): HitResult {
    const wasWalking = this.locomotion.mode === 'walk';
    const result = this.damage.apply(region, 1e6);
    if (!result.severed) return result;
    this.group.updateMatrixWorld(true);
    const at = this.bones[SEVER_JOINT[region]].getWorldPosition(new THREE.Vector3());
    this.ctx.gore.burst(at, dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.3, 0)), 60);
    this.sever(result.severed, dir);
    this.slam?.cancel();
    if (result.killed) this.die(result.killedBy === 'limbs' && !wasWalking);
    return result;
  }

  /** Whether this body supports a named creature performance (`scream`, design D8). */
  hasPerformance(name: string): boolean {
    return this.animator.hasPerformance(name);
  }

  /** True while a creature performance (`scream`) is running. */
  get performancePlaying(): boolean {
    return this.animator.performancePlaying;
  }

  /** Play a named creature performance (design D8). Warns once and returns false on a body without it. */
  playPerformance(name: string, opts: { hold?: number; onDone?: () => void } = {}): boolean {
    return this.animator.playPerformance(name, opts);
  }

  /** End any active creature performance cleanly (skip, move or death). */
  stopPerformance(): void {
    this.animator.stopPerformance();
  }

  /**
   * World point along a creature's blade on `side`: `fraction = 0` is the hand joint (blade root), `1` is the blade tip
   * (rig-necromorph design D9). Bodies without blades return the hand joint's world position.
   */
  bladePoint(side: Side, fraction: number, out = new THREE.Vector3()): THREE.Vector3 {
    const hand = this.bones[`hand_${side}`];
    const tip = this.modelId ? this.ctx.bodyModels?.get(this.modelId)?.bladeTips?.[side] : undefined;
    this.group.updateMatrixWorld(true);
    if (!tip || fraction <= 0) return hand.getWorldPosition(out);
    const f = THREE.MathUtils.clamp(fraction, 0, 1);
    return hand.localToWorld(out.set(tip[0] * f, tip[1] * f, tip[2] * f));
  }

  /** Swipe animation for a crowd attack (ADR-0007): the arm on `side` lashes forward and the chest follows. */
  strike(side: Side, strength = 0.8): void {
    this.animator.creature?.triggerSlash(side);
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
  /** Which arm is winding up for a swipe (AI windup phase), or null. */
  windupSide: Side | null = null;
  /** True while holding a grab on the player (keeps blades clear of the camera). */
  grabbing = false;

  /** Height (m above the feet) standing water has wetted this body to; dries slowly (standing-water spec). */
  private wetHeight = 0;

  private readonly lastWadePos = new THREE.Vector3(NaN, 0, 0);

  private updateWetness(dt: number): void {
    const depth = this.ctx.waterDepth;
    if (!depth && this.wetHeight === 0) return;
    const p = this.group.position;
    const d = depth ? depth(p.x, p.y, p.z) : 0;
    if (this.ctx.onWade && (d > 0 || this.wetHeight > 0) && dt > 0) {
      const speed = Number.isNaN(this.lastWadePos.x) ? 0 : Math.hypot(p.x - this.lastWadePos.x, p.z - this.lastWadePos.z) / dt;
      this.ctx.onWade(this.spec.seed, p.x, p.y, p.z, this.state === 'dead' ? 0 : speed, dt);
    }
    this.lastWadePos.copy(p);
    this.wetHeight = stepWetHeight(this.wetHeight, d, dt);
    this.materials.uniforms.uWetLine.value = wetLine(p.y, this.wetHeight, DRY);
  }

  update(dt: number, cameraPosition: THREE.Vector3 | null = null): void {
    this.time += dt;
    if (this.heldFor !== `${this.idlePose}|${this.state}|${String(this.heldOverride)}`) this.syncHeld();
    else if (this.heldNow !== this.heldTarget) this.showHeld(heldDuringBlend(this.heldFrom, this.heldTarget, this.animator.blendProgress));
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
    this.updateWetness(dt);
    this.updateInfection(dt);
    this.updateKinematics(dt);
    this.chooseAnimation();
    const moving = this.state === 'alive' || this.state === 'falling' || this.state === 'gettingUp';
    const lying = Humanoid.LYING_POSE.test(this.idlePose) || this.carried !== null;
    this.animator.setWound(this.locomotion.limpSide, this.locomotion.limp);
    this.animator.infect = this.infectionLevel / 3;
    this.animator.twitchy = moving && (this.spec.role === 'enemy' || this.infectionLevel >= 1);
    this.animator.idleLife = this.state === 'alive' && this.spec.role === 'npc' && !this.locomotion.blind && !lying && !this.kill && !this.blade ? 1 : 0;
    const uprightAlive = this.state === 'alive' && this.locomotion.mode === 'walk' && !lying && this.spec.role !== 'corpse';
    // The blade creature never plays captured human motion (rig-necromorph).
    this.animator.useMocap = uprightAlive && !this.blade && !(this.spec.role === 'npc' && this.locomotion.blind) && this.slam?.busy !== true && !this.kill;
    this.animator.charge = this.state === 'alive' && this.locomotion.mode === 'walk' ? Math.max(this.charge, this.speedScale > 1.2 ? 1 : 0) : 0;
    this.animator.bladeWindupSide = this.state === 'alive' && this.locomotion.mode === 'walk' ? this.windupSide : null;
    this.animator.bladeGrabbing = this.state === 'alive' && this.grabbing;
    this.updateBloodTrail(dt);
    if (this.lookTarget && this.state === 'alive' && !this.locomotion.blind) {
      this.group.updateMatrixWorld();
      this.animator.lookLocal = this.group.worldToLocal(this.rayTmpA.copy(this.lookTarget)).divideScalar(this.geo.scale.y);
    } else {
      this.animator.lookLocal = null;
    }
    if (this.blade) {
      // The creature's gait keeps its planted feet where they landed from how the body actually moved (design D6a).
      const m = this.animator.moved;
      const dx = this.group.position.x - this.bladeLast.x;
      const dz = this.group.position.z - this.bladeLast.y;
      const c = Math.cos(this.heading);
      const s = Math.sin(this.heading);
      // World to body frame (the body faces -Z and turns by heading about +Y).
      m.x = dx * c - dz * s;
      m.z = dx * s + dz * c;
      m.yaw = Math.atan2(Math.sin(this.heading - this.bladeLast.z), Math.cos(this.heading - this.bladeLast.z));
      if (!(Math.hypot(dx, dz) < 1)) m.x = m.z = m.yaw = 0; // placed (or the first frame), not moved
      this.bladeLast.set(this.group.position.x, this.group.position.z, this.heading);
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
    this.updateSegments();
    // Each heavy footfall jolts the belly arms (rig-necromorph design D6b).
    if (this.blade && this.animator.footfall) this.blade.bump(0.3 + 0.12 * Math.min(4, this.speed));
    if (this.blade) {
      const slamActive = this.slam?.phase === 'windup' || this.slam?.phase === 'strike';
      const motionJaw = Math.max(this.animator.bladeMotionJaw, this.animator.bladePerfJaw, slamActive ? 0.85 : 0);
      const motionFlare = Math.max(this.animator.bladeMotionFlare, this.animator.bladePerfFlare, slamActive ? 0.9 : 0);
      this.blade.apply(this.time, dt, motionJaw, motionFlare);
    }
    // Living, falling or rising bodies animate every frame; a settled corpse only when it is moved.
    const moved = !this.casterPos.equals(this.group.position) || !this.casterQuat.equals(this.group.quaternion);
    if (this.state !== 'dead' || moved || this.animator.clipPlaying) {
      this.shadowCaster.bump();
      this.casterPos.copy(this.group.position);
      this.casterQuat.copy(this.group.quaternion);
    }
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
      this.near &&
      // The blade creature's 1.1 m forearms and blades are posed clear of its body; the human contact solve would push them
      // off its torso hulls and flatten every raised pose (rig-necromorph design, risks).
      !this.blade;
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
      keepElbows: this.animator.armsPlaced,
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
      ikNormalL: ikTargetL ? this.handTargetNormals.L : null,
      ikNormalR: ikTargetR ? this.handTargetNormals.R : null,
      contactL: this.limbContact.contactOf('L'),
      contactR: this.limbContact.contactOf('R'),
      cameraDist,
      clipFingers: this.animator.clipFingers,
      clipFingerWeight: this.animator.clipFingerW,
      // The wand keeps the radius wrap; a mug uses its solved contact pose (a hand without finger bones has nothing to wrap).
      heldRadiusR: this.heldNow === 'wand' ? HELD_GRIP_RADIUS.wand : null,
      heldGripR: this.heldNow === 'mug' || this.heldNow === 'pistol' ? this.solvedGrips[this.heldNow] : null,
    });
    this.levelHeldMug(dt);
    this.aimHeldPistol(dt);
    this.updateSlide(dt);
    this.updateFootsteps(dt);
  }

  /** Where a held pistol points (world; squad-sidearms D3): the target's aim point, or null to leave the clip's arm alone. */
  aimTarget: THREE.Vector3 | null = null;
  /** The last frame's wrist correction and shoulder swing (radians; tests). */
  aimSwingAngle = 0;
  armSwingAngle = 0;
  /** How far the shoulder swing is eased in (0..1): it grows over about 0.15 s once the pistol shows, so the arm never snaps. */
  private aimWeight = 0;
  private readonly aimTmp = { muzzle: new THREE.Vector3(), barrel: new THREE.Vector3(), want: new THREE.Vector3(), swing: new THREE.Quaternion(), handQ: new THREE.Quaternion(), parentQ: new THREE.Quaternion() };

  /** The bore (the model's -Z through the muzzle) and the line from the muzzle to the target, both unit; false when degenerate. */
  private aimLines(parts: HeldPistolParts, target: THREE.Vector3): boolean {
    const t = this.aimTmp;
    parts.muzzle.getWorldPosition(t.muzzle);
    // The bore, not grip-to-muzzle: the muzzle sits 8 cm above the grip marker, 27° off the barrel line.
    t.barrel.set(0, 0, -1).applyQuaternion(parts.muzzle.getWorldQuaternion(t.handQ)).normalize();
    t.want.subVectors(target, t.muzzle);
    if (t.want.lengthSq() < 1e-4) return false;
    t.want.normalize();
    return true;
  }

  /** Turn `bone` in world space by `swing` (premultiplied), keeping its parent. */
  private swingBone(bone: THREE.Object3D, swing: THREE.Quaternion): void {
    const t = this.aimTmp;
    bone.getWorldQuaternion(t.handQ).premultiply(swing);
    bone.parent!.getWorldQuaternion(t.parentQ).invert();
    bone.quaternion.copy(t.parentQ.multiply(t.handQ));
    bone.updateMatrixWorld(true);
  }

  /**
   * Point a held pistol at `aimTarget` (squad-sidearms D3), after everything else has moved the arm: turn the wrist so the bore lines
   * up with the line from the muzzle to the target (in all at most AIM_CLAMP), and swing the whole right arm rigidly at the shoulder
   * for what the wrist cannot reach (at most ARM_AIM_CLAMP, eased in). The pistol stays rigid in the hand, so it is as steady as the
   * arm.
   */
  private aimHeldPistol(dt: number): void {
    this.aimSwingAngle = 0;
    this.armSwingAngle = 0;
    const parts = this.pistol;
    const limpR = !this.limbAttached('R', true) || this.animator.limp.has(JOINT_INDEX.hand_R) || this.animator.limp.has(JOINT_INDEX.foreArm_R) || this.animator.limp.has(JOINT_INDEX.upperArm_R);
    const target = this.aimTarget;
    if (!parts || !target || this.state !== 'alive' || limpR) {
      this.aimWeight = 0;
      return;
    }
    this.aimWeight = Math.min(1, this.aimWeight + Math.max(0, dt) / ARM_AIM_EASE);
    const t = this.aimTmp;
    const hand = this.bones.hand_R;
    const upper = this.bones.upperArm_R;
    if (!hand.parent || !upper.parent) return;
    upper.updateWorldMatrix(true, true);
    // The wrist first, as far as it goes (a shooter's ulnar deviation); then the shoulder for what is left (a target off to one
    // side), two passes since the swing moves the muzzle too; then the wrist again with what remains of its range.
    if (!this.aimLines(parts, target)) return;
    this.aimSwingAngle = aimSwing(t.barrel, t.want, AIM_CLAMP, t.swing);
    this.swingBone(hand, t.swing);
    for (let pass = 0; pass < 2; pass++) {
      if (!this.aimLines(parts, target)) return;
      const full = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(t.swing.setFromUnitVectors(t.barrel, t.want).w), 0, 1));
      const left = ARM_AIM_CLAMP - this.armSwingAngle;
      if (left <= 1e-6 || full < 1e-4) break;
      this.armSwingAngle += aimSwing(t.barrel, t.want, Math.min(left, full * this.aimWeight), t.swing);
      this.swingBone(upper, t.swing);
    }
    if (!this.aimLines(parts, target) || AIM_CLAMP - this.aimSwingAngle <= 1e-6) return;
    this.aimSwingAngle += aimSwing(t.barrel, t.want, AIM_CLAMP - this.aimSwingAngle, t.swing);
    this.swingBone(hand, t.swing);
  }

  /** Seconds since the held pistol last fired (the slide kick; Infinity at rest). */
  private sinceShot = Infinity;

  /** Kick the held pistol's slide back (one squad shot, squad-sidearms D4). */
  kickSlide(): void {
    this.sinceShot = 0;
    // The muzzle flash (D7): a fresh roll and size each shot, shown until MUZZLE_FLASH_TIME.
    const flash = this.pistol?.flash;
    if (flash) {
      flash.rotation.z = Math.random() * Math.PI;
      flash.scale.setScalar(0.8 + Math.random() * 0.4);
      flash.visible = true;
    }
  }

  /** Is the held pistol's muzzle flash showing (tests)? */
  get muzzleFlashing(): boolean {
    return this.pistol?.flash.visible ?? false;
  }

  /** The slide's back-travel right now (m; tests). */
  get slideTravel(): number {
    return this.pistol?.slide.position.z ?? 0;
  }

  private updateSlide(dt: number): void {
    if (this.sinceShot === Infinity) return;
    this.sinceShot += dt;
    // The pistol's parts even while it is hidden, so a flash cut short by lowering the gun never shows again when it comes back.
    const held = this.heldItems.get('pistol');
    const parts = held ? pistolParts(held) : null;
    const off = slideOffset(this.sinceShot);
    if (parts) {
      parts.slide.position.z = off;
      parts.flash.visible = this.sinceShot < MUZZLE_FLASH_TIME;
    }
    if (off === 0 && this.sinceShot > Math.max(SLIDE_CYCLE, MUZZLE_FLASH_TIME)) this.sinceShot = Infinity;
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
  /** The blade creature's last-frame position x, position z and heading (as x, y, z). */
  private readonly bladeLast = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly prevWorldVel = new THREE.Vector3();
  private readonly curWorldVel = new THREE.Vector3();
  private smoothAccelX = 0;
  private smoothAccelZ = 0;
  private readonly footIk = new FootIkSolver();
  /** ADR-0029: a mug in the right hand while the pose is a mug or drink pose (made on first use). */
  private readonly heldItems = new Map<HeldItem, THREE.Object3D>();
  /** The solved mug wrap for this body's hand, or null for a hand without finger bones. */
  private readonly solvedGrips: Record<SolvedItem, HeldGrip | null> = { mug: null, pistol: null };
  /** What showed when the held item last changed target, and the target: a pistol swaps between them at the blend's midpoint. */
  private heldFrom: HeldItem | null = null;
  private heldTarget: HeldItem | null = null;
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
    // A kill steps only while a route carries the body, from the same contacts its feet plant on (voss-death-scene D5).
    const killSteps = this.kill !== null && this.killFeet && !this.blade;
    if (this.locomotion.mode !== 'walk' || lying || this.transformAnim || (this.kill && !killSteps)) {
      this.footReady = false;
      return;
    }

    const contacts = killSteps ? this.killContacts : this.animator.footContacts;
    if (!this.footReady) {
      this.footPlanted[0] = contacts[0] >= 0.5;
      this.footPlanted[1] = contacts[1] >= 0.5;
      this.footReady = true;
      return;
    }

    const emitStep = (side: Side, kind: FootstepKind, splash?: number, cooldown = true): void => {
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
        ...(splash !== undefined ? { splash } : {}),
      });
      if (cooldown) this.footCooldown[idx] = 0.22;
    };

    // Blade creature footsteps (rig-necromorph design D6c): driven directly from its foot contacts — a heavy stomp
    // on each landing and a lift on each foot leaving the ground, each with a splash amount that grows with speed.
    if (this.blade) {
      const splash = THREE.MathUtils.clamp(0.25 + this.speed / 3.5, 0.25, 1);
      for (let idx = 0; idx < 2; idx++) {
        const side: Side = idx === 0 ? 'L' : 'R';
        if (!this.limbAttached(side, false)) {
          this.footPlanted[idx] = false;
          continue;
        }
        const down = contacts[idx]! >= 0.5;
        if (down === this.footPlanted[idx]) continue;
        this.footPlanted[idx] = down;
        const stepping = this.speed > 0.15 || Math.abs(this.animator.turnRate) > 0.35;
        if (!stepping) continue;
        if (down) {
          if (this.footCooldown[idx]! <= 0) emitStep(side, 'heavy', splash);
        } else {
          emitStep(side, 'lift', splash, false);
        }
      }
      return;
    }

    // A kill route: one step on each landing, at the frame its contact comes down, from where the foot is planted.
    if (killSteps) {
      const speed = this.curWorldVel.length();
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
          if (this.footCooldown[idx]! <= 0) {
            this.bones[`foot_${side}`].getWorldPosition(this.footPosTmp);
            onFootstep({
              x: this.footPosTmp.x,
              y: this.group.position.y + 0.05,
              z: this.footPosTmp.z,
              side,
              speed,
              kind: speed > 2.4 ? 'jog' : speed > 0.2 ? 'walk' : 'pivot',
              actor: this.spec.seed,
            });
            this.footCooldown[idx] = 0.22;
          }
        }
      }
      return;
    }

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
      this.smoothAccelX = 0;
      this.smoothAccelZ = 0;
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
    // Compute true per-frame acceleration, then smooth the acceleration (not velocity) so high-FPS frames don't amplify lean.
    const rawAx = THREE.MathUtils.clamp((vx - this.prevWorldVel.x) / dt, -10, 10);
    const rawAz = THREE.MathUtils.clamp((vz - this.prevWorldVel.z) / dt, -10, 10);
    this.prevWorldVel.copy(this.curWorldVel);
    const alpha = 1 - Math.exp(-12 * dt);
    this.smoothAccelX += (rawAx - this.smoothAccelX) * alpha;
    this.smoothAccelZ += (rawAz - this.smoothAccelZ) * alpha;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    this.animator.accelFwd = -this.smoothAccelX * s - this.smoothAccelZ * c;
    this.animator.accelLat = this.smoothAccelX * c - this.smoothAccelZ * s;
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

  private static readonly NO_TURN = new THREE.Quaternion();

  /**
   * A creature's segment bones (rig-necromorph design D3) take their share of their joint's rotation, so a neck or back
   * made of several bones curves instead of kinking at one joint. Each sits at its joint's pivot under the joint's parent.
   */
  private updateSegments(): void {
    const segs = this.geo.creatureBones;
    if (!segs) return;
    for (const d of segs) {
      if (d.kind !== 'segment') continue;
      const bone = this.extras.get(d.name);
      if (bone) bone.quaternion.slerpQuaternions(Humanoid.NO_TURN, this.bones[d.joint].quaternion, d.fraction);
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
  /** This body's pick among pooled takes (crew default walks and runs), 0..1, from its seed: the same every run. */
  private get motionPick(): number {
    // The seeded generator, not the bare string hash: FNV's top bits barely move between ids that differ only in their last
    // character (crew:mess:0 .. :9 all landed on the first take).
    return new Rng(`motion-pick:${this.spec.seed}`).next();
  }
  private motionFormal = false;
  private hasVariants = false;
  private sceneVersion = -1;
  private sceneCheck = 0;

  /**
   * Hold the character's clip pack while this body exists (released in dispose). Packs are loaded at start, and the last body of
   * a character releases its pack; when a body is built again after that (a death restart or checkpoint restore rebuilds the
   * NPCs), the pack is loaded again and the body switches to its own motion when it arrives.
   */
  private holdMocapPack(name: string): void {
    const lib = this.animator.mocapLibrary;
    if (lib.hasPack(name)) {
      this.mocapPack = name;
      lib.retainPack(name);
      return;
    }
    const load = this.ctx.loadMocapPack ?? ((l: MocapLibrary, n: string) => loadMocapPacks(l, [n]));
    void load(lib, name)
      .then(() => {
        if (this.bodyDisposed || !lib.hasPack(name)) return;
        this.mocapPack = name;
        lib.retainPack(name);
        this.animator.setMotion(this.resolveMotion(), 0.3);
      })
      .catch((e: unknown) => console.warn(`mocap: could not load the "${name}" clip pack`, e));
  }

  private bodyDisposed = false;

  /** This body's motion profile with the scene variants in effect (character-motion spec). */
  private resolveMotion(quiet = false): ReturnType<typeof resolveProfile> {
    const profile = this.spec.profile;
    const scene = profile
      ? { sequences: motionScene.sequences, task: motionScene.tasks.get(profile) ?? null, stage: motionScene.stage, flag: (n: string) => Boolean(motionScene.flags()[n]) }
      : undefined;
    return resolveProfile(this.animator.mocapLibrary, this.ctx.motionProfiles ?? sharedMotionProfiles(), profile, this.motionGender, this.motionFormal, scene, quiet, this.motionPick);
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
    for (const m of this.releaseAllButMaterials()) m.dispose();
  }

  /** Everything `dispose` frees except the materials, which are handed back still alive. */
  releaseAllButMaterials(): THREE.MeshStandardMaterial[] {
    this.bodyDisposed = true;
    this.unregisterCaster();
    this.unregisterContact();
    if (this.mocapPack) {
      this.animator.mocapLibrary.releasePack(this.mocapPack);
      this.mocapPack = null;
    }
    this.castTells?.dispose();
    this.group.removeFromParent();
    for (const m of this.meshes) m.geometry.dispose();
    for (const g of this.sampleGeometries) g.dispose();
    for (const p of this.geo.parts) p.geometry.dispose();
    for (const h of this.hitboxes) if (h instanceof THREE.LineSegments) h.geometry.dispose();
    return this.allMaterials();
  }

  /**
   * For the loading screen's warm-up (openspec stop-midgame-shader-stalls D3): this body leaves play for good. It gives
   * up its shadow-caster and contact registrations, and gains one unskinned mesh per material, the form a severed limb
   * is drawn in, beside the skinned meshes it already has.
   */
  toWarmSample(): void {
    this.unregisterCaster();
    this.unregisterContact();
    for (const material of this.allMaterials()) {
      let geometry: THREE.BufferGeometry | undefined = this.meshes.find((m) => m.material === material)?.geometry;
      if (!geometry) {
        // A body with no wound yet still sheds wet cut faces.
        const caps = woundCap(0.05, 1, 0);
        geometry = mergeGeometries(caps, false) ?? undefined;
        for (const g of caps) g.dispose();
        if (!geometry) continue;
        this.sampleGeometries.push(geometry);
      }
      const piece = new THREE.Mesh(geometry, material);
      piece.name = `warm-severed:${material.name}`;
      piece.castShadow = true;
      piece.receiveShadow = true;
      this.group.add(piece);
    }
  }

  private allMaterials(): THREE.MeshStandardMaterial[] {
    return [this.materials.body, this.materials.wet, ...Object.values(this.materials.surfaces)];
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
      const cap = this.geo.capsules?.[j.name] ?? j.capsule;
      if (!cap || !j.region) continue;
      const bone = this.bones[j.name];
      const a = new THREE.Vector3(...cap.a);
      const b = new THREE.Vector3(...cap.b);
      const r = cap.r * w;
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
    this.animator.reverse = this.backward;
    const crawling = gait === 'crawl' || gait === 'drag';
    this.animator.turnRate = crawling ? this.turn.vel : this.uprightTurn.vel;
    this.animator.turnError = crawling ? this.turnError : this.uprightTurn.error;
    if (this.state !== 'alive' || this.animator.sequencePlaying || this.animator.clipPlaying) return;
    if (this.animator.performancePlaying) {
      if (this.speed <= 0.25) return;
      this.animator.stopPerformance();
    }
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
    else if (this.spec.role === 'npc' && this.idlePose !== 'aim_pistol' && this.speed > (this.idlePose === 'idle' ? 0.05 : 0.35)) pose = 'walk';
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
    this.animator.stopPerformance();
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
      else if (e.kind === 'cloth' || e.kind === 'finger' || e.kind === 'twist' || e.kind === 'segment' || e.kind === 'limb') s = 1;
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

  /** A foot counts as down (no take contacts) below this height of its ankle over standing height (m, at reference size). */
  private static readonly KILL_FOOT_DOWN = [0.03, 0.06] as const;
  /** ...and, while a clip plays, slower than this across the floor (m/s): a foot in stance stands still under a matched route. */
  private static readonly KILL_FOOT_STILL = [0.35, 0.7] as const;
  private readonly killTmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion() };

  /**
   * A human body in a scripted kill (voss-death-scene D4, D5): feet are free and nothing touches, as before, unless a
   * route carries it (its feet plant from the clip's contacts, released over 0.1 s before a leg overstretches) or a
   * `touch` puts a part on a mark. Order: the contacts from the pose as animated, then the hips and chest (moving the
   * pelvis, bending the spine), then the feet, then the hands and knees.
   */
  private solveKillIk(dt: number): void {
    const feet = this.killFeet && this.state === 'alive' && this.locomotion.mode === 'walk' && this.near;
    if (!feet) this.footIk.reset();
    if (!feet && this.killTouches.size === 0) return;
    this.group.updateMatrixWorld(true);
    if (feet) this.measureKillContacts(dt);
    // A touch on a plane takes the point of it nearest the part as the pose has it now.
    for (const [part, t] of this.killTouches) if (t.plane) t.plane.projectPoint(this.bones[Humanoid.touchJoint(part)].getWorldPosition(this.killTmp.a), t.target);
    for (const [part, t] of this.killTouches) if (part === 'hip_L' || part === 'hip_R' || part === 'chest' || part === 'knee_L' || part === 'knee_R') this.touchBody(part, t.target, t.weight);
    if (feet) {
      this.footIk.solve({
        group: this.group,
        bones: this.bones,
        scaleY: this.geo.scale.y,
        scaleW: this.geo.scale.w,
        contactL: this.killContacts[0],
        contactR: this.killContacts[1],
        // A knee put on a mark takes its leg off the floor lock.
        attachedL: this.limbAttached('L', false) && !this.killTouches.has('knee_L'),
        attachedR: this.limbAttached('R', false) && !this.killTouches.has('knee_R'),
        enabled: true,
        forcePlant: false,
        dt,
        holdPlanted: 1,
        releaseOverstretch: true,
      });
    }
    for (const [part, t] of this.killTouches) if (part === 'hand_L' || part === 'hand_R' || part === 'knee_L' || part === 'knee_R') this.touchLimb(part, t.target, t.weight);
    this.group.updateMatrixWorld(true);
  }

  /**
   * The kill's foot contacts this frame: the playing clip's own, or (a pose, or a take without contact curves) a foot
   * is down when its ankle is near the floor and, under a clip, it is not sweeping across the floor.
   */
  private measureKillContacts(dt: number): void {
    const c = this.killContacts;
    const prev = (this.killFootPrev ??= [this.bones.foot_L.getWorldPosition(new THREE.Vector3()), this.bones.foot_R.getWorldPosition(new THREE.Vector3())]);
    const own = this.animator.clipContacts(c);
    const floor = this.group.position.y + ANKLE_CLEARANCE * this.geo.scale.y;
    const [d0, d1] = Humanoid.KILL_FOOT_DOWN;
    const [s0, s1] = Humanoid.KILL_FOOT_STILL;
    (['L', 'R'] as const).forEach((s, i) => {
      const at = this.bones[`foot_${s}`].getWorldPosition(this.killTmp.a);
      if (!own) {
        const down = 1 - THREE.MathUtils.smoothstep(at.y - floor, d0 * this.geo.scale.y, d1 * this.geo.scale.y);
        const speed = dt > 1e-6 ? Math.hypot(at.x - prev[i]!.x, at.z - prev[i]!.z) / dt : 0;
        c[i] = this.animator.clipPlaying ? down * (1 - THREE.MathUtils.smoothstep(speed, s0, s1)) : down;
      }
      prev[i]!.copy(at);
    });
  }

  /** Move the pelvis bone by a world-space offset (everything above it, and the legs, come with it). */
  private shiftPelvis(delta: THREE.Vector3): void {
    const pelvis = this.bones.pelvis;
    const parent = pelvis.parent;
    if (!parent || delta.lengthSq() < 1e-12) return;
    const at = pelvis.getWorldPosition(this.killTmp.d).add(delta);
    pelvis.position.copy(parent.worldToLocal(at));
    pelvis.updateMatrixWorld(true);
  }

  /** Turn `bone` about its own joint so the world direction `from` swings to `to`, by `weight`. */
  private swingTo(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10 || !bone.parent) return;
    const t = this.killTmp;
    t.q.setFromUnitVectors(t.e.copy(from).normalize(), t.f.copy(to).normalize());
    bone.getWorldQuaternion(t.q2).premultiply(t.q);
    const want = bone.parent.getWorldQuaternion(t.q3).invert().multiply(t.q2);
    bone.quaternion.slerp(want, weight);
    bone.updateMatrixWorld(true);
  }

  /** The joint a touch puts on its mark: the wrist, the hip joint, the knee (shin origin) or the chest. */
  static touchJoint(part: TouchPart): JointName {
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

  /** A hip, the chest, or a knee's reach: move the pelvis (and bend the spine, for the chest) toward the mark. */
  private touchBody(part: TouchPart, target: THREE.Vector3, w: number): void {
    const t = this.killTmp;
    if (part === 'hip_L' || part === 'hip_R') {
      const hip = this.bones[part === 'hip_L' ? 'thigh_L' : 'thigh_R'].getWorldPosition(t.a);
      this.shiftPelvis(t.b.subVectors(target, hip).multiplyScalar(w));
      return;
    }
    if (part === 'chest') {
      const spine = this.bones.spine.getWorldPosition(t.a);
      const chest = this.bones.chest.getWorldPosition(t.b);
      this.swingTo(this.bones.spine, t.c.subVectors(chest, spine), t.d.subVectors(target, spine), w);
      // What the spine's bend cannot reach (the chest's distance from the spine is fixed), the hips make up.
      const moved = this.bones.chest.getWorldPosition(t.b);
      this.shiftPelvis(t.c.subVectors(target, moved).multiplyScalar(w));
      return;
    }
    // A knee: the hip goes to thigh length from the mark (down into a kneel, or up out of one), along the line to it.
    const s = part === 'knee_L' ? 'L' : 'R';
    const hip = this.bones[`thigh_${s}`].getWorldPosition(t.a);
    const knee = this.bones[`shin_${s}`].getWorldPosition(t.b);
    const len = hip.distanceTo(knee);
    const to = t.c.subVectors(target, hip);
    const dist = to.length();
    if (dist < 1e-6) return;
    this.shiftPelvis(to.multiplyScalar(((dist - len) / dist) * w));
  }

  /** A hand (two-bone arm IK, keeping its elbow's side) or a knee (the thigh turned at the hip) onto the mark. */
  private touchLimb(part: TouchPart, target: THREE.Vector3, w: number): void {
    const t = this.killTmp;
    if (part === 'knee_L' || part === 'knee_R') {
      const s = part === 'knee_L' ? 'L' : 'R';
      if (!this.limbAttached(s, false)) return;
      const hip = this.bones[`thigh_${s}`].getWorldPosition(t.a);
      const knee = this.bones[`shin_${s}`].getWorldPosition(t.b);
      this.swingTo(this.bones[`thigh_${s}`], t.c.subVectors(knee, hip), t.d.subVectors(target, hip), w);
      return;
    }
    const s = part === 'hand_L' ? 'L' : 'R';
    if (!this.limbAttached(s, true)) return;
    const shoulder = this.bones[`upperArm_${s}`].getWorldPosition(t.a);
    const elbow = this.bones[`foreArm_${s}`].getWorldPosition(t.b);
    const hand = this.bones[`hand_${s}`].getWorldPosition(t.c);
    // The elbow keeps bending the way it bends now; a straight arm bends out and back.
    const pole = t.d.copy(shoulder).add(hand).multiplyScalar(0.5);
    pole.subVectors(elbow, pole);
    if (pole.lengthSq() < 1e-6) this.group.localToWorld(pole.set((s === 'L' ? -1 : 1) * 0.7, 0.9, 0.8));
    else pole.normalize().multiplyScalar(0.3).add(elbow);
    solveTwoBone(this.bones[`upperArm_${s}`], this.bones[`foreArm_${s}`], this.bones[`hand_${s}`], target, pole, w);
  }

  private solveIk(dt: number): void {
    if (this.kill && !this.blade) {
      this.solveKillIk(dt);
      return;
    }
    // The blade creature keeps its feet planted through a kill too (rig-necromorph design D6a): its scenes are kills.
    if (this.state !== 'alive' || this.transformAnim) {
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
      // The blade creature plants its feet at any distance: the R10 charge is seen from far down the hall (design D6a).
      enabled: uprightAlive && (this.near || this.blade !== null),
      forcePlant,
      dt,
      // The blade creature holds each planted foot where it landed, through corners and changes of speed (design D6a).
      ...(this.blade ? { ankleHeight: this.blade.ankleHeight, holdPlanted: 0.45 } : {}),
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
