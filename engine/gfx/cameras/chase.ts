/**
 * @file The chase camera (PLAN.md WP 3.9, §6.1; doctrine: Common ground, Quality under the hood): a perspective camera
 * on a spring arm behind and above the hero, turned by the devices, that slides in front of a wall rather than through
 * it, as Unreal's spring arm and Cinemachine's third-person follow do. `stepChase` and `chasePose` are the pure steps;
 * `createChaseCamera` wraps them in a camera.
 *
 * The arm hangs from a pivot `CHASE_HEIGHT` above `input.follow` (the hero's feet), which follows with a time constant
 * of `CHASE_LAG` real seconds, and runs back against the view direction (`yaw`, `pitch`) for `distance`. `input.look`
 * and `input.turn` turn the view right and up; `input.zoom` steps the arm in by `ORBIT_ZOOM_STEP`.
 *
 * Walls: through the sim's read-only `QueryView` (`input.queries`, from its snapshot; gfx never imports physics/), a
 * ball of `CHASE_RADIUS` (wider than the near plane's corners) is cast from the hero's head (the pivot before its lag)
 * to the pivot, then along the arm, and stops `CHASE_SKIN` short of the first surface of `input.groups` (`world`, the
 * level, by default; `input.exclude` skips his own body). The arm snaps in at once and eases back out with a time
 * constant of `CHASE_RETURN`, never past what the casts left clear. Without `queries` nothing shortens it.
 *
 * Invariants: with `queries`, and the hero's head at least `CHASE_RADIUS` from every wall (a character's capsule is
 * wider), the camera's ball, so its near plane, never ends inside a wall, and the line from the head to the camera is
 * clear (chase.test.ts walks fixtures/scenes/chase-walls/ to prove it). The pitch stays within `CHASE_LIMITS.pitch`,
 * the arm within `CHASE_LIMITS.distance`. Pure: each step returns a new state.
 *
 * Codes: `cam3=chase[,<yaw>,<pitch>,<distance>]` (degrees, metres; a bare one keeps the last camera's heading). Until
 * codes.ts reads WP 3.9's cameras, this file holds what they share: `readCode`, `codeNumber`, `followCamera`.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:84-94` (`chasePose`: the arm, its pitch, lens and lag, the
 * pull in front of a wall) and `:37` (its numbers), in metres and +Y up, the height-map march replaced by ball casts.
 *
 * @example
 * import { startScene } from '../../sim/scene';
 * import { queryViewOf } from '../../sim/queryView';
 * import chaseWalls from '../../../fixtures/scenes/chase-walls';
 * const chase = createChaseCamera();
 * const pose = chase.update({ follow: [2, 0, 3] }, 1 / 60); // the first follow snaps to the hero
 * pose.position; // [2, 3.44…, -2.15…]: 5.5 m back from 1.5 m above his feet, looking along +Z and 20.6° down
 * chase.code(); // 'cam3=chase,0,-20.63,5.5'
 * const { world } = startScene(chaseWalls);
 * world.step({}); // queries see the level from the first step
 * createChaseCamera().update({ follow: [1.5, 0, 1.5], queries: queryViewOf(world) }).distance; // 0.299…: a wall behind
 * @see engine/gfx/cameras/chase.test.ts
 */
import { codeError, didYouMean } from '../../core/log';
import { MathUtils } from '../../core/math';
import type { QueryView } from '../../sim/queryView';
import { ORBIT_ZOOM_STEP } from './orbit';
import {
  approach,
  makePose,
  poseForward,
  rangeProblems,
  refuse,
  wrapAngle,
  type Camera,
  type CameraInput,
  type CameraPose,
  type Vec3,
} from './pose';

const DEG = MathUtils.DEG2RAD;

/** The arm's starting pitch (rad, + up), length (m) and the lens (degrees, `PerspectiveCamera.fov`). */
export const CHASE_DEFAULTS = Object.freeze({ pitch: -0.36, distance: 5.5, fov: 60 });
/** The range of the pitch (rad) and the arm's length (m). */
export const CHASE_LIMITS = Object.freeze({ pitch: [-1.4, 1] as const, distance: [0.5, 20] as const });
/** The pivot's height above the followed point, m: the hero's head. */
export const CHASE_HEIGHT = 1.5;
/** The time constant of the pivot's follow, real seconds. */
export const CHASE_LAG = 1 / 12;
/** The time constant of the arm easing back out after a wall, real seconds. */
export const CHASE_RETURN = 0.3;
/** The radius of the ball cast along the arm, m: wider than the near plane's corners (0.09 m at 60° and 21:9). */
export const CHASE_RADIUS = 0.2;
/** How far short of a surface the ball stops, m. */
export const CHASE_SKIN = 0.02;
/** Turn rates at full `input.turn`, rad/s: `[right, up]` (the prototype's [ ] keys turn 2.2). */
export const CHASE_TURN_SPEED = Object.freeze([2.2, 1.2] as const);
/** The chase camera's near plane, m. */
const NEAR = 0.05;

