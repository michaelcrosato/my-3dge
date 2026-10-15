/**
 * @file The post-IK foot plant (PLAN.md WP 3.5, I-11; the animator's `post` slot, WP 3.7, built after G9): `footPlant`
 * stands the feet on probed ground (with a `state`, a foot in stance locks where it landed), and `FootPlant` is the
 * layer that runs it last in the animator's `post` slot, after Actions' effector solve (engine/anim/actions.ts), on a
 * flat floor at the body's height. Moved here from engine/anim/ik.ts with the layer (ADR-0009 amendment 8), so the
 * solvers there stay under 400 lines.
 *
 * The layer locks no foot (ADR-0009 amendment 8): locks in stance fixed 30 of the anim QA's foot slides but held feet
 * where actions had left them (35 loops no longer closed at rest), drifted with the step (19) and flipped knees in
 * deaths and flips (16); a lock needs a rule for stepping out of it, left for a measured need. Fading the plant out as
 * the pelvis tips over (rolls, falls) cost more floor fixes than it saved. Without locks it stands every sole, heel
 * and toe on the floor (the kneel's, crouch's, dash's and guard's sinks) and keeps no state.
 *
 * Where it runs (ADR-0009 amendment 8): the view's puppets (engine/gfx/puppets/actors.ts, faded out under an actor's
 * clips, which plant their own feet) and the anim QA family's humanoids (tools/qa/anim.ts) attach it; the sim's
 * precise-hit posing (engine/sim/actors.ts) does not, so the trail it hashes is the animation's own and the plant stays
 * presentation, as LOD 1 already drops the `post` slot.
 *
 * Invariants: it writes `rootPos.y` (the pelvis drop) and the legs' local rotations, then runs FK; it treats the root
 * scale as uniform; nothing reads a clock or a random stream. The layer keeps nothing between ticks.
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
import {
  forwardKinematics,
  jointPosition,
  jointRotation,
  jointToWorld,
  socketPosition,
  tipPosition,
  type WorldPose,
} from './fk';
import { SLACK, twoBoneRot, type GroundHit, type GroundProbe } from './ik';
import type { Pose } from './pose';
import { PROPORTIONS, type Skeleton } from './skeleton';
import type { AnimLayer } from './weights';

/** Scratch objects, so the plant allocates nothing. */
const v = Array.from({ length: 11 }, () => new Vector3());
const [heel, tip, depth] = [v[8], v[9], v[10]];
const q = [new Quaternion(), new Quaternion()];
const UP = new Vector3(0, 1, 0);

/** A foot's stance lock: the sole `point` and ground `normal` it holds, and its `weight` (1 locked, easing to 0). */
export type FootLock = { weight: number; readonly point: Vector3; readonly normal: Vector3 };

/** What `footPlant` keeps between ticks for one character: the left and right `feet`'s locks, and the last `drop`. */
export type FootPlantState = { readonly feet: readonly [FootLock, FootLock]; drop: number };

/** A new, unlocked `FootPlantState`. */
export function createFootPlantState(): FootPlantState {
  const lock = (): FootLock => ({ weight: 0, point: new Vector3(), normal: new Vector3(0, 1, 0) });
  return { feet: [lock(), lock()], drop: 0 };
}

/** `footPlant`'s tuning, in metres and seconds. */
export const FOOT_PLANT = {
  up: 0.5, // how far above the sole the probe starts: the highest step a foot finds
  down: 0.6, // how far below the root the probe reaches: the deepest drop a foot follows
  liftFade: 0.1, // the sole height over which a lifting foot stops turning to the ground and pulling the pelvis down
  release: 0.15, // seconds a lock takes to let go once the stance ends
  maxSlide: 0.3, // how far a locked sole may trail its animation before it locks again where the animation is
  rise: 1, // metres per second the pelvis rises back after a drop (it drops at once)
} as const;

/** How `footPlant` plants. */
export interface FootPlantOptions {
  /** Locks and the pelvis drop kept between ticks; without it, nothing locks and nothing is smoothed. */
  state?: FootPlantState;
  /** Whether each foot (left, right) is in stance this tick: a foot in stance locks where it lands. */
  stance?: readonly [boolean, boolean];
  /** The tick's length in seconds; `SIM_DT` by default. */
  dt?: number;
  /**
   * The floor the animation stands on, world metres: a sole's lift is measured from it and the probe starts above it.
   * By default `pose.rootPos.y`, right for a pose whose root rests on the floor; a crouch or a kneel lowers the root,
   * so pass the body's floor (the `FootPlant` layer passes its position's height).
   */
  floor?: number;
}

/** Where the back of a foot's sole is (world, m), as the anim checks read it: under the ankle, behind it. */
function heelPosition(skeleton: Skeleton, world: WorldPose, side: number, out: Vector3): Vector3 {
  const b = skeleton.build;
  out.set(0, -b.ankleHeight * b.size, -PROPORTIONS.heel * b.footLength * b.size);
  return jointToWorld(world, side === 0 ? 'footL' : 'footR', out, out);
}

const SIDES = (['L', 'R'] as const).map(
  (s) => [`foot${s}`, `contact${s}`, `thigh${s}`, `shin${s}`, `toe${s}`] as const,
);
/** Each foot's plan for this tick: whether the probe hit, the ankle's target and the foot's world rotation. */
const plans = SIDES.map(([foot]) => ({ foot, hit: false, ankle: new Vector3(), rotation: new Quaternion() }));
const hit: GroundHit = { point: new Vector3(), normal: new Vector3() };

