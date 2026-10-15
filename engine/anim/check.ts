/**
 * @file `anim.check(def)` (PLAN.md WP 3.4, WP 6.6): `animCheck` runs a set of poses through FK and reports what breaks
 * the body's contract, as plain sentences: values that are not finite, bones that changed length, declared rigid pairs
 * that drifted, feet below the floor, and sockets out of reach. `animCheckBody` checks a whole body: it drives a fresh
 * animator through the state matrix (engine/anim/stateMatrix.ts), checks every pose, runs the matrix again for the
 * same hash, and once more at half the step to hold 1/60 s against 1/120 s within a tolerance. The `anim` QA family
 * (tools/qa/anim.ts) adds the motion checks over the same runs.
 *
 * Invariants:
 * - Read-only and deterministic: the same spec gives the same report. A problem is reported once per check and
 *   point, naming its first frame, how many frames have it and the worst value, so a bad clip prints a few lines.
 * - Lengths (bones, leaf tips, sockets) are measured without the root's scale, which squashes the whole body on
 *   purpose. One off by more than the tolerance is blamed on the topmost rotation above it that is not a unit
 *   quaternion, the only way FK stretches a bone, and reported once for that joint.
 * - The feet are the ankles, the balls, the toe tips and the contact sockets; the floor is `floor` (0 by default).
 * - A socket is in reach when it lies no farther from the root than its chain of bones could stretch (each bone from
 *   the root down to it, straightened), times the root's largest scale: a farther one comes from a broken transform.
 *
 * Carried from `my-3d2dge:src/emberdeep/18-characters.js:82-143` (`checkRig`: every point finite), as a mechanism.
 *
 * @example
 * import { Animator } from './character';
 * import { Pose } from './pose';
 * import { SAMPLE_STATES } from './states';
 * animCheck({ poses: [new Pose()] }).ok; // true: the rest pose stands on the floor
 * const sunk = new Pose();
 * sunk.rootPos.y = -0.05;
 * animCheck({ poses: [sunk] }).problems[0].message; // 'frame 0: toeL is 0.026 m below the floor (y -0.026); …'
 * const hero = (dt: number) => new Animator({ build: 'build:heroic', weapon: 'sword', clock: 1, dt });
 * animCheckBody(hero, { states: { wave: SAMPLE_STATES.wave } }).ok; // true: finite, stable, on the floor, rate-proof
 * @see engine/anim/check.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../core/log';
import { Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import type { Animator } from './character';
import { createWorldPose, forwardKinematics, jointPosition, socketPosition, tipPosition, type WorldPose } from './fk';
import { Pose } from './pose';
import {
  createSkeleton,
  JOINT_COUNT,
  JOINTS,
  PARENTS,
  SOCKETS,
  type JointName,
  type Skeleton,
  type SocketName,
} from './skeleton';
import {
  hashRun,
  rateDrift,
  RUN_POINTS,
  runPoints,
  STATE_MATRIX,
  stateMatrix,
  type MatrixRun,
  type StateMatrixOptions,
} from './stateMatrix';

/** The codes this module raises, with their fixes. */
export const CHECK_CODES = defineCodes('anim', {
  ANIM_UNKNOWN_POINT: {
    template: 'the rigid pair names {name}, which is not a joint, a socket or the root{suggestion}',
    fix: 'name joints (JOINTS), sockets (SOCKETS) or "root" in rigid pairs',
    doc: 'Raised by `animCheck` (engine/anim/check.ts) for a rigid pair naming a point the skeleton lacks.',
  },
});

/** A point a rigid pair can name: a joint, a socket, or the root. */
export type PointName = JointName | SocketName | 'root';

/** Two points whose distance must not change: from the first frame, or the distance given third (metres). */
export type RigidPair = readonly [PointName, PointName] | readonly [PointName, PointName, number];

/** What `animCheck` checks. */
export interface AnimCheckSpec {
  /** The poses to check: a clip's samples, a state matrix, one pose. */
  poses: readonly Pose[];
  /** The skeleton they are for: a skeleton or a build id; `build:chibi`'s by default. */
  skeleton?: Skeleton | string;
  /** Pairs of points held at a fixed distance, such as both hands on one weapon. */
  rigid?: readonly RigidPair[];
  /** The floor's height under the feet, in the space the poses' roots are in; 0 by default. */
  floor?: number;
  /** How far a length or a height may be off, in metres; 0.001 by default. */
  tolerance?: number;
}

