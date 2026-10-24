/**
 * @file The shooter's camera (PLAN.md WP 13.8 and WP 13.27, docs/PLAYGROUND.md §4; doctrine: Common ground): over the
 * shoulder, as third-person shooters frame it. `stepShoulder` and `shoulderPose` are the pure steps;
 * `createShoulderCamera` wraps them in a camera.
 *
 * The pivot is the hero's eye (`input.eye`, else `SHOULDER.height` above `input.follow`), followed with a time
 * constant of `SHOULDER.lag` real seconds and never more than `SHOULDER.trail` behind it; the shoulder point stands
 * `SHOULDER.right` to its right (to the left once swapped: `side` −1) and `SHOULDER.up` above it, and the camera
 * `SHOULDER.back` behind that along the view, looking along the view (`yaw`, `pitch`), so the screen's centre is
 * where the hero aims and he stands left of it. `input.look` and `input.turn` turn the view, or `input.view` sets it
 * (the sim's look, when no device turns the camera); `input.swap` swaps the shoulder, eased over `SHOULDER.swap`
 * seconds; `input.aim` (0 to 1, how far the sights are raised: engine/gfx/cameras/effects.ts) pulls the arm in to
 * `SHOULDER.aim`. The lens is `input.lens` (the player's field of view, engine/gfx/cameras/rig.ts), else its own.
 *
 * Walls (engine/gfx/cameras/collide.ts, their fixed bodies: a door swings through it), WP 13.27's rooms: the arm is no
 * longer than the room toward each side (`SHOULDER_ROOM.sides`) plus what it comes in while a turn of the view at
 * `SHOULDER_ROOM.turn` takes it there, nor than the room back from where the shoulder point is going (by his velocity,
 * `input.player`, and its bend, the pitch turning on, `SHOULDER_ROOM.ahead`) plus a share of what it comes in by then;
 * it comes in at up to `COLLIDE_PULL` m/s and goes out eased over `COLLIDE_RETURN`. An arm shorter than
 * `SHOULDER.close` draws the shoulder point in to him by its share and down toward his chest (`SHOULDER.chest` over
 * his feet), letting it out at `SHOULDER.draw` a second. The camera heads for the arm's end as `moveCamera` moves it
 * (`SHOULDER_KEEP`: never through a wall, at its pace, along his trail once out of his sight), carried with the pivot
 * and the view (not with a turn that would carry it into a wall); where his chest stands past `SHOULDER.frame` of the
 * picture's half-height it shifts across the view toward him, its own moves kept to `SHOULDER_ROOM.most` of its pace,
 * under the jump bound. Put elsewhere (the shoulder point further than `COLLIDE_TELEPORT`), it stands at once.
 *
 * Invariants: with `queries` and the eye at least `COLLIDE_RADIUS` from every wall, the camera's ball never ends
 * inside one (shoulder.test.ts); the pitch stays within `SHOULDER_LIMITS.pitch`; the arm reads 28 casts a frame (13
 * sides, 14 ahead, the way) besides `moveCamera`'s. Pure: each step returns a new state.
 *
 * Codes: `cam3=shoulder[,<yaw>,<pitch>,<distance>[,<side>]]` (degrees, metres; side 1 right, −1 left); a bare one
 * looks where the camera before it looked.
 *
 * @example
 * const shoulder = createShoulderCamera();
 * shoulder.update({ follow: [0, 0, 0] }).position; // [-0.5, 1.824, -3.8]: right of and behind his eye, looking along +Z
 * shoulder.code(); // 'cam3=shoulder,0,0,3.8'
 * createShoulderCamera({ side: -1 }).update({ follow: [0, 0, 0] }).position[0]; // 0.5: over his left shoulder
 * @see engine/gfx/cameras/shoulder.test.ts
 */
