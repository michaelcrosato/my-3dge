/**
 * @file The post-IK foot plant (PLAN.md WP 3.5, I-11; the animator's `post` slot, WP 3.7, built after G9): `footPlant`
 * stands the feet on probed ground (with a `state`, a foot in stance locks where it landed: engine/anim/locomotion/
 * locks.ts), and `FootPlant` is the layer that runs it last in the animator's `post` slot, after Actions' effector
 * solve (engine/anim/actions.ts), on a flat floor at the body's height or, given the view's `ground` (`queryGround`
 * over the sim's query view, WP 13.10), on the physics ground within a slope's band of that floor: a ramp, a stair.
 * Moved here from engine/anim/ik.ts with the layer (ADR-0009 amendment 8), so the solvers there stay under 400 lines.
 *
 * Locks (ADR-0025 amendment 10): a body that says when its feet stand (the humanoid's `stance()`: a `plantedStride`
 * build, the playground's player) locks a foot in stance, keeps a held sole on the ground under it as that moves (never
 * onto another level: a body stepping up leaves it on the floor below), lets go once the stance ends and steps a foot
 * astray back under the body standing still (locks.ts); with locks the knee bends the way the animation bends it
 * (`kneePole`), and a held foot lies flat, rolling on its heel and its ball as its animation's ankle allows
 * (engine/anim/footRoll.ts), its heading kept from where it locked. Other builds lock no foot (ADR-0009 amendment 8:
 * without a rule for stepping out, locks held feet where actions had left them and flipped knees); for them it stands
 * every sole, heel and toe on the floor (the kneel's, crouch's, dash's and guard's sinks) and keeps no state.
 *
 * Where it runs (ADR-0009 amendment 8): the view's puppets (engine/gfx/puppets/actors.ts, faded out as far as an
 * actor's clips hold its legs: clipsets.ts `legsHeld`), the feel kit's track (engine/dev/feel/anim.ts) and the anim QA
 * family's humanoids (tools/qa/anim.ts) attach it; the sim's precise-hit posing (engine/sim/actors.ts) does not, so
 * the trail it hashes is the animation's own and the plant stays presentation, as LOD 1 already drops the `post` slot.
 *
 * Invariants: it writes `rootPos.y` (the pelvis drop) and the legs' local rotations, then runs FK; it treats the root
 * scale as uniform; nothing reads a clock or a random stream. The layer keeps only its locks between ticks.
 *
 * @example
 * import { Vector3 } from '../core/math';
 * import { Animator } from './character';
 * const hero = new Animator({ build: 'build:heroic', clock: 1 });
 * const plant = new FootPlant().attach(hero);
 * for (let i = 0; i < 60; i++) hero.update({ pose: 'kneel', position: new Vector3(0, 0, 0) });
 * hero.socket('contactL').y; // ≈ 0: the sole on the floor
 * plant.inspect().drop; // the pelvis drop the kneel needed, m
 * @see engine/anim/footPlant.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import type { Animator } from './character';
import { forwardKinematics, jointPosition, jointRotation, socketPosition, tipPosition, type WorldPose } from './fk';
import { SLACK, twoBoneRot, type GroundHit, type GroundProbe } from './ik';
import { heading, heelPosition, kneePole, layToes, liftHeel, pitchHeel } from './footRoll';
import { createFootPlantState, holdFoot, onFeet, type FootPlantState } from './locomotion/locks';
import { PLANTED, plantedEase } from './locomotion/planted';
import type { Pose } from './pose';
import { PROPORTIONS, type Skeleton } from './skeleton';
import type { AnimLayer } from './weights';

/** Scratch objects, so the plant allocates nothing. */
const v = Array.from({ length: 14 }, () => new Vector3());
const [heel, tip, depth] = [v[8], v[9], v[10]];
const q = Array.from({ length: 6 }, () => new Quaternion());
const UP = new Vector3(0, 1, 0);

/** `footPlant`'s tuning, in metres and seconds; the locks' is `FOOT_LOCK` (engine/anim/locomotion/locks.ts). */
export const FOOT_PLANT = {
  up: 0.5, // how far above the sole the probe starts: the highest step a foot finds
  down: 0.6, // how far below the root the probe reaches: the deepest drop a foot follows
  liftFade: 0.1, // the sole height over which a lifting foot stops turning to the ground and pulling the pelvis down
  bend: 0.02, // m: a knee bent less than this off the line from hip to ankle bends toward the leg solve's pole
  slope: 1, // the physics ground a foot follows: rising or falling at most this much a metre out from the body…
  rough: 0.15, // …give or take this, m (a stair's riser, the capsule on a slope's high side); else the body's floor
  heelUp: Math.sin((10 * Math.PI) / 180), // a stance foot pitched this far toes-down (a sine) stands on its ball
} as const;

