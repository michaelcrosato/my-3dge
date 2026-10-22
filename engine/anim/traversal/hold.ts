/**
 * @file Holding and aiming (PLAN.md WP 13.11, docs/PLAYGROUND.md §5.1): the layer that ends the animator's `post` slot,
 * after the traversal plant (engine/anim/traversal/plant.ts), posing what the body does with its look and its weapon
 * from what the view tells it before each pose:
 * - the head and eyes toward the aim (`look`: the heading and pitch the player looks along, from the page's intents;
 *   ADR-0025 amendment 10 sent them here), the neck and the head sharing the turn within their limits
 *   (engine/anim/ik.ts `aim`, its chain without the chest, so the hands on what they hold stay there);
 * - a gun carried (`carry`, as the view says, else the body's weapon `gun`): its stock at the right shoulder, the
 *   right hand on its grip and the left on its handguard (two-hand IK, `handTo`), held low and ready (`HOLD.ready`
 *   below the aim), raised along the aim when aiming down the sights (`aiming`: its sight line through the right eye,
 *   `HOLD.sights`), lowered and turned across the body at a sprint, the hands low (the gait's speed past the run,
 *   `HOLD.sprint`); its barrel follows the aim's pitch and, within `HOLD.yaw` of the body's heading, its yaw, the chest
 *   turning with it (the aim offsets), the hand along the barrel so the muzzle points where the aim does, the left hand
 *   slid back along the handguard to stay in reach (`support`), the gun drawn in past that;
 * - a traversal holding the hands (`busy`: `TraversalPose.weight`), or the traversal plant's hands on a contact
 *   (`contacts`: a hard landing's hand), lowers the hold as far as they hold them, and the head turns half as far.
 * The look comes eased (`LookPose`, stepped once a sim step by whoever draws the body), so the sights take `HOLD.raise`
 * to come up and a look fades as it goes; a gun drawn comes into the hands over `HOLD.draw` by the body's clock, and
 * leaves them as it is holstered (`drawn`; a body that starts with one holds it at once).
 *
 * Invariants: presentation only: it writes the pose and runs FK, never the sim's state; without a look and without a
 * gun it leaves the body as it was.
 *
 * @example
 * import { Animator } from '../character';
 * const hero = new Animator({ build: 'build:adult', weapon: 'gun', clock: 1 });
 * const hold = new HoldPlant().attach(hero);
 * const look = new LookPose(); // once a step: look.update({ yaw: 0, pitch: 0.3, aiming: true }, 1 / 60)
 * hold.look = look.update({ yaw: 0, pitch: 0.3, aiming: true }, 1).look; // fully up: down the sights, 0.3 rad up
 * @see engine/anim/traversal/hold.test.ts
 */
import { MathUtils, Matrix4, Quaternion, Vector3 } from '../../core/math';
import { B } from '../authoring';
import type { Animator } from '../character';
import type { Weapon } from '../poses';
import { forwardKinematics, jointPosition, jointRotation, socketPosition } from '../fk';
import { aim, AIM_CHAIN, handTo } from '../ik';
import { blendPoses, Pose } from '../pose';
import { boneMask, PROPORTIONS } from '../skeleton';
import type { AnimLayer } from '../weights';
import { swingGrip, type TraversalPlant } from './plant';

/** Where the body looks: its heading and pitch (rad, world, up above 0), and whether it aims down the sights. */
export interface Look {
  readonly yaw: number;
  readonly pitch: number;
  readonly aiming?: boolean;
}

/** A look as the hold poses it: eased once a step by `LookPose`, `raised` how far the sights are up, `weight` how much it counts. */ // prettier-ignore
export interface HeldLook {
  readonly yaw: number;
  readonly pitch: number;
  readonly raised: number;
  readonly weight: number;
}

/**
 * The view's eased look of one body: it follows the look the view gives it once a sim step, raising and lowering the
 * sights over `HOLD.raise` and fading in and out as the look comes and goes, so a button never snaps the arms.
 */
export class LookPose {
  /** What the hold poses now, or null before any look. */
  look: HeldLook | null = null;

