/**
 * @file The camera rig (PLAN.md WP 13.8, docs/PLAYGROUND.md §4; doctrine: Common ground): what a view
 * (engine/app/view.ts) and the feel kit's camera metrics (engine/dev/feel/camera.ts) step each frame, so the page and
 * the numbers see the same pictures. It holds the camera a code names (`createCamera`, engine/gfx/cameras/place.ts);
 * on a switch that asks for a blend (the page's live switches: `set(code, { blend: true })`) or a view's turn
 * (`input.turnSteps`), the camera before it too, still stepped, blended into the new one over `blend` seconds
 * (engine/gfx/cameras/blend.ts); and the view effects (engine/gfx/cameras/effects.ts), each camera taking its own
 * share (`effects` on a follow camera; none on the others), mixed through a blend.
 *
 * Its options come from the view settings `cam.*` (`CAMERA_SETTINGS`, `rigOptions`): the player's field of view
 * (Apex's horizontal degrees at 4:3, the lens first person and the shooter take), the blend's time, the effects on or
 * off, and whole-number zooms for the classic views. `step(player)` after a sim step hands the effects the player's
 * state; `update(input, dt)` steps the cameras by a rendered frame and returns the pose to draw; `blend()` says how
 * far into a blend the frame is and what the blend moved on its own, which the camera metrics allow it.
 *
 * Invariants: view only (cameras never reach the sim or the hash); a switch without a blend, or any switch before the
 * first frame, cuts; a blend's first frame is the old camera's and its last the new one's; with the effects off the
 * pose drawn is the camera's own.
 *
 * @example
 * const rig = createCameraRig('cam3=first');
 * rig.update({ follow: [0, 0, 0] }, 1 / 60);
 * rig.set('cam3=shoulder', { blend: true }); // blends over cam.blend's 0.35 s
 * rig.update({ follow: [0, 0, 0] }, 0.175); // halfway: rig.blend().weight is 0.5
 * @see engine/gfx/cameras/rig.test.ts
 */
import { defineSettings } from '../../core/settings';
import { BLEND_TIME, blendGap, blendCameras, blendWeight } from './blend';
import type { Walls } from './collide';
import { apexFov, applyEffects, createCameraEffects, NO_EFFECTS, type CameraPlayer, type EffectsFrame, type EffectWeights } from './effects'; // prettier-ignore
import { createCamera, type AnyCamera, type AnyCameraSpec, type CreateCameraOptions } from './place';
import { WHOLE_STEPS } from './presets';
import type { CameraInput, CameraPose, Vec3 } from './pose';

/** The view settings the rig reads (see the file comment), as fields; never in the hash. */
export const CAMERA_SETTING_FIELDS = {
  'cam.fov': {
    type: 'number',
    default: 90,
    minimum: 70,
    maximum: 110,
    view: true,
    description: "The field of view as Apex Legends' slider gives it: horizontal degrees at 4:3 (Apex starts at 70). First person's and the shooter camera's lens. A view setting: never in the hash.", // prettier-ignore
  },
  'cam.blend': {
    type: 'number',
    default: BLEND_TIME,
    minimum: 0,
    maximum: 2,
    view: true,
    description: "Seconds a live camera switch (the page's key or menu) or a view's turn blends over; 0 cuts. A view setting: never in the hash.", // prettier-ignore
  },
  'cam.effects': {
    type: 'boolean',
    default: true,
    view: true,
    description: 'The view effects driven by the player (the sprint, the slide, the punch, the bob, the sights): engine/gfx/cameras/effects.ts. A view setting: never in the hash.', // prettier-ignore
  },
  'cam.wholeZoom': {
    type: 'boolean',
    default: false,
    view: true,
    description: "The classic views zoom in whole steps only (1, 2, 3, 4), so a pixel look's pixels stay square. A view setting: never in the hash.", // prettier-ignore
  },
} as const;

/** The view settings the rig reads, declared on the shared registry. */
export const CAMERA_SETTINGS = defineSettings(CAMERA_SETTING_FIELDS);

/** The rig's options (see the file comment). */
export interface RigOptions {
  /** Seconds a live switch blends over (`cam.blend`). */
  readonly blend?: number;
  /** The view effects on (`cam.effects`). */
  readonly effects?: boolean;
  /** First person's and the shooter's lens, vertical degrees (`cam.fov` through `apexFov`); their own when absent. */
  readonly lens?: number;
  /** The classic views' zoom steps (`WHOLE_STEPS` with `cam.wholeZoom`). */
  readonly zooms?: readonly number[];
}

/** The rig's options from the view settings `cam.*`, read by `get` (a settings store's). */
export function rigOptions(get: (path: string) => unknown): RigOptions {
  const fov = get('cam.fov');
  return {
    blend: Number(get('cam.blend') ?? BLEND_TIME),
    effects: get('cam.effects') !== false,
    ...(typeof fov === 'number' ? { lens: apexFov(fov) } : {}),
    ...(get('cam.wholeZoom') === true ? { zooms: WHOLE_STEPS } : {}),
  };
}

/** What the rig's cameras take each frame: the devices', the hero (his eye, his look, his state) and the walls. */
export interface RigInput extends CameraInput, Walls {
  /** The hero's eye, m. */
  readonly eye?: Vec3;
  /** The view to look along, `[yaw, pitch]` rad, when no device turns the camera (the sim's look). */
  readonly view?: readonly [number, number];
  /** Swap the shooter's shoulder this frame. */
  readonly swap?: boolean;
  /** What the hero does (engine/gfx/cameras/effects.ts's `cameraPlayer`). */
  readonly player?: CameraPlayer | null;
}