/** What the foot plant asks of the physics ground: the sim's read-only `QueryView` (engine/sim/queryView.ts) has it. */
export interface GroundQueries {
  probe(
    x: number,
    z: number,
    options?: { from?: number; depth?: number },
  ): { y: number; normal: { x: number; y: number; z: number } } | null;
}

/**
 * A `GroundProbe` over the physics ground, through `queries.probe` (the level and props, never an actor): a ray that
 * starts inside a body finds no ground, so a sole inside a wall never climbs onto it.
 */
export function queryGround(queries: GroundQueries): GroundProbe {
  return (origin, distance, hit) => {
    const ground = queries.probe(origin.x, origin.z, { from: origin.y, depth: distance - origin.y });
    if (!ground || ground.y >= origin.y) return false;
    hit.point.set(origin.x, ground.y, origin.z);
    hit.normal.set(ground.normal.x, ground.normal.y, ground.normal.z);
    return true;
  };
}

/** How `footPlant` plants. */
export interface FootPlantOptions {
  /** The locks kept between ticks (locks.ts); without it, nothing locks. */
  state?: FootPlantState;
  /** Whether each foot (left, right) is in stance this tick: a foot in stance locks where it lands. */
  stance?: readonly [boolean, boolean];
  /** The tick's length in seconds; `SIM_DT` by default. */
  dt?: number;
  /** Standing still: a locked sole astray steps back under the body (locks.ts `holdFoot`). Off by default. */
  steps?: boolean;
  /** The ground's own velocity under the body, m/s (a treadmill): the locks ride along with it. */
  treadmill?: Vector3;
  /** Seconds a lock takes to let go once its stance ends (locks.ts `FOOT_LOCK.release` by default; 0: at once). */
  release?: number;
  /** The ground has levels (the physics ground): a held sole stays on its own, never moved onto another. */
  levels?: boolean;
  /** With `state`, the body is on its feet: a held foot rolls on its heel and ball, a free one as its animation rolls
   * it; else a foot lies flat as it nears the ground. */
  rolls?: boolean;
  /** How far into its stride the body is, 0 standing to 1 (locomotion/planted.ts `plantedEase`): a held ankle bends up
   * as far as the knee allows (authoring.ts `ankleLimit`) as far as this; else 15° (`SOLVE.dorsiflexion`). */
  stride?: number;
  /**
   * The floor the animation stands on, world metres: a sole's lift is measured from it and the probe starts above it.
   * By default `pose.rootPos.y`, right for a pose whose root rests on the floor; a crouch or a kneel lowers the root,
   * so pass the body's floor (the `FootPlant` layer passes its position's height).
   */
  floor?: number;
}

const SIDES = (['L', 'R'] as const).map(
  (s) => [`foot${s}`, `contact${s}`, `thigh${s}`, `shin${s}`, `toe${s}`] as const,
);
/**
 * Each foot's plan for this tick: whether the probe hit, the ankle's target, the foot's world rotation, and with locks,
 * the knee's pole (`kneePole`) and a held foot's roll: its rotation lying flat, its pitch (rad: + the heel up about the
 * ball, − the toes up about the heel), and the ball's and the heel's places.
 */
const plans = SIDES.map(([foot]) => ({
  ...{ foot, hit: false, ankle: new Vector3(), rotation: new Quaternion() },
  ...{ align: 0, held: 0, reach: 0, pole: undefined as Vector3 | undefined, poleAt: new Vector3() },
  ...{ flat: new Quaternion(), pitch: 0, ball: new Vector3(), heel: new Vector3() },
}));
const hit: GroundHit = { point: new Vector3(), normal: new Vector3() };
/** The ground under a lock, a probe of its own. */
const beneath: GroundHit = { point: new Vector3(), normal: new Vector3() };

/**
 * Stands the feet on the ground `probe` finds under each sole (the `contact` sockets): each foot keeps its lift above
 * the floor (`options.floor`) over the ground (over ground below it, as it nears it: lifting, it follows the body) and
 * turns to its normal as it nears it, the pelvis drops (`rootPos.y`) as far as the lower foot needs to reach with the
 * animation's knee bend, and with a `state`, a foot in `stance` stays locked where it landed. Run it on each tick's
 * fresh pose, after the animation. Runs FK; returns the pelvis drop in metres.
 */
