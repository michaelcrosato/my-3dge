/**
 * @file Camera codes (PLAN.md WP 2.5, §8.3; doctrine: Agent-operable): a camera as one short text that a link, a
 * command (`x shot --cam`) or `__engine.camera.set(code)` carries, and the words that say what a camera shows.
 * `parseCameraCode` turns a code into a `CameraSpec` (plain data, SI units: metres and radians), `formatCameraCode`
 * writes the canonical code back, `describeCamera` puts a spec in words. The codes the cameras raise are here too.
 *
 * The grammar (angles in degrees, lengths in metres, +Y up; `?` and the key may be left out, as in `iso`):
 * - `cam=<view>[,<turn>,<zoom>[,<x>,<y>,<z>]]`: a classic view (iso, threequarter, topdown, brawler, side; their
 *   numbers are in engine/gfx/cameras/presets.ts), turned round its target by `turn`, zoomed, fixed on (x, y, z) when
 *   given, else following.
 * - `cam=<azimuth>,<elevation>,<zoom>,<height>,<boost>[,<x>,<z>]`: a custom view, the 2D pages' `?cam=`. `height` is
 *   the target's height: above the followed point, or the fixed target's y when x and z are given.
 * - Either `cam=` form may end with `,persp`: a perspective lens instead of the 2D engine's orthographic projection.
 * - `cam3=orbit[,<azimuth>,<elevation>,<distance>[,<x>,<y>,<z>]]`: round a target, fixed when one is given.
 * - `cam3=fly[,<x>,<y>,<z>,<yaw>,<pitch>[,<fov>]]` and `cam3=fixed[,…]`: a free camera and one that stays put.
 * Azimuth is where a camera stands round its target, from +Z toward +X (three.js's `Spherical.theta`, OrbitControls'
 * azimuthal angle, the 2D engine's view yaw); elevation is how far above the target's horizon (0 side-on, 90 straight
 * down; `Spherical.phi` is 90 − elevation). Yaw is the heading a camera looks along, the intents' `cam` (0 looks
 * along +Z, 90 along +X); pitch is + up. A bare `fly` or `fixed` starts from the camera before it.
 *
 * Invariants: `formatCameraCode(parseCameraCode(code)) === code` for every canonical code, and parsing the code of a
 * camera gives back its pose (to the code's rounding: 0.001 m, 0.01°). Codes are view state: they never reach the
 * sim or the hash. A malformed code throws `GFX_BAD_CAMERA_CODE` listing every problem; an unknown name throws
 * `GFX_UNKNOWN_CAMERA` with the closest. URL parameters are parsed in app/routes (PLAN.md §6.1), never here.
 *
 * Carried from `my-3d2dge:src/stress-world/40-cameras.js:266-338` (`camDesc`, `camLink`, the `?cam=` and `?cam3=`
 * links) and `my-3d2dge:src/lab3d/50-cameras.js` (`CAMS.code()`, `CAMS.load()`), converted to SI and +Y up.
 *
 * @example
 * const spec = parseCameraCode('cam=iso,45,2'); // { type: 'view', view: 'iso', turn: π/4, zoom: 2 }
 * formatCameraCode(spec); // 'cam=iso,45,2'
 * formatCameraCode(parseCameraCode('fly,1,1.7,-4,90,-10')); // 'cam3=fly,1,1.7,-4,90,-10,70'
 * describeCamera(parseCameraCode('topdown')); // 'Top-down view, orthographic, zoom 1x, following'
 * @see engine/gfx/cameras/codes.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../../core/log';
import { MathUtils } from '../../core/math';
import type { CameraPose, Projection, Vec3 } from './pose';

/** The codes the cameras raise, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const CAMERA_CODES = defineCodes('gfx', {
  GFX_BAD_CAMERA_CODE: {
    template: '"{code}" is not a camera code: {problems}',
    fix: 'write cam=<view>[,<turn>,<zoom>[,<x>,<y>,<z>]] (views: iso, threequarter, topdown, brawler, side), cam=<azimuth>,<elevation>,<zoom>,<height>,<boost>[,<x>,<z>] (a custom view), either with ,persp at the end for a perspective lens, or cam3=orbit[,<azimuth>,<elevation>,<distance>[,<x>,<y>,<z>]], cam3=fly or cam3=fixed[,<x>,<y>,<z>,<yaw>,<pitch>[,<fov>]]; angles in degrees, lengths in metres',
    doc: 'Raised by `parseCameraCode` (engine/gfx/cameras/codes.ts) for an empty part, a word where a number belongs, the wrong count of numbers, or a number out of its range (each range is named). Every problem is listed at once.',
  },
  GFX_UNKNOWN_CAMERA: {
    template: '{name} is not a camera{suggestion}',
    fix: 'use one of {names}: the classic views in cam=, the 3D cameras in cam3= (engine/gfx/cameras/codes.ts gives the grammar)',
    doc: 'Raised by `parseCameraCode` and the camera factories (engine/gfx/cameras/) for a view or camera name they do not know, with the closest names.',
  },
  GFX_BAD_CAMERA: {
    template: '{where}: {problems}',
    fix: 'give finite numbers within the ranges named (angles in radians, lengths in metres, fov in degrees as PerspectiveCamera.fov), and a positive aspect (width / height)',
    doc: 'Raised by the camera factories, `makePose` and `placeCamera` (engine/gfx/cameras/) for a missing or non-finite number, a value out of its range, or a pose put on a three.js camera of the other projection.',
  },
});

/** The kinds of camera: a classic view, an orbit round a target, a free fly camera, a fixed one. */
export type CameraType = 'view' | 'orbit' | 'fly' | 'fixed';

