import { ValidationError, arr, bool, num, numRange, obj, oneOf, optional, record, str, type Infer, type Validator } from '../../core/validate.ts';
import { JOINT_NAMES, type JointName } from '../../actors/skeleton.ts';

/**
 * Scripted infected kills (infection-kills spec, `data/kills.json`): a kill style is an ordered list of beats. Each beat
 * holds or loops authored poses, eases the victim's convulsion toward a target, may move lumps under the skin, fires timed
 * events (sounds, jolts, gore, glass marks, the tear, the death, the creature), and ends on its cue or its time limit.
 *
 * Staged motion (voss-death-scene D2-D5): a beat's `track` plays captured clips and poses one after another, each from
 * its own beat time; a `route` carries her across the floor through marks she reaches on time, with the clips played in
 * place and her feet planted (and heard) from their contacts; and `touch` events put a hand, hip, knee or her chest on a
 * mark by IK. The poses and clips give her body its shape and motion; the route and the touches put it where the room is.
 *
 * Waiting motion (D6): a track piece may `loop` a captured wait for a beat with no fixed end, a beat's `layer` loops
 * poses on a few joints only (fast scratching hands over a slow body), and `look` events turn her head to someone.
 */

export const KILL_KINDS = ['grownInside', 'converted', 'mauled'] as const;
export type KillKind = (typeof KILL_KINDS)[number];

/**
 * How a beat ends (always also at `max` seconds): a spoken line, its own time `s`, reaching the glass, the creature
 * standing, (`mauled`) `impacts` slam impacts landing, or its captured `clip` reaching its last frame.
 */
export const BEAT_UNTIL = ['line', 'time', 'arrive', 'creature', 'impacts', 'clip'] as const;

/** A beat clip's playback speed: one rate, or `[t, speed]` keys over the beat (linear between, held past the ends). */
export type ClipSpeed = number | [number, number][];

const SPEED_MIN = 0.05;
const SPEED_MAX = 4;

const clipSpeed: Validator<ClipSpeed> = (v, p) => {
  if (typeof v === 'number') return numRange(SPEED_MIN, SPEED_MAX)(v, p);
  if (!Array.isArray(v) || v.length === 0) throw new ValidationError(p, 'expected a speed or a list of [t, speed] keys');
  let last = -Infinity;
  return v.map((k, i) => {
    const kp = `${p}[${i}]`;
    if (!Array.isArray(k) || k.length !== 2) throw new ValidationError(kp, 'expected [t, speed]');
    const t = numRange(0, 60)(k[0], `${kp}[0]`);
    const s = numRange(SPEED_MIN, SPEED_MAX)(k[1], `${kp}[1]`);
    if (t <= last) throw new ValidationError(kp, 'keys must be in time order');
    last = t;
    return [t, s] as [number, number];
  });
};

/** Playback speed at `t` seconds into the beat (into the segment, for a track segment). */
export function clipSpeedAt(speed: ClipSpeed | undefined, t: number): number {
  if (speed === undefined) return 1;
  if (typeof speed === 'number') return speed;
  const first = speed[0]!;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < speed.length; i++) {
    const [t1, s1] = speed[i]!;
    if (t <= t1) {
      const [t0, s0] = speed[i - 1]!;
      return s0 + ((s1 - s0) * (t - t0)) / (t1 - t0);
    }
  }
  return speed[speed.length - 1]![1];
}

/**
 * Beat events. The `mauled` ones drive the attacker as well as the victim (medbay-attack spec): `pin` puts the attacker
 * at an offset from her, `grip` closes its hand on one of her joints (or `release`s it), `attackerPose` poses it,
 * `haulTo` walks it to a mark with the grip held, `slam` drives her gripped head onto a mark's surface, `throw` lets go
 * and flies her to a mark on the glass, and `drag` walks it to a mark with her trailing from the grip. `backTo` is hers:
 * she backs away to a mark, facing the attacker (overhaul-priya-r08-death D16). `walkTo` walks the attacker to a mark with
 * nothing held, faster than a haul (it leaving, D37), and `attackerLook` turns its head to a mark (none: straight ahead).
 * `layout` (livelier-cart-slam D11) only acts in a skipped or restored kill: it lays the props of the group its `prop`
 * names out at their authored `after` poses, the aftermath a played kill leaves.
 *
 * `sweep` (voss-death-scene D9) throws the loose objects within `reach` of the `from` mark along `dir` (physics on), or
 * lays out its `group` at their `after` poses (physics off). `tip` (D8) sends a prop over to its `after` pose on a
 * scripted track lasting `s`, rolling about its bottom edge `edge` m out from its origin, identical with physics on and
 * off. As it starts, its load is thrown with `burst` (physics on) or laid out from `group` (off). Neither moves anything
 * in a skipped or restored kill: that kill's `layout` events lay the groups out instead.
 */