import { MathUtils } from '../../core/math';
import { codeDegrees, codeNumber, followCamera, readCode, type CodePart, type FollowCamera } from './chase';
import { carry, COLLIDE_PULL, COLLIDE_RADIUS, COLLIDE_RETURN, COLLIDE_SKIN, COLLIDE_TELEPORT, follow, moveCamera, reach, sweep, type CameraBall, type Walls } from './collide'; // prettier-ignore
import type { CameraPlayer, EffectWeights } from './effects';
import { approach, makePose, poseForward, poseRight, poseUp, rangeProblems, refuse, wrapAngle, type CameraInput, type CameraPose, type Vec3 } from './pose'; // prettier-ignore

const DEG = MathUtils.DEG2RAD;

/** The rig's numbers (see the file comment): metres and real seconds; `lens` its own lens, degrees (Apex's 90 at 4:3). */
export const SHOULDER = Object.freeze({
  right: 0.5,
  up: 0.3,
  back: 3.8,
  aim: 1.5,
  height: 1.524,
  lag: 1 / 20,
  trail: 0.5,
  swap: 0.12,
  close: 1.6,
  chest: 1.2,
  draw: 3,
  frame: 0.6,
  lens: 73.74,
});
/**
 * The room the arm reads (see the file comment): the fastest turn of the view it is ready for, rad/s (a body's own
 * 720°/s, `movement.turnRate`), and the directions it reads either side of straight back, rad; the times ahead it reads
 * along its own way, s (half a second), the share of its pace it comes in by then (room to spare for a way that bends:
 * 3.3 m in all), and the most it carries that way's bend on, m/s² (a fall's, about twice a body's gravity at most).
 */
export const SHOULDER_ROOM = Object.freeze({
  turn: 4 * Math.PI,
  sides: [0, 1, 2, 3, 4, 6, 8].map((k) => (k * Math.PI) / 8),
  ahead: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 26, 30].map((k) => k / 60),
  pace: 1 / 2,
  fall: 30,
  most: 1.5,
});
/** How its camera keeps the shoulder point (collide.ts's `moveCamera`): in sight of its own ball, its trail however near. */
export const SHOULDER_KEEP = Object.freeze({ room: 0, trail: 0 });
/** The range of the pitch (rad) and of the arm (m). */
export const SHOULDER_LIMITS = Object.freeze({ pitch: [-1.4, 1.4] as const, distance: [0.5, 20] as const });
/** Turn rates at full `input.turn`, rad/s: `[right, up]`. */
export const SHOULDER_TURN_SPEED = Object.freeze([2.2, 1.2] as const);
/** The effects it takes (engine/gfx/cameras/effects.ts): the lens, the sights, half the roll and the punch. */
export const SHOULDER_EFFECTS: EffectWeights = Object.freeze({ eye: 0, bob: 0, roll: 0.5, fov: 1, punch: 0.5, aim: 1 }); // prettier-ignore

/** A shoulder camera's input: the devices', the hero's eye and the walls. */
export interface ShoulderInput extends CameraInput, Walls {
  /** The hero's eye, m; without it `SHOULDER.height` above `follow`. */
  readonly eye?: Vec3;
  /** The view to look along, `[yaw, pitch]` rad, when no device turns the camera (the sim's look). */
  readonly view?: readonly [number, number];
  /** Swap the shoulder this frame. */
  readonly swap?: boolean;
  /** How far the sights are raised, 0 to 1: the arm pulls in to `SHOULDER.aim`. */
  readonly aim?: number;
  /** The lens, vertical degrees: the player's field of view. */
  readonly lens?: number;
  /** What he does (engine/gfx/cameras/effects.ts's `cameraPlayer`): his velocity leads the arm's reading ahead. */
  readonly player?: CameraPlayer | null;
}

/** A shoulder camera's code as data: without the numbers it looks where the camera before it looked. */
export interface ShoulderSpec {
  readonly type: 'shoulder';
  readonly yaw?: number;
  readonly pitch?: number;
  /** The arm when nothing is in the way and the sights are down, m. */
  readonly distance?: number;
  /** 1 over the right shoulder, −1 over the left. */
  readonly side?: number;
}

