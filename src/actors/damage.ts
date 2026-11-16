import {
  isSeverable,
  limbOf,
  REGION_CHILDREN,
  REGIONS,
  type Limb,
  type Region,
  type SeverableRegion,
  type Side,
} from './skeleton.ts';

/** Part HP as a fraction of the enemy's base HP (ADR-0006 damage rules, [Decided]). */
export const PART_HP: Readonly<Record<Region, number>> = {
  head: 0.25,
  upperArm_L: 0.3,
  foreArm_L: 0.3,
  upperArm_R: 0.3,
  foreArm_R: 0.3,
  thigh_L: 0.35,
  shin_L: 0.35,
  thigh_R: 0.35,
  shin_R: 0.35,
  torso: 2.0,
};

export const DAMAGE_TAKEN: Readonly<Record<Region, number>> = {
  head: 1,
  upperArm_L: 1,
  foreArm_L: 1,
  upperArm_R: 1,
  foreArm_R: 1,
  thigh_L: 1,
  shin_L: 1,
  thigh_R: 1,
  shin_R: 1,
  torso: 0.5,
};

/**
 * Per-unit overrides of the ADR-0006 tables (ADR-0021). Heroes take less from limbs and torso,
 * have a bigger torso pool, and take extra damage through their weak spot.
 */
export interface DamageProfile {
  taken?: Partial<Record<Region, number>>;
  partHp?: Partial<Record<Region, number>>;
  /** Multiplier applied instead of `taken` for hits on the weak spot (the torso pool). */
  weakSpotTaken: number;
  /** Damage within POISE_WINDOW seconds needed to stagger the body (0 = every leg hit staggers). */
  poise: number;
}

export const DEFAULT_PROFILE: DamageProfile = { weakSpotTaken: 1, poise: 0 };

/** Hero tier [Assumed]: 400 base HP, limbs and torso half-proof, belly weak spot at x2. */
export const HERO_BASE_HP = 400;
export const HERO_PROFILE: DamageProfile = {
  taken: {
    head: 0.5, upperArm_L: 0.5, foreArm_L: 0.5, upperArm_R: 0.5, foreArm_R: 0.5,
    thigh_L: 0.5, shin_L: 0.5, thigh_R: 0.5, shin_R: 0.5, torso: 0.15,
  },
  partHp: { torso: 1.2 },
  weakSpotTaken: 2,
  poise: 30,
};
/** Seconds over which damage counts toward breaking poise. */
export const POISE_WINDOW = 0.4;

/** Shambler base HP before difficulty scaling (ADR-0006). */
export const SHAMBLER_BASE_HP = 100;

/** Limbs lost before the body dies (head counts). */
export const LIMBS_TO_KILL = 3;

/** A leg limps once its thigh or shin has lost this share of its own HP (ADR-0019). */
export const LIMP_WOUND = 0.4;
/** Walk speed lost at the worst limp. */
export const LIMP_SLOWDOWN = 0.25;

export type LocomotionMode = 'walk' | 'crawl' | 'drag';

export interface LocomotionState {
  mode: LocomotionMode;
  /** Multiplier on walk speed: 1, 0.55 crawling on one leg, 0.4 dragging with arms. Less than 1 when walking on a wounded leg. */
  speedMul: number;
  /** 0 = sound legs, up to 1 = a leg about to come off: limp gait and slower walk (ADR-0019). */
  limp: number;
  /** The wounded leg (the worse one when both are hurt), or null when neither limps. */
  limpSide: Side | null;
  /** Multiplier on grab damage: -40% per lost arm side, 0 with no arms. */
  grabMul: number;
  canGrabL: boolean;
  canGrabR: boolean;
  /** No arms: can only lunge to bite. */
  biteOnly: boolean;
  /** Head lost: flails and tracks sound only. */
  blind: boolean;
  legsLost: number;
  armsLost: number;
}

export interface HitResult {
  region: Region;
  /** Damage actually removed from the region after its multiplier. */
  applied: number;
  /** Region that was cut off by this hit, if any. */
  severed: SeverableRegion | null;
  /** Every region newly lost (the severed one and everything below it). */
  lost: SeverableRegion[];
  /** The hit took a limb that was not already gone. */
  newLimb: Limb | null;
  killed: boolean;
  killedBy: 'torso' | 'limbs' | null;
  /** The hit landed on the weak spot (ADR-0021). */
  weakSpot: boolean;
}

/**
 * Per-body part HP and severing (ADR-0006). Pure game rules, no rendering, so it is unit
 * tested and reused by the AI (ADR-0007) to pick locomotion and attacks.
 */