export const KILL_EVENTS = ['pose', 'sfx', 'kick', 'gore', 'glass', 'tear', 'die', 'creature', 'light', 'toGlass', 'face', 'stinger', 'pin', 'grip', 'attackerPose', 'attackerPerf', 'haulTo', 'slam', 'throw', 'drag', 'infect', 'backTo', 'walkTo', 'attackerLook', 'knock', 'layout', 'touch', 'look', 'sweep', 'tip'] as const;

/**
 * The parts of the victim a `touch` event (voss-death-scene D4) puts on a mark: a hand (its wrist joint), a hip (the hip
 * joint, by moving her pelvis), a knee (by turning the thigh, and lowering the pelvis when the knee cannot reach), or the
 * chest (the chest joint, by bending the spine, and moving the pelvis for what the spine cannot reach).
 */
export const TOUCH_PARTS = ['hand_L', 'hand_R', 'hip_L', 'hip_R', 'knee_L', 'knee_R', 'chest'] as const;
export type TouchPart = (typeof TOUCH_PARTS)[number];

/** The `mauled` events that need an attacker on the kill step. */
export const ATTACKER_EVENTS: readonly KillEventKind[] = ['pin', 'grip', 'attackerPose', 'attackerPerf', 'haulTo', 'slam', 'throw', 'drag', 'walkTo', 'attackerLook'];
export type KillEventKind = (typeof KILL_EVENTS)[number];

/** Kick directions in the victim's own frame (she faces forward); `pull` is a glass streak's. */
const NAMED_DIRS = ['back', 'fwd', 'left', 'right', 'up', 'pull'] as const;

/** A named direction, or (`sweep`) a world direction [x, z] across the floor. */
const eventDir: Validator<(typeof NAMED_DIRS)[number] | [number, number]> = (v, p) => {
  if (typeof v === 'string') return oneOf(NAMED_DIRS)(v, p);
  if (!Array.isArray(v) || v.length !== 2) throw new ValidationError(p, `expected one of ${NAMED_DIRS.join(', ')}, or [x, z]`);
  const d = [num(v[0], `${p}[0]`), num(v[1], `${p}[1]`)] as [number, number];
  if (Math.hypot(d[0], d[1]) < 1e-6) throw new ValidationError(p, 'a direction needs a length');
  return d;
};

const joint: Validator<JointName> = (v, p) => {
  const s = str(v, p);
  if (!(JOINT_NAMES as readonly string[]).includes(s)) throw new ValidationError(p, `unknown joint "${s}"`);
  return s as JointName;
};