export function footPlant(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  probe: GroundProbe,
  options: FootPlantOptions = {},
): number {
  const { state, stance, dt = SIM_DT, floor = pose.rootPos.y, steps = false, treadmill, release, levels } = options;
  const rolls = state !== undefined && options.rolls === true;
  const stride = rolls && !steps; // in its stride, a free foot keeps its animation's roll: a toe-off
  const loosen = options.stride ?? 0;
  const [sole, ankle, hip, knee, at, normal, turnUp, base] = v;
  let drop = 0;
  for (let side = 0; side < 2; side++) {
    const [foot, contact, thigh, shin, toe] = SIDES[side];
    const plan = plans[side];
    socketPosition(skeleton, world, contact, sole);
    const lift = Math.max(0, sole.y - floor);
    const ball = jointPosition(world, toe, tip).y - PROPORTIONS.ballHeight * skeleton.build.ankleHeight * skeleton.build.size * pose.rootScale.y; // prettier-ignore
    at.set(sole.x, Math.max(sole.y, floor) + FOOT_PLANT.up, sole.z);
    plan.hit = probe(at, FOOT_PLANT.up + lift + FOOT_PLANT.down, hit);
    if (!plan.hit) continue;
    let align = 1 - MathUtils.clamp(lift / FOOT_PLANT.liftFade, 0, 1);
    // over ground below the floor, a lifting sole follows the body (a trailing foot clears the step it leaves)
    at.set(sole.x, lift + (hit.point.y < floor ? MathUtils.lerp(floor, hit.point.y, align) : hit.point.y), sole.z);
    normal.copy(hit.normal).normalize();
    base.copy(hit.point); // the ground the sole stands on: under its animation, or under its lock as that holds
    plan.held = 0;
    jointRotation(world, foot, plan.rotation);
    const keep = q[2].identity(); // a held foot's heading, kept from where it locked: a turn about the vertical
    if (state) {
      // a held sole stays on the ground under it as that moves (the body's floor, a platform)
      const lock = state.feet[side];
      const from = v[13].set(lock.point.x, lock.point.y + FOOT_PLANT.up, lock.point.z);
      const found = lock.weight > 0 && probe(from, FOOT_PLANT.up + FOOT_PLANT.down, beneath);
      const moved = found ? beneath.point.y - lock.point.y : 0;
      if (!levels || Math.abs(moved) <= FOOT_PLANT.rough) lock.point.y += moved; // never onto another level
      if (floor - lock.point.y > FOOT_PLANT.down) lock.weight = 0; // further down than a foot follows: the body left it
      // in its stride, easing out of it as the body stops, held, or in stance with its heel clearly up (a deep crouch),
      // a foot whose heel its animation lifts is down while its ball is: the sole between rises
      const down = -v[13].set(0, 0, 1).applyQuaternion(jointRotation(world, foot, q[0])).y; // its toes', as a sine
      const stands = stance?.[side] === true && down > FOOT_PLANT.heelUp; // a stance foot's heel clearly lifted
      const rolled = rolls && down > 0.02 && (stride || loosen > 0 || lock.weight === 1 || stands);
      const bottom = Math.max(0, (rolled ? Math.min(sole.y, ball) : sole.y) - floor); // its sole under the ball
      const how = { held: stance?.[side] === true, steps, ground: hit.point.y, lift, bottom, toeOff: stride, dt, treadmill, release, rotation: plan.rotation }; // prettier-ignore
      const held = (plan.held = holdFoot(lock, state.feet[1 - side], at, normal, how));
      align = Math.max(align, held);
      base.y = MathUtils.lerp(base.y, lock.point.y, held);
      const turn = heading(lock.turn) - heading(plan.rotation); // about the vertical, the shorter way round
      keep.setFromAxisAngle(UP, (turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI))) * held);
    }
    plan.align = align;
    // the foot turns about its sole onto the ground, and the ankle follows: flat on it as it nears it, or with locks,
    // flat while held fully (it rolls below) and else, in its stride, tilted with the ground, keeping its animation's
    // roll: the rolls agree, so a lock letting go eases only the sole's place and heading
    const animAhead = v[11].set(0, 0, 1).applyQuaternion(plan.rotation); // where its animation points it
    plan.rotation.premultiply(keep);
    const flat = q[4].setFromUnitVectors(turnUp.copy(UP).applyQuaternion(plan.rotation), normal);
    const onto = q[0].identity();
    if (rolls && plan.held === 1) onto.copy(flat);
    else if (stride) onto.slerp(q[5].setFromUnitVectors(UP, normal), align);
    else onto.slerp(flat, align);
    onto.multiply(keep);
    plan.rotation.premultiply(q[3].copy(onto).multiply(q[1].copy(keep).invert()));
    jointPosition(world, foot, ankle);
    plan.ankle.subVectors(ankle, sole).applyQuaternion(onto).add(at);
    // the heel and the toe tip, turned with the foot, kept on or above the ground: a releasing lock holds the sole
    // lower than the animation lifts it, which would tip the toe under the floor; with locks, the ball's sole too
    let under = 0;
    const points = [heelPosition(skeleton, world, side, heel), tipPosition(skeleton, world, toe, tip)];
    if (rolls) points.push(heelPosition(skeleton, world, side, v[12], PROPORTIONS.ball));
    for (const point of points) {
      point.sub(sole).applyQuaternion(onto).add(at);
      under = Math.max(under, depth.subVectors(base, point).dot(normal));
    }
    // Stryker disable next-line ConditionalExpression,EqualityOperator: under is never below 0, and adding 0 moves nothing: the guard only spares the sums
    if (under > 0) plan.ankle.y += under / Math.max(normal.y, 0.5);
    plan.pitch = 0;
    if (rolls && plan.held === 1) {
      // held, it lies flat and rolls as far as its animation rolls it (the heel up about the ball, the toes up about
      // the heel), for the drop to see; `liftHeel` settles the roll on this leg
      plan.flat.copy(plan.rotation);
      jointPosition(world, toe, plan.ball).sub(sole).applyQuaternion(onto).add(at);
      plan.heel.copy(heel); // the heel's place, as the check above turned it
      // Stryker disable next-line ConditionalExpression,EqualityOperator: under is never below 0, and adding 0 moves nothing: the guard only spares the sums
      if (under > 0) [plan.ball.y, plan.heel.y] = [plan.ball.y + under / Math.max(normal.y, 0.5), plan.heel.y + under / Math.max(normal.y, 0.5)]; // prettier-ignore
      pitchHeel(plan, Math.asin(MathUtils.clamp(-animAhead.dot(normal), -1, 1))); // its toes' dip, or their rise
    }
    // the drop this foot needs to reach its ankle target, as straight as the animation has it, the leg longer by as far
    // as a lock holds the foot out from where its animation puts it: a body braking past a held foot straightens the
    // leg behind it, never sinks to its ankle
    jointPosition(world, thigh, hip);
    jointPosition(world, shin, knee);
    const reach = (plan.reach = hip.distanceTo(knee) + knee.distanceTo(ankle) - 2 * SLACK);
    const across = Math.hypot(plan.ankle.x - hip.x, plan.ankle.z - hip.z);
    const astray = Math.max(0, across - Math.hypot(ankle.x - hip.x, ankle.z - hip.z)) * plan.held;
    const extent = Math.min(hip.distanceTo(ankle) + astray, reach);
    const below = hip.y - plan.ankle.y;
    // Stryker disable next-line EqualityOperator: at across = extent the root is 0, so either side of the test drops by below
    drop = Math.max(drop, align * (across < extent ? below - Math.sqrt(extent * extent - across * across) : below));
  }
  pose.rootPos.y -= drop;
  forwardKinematics(skeleton, pose, world);
  for (const [side, plan] of plans.entries()) {
    plan.pole = state && plan.hit && plan.align > 0 ? kneePole(skeleton, pose, world, side, plan.foot, FOOT_PLANT.bend, plan.poleAt) : undefined; // prettier-ignore
    if (!plan.hit) continue;
    // a free foot out of the leg's reach, the pelvis dropped no further for it, rises over its place to where the leg
    // reaches: never dragged across the floor along the leg's line (through the riser of a step it leaves)
    const hip = jointPosition(world, SIDES[side][2], v[6]);
    const across = Math.hypot(plan.ankle.x - hip.x, plan.ankle.z - hip.z);
    if (plan.held < 1 && across < plan.reach) plan.ankle.y = Math.max(plan.ankle.y, hip.y - Math.sqrt(plan.reach * plan.reach - across * across)); // prettier-ignore
    twoBoneRot(skeleton, pose, world, plan.foot, plan.ankle, plan);
    if (stride && plan.pole && plan.held === 1) liftHeel(skeleton, pose, world, side, plan, loosen); // as it rolled
    if (rolls && plan.held === 1) layToes(skeleton, pose, world, side, plan);
  }
  return drop;
}