  /** Follows `look` (null: none) over `dt` seconds; returns itself. */
  update(look: Look | null, dt: number): this {
    const last = this.look;
    const step = dt / HOLD.raise;
    const raised = MathUtils.clamp((last?.raised ?? 0) + (look?.aiming === true ? step : -step), 0, 1);
    const weight = MathUtils.clamp((last?.weight ?? 0) + (look ? step : -step), 0, 1);
    this.look =
      look || last ? { yaw: look?.yaw ?? last!.yaw, pitch: look?.pitch ?? last!.pitch, raised, weight } : null;
    return this;
  }
}

/** The hold's numbers: angles in radians, lengths in metres before the build's size. */
export const HOLD = {
  head: 1, // how much of the look the head takes (a traversal halves it)
  yaw: 0.9, // the gun follows the aim's heading this far either side of the body's…
  twist: 0.7, // …the chest turning this share of the way with it
  ready: 0.45, // held low and ready this far below the aim
  sprint: [0.75, 0.7, 0.15], // at a sprint: this far below level, turned this far across the body, the grip this much lower
  grip: [0.22, 0.06, 0.1], // the right hand's grip: ahead of the shoulder along the barrel, under it, in toward the middle
  sights: [0.17, 0.13], // aiming down the sights, that grip this far along the sight line from the right eye, and under it
  fore: 0.3, // the foregrip this far along the barrel from the grip (the left hand slides back to half that…
  reach: 0.92, // …to stay within this share of its reach, the arm and the grip; the gun comes in past that)
  runSpeed: [1.17, 1.24], // the gait's speed share (of the build's `speedRef`, at most 1.25) over which a run turns into a sprint
  raise: 0.2, // seconds the sights take to come up or down, and a look to come or go
  draw: 0.25, // seconds the hands take to come onto a gun drawn, and to leave one holstered
} as const;

const v = Array.from({ length: 8 }, () => new Vector3());
/** Where each hand goes on the gun this pose (the grip, the foregrip), and where each elbow bends. */
const held = [new Vector3(), new Vector3()];
const poles = [new Vector3(), new Vector3()];
const q = Array.from({ length: 3 }, () => new Quaternion());
const basis = new Matrix4();
const before = new Pose();
const HEAD = boneMask(['neck', 'head']);
/** The look's chain: `AIM_CHAIN` without the chest, so the shoulders, and the hands on what they hold, stay. */
const LOOK = AIM_CHAIN.filter((link) => link.joint !== 'chest');

/** The holding and aiming layer (see the file comment). */
export class HoldPlant implements AnimLayer {
  readonly name: string;
  weight = 1;
  /** It ends the `post` slot after the traversal plant: attach it last. */
  readonly last = true;
  /** Where the body looks now (a `LookPose`'s), set by the view before each pose; null: where its head does. */
  look: HeldLook | null = null;
  /** How much a traversal holds the hands (0 to 1): the hold lowers, the head turns half as far. */
  busy = 0;
  /** The traversal plant before it, whose hands on a contact (a hard landing's too) the gun yields to. */
  contacts: TraversalPlant | null = null;
  /** What the hands carry, as the view says (WP 13.20's weapons); null: the body's own weapon. */
  carry: Weapon | null = null;
  /** Where the last pose aimed the gun's barrel (world, unit), and where it put the left hand on it, when it held one. */ // prettier-ignore
  readonly barrel = new Vector3();
  readonly support = new Vector3();
  /** Whether the last pose held a gun (its hands free enough): the view draws one in the hand (WP 13.20). */
  holding = false;
  /** How far the last pose raised the sights, 0 to 1: first person centres them (WP 13.20). */
  aimed = 0;
  /** How far the hands are on the gun, 0 to 1, eased over `HOLD.draw` as one is drawn and holstered (WP 13.20). */
  drawn = 0;
  /** The body's clock at the last pose: how far `drawn` moves; NaN before the first. */
  #clock = Number.NaN;

  constructor(options: { name?: string } = {}) {
    this.name = options.name ?? 'hold';
  }

