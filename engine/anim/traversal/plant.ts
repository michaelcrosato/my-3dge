/**
 * @file The traversal plant (PLAN.md WP 13.11, docs/PLAYGROUND.md §5.1): the layer that poses a traversing body at the
 * end of the animator's `post` slot, after the foot plant (engine/anim/footPlant.ts), from the view's
 * `TraversalPose` (engine/anim/traversal/pose.ts), which the view sets on it before each pose (`pose`):
 * - the body: a skydive tilted onto its front (spread in its glide, its arms back in its dive), upright again in its
 *   landing pose; drawn `TRAVERSAL_PLANT.ladder` nearer a ladder than its hull stands; and moved toward the hands as
 *   far as they need to reach what they hold (a mantle's press up past the lip, a high grab, a short build's cable);
 * - the free limbs: a mantle's legs hanging under the lip, the grab's right foot stepping up the face late in it and
 *   the pull's left after it, each onto the top as the hip rises past the lip; a low ledge's legs tucked (swung aside
 *   in a vault); a zipline's legs swinging with the ride; the skydive's spread, dive and landing; a slide-jump's legs
 *   out ahead, reaching down as it falls, its arms forward and up;
 * - the limbs on contacts (`TraversalPose.targets`): each hand's grip socket and each foot's contact socket solved onto
 *   its target as far as its weight says (the knees forward, the elbows down and out under a hand over the shoulder,
 *   back behind one under it), the wrist in line with the forearm, flat on a top, a foot level on a hold or a rung;
 *   each leg kept out of the wall it traverses (engine/anim/traversal/clear.ts); and a hard landing's right hand (the
 *   humanoid's shown `land`, WP 13.10) put down flat on the floor at the bottom of its dip.
 *
 * What it put each limb on, and whether that was its contact, stays in `limbs` for the feel kit's measure (a hand held
 * stays within 3 cm of its contact, §5.1). The view fades the foot plant out as far as the traversal holds the body.
 *
 * Invariants: presentation only: it writes the pose and runs FK, never the sim's state; a body that does not traverse
 * (every weight 0, no hard landing) is left exactly as it was.
 *
 * @example
 * import { Animator } from '../character';
 * import { TraversalPose } from './pose';
 * const hero = new Animator({ build: 'build:adult', clock: 1 });
 * const plant = new TraversalPlant().attach(hero);
 * plant.pose = new TraversalPose(); // updated once a step from the movement model's state
 * @see engine/anim/traversal/plant.test.ts
 */
import { MathUtils, Quaternion, Vector3 } from '../../core/math';
import { B, sideSign, type LimbSide } from '../authoring';
import type { Animator } from '../character';
import { forwardKinematics, jointPosition, jointRotation, socketPosition } from '../fk';
import { handTo, twoBoneRot } from '../ik';
import { blendPoses, Pose } from '../pose';
import { boneMask, socketIndex, type JointName } from '../skeleton';
import type { AnimLayer } from '../weights';
import { clearArm, clearLeg, faceOf, keepOff, type Face } from './clear';
import { TRAVERSAL, mantleShare, lowPull } from './contacts';
import { createLimbTargets, layTarget, type LimbTarget } from './limbTargets';
import type { TraversalPose } from './pose';
import { swingGrip } from './swing';

/** The plant's numbers: angles in radians, lengths as shares of the limb's or in metres. */
export const TRAVERSAL_PLANT = {
  glide: (85 * Math.PI) / 180, // a skydive's tilt onto its front: gliding, and diving head down
  dive: (130 * Math.PI) / 180,
  lean: 0.9, // a low ledge's lean in as its hand goes down on the top
  ladder: 0.18, // m: the body drawn this much nearer a ladder than its hull stands
  reach: 0.97, // a held hand's grip is kept within this share of the arm's full reach
  step: [0.5, 0.9], // a grab's right foot comes up onto the top over this share of it…
  trail: 0.4, // …and the pull's left foot up the face by this share of the pull
  landing: [0.55, 0.9], // a hard landing's hand goes down flat on the floor as its dip (land × hard) passes these
  bend: 0.9, // rad: the most the spine bends forward at its base for that hand to reach the floor
  fold: 0.35, // a foot's target never comes nearer its hip than this share of the leg
  ahead: 0.2, // m: that hand goes down this far ahead of its shoulder, flat, its fingers forward
} as const;