/** The `FootPlant` layer's options. */
export interface FootPlantLayerOptions {
  /** Its name in the animator ('footPlant'). */
  name?: string;
}

/**
 * The foot plant as the animator's last `post` layer (see the file comment): each tick, the feet stand on a flat floor
 * at the body's height, or on `ground`. For a body that says when each foot stands (the humanoid's `stance()`: a
 * `plantedStride` build on its feet, WP 13.10), a foot in stance locks where it landed until its contact window ends,
 * then lets go (locks.ts `FOOT_LOCK`); below a step's pace a foot astray steps back under it; a body told to run in
 * place carries its locks on the treadmill. For the others it keeps nothing between ticks and locks no foot. View
 * state only.
 */
export class FootPlant implements AnimLayer {
  readonly name: string;
  weight = 1;
  /** It ends the `post` slot: layers added after it go before it (`Animator.use`). */
  readonly last = true;
  /** Whether a foot in stance may lock now: the view clears it as the body slides, flies, mantles, climbs or rides. */
  locks = true;
  /**
   * The physics ground (`queryGround`), where the view has it (WP 13.10): a sole stands on it where it lies within
   * `FOOT_PLANT.slope` and `rough` of the body's floor (a ramp, a stair), else, and without it, on a flat floor there;
   * a body in the air (its `air` weight) leaves it for the flat floor at its feet, as it was before.
   */
  ground: GroundProbe | null = null;
  #floor = 0;
  #drop = 0;
  readonly #at = new Vector3();
  readonly #treadmill = new Vector3();
  /** How much the physics ground counts now: 1 on the ground, 0 in the air. */
  #settle = 1;
  /** The stance locks, for a body that says when its feet stand. */
  #state = createFootPlantState();
  /** The ground as the plant stands a sole on it (see `ground`): hit when a ray starting on or above it reaches it. */
  readonly #probe: GroundProbe = (origin, distance, ground) => {
    const { x, z } = this.#at;
    const band = FOOT_PLANT.slope * Math.hypot(origin.x - x, origin.z - z) + FOOT_PLANT.rough;
    const found = this.#settle > 0 && this.ground?.(origin, distance, ground) === true;
    if (found && Math.abs(ground.point.y - this.#floor) <= band) {
      ground.point.y = MathUtils.lerp(this.#floor, ground.point.y, this.#settle);
      ground.normal.lerp(UP, 1 - this.#settle).normalize();
      return true;
    }
    ground.point.set(origin.x, this.#floor, origin.z);
    ground.normal.copy(UP);
    return origin.y >= this.#floor && origin.y - this.#floor <= distance;
  };

  constructor(options: FootPlantLayerOptions = {}) {
    this.name = options.name ?? 'footPlant';
  }

  /** Adds it at the end of `animator`'s `post` slot, where it stays as Actions or others are added after it. */
  attach(animator: Animator): this {
    animator.use('post', this);
    return this;
  }

  /** Plants the feet of the pose so far on the floor at the body's height, locking those in stance. */
  apply(animator: Animator): void {
    const { skeleton, pose, world, position, dt } = animator.body;
    this.#floor = position.y;
    this.#at.copy(position);
    this.#settle = 1 - MathUtils.clamp(animator.body.state.weights.air, 0, 1);
    const stance = animator.body.stance();
    const held = this.locks ? stance : stance && ([false, false] as const);
    const steps = animator.body.state.weights.speed < PLANTED.start; // standing or stopping: a foot astray steps back
    const treadmill = animator.body.treadmill(this.#treadmill);
    const rolls = onFeet(animator.body.state.weights);
    const release = rolls ? undefined : 0; // an action takes the feet at once
    const levels = this.ground !== null && this.#settle > 0;
    const stride = plantedEase(Math.min(1, animator.body.state.weights.speed));
    const locks = held ? { state: this.#state, stance: held, dt, steps, treadmill, release, levels, rolls, stride } : {}; // prettier-ignore
    this.#drop = footPlant(skeleton, pose, world, this.#probe, { floor: this.#floor, ...locks });
  }

  /** The height a sole at `x`, `z` stands on as the last plant found the ground (see `ground`), m. */
  floorAt(x: number, z: number): number {
    const top = this.#floor + FOOT_PLANT.up + FOOT_PLANT.slope * Math.hypot(x - this.#at.x, z - this.#at.z);
    return this.#probe(new Vector3(x, top, z), top - this.#floor + FOOT_PLANT.down, hit) ? hit.point.y : this.#floor;
  }

  /**
   * Forgets its locks: what holds the legs while it is skipped (its weight 0: a traversal, WP 13.11) calls it, so it
   * never comes back holding a foot where it stood before.
   */
  reset(): this {
    this.#state = createFootPlantState();
    return this;
  }

  /** The last pelvis drop, m. */
  inspect(): { drop: number } {
    return { drop: this.#drop };
  }
}
