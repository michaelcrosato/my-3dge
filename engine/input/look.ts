/**
 * @file How the devices turn the view (PLAN.md WP 13.9, docs/PLAYGROUND.md §3.3; doctrine: Common ground): the view
 * settings `input.*` a player sets as in any shooter's options, in Apex Legends' units, and `scaleLook`, which turns a
 * frame's mouse counts and right stick into what the camera takes (engine/input/input.ts `camera()`).
 *
 * The mouse turns the view `input.sensitivity` × 0.022° a count (`DEGREES_PER_COUNT`, Source's and Apex's `m_yaw`:
 * Apex's default 5 is 0.11° a count), times `input.adsSensitivity` while the sights are up (the map's `aim` action
 * held); the right stick turns it at each camera's own turn speed times `input.stickSensitivity`
 * (`input.stickAdsSensitivity` aiming). Pushing the mouse away or the stick forward looks up; `input.invert` and
 * `input.stickInvert` turn that round (flight style).
 *
 * Invariants: view settings, never in the hash: they change only how the camera turns, and the sim gets the look the
 * camera reached (`look`, recorded); pure; settings a registry lacks read as their defaults (`lookOptions`).
 *
 * @example
 * const options = lookOptions(() => undefined); // every default
 * scaleLook({ counts: [100, 0], stick: [0, 0] }, options, false).look[0]; // 0.192: 100 counts at 0.11° each, in rad
 * scaleLook({ counts: [0, 10], stick: [0, -1] }, { ...options, invert: true }, false); // look down, the stick up
 * @see engine/input/look.test.ts
 */
import { MathUtils } from '../core/math';
import { defineSettings } from '../core/settings';

/** One mouse count at sensitivity 1, degrees: Source's and Apex's `m_yaw` and `m_pitch`. */
export const DEGREES_PER_COUNT = 0.022;

/** The view settings the input reads (see the file comment), as fields; never in the hash. */
export const LOOK_SETTING_FIELDS = {
  'input.sensitivity': {
    type: 'number',
    default: 5,
    minimum: 0.1,
    maximum: 20,
    view: true,
    description: "Mouse look under pointer lock in Apex Legends' units: 0.022° a count each (Apex's default 5: 0.11° a count). A view setting: never in the hash.", // prettier-ignore
  },
  'input.adsSensitivity': {
    type: 'number',
    default: 1,
    minimum: 0.1,
    maximum: 5,
    view: true,
    description: 'Times the mouse look while aiming down sights (the action aim held), as Apex’s ADS multiplier. A view setting: never in the hash.', // prettier-ignore
  },
  'input.invert': {
    type: 'boolean',
    default: false,
    view: true,
    description: 'Mouse look upside down (flight style): pushing the mouse away looks down. A view setting: never in the hash.', // prettier-ignore
  },
  'input.stickSensitivity': {
    type: 'number',
    default: 1,
    minimum: 0.1,
    maximum: 5,
    view: true,
    description: "Times each camera's own turn speed, for the right stick. A view setting: never in the hash.",
  },
  'input.stickAdsSensitivity': {
    type: 'number',
    default: 1,
    minimum: 0.1,
    maximum: 5,
    view: true,
    description: 'Times the right stick’s turn while aiming down sights. A view setting: never in the hash.',
  },
  'input.stickInvert': {
    type: 'boolean',
    default: false,
    view: true,
    description: 'Right-stick look upside down (flight style): pushing the stick forward looks down. A view setting: never in the hash.', // prettier-ignore
  },
} as const;

/** The view settings the input reads, declared on the shared registry. */
export const LOOK_SETTINGS = defineSettings(LOOK_SETTING_FIELDS);

/** The look settings, read: what `scaleLook` takes. */
export interface LookOptions {
  readonly sensitivity: number;
  readonly ads: number;
  readonly invert: boolean;
  readonly stick: number;
  readonly stickAds: number;
  readonly stickInvert: boolean;
}

/** The look settings through `get` (a settings store's `get`); a value it lacks is the field's default. */
export function lookOptions(get: (path: string) => unknown): LookOptions {
  const read = <T>(path: keyof typeof LOOK_SETTING_FIELDS): T => (get(path) ?? LOOK_SETTING_FIELDS[path].default) as T;
  return {
    sensitivity: read('input.sensitivity'),
    ads: read('input.adsSensitivity'),
    invert: read('input.invert'),
    stick: read('input.stickSensitivity'),
    stickAds: read('input.stickAdsSensitivity'),
    stickInvert: read('input.stickInvert'),
  };
}

/** A frame's raw look: mouse counts `[right, up]` (up for a push away) and the right stick `[x, y]` (y down). */
export interface RawLook {
  readonly counts: readonly [number, number];
  readonly stick: readonly [number, number];
}

/** What the camera takes (engine/gfx/cameras/pose.ts `CameraInput`): look `[right, up]` in rad, turn as rates. */
export interface ScaledLook {
  look: [number, number];
  turn: [number, number];
}

/** What the camera takes from `raw` under `options`, aiming down sights or not (see the file comment). */
export function scaleLook(raw: RawLook, options: LookOptions, aiming: boolean): ScaledLook {
  const perCount = options.sensitivity * (aiming ? options.ads : 1) * DEGREES_PER_COUNT * MathUtils.DEG2RAD;
  const rate = options.stick * (aiming ? options.stickAds : 1);
  const [right, up] = raw.counts;
  const [x, y] = raw.stick;
  return {
    look: [right * perCount, (options.invert ? 0 - up : up) * perCount], // 0 − v, never −0
    turn: [x * rate, (options.stickInvert ? y : 0 - y) * rate],
  };
}
