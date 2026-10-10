/**
 * @file The classic views (PLAN.md WP 2.5; doctrine: Common ground): the 2D engine's isometric, three-quarter,
 * top-down, brawler and side views, and custom ones, as 3D cameras that follow a point with the 2D camera's lag.
 * Each preset is the 2D view's angles, scale and height boost (`VIEW_PRESETS`); the camera frames as many metres as
 * the 2D engine showed in `PIXEL_LINES` lines (engine/gfx/resolution.ts), orthographic by default (the 2D look) or
 * through a perspective lens that frames the same height at the target. `stepView` and `viewPose` are the pure
 * steps; `createViewCamera` wraps them in a `Camera`.
 *
 * A view stands at its `azimuth` round the target (plus its `turn`, in the prototype's 45° steps) and `elevation`
 * above it (engine/gfx/cameras/codes.ts says the angles). Orthographic: the frustum is `lines / pixelsPerMetre`
 * metres tall at zoom 1, the camera stands `ORTHO_DISTANCE` back. Perspective: the camera stands as far back as its
 * `fov` lens frames that height, and zoom narrows the lens (three.js's `zoom`). The side view is always orthographic
 * (the 2D engine's flat side scrolling; the depth rail is WP 3.9) and never turns, nor does any view under 5°.
 * Heights are boosted in the picture by the view's `boost` (engine/gfx/cameras/boost.ts) in either projection.
 *
 * Invariants: with the boost, an orthographic view draws every point where the 2D engine's `View.p()` drew it, at the
 * frame's scale (engine/gfx/cameras/boost.test.ts checks a 1 m cube in every view within 1%). The target follows
 * `input.follow` (raised by `VIEW_LIFT`) with a time constant of `VIEW_LAG` real seconds, snaps to it the first
 * time (unless it started on another camera's target), and stays put while `fixed`. Pure: each step returns a new
 * state.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:379-386` (`E.VIEWS`: angles, scales, boosts),
 * `my-3d2dge:src/stress-world/40-cameras.js:27-81` (the view poses, the zoom steps, the focus lag) and
 * `my-3d2dge:src/lab3d/50-cameras.js:59-68` (the views' framing, the boost in the projection).
 *
 * @example
 * import { poseTarget } from './pose';
 * const iso = createViewCamera({ view: 'iso' });
 * const pose = iso.update({ follow: [2, 0, 3] }, 1 / 60); // the first follow snaps to the hero
 * poseTarget(pose); // [2, 0.5, 3]: VIEW_LIFT above him
 * pose.frustumSize; // 14.58…: 330 lines at 16√2 pixels per metre
 * iso.code(); // 'cam=iso'
 * @see engine/gfx/cameras/presets.test.ts
 */
import { MathUtils } from '../../core/math';
import { PIXEL_LINES } from '../resolution';
import { VIEW_NAMES, type ViewName, type ViewSpec } from './codes';
import {
  approach,
  cameraFrom,
  headingOf,
  makePose,
  orbitPoint,
  pointProblems,
  rangeProblems,
  refuse,
  type Camera,
  type CameraInput,
  type CameraPose,
  type Projection,
  type Vec3,
} from './pose';
import { codeError, didYouMean } from '../../core/log';

const DEG = MathUtils.DEG2RAD;

/** One classic view: where it stands, how many pixels a metre takes in its picture, and its height boost. */
export interface ViewPreset {
  /** Round the target, rad (from +Z toward +X; the 2D engine's view yaw). */
  readonly azimuth: number;
  /** Above the target's horizon, rad (the 2D engine's pitch: 0 side-on, π/2 straight down). */
  readonly elevation: number;
  /** The 2D engine's scale times its 16 units per metre: how many of its pixels a metre took. */
  readonly pixelsPerMetre: number;
  /** The 2D engine's `zBoost`: heights are this much taller in the picture. */
  readonly boost: number;
  /** Always orthographic, never turned (the side view: the 2D engine's flat side scrolling). */
  readonly flat?: boolean;
  /** Takes its azimuth, elevation and boost from the camera's options (these numbers are the defaults). */
  readonly custom?: boolean;
}