/** The collision groups a query hits, as the `QueryView` names them. */
export type QueryGroups = NonNullable<Parameters<QueryView['raycast']>[2]>['groups'];

/** A chase camera's input: the devices' and the hero's, and the sim's queries for its walls. */
export interface ChaseInput extends CameraInput {
  /** The sim's read-only queries (its snapshot's `QueryView`); without them the arm passes through walls. */
  readonly queries?: QueryView;
  /** The groups that stop the arm (`world`, the level, by default). */
  readonly groups?: QueryGroups;
  /** A body the arm passes through: the hero's own, when `groups` holds his. */
  readonly exclude?: number;
}

/** A chase camera's code as data: without the numbers it keeps the heading of the camera before it. */
export interface ChaseSpec {
  readonly type: 'chase';
  /** The heading, rad (the intents' `cam`). */
  readonly yaw?: number;
  /** Rad, + up. */
  readonly pitch?: number;
  /** The arm's length when nothing is in the way, m. */
  readonly distance?: number;
}

/** A chase camera's state: plain data, replaced by each step. */
export interface ChaseState {
  readonly yaw: number;
  readonly pitch: number;
  /** The arm's length when nothing is in the way, m. */
  readonly distance: number;
  /** The lens, degrees. */
  readonly fov: number;
  /** The pivot, m: `CHASE_HEIGHT` above the followed point, with its lag; null until the first follow. */
  readonly pivot: Vec3 | null;
  /** The arm after the walls, m: at most `distance`. */
  readonly arm: number;
}

/** Options for a chase camera: its code's data, the lens, and the camera before it. */
export interface ChaseOptions extends Omit<ChaseSpec, 'type'> {
  readonly fov?: number;
  /** The camera before this one: a chase without a yaw keeps its heading. */
  readonly from?: CameraPose;
}

/** A checked chase state for `options`. Throws `GFX_BAD_CAMERA`. */
export function chaseState(options: ChaseOptions = {}): ChaseState {
  const distance = options.distance ?? CHASE_DEFAULTS.distance;
  const state: ChaseState = {
    yaw: options.yaw ?? options.from?.yaw ?? 0,
    pitch: options.pitch ?? CHASE_DEFAULTS.pitch,
    distance,
    fov: options.fov ?? CHASE_DEFAULTS.fov,
    pivot: null,
    arm: distance,
  };
  refuse('the chase camera', [
    ...rangeProblems({
      yaw: [state.yaw, -1e6, 1e6],
      pitch: [state.pitch, ...CHASE_LIMITS.pitch],
      distance: [state.distance, ...CHASE_LIMITS.distance],
      fov: [state.fov, 1, 179],
    }),
  ]);
  return state;
}

/** How far a ball of `CHASE_RADIUS` gets from `from` along the unit `dir`, up to `max`: `CHASE_SKIN` short of a hit. */
function reach(input: ChaseInput, queries: QueryView, from: Vec3, dir: Vec3, max: number): number {
  if (max < 1e-6) return max;
  const { groups = 'world', exclude } = input;
  const ball = { type: 'ball', radius: CHASE_RADIUS } as const;
  const hit = queries.shapeCast(ball, from, dir, { maxDistance: max, margin: CHASE_SKIN, groups, exclude });
  return hit ? hit.distance : max;
}

