/**
 * @file The shooter model's mantle and superglide (PLAN.md WP 13.6, docs/PLAYGROUND.md §3.2), as the Apex Movement
 * Wiki measures them: up a ledge engine/physics/ledge.ts found, along its path, the feet moved straight along it
 * (engine/physics/character.ts's `stepCharacter`: the path is clear, so no controller), in two timed phases.
 *
 * - `tryMantle`: on the ground holding jump (`mantle.auto`, 2.03 m: Apex's auto mantle), or in the air moving at a
 *   wall (the push, else the velocity: no forward needed; `mantle.reach`), the move and the view within
 *   `mantle.angle` of facing it, `mantle.cooldown` after the last. A ledge no higher than `mantle.low` over the feet
 *   is only pulled over; else the grab (`mantle.grab`: to the wall and up past the lip), then the pull
 *   (`mantle.pull`: across onto the top and down onto it). Only the crouched hull fits: it mantles crouched.
 * - The grab: letting go of forward hangs from the ledge when the lip stands `mantle.hang` over the ground below (the
 *   mantle hang: it waits there; forward goes on, back or crouch lets go); otherwise, as on arrival, it goes on into
 *   the pull. Back or crouch cancel the grab, forward winning; once pulling it finishes, unless back lets go.
 * - A jump in it hops out (the mantle hop): a full jump, fatigue cleared and none armed, forward over the ledge out of
 *   the pull. It leaves at the gait it came in at (`exitGait`: a sprint at full sprint, ready to slide at once), on the
 *   top, fatigue cleared.
 * - The superglide: a hop in the pull's last `mantle.window`, then a crouch press the very next tick, glides at
 *   `mantle.glide` times its exit speed, rising `mantle.glideJump`; within the slide boost's cooldown it lacks the
 *   boost, and it starts that cooldown. The mantle boost (`mantle.boost`, Apex's one-button form): a crouch press in
 *   the window glides at full speed rising a full jump, the lurch off until it lands.
 *
 * Invariants: phases count whole ticks; the motion holds the whole path (where it began, the rise column, the lip, the
 * landing) and each phase starts its path where the last left the feet, so a restored state goes on alike; they change
 * only the states they are given.
 *
 * @example
 * // in steerMotion: if (motion.mode === 'mantle') { const path = stepMantle(character, state, motion, input, tick); … }
 * @see engine/physics/movement/mantle.test.ts
 */
import type { Character, CharacterInput, CharacterState } from '../character';
import { ledgePath, type Ledge } from '../ledge';
import { endSlide } from './crouch';
import type { MotionState, MovementModel } from './model';
import type { Room } from './steer';

/** A point, world metres. */
type Point = readonly [number, number, number];

/** What a mantle's tick reads beside the states: the tick's own numbers, as steerMotion has them. */
export interface MantleTick {
  /** The move, at most length 1, and the view's direction across the ground (null: none). */
  wish: readonly [number, number];
  view: readonly [number, number] | null;
  /** Every gait's speed times this: holstered, after a stun. */
  scale: number;
  dt: number;
  g: number;
}

/** The ticks `seconds` take, at least one. */
const ticksOf = (seconds: number, dt: number) => Math.max(1, Math.round(seconds / dt));

/** Whether the crouch went down this tick: the held button's press or the toggle's. */
export const crouchPressed = (input: CharacterInput, motion: MotionState) =>
  (input.crouch === true && !motion.crouchHeld) || input.crouchToggle === true;

/** The speed `gait` leaves a mantle at (m/s). */
function exitSpeed(m: MovementModel, gait: MotionState['exitGait'], scale: number): number {
  const speed = { sprint: m.gaits.sprint, walk: m.gaits.walk, crouch: m.gaits.crouch, slide: m.gaits.sprint, run: m.gaits.run, idle: m.gaits.run }; // prettier-ignore
  return speed[gait] * scale;
}