const eventShape = {
  /** Seconds after the beat starts. */
  t: numRange(0, 60),
  do: oneOf(KILL_EVENTS),
  /** `pose`/`die`: the pose; `creature`: the creature's start pose. */
  pose: optional(str),
  blend: optional(numRange(0, 5)),
  /** `sfx`: sound names, first one that exists plays (a recording to come, then an existing stand-in); `stinger`: the score stinger. */
  id: optional(arr(str)),
  /** `sfx`: loudness multiplier (default 1). */
  gain: optional(numRange(0.1, 24)),
  /** `sfx`/`kick`/`gore`: the joint it comes from. */
  joint: optional(joint),
  /**
   * `kick`: push direction in the victim's own frame (she faces forward); `glass streak`: `pull` runs it along the pane the
   * way she is dragged; `sweep`: [x, z], the way across the floor the objects go.
   */
  dir: optional(eventDir),
  /** `kick`: how hard the joint jolts; `knock`/`sweep`: how hard loose props are thrown (1 = about 1.6 m/s). */
  strength: optional(numRange(0, 3)),
  /**
   * `knock` (adopt-physics-engine D15): for the rest of the beat, every loose prop that comes within this many metres of
   * the victim over the floor is knocked over, once. Does nothing without physics, or in a skipped or restored kill.
   */
  reach: optional(numRange(0.2, 2)),
  /** `sweep`: the mark (a room anchor, or a kill step mark) the sweep starts from: where her arm crosses the bench. */
  from: optional(str),
  /**
   * `gore`: burst | chunks | spurt | pool | cough (a small tight spray from the mouth, ahead of her face and falling) | drip
   * (blood running from her mouth for `s` seconds, `count` drops a second, falling from wherever her head goes);
   * `glass`: print | splat | streak | crack.
   */
  kind: optional(str),
  count: optional(numRange(1, 400)),
  size: optional(numRange(0.02, 6)),
  /** `gore spurt`/`drip`: seconds; `glass streak`: seconds to run down; `tip`: seconds the prop takes to go over. */
  s: optional(numRange(0, 30)),
  /** `glass print`: which palm. */
  hand: optional(oneOf(['L', 'R'] as const)),
  /** `tear`: wound radius (m). */
  radius: optional(numRange(0, 0.5)),
  /** `light`: the kill's key light on the victim. */
  state: optional(oneOf(['on', 'off', 'dip'] as const)),
  /** `toGlass`/`haulTo`/`drag`/`walkTo`: walk speed (m/s). `walkTo` is the attacker walking with nothing held (up to 2.2 m/s). */
  speed: optional(numRange(0.1, 8)),
  /** `attackerPose`: the attacker's stepping rate while it moves (1 = as its speed implies; 0.6 = slower, heavier steps). */
  gait: optional(numRange(0.1, 2)),
  /** `attackerPose`: the lunge (0..1) the attacker leans into: body forward, arms out, jaw wide (the body's `charge`). */
  charge: optional(numRange(0, 1)),
  /** `pin`: metres behind the victim and to her right (her own frame); the attacker faces the way she faces, or `away`. */
  behind: optional(numRange(-2, 2)),
  side: optional(numRange(-2, 2)),
  facing: optional(oneOf(['with', 'away'] as const)),
  /** `grip`: the attacker's hand closes on this victim joint (`joint`), or lets go. `hand` is the attacker's hand; `blade` (0..1) places the grip along the creature's blade (0 = root, 1 = tip; rig-necromorph design D9). */
  release: optional(bool),
  blade: optional(numRange(0, 1)),
  /**
   * `attackerPerf`: named creature performance (such as `scream`, design D8) and optional stretched hold (s). `touch`: how
   * long the part stays on its mark once it is there (default 0.3 s).
   */
  perf: optional(str),
  /** `look`: how long she keeps looking (default 1.2 s). */
  hold: optional(numRange(0, 30)),
  /**
   * `look` (voss-death-scene D6, a glance): who her head turns to, followed while they move: `player` (Jay's eye) or
   * `npc:<id>` (that character's head), or a kill step mark or room anchor. After `hold` s she looks ahead again.
   */
  target: optional(str),
  /**
   * `touch` (voss-death-scene D4): the part of her that goes to `mark`. Over `blend` s (default 0.15) her limb or body is
   * drawn onto the mark by IK, held there for `hold` s, then let go over `blend` s, so the contact lands within 5 cm
   * whatever her body's proportions. `mark` is a kill step mark, a room anchor, or `glass`: the point on the pane nearest
   * the part. The poses give her the shape; the touch makes the contact. Nothing in a skipped or restored kill.
   */
  part: optional(oneOf(TOUCH_PARTS)),
  /**
   * `touch` on `glass`: how far (m) the part's joint stays off the pane's face (default 0). The chest joint sits inside her,
   * so her chest on the pane is the joint about her chest's depth off it.
   */
  gap: optional(numRange(0, 0.5)),
  /**
   * `touch` on a mark: hold the part at the mark's height (a level surface through it) wherever the pose takes it across,
   * instead of at the point itself, so a hand sweeps over a bench top. (On `glass` the part always slides along the pane.)
   */
  slide: optional(bool),
  /** `infect`: the bloom's stage on the victim's body (0..3). */
  stage: optional(numRange(0, 3)),
  /**
   * `haulTo`/`slam`/`throw`/`drag`, and `face` (turn to it, e.g. a camera): a named mark from the kill step's `marks`.
   * `touch`: a kill step mark, a room anchor, or `glass`. `sfx`: `glass`, heard from the pane level with `joint` (or
   * `prop`), for a sound made on it.
   */
  mark: optional(str),
  /** `haulTo`/`drag`: on arrival the attacker turns to face this mark. */
  faceMark: optional(str),
  /** `haulTo`/`drag`: marks walked through, in order, on the way to `mark` (along the glass, round the cart). */
  via: optional(arr(str)),
  /** `throw`: how high (m) her body arcs on the way (over a cart between her and the glass). */
  arc: optional(numRange(0, 2)),
  /** `slam`: seconds the attacker winds up before this one (default `MAUL.windup`): the last, hardest one waits longest. */
  windup: optional(numRange(0.05, 2)),
  /**
   * `slam` (livelier-cart-slam D4): when it lands, the loose props within `reach` m of the impact are thrown up and
   * away, once, at `strength` (1 = about 2.5 m/s), with `up` the upward share. Nothing in a skipped or restored kill.
   * `tip` (voss-death-scene D8): as it starts, the loose props within `reach` m of the prop's origin (its load) are
   * thrown the way it falls.
   */
  burst: optional(obj({ reach: numRange(0.1, 2), strength: numRange(0, 4), up: optional(numRange(0, 1)) })),
  /**
   * `slam`: the prop it lands on; the mark moves with it, and `jolt` moves it. `layout`: the prop group laid out. `tip`:
   * the prop that goes over. `sfx`: the prop it is heard from, where it is then (instead of `joint`).
   */
  prop: optional(str),
  /**
   * `slam` (D3): how the prop jumps when it lands, in its own frame: `slide` [x, z] m and `yaw` degrees that it keeps,
   * and `rock` degrees its far side lifts and drops back, about its bottom edge `edge` m toward the attacker.
   */
  jolt: optional(obj({ slide: optional(arr(num)), yaw: optional(numRange(-30, 30)), rock: optional(numRange(0, 20)), edge: optional(numRange(0, 2)) })),
  /**
   * `sweep`: the `after` group laid out at the sweep when physics is off (the objects it throws). `tip`: the group of its
   * load, laid out as it starts going over when physics is off.
   */
  group: optional(str),
  /** `tip`: how far (m) from the prop's origin, toward where it falls, the bottom edge it rolls over lies (default 0). */
  edge: optional(numRange(0, 2)),
  /**
   * `tip`: its track as `[u, slide, yaw, roll]` keys, each a share 0..1 (u of its `s`; slide, yaw and roll of the way to
   * its `after` pose), linear between keys, from [0, 0, 0, 0] to [1, 1, 1, 1]. Default: the roll speeds up like a fall
   * (u²), the slide and yaw ease in and out.
   */
  keys: optional(arr(arr(num))),
};