/** Steps a chase camera by one rendered frame: turned by `look` and `turn`, `zoom` on the arm, following, walls. */
export function stepChase(state: ChaseState, input: ChaseInput, dt: number): ChaseState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * CHASE_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * CHASE_TURN_SPEED[1] * dt;
  const yaw = wrapAngle(state.yaw - right);
  const pitch = MathUtils.clamp(state.pitch + up, ...CHASE_LIMITS.pitch);
  const zoomed = state.distance / Math.pow(ORBIT_ZOOM_STEP, input.zoom ?? 0);
  const distance = MathUtils.clamp(zoomed, ...CHASE_LIMITS.distance);
  const f = input.follow;
  const head: Vec3 | null = f ? [f[0], f[1] + CHASE_HEIGHT, f[2]] : null;
  let pivot = head && state.pivot ? approach(state.pivot, head, 1 - Math.exp(-dt / CHASE_LAG)) : (head ?? state.pivot);
  let clear = distance;
  const { queries } = input;
  if (queries && pivot) {
    if (head) {
      const lag: Vec3 = [pivot[0] - head[0], pivot[1] - head[1], pivot[2] - head[2]];
      const gap = Math.hypot(...lag);
      // The lag never takes the pivot through a wall: it stops where a ball from the head would (twice the skin
      // short, so the arm's own cast starts clear of the surface).
      const room = gap > 1e-6 ? reach(input, queries, head, [lag[0] / gap, lag[1] / gap, lag[2] / gap], gap) : gap;
      const t = gap > 1e-6 ? Math.max(0, room - CHASE_SKIN) / gap : 0;
      pivot = room < gap ? [head[0] + lag[0] * t, head[1] + lag[1] * t, head[2] + lag[2] * t] : pivot;
    }
    const [fx, fy, fz] = poseForward({ yaw, pitch });
    clear = reach(input, queries, pivot, [-fx, -fy, -fz], distance);
  }
  const eased = state.arm + (distance - state.arm) * (1 - Math.exp(-dt / CHASE_RETURN));
  return { ...state, yaw, pitch, distance, pivot, arm: Math.min(clear, eased, distance) };
}

/** The chase camera's pose: `arm` metres back from the pivot along its view direction, looking at the pivot. */
export function chasePose(state: ChaseState): CameraPose {
  const [px, py, pz] = state.pivot ?? [0, CHASE_HEIGHT, 0];
  const [fx, fy, fz] = poseForward(state);
  const arm = state.arm;
  return makePose({
    position: [px - fx * arm, py - fy * arm, pz - fz * arm],
    yaw: state.yaw,
    pitch: state.pitch,
    fov: state.fov,
    near: NEAR,
    far: 500,
    distance: arm,
  });
}

/** The chase camera's code data. */
export function chaseSpec(state: ChaseState): ChaseSpec {
  return { type: 'chase', yaw: state.yaw, pitch: state.pitch, distance: state.distance };
}

/** A number as a camera code writes it: rounded to `places` decimals, shortest form, never `-0` (as codes.ts). */
export function codeNumber(value: number, places: number): string {
  const k = Math.pow(10, places);
  const rounded = Math.round(value * k) / k;
  return String(rounded === 0 ? 0 : rounded);
}

/** Radians as a code writes them: degrees to 0.01, wrapped into (−180, 180] when `wrap` (headings). */
export function codeDegrees(rad: number, wrap = false): string {
  const d = Math.round((rad / DEG) * 100) / 100;
  if (!wrap) return codeNumber(d, 2);
  const w = ((d % 360) + 360) % 360;
  return codeNumber(w > 180 ? w - 360 : w, 2);
}

/** One number of a code: its name and the range it must be in, as written (degrees, metres). */
export type CodePart = readonly [name: string, min: number, max: number];

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * The numbers of `cam3=<name>[,…]` (with or without the `?` and the key): as many as one of `counts`, each within
 * its `parts` range. Throws `GFX_UNKNOWN_CAMERA` for another name, `GFX_BAD_CAMERA_CODE` listing every problem.
 */
export function readCode(code: string, name: string, parts: readonly CodePart[], counts: readonly number[]): number[] {
  const text = String(code).trim().replace(/^\?/, '');
  const keyed = /^(cam3?)=(.*)$/.exec(text);
  const [head, ...words] = (keyed ? keyed[2] : text).split(',').map((word) => word.trim());
  if (head !== name) {
    const values = { name: JSON.stringify(head), suggestion: didYouMean(head, [name]), names: name };
    throw codeError('GFX_UNKNOWN_CAMERA', values);
  }
  const problems: string[] = [];
  if (keyed?.[1] === 'cam') problems.push(`${name} is a 3D camera: write cam3=${name}`);
  if (words.some((word) => word === '')) problems.push('it has an empty part (two commas, or nothing after one)');
  else if (!counts.includes(words.length)) {
    const form = `${name}[, ${parts.map(([part]) => part).join(', ')}]`;
    const allowed = counts.length > 1 ? `${counts.slice(0, -1).join(', ')} or ${counts.at(-1)}` : `${counts[0]}`;
    problems.push(`cam3=${form} takes ${allowed} numbers, not ${words.length}`);
  }
  const values = words.map((word, i) => {
    const [part, min, max] = parts[i] ?? [`part ${i + 2}`, -Infinity, Infinity];
    if (!NUMBER.test(word)) problems.push(`part ${i + 2} (${word}) is not a number`);
    else if (!(Number(word) >= min && Number(word) <= max))
      problems.push(`${part} is ${word}; it must be from ${min} to ${max}`);
    return Number(word);
  });
  if (problems.length) throw codeError('GFX_BAD_CAMERA_CODE', { code: text, problems: problems.join('; ') });
  return values;
}

