/**
 * @file The traversal and holding states of the state matrix (PLAN.md WP 13.11, docs/PLAYGROUND.md §5.1): the ways the
 * playground's player traverses and holds, as `stateMatrix` runs them (engine/anim/stateMatrix.ts), so the anim QA
 * family measures them and `x sheet` draws them for a `plantedStride` build (tools/qa/anim.ts `humanoidStates`, ids
 * `traversal:<name>` and `hold:<name>`): the 2 m mantle (`grab`), the grab held as a hang (`hang`), a 1 m wall vaulted
 * at a sprint (`vault`), a wall-climb let go (`climb`), up and back down a ladder (`ladder`), a zipline ridden and let
 * go (`zipline`), the skydive's glide, dive and landing (`skydive`), a slide-jump (`slideJump`), a gun aimed through a
 * sweep of pitch and heading (`hold:aim`) and lowered at a sprint (`hold:sprint`).
 *
 * Each is a script that tells the body what the sim would (its velocity, height and airborne flag; a mantle's feet
 * moved along its path with no velocity, as engine/physics/movement/mantle.ts moves them) and, at each step, the view's
 * traversal pose the shooter model's state as plain data (the lip, the wall, the ride, in the world: the body's frame
 * turned to the facing), with the traversal plant and the hold layer attached after the foot plant, as the page's
 * puppets have them (engine/gfx/puppets/actors.ts). The numbers are the playground's (holstered sprint 7.6 m/s, the
 * climb's 5.72 m/s, the ladder's 2.2 m/s, the zipline's 10.16 m/s², the skydive's 20 and 35 m/s, gravity 19.05 m/s²).
 *
 * Invariants: deterministic: each script keeps its state in its own closure, made fresh for each run; the facing turns
 * every point it tells the traversal.
 *
 * @example
 * Object.keys(TRAVERSAL_STATES).includes('traversal:ladder'); // true
 * @see engine/anim/traversal/matrix.test.ts
 */
import { MathUtils, Vector3 } from '../../core/math';
import type { Animator } from '../character';
import type { FootPlant } from '../footPlant';
import { MovementPose, plantsFeet } from '../locomotion/motion';
import type { MatrixState } from '../stateMatrix';
import type { AnimatorInput } from '../states';
import type { RideView, TraversalView } from './contacts';
import { HoldPlant, LookPose, type Look } from './hold';
import { TraversalPlant } from './plant';
import { TraversalPose } from './pose';

/** The playground's numbers the states move at: m/s, m/s², m (engine/anim/locomotion/matrix.ts `MATRIX_MOVE`'s kin). */ // prettier-ignore
const MOVE = { run: 5.068, sprint: 7.595, climb: 5.715, ladder: 2.2, zipline: 10.16, glide: 20, dive: 35, touch: 6.1, gravity: 19.05, jump: 7.36 }; // prettier-ignore

/** The hull the states traverse with: the playground's player's (Apex's medium legends), a zipline's hang, the stage's rungs. */ // prettier-ignore
const HULL = { radius: 0.4064, skin: 0.01, hang: 2.032, rung: 0.3 };

/** What a state does at time `t` (s), in the body's frame: the feet (m), their velocity (m/s), its state, what it rides and looks at. */ // prettier-ignore
interface Moment {
  feet: readonly [number, number, number];
  velocity?: readonly [number, number, number];
  motion: TraversalView;
  ride?: RideView;
  look?: Look;
}

/** A point of the body's frame turned to `facing`, about the run's origin. */
const turned = (p: readonly number[], facing: number): [number, number, number] => [p[0] * Math.cos(facing) + p[2] * Math.sin(facing), p[1], p[2] * Math.cos(facing) - p[0] * Math.sin(facing)]; // prettier-ignore

/** The motion state turned to `facing`: its lip and its wall. */
function turnMotion(m: TraversalView, facing: number): TraversalView {
  const lip = turned([m.lipX ?? 0, m.lipY ?? 0, m.lipZ ?? 0], facing);
  const wall = turned([m.wallX ?? 0, 0, m.wallZ ?? 0], facing);
  return { ...m, lipX: lip[0], lipY: lip[1], lipZ: lip[2], wallX: wall[0], wallZ: wall[2] };
}