/**
 * One piece of a beat's `track` (voss-death-scene D2): from beat time `at` the victim plays a captured `clip` (the take
 * from `from` to `to`, in seconds of the take, at `speed`; then its `to` frame holds until the next piece), or holds a
 * `pose`. Each piece blends in from whatever came before it over `blend` s.
 */
const trackShape = {
  at: numRange(0, 60),
  clip: optional(str),
  pose: optional(str),
  from: optional(numRange(0, 600)),
  to: optional(numRange(0, 600)),
  /** Playback speed (default 1): one rate, or `[t, speed]` keys over the piece (t from the piece's start). */
  speed: optional(clipSpeed),
  blend: optional(numRange(0, 3)),
  /**
   * A clip piece that plays round and round from `from` to `to` (D6) instead of holding its last frame: a wait in a beat
   * with no fixed end. Use a take baked as a loop (its seam blended) and leave `from`/`to` out to loop the whole take.
   */
  loop: optional(bool),
};

/**
 * A beat's pose layer (voss-death-scene D6): its `poses` loop every `period` s, blending over `blend` s, on the listed
 * `joints` only (the arms that scratch), while the rest of the body keeps whatever the beat's poses or track give it (a
 * captured wait). Kicks and convulsion still layer on top.
 */
const layerShape = {
  poses: arr(str),
  period: numRange(0.05, 5),
  blend: optional(numRange(0, 3)),
  joints: arr(joint),
};

/** A route mark's facing: a mark (string) she turns to, or a yaw in degrees (0 faces -Z, 90 faces -X). */
const faceRef: Validator<string | number> = (v, p) => (typeof v === 'number' ? numRange(-360, 360)(v, p) : str(v, p));