/** The classic views, from the 2D engine's `E.VIEWS`; `custom` holds a custom view's defaults. */
export const VIEW_PRESETS: Readonly<Record<ViewName, ViewPreset>> = Object.freeze({
  iso: { azimuth: 45 * DEG, elevation: 30 * DEG, pixelsPerMetre: 16 * Math.SQRT2, boost: 1 },
  threequarter: { azimuth: 0, elevation: 55 * DEG, pixelsPerMetre: 24, boost: 1.35 },
  topdown: { azimuth: 0, elevation: 80 * DEG, pixelsPerMetre: 24, boost: 1.3 },
  brawler: { azimuth: 0, elevation: 25 * DEG, pixelsPerMetre: 24, boost: 1 },
  side: { azimuth: 0, elevation: 0, pixelsPerMetre: 24, boost: 1, flat: true },
  custom: { azimuth: 30 * DEG, elevation: 40 * DEG, pixelsPerMetre: 24, boost: 1, custom: true },
});

/** The zoom steps `input.zoom` moves through. */
export const VIEW_ZOOMS: readonly number[] = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]);
/** A view's perspective lens, degrees (`PerspectiveCamera.fov`). */
export const VIEW_FOV = 40;
/** How high above the followed point a view looks, m. */
export const VIEW_LIFT = 0.5;
/** The time constant of a view's follow, real seconds (the 2D camera's lag). */
export const VIEW_LAG = 0.18;
/** How far back an orthographic view stands from its target, m, and how far it sees. */
export const ORTHO_DISTANCE = 60;
/** An orthographic view's far plane, m. */
export const ORTHO_FAR = 300;
/** Elevations below this (rad) never turn. */
const LEVEL = 5 * DEG;

/** A view camera's state: plain data, replaced (never changed) by each step. */
export interface ViewState {
  readonly view: ViewName;
  readonly projection: Projection;
  readonly azimuth: number;
  readonly elevation: number;
  readonly boost: number;
  readonly pixelsPerMetre: number;
  /** Turn round the target, rad, in [0, 2π). */
  readonly turn: number;
  readonly zoom: number;
  /** The perspective lens, degrees. */
  readonly fov: number;
  /** The picture's height in the 2D engine's pixels at zoom 1. */
  readonly lines: number;
  /** How high above the followed point the view looks, m. */
  readonly lift: number;
  /** What the view looks at, m; null until the first follow (the origin, raised by `lift`, meanwhile). */
  readonly target: Vec3 | null;
  /** The target stays put. */
  readonly fixed: boolean;
}

/** Options for a view beyond its code: the lens and the frame. */
export interface ViewOptions extends Omit<ViewSpec, 'type'> {
  readonly fov?: number;
  readonly lines?: number;
  /** The target until the first follow, m (switching from another camera: where it looked). */
  readonly start?: Vec3;
}