/** The ride turned to `facing`. */
function turnRide(r: RideView | undefined, facing: number): RideView | null {
  if (r?.zipline) return { zipline: { from: turned(r.zipline.from, facing), to: turned(r.zipline.to, facing) } };
  if (!r?.ladder) return null;
  const normal = turned([r.ladder.normal[0], 0, r.ladder.normal[1]], facing);
  return { ladder: { ...r.ladder, foot: turned(r.ladder.foot, facing), normal: [normal[0], normal[2]] } };
}

/**
 * A matrix state from `at(t)`, held `seconds`, then standing still where it ended (on a floor), so the matrix sees it
 * back at rest: tells the body, eases the view's movement and traversal poses and gates the foot plant, the traversal
 * plant and the hold layer after it (`carry` in its hands).
 */
function traversing(seconds: number, at: (t: number) => Moment, carry: 'gun' | null = null): MatrixState {
  return {
    seconds,
    script: (animator: Animator, facing: number) => {
      const moving = new MovementPose();
      const pose = new TraversalPose();
      const foot = animator.layer('footPlant') as FootPlant | undefined;
      const plant = new TraversalPlant().attach(animator);
      const hold = Object.assign(new HoldPlant().attach(animator), { contacts: plant, carry });
      const looking = new LookPose();
      plant.pose = pose;
      const ground = new Vector3();
      const last = new Vector3();
      let t = 0;
      return (dt): AnimatorInput => {
        const end = (t += dt) > seconds;
        const now = end ? { feet: at(seconds).feet, motion: GROUND } : at(t);
        const v = now.velocity ?? [0, 0, 0];
        const [vx, , vz] = turned(v, facing);
        const local = turned(now.feet, facing);
        const feet = new Vector3(local[0] + ground.x, local[1], local[2] + ground.z);
        const view = turnMotion(now.motion, facing);
        const shift = (p: readonly number[]) => [p[0] + ground.x, p[1], p[2] + ground.z];
        const world = { ...view, lipX: (view.lipX ?? 0) + ground.x, lipZ: (view.lipZ ?? 0) + ground.z };
        const ride = turnRide(now.ride, facing);
        const placed = ride?.zipline ? { zipline: { from: shift(ride.zipline.from), to: shift(ride.zipline.to) } } : ride?.ladder ? { ladder: { ...ride.ladder, foot: shift(ride.ladder.foot) } } : null; // prettier-ignore
        const body = { vx, vy: dt > 0 ? (feet.y - last.y) / dt : 0, vz, yaw: facing };
        last.copy(feet);
        moving.update(world, dt, body).apply(animator);
        pose.update(world, placed, HULL, animator.body.build, feet, body, dt);
        if (foot) [foot.locks, foot.weight] = [plantsFeet(world), pose.plantShare];
        if (foot?.weight === 0) foot.reset();
        hold.busy = end ? Math.min(1, hold.busy + dt / 0.3) : pose.weight; // at its end it lowers the gun to rest
        hold.look = looking.update(now.look ? { ...now.look, yaw: now.look.yaw + facing } : null, dt).look;
        [ground.x, ground.z] = [ground.x + vx * dt, ground.z + vz * dt]; // as the matrix moves the body, after the step
        const air = world.mode !== 'ground';
        const crouch = world.duck === 'ducked';
        const told = { velocity: new Vector3(v[0], v[1], v[2]), position: new Vector3(now.feet[0], now.feet[1], now.feet[2]), air }; // prettier-ignore
        return crouch ? { ...told, pose: 'crouch' } : told;
      };
    },
  };
}

