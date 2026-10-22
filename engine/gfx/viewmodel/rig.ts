/**
 * @file The viewmodel's arms rig (PLAN.md WP 13.12, docs/PLAYGROUND.md §4): first person's arms posed against the
 * camera, as games pose a viewmodel. Its skeleton, the player's build, stands upright under the camera, its eyes at the
 * camera's eye and its heading the camera's, so its shoulders sit just under and behind the eye whatever the body does
 * (the body's own, which the camera's profile height leaves 0.1 to 1.4 m away in a slide, a mantle or a skydive, could
 * not reach the picture). Each hand's grip (`weaponL`, `weaponR`) goes to a place in the camera's frame (`ARMS`): fists
 * up at rest, pumping with the gait's phase in a sprint, out for balance in a slide, raised in the air; a little bob on
 * the view effects' weapon bob (engine/gfx/cameras/effects.ts), a breath, and a sway behind the look's turn. A hand the
 * body holds on a contact (a ledge in a mantle, the wall in a climb, a rung, the cable, the floor) goes where the body's
 * is, as far as it holds it, and a carried gun where the body holds it from its eyes; then every hand is kept on the
 * arms' frame (lens.ts `intoArmsFrame`) and drawn along its ray within the arm's reach (the arms are drawn at their own
 * depth anyway, so only the ray shows). A punch throws its fist where the body's goes from its eyes (WP 13.19), and a
 * kick shows its leg: the body's right leg as it kicks, under the rig's hips. `armsInputOf` reads what the rig needs
 * off the player's animator and its traversal plant.
 *
 * Invariants: presentation only: it reads the body and the camera and writes its own pose; pure but for its own state
 * (the eased shares, the sway, the last look); the shown parts (`shown`) are the arms (and the kicking leg) bar any
 * part nearer the eye than `VIEWMODEL.cull`.
 *
 * @example
 * import { makePose } from '../cameras/pose';
 * const rig = new ArmsRig('build:adult');
 * const camera = makePose({ position: [0, 1.52, 0], fov: 74, near: 0.05 }); // facing +Z
 * rig.update(camera, { player: null, effects: null, phase: 0, clock: 0, held: [null, null], kick: null, gun: null, aspect: 16 / 9 }, 1 / 60); // prettier-ignore
 * rig.hands[1].z > 0.3; // true: the right fist in front of the eye
 * rig.shown; // ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR']
 * @see engine/gfx/viewmodel/rig.test.ts
 */
import type { Animator } from '../../anim/character';
import {
  createWorldPose,
  forwardKinematics,
  jointPosition,
  jointRotation,
  socketPosition,
  tipPosition,
} from '../../anim/fk';
import { handTo } from '../../anim/ik';
import { Pose } from '../../anim/pose';
import { createSkeleton, JOINTS, PARENTS, socketIndex, type JointName, type Skeleton } from '../../anim/skeleton';
import type { Build } from '../../anim/builds';
import type { TraversalPlant } from '../../anim/traversal/plant';
import { angDiff, MathUtils, Quaternion, Vector3 } from '../../core/math';
import type { CameraPlayer, EffectsFrame } from '../cameras/effects';
import { eyePoint, FIRST_ARMS, FIRST_KICK, nearBodyCull } from '../cameras/first';
import { poseForward, poseRight, poseUp, type CameraPose, type Vec3 } from '../cameras/pose';
import { intoArmsFrame, VIEWMODEL } from './lens';

/** Places in the camera's frame, `[right, up, forward]`, m for a build of size 1 (the right hand's; the left's mirrored). */ // prettier-ignore
type Place = readonly [number, number, number];