const wrapTurn = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** A checked view state for `options` (a view's code data, plus the lens and frame). Throws `GFX_BAD_CAMERA`. */
export function viewState(options: ViewOptions = { view: 'iso' }): ViewState {
  const preset: ViewPreset | undefined = Object.hasOwn(VIEW_PRESETS, options.view)
    ? VIEW_PRESETS[options.view]
    : undefined;
  if (!preset) {
    throw codeError('GFX_UNKNOWN_CAMERA', {
      name: JSON.stringify(options.view),
      suggestion: didYouMean(String(options.view), VIEW_NAMES),
      names: VIEW_NAMES.join(', '),
    });
  }
  const custom = preset.custom === true;
  const angles = ['azimuth', 'elevation', 'boost', 'height'] as const;
  const given = angles.filter((name) => !custom && options[name] !== undefined);
  refuse(
    `the ${options.view} view`,
    given.length ? [`${given.join(', ')} belong to custom views; turn and zoom a preset`] : [],
  );
  const state: ViewState = {
    view: options.view,
    projection: preset.flat ? 'orthographic' : (options.projection ?? 'orthographic'),
    azimuth: custom ? (options.azimuth ?? preset.azimuth) : preset.azimuth,
    elevation: custom ? (options.elevation ?? preset.elevation) : preset.elevation,
    boost: custom ? (options.boost ?? preset.boost) : preset.boost,
    pixelsPerMetre: preset.pixelsPerMetre,
    turn: wrapTurn(options.turn ?? 0),
    zoom: options.zoom ?? 1,
    fov: options.fov ?? VIEW_FOV,
    lines: options.lines ?? PIXEL_LINES,
    lift: options.height ?? VIEW_LIFT,
    target: options.target ? [...options.target] : options.start ? [...options.start] : null,
    fixed: options.target !== undefined,
  };
  refuse(`the ${options.view} view`, [
    ...rangeProblems({
      azimuth: [state.azimuth, -1e6, 1e6],
      elevation: [state.elevation, 0, Math.PI / 2],
      boost: [state.boost, 0.1, 10],
      turn: [state.turn, 0, 2 * Math.PI],
      zoom: [state.zoom, 0.1, 10],
      fov: [state.fov, 1, 179],
      lines: [state.lines, 1, 1e5],
      lift: [state.lift, -1e6, 1e6],
    }),
    ...(state.target ? pointProblems('target', state.target) : []),
  ]);
  return state;
}

/** The next zoom step from `zoom`, `steps` up (+) or down (−) `VIEW_ZOOMS`. */
export function stepZoom(zoom: number, steps: number): number {
  const at = VIEW_ZOOMS.findIndex((z) => z >= zoom - 1e-6);
  const i = (at < 0 ? VIEW_ZOOMS.length - 1 : at) + Math.trunc(steps);
  return VIEW_ZOOMS[MathUtils.clamp(i, 0, VIEW_ZOOMS.length - 1)];
}

/** Steps a view by one rendered frame: zoom steps, 45° turns, and the target following `input.follow`. */
export function stepView(state: ViewState, input: CameraInput, dt: number): ViewState {
  let next = state;
  if (input.zoom) next = { ...next, zoom: stepZoom(next.zoom, input.zoom) };
  if (input.turnSteps) next = { ...next, turn: wrapTurn(next.turn + Math.trunc(input.turnSteps) * (Math.PI / 4)) };
  if (input.follow && !next.fixed) {
    const [x, y, z] = input.follow;
    const want: Vec3 = [x, y + next.lift, z];
    next = { ...next, target: next.target ? approach(next.target, want, 1 - Math.exp(-dt / VIEW_LAG)) : want };
  }
  return next;
}

/** A view's pose (see the file comment for the framing). */
export function viewPose(state: ViewState): CameraPose {
  const flat = VIEW_PRESETS[state.view].flat === true;
  const azimuth = state.azimuth + (flat || state.elevation < LEVEL ? 0 : state.turn);
  const ortho = flat || state.projection === 'orthographic';
  const frustumSize = state.lines / state.pixelsPerMetre;
  const distance = ortho ? ORTHO_DISTANCE : frustumSize / 2 / Math.tan((state.fov / 2) * DEG);
  const target = state.target ?? [0, state.lift, 0];
  return makePose({
    position: orbitPoint(target, azimuth, state.elevation, distance),
    yaw: headingOf(azimuth),
    pitch: -state.elevation,
    projection: ortho ? 'orthographic' : 'perspective',
    fov: state.fov,
    frustumSize,
    zoom: state.zoom,
    near: 0.1,
    far: ortho ? ORTHO_FAR : 500,
    boost: state.boost,
    distance,
  });
}

/** A view's code data: a custom view's angles and boost, or a preset's name and turn. */
export function viewSpec(state: ViewState): ViewSpec {
  const lens = state.projection === 'perspective' ? { projection: state.projection } : {};
  const at = state.fixed && state.target ? { target: state.target } : {};
  if (!VIEW_PRESETS[state.view].custom)
    return { type: 'view', view: state.view, ...lens, turn: state.turn, zoom: state.zoom, ...at };
  const { elevation, boost, zoom } = state;
  const azimuth = state.azimuth + (elevation < LEVEL ? 0 : state.turn); // a custom code has no turn: it is folded in
  return {
    type: 'view',
    view: state.view,
    ...lens,
    azimuth,
    elevation,
    boost,
    zoom,
    ...(state.fixed ? at : { height: state.lift }),
  };
}

/** A classic view as a `Camera` (`options.view` names it; codes.ts's `VIEW_LABELS` has the names in words). */
export function createViewCamera(options: ViewOptions = { view: 'iso' }): Camera {
  return cameraFrom('view', viewState(options), { step: stepView, pose: viewPose, spec: viewSpec });
}