const SIDES: readonly LimbSide[] = ['L', 'R'];
const v = Array.from({ length: 8 }, () => new Vector3());
const q = Array.from({ length: 3 }, () => new Quaternion());
/** A limb's weight as it moves it: eased in and out (smoothstep), so a reach starts and lands without a jerk. */
const eased = (weight: number) => MathUtils.smoothstep(weight, 0, 1);
/** The pose before a leg's solve, and each leg's joints: what a leg's solve blends from. */
const before = new Pose();
const LEGS = { L: boneMask('legL'), R: boneMask('legR') } as const;
/** A foot's level rotation, kept through a leg's re-solves, the way a flat hand's fingers lie, and the wall the legs keep out of. */ // prettier-ignore
const flat = new Quaternion();
const wrist = new Quaternion();
const LEVEL = [new Vector3(), new Vector3()];
const LIE = new Vector3();
const FACE: Face = { point: new Vector3(), nx: 0, nz: 1, top: 0 };

/** The traversal plant (see the file comment). */
export class TraversalPlant implements AnimLayer {
  readonly name: string;
  weight = 1;
  /** It ends the `post` slot after the foot plant (engine/anim/footPlant.ts), so a hand it puts down stays down. */
  readonly last = true;
  /** The traversal it poses, set by the view before each pose; null poses nothing. */
  pose: TraversalPose | null = null;
  /** Where the last pose put each limb (left hand, right hand, left foot, right foot) and whether on its contact. */
  readonly limbs: [LimbTarget, LimbTarget, LimbTarget, LimbTarget] = createLimbTargets();

  constructor(options: { name?: string } = {}) {
    this.name = options.name ?? 'traversal';
  }

  /** Adds it at the end of `animator`'s `post` slot: attach it after the foot plant. */
  attach(animator: Animator): this {
    animator.use('post', this);
    return this;
  }