/** The classic views (engine/gfx/cameras/presets.ts has their numbers), and `custom` (any azimuth and elevation). */
export type ViewName = 'iso' | 'threequarter' | 'topdown' | 'brawler' | 'side' | 'custom';

/** Every view name, in the order the 2D engine cycles them (`custom` last). */
export const VIEW_NAMES: readonly ViewName[] = Object.freeze([
  'iso',
  'threequarter',
  'topdown',
  'brawler',
  'side',
  'custom',
]);

/** Each view's name in words. */
export const VIEW_LABELS: Readonly<Record<ViewName, string>> = Object.freeze({
  iso: 'Isometric',
  threequarter: 'Three-quarter',
  topdown: 'Top-down',
  brawler: 'Brawler',
  side: 'Side scrolling',
  custom: 'Custom',
});

/** The 3D cameras of `cam3=`. */
export const CAMERA_3D: readonly CameraType[] = Object.freeze(['orbit', 'fly', 'fixed']);

/** A classic view's code as data: missing fields take the camera's defaults. */
export interface ViewSpec {
  readonly type: 'view';
  readonly view: ViewName;
  /** `'orthographic'` (the default, the 2D engine's) or `'perspective'`. */
  readonly projection?: Projection;
  /** Turn round the target, rad, added to the view's azimuth (the prototype's 45° steps; not for `side`). */
  readonly turn?: number;
  /** As three.js cameras' `zoom`: 2 shows half as much. */
  readonly zoom?: number;
  /** The fixed target, m; without it the view follows. */
  readonly target?: Vec3;
  /** Custom views: where the camera stands round its target, rad (see the file comment). */
  readonly azimuth?: number;
  /** Custom views: how far above the target's horizon, rad, 0 to π/2. */
  readonly elevation?: number;
  /** Custom views: heights are stretched by this in the picture (engine/gfx/cameras/boost.ts). */
  readonly boost?: number;
  /** Custom views: the target's height above the followed point, m. */
  readonly height?: number;
}

/** An orbit camera's code as data. */
export interface OrbitSpec {
  readonly type: 'orbit';
  readonly azimuth?: number;
  readonly elevation?: number;
  /** From the target, m. */
  readonly distance?: number;
  /** The fixed target, m; without it the orbit follows. */
  readonly target?: Vec3;
}

/** A fly or fixed camera's code as data: without a position it starts from the camera before it. */
export interface FreeSpec {
  readonly type: 'fly' | 'fixed';
  readonly position?: Vec3;
  /** The heading, rad (the intents' `cam`). */
  readonly yaw?: number;
  /** Rad, + up. */
  readonly pitch?: number;
  /** Vertical field of view, degrees, as `PerspectiveCamera.fov`. */
  readonly fov?: number;
}

/** A camera code as data. */
export type CameraSpec = ViewSpec | OrbitSpec | FreeSpec;

const DEG = MathUtils.DEG2RAD;
/** Ranges a code's numbers must be in (degrees and metres, as written). */
const RANGES = {
  zoom: [0.1, 10],
  elevation: [0, 90],
  boost: [0.1, 10],
  distance: [0.1, 1000],
  pitch: [-90, 90],
  fov: [1, 179],
} as const;

/** A number as a code writes it: rounded to `places` decimals, shortest form, never `-0`. */
function written(value: number, places: number): string {
  const k = Math.pow(10, places);
  const rounded = Math.round(value * k) / k;
  return String(rounded === 0 ? 0 : rounded);
}
/** Degrees, rounded to 0.01 and wrapped into [0, 360). */
const turnDeg = (rad: number) => written((((Math.round((rad / DEG) * 100) / 100) % 360) + 360) % 360, 2);
/** Degrees, rounded to 0.01 and wrapped into (−180, 180]. */
const yawDeg = (rad: number) => {
  const d = (((Math.round((rad / DEG) * 100) / 100) % 360) + 360) % 360;
  return written(d > 180 ? d - 360 : d, 2);
};
const deg = (rad: number) => written(rad / DEG, 2);
const metres = (m: number) => written(m, 3);
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * Reads a camera code (see the file comment for the grammar): `cam=…`, `cam3=…`, with or without a leading `?`, or a
 * bare value (`iso`, `orbit`, `30,40,1,0.5,1`). Throws `GFX_BAD_CAMERA_CODE` or `GFX_UNKNOWN_CAMERA`.
 */