/**
 * One mark of a beat's `route` (voss-death-scene D3): she reaches `mark` (a kill step mark, a room anchor, or `glass`, the
 * stand point at the pane) `t` s into the beat. With `face` she turns to it as she arrives, and keeps it while she is
 * there; otherwise she faces the way she is going. Between two marks that both give a facing (or from where the beat
 * starts her to a first mark that gives one) she turns from one facing to the other as she goes, never to the way she
 * goes: a sidestep, such as her lurch into the bench beside her or her slide along the pane.
 */
const routeShape = {
  mark: str,
  t: numRange(0, 60),
  face: optional(faceRef),
};

const bulgeShape = {
  /** Joint chain the lump travels along, from start to end. */
  path: arr(joint),
  radius: numRange(0.01, 0.4),
  /** Outward push (m). */
  amp: numRange(0, 0.2),
};

const beatShape = {
  id: str,
  /**
   * Poses held (one) or looped back and forth (two or more, every `period` s). With a `clip` or a `track`, they are
   * only the fallback played while a clip the body does not have is due (and before the track's first piece).
   */
  poses: arr(str),
  /**
   * A captured clip (an id in the victim's motion library or pack) played once from its first frame to its last, then
   * held; it blends in over `blend` s. Convulsion and kicks layer on top of it. Shorthand for a one-piece `track`.
   */
  clip: optional(str),
  /** `clip` playback speed (default 1). */
  speed: optional(clipSpeed),
  /**
   * Clips and poses played one after another (voss-death-scene D2), each from its own beat time; see `trackShape`. A
   * missing clip falls back to the beat's `poses` while it is due, with one warning.
   */
  track: optional(arr(obj(trackShape))),
  /** Poses looped on some joints only, over the track or poses (D6; see `layerShape`). */
  layer: optional(obj(layerShape)),
  /**
   * Where her head rests through the beat, between `look` glances (D6): a look target, or `self:<joint>`, a joint of her
   * own body (her left wrist, to watch the arm she scratches). Absent: ahead.
   */
  gaze: optional(str),
  /** How fast her head turns to her gaze and glances this beat (1 = normal, default; 0.6 is a laboured, unhurried turn). */
  headPace: optional(numRange(0.2, 2)),
  /**
   * Where she goes over the beat (voss-death-scene D3): her floor position follows a curve from where the beat starts
   * her through the marks, reaching each at its `t`, easing out of the start and into the last mark. Clips play in place
   * (their own travel across the floor removed; the hips keep their height and sway), and her feet plant from the clips'
   * foot contacts, with a footstep on each landing (D5). A skipped or restored kill puts her at the last mark of its
   * last route beat. A route warns once per leg whose speed is more than 35% off its clip's own.
   */
  route: optional(arr(obj(routeShape))),
  period: optional(numRange(0.05, 5)),
  blend: optional(numRange(0, 3)),
  /** Convulsion target (0..1) and how fast it eases there (per second). */
  convulse: numRange(0, 1),
  rate: optional(numRange(0.05, 20)),
  until: oneOf(BEAT_UNTIL),
  /** `until: time`: the beat's own length. */
  s: optional(numRange(0, 60)),
  /** Time limit: the beat always ends by then, so a missing recording never stops the kill. */
  max: numRange(0.1, 60),
  /** Only when the victim stands at a glass partition. */
  needsGlass: optional(bool),
  /** `until: impacts`: how many slam impacts end the beat. */
  impacts: optional(numRange(1, 12)),
  /**
   * `inReach` (`mauled`, medbay-attack "It reaches her by walking"): the beat only begins once the attacker stands within
   * `reach` m (default 0.7) of her. Until then the previous beat holds; past its time limit the attacker walks the rest of
   * the way. It is never placed.
   */
  startWhen: optional(oneOf(['inReach'] as const)),
  reach: optional(numRange(0.2, 2)),
  /**
   * The victim's voice in this beat (`mauled`): `lines[0]` plays as the beat starts, `lines[n]` right after impact n.
   * Each impact cuts whatever she is saying first; an empty string is silence.
   */
  lines: optional(arr(str)),
  /** Lumps under the skin, moving start to end of their path over the beat (by `s`, else `max`). */
  bulges: optional(arr(obj(bulgeShape))),
  events: optional(arr(obj(eventShape))),
};

/**
 * `mauled`: how the attacker reacts, once, to someone behind the glass while it approaches her (medbay-attack spec "It
 * notices him"). `stare`: it stops, turns to the target and holds still for `hold` s, then goes on. It plays `at` s
 * into the first beat unless a `kill:notice` brings it forward; it never moves a later beat. (`orient`, a short animal
 * head-snap for mindless creatures, is the expected second kind; not built.)
 */
