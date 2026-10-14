/**
 * @file The state matrix (PLAN.md WP 3.4, WP 6.6): `stateMatrix` drives a fresh animator through each body state,
 * held from rest and back to rest, at each facing of `STATE_MATRIX`, one pose per step. engine/anim/check.ts
 * `animCheckBody` checks its runs (every pose, the same hash twice: `hashRun`, and the rate against half the step:
 * `rateDrift`); the `anim` QA family (tools/qa/anim.ts) measures their motion through `runPoints`, and `x sheet` draws
 * them from the cameras of `SHEET_CAMERAS`.
 *
 * Invariants:
 * - Deterministic: the same body and options give the same runs.
 * - The matrix tells its states in the body's own frame (+Z ahead, as `SAMPLE_STATES` are written), turned to each
 *   facing, and starts each run from a fresh body (`make(dt)`), so runs never leak into each other.
 *
 * Carried from `my-3d2dge:src/emberdeep/18-characters.js:82-143` (`checkRig`: every state of `CHAR_STATES` at the
 * facings 0 and 2.2, held long enough for the eased weights to settle). Split from check.ts to keep each under 400
 * lines (ADR-0014 amendment 16).
 *
 * @example
 * import { Animator } from './character';
 * import { SAMPLE_STATES } from './states';
 * const hero = (dt: number) => new Animator({ build: 'build:heroic', weapon: 'sword', clock: 1, dt });
 * const runs = stateMatrix(hero, { states: { run: SAMPLE_STATES.run } });
 * runs.length; // 2: the run at both facings
 * hashRun(runs[0]) === hashRun(stateMatrix(hero, { states: { run: SAMPLE_STATES.run } })[0]); // true
 * @see engine/anim/check.test.ts
 */
import { Fnv64 } from '../core/hash';
import { Quaternion, Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';
import type { Animator } from './character';
import { createWorldPose, forwardKinematics, jointPosition, socketPosition } from './fk';
import type { Pose } from './pose';
import type { SheetView } from './sheet';
import { SAMPLE_STATES, type AnimatorInput } from './states';
import { JOINTS, SOCKETS, type Skeleton } from './skeleton';

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
/** The cameras sheets of the matrix draw each frame from: presets of `anim.sheet()`'s views (engine/anim/sheet.ts). */
export const SHEET_CAMERAS = {
  /** How a body stands: from the front, from its right and three-quarters. */
  body: ['front', 'side', 'threeQuarter'],
  /** A strike: its arc from the side, from above and three-quarters. */
  move: ['side', 'top', 'threeQuarter'],
  /** All round: front, three-quarters, side and back. */
  turntable: ['front', 'threeQuarter', 'side', 'back'],
} as const satisfies Readonly<Record<string, readonly SheetView[]>>;
