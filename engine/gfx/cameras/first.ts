/**
 * @file The first-person camera (PLAN.md WP 3.9; doctrine: Common ground): the hero's eyes, turned by the devices,
 * and the near-body culling that hides his own body from them. `stepFirst` and `firstPose` are the pure steps;
 * `createFirstCamera` wraps them in a camera.
 *
 * It sits at the eye: `input.eye`, the midpoint of the rig's eye sockets (`eyePoint(skeleton, world)` on the animated
 * pose's FK, engine/anim/fk.ts) or the shooter model's eye height (engine/gfx/cameras/effects.ts), or
 * `FIRST_EYE_HEIGHT` above `input.follow` without either. It follows the eye across at once, and up and down with a
 * time constant of `FIRST_BOB_LAG` real seconds, which softens the head's bob, never more than `FIRST_TRAIL` behind.
 * `input.look` and `input.turn` turn it right and up (its yaw is the hero's aim), or `input.view` sets the view (the
 * sim's look, when no device turns the camera); `input.zoom` narrows the lens 5° a step within `FLY_FOV_RANGE`, from
 * `input.lens` when given (the player's field of view, engine/gfx/cameras/rig.ts).
 *
 * Near-body culling (`nearBodyCull`): the joints whose body parts a renderer hides from this camera. That is the whole
 * body but the hands (`FIRST_SHOWN`; a held weapon rides their sockets), as first-person games show it, and also any
 * shown part that comes within `FIRST_NEAR_BODY` of the eye, so nothing fills the frame or cuts the near plane. A
 * part runs from its joint to its children (a leaf's, to its tip). `show: JOINTS` keeps the whole body but what is
 * near the eye ("true first person").
 *
 * Invariants: the pitch stays within ±`FLY_MAX_PITCH`; the head is always culled (the eyes are on it); pure.
 *
 * Codes: `cam3=first[,<yaw>,<pitch>[,<fov>]]` (degrees); a bare one looks where the camera before it looked. The
 * reader and the camera wrapper are engine/gfx/cameras/chase.ts's, shared by WP 3.9's cameras.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:95-101` (`firstPose`: the head point and its lag) and `:37`
 * (its pitch and lens; the hero was not drawn), at the eye sockets of the skeleton (engine/anim/skeleton.ts).
 *
 * @example
 * import { forwardKinematics } from '../../anim/fk';
 * import { Pose } from '../../anim/pose';
 * import { createSkeleton } from '../../anim/skeleton';
 * const skeleton = createSkeleton('build:heroic');
 * const world = forwardKinematics(skeleton, new Pose()); // standing at the origin, facing +Z
 * const first = createFirstCamera();
 * first.update({ eye: eyePoint(skeleton, world) }).position; // [0, 1.83…, 0.18…]: at his eyes (the first eye snaps)
 * nearBodyCull(skeleton, world, first.pose().position); // ['pelvis', 'spine0', …, 'toeR']: all but the hands
 * first.code(); // 'cam3=first,0,-4.58,75'
 * createFirstCamera().update({ follow: [2, 0, 3] }).position; // [2, 1.5, 3]: eye height, without a rig
 * @see engine/gfx/cameras/first.test.ts
 */
import { socketPosition, tipPosition, type WorldPose } from '../../anim/fk';
import { JOINTS, PARENTS, type JointName, type Skeleton } from '../../anim/skeleton';
import { MathUtils, Vector3 } from '../../core/math';
import { codeDegrees, codeNumber, followCamera, readCode, type CodePart, type FollowCamera } from './chase';
import { FIRST_EFFECTS } from './effects';
import { FLY_FOV_RANGE, FLY_MAX_PITCH } from './fly';
import { makePose, rangeProblems, refuse, wrapAngle, type CameraInput, type CameraPose, type Vec3 } from './pose';

const DEG = MathUtils.DEG2RAD;

/** The starting pitch (rad, + up) and lens (degrees, `PerspectiveCamera.fov`). */
export const FIRST_DEFAULTS = Object.freeze({ pitch: -0.08, fov: 75 });
/** The eye's height above the followed point without a rig, m. */
export const FIRST_EYE_HEIGHT = 1.5;
/** The time constant of the eye's height, real seconds: it softens the head's bob. */
export const FIRST_BOB_LAG = 1 / 16;
/** The most the eye's height trails the eye, m: a fall or a climb is followed, and a stop never overshot. */
export const FIRST_TRAIL = 0.2;
/** The joints whose parts the camera shows (unless near the eye): the hands, which hold the weapons. */
export const FIRST_SHOWN: readonly JointName[] = Object.freeze(['handL', 'handR']);
/** A shown part closer to the eye than this is culled too, m. */
export const FIRST_NEAR_BODY = 0.3;
/** Turn rates at full `input.turn`, rad/s: `[right, up]`. */
export const FIRST_TURN_SPEED = Object.freeze([2.2, 1.2] as const);