export const NOTICED_KINDS = ['stare'] as const;
const noticedShape = {
  kind: oneOf(NOTICED_KINDS),
  at: numRange(0, 60),
  hold: numRange(0.2, 6),
  target: oneOf(['player'] as const),
  /** The attacker's pose while it stares. */
  pose: optional(str),
};

const styleShape = {
  kind: oneOf(KILL_KINDS),
  noticed: optional(obj(noticedShape)),
  /** Look id (castLooks) of the creature that comes out of the victim (grownInside). */
  creature: optional(str),
  /** Heights above the floor (m) that blood marks on the glass keep clear of. */
  clearBand: optional(obj({ min: num, max: num })),
  /** How far from the glass the victim stands (m). */
  glassStand: optional(numRange(0.2, 2)),
  /**
   * The victim screams with her jaw (voss-death-scene D11): while she says a recorded `scream` line it opens with the
   * recording's loudness and trembles at the loudest, over the beat's poses and convulsion. Without a recording the beat's
   * poses hold her mouth open as usual.
   */
  screamJaw: optional(bool),
  beats: arr(obj(beatShape)),
};

export type KillTrackSegment = Infer<typeof trackShape>;
export type KillRouteMark = Infer<typeof routeShape>;
export type KillEvent = Infer<typeof eventShape>;
export type KillBeat = Infer<typeof beatShape>;
export type KillStyle = Infer<typeof styleShape>;
export type KillTable = Record<string, KillStyle>;

/** A beat's track: its own, or its `clip` as a one-piece track (D2), or null when it plays only poses. */
export function beatTrack(beat: KillBeat): readonly KillTrackSegment[] | null {
  if (beat.track) return beat.track;
  if (beat.clip === undefined) return null;
  return [{ at: 0, clip: beat.clip, ...(beat.speed !== undefined ? { speed: beat.speed } : {}), blend: beat.blend ?? 0.3 }];
}