/**
 * One kind of problem: which check found it. `hash` and `rate` come from `animCheckBody`: a run that gave another
 * hash the second time, and one whose joints drift between 1/60 s and 1/120 s steps.
 */
export type AnimCheckName = 'finite' | 'length' | 'rigid' | 'floor' | 'reach' | 'hash' | 'rate';

/** One problem: the check, the point, the first frame that has it, how many frames do, and a plain sentence. */
export interface AnimProblem {
  check: AnimCheckName;
  point: string;
  frame: number;
  frames: number;
  /** The worst value: metres off, below the floor, past reach or drifted (NaN for a value that is not finite). */
  worst: number;
  message: string;
  /** The state matrix's state it happened in (`animCheckBody`). */
  state?: string;
}

/** What `animCheck` found. */
export interface AnimCheckReport {
  ok: boolean;
  frames: number;
  problems: AnimProblem[];
}

/** The feet: what must stay at or above the floor. */
const FEET = {
  joints: ['footL', 'footR', 'toeL', 'toeR'],
  tips: ['toeL', 'toeR'],
  sockets: ['contactL', 'contactR'],
} as const;

/** How far each socket can be from the root: the chain of bones down to it, straightened, plus its offset. */
function reachOf(skeleton: Skeleton): number[] {
  const chain = new Float64Array(JOINT_COUNT);
  for (let j = 0; j < JOINT_COUNT; j++) chain[j] = (PARENTS[j] < 0 ? 0 : chain[PARENTS[j]]) + skeleton.lengths[j];
  const o = skeleton.socketOffsets;
  return skeleton.socketJoints.map((j, s) => chain[j] + Math.hypot(o[s * 3], o[s * 3 + 1], o[s * 3 + 2]));
}

/** The world position of point `name` in `world`. */
function pointAt(skeleton: Skeleton, world: WorldPose, pose: Pose, name: PointName): Vector3 {
  if (name === 'root') return pose.rootPos.clone();
  if ((SOCKETS as readonly string[]).includes(name)) return socketPosition(skeleton, world, name as SocketName);
  return jointPosition(world, name as JointName);
}

/** Throws `ANIM_UNKNOWN_POINT` for a rigid pair naming no point. */
function checkPointName(name: string): void {
  const all = [...JOINTS, ...SOCKETS, 'root'];
  if (!all.includes(name)) {
    throw codeError('ANIM_UNKNOWN_POINT', { name: JSON.stringify(name), suggestion: didYouMean(name, all) });
  }
}

/** A metre value for messages: up to 4 decimals. */
const m = (value: number) => String(Math.round(value * 1e4) / 1e4);
/** ", worst <value>" for a repeated problem, when its worst is a number. */
const worstOf = (worst: number) => (Number.isNaN(worst) ? '' : `, worst ${m(worst)}`);

/**
 * Checks every pose of `spec` against the skeleton's contract: finite values, bone lengths, declared rigid pairs,
 * feet at or above the floor, sockets in reach. Throws `ANIM_UNKNOWN_POINT` for a rigid pair naming no point.
 */