export function parseCameraCode(code: string): CameraSpec {
  const text = String(code).trim().replace(/^\?/, '');
  const keyed = /^(cam3?)=(.*)$/.exec(text);
  const tokens = (keyed ? keyed[2] : text).split(',').map((token) => token.trim());
  const problems: string[] = [];
  const fail = (): never => {
    throw codeError('GFX_BAD_CAMERA_CODE', { code: text, problems: problems.join('; ') });
  };
  if (tokens.some((token) => token === '')) problems.push('it has an empty part (two commas, or nothing after =)');
  if (problems.length) fail();
  let projection: Projection | undefined;
  const last = tokens.at(-1);
  if (last === 'persp' || last === 'ortho') {
    projection = last === 'persp' ? 'perspective' : 'orthographic';
    tokens.pop();
  }
  const head = tokens[0] ?? '';
  const numeric = NUMBER.test(head);
  const names = [...VIEW_NAMES, ...CAMERA_3D];
  if (!numeric && !names.includes(head as ViewName)) {
    throw codeError('GFX_UNKNOWN_CAMERA', {
      name: JSON.stringify(head),
      suggestion: didYouMean(head, names),
      names: names.join(', '),
    });
  }
  const is3d = CAMERA_3D.includes(head as CameraType);
  if (keyed && (keyed[1] === 'cam3') !== is3d) {
    problems.push(
      is3d
        ? `${head} is a 3D camera: write cam3=${head}`
        : `${numeric ? 'a custom view' : `the view ${head}`} belongs in cam=`,
    );
  }
  if (is3d && projection) problems.push(`,${last} belongs to cam= views; ${head} has its own lens`);
  const words = numeric ? tokens : tokens.slice(1);
  const values = words.map((word, i) => {
    if (!NUMBER.test(word)) problems.push(`part ${i + (numeric ? 1 : 2)} (${word}) is not a number`);
    return Number(word);
  });
  const arity = (allowed: number[], form: string) => {
    if (!allowed.includes(values.length))
      problems.push(`${form} takes ${allowed.join(', ')} numbers, not ${values.length}`);
  };
  const range = (i: number, name: keyof typeof RANGES) => {
    const [lo, hi] = RANGES[name];
    if (i < values.length && NUMBER.test(words[i]) && !(values[i] >= lo && values[i] <= hi)) {
      problems.push(`${name} is ${words[i]}; it must be from ${lo} to ${hi}`);
    }
  };
  const at = (i: number): Vec3 => [values[i], values[i + 1], values[i + 2]];
  let spec: CameraSpec;
  if (numeric) {
    arity([5, 7], 'a custom view (azimuth, elevation, zoom, height, boost[, x, z])');
    range(1, 'elevation');
    range(2, 'zoom');
    range(4, 'boost');
    const [azimuth, elevation, zoom, height, boost, x, z] = values;
    spec = { type: 'view', view: 'custom', azimuth: azimuth * DEG, elevation: elevation * DEG, zoom, boost };
    spec = values.length === 7 ? { ...spec, target: [x, height, z] } : { ...spec, height };
  } else if (!is3d) {
    arity([0, 2, 5], `a view (${head}[, turn, zoom[, x, y, z]])`);
    range(1, 'zoom');
    spec = { type: 'view', view: head as ViewName };
    if (head === 'custom' && values.length)
      problems.push('a custom view is written as numbers: azimuth, elevation, zoom, height, boost');
    if (values.length >= 2) spec = { ...spec, turn: values[0] * DEG, zoom: values[1] };
    if (values.length === 5) spec = { ...spec, target: at(2) };
  } else if (head === 'orbit') {
    arity([0, 3, 6], 'an orbit (orbit[, azimuth, elevation, distance[, x, y, z]])');
    range(1, 'elevation');
    range(2, 'distance');
    spec = { type: 'orbit' };
    if (values.length >= 3)
      spec = { ...spec, azimuth: values[0] * DEG, elevation: values[1] * DEG, distance: values[2] };
    if (values.length === 6) spec = { ...spec, target: at(3) };
  } else {
    arity([0, 5, 6], `a ${head} camera (${head}[, x, y, z, yaw, pitch[, fov]])`);
    range(4, 'pitch');
    range(5, 'fov');
    spec = { type: head as FreeSpec['type'] };
    if (values.length >= 5) spec = { ...spec, position: at(0), yaw: values[3] * DEG, pitch: values[4] * DEG };
    if (values.length === 6) spec = { ...spec, fov: values[5] };
  }
  if (problems.length) fail();
  return projection && spec.type === 'view' ? { ...spec, projection } : spec;
}