/** The rig's numbers (see the file comment): places, metres, seconds. */
export const ARMS = Object.freeze({
  ready: [0.13, -0.13, 0.4] as Place,
  /** A sprint's fists, and their pump forward and up over the gait's phase. */
  sprint: [0.17, -0.2, 0.34] as Place,
  pump: [0.08, 0.08] as const,
  /** A slide's hands: the right low and back, the left out ahead. */
  slide: [0.22, -0.24, 0.32] as Place,
  slideLeft: [-0.25, -0.17, 0.43] as Place,
  air: [0.16, -0.08, 0.38] as Place,
  /** The breath's rise (m) and rate (rad/s); the weapon bob's sway across and dip (m) at its full share. */
  breath: [0.004, 1.6] as const,
  bob: [0.008, 0.012] as const,
  /** The sway: m per rad/s of the look's turn, the most, and its lag (s). */
  sway: [0.012, 0.04, 0.08] as const,
  /** S: the states ease in and out. */
  ease: 0.1,
  /** The elbow's way in the camera's frame (the right arm's): out, down and a little back. */
  pole: [0.55, -1, -0.25] as Place,
  /** How far out on the arms' frame a hand's grip may go, a share of the half-frame: a lowered fist half shows. */
  margin: 0.95,
  /** The share of the arm's reach a hand is drawn within, and the nearest it comes to the eye (m). */
  reach: 0.95,
  nearest: 0.22,
});

/** A hand the body holds on something: where its grip is (world), its world rotation, and how much it holds (0 to 1). */ // prettier-ignore
export interface HeldHand {
  readonly point: Vector3;
  readonly rotation: Quaternion;
  readonly weight: number;
}

/** What the rig poses the arms from, beside the camera (see `armsInputOf`). */
export interface ArmsInput {
  /** What the player does (`cameraPlayer`): its sprint, slide and air. */
  readonly player: CameraPlayer | null;
  /** The view effects' frame: the weapon bob's phase and share. */
  readonly effects: EffectsFrame | null;
  /** The body's gait phase (rad, a step every π) and its breathing clock (s). */
  readonly phase: number;
  readonly clock: number;
  /** Each hand, left then right, the body holds on a contact; null for a free one. */
  readonly held: readonly [HeldHand | null, HeldHand | null];
  /** A kick: the body's right leg's local rotations (`FIRST_KICK`) and how much it shows (0 to 1). */
  readonly kick: { readonly local: readonly Quaternion[]; readonly weight: number } | null;
  /** A carried gun: each grip (left, right) from the body's eyes (world, m), and how much the body holds it. */
  readonly gun: { readonly grips: readonly [Vector3, Vector3]; readonly weight: number } | null;
  /** A punch: each striking fist's grip (left, right; null for a hand at rest) from the body's eyes, and its share. */
  readonly punch?: { readonly grips: readonly [Vector3 | null, Vector3 | null]; readonly weight: number } | null;
  /** The picture's aspect, and the arms' lens (vertical degrees; `VIEWMODEL.fov`). */
  readonly aspect: number;
  readonly fov?: number;
}

const v = Array.from({ length: 8 }, () => new Vector3());
/** Each joint's children, by index. */
const CHILDREN = JOINTS.map((_, j) => PARENTS.flatMap((parent, child) => (parent === j ? [child] : [])));
const q = Array.from({ length: 3 }, () => new Quaternion());
const UP = new Vector3(0, 1, 0);

/** `place` in `camera`'s frame, mirrored to `side`, scaled by `size`, as a world point. */
function cameraPoint(camera: CameraPose, place: Place, sign: number, size: number, out: Vector3): Vector3 {
  const [r, u, f] = [poseRight(camera), poseUp(camera), poseForward(camera)];
  const [x, y, z] = [place[0] * sign * size, place[1] * size, place[2] * size];
  return out.set(...camera.position).add(v[7].set(r[0] * x + u[0] * y + f[0] * z, r[1] * x + u[1] * y + f[1] * z, r[2] * x + u[2] * y + f[2] * z)); // prettier-ignore
}

/** `a` eased `k` of the way to `b`, per axis. */
const mix = (a: Place, b: Place, k: number): Place => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; // prettier-ignore