/** A shoulder camera's state: plain data, replaced by each step. */
export interface ShoulderState {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly side: number;
  /** The side shown, easing toward `side` after a swap. */
  readonly shown: number;
  readonly fov: number;
  /** The pivot, m: the eye with its lag, the walls aside; null until the first follow. */
  readonly pivot: Vec3 | null;
  /** The shoulder point after the walls, m. */
  readonly shoulder: Vec3 | null;
  /** How far out and up the shoulder point stands, 0 (in at his chest) to 1: a short arm draws it in. */
  readonly near: number;
  /** How fast the shoulder point moved over the last frame, m/s; null until it has moved. */
  readonly went: Vec3 | null;
  /** The arm now, m: how far back from the shoulder point the camera wants to stand; null until the first follow. */
  readonly arm: number | null;
  /** The camera after the walls (collide.ts's `moveCamera`), heading for the arm's end; null until the first follow. */
  readonly ball: CameraBall | null;
}

/** Options for a shoulder camera: its code's data, the lens, and the camera before it. */
export interface ShoulderOptions extends Omit<ShoulderSpec, 'type'> {
  readonly fov?: number;
  /** The camera before this one: without a yaw and pitch, it looks the same way. */
  readonly from?: CameraPose;
}

/** A checked shoulder state for `options`. Throws `GFX_BAD_CAMERA`. */
export function shoulderState(options: ShoulderOptions = {}): ShoulderState {
  const distance = options.distance ?? SHOULDER.back;
  const side = options.side ?? 1;
  const state: ShoulderState = {
    yaw: options.yaw ?? options.from?.yaw ?? 0,
    pitch: options.pitch ?? options.from?.pitch ?? 0,
    distance,
    side,
    shown: side,
    fov: options.fov ?? SHOULDER.lens,
    pivot: null,
    shoulder: null,
    near: 1,
    went: null,
    arm: null,
    ball: null,
  };
  refuse('the shoulder camera', [
    ...rangeProblems({
      yaw: [state.yaw, -1e6, 1e6],
      pitch: [state.pitch, -Math.PI / 2, Math.PI / 2],
      distance: [distance, ...SHOULDER_LIMITS.distance],
      fov: [state.fov, 1, 179],
    }),
    ...(side === 1 || side === -1 ? [] : [`side is ${side}; it must be 1 (right) or -1 (left)`]),
  ]);
  return { ...state, pitch: MathUtils.clamp(state.pitch, ...SHOULDER_LIMITS.pitch) };
}

/**
 * The shoulder point for a pivot, a view heading and a side shown: right of and above the pivot, `near` of the way
 * out from his chest (at height `chest`) to there; at the pivot's height above it when no chest is given.
 */
const shoulderOf = (pivot: Vec3, yaw: number, shown: number, near = 1, chest = pivot[1]): Vec3 => {
  const right = poseRight({ yaw });
  const across = SHOULDER.right * shown * near;
  const up = chest + (pivot[1] + SHOULDER.up - chest) * near;
  return [pivot[0] + right[0] * across, up, pivot[2] + right[2] * across];
};

