/**
 * @file The movement states of the state matrix (PLAN.md WP 13.10, docs/PLAYGROUND.md §5.1): every way the playground's
 * player moves, as `stateMatrix` runs them (engine/anim/stateMatrix.ts), so the anim QA family measures them and
 * `x sheet` draws them for a `plantedStride` build (tools/qa/anim.ts `humanoidStates`, ids `motion:<name>`): the walk,
 * the run, the sprint, the walk back, the strafe, the crouch-walk, the slide, a running jump, a fall onto the floor
 * (the hard landing), a run stopping, and a whole turn in place. Each is a script that tells the body its velocity,
 * height and airborne flag in its own frame (and its duck as the pose `crouch`, as the sim tells it:
 * engine/sim/actors.ts) and eases the view's `MovementPose` (engine/anim/locomotion/motion.ts) from the movement
 * model's state as the playground's movement would report it, so the body shows its crouch, slide, air, landing and
 * lean, and the foot plant locks only where the page's would.
 *
 * Speeds are the playground's holstered gaits (engine/physics/movement/model.ts × 1.15), the fall the playground's
 * gravity (19.05 m/s², Apex's 750 u/s²).
 *
 * Invariants: deterministic: each script keeps its state in its own closure, made fresh for each run.
 *
 * @example
 * Object.keys(MOVEMENT_STATES).includes('motion:crouchWalk'); // true
 * @see engine/anim/locomotion/matrix.test.ts
 */
import { Vector3 } from '../../core/math';
import type { Animator } from '../character';
import type { MatrixState } from '../stateMatrix';
import type { AnimatorInput } from '../states';
import { MovementPose, plantsFeet, type MotionView } from './motion';

/**
 * The playground's numbers the states move at, written out (the anim layer never imports physics; matrix.test.ts holds
 * the gaits, gravity and jump to `movement:apex`): m/s, m/s², m. The slide's 7.7 m/s is the script's own start (a
 * sprint's slide, before its boost) and the fall's 6 m the gym tower's height.
 */
export const MATRIX_MOVE = { walk: 2.534, run: 5.068, sprint: 7.595, crouch: 2.337, slide: 7.7, gravity: 19.05, jump: 7.36, fall: 6 }; // prettier-ignore
const MOVE = MATRIX_MOVE;

/** What a state does at time `t` (s): its velocity in the body's frame (m/s), height (m), how it moves and its turn. */
interface Moment {
  velocity: readonly [number, number, number];
  height?: number;
  motion: MotionView;
  yaw?: number;
}

/**
 * A matrix state from `at(t)`, held `seconds`, then standing still to the run's end: tells the body, eases the view's
 * pose and gates the plant's locks.
 */
function moving(seconds: number, at: (t: number) => Moment): MatrixState {
  return {
    seconds,
    script: (animator: Animator, facing: number) => {
      const pose = new MovementPose();
      const plant = animator.layer('footPlant') as { locks?: boolean } | undefined;
      let [t, last] = [0, 0];
      return (dt): AnimatorInput => {
        const now =
          (t += dt) <= seconds ? at(t) : { velocity: [0, 0, 0] as const, motion: GROUND, yaw: at(seconds).yaw };
        const [x, , z] = now.velocity;
        const height = now.height ?? 0;
        const turn = facing + (now.yaw ?? 0);
        const body = { vx: x * Math.cos(turn) + z * Math.sin(turn), vz: z * Math.cos(turn) - x * Math.sin(turn) };
        pose.update(now.motion, dt, { ...body, vy: (height - last) / dt, yaw: turn }).apply(animator);
        if (plant && 'locks' in plant) plant.locks = plantsFeet(now.motion);
        last = height;
        const air = now.motion.mode === 'air';
        const crouch = now.motion.duck === 'ducking' || now.motion.duck === 'ducked'; // the sim tells it so too
        const told = { velocity: new Vector3(x, 0, z), position: new Vector3(0, height, 0), air, yaw: now.yaw ?? 0 };
        return crouch ? { ...told, pose: 'crouch' } : told;
      };
    },
  };
}

const GROUND: MotionView = { mode: 'ground' };
/** A gait held: its velocity in the body's frame. */
const gait = (seconds: number, velocity: Moment['velocity'], motion = GROUND) => moving(seconds, () => ({ velocity, motion })); // prettier-ignore

/** The movement states, by matrix id (see the file comment). */
export const MOVEMENT_STATES: Readonly<Record<string, MatrixState>> = {
  'motion:walk': gait(1.2, [0, 0, MOVE.walk]),
  'motion:run': gait(1, [0, 0, MOVE.run]),
  'motion:sprint': gait(1, [0, 0, MOVE.sprint]),
  'motion:back': gait(1.2, [0, 0, -MOVE.walk]),
  'motion:strafe': gait(1, [MOVE.run, 0, 0]),
  'motion:crouchWalk': gait(1.2, [0, 0, MOVE.crouch], { mode: 'ground', duck: 'ducked' }),
  'motion:slide': moving(1, (t) => ({
    velocity: [0, 0, Math.max(3, MOVE.slide - 4.5 * t)],
    motion: { mode: 'ground', duck: 'ducked', sliding: true, floorX: 0, floorY: 1, floorZ: 0 },
  })),
  'motion:jump': moving(1.5, (t) => {
    const up = t - 0.3; // a run, the flight of a jump's 1.42 m, and a run on
    const height = up > 0 ? Math.max(0, MOVE.jump * up - (MOVE.gravity * up * up) / 2) : 0;
    return { velocity: [0, 0, MOVE.run], height, motion: { mode: up > 0 && height > 0 ? 'air' : 'ground' } };
  }),
  'motion:fall': moving(1.6, (t) => {
    const height = Math.max(0, MOVE.fall - (MOVE.gravity * t * t) / 2); // the gym tower's 6 m: a 15 m/s, hard landing
    return { velocity: [0, 0, 0], height, motion: { mode: height > 0 ? 'air' : 'ground' } };
  }),
  'motion:stop': moving(1.2, (t) => ({ velocity: [0, 0, MOVE.run * Math.min(1, Math.max(0, (0.65 - t) / 0.15))], motion: GROUND })), // prettier-ignore
  'motion:turn': moving(2.2, (t) => ({ velocity: [0, 0, 0], motion: GROUND, yaw: 2 * Math.PI * Math.min(1, t / 2) })),
};