export class BodyDamage {
  readonly baseHp: number;
  readonly maxHp: Readonly<Record<Region, number>>;
  private readonly hp: Record<Region, number>;
  private readonly severed = new Set<SeverableRegion>();
  private deadBy: 'torso' | 'limbs' | null = null;
  readonly profile: DamageProfile;

  /** `baseHp` is already scaled by difficulty (ADR-0008 supplies the multiplier). */
  constructor(baseHp: number = SHAMBLER_BASE_HP, profile: DamageProfile = DEFAULT_PROFILE) {
    this.baseHp = baseHp;
    this.profile = profile;
    const max = {} as Record<Region, number>;
    for (const r of REGIONS) max[r] = (profile.partHp?.[r] ?? PART_HP[r]) * baseHp;
    this.maxHp = max;
    this.hp = { ...max };
  }

  get dead(): boolean {
    return this.deadBy !== null;
  }

  get causeOfDeath(): 'torso' | 'limbs' | null {
    return this.deadBy;
  }

  hpOf(r: Region): number {
    return this.hp[r];
  }

  isSevered(r: Region): boolean {
    return isSeverable(r) && this.severed.has(r);
  }

  severedRegions(): ReadonlySet<SeverableRegion> {
    return this.severed;
  }

  limbsLost(): Set<Limb> {
    const out = new Set<Limb>();
    for (const r of this.severed) out.add(limbOf(r));
    return out;
  }

  /** `weakSpot` routes the hit to the torso pool at the profile's weak-spot multiplier. */
  apply(hitRegion: Region, amount: number, weakSpot = false): HitResult {
    const region: Region = weakSpot ? 'torso' : hitRegion;
    const result: HitResult = { region, applied: 0, severed: null, lost: [], newLimb: null, killed: false, killedBy: null, weakSpot };
    if (this.dead || amount <= 0 || this.isSevered(region)) return result;
    const taken = weakSpot ? this.profile.weakSpotTaken : (this.profile.taken?.[region] ?? DAMAGE_TAKEN[region]);
    const applied = Math.min(this.hp[region], amount * taken);
    this.hp[region] -= applied;
    result.applied = applied;
    if (this.hp[region] > 1e-6) return result;
    this.hp[region] = 0;

    if (region === 'torso') {
      this.deadBy = 'torso';
      result.killed = true;
      result.killedBy = 'torso';
      return result;
    }

    const limbsBefore = this.limbsLost();
    result.severed = region;
    for (const r of [region, ...REGION_CHILDREN[region]]) {
      if (this.severed.has(r)) continue;
      this.severed.add(r);
      this.hp[r] = 0;
      result.lost.push(r);
    }
    const limb = limbOf(region);
    if (!limbsBefore.has(limb)) result.newLimb = limb;
    if (this.limbsLost().size >= LIMBS_TO_KILL) {
      this.deadBy = 'limbs';
      result.killed = true;
      result.killedBy = 'limbs';
    }
    return result;
  }

  /** How hurt a leg is: the larger share lost by its thigh or shin, 0..1 (1 for a severed leg). */
  legWound(side: Side): number {
    const lost = (r: 'thigh' | 'shin'): number => {
      const max = this.maxHp[`${r}_${side}`];
      return max > 0 ? 1 - this.hp[`${r}_${side}`] / max : 0;
    };
    return Math.max(lost('thigh'), lost('shin'));
  }

  locomotion(): LocomotionState {
    const lost = this.limbsLost();
    const legsLost = (lost.has('leg_L') ? 1 : 0) + (lost.has('leg_R') ? 1 : 0);
    const armsLost = (lost.has('arm_L') ? 1 : 0) + (lost.has('arm_R') ? 1 : 0);
    const mode: LocomotionMode = legsLost === 0 ? 'walk' : legsLost === 1 ? 'crawl' : 'drag';
    // Limp only while both legs are attached; from the threshold it ramps from 0.4 to 1 as the leg nears severing.
    const woundL = this.legWound('L');
    const woundR = this.legWound('R');
    const worst = Math.max(woundL, woundR);
    const limp = mode === 'walk' && worst >= LIMP_WOUND ? 0.4 + 0.6 * Math.min(1, (worst - LIMP_WOUND) / (1 - LIMP_WOUND)) : 0;
    return {
      mode,
      speedMul: mode === 'walk' ? 1 - LIMP_SLOWDOWN * limp : mode === 'crawl' ? 0.55 : 0.4,
      limp,
      limpSide: limp > 0 ? (woundL >= woundR ? 'L' : 'R') : null,
      grabMul: armsLost === 0 ? 1 : armsLost === 1 ? 0.6 : 0,
      canGrabL: !lost.has('arm_L'),
      canGrabR: !lost.has('arm_R'),
      biteOnly: armsLost === 2,
      blind: lost.has('head'),
      legsLost,
      armsLost,
    };
  }
}