/**
 * Stands the feet on the ground `probe` finds under each sole (the `contact` sockets): each foot keeps its lift above
 * the floor (`options.floor`) over the ground and turns to its normal as it nears it, the pelvis drops (`rootPos.y`) as
 * far as the lower foot needs to reach with the animation's knee bend, and with a `state`, a foot in `stance` stays
 * locked where it landed. Run it on each tick's fresh pose, after the animation. Runs FK; returns the pelvis drop in
 * metres.
 */
export function footPlant(
  skeleton: Skeleton,
  pose: Pose,
  world: WorldPose,
  probe: GroundProbe,
  options: FootPlantOptions = {},
): number {
  const { state, stance, dt = SIM_DT, floor = pose.rootPos.y } = options;
  const [sole, ankle, hip, knee, at, normal, turnUp] = v;
  let drop = 0;
  for (let side = 0; side < 2; side++) {
    const [foot, contact, thigh, shin, toe] = SIDES[side];
    const plan = plans[side];
    socketPosition(skeleton, world, contact, sole);
    const lift = Math.max(0, sole.y - floor);
    at.set(sole.x, Math.max(sole.y, floor) + FOOT_PLANT.up, sole.z);
    plan.hit = probe(at, FOOT_PLANT.up + lift + FOOT_PLANT.down, hit);
    if (!plan.hit) continue;
    at.set(sole.x, hit.point.y + lift, sole.z);
    normal.copy(hit.normal).normalize();
    let align = 1 - MathUtils.clamp(lift / FOOT_PLANT.liftFade, 0, 1);
    const lock = state?.feet[side];
    if (lock) {
      if (stance?.[side]) {
        if (lock.weight < 1 || lock.point.distanceTo(at) > FOOT_PLANT.maxSlide) {
          lock.point.copy(at);
          lock.normal.copy(normal);
        }
        lock.weight = 1;
      } else lock.weight = Math.max(0, lock.weight - dt / FOOT_PLANT.release);
      at.lerp(lock.point, lock.weight);
      normal.lerp(lock.normal, lock.weight).normalize();
      align = Math.max(align, lock.weight);
    }
    // the foot turns about its sole onto the ground, and the ankle follows
    jointRotation(world, foot, plan.rotation);
    const onto = q[0].setFromUnitVectors(turnUp.copy(UP).applyQuaternion(plan.rotation), normal);
    onto.slerp(q[1].identity(), 1 - align);
    plan.rotation.premultiply(onto);
    jointPosition(world, foot, ankle);
    plan.ankle.subVectors(ankle, sole).applyQuaternion(onto).add(at);
    // the heel and the toe tip, turned with the foot, kept on or above the ground: a releasing lock holds the sole
    // lower than the animation lifts it, which would tip the toe under the floor
    let under = 0;
    for (const point of [heelPosition(skeleton, world, side, heel), tipPosition(skeleton, world, toe, tip)]) {
      point.sub(sole).applyQuaternion(onto).add(at);
      under = Math.max(under, depth.subVectors(hit.point, point).dot(hit.normal));
    }
    if (under > 0) plan.ankle.y += under / Math.max(hit.normal.y, 0.5);
    // the drop this foot needs to reach its ankle target, as straight as the animation has it
    jointPosition(world, thigh, hip);
    jointPosition(world, shin, knee);
    const reach = hip.distanceTo(knee) + knee.distanceTo(ankle) - 2 * SLACK;
    const extent = Math.min(hip.distanceTo(ankle), reach);
    const across = Math.hypot(plan.ankle.x - hip.x, plan.ankle.z - hip.z);
    const below = hip.y - plan.ankle.y;
    drop = Math.max(drop, align * (across < extent ? below - Math.sqrt(extent * extent - across * across) : below));
  }
  drop = state ? Math.max(drop, state.drop - FOOT_PLANT.rise * dt) : drop;
  if (state) state.drop = drop;
  pose.rootPos.y -= drop;
  forwardKinematics(skeleton, pose, world);
  for (const plan of plans) if (plan.hit) twoBoneRot(skeleton, pose, world, plan.foot, plan.ankle, plan);
  return drop;
}

/** The `FootPlant` layer's options. */
export interface FootPlantLayerOptions {
  /** Its name in the animator ('footPlant'). */
  name?: string;
}

/**
 * The foot plant as the animator's last `post` layer (see the file comment): each tick, the feet stand on a flat floor
 * at the body's height. It keeps nothing between ticks, so it locks no foot and gives the same pose at any step.
 * View state only.
 */
export class FootPlant implements AnimLayer {
  readonly name: string;
  weight = 1;
  /** It ends the `post` slot: layers added after it go before it (`Animator.use`). */
  readonly last = true;
  #floor = 0;
  #drop = 0;
  /** A flat floor at `#floor`: hit when the ray starts on or above it and reaches it. */
  readonly #probe: GroundProbe = (origin, distance, ground) => {
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

  /** Plants the feet of the pose so far on the floor at the body's height. */
  apply(animator: Animator): void {
    const { skeleton, pose, world, position } = animator.body;
    this.#floor = position.y;
    this.#drop = footPlant(skeleton, pose, world, this.#probe, { floor: this.#floor });
  }

  /** The last pelvis drop, m. */
  inspect(): { drop: number } {
    return { drop: this.#drop };
  }
}
