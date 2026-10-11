/**
 * @file The depth rail (PLAN.md WP 3.9; doctrine: Common ground): side scrolling with depth, a perspective camera on
 * a rail beside the hero, the 2D engine's Mode 7 side view. It follows him along the rail and keeps him between a
 * `near` and a `far` distance in depth, so he shrinks walking away into the level and grows coming back. `stepRail`
 * and `railPose` are the pure steps; `createRailCamera` wraps them in a camera.
 *
 * The rail stands on the `azimuth` side of the hero (round him from +Z toward +X, as the views' azimuth; 0, the side
 * view's side, by default), `RAIL_HEIGHT` above him, and looks straight across, tilted `RAIL_TILT` down. Along the rail
 * and in height it follows `input.follow` with a time constant of `RAIL_LAG` real seconds; in depth it stays put while
 * he is between `near` and `far` from it, and otherwise moves, twice as fast, only as far as brings him back within
 * them. `input.zoom` steps the zoom through the views' steps (`VIEW_ZOOMS`). Its yaw never turns, so W walks into the
 * depth and D along the rail, to the right of the picture.
 *
 * Invariants: it starts `RAIL_START` out from the hero; settled, his depth from the rail is within [near, far]. Pure:
 * each step returns a new state.
 *
 * Codes: `cam3=rail[,<azimuth>,<near>,<far>[,<zoom>]]` (degrees, metres). The reader and the camera wrapper are
 * engine/gfx/cameras/chase.ts's, shared by WP 3.9's cameras.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:71-81` (`railPose`: the follow along, the clamp in depth)
 * and `:42` (`DEPTH`: height, tilt, lens, near and far), in metres and +Y up.
 *
 * @example
 * const rail = createRailCamera();
 * rail.update({ follow: [2, 0, 0] }, 1 / 60).position; // [2, 4.375, 10]: RAIL_START out on +Z, RAIL_HEIGHT up
 * rail.yaw(); // π: it looks along −Z, into the depth
 * rail.code(); // 'cam3=rail,0,6.875,16.25'
 * @see engine/gfx/cameras/rail.test.ts
 */
import { codeError } from '../../core/log';
import { MathUtils } from '../../core/math';
import { codeDegrees, codeNumber, followCamera, readCode, type CodePart, type FollowCamera } from './chase';
import { headingOf, makePose, rangeProblems, refuse, type CameraInput, type CameraPose } from './pose';
import { stepZoom } from './presets';

const DEG = MathUtils.DEG2RAD;

/** The hero's depth from the rail is kept between `near` and `far`, m (the prototype's 110 and 260 units). */
export const RAIL_DEFAULTS = Object.freeze({ near: 6.875, far: 16.25 });
/** How far out the rail starts from the hero, m. */
export const RAIL_START = 10;
/** The rail's height above the hero, m. */
export const RAIL_HEIGHT = 4.375;
/** How far the rail looks down, rad. */
export const RAIL_TILT = 14 * DEG;
/** The rail's lens, degrees (`PerspectiveCamera.fov`). */
export const RAIL_FOV = 50;
/** The time constant of the follow along the rail and in height, real seconds; depth moves at twice the rate. */
export const RAIL_LAG = 0.2;

/** A depth rail's code as data. */
export interface RailSpec {
  readonly type: 'rail';
  /** The side of the hero it stands on, rad (round him from +Z toward +X). */
  readonly azimuth?: number;
  /** The hero's depth from the rail is kept between `near` and `far`, m. */
  readonly near?: number;
  readonly far?: number;
  /** As three.js cameras' `zoom`. */
  readonly zoom?: number;
}

/** A depth rail's state: plain data, replaced by each step. */
export interface RailState {
  readonly azimuth: number;
  readonly near: number;
  readonly far: number;
  readonly zoom: number;
  /** Where it is along the rail, m (along the picture's right); null until the first follow. */
  readonly along: number | null;
  /** How far it stands out on its side, m (along the azimuth). */
  readonly depth: number;
  /** The height it follows (the hero's, with the lag), m. */
  readonly y: number;
  /** The hero's depth from it at the last follow, m. */
  readonly gap: number;
}

/** A checked depth rail state for `options`. Throws `GFX_BAD_CAMERA`. */
export function railState(options: Omit<RailSpec, 'type'> = {}): RailState {
  const { near = RAIL_DEFAULTS.near, far = RAIL_DEFAULTS.far } = options;
  const state: RailState = {
    azimuth: options.azimuth ?? 0,
    near,
    far,
    zoom: options.zoom ?? 1,
    along: null,
    depth: RAIL_START,
    y: 0,
    gap: RAIL_START,
  };
  refuse('the depth rail', [
    ...rangeProblems({ azimuth: [state.azimuth, -1e6, 1e6], near: [near, 0.1, 1000], far: [far, near, 1000] }),
    ...rangeProblems({ zoom: [state.zoom, 0.1, 10] }),
  ]);
  return state;
}