/** Reads a chase camera's code: `cam3=chase[,<yaw>,<pitch>,<distance>]`. Throws `GFX_BAD_CAMERA_CODE`. */
export function parseChaseCode(code: string): ChaseSpec {
  const parts: CodePart[] = [
    ['yaw', -1e6, 1e6],
    ['pitch', CHASE_LIMITS.pitch[0] / DEG, CHASE_LIMITS.pitch[1] / DEG],
    ['distance', ...CHASE_LIMITS.distance],
  ];
  const [yaw, pitch, distance] = readCode(code, 'chase', parts, [0, 3]);
  return yaw === undefined ? { type: 'chase' } : { type: 'chase', yaw: yaw * DEG, pitch: pitch * DEG, distance };
}

/** The canonical code of a chase camera's data (numbers rounded: 0.01°, 0.001 m). */
export function formatChaseCode(spec: ChaseSpec): string {
  if (spec.yaw === undefined) return 'cam3=chase';
  const pitch = spec.pitch ?? CHASE_DEFAULTS.pitch;
  const distance = spec.distance ?? CHASE_DEFAULTS.distance;
  return `cam3=chase,${codeDegrees(spec.yaw, true)},${codeDegrees(pitch)},${codeNumber(distance, 3)}`;
}

/** A chase camera in words. */
export function describeChase(spec: ChaseSpec, pose: CameraPose): string {
  const lens = `Chase camera (perspective, ${codeNumber(pose.fov, 0)}° field of view)`;
  const arm = codeNumber(spec.distance ?? CHASE_DEFAULTS.distance, 3);
  return `${lens}, ${arm} m behind, heading ${codeDegrees(pose.yaw, true)}°, pitch ${codeDegrees(pose.pitch)}°`;
}

/** A WP 3.9 camera: a `Camera` (engine/gfx/cameras/pose.ts) whose type and code data codes.ts does not list yet. */
export interface FollowCamera<T extends string, S, I extends CameraInput> extends Omit<
  Camera,
  'type' | 'update' | 'spec'
> {
  readonly type: T;
  /** Steps the camera by one rendered frame (`dt` real seconds) and returns its new pose. */
  update(input?: I, dt?: number): CameraPose;
  /** The camera as its code's data. */
  spec(): S;
}

/** What a WP 3.9 camera gives `followCamera`: its pure steps, as `CameraSteps`, and its code and words. */
export interface FollowSteps<St, S, I> {
  step(state: St, input: I, dt: number): St;
  pose(state: St): CameraPose;
  spec(state: St): S;
  code(spec: S): string;
  describe(spec: S, pose: CameraPose): string;
}

/** Wraps a camera's pure steps and first state in a camera, as `cameraFrom` does for the cameras codes.ts lists. */
export function followCamera<T extends string, St, S, I extends CameraInput>(
  type: T,
  first: St,
  steps: FollowSteps<St, S, I>,
): FollowCamera<T, S, I> {
  let state = first;
  let pose = steps.pose(state);
  return {
    type,
    update(input = {} as I, dt = 0) {
      refuse(`${type} camera update`, rangeProblems({ dt: [dt, 0, 3600] }));
      state = steps.step(state, input, dt);
      pose = steps.pose(state);
      return pose;
    },
    pose: () => pose,
    yaw: () => wrapAngle(pose.yaw),
    spec: () => steps.spec(state),
    code: () => steps.code(steps.spec(state)),
    describe: () => steps.describe(steps.spec(state), pose),
  };
}

/** A chase camera: behind the hero on its arm, following `input.follow`, in front of the walls `input.queries` sees. */
export function createChaseCamera(options: ChaseOptions = {}): FollowCamera<'chase', ChaseSpec, ChaseInput> {
  return followCamera('chase', chaseState(options), {
    step: stepChase,
    pose: chasePose,
    spec: chaseSpec,
    code: formatChaseCode,
    describe: describeChase,
  });
}