/** The canonical code of `spec`: `cam=…` or `cam3=…`, numbers rounded (0.001 m, 0.01°), defaults left out. */
export function formatCameraCode(spec: CameraSpec): string {
  const lens = spec.type === 'view' && spec.projection === 'perspective' ? ',persp' : '';
  switch (spec.type) {
    case 'view': {
      const zoom = written(spec.zoom ?? 1, 3);
      if (spec.view === 'custom') {
        const t = spec.target;
        const parts = [turnDeg(spec.azimuth ?? 0), deg(spec.elevation ?? 0), zoom];
        parts.push(metres(t ? t[1] : (spec.height ?? 0)), written(spec.boost ?? 1, 3));
        if (t) parts.push(metres(t[0]), metres(t[2]));
        return `cam=${parts.join(',')}${lens}`;
      }
      const turn = turnDeg(spec.turn ?? 0);
      const parts: string[] = [spec.view];
      if (spec.target || turn !== '0' || zoom !== '1') parts.push(turn, zoom);
      if (spec.target) parts.push(...spec.target.map(metres));
      return `cam=${parts.join(',')}${lens}`;
    }
    case 'orbit': {
      const parts: string[] = ['orbit'];
      const { azimuth, elevation, distance } = spec;
      if (azimuth !== undefined && elevation !== undefined && distance !== undefined) {
        parts.push(turnDeg(azimuth), deg(elevation), metres(distance));
      } else if (spec.target || azimuth !== undefined) {
        throw codeError('GFX_BAD_CAMERA', {
          where: 'formatCameraCode',
          problems: 'an orbit with a target or an azimuth needs all three of azimuth, elevation and distance',
        });
      }
      if (spec.target) parts.push(...spec.target.map(metres));
      return `cam3=${parts.join(',')}`;
    }
    default: {
      const parts: string[] = [spec.type];
      if (spec.position) {
        parts.push(...spec.position.map(metres), yawDeg(spec.yaw ?? 0), deg(spec.pitch ?? 0));
        parts.push(written(spec.fov ?? 70, 2));
      }
      return `cam3=${parts.join(',')}`;
    }
  }
}

/** A point in words: `(1, 0.5, -2)`, to the centimetre. */
const point = (p: Vec3) => `(${p.map((v) => written(v, 2)).join(', ')})`;

/**
 * `spec` in words, as the prototype's `camDesc`: `Isometric view, orthographic, zoom 1x, following`. `pose`, the
 * camera's current pose, adds what the spec leaves to defaults (the lens, the height boost).
 */
export function describeCamera(spec: CameraSpec, pose?: CameraPose): string {
  const fov = pose?.fov;
  const lens = (projection?: Projection) =>
    projection === 'perspective' ? `perspective, ${written(fov ?? 40, 0)}° field of view` : 'orthographic';
  const where = (target?: Vec3) => (target ? `fixed on ${point(target)}` : 'following');
  switch (spec.type) {
    case 'view': {
      const boost = spec.view === 'custom' ? spec.boost : pose?.boost;
      const parts = [
        spec.view === 'custom'
          ? `Custom view (turned ${turnDeg(spec.azimuth ?? 0)}°, tilted ${deg(spec.elevation ?? 0)}°)`
          : `${VIEW_LABELS[spec.view]} view`,
        lens(spec.projection),
      ];
      if (boost !== undefined && boost !== 1) parts.push(`height boost ${written(boost, 3)}x`);
      parts.push(`zoom ${written(spec.zoom ?? 1, 3)}x`);
      if (spec.turn && turnDeg(spec.turn) !== '0') parts.push(`turned ${turnDeg(spec.turn)}°`);
      parts.push(where(spec.target));
      return parts.join(', ');
    }
    case 'orbit': {
      const parts = [`Orbit camera (perspective, ${written(fov ?? 35, 0)}° field of view)`];
      if (spec.distance !== undefined) parts.push(`${metres(spec.distance)} m from its target`);
      if (spec.azimuth !== undefined)
        parts.push(`turned ${turnDeg(spec.azimuth)}°, tilted ${deg(spec.elevation ?? 0)}°`);
      parts.push(where(spec.target));
      return parts.join(', ');
    }
    default: {
      const name = spec.type === 'fly' ? 'Fly camera' : 'Fixed camera';
      const text = `${name} (perspective, ${written(spec.fov ?? fov ?? 70, 0)}° field of view)`;
      if (!spec.position) return text;
      return `${text} at ${point(spec.position)}, heading ${yawDeg(spec.yaw ?? 0)}°, pitch ${deg(spec.pitch ?? 0)}°`;
    }
  }
}