/** First person's arms posed against the camera (see the file comment). */
export class ArmsRig {
  readonly skeleton: Skeleton;
  readonly pose = new Pose();
  readonly world = createWorldPose();
  /** The grips after the last update, left then right (world, m). */
  readonly hands: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** The parts the last update showed (see the file comment). */
  shown: JointName[] = [];
  readonly #eye: Vector3;
  /** The arm's reach to its grip, and to its wrist (m). */
  readonly #reach: [number, number];
  readonly #shares = { sprint: 0, slide: 0, air: 0 };
  readonly #sway: [number, number] = [0, 0];
  #look: { yaw: number; pitch: number } | null = null;

  constructor(build: Build | string) {
    this.skeleton = createSkeleton(build);
    const rest = forwardKinematics(this.skeleton, this.pose, this.world);
    this.#eye = new Vector3(...eyePoint(this.skeleton, rest));
    const { lengths, socketOffsets } = this.skeleton;
    const at = socketIndex('weaponR') * 3;
    const grip = Math.hypot(socketOffsets[at], socketOffsets[at + 1], socketOffsets[at + 2]);
    const arm = lengths[JOINTS.indexOf('forearmR')] + lengths[JOINTS.indexOf('handR')];
    this.#reach = [arm + grip, arm];
  }

  /** Poses the arms against `camera` from `input` after a frame of `dt` real seconds (see the file comment). */
  update(camera: CameraPose, input: ArmsInput, dt: number): this {
    const { skeleton, pose, world } = this;
    const size = skeleton.build.size;
    const player = input.player;
    const k = dt > 0 ? 1 - Math.exp(-dt / ARMS.ease) : 1;
    const air = player !== null && !player.grounded && player.mode === 'air';
    const want = { sprint: player?.sprinting && !player.sliding ? 1 : 0, slide: player?.sliding ? 1 : 0, air: air ? 1 : 0 }; // prettier-ignore
    for (const key of ['sprint', 'slide', 'air'] as const) this.#shares[key] += (want[key] - this.#shares[key]) * k;
    this.#swing(camera, dt);
    pose.reset();
    pose.rootRot.setFromAxisAngle(UP, camera.yaw);
    pose.rootPos.set(...camera.position).sub(v[0].copy(this.#eye).applyQuaternion(pose.rootRot));
    forwardKinematics(skeleton, pose, world);
    const eye = v[1].set(...camera.position);
    for (const [i, side] of (['L', 'R'] as const).entries()) this.#hand(camera, input, side, i, eye, size);
    const kick = input.kick && input.kick.weight > 0 ? input.kick : null;
    if (kick) {
      FIRST_KICK.forEach((joint, j) => pose.setRotation(joint, q[0].identity().slerp(kick.local[j], kick.weight)));
      forwardKinematics(skeleton, pose, world);
    }
    const parts = kick && kick.weight > 0.01 ? [...FIRST_ARMS, ...FIRST_KICK] : FIRST_ARMS;
    const hidden = new Set(nearBodyCull(skeleton, world, camera.position, { show: parts, near: VIEWMODEL.cull }));
    this.shown = JOINTS.filter((joint) => !hidden.has(joint));
    socketPosition(skeleton, world, 'weaponL', this.hands[0]);
    socketPosition(skeleton, world, 'weaponR', this.hands[1]);
    return this;
  }

  /** Points along the parts the last update showed (each joint, its bone's middle and far end) and the grips: what a depth check tests. */ // prettier-ignore
  points(): Vec3[] {
    const { skeleton, world } = this;
    const at = (j: number) => jointPosition(world, j, v[0]);
    const out: Vec3[] = this.hands.map(vec3Of);
    for (const joint of this.shown) {
      const j = JOINTS.indexOf(joint);
      const start = vec3Of(at(j));
      const ends = CHILDREN[j].length ? CHILDREN[j].map((c) => vec3Of(at(c))) : [vec3Of(tipPosition(skeleton, world, j, v[0]))]; // prettier-ignore
      out.push(start, ...ends.flatMap((end) => [end, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2] as Vec3])); // prettier-ignore
    }
    return out;
  }

  /** Eases the sway toward the look's turn since the last update. */
  #swing(camera: CameraPose, dt: number): void {
    const last = this.#look;
    this.#look = { yaw: camera.yaw, pitch: camera.pitch };
    const [per, most, lag] = ARMS.sway;
    const turn = last && dt > 0 ? [angDiff(last.yaw, camera.yaw) / dt, (camera.pitch - last.pitch) / dt] : [0, 0];
    const target = [MathUtils.clamp(per * turn[0], -most, most), MathUtils.clamp(-per * turn[1], -most, most)];
    const k = dt > 0 ? 1 - Math.exp(-dt / lag) : 0;
    for (const i of [0, 1]) this.#sway[i] += (target[i] - this.#sway[i]) * k;
  }