/** Steps a shoulder camera by one rendered frame (see the file comment). */
export function stepShoulder(state: ShoulderState, input: ShoulderInput, dt: number): ShoulderState {
  const right = (input.look?.[0] ?? 0) + (input.turn?.[0] ?? 0) * SHOULDER_TURN_SPEED[0] * dt;
  const up = (input.look?.[1] ?? 0) + (input.turn?.[1] ?? 0) * SHOULDER_TURN_SPEED[1] * dt;
  const yaw = input.view ? wrapAngle(input.view[0]) : wrapAngle(state.yaw - right);
  const pitch = MathUtils.clamp(input.view ? input.view[1] : state.pitch + up, ...SHOULDER_LIMITS.pitch);
  const side = input.swap ? -state.side : state.side;
  const shown = side + (state.shown - side) * Math.exp(-dt / SHOULDER.swap);
  const aim = MathUtils.clamp(input.aim ?? 0, 0, 1);
  const want = state.distance + (Math.min(SHOULDER.aim, state.distance) - state.distance) * aim;
  const f = input.follow;
  const eye: Vec3 | null = input.eye ?? (f ? [f[0], f[1] + SHOULDER.height, f[2]] : null);
  let pivot = state.pivot;
  if (eye) {
    pivot = pivot ? approach(pivot, eye, 1 - Math.exp(-dt / SHOULDER.lag)) : eye;
    const lag: Vec3 = [pivot[0] - eye[0], pivot[1] - eye[1], pivot[2] - eye[2]];
    const gap = Math.hypot(...lag);
    if (gap > SHOULDER.trail) pivot = approach(eye, pivot, SHOULDER.trail / gap); // never more than `trail` behind
  }
  if (!pivot) return { ...state, yaw, pitch, side, shown, fov: input.lens ?? state.fov };
  const held = eye ? sweep(input, eye, pivot) : pivot; // the walls stop the lag; it follows on as it would
  const fwd = poseForward({ yaw, pitch });
  const [fx, fy, fz] = fwd;
  const jumped = !state.shoulder || Math.hypot(...held.map((v, i) => v - state.shoulder![i])) > COLLIDE_TELEPORT;
  const draw = SHOULDER.draw * dt; // a short arm draws it in, at a pace
  const back = state.ball && state.shoulder ? Math.max(0, [0, 1, 2].reduce((sum, i) => sum + (state.shoulder![i] - state.ball!.at[i]) * fwd[i], 0)) : null; // prettier-ignore
  const near = back === null || jumped ? MathUtils.clamp(reach(input, held, [-fwd[0], -fwd[1], -fwd[2]], want) / SHOULDER.close, 0, 1) : Math.min(MathUtils.clamp(Math.min(back, state.arm ?? back) / SHOULDER.close, 0, 1), state.near + draw); // prettier-ignore
  const chest = (f ? f[1] : held[1] - SHOULDER.height) + SHOULDER.chest;
  const step = (state.pivot ? Math.hypot(...pivot.map((v, i) => v - state.pivot![i])) : Infinity) + COLLIDE_PULL * dt; // prettier-ignore
  const shoulder = follow(input, state.shoulder, held, shoulderOf(held, yaw, shown, near, chest), step);
  // the room the arm will need: back, and each side as far as the view could turn before the arm, coming in, got there
  let room = want;
  for (const turn of SHOULDER_ROOM.sides) {
    for (const sign of turn === 0 ? [1] : [1, -1]) {
      const [gx, gy, gz] = poseForward({ yaw: yaw + sign * turn, pitch });
      room = Math.min(room, reach(input, shoulder, [-gx, -gy, -gz], want) + (COLLIDE_PULL * turn) / SHOULDER_ROOM.turn);
    }
  }
  // and back along its own way: from where the shoulder point and the pitch are going (by his velocity where it is
  // known: the shoulder point follows it a lag behind), as far ahead as the arm, coming in at a share of its pace,
  // would take to be there (a drop off a ledge, down a hatch, a jamb as he steps past it, a look going up)
  // (a frame of no time, a page's warm-up or a paused one, reads no way: its rates would divide by 0)
  const timed = dt > 1e-9;
  const itself = state.shoulder && timed ? [0, 1, 2].map((i) => (shoulder[i] - state.shoulder![i]) / dt) : null;
  const went: Vec3 | null = state.shoulder && !jumped && timed ? ((input.player?.velocity ?? itself) as Vec3) : null;
  if (went) {
    const bend = state.went ? went.map((v, i) => (v - state.went![i]) / dt) : [0, 0, 0];
    const most = Math.min(1, SHOULDER_ROOM.fall / Math.max(Math.hypot(...bend), 1e-9));
    const along = (t: number): Vec3 => [0, 1, 2].map((i) => shoulder[i] + went[i] * t + (bend[i] * most * t * t) / 2) as unknown as Vec3; // prettier-ignore
    const tilt = (pitch - state.pitch) / dt;
    const last = SHOULDER_ROOM.ahead[SHOULDER_ROOM.ahead.length - 1];
    const end = along(last);
    const way = Math.hypot(...end.map((v, i) => v - shoulder[i]));
    const open = way > COLLIDE_SKIN ? Math.hypot(...sweep(input, shoulder, end).map((v, i) => v - shoulder[i])) / way : 1; // prettier-ignore
    for (const t of SHOULDER_ROOM.ahead) {
      const [gx, gy, gz] = poseForward({ yaw, pitch: MathUtils.clamp(pitch + tilt * t, ...SHOULDER_LIMITS.pitch) });
      const from = along(Math.min(t, open * last)); // never past what stops it
      room = Math.min(room, reach(input, from, [-gx, -gy, -gz], want) + COLLIDE_PULL * SHOULDER_ROOM.pace * t);
    }
  }
  const was = state.arm === null || jumped ? room : state.arm;
  const arm = was > room ? Math.max(room, was - COLLIDE_PULL * dt) : was + (room - was) * (1 - Math.exp(-dt / COLLIDE_RETURN)); // prettier-ignore
  const end: Vec3 = [shoulder[0] - fx * arm, shoulder[1] - fy * arm, shoulder[2] - fz * arm];
  // carried with the pivot and the view (with the pivot only where the view's turn would carry it into a wall: a turn
  // in a corner); what the shoulder point does besides (drawn in, a swap) it follows at its pace
  const before = state.ball && state.pivot && !jumped ? { base: state.pivot, yaw: state.yaw, pitch: state.pitch } : null; // prettier-ignore
  const turned = before ? carry(state.ball!.at, before, { base: pivot, yaw, pitch }) : end;
  const inWall = before !== null && input.queries !== undefined && input.queries.overlap({ type: 'ball', radius: COLLIDE_RADIUS - COLLIDE_SKIN }, turned, { groups: input.groups ?? 'world', exclude: input.exclude, fixed: input.fixed ?? true }).length > 0; // prettier-ignore
  const carried = inWall ? carry(state.ball!.at, before!, { ...before!, base: pivot }) : turned;
  const moved = moveCamera(input, before ? state.ball : null, shoulder, carried, end, dt, SHOULDER_KEEP); // never through a wall, at a pace
  const fov = input.lens ?? state.fov;
  const own = Math.hypot(...moved.at.map((v, i) => v - carried[i])); // what it moved of itself, besides the carry
  const spare = Math.max(0, SHOULDER_ROOM.most * COLLIDE_PULL * dt - own);
  const ball = f ? { ...moved, at: framed(input, moved.at, [f[0], f[1] + SHOULDER.chest, f[2]], { yaw, pitch }, fov, spare) } : moved; // prettier-ignore
  return { ...state, yaw, pitch, side, shown, fov, pivot, shoulder, near, went, arm, ball };
}