/** The point a share `s` of the way along the polyline `points`. */
function along(points: readonly Point[], s: number): Point {
  const legs = points.slice(1).map((b, k) => Math.hypot(b[0] - points[k][0], b[1] - points[k][1], b[2] - points[k][2])); // prettier-ignore
  let left = Math.min(Math.max(s, 0), 1) * legs.reduce((a, b) => a + b, 0);
  for (let k = 0; k < legs.length; k++) {
    if (left <= legs[k] && legs[k] > 0) {
      const [a, b, t] = [points[k], points[k + 1], left / legs[k]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    left -= legs[k];
  }
  return points[points.length - 1];
}

/** The mantle's path from where its phase began (see engine/physics/ledge.ts's `ledgePath`). */
function pathOf(character: Character, motion: MotionState): Point[] {
  const { fromX, fromY, fromZ, riseX, riseZ, lipX, lipY, lipZ, toX, toY, toZ } = motion;
  return ledgePath(character, [fromX, fromY, fromZ], [riseX, riseZ], [lipX, lipY, lipZ], [toX, toY, toZ]);
}

/** Where the feet are in the phase now: the grab's share of its legs (to the wall, up), else the pull's of all. */
function placeOf(character: Character, motion: MotionState): Point {
  const path = pathOf(character, motion);
  const done = (motion.mantleTotal - motion.mantleLeft) / Math.max(motion.mantleTotal, 1);
  return along(motion.mantle === 'pull' ? path : path.slice(0, 3), done);
}

/** A unit direction across the ground: the push, else (in the air) the velocity's; null for neither. */
function headingOf(wish: readonly [number, number], h: readonly [number, number] | null): [number, number] | null {
  const push = Math.hypot(wish[0], wish[1]);
  if (push > 0.1) return [wish[0] / push, wish[1] / push];
  const speed = h ? Math.hypot(h[0], h[1]) : 0;
  return h && speed > 0.5 ? [h[0] / speed, h[1] / speed] : null;
}

/** What `tryMantle` reads beside a tick's numbers. */
export interface MantleTry extends MantleTick {
  /** On the ground at the tick's start; the velocity across the ground; jump pressed (buffered) or held. */
  grounded: boolean;
  h: readonly [number, number];
  jump: boolean;
}

/** Starts a mantle if one takes (see the file comment); true when it did. */
export function tryMantle(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  room: Room,
  at: MantleTry,
): boolean {
  const m = character.movement!;
  if (motion.mantleCool > 0 || (at.grounded && !at.jump)) return false;
  const dir = headingOf(at.wish, at.grounded ? null : at.h);
  const wall = dir && room.wall(dir, m.mantle.probe);
  if (!dir || !wall) return false;
  const cos = Math.cos(m.mantle.angle);
  const faces = (d: readonly [number, number]) => -(d[0] * wall.normal[0] + d[1] * wall.normal[1]) >= cos - 1e-9;
  if (!faces(dir) || (at.view && !faces(at.view))) return false;
  const ledge = room.ledge(wall, at.grounded ? m.mantle.auto : m.mantle.reach);
  if (!ledge) return false;
  startMantle(character, state, motion, input, ledge, room.feet(), at.dt);
  return true;
}

/** Starts a mantle up `ledge` from the feet at `feet`: a grab, or for a low ledge only the pull (see the file comment). */ // prettier-ignore
export function startMantle(character: Character, state: CharacterState, motion: MotionState, input: CharacterInput, ledge: Ledge, feet: Point, dt: number): void { // prettier-ignore
  const m = character.movement!;
  const low = ledge.height <= m.mantle.low;
  const total = ticksOf(low ? m.mantle.pull : m.mantle.grab, dt);
  const crouched = input.crouch === true || motion.crouchToggle || motion.stance === 'crouch' || ledge.crouched;
  const exitGait = input.sprint === true || motion.sprinting || motion.sticky ? 'sprint' : crouched ? 'crouch' : input.walk ? 'walk' : 'run'; // prettier-ignore
  Object.assign(motion, {
    mode: 'mantle', mantle: low ? 'pull' : 'grab', mantleLeft: total, mantleTotal: total, glideAge: -1, climbAge: -1,
    fromX: feet[0], fromY: feet[1], fromZ: feet[2], toX: ledge.landing[0], toY: ledge.landing[1], toZ: ledge.landing[2],
    lipX: ledge.edge[0], lipY: ledge.edge[1], lipZ: ledge.edge[2], riseX: ledge.rise[0], riseZ: ledge.rise[1],
    wallX: ledge.normal[0], wallZ: ledge.normal[1], landCrouch: ledge.crouched, hangRoom: ledge.drop >= m.mantle.hang,
    exitGait, jumped: false, fatigued: false, flight: -1,
  }); // prettier-ignore
  if (ledge.crouched) Object.assign(motion, { duck: 'ducked', duckLeft: 0, stance: 'crouch', airDuck: false });
  endSlide(motion);
  const air = Math.round(character.feel.coyote / dt) + 1; // no coyote jump out of a mantle
  Object.assign(state, { vx: 0, vy: 0, vz: 0, jumping: false, jumpAge: -1, air });
}

/** Leaves the mantle into the air, `mantle.cooldown` before the next; a hop jumps, at `h` across the ground. */
function leave(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  h: readonly [number, number],
  hop: boolean,
  dt: number,
): void {
  const m = character.movement!;
  Object.assign(motion, { mode: 'air', mantle: 'none', mantleLeft: 0, mantleCool: ticksOf(m.mantle.cooldown, dt) });
  Object.assign(state, { vx: h[0], vz: h[1], vy: hop ? character.jumpSpeed : 0, jumping: hop, jumpAge: -1 });
  if (hop) Object.assign(motion, { jumped: true, fatigued: false, flight: 0 });
}

/**
 * One tick of a mantle (see the file comment): the feet's next point on the path, or null once it hopped out or let
 * go (the tick goes on in the air) or, its pull done the tick before, stepped off onto the top (it goes on there).
 * `starting`: the tick it began, whose presses started it.
 */
export function stepMantle(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  tick: MantleTick,
  starting = false,
): Point | null {
  const m = character.movement!;
  const { dt } = tick;
  const into: [number, number] = [-motion.wallX, -motion.wallZ];
  const speed = exitSpeed(m, motion.exitGait, tick.scale);
  if (motion.mantle === 'pull' && motion.mantleLeft === 0) {
    const cool = ticksOf(m.mantle.cooldown, dt);
    Object.assign(motion, { mode: 'ground', mantle: 'none', mantleCool: cool, gait: motion.exitGait, sprinting: motion.exitGait === 'sprint', flight: -1 }); // prettier-ignore
    Object.assign(state, { vx: into[0] * speed, vy: 0, vz: into[1] * speed, grounded: true, air: 0 });
    return null;
  }
  const push = tick.wish[0] * into[0] + tick.wish[1] * into[1];
  const [forward, back] = [push >= 0.3, push <= -0.3];
  const jump = input.jumpPressed === true && !starting;
  const crouch = crouchPressed(input, motion) && !starting;
  const windowed = motion.mantle === 'pull' && motion.mantleLeft <= ticksOf(m.mantle.window, dt);
  if (jump) {
    const out = motion.mantle === 'pull' ? ([into[0] * speed, into[1] * speed] as const) : ([0, 0] as const);
    if (windowed) motion.glideAge = 0;
    leave(character, state, motion, out, true, dt);
    return null;
  }
  if (crouch && windowed && m.mantle.boost) {
    leave(character, state, motion, [0, 0], false, dt);
    glide(character, state, motion, tick, true);
    return null;
  }
  if (!forward && (back || (crouch && motion.mantle !== 'pull'))) {
    leave(character, state, motion, [0, 0], false, dt);
    return null;
  }
  if (motion.mantle === 'grab' && !forward && motion.hangRoom && !starting) motion.mantle = 'hang';
  if (motion.mantle === 'hang' && forward) motion.mantle = 'grab';
  if (motion.mantle === 'grab' && motion.mantleLeft === 0) {
    const at = placeOf(character, motion);
    const total = ticksOf(m.mantle.pull, dt);
    Object.assign(motion, { mantle: 'pull', mantleLeft: total, mantleTotal: total, fromX: at[0], fromY: at[1], fromZ: at[2] }); // prettier-ignore
  }
  if (motion.mantle !== 'hang') motion.mantleLeft = Math.max(motion.mantleLeft - 1, 0);
  [state.vx, state.vy, state.vz] = [0, 0, 0];
  return placeOf(character, motion);
}

/**
 * The superglide (see the file comment), or with `boost` the mantle boost: across the ground at `mantle.glide` times
 * the exit speed along the push (else over the ledge), less the slide's boost within its cooldown unless `boost`.
 */
export function glide(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  tick: MantleTick,
  boost: boolean,
): void {
  const m = character.movement!;
  const ready = motion.slideAge < 0 || motion.slideAge >= Math.round(m.slide.cooldown / tick.dt);
  const full = m.mantle.glide * exitSpeed(m, motion.exitGait, tick.scale);
  const speed = boost || ready ? full : full - m.slide.boost * tick.scale;
  const dir = headingOf(tick.wish, null) ?? [-motion.wallX, -motion.wallZ];
  [state.vx, state.vz] = [dir[0] * speed, dir[1] * speed];
  state.vy = boost ? character.jumpSpeed : Math.sqrt(2 * tick.g * m.mantle.glideJump);
  Object.assign(state, { jumping: true, jumpAge: -1 });
  const lurchless = Math.round(m.lurch.window / tick.dt) + 1;
  Object.assign(motion, { slideAge: 0, glideAge: -1, jumped: true, fatigued: false, flight: boost ? lurchless : 0 });
}
