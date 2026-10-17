/**
 * @file Camera metrics on a feel course (PLAN.md WP 13.4, docs/PLAYGROUND.md §4 and §9.1): `createCameraTrack(code)`
 * makes the camera a code names (engine/gfx/cameras/place.ts `createCamera`: `cam3=chase`, `cam=iso`), steps it once a
 * sim step at the sim's rate, as the page steps it each frame (following the player's feet, its eye in first person,
 * the run's query view for the walls; a course gives no look input and no blend), and keeps a frame of each pose.
 * `metrics()` reads four numbers off the frames:
 * - `jump`: the most one frame moves the camera beyond the player's own move that frame (m);
 * - `turn`: the most one frame turns the view (rad);
 * - `inside`: the frames whose camera stands inside the level (a `CAMERA_CHECK.ball` ball overlapping `world`);
 * - `lost`: the frames whose player (its chest, `CAMERA_CHECK.chest` above the feet) is out of the picture, a frame of
 *   `CAMERA_CHECK.aspect`.
 * §4's bounds are 0.3 m, 4°, none and none.
 *
 * Invariants: presentation math only (the cameras are pure functions of their input: no GPU); it reads the sim's query
 * view and never writes the world; the first frame snaps to the player, so its move and turn are not counted.
 *
 * @example
 * const track = createCameraTrack('cam3=chase');
 * track.frame([0, 0, 0]);
 * track.frame([0, 0, 0.1]);
 * track.metrics().jump; // 0: the arm follows the player, never faster
 * @see engine/dev/feel/camera.test.ts
 */
import { createCamera } from '../../gfx/cameras/place';
import { poseForward, poseRight, poseUp, type CameraPose, type Vec3 } from '../../gfx/cameras/pose';
import type { QueryView } from '../../sim/queryView';

/** What the frames are checked with: the picture's aspect, the camera's ball (m) and where the player's chest is (m). */
export const CAMERA_CHECK = { aspect: 16 / 9, ball: 0.05, chest: 1.2 } as const;

/** One frame of a camera track: its pose, the player's feet, and what the frame found. */
export interface CameraFrame {
  readonly pose: CameraPose;
  readonly feet: Vec3;
  /** The camera's ball overlaps the level. */
  readonly inside: boolean;
  /** The player's chest is in the picture. */
  readonly seen: boolean;
}

/** A camera track's numbers (see the file comment). */
export interface CameraMetrics {
  jump: number;
  turn: number;
  inside: number;
  lost: number;
}

/** `a − b`. */
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** `a · b`. */
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** `|a|`. */
const length = (a: Vec3) => Math.sqrt(dot(a, a));

/** Whether `point` is in the picture of `pose`, a frame of `aspect`: in front of it, within its lens or frustum. */
export function inPicture(pose: CameraPose, point: Vec3, aspect: number = CAMERA_CHECK.aspect): boolean {
  const d = sub(point, pose.position);
  const lifted: Vec3 = [d[0], d[1] * pose.boost, d[2]];
  const [depth, across, up] = [dot(lifted, poseForward(pose)), dot(lifted, poseRight(pose)), dot(lifted, poseUp(pose))]; // prettier-ignore
  if (depth < pose.near || depth > pose.far) return false;
  const half =
    pose.projection === 'orthographic'
      ? pose.frustumSize / 2 / pose.zoom
      : (depth * Math.tan(((pose.fov / 2) * Math.PI) / 180)) / pose.zoom;
  return Math.abs(up) <= half && Math.abs(across) <= half * aspect;
}

/** A camera stepped once a sim step behind the player, and its frames (see the file comment). */
export function createCameraTrack(code: string) {
  const camera = createCamera(code);
  const frames: CameraFrame[] = [];
  return {
    code,
    frames: frames as readonly CameraFrame[],
    /** Steps the camera `dt` seconds after the player, whose feet are at `feet` (and eye at `eye`), and keeps the frame. */
    frame(feet: Vec3, options: { eye?: Vec3; queries?: QueryView; dt?: number } = {}): CameraFrame {
      const { eye, queries, dt = 1 / 60 } = options;
      const pose = camera.update({ follow: feet, ...(eye ? { eye } : {}), ...(queries ? { queries } : {}) }, dt);
      const ball = { type: 'ball', radius: CAMERA_CHECK.ball } as const;
      const inside = queries ? queries.overlap(ball, pose.position, { groups: 'world' }).length > 0 : false;
      const seen = inPicture(pose, [feet[0], feet[1] + CAMERA_CHECK.chest, feet[2]]);
      const frame = { pose, feet, inside, seen };
      frames.push(frame);
      return frame;
    },
    /** The track's numbers so far (see the file comment). */
    metrics(): CameraMetrics {
      const out: CameraMetrics = { jump: 0, turn: 0, inside: 0, lost: 0 };
      frames.forEach((f, i) => {
        out.inside += f.inside ? 1 : 0;
        out.lost += f.seen ? 0 : 1;
        if (i === 0) return;
        const before = frames[i - 1];
        const moved = length(sub(f.pose.position, before.pose.position)) - length(sub(f.feet, before.feet));
        const [a, b] = [poseForward(f.pose), poseForward(before.pose)];
        const cross = length([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
        [out.jump, out.turn] = [Math.max(out.jump, moved), Math.max(out.turn, Math.atan2(cross, dot(a, b)))];
      });
      return out;
    },
  };
}

/** A camera track: what `createCameraTrack` returns. */
export type CameraTrack = ReturnType<typeof createCameraTrack>;