/**
 * Where a camera at `at` looking along `view` shifts to keep `chest` in its picture (see the file comment): across the
 * view toward it by as much as it stands past `SHOULDER.frame` of the picture's half-height off the middle, up, down or
 * to a side (a square picture: any wider one shows more), at most `most` m, as far as the walls let it.
 */
function framed(
  walls: Walls,
  at: Vec3,
  chest: Vec3,
  view: { yaw: number; pitch: number },
  fov: number,
  most: number,
): Vec3 {
  // prettier-ignore
  const [f, u, r] = [poseForward(view), poseUp(view), poseRight(view)];
  const rel = [chest[0] - at[0], chest[1] - at[1], chest[2] - at[2]];
  const along = (axis: Vec3) => rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2];
  const half = along(f) * Math.tan((fov * DEG) / 2) * SHOULDER.frame;
  if (half <= 0) return at; // behind the camera: no shift frames it
  const off = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - half);
  const [up, across] = [off(along(u)), off(along(r))];
  const shift = Math.hypot(up, across);
  if (shift === 0) return at;
  const k = Math.min(1, most / shift);
  return sweep(walls, at, [0, 1, 2].map((i) => at[i] + (u[i] * up + r[i] * across) * k) as unknown as Vec3);
}

/** The shoulder camera's pose: where its ball stands (the arm back from the shoulder point), looking along the view. */
export function shoulderPose(state: ShoulderState): CameraPose {
  const at = state.shoulder ?? shoulderOf([0, SHOULDER.height, 0], state.yaw, state.shown);
  const f = poseForward(state);
  const position: Vec3 = state.ball?.at ?? [at[0] - f[0] * state.distance, at[1] - f[1] * state.distance, at[2] - f[2] * state.distance]; // prettier-ignore
  const ahead = (at[0] - position[0]) * f[0] + (at[1] - position[1]) * f[1] + (at[2] - position[2]) * f[2];
  return makePose({
    position,
    yaw: state.yaw,
    pitch: state.pitch,
    fov: state.fov,
    near: 0.05,
    far: 500,
    distance: Math.max(ahead, 0.05),
  });
}