  /** Puts hand `side` (index `i`) where the state and the body want it, kept on the frame and in reach. */
  #hand(camera: CameraPose, input: ArmsInput, side: 'L' | 'R', i: number, eye: Vector3, size: number): void {
    const { skeleton, pose, world } = this;
    const sign = side === 'R' ? 1 : -1;
    const shares = this.#shares;
    const pump = Math.sin(input.phase) * sign; // the right fist forward and up as the gait's phase swings it
    const sprint: Place = [ARMS.sprint[0], ARMS.sprint[1] + ARMS.pump[1] * pump, ARMS.sprint[2] + ARMS.pump[0] * pump];
    const slide = side === 'R' ? ARMS.slide : ([-ARMS.slideLeft[0], ARMS.slideLeft[1], ARMS.slideLeft[2]] as Place);
    let place = mix(mix(mix(ARMS.ready, ARMS.air, shares.air), sprint, shares.sprint), slide, shares.slide);
    const bob = input.effects ? [input.effects.bobPhase, input.effects.bobShare] : [0, 0];
    const lift = ARMS.breath[0] * Math.sin(input.clock * ARMS.breath[1]) - (ARMS.bob[1] * bob[1] * (1 - Math.cos(bob[0]))) / 2; // prettier-ignore
    const across = ARMS.bob[0] * bob[1] * Math.sin(bob[0] / 2) + this.#sway[0];
    place = [place[0] + across * sign, place[1] + lift + this.#sway[1], place[2]];
    const grip = cameraPoint(camera, place, sign, size, v[2]);
    const gun = input.gun && input.gun.weight > 0 ? input.gun : null;
    if (gun) grip.lerp(v[3].copy(eye).add(gun.grips[i]), gun.weight);
    const fist = input.punch && input.punch.weight > 0 ? input.punch.grips[i] : null;
    if (fist) grip.lerp(v[3].copy(eye).add(fist), MathUtils.clamp(input.punch!.weight, 0, 1));
    const held = input.held[i];
    const w = held ? MathUtils.clamp(held.weight, 0, 1) : 0;
    if (held && w > 0) grip.lerp(held.point, w);
    const kept = intoArmsFrame(camera, [grip.x, grip.y, grip.z], input.aspect, ARMS.margin, input.fov);
    grip.set(...kept);
    // along its ray from the eye, within the arm's reach of its shoulder and no nearer the eye than `nearest`: first as
    // if the hand were in line with the arm, then for the wrist where the hand's turn puts it
    const shoulder = jointPosition(world, `upperArm${side}`, v[3]);
    const ray = v[4].subVectors(grip, eye);
    const d0 = ray.length();
    if (d0 > 1e-9) ray.divideScalar(d0);
    const nearest = ARMS.nearest * size;
    /** The distance along the ray, nearest `d0`, putting `from` + ray × it within `reach` of the shoulder. */
    const along = (from: Vector3, reach: number) => {
      const b = ray.dot(v[5].subVectors(from, shoulder));
      const room = b * b - v[5].lengthSq() + reach * reach;
      const [near, far] = room >= 0 ? [-b - Math.sqrt(room), -b + Math.sqrt(room)] : [-b, -b];
      return MathUtils.clamp(d0, Math.max(near, nearest), Math.max(far, nearest));
    };
    if (d0 > 1e-9) grip.copy(eye).addScaledVector(ray, along(eye, ARMS.reach * this.#reach[0]));
    const [r, u, f] = [poseRight(camera), poseUp(camera), poseForward(camera)];
    const p = ARMS.pole;
    const pole = v[6].set(r[0] * p[0] * sign + u[0] * p[1] + f[0] * p[2], r[1] * p[0] * sign + u[1] * p[1] + f[1] * p[2], r[2] * p[0] * sign + u[2] * p[1] + f[2] * p[2]).normalize(); // prettier-ignore
    const hand = `hand${side}` as const;
    handTo(skeleton, pose, world, hand, grip, { pole });
    // the fist in line with the forearm, turned to the body's hand as far as it holds a contact
    const rotation = jointRotation(world, `forearm${side}`, q[1]);
    if (held && w > 0) rotation.slerp(held.rotation, w);
    const at = socketIndex(side === 'R' ? 'weaponR' : 'weaponL') * 3;
    const wrist = v[7].fromArray(skeleton.socketOffsets, at).applyQuaternion(rotation).negate().add(eye); // eye − the grip's offset
    if (d0 > 1e-9) grip.copy(eye).addScaledVector(ray, along(wrist, ARMS.reach * this.#reach[1]));
    handTo(skeleton, pose, world, hand, grip, { pole, rotation });
  }
}

/** What the rig reads off the player's `animator` (its traversal plant `contacts`), with the frame's camera inputs. */
export function armsInputOf(
  animator: Animator,
  contacts: TraversalPlant | null,
  frame: Pick<ArmsInput, 'player' | 'effects' | 'aspect' | 'fov'>,
): ArmsInput {
  const body = animator.body;
  const { skeleton, world, state } = body;
  const limbs = contacts?.limbs;
  const held = (['L', 'R'] as const).map((side, i) => {
    const limb = limbs?.[i];
    return limb && limb.weight > 0 ? { point: limb.point.clone(), rotation: jointRotation(world, `hand${side}`), weight: limb.weight } : null; // prettier-ignore
  }) as unknown as ArmsInput['held'];
  const kicking = state.arm.kick === 1 && state.arm.weight > 0;
  const kick = kicking ? { local: FIRST_KICK.map((joint) => body.pose.getRotation(joint)), weight: state.arm.weight } : null; // prettier-ignore
  const busy = Math.max(contacts?.pose?.weight ?? 0, limbs?.[0].weight ?? 0, limbs?.[1].weight ?? 0);
  const eyes = new Vector3(...eyePoint(skeleton, world));
  const grips = [socketPosition(skeleton, world, 'weaponL').sub(eyes), socketPosition(skeleton, world, 'weaponR').sub(eyes)] as const; // prettier-ignore
  const gun = body.weapon === 'gun' && busy < 1 ? { grips, weight: 1 - MathUtils.clamp(busy, 0, 1) } : null;
  const striking = state.arm.weight > 0 && state.arm.kick !== 1 ? state.arm.hand : 0; // −1 the left, 1 the right, 2 both
  const fist = (i: number) => (striking === 2 || striking === (i === 0 ? -1 : 1) ? grips[i] : null);
  const punch = striking !== 0 ? { grips: [fist(0), fist(1)] as const, weight: state.arm.weight } : null;
  return { ...frame, phase: state.phase, clock: state.clock, held, kick, gun, punch };
}

/** The world point of `p` (a `Vector3`) as a `Vec3`. */
export const vec3Of = (p: Vector3): Vec3 => [p.x, p.y, p.z];