/** A first-person camera's input: the devices', and the hero's eye. */
export interface FirstInput extends CameraInput {
  /** The hero's eye, m: `eyePoint(skeleton, world)`. Without it, `FIRST_EYE_HEIGHT` above `follow`. */
  readonly eye?: Vec3;
  /** The view to look along, `[yaw, pitch]` rad, when no device turns the camera (the sim's look). */
  readonly view?: readonly [number, number];
  /** The lens before the wheel's zoom, vertical degrees: the player's field of view. */
  readonly lens?: number;
}

/** A first-person camera's code as data: without the numbers it looks where the camera before it looked. */
export interface FirstSpec {
  readonly type: 'first';
  /** The heading, rad (the intents' `cam`, the hero's aim). */
  readonly yaw?: number;
  /** Rad, + up. */
  readonly pitch?: number;
  /** Vertical field of view, degrees. */
  readonly fov?: number;
}

/** A first-person camera's state: plain data, replaced by each step. */
export interface FirstState {
  readonly yaw: number;
  readonly pitch: number;
  readonly fov: number;
  /** Degrees the wheel has narrowed the lens by. */
  readonly narrow: number;
  /** Where it is, m; null until the first eye or follow. */
  readonly eye: Vec3 | null;
}

/** Options for a first-person camera: its code's data, and the camera before it. */
export interface FirstOptions extends Omit<FirstSpec, 'type'> {
  /** The camera before this one: without a yaw and pitch, it looks the same way. */
  readonly from?: CameraPose;
}

/** A checked first-person state for `options`. Throws `GFX_BAD_CAMERA`. */
export function firstState(options: FirstOptions = {}): FirstState {
  const state: FirstState = {
    yaw: options.yaw ?? options.from?.yaw ?? 0,
    pitch: options.pitch ?? options.from?.pitch ?? FIRST_DEFAULTS.pitch,
    fov: options.fov ?? FIRST_DEFAULTS.fov,
    narrow: 0,
    eye: null,
  };
  refuse('the first-person camera', [
    ...rangeProblems({ yaw: [state.yaw, -1e6, 1e6], pitch: [state.pitch, -Math.PI / 2, Math.PI / 2] }),
    ...rangeProblems({ fov: [state.fov, ...FLY_FOV_RANGE] }),
  ]);
  return { ...state, pitch: MathUtils.clamp(state.pitch, -FLY_MAX_PITCH, FLY_MAX_PITCH) };
}

/** Steps a first-person camera by one rendered frame: turned by `look` and `turn`, `zoom` on the lens, at the eye. */
export function stepFirst(state: FirstState, input: FirstInput, dt: number): FirstState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * FIRST_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * FIRST_TURN_SPEED[1] * dt;
  const yaw = input.view ? wrapAngle(input.view[0]) : wrapAngle(state.yaw - right);
  const pitch = MathUtils.clamp(input.view ? input.view[1] : state.pitch + up, -FLY_MAX_PITCH, FLY_MAX_PITCH);
  const base = input.lens ?? state.fov + state.narrow;
  const fov = MathUtils.clamp(base - state.narrow - (input.zoom ?? 0) * 5, ...FLY_FOV_RANGE);
  const f = input.follow;
  const to: Vec3 | null = input.eye ?? (f ? [f[0], f[1] + FIRST_EYE_HEIGHT, f[2]] : null);
  let eye = state.eye;
  if (to && eye) {
    const y = eye[1] + (to[1] - eye[1]) * (1 - Math.exp(-dt / FIRST_BOB_LAG));
    eye = [to[0], MathUtils.clamp(y, to[1] - FIRST_TRAIL, to[1] + FIRST_TRAIL), to[2]];
  } else if (to) eye = [...to];
  return { yaw, pitch, fov, narrow: base - fov, eye };
}

/** The first-person camera's pose: at the eye, looking along its yaw and pitch. */
export function firstPose(state: FirstState): CameraPose {
  const { yaw, pitch, fov } = state;
  return makePose({ position: state.eye ?? [0, FIRST_EYE_HEIGHT, 0], yaw, pitch, fov, near: 0.05, far: 500 });
}