/** The rail's axes: `out` from the hero toward the rail, `along` it (the picture's right), on the XZ plane. */
function axes(azimuth: number) {
  const [s, c] = [Math.sin(azimuth), Math.cos(azimuth)];
  return { out: [s, c] as const, along: [c, -s] as const };
}

/** Steps a depth rail by one rendered frame: `zoom`, then following along, in height, and in depth. */
export function stepRail(state: RailState, input: CameraInput, dt: number): RailState {
  const zoom = input.zoom ? stepZoom(state.zoom, input.zoom) : state.zoom;
  if (!input.follow) return { ...state, zoom };
  const [x, y, z] = input.follow;
  const { out, along } = axes(state.azimuth);
  const u = x * along[0] + z * along[1];
  const v = x * out[0] + z * out[1];
  if (state.along === null) return { ...state, zoom, along: u, depth: v + RAIL_START, y, gap: RAIL_START };
  const k = 1 - Math.exp(-dt / RAIL_LAG);
  const want = MathUtils.clamp(state.depth, v + state.near, v + state.far);
  const depth = state.depth + (want - state.depth) * (1 - Math.exp((-2 * dt) / RAIL_LAG));
  const next = { along: state.along + (u - state.along) * k, depth, y: state.y + (y - state.y) * k, gap: depth - v };
  return { ...state, zoom, ...next };
}

/** The depth rail's pose: on its rail, looking across at the hero's line, tilted down. */
export function railPose(state: RailState): CameraPose {
  const { out, along } = axes(state.azimuth);
  const u = state.along ?? 0;
  return makePose({
    position: [along[0] * u + out[0] * state.depth, state.y + RAIL_HEIGHT, along[1] * u + out[1] * state.depth],
    yaw: headingOf(state.azimuth),
    pitch: -RAIL_TILT,
    fov: RAIL_FOV,
    zoom: state.zoom,
    near: 0.1,
    far: 500,
    distance: Math.max(0, state.gap) / Math.cos(RAIL_TILT),
  });
}

/** The depth rail's code data. */
export function railSpec(state: RailState): RailSpec {
  return { type: 'rail', azimuth: state.azimuth, near: state.near, far: state.far, zoom: state.zoom };
}

const PARTS: readonly CodePart[] = [
  ['azimuth', -1e6, 1e6],
  ['near', 0.1, 1000],
  ['far', 0.1, 1000],
  ['zoom', 0.1, 10],
];

/** Reads a depth rail's code: `cam3=rail[,<azimuth>,<near>,<far>[,<zoom>]]`. Throws `GFX_BAD_CAMERA_CODE`. */
export function parseRailCode(code: string): RailSpec {
  const [azimuth, near, far, zoom] = readCode(code, 'rail', PARTS, [0, 3, 4]);
  if (far < near) {
    const problems = `far (${far}) is nearer than near (${near})`;
    throw codeError('GFX_BAD_CAMERA_CODE', { code: String(code).trim(), problems });
  }
  if (azimuth === undefined) return { type: 'rail' };
  return { type: 'rail', azimuth: azimuth * DEG, near, far, ...(zoom === undefined ? {} : { zoom }) };
}

/** The canonical code of a depth rail's data (numbers rounded: 0.01°, 0.001 m; a zoom of 1 left out). */
export function formatRailCode(spec: RailSpec): string {
  if (spec.azimuth === undefined) return 'cam3=rail';
  const zoom = codeNumber(spec.zoom ?? 1, 3);
  const parts = [codeDegrees(spec.azimuth, true), codeNumber(spec.near ?? RAIL_DEFAULTS.near, 3)];
  parts.push(codeNumber(spec.far ?? RAIL_DEFAULTS.far, 3), ...(zoom === '1' ? [] : [zoom]));
  return `cam3=rail,${parts.join(',')}`;
}

/** A depth rail in words. */
export function describeRail(spec: RailSpec, pose: CameraPose): string {
  const { near = RAIL_DEFAULTS.near, far = RAIL_DEFAULTS.far } = spec;
  const lens = `Depth rail (perspective, ${codeNumber(pose.fov, 0)}° field of view)`;
  const side = `on the ${codeDegrees(spec.azimuth ?? 0, true)}° side`;
  return `${lens}, ${side}, the hero ${codeNumber(near, 3)} to ${codeNumber(far, 3)} m away, zoom ${codeNumber(pose.zoom, 3)}x`;
}

/** A depth rail: beside the hero, following `input.follow` along the rail and keeping him within near and far. */
export function createRailCamera(options: Omit<RailSpec, 'type'> = {}): FollowCamera<'rail', RailSpec, CameraInput> {
  return followCamera('rail', railState(options), {
    step: stepRail,
    pose: railPose,
    spec: railSpec,
    code: formatRailCode,
    describe: describeRail,
  });
}