  /**
   * Takes up `previous`'s draw (`drawn` and its clock), when one body's hold is made again: the view makes an actor's
   * animator again when its weapon changes (engine/anim/character.ts `AnimatorPool`), so the hands ease on as they were.
   */
  follow(previous: HoldPlant | undefined): this {
    if (previous) [this.drawn, this.#clock] = [previous.drawn, previous.#clock];
    return this;
  }

  /** Adds it at the end of `animator`'s `post` slot: attach it after the traversal plant. */
  attach(animator: Animator): this {
    animator.use('post', this);
    return this;
  }

  /** Turns the head toward the look and holds the gun (see the file comment). */
  apply(animator: Animator): void {
    const body = animator.body;
    const { skeleton, pose, world } = body;
    const look = this.look;
    const hands = this.contacts ? Math.max(this.contacts.limbs[0].weight, this.contacts.limbs[1].weight) : 0;
    const free = 1 - MathUtils.clamp(Math.max(this.busy, hands), 0, 1);
    const wants = (this.carry ?? body.weapon) === 'gun';
    const clock = body.state.clock;
    const first = Number.isNaN(this.#clock) || clock < this.#clock; // the first pose, or a body started again: as it is
    const eased = first ? (wants ? 1 : 0) : this.drawn + ((wants ? 1 : -1) * (clock - this.#clock)) / HOLD.draw;
    this.drawn = eased > 1 - 1e-9 ? 1 : eased < 1e-9 ? 0 : eased; // whole at the draw's time, the steps' sum aside
    this.#clock = clock;
    const gun = this.drawn > 0 && free > 0;
    [this.holding, this.aimed] = [gun, 0];
    const hold = free * this.drawn; // how far the hands are on the gun
    const offset = look ? MathUtils.clamp(angleTo(body.yaw, look.yaw), -HOLD.yaw, HOLD.yaw) * look.weight : 0; // the aim's heading off the body's
    if (gun && offset !== 0) {
      // the chest turned toward the aim's heading, so both hands keep the gun as it swings
      const turn = q[1].setFromAxisAngle(v[0].set(0, 1, 0), offset * HOLD.twist * hold);
      const parent = jointRotation(world, 'spine2', q[2]).invert();
      pose.setRotation('chest', parent.multiply(turn.multiply(jointRotation(world, 'chest', q[0]))));
      forwardKinematics(skeleton, pose, world);
    }
    if (look) {
      const eyes = socketPosition(skeleton, world, 'eyeL', v[0]).add(socketPosition(skeleton, world, 'eyeR', v[1])).multiplyScalar(0.5); // prettier-ignore
      const dir = direction(look.yaw, look.pitch, v[1]);
      before.copy(pose);
      aim(skeleton, pose, world, eyes.addScaledVector(dir, 10), { chain: LOOK });
      blendPoses(before, pose, HOLD.head * (0.5 + 0.5 * free) * look.weight, pose, { mask: HEAD });
      forwardKinematics(skeleton, pose, world);
    }
    if (!gun) return;
    const b = body.build;
    const s = b.size;
    const heading = body.yaw;
    const sprint = MathUtils.smoothstep(body.state.weights.speed, HOLD.runSpeed[0], HOLD.runSpeed[1]);
    const aiming = MathUtils.smoothstep(look?.raised ?? 0, 0, 1) * (1 - sprint);
    this.aimed = aiming;
    const yaw = heading + offset;
    const pitch = (look?.pitch ?? 0) * (look?.weight ?? 0);
    const lowered = MathUtils.lerp(pitch - HOLD.ready, -HOLD.sprint[0], sprint);
    const barrel = direction(MathUtils.lerp(yaw, heading + HOLD.sprint[1], sprint), MathUtils.lerp(lowered, pitch, aiming), this.barrel); // prettier-ignore
    const right = v[2].set(-Math.cos(heading), 0, Math.sin(heading));
    const grip = jointPosition(world, 'upperArmR', v[3])
      .addScaledVector(barrel, HOLD.grip[0] * s)
      .addScaledVector(v[4].set(0, 1, 0), -(HOLD.grip[1] + HOLD.sprint[2] * sprint) * s)
      .addScaledVector(right, -HOLD.grip[2] * s);
    if (aiming > 0) {
      // down the sights: the sight line through the right eye, the grip along it and under it
      const eye = socketPosition(skeleton, world, 'eyeR', v[6]);
      const up = v[7].set(0, 1, 0).addScaledVector(barrel, -barrel.y).normalize(); // up, square to the barrel
      grip.lerp(eye.addScaledVector(barrel, HOLD.sights[0] * s).addScaledVector(up, -HOLD.sights[1] * s), aiming);
    }
    // the left hand on the handguard within its reach: slid back along the barrel, or the gun drawn in when even that
    // is too far
    const shoulder = jointPosition(world, 'upperArmL', v[6]);
    const reach = HOLD.reach * (b.armUpper + b.armLower + PROPORTIONS.grip * b.handLength) * s; // to the left hand's grip
    const rel = v[7].subVectors(grip, shoulder);
    const ahead = rel.dot(barrel);
    const room = ahead * ahead - rel.lengthSq() + reach * reach; // where the barrel's line meets the reach
    const slid = room >= 0 ? Math.min(HOLD.fore * s, -ahead + Math.sqrt(room)) : HOLD.fore * s;
    const fore = this.support.copy(grip).addScaledVector(barrel, Math.max(HOLD.fore * s * 0.5, slid));
    const far = fore.distanceTo(shoulder) - reach;
    if (far > 0) {
      const toward = v[7].subVectors(shoulder, fore).normalize().multiplyScalar(far);
      grip.add(toward);
      fore.add(toward);
    }
    // each hand swung about its shoulder from where the body has it to the gun as far as it is free and drawn, then solved
    const k = MathUtils.smoothstep(hold, 0, 1);
    const [gripR, gripL] = [swingGrip(animator, 'R', grip, k, held[0]), swingGrip(animator, 'L', fore, k, held[1])];
    const relaxed = q[1].copy(jointRotation(world, 'handR', q[1]));
    const [poleR, poleL] = [elbow(pose, 'R', poles[0]), elbow(pose, 'L', poles[1])]; // the elbows down and out
    handTo(skeleton, pose, world, 'handR', gripR, { pole: poleR });
    handTo(skeleton, pose, world, 'handR', gripR, { pole: poleR, rotation: relaxed.slerp(along(animator, barrel), k) });
    // the left hand in line with its arm, its grip ahead of the wrist, so the arm reaches the handguard
    const reaching = v[6].subVectors(gripL, jointPosition(world, 'upperArmL', v[7])).normalize();
    const hand = jointRotation(world, 'handL', q[2]);
    const lined = q[0].setFromUnitVectors(v[7].set(1, 0, 0).applyQuaternion(hand), reaching).multiply(hand); // its +X: the grip's way
    handTo(skeleton, pose, world, 'handL', gripL, { pole: poleL, rotation: hand.slerp(lined, k) });
  }
}

/** Where a gun's elbow `side` bends: a little back, out to its side and mostly down, in the body's frame (world). */
function elbow(pose: Pose, side: 'L' | 'R', out: Vector3): Vector3 {
  return B(-0.3, side === 'R' ? 0.6 : -0.6, -1, out).applyQuaternion(pose.rootRot);
}

/** The unit direction of heading `yaw` and pitch `pitch` (+Z at yaw 0, up above 0), written into `out`. */
function direction(yaw: number, pitch: number, out: Vector3): Vector3 {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/** The signed turn from heading `a` to heading `b`, in (−π, π]. */
function angleTo(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * The right hand's world rotation holding along `barrel`: the hand's +Z on the barrel (as authoring.ts `holdAlong`
 * turns a weapon's blade), its +X square to it on the forearm's side, so the muzzle points where the barrel does.
 */
function along(animator: Animator, barrel: Vector3): Quaternion {
  const { world } = animator.body;
  const forearm = jointPosition(world, 'handR', v[6]).sub(jointPosition(world, 'forearmR', v[7]));
  const side = forearm.addScaledVector(barrel, -forearm.dot(barrel)).negate();
  if (side.lengthSq() < 1e-12) side.set(1, 0, 0);
  side.normalize();
  return q[0].setFromRotationMatrix(basis.makeBasis(side, v[7].crossVectors(barrel, side), barrel));
}
