/**
 * @file `anim.check(def)` (PLAN.md WP 3.4, WP 6.6): `animCheck` runs a set of poses through FK and reports what breaks
 * the body's contract, as plain sentences: values that are not finite, bones that changed length, declared rigid pairs
 * that drifted, feet below the floor, and sockets out of reach. `animCheckBody` checks a whole body: it drives a fresh
 * animator through the state matrix (`stateMatrix`: each body state, held from rest and back to rest, at each facing
 * of `STATE_MATRIX`), checks every pose, runs the matrix again for the same hash, and once more at half the step to
 * hold 1/60 s against 1/120 s within a tolerance. The `anim` QA family (tools/qa/anim.ts) adds the motion checks over
 * the same runs, and `x sheet` draws them from the cameras of `SHEET_CAMERAS`.
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
 * - The matrix tells its states in the body's own frame (+Z ahead, as `SAMPLE_STATES` are written), turned to each
 *   facing, and starts each run from a fresh body (`make(dt)`), so runs never leak into each other.
 *
 * Carried from `my-3d2dge:src/emberdeep/18-characters.js:82-143` (`checkRig`: every state of `CHAR_STATES` at the
 * facings 0 and 2.2, held long enough for the eased weights to settle, every point finite), as a mechanism.
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
 * stateMatrix(hero, { states: { run: SAMPLE_STATES.run } }).length; // 2: the run at both facings
 * animCheckBody(hero, { states: { wave: SAMPLE_STATES.wave } }).ok; // true: finite, stable, on the floor, rate-proof
 * @see engine/anim/check.test.ts
 */
import { Fnv64 } from '../core/hash';
import { codeError, defineCodes, didYouMean } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import type { Animator } from './character';
import { createWorldPose, forwardKinematics, jointPosition, socketPosition, tipPosition, type WorldPose } from './fk';
import { Pose } from './pose';
import type { SheetView } from './sheet';
import { SAMPLE_STATES, type AnimatorInput } from './states';
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

/** A state the matrix holds: the body states told every step, or a script, for so many seconds. */
export interface MatrixState {
  /** The body states told every step it holds, in the body's frame (+Z ahead): `SAMPLE_STATES` entries fit. */
  readonly states?: Readonly<AnimatorInput>;
  /**
   * Or a script: given the fresh animator and the facing (it may add layers), what to tell the body at each step, in
   * the body's frame, called once per step with the step's seconds, from the hold to the end of the run, so what it
   * plays (an attack, a reaction) ends and settles on its own.
   */
  readonly script?: (animator: Animator, facing: number) => (dt: number) => AnimatorInput;
  /** How long it holds, seconds. */
  readonly seconds: number;
}

/** The state matrix's defaults. */
export const STATE_MATRIX = {
  /** Radians: ahead, and a turn that lines up with no axis (my-3d2dge's `checkRig`). */
  facings: [0, 2.2],
  /** Seconds at rest before each state, and after it. */
  lead: 0.3,
  after: 0.5,
  /** Metres a joint may drift between 1/60 s and 1/120 s steps, beyond a step of its own motion (`rateDrift`). */
  rate: 0.02,
} as const;

/** What `stateMatrix` runs. */
export interface StateMatrixOptions {
  /** The states, by name; `SAMPLE_STATES` by default. */
  states?: Readonly<Record<string, MatrixState>>;
  /** The facings, radians; `STATE_MATRIX.facings` by default. */
  facings?: readonly number[];
  /** The fixed step, seconds; `SIM_DT` by default. */
  dt?: number;
  /** Seconds at rest before each state; `STATE_MATRIX.lead` by default. */
  lead?: number;
  /** Seconds at rest after each state; `STATE_MATRIX.after` by default. */
  after?: number;
  /** Called after each step, the pose recorded: to read the animator's state as well. */
  onStep?: (animator: Animator, run: MatrixRun) => void;
}

/** One run of the matrix: a state held at a facing, from rest and back to rest, one pose per step. */
export interface MatrixRun {
  readonly state: string;
  readonly facing: number;
  readonly dt: number;
  readonly skeleton: Skeleton;
  /** The pose after each step. */
  readonly poses: Pose[];
  /** The body's position at each step: the ground point under it, raised in a jump, world metres. */
  readonly positions: Vector3[];
  /** The steps holding the state: from the first up to, not including, the second. */
  readonly held: readonly [number, number];
  /** The ground's own velocity under the body while it holds the state (running in place, `run`), m/s. */
  readonly treadmill: Vector3;
}

const UP = new Vector3(0, 1, 0);