export function animCheck(spec: AnimCheckSpec): AnimCheckReport {
  const skeleton = typeof spec.skeleton === 'object' ? spec.skeleton : createSkeleton(spec.skeleton);
  const floor = spec.floor ?? 0;
  const tolerance = spec.tolerance ?? 0.001;
  const rigid = spec.rigid ?? [];
  for (const pair of rigid) [pair[0], pair[1]].forEach(checkPointName);
  const found = new Map<string, AnimProblem & { last: number }>();
  const report = (check: AnimCheckName, point: string, frame: number, worst: number, say: () => string) => {
    const known = found.get(`${check} ${point}`);
    if (!known) {
      const message = `frame ${frame}: ${say()}`;
      found.set(`${check} ${point}`, { check, point, frame, frames: 1, worst, message, last: frame });
      return;
    }
    if (known.last !== frame) known.frames++;
    known.last = frame;
    if (Number.isNaN(worst) || worst > known.worst) known.worst = worst;
  };
  const reach = reachOf(skeleton);
  const world = createWorldPose();
  const unscaled = createWorldPose();
  const flat = new Pose();
  const norms = new Float64Array(JOINT_COUNT);
  const rigidAt: number[] = rigid.map((pair) => (pair.length > 2 ? (pair[2] as number) : NaN));
  spec.poses.forEach((pose, frame) => {
    const numbers = pose.toArray();
    const bad = numbers.findIndex((value) => !Number.isFinite(value));
    if (bad >= 0) {
      const where =
        bad < 10 ? ['rootPos', 'rootRot', 'rootScale'][bad < 3 ? 0 : bad < 7 ? 1 : 2] : JOINTS[(bad - 10) >> 2];
      report('finite', where, frame, NaN, () => `${where} holds ${numbers[bad]}; every value must be a finite number`);
      return;
    }
    const { x: sx, y: sy, z: sz } = pose.rootScale;
    if (sx <= 0 || sy <= 0 || sz <= 0) {
      report('finite', 'rootScale', frame, NaN, () => `rootScale is ${sx}, ${sy}, ${sz}; scale by numbers above 0`);
      return;
    }
    forwardKinematics(skeleton, pose, world);
    flat.copy(pose);
    flat.rootScale.set(1, 1, 1);
    forwardKinematics(skeleton, flat, unscaled);
    // lengths, measured unscaled: each bone, each leaf's tip, each socket, blamed on the topmost rotation above it
    // that is not a unit quaternion
    for (let j = 0; j < JOINT_COUNT; j++) norms[j] = pose.getRotation(j).length();
    const measure = (name: string, j: number, length: number, rest: number) => {
      const off = Math.abs(length - rest);
      if (off <= tolerance) return;
      let cause = -1;
      for (let a = j; a >= 0; a = PARENTS[a]) if (Math.abs(norms[a] - 1) > 1e-6) cause = a;
      const by =
        cause < 0 ? '' : `: the rotation of ${JOINTS[cause]} has length ${m(norms[cause])}, not 1; normalize it`;
      report(
        'length',
        cause < 0 ? name : JOINTS[cause],
        frame,
        off,
        () => `${name} is ${m(length)} m long, not ${m(rest)}${by}`,
      );
    };
    const t = skeleton.tips;
    const o = skeleton.socketOffsets;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const at = jointPosition(unscaled, j);
      if (PARENTS[j] >= 0) {
        const bone = `the bone ${JOINTS[PARENTS[j]]}–${JOINTS[j]}`;
        measure(bone, PARENTS[j], at.distanceTo(jointPosition(unscaled, PARENTS[j])), skeleton.lengths[j]);
      }
      const tip = Math.hypot(t[j * 3], t[j * 3 + 1], t[j * 3 + 2]);
      if (tip > 0) measure(`the tip of ${JOINTS[j]}`, j, at.distanceTo(tipPosition(skeleton, unscaled, j)), tip);
    }
    SOCKETS.forEach((name, i) => {
      const j = skeleton.socketJoints[i];
      const length = socketPosition(skeleton, unscaled, name).distanceTo(jointPosition(unscaled, j));
      measure(`the socket ${name}`, j, length, Math.hypot(o[i * 3], o[i * 3 + 1], o[i * 3 + 2]));
    });
    rigid.forEach(([a, b], r) => {
      const distance = pointAt(skeleton, world, pose, a).distanceTo(pointAt(skeleton, world, pose, b));
      if (Number.isNaN(rigidAt[r])) rigidAt[r] = distance;
      const off = Math.abs(distance - rigidAt[r]);
      if (off > tolerance) {
        report(
          'rigid',
          `${a}-${b}`,
          frame,
          off,
          () => `${a} and ${b} are ${m(distance)} m apart, not ${m(rigidAt[r])}; a rigid pair keeps its distance`,
        );
      }
    });
    const feet: [string, Vector3][] = [
      ...FEET.joints.map((name): [string, Vector3] => [name, jointPosition(world, name)]),
      ...FEET.tips.map((name): [string, Vector3] => [`${name} tip`, tipPosition(skeleton, world, name)]),
      ...FEET.sockets.map((name): [string, Vector3] => [name, socketPosition(skeleton, world, name)]),
    ];
    for (const [name, p] of feet) {
      if (p.y < floor - tolerance) {
        report(
          'floor',
          name,
          frame,
          floor - p.y,
          () => `${name} is ${m(floor - p.y)} m below the floor (y ${m(p.y)}); raise the root or bend the leg`,
        );
      }
    }
    const scale = Math.max(pose.rootScale.x, pose.rootScale.y, pose.rootScale.z);
    for (const [i, name] of SOCKETS.entries()) {
      const distance = socketPosition(skeleton, world, name).distanceTo(pose.rootPos);
      if (distance > reach[i] * scale + tolerance) {
        report(
          'reach',
          name,
          frame,
          distance - reach[i] * scale,
          () => `${name} is ${m(distance)} m from the root, past its chain's reach of ${m(reach[i] * scale)} m`,
        );
      }
    }
  });
  const problems = [...found.values()].map(({ last: _last, ...problem }) =>
    problem.frames > 1
      ? { ...problem, message: `${problem.message} (${problem.frames} frames${worstOf(problem.worst)})` }
      : problem,
  );
  return { ok: problems.length === 0, frames: spec.poses.length, problems };
}