  /** Poses the body as its traversal says (see the file comment). */
  apply(animator: Animator): void {
    const t = this.pose;
    const limbs = this.limbs;
    for (const limb of limbs) [limb.weight, limb.held] = [0, false];
    const body = animator.body;
    const { skeleton, pose, world, position, build: b } = body;
    const landed = body.shown.land * body.shown.hard;
    const traverses = t !== null && (t.weight > 0 || t.walled);
    if (!traverses && !(landed > TRAVERSAL_PLANT.landing[0])) return;
    const w = t?.weights;
    if (t && w) {
      const low = t.lastView('mantle');
      const u = low && lowPull(low) ? mantleShare(low) : NaN; // a low ledge leans in to put a hand on its top
      const lean = u >= 0 ? w.mantle * MathUtils.smoothstep(u, 0, 0.2) * (1 - MathUtils.smoothstep(u, 0.4, 0.8)) * TRAVERSAL_PLANT.lean : 0; // prettier-ignore
      const tilt =
        w.skydive * (1 - t.landing) * MathUtils.lerp(TRAVERSAL_PLANT.glide, TRAVERSAL_PLANT.dive, t.dive) + lean;
      if (tilt > 0) {
        // about its left, through the pelvis (the root stands at the feet): onto its front
        const turn = q[0].setFromAxisAngle(v[0].set(1, 0, 0).applyQuaternion(pose.rootRot), tilt);
        const pelvis = jointPosition(world, 'pelvis', v[1]);
        pose.rootPos.sub(pelvis).applyQuaternion(turn).add(pelvis);
        pose.rootRot.premultiply(turn);
      }
      const ladder = t.ride.ladder;
      if (ladder && w.ladder > 0) pose.rootPos.add(v[0].set(-ladder.normal[0], 0, -ladder.normal[1]).multiplyScalar(TRAVERSAL_PLANT.ladder * w.ladder)); // prettier-ignore
      pose.rootPos.add(t.reach); // toward the lip, as far as the hands need (eased back as they let go)
      forwardKinematics(skeleton, pose, world);
      t.targets(position, limbs);
    }
    // a hand bent flat: hooked over a lip or pressing on a top, its fingers into the wall; flat up a climb's wall
    const level: (Vector3 | null)[] = [null, null];
    const mantle = t?.lastView('mantle');
    if (mantle) level[0] = level[1] = LEVEL[0].set(-(mantle.wallX ?? 0), 0, -(mantle.wallZ ?? 0));
    else if (t && t.weights.climb > 0) level[0] = level[1] = LEVEL[0].set(0, 1, 0);
    if (t) {
      this.#reach(animator, t, level);
      this.#free(animator, t); // from where the body is once it is drawn toward the hands
    }
    if (landed > TRAVERSAL_PLANT.landing[0]) {
      const ahead = v[1].set(0, 0, TRAVERSAL_PLANT.ahead).applyQuaternion(pose.rootRot).setY(0);
      const grip = jointPosition(world, 'upperArmR', v[0])
        .add(ahead)
        .setY(position.y + TRAVERSAL.palm); // ahead of the shoulder
      layTarget(limbs[1], grip, MathUtils.smoothstep(landed, TRAVERSAL_PLANT.landing[0], TRAVERSAL_PLANT.landing[1]), landed >= TRAVERSAL_PLANT.landing[1]); // prettier-ignore
      level[1] = LEVEL[1].set(0, 0, 1).applyQuaternion(pose.rootRot).setY(0);
      this.#bend(
        animator,
        socketPosition(skeleton, world, 'weaponR', v[1]).lerp(limbs[1].point, eased(limbs[1].weight)),
      );
    }
    const face = t ? faceOf(t, FACE) : null; // a wall the limbs keep out of
    for (const side of SIDES) {
      const foot = limbs[side === 'L' ? 2 : 3];
      if (!(foot.weight > 0)) {
        if (face) this.#clearOwn(animator, side, face); // the body's own leg, beside a wall it let go of
        continue;
      }
      before.copy(pose); // a leg's solve blends in by its weight: its knee as the animation has it, then the solve's
      const offset = v[1].fromArray(skeleton.socketOffsets, socketIndex(`contact${side}`) * 3);
      // the knee square to the leg on its front: forward under the hip, up as the foot comes up to the hip ahead; the
      // foot never nearer the hip than a third of the leg (folded flatter, the knee could swing either way)
      const right = B(0, 1, 0, v[4]).applyQuaternion(pose.rootRot);
      const hipAt = jointPosition(world, `thigh${side}`, v[5]);
      const reach = v[3].subVectors(foot.point, hipAt);
      const least = (b.legUpper + b.legLower) * b.size * TRAVERSAL_PLANT.fold;
      if (reach.length() < least) foot.point.copy(hipAt).addScaledVector(reach.lengthSq() > 1e-12 ? reach.normalize() : v[3].set(0, -1, 0), least); // prettier-ignore
      const pole = v[3].subVectors(foot.point, hipAt).normalize().cross(right).negate();
      const landing = t && (t.view?.mode ?? 'ground') !== 'ground' ? t.weights.skydive * t.landing : 0; // a landing pose's feet arrive flat
      const holds = t ? Math.max(t.weights.climb, t.weights.ladder) : 0; // as do a foot's on a hold or a rung
      const level = Math.max(landing, holds, 1 - MathUtils.smoothstep(foot.point.y - position.y, 0.02, 0.2)); // and a foot put on the floor lies on it
      const rotation = level > 0 ? flat.copy(this.#flatFoot(animator, side, level)) : null;
      const solve = (towards: Vector3) => twoBoneRot(skeleton, pose, world, `foot${side}`, foot.point, { offset, pole: towards, ...(rotation ? { rotation } : {}) }); // prettier-ignore
      solve(pole);
      if (face) clearLeg(animator, side, foot.point, pole, solve, face);
      const k = eased(foot.weight);
      if (k < 1) blendPoses(before, pose, k, pose, { mask: LEGS[side] });
      forwardKinematics(skeleton, pose, world);
      if (face && k < 1) this.#clearOwn(animator, side, face); // blended with the body's own leg: that kept clear too
    }
    const arm = (b.armUpper + b.armLower) * b.size;
    for (const side of SIDES) {
      const hand = limbs[side === 'L' ? 0 : 1];
      if (!(hand.weight > 0)) continue;
      const k = eased(hand.weight);
      const grip = swingGrip(animator, side, hand.point, k, v[2]);
      if (face) keepOff(face, grip, TRAVERSAL.palm); // on its way up a wall's face, never through it
      // the elbow down and out under a hand over the shoulder, back and out behind one under it: never along the arm
      const rise = MathUtils.smoothstep((grip.y - jointPosition(world, `upperArm${side}`, v[5]).y) / arm, -0.3, 0.6);
      const pole = B(MathUtils.lerp(-0.5, 0.25, rise), sideSign(side) * 0.6, -1, v[3]).applyQuaternion(pose.rootRot); // prettier-ignore
      handTo(skeleton, pose, world, `hand${side}`, grip, { pole });
      let [lie, share] = [level[side === 'L' ? 0 : 1], k];
      if (face && lie) {
        // near a wall bent flat at once, its fingers off it; up a face under its lip, over the lip onto the top
        const off = (grip.x - face.point.x) * face.nx + (grip.z - face.point.z) * face.nz;
        share = Math.max(k, 1 - MathUtils.smoothstep(off, 0.05, 0.25));
        if (Number.isFinite(face.top)) lie = LIE.set(0, 1, 0).lerp(lie, MathUtils.smoothstep(grip.y - face.top, -0.08, 0.03)).normalize(); // prettier-ignore
      }
      const rotation = wrist.copy(this.#wrist(animator, side, lie, share));
      const solve = (towards: Vector3) =>
        handTo(skeleton, pose, world, `hand${side}`, grip, { pole: towards, rotation });
      solve(pole);
      if (face) clearArm(animator, side, pole, solve, face);
    }
  }

  /** Foot `side`'s world rotation turned `share` (0 to 1) of the way to level: its toes along the ground. */
  #flatFoot(animator: Animator, side: LimbSide, share: number): Quaternion {
    const { world } = animator.body;
    const toes = jointPosition(world, `toe${side}`, v[6]).sub(jointPosition(world, `foot${side}`, v[7]));
    const now = jointRotation(world, `foot${side}`, q[1]);
    if (toes.lengthSq() < 1e-12) return now;
    toes.normalize();
    const level = v[7].set(toes.x, 0, toes.z);
    if (level.lengthSq() < 1e-9) return now;
    return now.premultiply(q[2].setFromUnitVectors(toes, level.normalize()).slerp(q[0].identity(), 1 - share));
  }