/** The first-person camera's code data. */
export function firstSpec(state: FirstState): FirstSpec {
  return { type: 'first', yaw: state.yaw, pitch: state.pitch, fov: state.fov };
}

/** The head socket: the midpoint of the eye sockets of `skeleton` posed as `world` (engine/anim/fk.ts), m. */
export function eyePoint(skeleton: Skeleton, world: WorldPose): Vec3 {
  const l = socketPosition(skeleton, world, 'eyeL');
  const r = socketPosition(skeleton, world, 'eyeR');
  return [(l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2];
}

/** Each joint's children, by index. */
const CHILDREN = JOINTS.map((_, j) => PARENTS.flatMap((parent, child) => (parent === j ? [child] : [])));

/** The distance from `p` to the segment from `a` to `b`. */
function segmentDistance(p: Vec3, a: Vector3, b: Vector3): number {
  const ab = new Vector3().subVectors(b, a);
  const t = MathUtils.clamp(ab.dot(new Vector3(p[0] - a.x, p[1] - a.y, p[2] - a.z)) / (ab.lengthSq() || 1), 0, 1);
  return ab
    .multiplyScalar(t)
    .add(a)
    .distanceTo(new Vector3(...p));
}

/** Options for `nearBodyCull`. */
export interface CullOptions {
  /** The joints whose parts stay shown unless near the eye (`FIRST_SHOWN`: the hands). */
  readonly show?: readonly JointName[];
  /** How near the eye a shown part is culled, m (`FIRST_NEAR_BODY`). */
  readonly near?: number;
}

/**
 * Near-body culling: the joints, in `JOINTS` order, whose body parts a first-person camera at `eye` hides from the
 * character `skeleton` posed as `world`: those not in `options.show`, the head, and those whose part comes within
 * `options.near` of the eye (see the file comment).
 */
export function nearBodyCull(skeleton: Skeleton, world: WorldPose, eye: Vec3, options: CullOptions = {}): JointName[] {
  const show = new Set(options.show ?? FIRST_SHOWN);
  const near = options.near ?? FIRST_NEAR_BODY;
  const at = (j: number) => new Vector3().fromArray(world.positions, j * 3);
  return JOINTS.filter((joint, j) => {
    if (!show.has(joint) || joint === 'head') return true;
    const ends = CHILDREN[j].length ? CHILDREN[j].map(at) : [tipPosition(skeleton, world, j)];
    return ends.some((end) => segmentDistance(eye, at(j), end) < near);
  });
}

const PARTS: readonly CodePart[] = [
  ['yaw', -1e6, 1e6],
  ['pitch', -90, 90],
  ['fov', ...FLY_FOV_RANGE],
];

/** Reads a first-person camera's code: `cam3=first[,<yaw>,<pitch>[,<fov>]]`. Throws `GFX_BAD_CAMERA_CODE`. */
export function parseFirstCode(code: string): FirstSpec {
  const [yaw, pitch, fov] = readCode(code, 'first', PARTS, [0, 2, 3]);
  if (yaw === undefined) return { type: 'first' };
  return { type: 'first', yaw: yaw * DEG, pitch: pitch * DEG, ...(fov === undefined ? {} : { fov }) };
}

/** The canonical code of a first-person camera's data (numbers rounded to 0.01°). */
export function formatFirstCode(spec: FirstSpec): string {
  if (spec.yaw === undefined) return 'cam3=first';
  const pitch = codeDegrees(spec.pitch ?? FIRST_DEFAULTS.pitch);
  return `cam3=first,${codeDegrees(spec.yaw, true)},${pitch},${codeNumber(spec.fov ?? FIRST_DEFAULTS.fov, 2)}`;
}

/** A first-person camera in words. */
export function describeFirst(_spec: FirstSpec, pose: CameraPose): string {
  const lens = `First person (perspective, ${codeNumber(pose.fov, 0)}° field of view)`;
  return `${lens}, heading ${codeDegrees(pose.yaw, true)}°, pitch ${codeDegrees(pose.pitch)}°`;
}

/** A first-person camera: at the hero's eyes (`input.eye`), turned by the devices; it takes every view effect. */
export function createFirstCamera(options: FirstOptions = {}): FollowCamera<'first', FirstSpec, FirstInput> {
  const steps = { step: stepFirst, pose: firstPose, spec: firstSpec, code: formatFirstCode, describe: describeFirst };
  return followCamera('first', firstState(options), steps, { effects: FIRST_EFFECTS });
}