/** What `animCheckBody` checks: the matrix, `animCheck`'s spec, the hash and the rate. */
export interface BodyCheckOptions extends StateMatrixOptions, Omit<AnimCheckSpec, 'poses' | 'skeleton'> {
  /** Metres a joint may drift between 1/60 s and 1/120 s steps; `STATE_MATRIX.rate` by default, false to skip. */
  rate?: number | false;
  /** Whether to run the matrix again for the same hashes; true by default. */
  hash?: boolean;
}

/** What `animCheckBody` found, with the runs it checked. */
export interface BodyCheckReport extends AnimCheckReport {
  runs: MatrixRun[];
}

/**
 * Checks a whole body (my-3d2dge's `checkRig`): every pose of the state matrix (`animCheck`), the same hashes when
 * the matrix runs again (`hash`), and the joints within `rate` metres of a run at half the step (`rate`). Each
 * problem names its state and facing.
 */
export function animCheckBody(make: (dt: number) => Animator, options: BodyCheckOptions = {}): BodyCheckReport {
  const runs = stateMatrix(make, options);
  const problems: AnimProblem[] = [];
  const add = (run: MatrixRun, problem: Omit<AnimProblem, 'state'>) =>
    problems.push({ ...problem, state: run.state, message: `${run.state} facing ${run.facing}: ${problem.message}` });
  const { rigid, floor, tolerance } = options;
  for (const run of runs) {
    for (const problem of animCheck({ poses: run.poses, skeleton: run.skeleton, rigid, floor, tolerance }).problems) {
      add(run, problem);
    }
  }
  if (options.hash !== false) {
    stateMatrix(make, options).forEach((again, i) => {
      const frame = again.poses.findIndex((pose, f) => !pose.equals(runs[i].poses[f]));
      if (frame < 0 && hashRun(again) === hashRun(runs[i])) return;
      const message = `frame ${frame}: running it again gave another pose; look for module state, Math.random or a clock`;
      add(runs[i], { check: 'hash', point: 'pose', frame, frames: 1, worst: 1, message });
    });
  }
  const limit = options.rate ?? STATE_MATRIX.rate;
  if (limit !== false) {
    stateMatrix(make, { ...options, dt: (options.dt ?? SIM_DT) / 2 }).forEach((fine, i) => {
      const { worst, frame, point } = rateDrift(runPoints(runs[i]), runPoints(fine));
      const joint = RUN_POINTS[point];
      if (worst <= limit) return;
      const message = `frame ${frame}: ${joint} is ${m(worst)} m from where half steps put it (over ${limit} m); scale each step's change by dt`;
      add(runs[i], { check: 'rate', point: joint, frame, frames: 1, worst, message });
    });
  }
  const frames = runs.reduce((sum, run) => sum + run.poses.length, 0);
  return { ok: problems.length === 0, frames, problems, runs };
}