/** A frame's blend: how far into it (1: none), and what it moved the picture on its own (m, rad). */
export interface RigBlend {
  readonly weight: number;
  readonly move: number;
  readonly turn: number;
}

/** The camera rig (see the file comment). */
export interface CameraRig {
  /** The camera now: what codes, words and the intents' heading come from. */
  readonly camera: AnyCamera;
  /** The pose the last update drew. */
  pose(): CameraPose;
  /** The effects' last frame (the screen shake to add, the bob for the weapon), or null with the effects off. */
  effects(): EffectsFrame | null;
  /** This frame's blend. */
  blend(): RigBlend;
  /** How much of the picture is first person's, 0 to 1 (its body hides past a half). */
  firstShare(): number;
  /** Switches to the camera `code` names; with `blend`, blends into it. Throws for a bad code. */
  set(code: string | AnyCameraSpec, options?: CreateCameraOptions & { readonly blend?: boolean }): AnyCamera;
  /** Takes new options (the view settings, each frame). */
  configure(options: RigOptions): void;
  /** Hands the effects the player's state after a sim step. */
  step(player: CameraPlayer | null): void;
  /** Steps the cameras by a rendered frame of `dt` real seconds; returns the pose to draw. */
  update(input: RigInput, dt: number): CameraPose;
}

/** A camera's share of the effects. */
const weightsOf = (camera: AnyCamera): EffectWeights => (camera as { effects?: EffectWeights }).effects ?? NO_EFFECTS;
/** `a` mixed `w` of the way to `b`. */
const mixWeights = (a: EffectWeights, b: EffectWeights, w: number): EffectWeights =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof EffectWeights] * (1 - w) + b[k as keyof EffectWeights] * w])) as unknown as EffectWeights; // prettier-ignore
/** Steps any camera with the rig's input. */
const stepCamera = (camera: AnyCamera, input: RigInput, dt: number): CameraPose =>
  (camera.update as (input: RigInput, dt: number) => CameraPose)(input, dt);
/** 1 for first person, else 0. */
const firstOf = (camera: AnyCamera) => (camera.type === 'first' ? 1 : 0);

/** Makes a rig on the camera `code` names (see the file comment). Throws for a bad code. */
export function createCameraRig(
  code: string | AnyCameraSpec,
  options: RigOptions & CreateCameraOptions = {},
): CameraRig {
  let settings: RigOptions = options;
  let camera = createCamera(code, options);
  const effects = createCameraEffects();
  let blending: { from: AnyCamera | null; frozen: CameraPose; t: number } | null = null;
  let base = camera.pose();
  let drawn = base;
  let frame: EffectsFrame | null = null;
  let last: RigBlend = { weight: 1, move: 0, turn: 0 };
  let first = firstOf(camera);
  let updated = false;
  return {
    get camera() {
      return camera;
    },
    pose: () => drawn,
    effects: () => frame,
    blend: () => last,
    firstShare: () => first,
    set(next, { blend = false, ...create } = {}) {
      const from = camera;
      camera = createCamera(next, { ...create, from: base });
      const time = settings.blend ?? BLEND_TIME;
      blending = blend && updated && time > 0 ? { from: blending ? null : from, frozen: base, t: 0 } : null;
      if (!blending) [base, drawn, first] = [camera.pose(), camera.pose(), firstOf(camera)];
      return camera;
    },
    configure(next) {
      settings = next;
    },
    step(player) {
      effects.step(player);
    },
    update(input, dt) {
      updated = true;
      frame = settings.effects === false ? null : effects.frame(dt, { yaw: base.yaw });
      const steer: RigInput = {
        ...input,
        ...(frame ? { aim: frame.aim } : {}),
        ...(settings.lens !== undefined ? { lens: settings.lens } : {}),
        ...(settings.zooms ? { zooms: settings.zooms } : {}),
      };
      const twin = input.turnSteps && !blending ? createCamera(camera.code(), { from: camera.pose() }) : null; // prettier-ignore
      const to = stepCamera(camera, steer, dt);
      if (twin) {
        const still = stepCamera(twin, { ...steer, turnSteps: 0 }, dt);
        const time = settings.blend ?? BLEND_TIME;
        if (Math.abs(still.yaw - to.yaw) > 1e-9 && time > 0) blending = { from: twin, frozen: still, t: 0 };
      }
      let pose = to;
      let weights = weightsOf(camera);
      last = { weight: 1, move: 0, turn: 0 };
      first = firstOf(camera);
      if (blending) {
        const time = settings.blend ?? BLEND_TIME;
        const old = blending.from ? (blending.t > 0 || !twin ? stepCamera(blending.from, { ...steer, turnSteps: 0 }, dt) : blending.frozen) : blending.frozen; // prettier-ignore
        const before = blendWeight(blending.t, time);
        blending.t += dt;
        const w = blendWeight(blending.t, time);
        pose = blendCameras(old, to, w);
        last = { weight: w, ...blendGap(old, to, before, w) };
        if (blending.from) weights = mixWeights(weightsOf(blending.from), weights, w);
        first = (blending.from ? firstOf(blending.from) : first) * (1 - w) + firstOf(camera) * w;
        if (w >= 1) blending = null;
      }
      base = pose;
      drawn = frame ? applyEffects(pose, frame, weights) : pose;
      return drawn;
    },
  };
}
