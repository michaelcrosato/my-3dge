/**
 * @file Aiming (PLAN.md WP 13.9, docs/PLAYGROUND.md §4; doctrine: Reproducible): the point a player aims at, which the
 * intents' `aim` carries, by the rule an action map names (`aimWith`, engine/input/actionMaps.ts): `centre`, the screen
 * centre's ray to what it meets (first person and the shooter: the body aims at that point); `pointer`, the pointer's
 * ray onto the player's floor (isometric and top-down), or, on a pad, the right stick pushed from the player along the
 * floor (twin sticks); `none`, no aim. The page works the point out each frame from the camera it drew and records it
 * with the step's other intents, so the sim reads only the point, and live play replays without a camera.
 *
 * `screenRay(pose, at, aspect)` is the ray through the point `at` of the picture (`[x, y]` from −1 to 1, +y up:
 * three.js's normalized device coordinates) for a perspective or orthographic pose, the boost's stretch of heights
 * undone, so it runs through true heights; `onFloor(ray, y)` is where it meets the level plane at height `y`;
 * `aimPoint(rule, view)` the aim from the camera, the pointer, the stick, the player's feet and a raycast into the
 * world, which the app passes in (the sim's read-only queries, the player's own body skipped).
 *
 * Invariants: pure, plain numbers in and out (the input layer imports no camera and no physics); a ray's direction has
 * length 1; the roll the view effects add is left out (the centre's ray is the same either way); `aimPoint` is
 * undefined when the rule aims nowhere this frame (no player, the pointer off the picture and the stick at rest).
 *
 * @example
 * const top = { position: [0, 10, 0], yaw: 0, pitch: -Math.PI / 2, projection: 'orthographic', fov: 50, frustumSize: 20, zoom: 1 } as const; // prettier-ignore
 * screenRay(top, [0, 0], 1).direction; // [0, -1, 6e-17]: straight down
 * onFloor(screenRay(top, [0.5, 0], 1), 0); // [-5, 0, 0]: right of the middle (right is −X facing +Z)
 * aimPoint('pointer', { pose: top, aspect: 1, feet: [0, 0, 0], pointer: [0, 0.5] }); // [0, 0, 5]: up the picture
 * const eye = { position: [0, 1.5, 0], yaw: 0, pitch: 0, projection: 'perspective', fov: 70, frustumSize: 0, zoom: 1 } as const; // prettier-ignore
 * aimPoint('centre', { pose: eye, aspect: 1, feet: [0, 0, 0], eye: [0, 1.5, 0], cast: () => 4 }); // [0, 1.5, 4]
 * @see engine/input/aim.test.ts
 */
import { fromCamera } from './intents';

/** A point or direction, m. */
export type Vec3 = readonly [number, number, number];

/** What aims a player's look or pointer, by an action map's `aim`: see the file comment. */
export type AimRule = 'none' | 'centre' | 'pointer';

/** The aim rules, in the order the docs list them. */
export const AIM_RULES: readonly AimRule[] = Object.freeze(['none', 'centre', 'pointer']);

/** How far the centre's ray looks (m): one that meets nothing aims this far along it. */
export const AIM_RANGE = 100;

/** How far from the player a right stick pushed all the way aims (m): twin sticks aim by direction. */
export const STICK_REACH = 5;

/** A camera's pose as aiming reads it: engine/gfx/cameras/pose.ts's `CameraPose` fits it. */
export interface AimPose {
  readonly position: Vec3;
  /** The heading of the view direction, rad: forward(ψ) = (sin ψ, 0, cos ψ). */
  readonly yaw: number;
  /** Up or down from level, rad: + up. */
  readonly pitch: number;
  readonly projection: 'perspective' | 'orthographic';
  /** The vertical field of view the picture was drawn with, degrees. */
  readonly fov: number;
  /** Orthographic: the frustum's height at zoom 1, m. */
  readonly frustumSize: number;
  /** 2 shows half as much. */
  readonly zoom: number;
  /** Heights stretched in the picture by this, about y = 0 (engine/gfx/cameras/boost.ts); 1 when absent. */
  readonly boost?: number;
}