/** A point `s` (0 to 1) of the way along the polyline `points`, by length. */
function along(points: readonly (readonly [number, number, number])[], s: number): [number, number, number] {
  const legs = points.slice(1).map((b, k) => Math.hypot(b[0] - points[k][0], b[1] - points[k][1], b[2] - points[k][2])); // prettier-ignore
  let left = MathUtils.clamp(s, 0, 1) * legs.reduce((a, b) => a + b, 0);
  for (let k = 0; k < legs.length; k++) {
    if (left <= legs[k] && legs[k] > 0) {
      const [a, b, u] = [points[k], points[k + 1], left / legs[k]];
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    left -= legs[k];
  }
  return [...points[points.length - 1]] as [number, number, number];
}

/** A mantle up a wall `height` m high whose face stands `face` m ahead: its lip and wall, its rise column, its top and its landing. */ // prettier-ignore
function wall(height: number, face: number) {
  const rise = face - (HULL.radius + HULL.skin);
  const lip = { lipX: 0, lipY: height, lipZ: face + 2 * HULL.skin, wallX: 0, wallZ: -1 };
  return { lip, rise, top: height + 2 * HULL.skin, landing: face + HULL.radius + 2 * HULL.skin };
}

const GROUND: TraversalView = { mode: 'ground' };
const [GRAB, PULL] = [27, 18]; // ticks
const DT = 1 / 60;

/** The 2 m mantle, the grab held `hang` seconds as a hang from 0.3 of the way. */
function mantle(hang: number): MatrixState {
  const w = wall(2, 0.85);
  const [g, p] = [GRAB * DT, PULL * DT];
  return traversing(0.3 + g + hang + p + 0.4, (time) => {
    const t = time - 0.1;
    const grabbed = hang > 0 ? Math.min(t, 0.3 * g) + Math.max(0, t - 0.3 * g - hang) : t; // the grab's own time
    const hanging = hang > 0 && t > 0.3 * g && t < 0.3 * g + hang;
    const path: [number, number, number][] = [
      [0, 0, 0.2],
      [0, 0, w.rise],
      [0, w.top, w.rise],
    ];
    if (t < 0) return { feet: [0, 0, 0.2], motion: GROUND };
    if (grabbed < g) {
      const left = Math.round((g - grabbed) / DT);
      return { feet: along(path, grabbed / g), motion: { mode: 'mantle', mantle: hanging ? 'hang' : 'grab', mantleLeft: left, mantleTotal: GRAB, fromY: 0, ...w.lip, duck: 'ducked' } }; // prettier-ignore
    }
    const u = Math.min((grabbed - g) / p, 1);
    if (u < 1) return { feet: along([[0, w.top, w.rise], [0, w.top, w.landing], [0, 2, w.landing]], u), motion: { mode: 'mantle', mantle: 'pull', mantleLeft: Math.round((1 - u) * PULL), mantleTotal: PULL, fromY: w.top, ...w.lip, duck: 'ducked' } }; // prettier-ignore
    return { feet: [0, 2, w.landing], motion: GROUND };
  });
}

/** The traversal and holding states, by matrix id (see the file comment). */
export const TRAVERSAL_STATES: Readonly<Record<string, MatrixState>> = {
  'traversal:grab': mantle(0),
  'traversal:hang': mantle(0.6),
  'traversal:vault': traversing(1.1, (t) => {
    const w = wall(1, 0.85 + MOVE.sprint * 0.3);
    if (t < 0.3) return { feet: [0, 0, 0], velocity: [0, 0, MOVE.sprint], motion: GROUND };
    const u = (t - 0.3) / (PULL * DT);
    const start = MOVE.sprint * 0.3;
    if (u < 1) return { feet: along([[0, 0, start], [0, 0, w.rise], [0, w.top, w.rise], [0, w.top, w.landing], [0, 1, w.landing]], u).map((x, k) => (k === 2 ? x - start : x)) as [number, number, number], motion: { mode: 'mantle', mantle: 'pull', mantleLeft: Math.round((1 - u) * PULL), mantleTotal: PULL, fromY: 0, ...w.lip, lipZ: w.lip.lipZ - start } }; // prettier-ignore
    return { feet: [0, 1, w.landing - start], velocity: [0, 0, MOVE.sprint], motion: GROUND };
  }),
  'traversal:climb': traversing(1.3, (t) => {
    const climbing = { mode: 'climb', wallX: 0, wallZ: -1, attachY: 0.6 };
    if (t < 0.5) return { feet: [0, 0.6 + MOVE.climb * t, 0], velocity: [0, MOVE.climb, 0], motion: climbing };
    const f = t - 0.5; // let go: it falls back down
    const y = Math.max(0, 0.6 + MOVE.climb * 0.5 - (MOVE.gravity * f * f) / 2);
    return { feet: [0, y, -0.3 * Math.min(f, 0.3)], velocity: [0, y > 0 ? -MOVE.gravity * f : 0, 0], motion: y > 0 ? { mode: 'air' } : GROUND }; // prettier-ignore
  }),
  'traversal:ladder': traversing(3.4, (t) => {
    const ladder = { foot: [0, 0, HULL.radius + 0.1016], top: 4.5, normal: [0, -1], width: 0.6 };
    const h = t < 1.5 ? MOVE.ladder * t : t < 1.8 ? MOVE.ladder * 1.5 : Math.max(0, MOVE.ladder * (1.5 - (t - 1.8))); // up, a stop, down
    const speed = t < 1.5 ? MOVE.ladder : t < 1.8 || h === 0 ? 0 : -MOVE.ladder;
    if (t > 1.8 && h === 0) return { feet: [0, 0, 0], motion: GROUND }; // off at its foot
    return { feet: [0, h, 0], velocity: [0, speed, 0], motion: { mode: 'ladder', rideSpeed: speed }, ride: { ladder } };
  }),
  'traversal:zipline': traversing(2.9, (t) => {
    const ride = { zipline: { from: [0, 4 + HULL.hang, -10], to: [0, 4 + HULL.hang, 60] } };
    if (t < 1.2) return { feet: [0, 4, 0], velocity: [0, 0, 2 + MOVE.zipline * t], motion: { mode: 'zipline', rideDir: 1, rideSpeed: 2 + MOVE.zipline * t }, ride }; // prettier-ignore
    const f = t - 1.2; // a crouch drops it
    const y = Math.max(0, 4 - (MOVE.gravity * f * f) / 2);
    return { feet: [0, y, 0], velocity: [0, y > 0 ? -MOVE.gravity * f : 0, y > 0 ? 2 + MOVE.zipline * 1.2 : 0], motion: y > 0 ? { mode: 'air' } : GROUND }; // prettier-ignore
  }),
  'traversal:skydive': traversing(2.4, (t) => {
    const [glide, dive] = [0.6, 1.2];
    const fallen = Math.min(t, glide) * MOVE.glide + Math.max(0, Math.min(t, dive) - glide) * MOVE.dive + Math.max(0, t - dive) * MOVE.touch; // prettier-ignore
    const top = glide * MOVE.glide + (dive - glide) * MOVE.dive + 1 * MOVE.touch;
    const y = Math.max(0, top - fallen);
    const vy = t < glide ? -MOVE.glide : t < dive ? -MOVE.dive : -MOVE.touch;
    return { feet: [0, y, 0], velocity: [0, y > 0 ? vy : 0, y > 0 ? 8 : 0], motion: y > 0 ? { mode: 'skydive', landing: t >= dive } : GROUND }; // prettier-ignore
  }),
  'traversal:slideJump': traversing(1.4, (t) => {
    if (t < 0.3 + DT / 2)
      return { feet: [0, 0, 0], velocity: [0, 0, 7.7], motion: { mode: 'ground', duck: 'ducked', sliding: true } }; // prettier-ignore: sliding until the step it jumps
    const f = t - 0.3;
    const y = Math.max(0, MOVE.jump * f - (MOVE.gravity * f * f) / 2);
    return { feet: [0, y, 0], velocity: [0, y > 0 ? MOVE.jump - MOVE.gravity * f : 0, 7.4], motion: y > 0 ? { mode: 'air' } : GROUND }; // prettier-ignore
  }),
  'hold:aim': traversing(
    2.4,
    (t) => {
      const pitch = t < 1.2 ? -0.5 + t / 1.2 : 0.5 * Math.cos(((t - 1.2) / 1.2) * Math.PI);
      const yaw = t < 1.2 ? 0 : 0.6 * Math.sin(((t - 1.2) / 1.2) * 2 * Math.PI);
      return { feet: [0, 0, 0], motion: GROUND, look: { yaw, pitch, aiming: true } };
    },
    'gun',
  ),
  'hold:sprint': traversing(
    1.6,
    (t) => {
      const speed = t < 0.8 ? MOVE.sprint : MathUtils.lerp(MOVE.sprint, MOVE.run, Math.min(1, (t - 0.8) / 0.3));
      return {
        feet: [0, 0, 0],
        velocity: [0, 0, speed],
        motion: GROUND,
        look: { yaw: 0, pitch: -0.1, aiming: t >= 0.8 },
      };
    },
    'gun',
  ),
};