  /** Keeps leg `side` as the pose has it out of `face`, its foot where it is, its knee swung off (clear.ts). */
  #clearOwn(animator: Animator, side: LimbSide, face: Face): void {
    const { skeleton, pose, world } = animator.body;
    const offset = v[1].fromArray(skeleton.socketOffsets, socketIndex(`contact${side}`) * 3);
    const at = socketPosition(skeleton, world, `contact${side}`, v[2]);
    const rotation = flat.copy(jointRotation(world, `foot${side}`, q[0]));
    const hip = jointPosition(world, `thigh${side}`, v[5]);
    const line = jointPosition(world, `foot${side}`, v[3]).sub(hip).normalize();
    const bend = jointPosition(world, `shin${side}`, v[4]).sub(hip);
    bend.addScaledVector(line, -bend.dot(line)); // the knee's way off the line from the hip to the ankle
    if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1).applyQuaternion(pose.rootRot);
    clearLeg(animator, side, at, bend.normalize(), (towards) => twoBoneRot(skeleton, pose, world, `foot${side}`, at, { offset, pole: towards, rotation }), face); // prettier-ignore
  }

  /**
   * Bends the spine forward at its base (never the root: the feet stay planted) just far enough for the right hand's
   * grip to reach `grip`, at most `TRAVERSAL_PLANT.bend`; runs FK.
   */
  #bend(animator: Animator, grip: Vector3): void {
    const { skeleton, pose, world, build: b } = animator.body;
    const reach = (b.armUpper + b.armLower) * b.size * TRAVERSAL_PLANT.reach * 0.92; // a margin for the wrist bent flat
    const base = q[1].copy(pose.getRotation('spine0', q[1]));
    const target = v[6].copy(grip);
    const far = (angle: number) => {
      pose.setRotation('spine0', q[2].setFromAxisAngle(v[7].set(1, 0, 0), angle).multiply(base));
      forwardKinematics(skeleton, pose, world);
      return jointPosition(world, 'upperArmR', v[7]).distanceTo(target) > reach;
    };
    if (!far(0)) return;
    let [lo, hi]: number[] = [0, TRAVERSAL_PLANT.bend];
    if (far(hi)) return;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (far(mid)) lo = mid;
      else hi = mid;
    }
    far(hi);
  }

  /**
   * The hand's world rotation: its wrist in line with the forearm, or bent `share` (0 to 1) of the way to the fingers
   * lying along `level`.
   */
  #wrist(animator: Animator, side: LimbSide, level: Vector3 | null, share: number): Quaternion {
    const { world } = animator.body;
    const straight = jointRotation(world, `forearm${side}`, q[1]);
    const along = jointPosition(world, `hand${side}`, v[4]).sub(jointPosition(world, `forearm${side}`, v[5]));
    if (!level || level.lengthSq() < 1e-9 || along.lengthSq() < 1e-9) return straight;
    const bend = q[2].setFromUnitVectors(along.normalize(), v[5].copy(level).normalize());
    return straight.premultiply(bend.slerp(q[0].identity(), 1 - share));
  }

  /** Lays the free limbs' poses for each way (see the file comment). */
  #free(animator: Animator, t: TraversalPose): void {
    const { world, pose, build: b } = animator.body;
    const s = b.size;
    const [leg, arm] = [(b.legUpper + b.legLower) * s, (b.armUpper + b.armLower) * s];
    const [f, r, up] = [v[0].set(0, 0, 1), v[1].set(-1, 0, 0), v[2].set(0, 1, 0)].map((a) => a.applyQuaternion(pose.rootRot)); // prettier-ignore
    const limbs = this.limbs;
    const w = t.weights;
    const view = t.lastView('mantle');
    const aloft = (t.view?.mode ?? 'ground') !== 'ground'; // on the ground the foot plant has the feet
    /** Lays a free foot's pose, off the ground only. */
    const layFoot = (foot: LimbTarget, point: Vector3, weight: number) =>
      layTarget(foot, point, aloft ? weight : 0, false);
    /** A point off joint `joint`: `fwd`, `right` (out to its side) and `upward` metres in the body's frame. */
    const off = (joint: JointName, side: LimbSide, fwd: number, right: number, upward: number, out: Vector3) =>
      jointPosition(world, joint, out).addScaledVector(f, fwd).addScaledVector(r, sideSign(side) * right).addScaledVector(up, upward); // prettier-ignore
    for (const side of SIDES) {
      const [hand, foot] = [limbs[side === 'L' ? 0 : 1], limbs[side === 'L' ? 2 : 3]];
      const [hip, shoulder] = [`thigh${side}`, `upperArm${side}`] as const;
      if (view) {
        const u = mantleShare(view);
        const low = lowPull(view);
        if (!low && view.mantle !== 'none') {
          // hanging near straight under the lip, its toes clear of the face; the right foot steps up the face late in
          // the grab, the left after it in the pull, each onto the top as the hip rises past the lip; then both let go
          const pull = view.mantle === 'pull';
          const [nx, nz, lip] = [view.wallX ?? 0, view.wallZ ?? 0, v[4].set(view.lipX ?? 0, view.lipY ?? 0, view.lipZ ?? 0)]; // prettier-ignore
          const stand = t.toes + TRAVERSAL.palm + 2 * t.hull.skin; // a sole's contact this far out from the lip: its toes a palm off the face
          const point = off(hip, side, -0.04, 0.03, -0.95 * leg, v[3]);
          if (!pull && point.y < (view.fromY ?? point.y) + 0.1) {
            // off the floor it left: its foot back from under the hip as far as it is raised, half again (the knee off
            // the face, never far up it at once), once the body has risen off that floor (not slid back along it)
            const drop = jointPosition(world, hip, v[7]).y - (view.fromY ?? 0) - 0.1;
            const risen = MathUtils.smoothstep(animator.body.position.y - (view.fromY ?? 0), 0, 0.3);
            off(hip, side, -0.04 - risen * Math.min(0.4, 1.5 * Math.max(0, 0.95 * leg - drop)), 0.03, -drop, point);
          }
          const out = (point.x - lip.x) * nx + (point.z - lip.z) * nz;
          if (point.y < lip.y && out < stand) point.set(point.x + nx * (stand - out), point.y, point.z + nz * (stand - out)); // prettier-ignore
          const lead = side === 'R';
          const step = lead ? (pull ? 1 : MathUtils.smoothstep(u, TRAVERSAL_PLANT.step[0], TRAVERSAL_PLANT.step[1])) : pull ? MathUtils.smoothstep(u, 0, TRAVERSAL_PLANT.trail) : 0; // prettier-ignore
          if (step > 0) {
            // up the wall's face, no higher than 0.4 m under the hip, then in onto the top as the hip rises over the
            // lip, lifted over its edge: never through it, never a leg folded flat
            const high = jointPosition(world, hip, v[7]).y;
            const over = v[5].set(lip.x + nx * stand, Math.min(lip.y + 0.08, high - 0.4), lip.z + nz * stand).addScaledVector(r, sideSign(side) * 0.12); // prettier-ignore
            const top = v[6].set(lip.x - nx * 0.18, lip.y + 0.02, lip.z - nz * 0.18).addScaledVector(r, sideSign(side) * 0.12); // prettier-ignore
            const on = MathUtils.smoothstep(high - lip.y, 0.4, 0.75) * MathUtils.smoothstep(step, 0.6, 1);
            point.lerp(over, MathUtils.smoothstep(step, 0, 0.6)).lerp(top, on);
            point.y += 0.08 * Math.sin(Math.PI * on);
          }
          layFoot(foot, point, w.mantle * (pull ? 1 - MathUtils.smoothstep(u, lead ? 0.5 : 0.7, 1) : 1));
        } else if (low) {
          const tuck = Math.sin(Math.PI * u) * w.mantle; // a low ledge's legs tucked, swung aside in a vault
          layFoot(foot, off(hip, side, 0.15, t.vault ? 0.25 * sideSign(side) + 0.05 : 0.04, -0.45 * leg, v[3]), tuck); // prettier-ignore
        }
      }
      if (w.zipline > 0) {
        const down = v[3].copy(up).multiplyScalar(-Math.cos(t.swing)).addScaledVector(f, Math.sin(t.swing));
        layFoot(foot, jointPosition(world, hip, v[4]).addScaledVector(down, 0.88 * leg).addScaledVector(r, sideSign(side) * 0.04), w.zipline); // prettier-ignore
      }
      if (w.skydive > 0) {
        const [glide, dive, land] = [w.skydive * (1 - t.landing) * (1 - t.dive), w.skydive * (1 - t.landing) * t.dive, w.skydive * t.landing]; // prettier-ignore
        layTarget(hand, off(shoulder, side, -0.1, 0.45 * arm, 0.45 * arm, v[3]), glide, false); // spread toward the head
        layFoot(foot, off(hip, side, -0.25, 0.3, -0.75 * leg, v[3]), glide); // knees bent, soles up
        layTarget(hand, off(shoulder, side, -0.12, 0.16, -0.95 * arm, v[3]), dive, false); // arms back along the body
        layFoot(foot, off(hip, side, 0, 0.06, -0.97 * leg, v[3]), dive);
        layTarget(hand, off(shoulder, side, 0, 0.7 * arm, 0.1, v[3]), land, false); // arms out for balance
        const down = off(hip, side, 0.1, 0.08, -0.92 * leg, v[3]);
        layFoot(foot, down.setY(Math.max(down.y, animator.body.position.y + 0.02)), land); // never under the hull's bottom
      }
      if (w.slideJump > 0) {
        // a long jump: the legs out ahead near straight, reaching down for the floor as it falls and the body's own
        // before it lands; the arms forward and up
        const fall = animator.body.shown.fall;
        const ahead = off(hip, side, 0.62 * leg, 0.06, -0.72 * leg, v[3]);
        ahead.lerp(off(hip, side, 0.3 * leg, 0.08, -0.9 * leg, v[4]), MathUtils.smoothstep(fall, 0, 0.4));
        layFoot(foot, ahead, w.slideJump * (1 - MathUtils.smoothstep(fall, 0.4, 0.8)));
        layTarget(hand, off(shoulder, side, 0.7 * arm, 0.06, 0.35 * arm, v[3]), w.slideJump, false);
      }
    }
  }

  /**
   * Moves the body toward the hands as far as their targets are beyond their arms' reach (see the file comment): the
   * arm and the grip in line, or square to it for a hand bent flat (`level`: hooked over a lip, pressing on a top or
   * flat up a wall).
   */
  #reach(animator: Animator, t: TraversalPose, level: readonly (Vector3 | null)[]): void {
    const { skeleton, pose, world, build: b } = animator.body;
    const w = t.weights;
    const low = t.view?.mode === 'mantle' && lowPull(t.view); // a low ledge's hand holds only while it reaches
    const share = Math.max(low ? 0 : w.mantle, w.climb, w.ladder, w.zipline);
    if (!(share > 0)) return;
    const [arm, grip] = [(b.armUpper + b.armLower) * b.size, v[5].fromArray(skeleton.socketOffsets, socketIndex('weaponR') * 3).length()]; // prettier-ignore
    for (let pass = 0; pass < 2; pass++) {
      for (const side of SIDES) {
        const hand = this.limbs[side === 'L' ? 0 : 1];
        if (!hand.held && !(w.zipline > 0 || w.climb > 0 || w.ladder > 0)) continue; // a mantle's: what `reach` leaves
        const shoulder = jointPosition(world, `upperArm${side}`, v[3]);
        const flat = level[side === 'L' ? 0 : 1] !== null; // bent flat: the grip off the forearm's line
        const reach = (flat ? Math.hypot(arm, grip) : arm + grip) * TRAVERSAL_PLANT.reach;
        const to = v[4].subVectors(hand.point, shoulder);
        const short = to.length() - reach; // short of the whole contact, then as far as the hand holds it: no jerk
        if (!(short > 0)) continue;
        pose.rootPos.addScaledVector(to.normalize(), short * share * eased(hand.weight));
        forwardKinematics(skeleton, pose, world);
      }
    }
  }
}