export const validateKillTable: Validator<KillTable> = (v, p) => {
  const table = record(obj(styleShape))(v, p);
  for (const [id, style] of Object.entries(table)) {
    const sp = `${p} > ${id}`;
    if (style.noticed && style.kind !== 'mauled') throw new ValidationError(`${sp} > noticed`, 'only "mauled" kills have an attacker to notice anyone');
    const seen = new Set<string>();
    style.beats.forEach((b, i) => {
      const bp = `${sp} > beats[${i}]`;
      if (seen.has(b.id)) throw new ValidationError(bp, `duplicate beat "${b.id}"`);
      seen.add(b.id);
      if (b.poses.length === 0) throw new ValidationError(`${bp} > poses`, 'at least one pose');
      if (b.until === 'time' && b.s === undefined) throw new ValidationError(bp, '"until": "time" needs "s"');
      if (b.until === 'impacts' && b.impacts === undefined) throw new ValidationError(bp, '"until": "impacts" needs "impacts"');
      if (b.clip !== undefined && b.track !== undefined) throw new ValidationError(bp, 'give "clip" or "track", not both');
      const lastPiece = b.track?.[b.track.length - 1];
      if (b.until === 'clip' && b.clip === undefined && lastPiece?.clip === undefined) throw new ValidationError(bp, '"until": "clip" needs "clip" (or a "track" ending in a clip)');
      if (b.until === 'clip' && lastPiece?.loop) throw new ValidationError(bp, '"until": "clip" never ends on a looping clip');
      if (b.layer && b.layer.poses.length === 0) throw new ValidationError(`${bp} > layer > poses`, 'at least one pose');
      if (b.layer && b.layer.joints.length === 0) throw new ValidationError(`${bp} > layer > joints`, 'at least one joint');
      if (b.gaze?.startsWith('self:') && !(JOINT_NAMES as readonly string[]).includes(b.gaze.slice(5))) throw new ValidationError(`${bp} > gaze`, `unknown joint "${b.gaze.slice(5)}"`);
      if (b.speed !== undefined && b.clip === undefined) throw new ValidationError(`${bp} > speed`, '"speed" is for a "clip" beat (a track piece has its own)');
      for (const [k, s] of (b.track ?? []).entries()) {
        const sp2 = `${bp} > track[${k}]`;
        if ((s.clip === undefined) === (s.pose === undefined)) throw new ValidationError(sp2, 'a track piece has a "clip" or a "pose"');
        if (s.pose !== undefined && (s.from !== undefined || s.to !== undefined || s.speed !== undefined || s.loop !== undefined)) throw new ValidationError(sp2, '"from", "to", "speed" and "loop" are for a clip piece');
        if (s.from !== undefined && s.to !== undefined && s.to <= s.from) throw new ValidationError(sp2, '"to" must come after "from"');
        if (s.at > b.max) throw new ValidationError(sp2, `starts after the beat's time limit (${b.max} s)`);
        if (k > 0 && s.at <= b.track![k - 1]!.at) throw new ValidationError(sp2, 'pieces must be in time order');
      }
      for (const [k, m] of (b.route ?? []).entries()) {
        const mp = `${bp} > route[${k}]`;
        if (m.t <= 0) throw new ValidationError(mp, 'a mark is reached after the beat starts (she starts where the beat finds her)');
        if (m.t > b.max) throw new ValidationError(mp, `reached after the beat's time limit (${b.max} s)`);
        if (k > 0 && m.t <= b.route![k - 1]!.t) throw new ValidationError(mp, 'marks must be in time order');
      }
      if (b.route?.length === 0) throw new ValidationError(`${bp} > route`, 'a route needs at least one mark');
      if (b.s !== undefined && b.s > b.max) throw new ValidationError(bp, '"s" is longer than the time limit "max"');
      if (b.startWhen !== undefined && style.kind !== 'mauled') throw new ValidationError(`${bp} > startWhen`, 'only "mauled" kills have an attacker to reach her');
      if (b.startWhen !== undefined && i === 0) throw new ValidationError(`${bp} > startWhen`, 'the first beat has no beat before it to hold');
      if (b.reach !== undefined && b.startWhen === undefined) throw new ValidationError(`${bp} > reach`, '"reach" is for a "startWhen" beat');
      for (const [k, e] of (b.events ?? []).entries()) {
        const ep = `${bp} > events[${k}]`;
        if (e.t > b.max) throw new ValidationError(ep, `fires after the beat's time limit (${b.max} s)`);
        if (e.do === 'sfx' && !e.id?.length) throw new ValidationError(ep, 'sfx needs "id"');
        if (e.do === 'sfx' && e.mark !== undefined && e.mark !== 'glass') throw new ValidationError(`${ep} > mark`, 'an sfx "mark" is "glass"');
        if (e.do === 'kick' && (!e.joint || !e.dir)) throw new ValidationError(ep, 'kick needs "joint" and "dir"');
        if (e.do === 'gore' && !['burst', 'chunks', 'spurt', 'pool', 'cough', 'drip'].includes(e.kind ?? '')) throw new ValidationError(ep, 'gore kind is burst | chunks | spurt | pool | cough | drip');
        if (e.do === 'glass' && !['print', 'splat', 'streak', 'crack'].includes(e.kind ?? '')) throw new ValidationError(ep, 'glass kind is print | splat | streak | crack');
        if (e.dir === 'pull' && !(e.do === 'glass' && e.kind === 'streak')) throw new ValidationError(ep, '"dir": "pull" is only for a glass streak');
        if (e.do === 'stinger' && e.id?.length !== 1) throw new ValidationError(ep, 'stinger needs one "id"');
        if (e.do === 'knock' && e.reach === undefined) throw new ValidationError(ep, 'knock needs "reach"');
        if (e.do === 'sweep' && (e.from === undefined || !Array.isArray(e.dir) || e.reach === undefined)) throw new ValidationError(ep, 'sweep needs "from", "dir" as [x, z] and "reach"');
        if (e.do === 'tip' && (!e.prop || e.s === undefined)) throw new ValidationError(ep, 'tip needs "prop" and "s"');
        if (e.from !== undefined && e.do !== 'sweep') throw new ValidationError(`${ep} > from`, '"from" is for a sweep');
        if (Array.isArray(e.dir) && e.do !== 'sweep') throw new ValidationError(`${ep} > dir`, 'a direction [x, z] is for a sweep');
        if (e.do === 'kick' && Array.isArray(e.dir)) throw new ValidationError(`${ep} > dir`, 'a kick goes back | fwd | left | right | up');
        for (const k of ['windup', 'jolt'] as const) if (e[k] !== undefined && e.do !== 'slam') throw new ValidationError(`${ep} > ${k}`, `"${k}" is for a slam`);
        if (e.burst !== undefined && e.do !== 'slam' && e.do !== 'tip') throw new ValidationError(`${ep} > burst`, '"burst" is for a slam or a tip');
        if (e.group !== undefined && e.do !== 'sweep' && e.do !== 'tip') throw new ValidationError(`${ep} > group`, '"group" is for a sweep or a tip');
        for (const k of ['edge', 'keys'] as const) if (e[k] !== undefined && e.do !== 'tip') throw new ValidationError(`${ep} > ${k}`, `"${k}" is for a tip`);
        if (e.keys) {
          let last = -1;
          for (const [ki, key] of e.keys.entries()) {
            const kp = `${ep} > keys[${ki}]`;
            if (key.length !== 4 || key.some((v) => !(v >= 0 && v <= 1))) throw new ValidationError(kp, 'a key is [u, slide, yaw, roll], each 0..1');
            if (key[0]! <= last) throw new ValidationError(kp, 'keys must be in order of u');
            last = key[0]!;
          }
          const first = e.keys[0];
          const end = e.keys[e.keys.length - 1];
          if (!first || first.some((v) => v !== 0) || !end || end.some((v) => v !== 1)) throw new ValidationError(`${ep} > keys`, 'keys run from [0, 0, 0, 0] to [1, 1, 1, 1]');
        }
        if (e.jolt && !e.prop) throw new ValidationError(`${ep} > jolt`, 'a jolt needs the "prop" it moves');
        if (e.jolt?.slide && e.jolt.slide.length !== 2) throw new ValidationError(`${ep} > jolt > slide`, 'slide is [x, z]');
        if (e.do === 'layout' && !e.prop) throw new ValidationError(ep, 'layout needs the "prop" group it lays out');
        if (e.prop !== undefined && e.do !== 'slam' && e.do !== 'layout' && e.do !== 'tip' && e.do !== 'sfx') throw new ValidationError(`${ep} > prop`, '"prop" is for a slam, a layout, a tip or an sfx');
        if (e.do !== 'knock' && e.do !== 'sweep' && e.reach !== undefined) throw new ValidationError(`${ep} > reach`, '"reach" is for a knock or a sweep');
        if ((e.do === 'pose' || e.do === 'die' || e.do === 'attackerPose') && !e.pose) throw new ValidationError(ep, `${e.do} needs "pose"`);
        if (e.do === 'attackerPerf' && !e.perf) throw new ValidationError(ep, 'attackerPerf needs "perf"');
        if (e.blade !== undefined && e.do !== 'grip') throw new ValidationError(`${ep} > blade`, '"blade" is for a grip');
        if (e.do === 'grip' && !e.release && !e.joint) throw new ValidationError(ep, 'grip needs "joint" (or "release": true)');
        if ((e.do === 'haulTo' || e.do === 'walkTo' || e.do === 'slam' || e.do === 'throw' || e.do === 'drag' || e.do === 'backTo' || e.do === 'touch') && !e.mark) throw new ValidationError(ep, `${e.do} needs "mark"`);
        if (e.do === 'touch' && !e.part) throw new ValidationError(ep, 'touch needs "part"');
        if (e.part !== undefined && e.do !== 'touch') throw new ValidationError(`${ep} > part`, '"part" is for a touch');
        if (e.gap !== undefined && !(e.do === 'touch' && e.mark === 'glass')) throw new ValidationError(`${ep} > gap`, '"gap" is for a touch on "glass"');
        if (e.slide !== undefined && !(e.do === 'touch' && e.mark !== 'glass')) throw new ValidationError(`${ep} > slide`, '"slide" is for a touch on a mark (a touch on "glass" always slides)');
        if (e.do === 'look' && !e.target) throw new ValidationError(ep, 'look needs "target"');
        if (e.target !== undefined && e.do !== 'look') throw new ValidationError(`${ep} > target`, '"target" is for a look');
        if (e.via !== undefined && e.do !== 'haulTo' && e.do !== 'walkTo' && e.do !== 'drag') throw new ValidationError(`${ep} > via`, '"via" is for a haulTo, walkTo or drag');
        if (e.do === 'backTo' && style.kind !== 'mauled') throw new ValidationError(ep, 'backTo is only for "mauled" kills');
        if (ATTACKER_EVENTS.includes(e.do) && style.kind !== 'mauled') throw new ValidationError(ep, `${e.do} is only for "mauled" kills`);
      }
    });
  }
  return table;
};