/** The shoulder camera's code data. */
export function shoulderSpec(state: ShoulderState): ShoulderSpec {
  return { type: 'shoulder', yaw: state.yaw, pitch: state.pitch, distance: state.distance, side: state.side };
}

const PARTS: readonly CodePart[] = [
  ['yaw', -1e6, 1e6],
  ['pitch', SHOULDER_LIMITS.pitch[0] / DEG, SHOULDER_LIMITS.pitch[1] / DEG],
  ['distance', ...SHOULDER_LIMITS.distance],
  ['side', -1, 1],
];

/** Reads a shoulder camera's code: `cam3=shoulder[,<yaw>,<pitch>,<distance>[,<side>]]`. Throws `GFX_BAD_CAMERA_CODE`. */
export function parseShoulderCode(code: string): ShoulderSpec {
  const [yaw, pitch, distance, side] = readCode(code, 'shoulder', PARTS, [0, 3, 4]);
  if (yaw === undefined) return { type: 'shoulder' };
  const spec: ShoulderSpec = { type: 'shoulder', yaw: yaw * DEG, pitch: pitch * DEG, distance };
  return side === undefined ? spec : { ...spec, side: side < 0 ? -1 : 1 };
}

/** The canonical code of a shoulder camera's data (numbers rounded: 0.01°, 0.001 m; the side only when left). */
export function formatShoulderCode(spec: ShoulderSpec): string {
  if (spec.yaw === undefined) return 'cam3=shoulder';
  const parts = [codeDegrees(spec.yaw, true), codeDegrees(spec.pitch ?? 0), codeNumber(spec.distance ?? SHOULDER.back, 3)]; // prettier-ignore
  return `cam3=shoulder,${parts.join(',')}${spec.side === -1 ? ',-1' : ''}`;
}

/** A shoulder camera in words. */
export function describeShoulder(spec: ShoulderSpec, pose: CameraPose): string {
  const lens = `Shooter camera (perspective, ${codeNumber(pose.fov, 0)}° field of view)`;
  const where = `over the ${spec.side === -1 ? 'left' : 'right'} shoulder, ${codeNumber(spec.distance ?? SHOULDER.back, 3)} m back`; // prettier-ignore
  return `${lens}, ${where}, heading ${codeDegrees(pose.yaw, true)}°, pitch ${codeDegrees(pose.pitch)}°`;
}

/** A shoulder camera: over the hero's shoulder (`input.eye`), turned by the devices, in front of the walls. */
export function createShoulderCamera(
  options: ShoulderOptions = {},
): FollowCamera<'shoulder', ShoulderSpec, ShoulderInput> {
  const steps = { step: stepShoulder, pose: shoulderPose, spec: shoulderSpec, code: formatShoulderCode, describe: describeShoulder }; // prettier-ignore
  return followCamera('shoulder', shoulderState(options), steps, { effects: SHOULDER_EFFECTS, fade: true });
}