/** A ray: where it starts and its unit direction. */
export interface AimRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** What `aimPoint` aims from: the camera drawn, the picture's aspect, the devices and the world. */
export interface AimView {
  readonly pose: AimPose;
  /** The picture's width over its height. */
  readonly aspect: number;
  /** The player's feet, m; none without a player (nothing is aimed). */
  readonly feet?: Vec3;
  /**
   * The player's eye, m (the feet when absent): the centre's ray counts only what lies beyond it, so a camera behind
   * the player never aims at what stands between them.
   */
  readonly eye?: Vec3;
  /** The pointer on the picture (`[x, y]`, −1 to 1, +y up), when it is over it and free (not locked). */
  readonly pointer?: readonly [number, number];
  /** The right stick `[right, up]` after its deadzone, −1 to 1: it aims in the pointer's rule when pushed. */
  readonly stick?: readonly [number, number];
  /** How far along a ray it meets the world, up to `max` m, or null (the app's raycast, the player's body skipped). */
  readonly cast?: (origin: Vec3, direction: Vec3, max: number) => number | null;
}

/** What the devices give aiming: the pointer and the right stick (see `AimView`). */
export type AimDevices = Pick<AimView, 'pointer' | 'stick'>;

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** The pose's forward, right and up (as engine/gfx/cameras/pose.ts has them, without a roll). */
function axes(pose: AimPose): [Vec3, Vec3, Vec3] {
  const [cy, sy, cp, sp] = [Math.cos(pose.yaw), Math.sin(pose.yaw), Math.cos(pose.pitch), Math.sin(pose.pitch)];
  return [
    [sy * cp, sp, cy * cp],
    [-cy, 0, sy],
    [-sy * sp, cp, -cy * sp],
  ];
}

/** The ray through the point `at` of the picture (`[x, y]`, −1 to 1, +y up), in true heights (see the file comment). */
export function screenRay(pose: AimPose, at: readonly [number, number], aspect: number): AimRay {
  const [forward, right, up] = axes(pose);
  const [x, y] = at;
  let origin = pose.position;
  let direction = forward;
  if (pose.projection === 'orthographic') {
    const half = pose.frustumSize / 2 / pose.zoom;
    origin = add(add(origin, right, x * half * aspect), up, y * half);
  } else {
    const half = Math.tan((pose.fov * Math.PI) / 360) / pose.zoom;
    direction = add(add(forward, right, x * half * aspect), up, y * half);
  }
  const k = pose.boost ?? 1; // the picture shows y·k: a ray through it meets true heights at y/k
  if (k !== 1) [origin, direction] = [[origin[0], origin[1] / k, origin[2]], [direction[0], direction[1] / k, direction[2]]]; // prettier-ignore
  const length = Math.hypot(...direction);
  return { origin, direction: [direction[0] / length, direction[1] / length, direction[2] / length] };
}

/** Where `ray` meets the level plane at height `y` ahead of its start, or null (level with it, or pointing away). */
export function onFloor(ray: AimRay, y: number): Vec3 | null {
  const dy = ray.direction[1];
  const t = Math.abs(dy) < 1e-9 ? -1 : (y - ray.origin[1]) / dy;
  return t >= 0 ? [ray.origin[0] + ray.direction[0] * t, y, ray.origin[2] + ray.direction[2] * t] : null;
}

/** The point the rule aims at this frame (see the file comment), or undefined. */
export function aimPoint(rule: AimRule, view: AimView): Vec3 | undefined {
  const { pose, aspect, feet } = view;
  if (rule === 'none' || !feet) return undefined;
  if (rule === 'centre') {
    const { origin, direction } = screenRay(pose, [0, 0], aspect);
    const eye = view.eye ?? feet;
    const skip = Math.max(0, (eye[0] - origin[0]) * direction[0] + (eye[1] - origin[1]) * direction[1] + (eye[2] - origin[2]) * direction[2]); // prettier-ignore
    const hit = view.cast?.(add(origin, direction, skip), direction, AIM_RANGE - skip) ?? null;
    return add(origin, direction, skip + (hit ?? AIM_RANGE - skip));
  }
  const [x, y] = view.stick ?? [0, 0];
  const length = Math.hypot(x, y);
  if (length > 0) {
    const [dx, dz] = fromCamera(pose.yaw, [x / length, y / length]); // the screen's right and up, laid on the floor
    return [feet[0] + dx * STICK_REACH, feet[1], feet[2] + dz * STICK_REACH];
  }
  return view.pointer ? (onFloor(screenRay(pose, view.pointer, aspect), feet[1]) ?? undefined) : undefined;
}
