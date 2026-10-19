/**
 * @file Camera metrics on a feel course (PLAN.md WP 13.4 and WP 13.8, docs/PLAYGROUND.md §4 and §9.1):
 * `createCameraTrack(code)` makes the camera rig the page draws through (engine/gfx/cameras/rig.ts: the camera a code
 * names, its blends and effects), steps it once a sim step at the sim's rate, as the page steps it each frame
 * (following the player's feet, his eye, what he does, the sim's look, the run's query view for the walls; a course
 * gives no device input), switches it with a blend where the course says (`set`), and keeps a frame of each pose.
 * `metrics()` reads four numbers off the frames:
 * - `jump`: the most one frame moves the camera beyond what the player's own move, the look and a blend account for (m:
 *   the look swings a camera that looks along it round the player by the turn times its distance from his eye);
 * - `turn`: the most one frame turns the view beyond what the look (for a camera that looks along it) and a blend
 *   account for (rad);
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
import { turnBetween } from '../../gfx/cameras/blend';
import type { CameraPlayer } from '../../gfx/cameras/effects';
import { makePose, poseForward, poseRight, poseUp, type CameraPose, type Vec3 } from '../../gfx/cameras/pose';
import { createCameraRig, type RigOptions } from '../../gfx/cameras/rig';
import type { QueryView } from '../../sim/queryView';

/** What the frames are checked with: the picture's aspect, the camera's ball (m) and where the player's chest is (m). */
export const CAMERA_CHECK = { aspect: 16 / 9, ball: 0.05, chest: 1.2 } as const;

/** One frame of a camera track: its pose, the player's feet, what the frame found, and what it may move and turn. */
export interface CameraFrame {
  readonly pose: CameraPose;
  readonly feet: Vec3;
  /** The camera's ball overlaps the level. */
  readonly inside: boolean;
  /** The player's chest is in the picture. */
  readonly seen: boolean;
  /** What the look and a blend moved (m) and turned (rad) the camera this frame. */
  readonly allowed: { readonly move: number; readonly turn: number };
}

/** A camera track's numbers (see the file comment). */
export interface CameraMetrics {
  jump: number;
  turn: number;
  inside: number;
  lost: number;
}

/** What a frame of the track takes beside the feet. */
export interface TrackFrame {
  /** The player's eye, m. */
  readonly eye?: Vec3;
  readonly queries?: QueryView;
  /** Seconds since the last frame (a sim step's, 1/60, by default). */
  readonly dt?: number;
  /** What the player does (engine/gfx/cameras/effects.ts's `cameraPlayer`). */
  readonly player?: CameraPlayer | null;
  /** The sim's look, `[yaw, pitch]` rad: the cameras that aim look along it. */
  readonly look?: readonly [number, number];
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
export function createCameraTrack(code: string, options: RigOptions = {}) {
  const rig = createCameraRig(code, options);
  const frames: CameraFrame[] = [];
  /** The camera's own heading and pitch at the last frame: a camera that looks along the sim's look turns with it. */
  let last: readonly [number, number] | undefined;
  return {
    code,
    frames: frames as readonly CameraFrame[],
    /** Switches the camera to `code`, blending as the page's live switch does. */
    set(next: string) {
      rig.set(next, { blend: true });
    },
    /** Steps the camera `dt` seconds after the player, whose feet are at `feet` (see `TrackFrame`), and keeps the frame. */
    frame(feet: Vec3, options: TrackFrame = {}): CameraFrame {
      const { eye, queries, dt = 1 / 60, player = null } = options;
      rig.step(player);
      const view = options.look;
      const pose = rig.update({ follow: feet, player, ...(eye ? { eye } : {}), ...(queries ? { queries } : {}), ...(view ? { view } : {}) }, dt); // prettier-ignore
      const ball = { type: 'ball', radius: CAMERA_CHECK.ball } as const;
      const inside = queries ? queries.overlap(ball, pose.position, { groups: 'world' }).length > 0 : false;
      const seen = inPicture(pose, [feet[0], feet[1] + CAMERA_CHECK.chest, feet[2]]);
      const own = rig.camera.pose();
      const follows = view !== undefined && Math.abs(Math.atan2(Math.sin(own.yaw - view[0]), Math.cos(own.yaw - view[0]))) < 1e-6; // prettier-ignore
      const looked = follows && last ? turnBetween(makePose({ position: own.position, yaw: last[0], pitch: last[1] }), own) : 0; // prettier-ignore
      last = [own.yaw, own.pitch];
      const pivot = eye ?? [feet[0], feet[1] + CAMERA_CHECK.chest, feet[2]];
      const blend = rig.blend();
      const allowed = { move: blend.move + looked * length(sub(pose.position, pivot)), turn: blend.turn + looked };
      const frame = { pose, feet, inside, seen, allowed };
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
        const moved = length(sub(f.pose.position, before.pose.position)) - length(sub(f.feet, before.feet)) - f.allowed.move; // prettier-ignore
        const turned = turnBetween(f.pose, before.pose) - f.allowed.turn;
        [out.jump, out.turn] = [Math.max(out.jump, moved), Math.max(out.turn, turned)];
      });
      return out;
    },
  };
}

/** A camera track: what `createCameraTrack` returns. */
export type CameraTrack = ReturnType<typeof createCameraTrack>;