/** Holds `state` on a fresh body at `facing`, from rest and back to rest. */
function runState(
  make: (dt: number) => Animator,
  name: string,
  state: MatrixState,
  facing: number,
  options: StateMatrixOptions,
): MatrixRun {
  const dt = options.dt ?? SIM_DT;
  const animator = make(dt);
  const steps = (seconds: number) => Math.max(0, Math.round(seconds / dt));
  const lead = steps(options.lead ?? STATE_MATRIX.lead);
  const end = lead + Math.max(1, steps(state.seconds));
  const turn = new Quaternion().setFromAxisAngle(UP, facing);
  const speed = (state.states?.run ?? 0) * animator.body.build.speedRef;
  const run: MatrixRun = {
    ...{ state: name, facing, dt, skeleton: animator.body.skeleton, poses: [], positions: [], held: [lead, end] },
    treadmill: new Vector3(0, 0, -speed).applyQuaternion(turn),
  };
  const script = state.script?.(animator, facing);
  const ground = new Vector3();
  for (let i = 0; i < end + steps(options.after ?? STATE_MATRIX.after); i++) {
    const told: AnimatorInput = i < lead ? {} : script ? script(dt) : i < end ? { ...state.states } : {};
    const position = (told.position?.clone() ?? new Vector3()).applyQuaternion(turn).add(ground);
    const velocity = told.velocity?.clone().applyQuaternion(turn);
    animator.update({ ...told, velocity, position, yaw: facing });
    if (velocity) ground.addScaledVector(velocity, dt).setY(0);
    run.poses.push(animator.body.pose.clone());
    run.positions.push(position);
    options.onStep?.(animator, run);
  }
  return run;
}

/**
 * The state matrix: a fresh body from `make(dt)` holds each state at each facing, from rest and back to rest, and
 * the pose after every step is kept. The body is an animator, so its layers (reactions, secondary motion) run too.
 */
export function stateMatrix(make: (dt: number) => Animator, options: StateMatrixOptions = {}): MatrixRun[] {
  const facings = options.facings ?? STATE_MATRIX.facings;
  return Object.entries(options.states ?? SAMPLE_STATES).flatMap(([name, state]) =>
    facings.map((facing) => runState(make, name, state, facing, options)),
  );
}

/** A run's 64-bit FNV-1a digest over every pose, 16 hex digits: the same run, the same hash. */
export function hashRun(run: MatrixRun): string {
  const hash = new Fnv64();
  for (const pose of run.poses) hash.numbers(pose.toArray());
  return hash.hex();
}

/** The points `runPoints` measures, in order: the joints, then the sockets. */
export const RUN_POINTS: readonly string[] = [...JOINTS, ...SOCKETS];

/** Each step's joints and sockets (`RUN_POINTS`), measured from the body's position: what a rate or a pop compares. */
export function runPoints(run: MatrixRun): Vector3[][] {
  const world = createWorldPose();
  return run.poses.map((pose, i) => {
    forwardKinematics(run.skeleton, pose, world);
    const sockets = SOCKETS.map((name) => socketPosition(run.skeleton, world, name));
    return [...JOINTS.map((_, j) => jointPosition(world, j)), ...sockets].map((p) => p.sub(run.positions[i]));
  });
}

/**
 * How far points stray between a run (`coarse`, points per step) and the same run at half the step, beyond what each
 * moves in one coarse step either side (two discretizations of a fast motion may lie a step apart): the worst excess,
 * its step and its point's index. Step i is compared with half step 2i + 1, the same moment.
 */
export function rateDrift(
  coarse: readonly (readonly Vector3[])[],
  fine: readonly (readonly Vector3[])[],
): { worst: number; frame: number; point: number } {
  const drift = { worst: 0, frame: 0, point: 0 };
  const steps = Math.min(coarse.length, fine.length >> 1);
  for (let i = 0; i < steps; i++) {
    const [before, now, after] = [coarse[Math.max(0, i - 1)], coarse[i], coarse[Math.min(i + 1, coarse.length - 1)]];
    now.forEach((p, k) => {
      const off = p.distanceTo(fine[2 * i + 1][k]) - Math.max(p.distanceTo(before[k]), p.distanceTo(after[k]));
      if (off > drift.worst) Object.assign(drift, { worst: off, frame: i, point: k });
    });
  }
  return drift;
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

/** The cameras sheets of the matrix draw each frame from: presets of `anim.sheet()`'s views (engine/anim/sheet.ts). */
export const SHEET_CAMERAS = {
  /** How a body stands: from the front, from its right and three-quarters. */
  body: ['front', 'side', 'threeQuarter'],
  /** A strike: its arc from the side, from above and three-quarters. */
  move: ['side', 'top', 'threeQuarter'],
  /** All round: front, three-quarters, side and back. */
  turntable: ['front', 'threeQuarter', 'side', 'back'],
} as const satisfies Readonly<Record<string, readonly SheetView[]>>;
