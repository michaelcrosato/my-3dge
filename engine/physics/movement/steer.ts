/**
 * @file One tick of the shooter model (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2), in the order of Apex's own tick
 * (er-apex's `controller.rs` `tick`, lines 551-700; MIT, engine/physics/movement/NOTICE): the timers and the climb
 * space; a mantle's tick (engine/physics/movement/mantle.ts: the feet moved along its path, no controller), the
 * superglide's crouch, a climb's tick (climb.ts); the duck and the slide it starts (crouch.ts), the sprint, a mantle
 * or a climb starting (a jump at a ledge mantles instead), the jump, then the walk on the ground
 * (engine/physics/movement/ground.ts; a slide's between the halves of its pull along the floor) or the lurch and the
 * air move in the air (air.ts), then gravity, integrated exactly; after the controller's move, `settleMotion` takes a
 * slide's step-up cost, lands (the fall stun, by the impact speed along the floor's normal; ducked, a landing slides),
 * keeps the floor, the flight's count and turns the character toward where it faces at the model's turn rate (toward
 * the wall while it mantles or climbs).
 * engine/physics/character.ts's `stepCharacter` runs these in place of engine/physics/feel.ts's `steer` and `settle`
 * for a character with a model (`character.movement`), and gives its body the hull its stance has
 * (engine/physics/hull.ts); the controller's move, walls, pushes and the ground probe are the same for both.
 *
 * Its input beyond the platformer's (`CharacterInput`): `sprint` and `sprintPressed`, `walk`, `crouch` and
 * `crouchToggle`, `view` (the view's yaw: the sprint's 45°, the slide's 53°), `frame` (the yaw the move's keys are
 * turned by, the camera's: the lurch's new key) and `face` (a yaw to face: the look's or the aim's; without it, it
 * faces where it moves); and the world's answers (`Room`: whether it may stand, its feet, walls and ledges ahead,
 * engine/physics/room.ts). Jumps keep the controller's coyote time and buffer (`feel.coyote`, `feel.buffer`), so a
 * press is never lost (docs/PLAYGROUND.md §3.4); a jump after a jump gets no coyote time, and there is no variable
 * jump and no dash. A slide's jump goes `slide.jump` high and ends it.
 *
 * Invariants: reads and writes only the states it is given; same states and input, same tick.
 *
 * @example
 * // in stepCharacter: const plan = steerMotion(character, state, motion, input, dt, g, room); … settleMotion(…)
 * @see engine/physics/movement/steer.test.ts
 */
import { Vector3 } from '../../core/math';
import type { Character, CharacterInput, CharacterState } from '../character';
import type { Steering } from '../feel';
import type { Ledge, Wall } from '../ledge';
import type { CharacterMove } from '../move';
import { airMove, hopSpeed, jumpScale, land, landSlowdown, lurch, newKey } from './air';
import { keepSpace, stepClimb, tryClimb } from './climb';
import { crouchBlocks, ducking, endSlide, slideJump, slopePull, tryStartSlide, updateDuck, type FloorNormal } from './crouch'; // prettier-ignore
import { gaitSpeed, updateSprint, walkMove } from './ground';
import { stepLadder, tryLadder } from './ladder';
import { crouchPressed, glide, stepMantle, tryMantle, type MantleTick } from './mantle';
import type { MotionState } from './model';
import { NO_RIDES, stepSkydive, stepZipline, tryZipline, type Rides } from './ride';

/** What the model asks the world (engine/physics/room.ts answers from the physics). */
export interface Room {
  /** Whether the standing hull fits where the character is, its feet kept. */
  stand(): boolean;
  /** Where its feet are (m). */
  feet(): readonly [number, number, number];
  /** A wall ahead along `dir` (a unit `[x, z]`) within `probe` of the hull, steeper than it walks, or null. */
  wall(dir: readonly [number, number], probe: number): Wall | null;
  /** A ledge on top of `wall`, its lip within `reach` above the feet, that the hull can mantle onto, or null. */
  ledge(wall: Wall, reach: number): Ledge | null;
  /** How far the hull as it is moves from feet at `from` toward feet at `to` before it meets anything (m): all the way when clear. */ // prettier-ignore
  sweep(from: readonly [number, number, number], to: readonly [number, number, number]): number;
  /** How far below the feet the ground is, looking at most `max` down (m); null when none is that close. */
  below(max: number): number | null;
}

/** A world with headroom everywhere and no walls: what a tick with no physics (a test's) runs in. */
const OPEN: Room = {
  stand: () => true,
  feet: () => [0, 0, 0],
  wall: () => null,
  ledge: () => null,
  sweep: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
  below: () => null,
};

/** The steering of a tick that moves the feet along a mantle's path, or that climbs at the velocity it set. */
function steered(
  state: CharacterState,
  wish: readonly [number, number],
  wasGrounded: boolean,
  dt: number,
  path?: Steering['path'],
): Steering {
  const desired = path ? new Vector3() : new Vector3(state.vx * dt, state.vy * dt, state.vz * dt);
  return { desired, jumped: false, dashed: false, dashing: false, wish, wasGrounded, ...(path ? { path } : {}) };
}

/** The move, at most length 1. */
function clampMove(move: CharacterInput['move']): [number, number] {
  const [x, z] = move ?? [0, 0];
  const length = Math.hypot(x, z);
  return length > 1 ? [x / length, z / length] : [x, z];
}

/** The move in its keys' frame, `[right, forward]`: engine/input/intents.ts's `fromCamera` undone at yaw `frame`. */
function keysOf(wish: readonly [number, number], frame: number): [number, number] {
  const [s, c] = [Math.sin(frame), Math.cos(frame)];
  return [wish[1] * s - wish[0] * c, wish[0] * s + wish[1] * c];
}

/** Seconds since the last landing, from its age in ticks; −1 before the first. */
const sinceLanding = (motion: MotionState, dt: number) => (motion.landAge < 0 ? -1 : motion.landAge * dt);

/** The floor under it last tick, as `motion` keeps it. */
const floorOf = (motion: MotionState): FloorNormal => [motion.floorX, motion.floorY, motion.floorZ];

/** The tick before the move (see the file comment). Changes `state` and `motion` and returns the move to make. */
export function steerMotion(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  dt: number,
  g: number,
  room: Room = OPEN,
  rides: Rides = NO_RIDES,
): Steering {
  const m = character.movement!;
  const ticks = (seconds: number) => Math.round(seconds / dt);
  let wasGrounded = state.grounded;
  const [coyote, buffer] = [ticks(character.feel.coyote), ticks(character.feel.buffer)];
  state.jumpAge = input.jumpPressed ? 0 : state.jumpAge >= 0 && state.jumpAge < buffer ? state.jumpAge + 1 : -1;
  if (motion.landAge >= 0) motion.landAge = Math.min(motion.landAge + 1, 1e6);
  if (motion.flight >= 0) motion.flight = Math.min(motion.flight + 1, 1e6);
  if (motion.slideAge >= 0) motion.slideAge = Math.min(motion.slideAge + 1, 1e6);
  if (motion.glideAge >= 0) motion.glideAge = Math.min(motion.glideAge + 1, 1e6);
  motion.stickyLeft = Math.max(0, motion.stickyLeft - 1);
  motion.mantleCool = Math.max(0, motion.mantleCool - 1);
  motion.rideCool = Math.max(0, motion.rideCool - 1);
  const wish = clampMove(input.move);
  const keys = keysOf(wish, input.frame ?? 0);
  const view = input.view === undefined ? null : ([Math.sin(input.view), Math.cos(input.view)] as const);
  const since = sinceLanding(motion, dt);
  const slowdown = landSlowdown(m, motion.fall, since < 0 ? Infinity : since);
  const scale = slowdown * (motion.holstered ? m.gaits.holstered : 1);
  const h: [number, number] = [state.vx, state.vz];
  const tick: MantleTick = { wish, view, scale, dt, g };
  keepSpace(motion, room.feet()[1], wasGrounded);
  if (motion.mode === 'mantle') {
    const path = stepMantle(character, state, motion, input, tick);
    if (path) return steered(state, wish, wasGrounded, dt, path);
    wasGrounded = state.grounded; // stepped off onto the top: a ground tick from here
  }
  if (motion.mode === 'zipline' || motion.mode === 'ladder') {
    const next = motion.mode === 'zipline' ? stepZipline(character, state, motion, input, rides, tick) : stepLadder(character, state, motion, input, rides, room, tick); // prettier-ignore
    if (next === 'mantle') return steered(state, wish, wasGrounded, dt, stepMantle(character, state, motion, input, tick, true)!); // prettier-ignore
    if (next) return steered(state, wish, wasGrounded, dt, next);
  }
  if (motion.mode === 'skydive') {
    const desired = stepSkydive(character, state, motion, input, room, tick);
    return { desired, jumped: false, dashed: false, dashing: false, wish, wasGrounded };
  }
  if (motion.glideAge === 1 && crouchPressed(input, motion)) glide(character, state, motion, tick, false);
  if (motion.glideAge >= 1) motion.glideAge = -1;
  if (motion.mode === 'climb') {
    const next = stepClimb(character, state, motion, input, room, tick);
    if (next === 'mantle') return steered(state, wish, wasGrounded, dt, stepMantle(character, state, motion, input, tick, true)!); // prettier-ignore
    if (next === 'climb') return steered(state, wish, wasGrounded, dt);
  }
  [h[0], h[1]] = [state.vx, state.vz];
  const start = motion.stance;
  const crouch = { held: input.crouch === true, toggled: input.crouchToggle === true };
  updateDuck(m, motion, { ...crouch, h, vertical: state.vy, floor: wasGrounded ? floorOf(motion) : null, wish, view, scale, dt, canStand: () => room.stand() }); // prettier-ignore
  const footing = wasGrounded || (state.air * dt <= m.sprint.air && !motion.jumped);
  const sprint = { held: input.sprint === true, pressed: input.sprintPressed === true, blocked: input.walk === true };
  if (sprint.pressed && !sprint.blocked) motion.crouchToggle = false;
  updateSprint(m, motion, { ...sprint, wish, view, velocity: h, footing, slowdown, dt });
  if (tryLadder(character, state, motion, input, rides, room, tick)) {
    const next = stepLadder(character, state, motion, input, rides, room, tick, true);
    if (next === 'mantle') return steered(state, wish, wasGrounded, dt, stepMantle(character, state, motion, input, tick, true)!); // prettier-ignore
    if (next) return steered(state, wish, wasGrounded, dt, next);
  }
  if (tryZipline(character, state, motion, input, rides, room, tick, wasGrounded)) {
    const path = stepZipline(character, state, motion, input, rides, tick, true);
    if (path) return steered(state, wish, wasGrounded, dt, path);
  }
  const jump = state.jumpAge >= 0 || input.jump === true;
  if (tryMantle(character, state, motion, input, room, { ...tick, grounded: wasGrounded, h, jump })) {
    return steered(state, wish, wasGrounded, dt, stepMantle(character, state, motion, input, tick, true)!);
  }
  if (!wasGrounded && tryClimb(character, state, motion, input, room, tick)) {
    const next = stepClimb(character, state, motion, input, room, tick);
    if (next === 'mantle') return steered(state, wish, wasGrounded, dt, stepMantle(character, state, motion, input, tick, true)!); // prettier-ignore
    if (next === 'climb') return steered(state, wish, wasGrounded, dt);
    [h[0], h[1]] = [state.vx, state.vz];
  }
  let jumped = false;
  const near = wasGrounded || (state.air <= coyote && !motion.jumped);
  if (state.jumpAge >= 0 && near && !crouchBlocks(m, motion, near)) {
    if (motion.sliding) slideJump(m, motion, h, dt);
    const speed = Math.hypot(h[0], h[1]);
    const kept = hopSpeed(m, speed, since, scale);
    if (kept < speed) [h[0], h[1]] = [(h[0] * kept) / speed, (h[1] * kept) / speed];
    const lift = motion.sliding ? Math.sqrt(2 * g * m.slide.jump) : character.jumpSpeed;
    state.vy = lift * Math.sqrt(jumpScale(m, since, motion.fatigued));
    Object.assign(state, { jumping: true, air: coyote + 1, jumpAge: -1 });
    Object.assign(motion, { jumped: true, fatigued: true, flight: 0 });
    endSlide(motion);
    jumped = true;
  }
  if (wasGrounded && !jumped) {
    const floor = floorOf(motion);
    if (motion.sliding) slopePull(h, floor, 0.5, g, dt);
    const braking = !(crouch.held || motion.crouchToggle) || h[0] * wish[0] + h[1] * wish[1] < 0;
    const speed = scale * gaitSpeed(m, motion, sprint.blocked, wish, view);
    walkMove(m, h, wish, speed, start, scale, dt, motion.sprinting, motion.sliding ? { braking } : undefined);
    if (motion.sliding && Math.hypot(h[0], h[1]) < m.slide.end) endSlide(motion);
    if (motion.sliding) slopePull(h, floor, 0.5, g, dt);
    const moving = Math.hypot(h[0], h[1]) > 0.1 || Math.hypot(wish[0], wish[1]) > 0.1;
    motion.gait = motion.sliding ? 'slide' : !moving ? 'idle' : motion.stance === 'crouch' ? 'crouch' : motion.sprinting ? 'sprint' : sprint.blocked ? 'walk' : 'run'; // prettier-ignore
  } else {
    if (motion.flight >= 1 && newKey(m, keys, [motion.keyRight, motion.keyForward])) lurch(m, h, wish, motion.flight * dt); // prettier-ignore
    airMove(m, h, wish, scale, dt);
  }
  [motion.keyRight, motion.keyForward] = keys;
  [state.vx, state.vz] = h;
  const v0 = state.vy;
  state.vy = Math.max(v0 - g * dt, -character.maxFall);
  const desired = new Vector3(state.vx * dt, ((v0 + state.vy) / 2) * dt, state.vz * dt);
  if (desired.lengthSq() < 1e-8) desired.y -= 1e-3;
  return { desired, jumped, dashed: false, dashing: false, wish, wasGrounded };
}

/** The most upward-facing surface the move's vertical leg touched, else straight up. */
function groundNormal(move: CharacterMove): [number, number, number] {
  let best: [number, number, number] = [0, 1, 0];
  let up = -Infinity;
  for (const hit of move.vertical) {
    if (hit.normal.y > up) [up, best] = [hit.normal.y, [hit.normal.x, hit.normal.y, hit.normal.z]];
  }
  return up > 0 ? best : [0, 1, 0];
}

/** `yaw` turned toward `target` by at most `step` radians, kept within (−π, π]. */
export function turnToward(yaw: number, target: number, step: number): number {
  let d = (target - yaw) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  let next = yaw + Math.max(-step, Math.min(step, d));
  if (next > Math.PI) next -= 2 * Math.PI;
  else if (next <= -Math.PI) next += 2 * Math.PI;
  return next;
}

/**
 * The tick after the move (see the file comment): a slide's step-up cost (`slide.step` a metre climbed), landing (the
 * stun applied to the velocity across the ground; ducked, a landing slides; returns the landing speed when above
 * 2 m/s, else 0), a head bump ending a rise, walking off a ledge clearing the jump's fatigue, the floor under it, the
 * mode, and the turn toward `input.face`, else the move.
 */
export function settleMotion(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  steering: Steering,
  move: CharacterMove,
  g: number,
  dt: number,
): number {
  const m = character.movement!;
  const wall = Math.atan2(-motion.wallX, -motion.wallZ);
  if (steering.path) {
    const riding = motion.mode === 'zipline' || motion.mode === 'ladder';
    Object.assign(state, { grounded: false, vy: riding ? state.vy : 0, jumping: false, air: Math.min(state.air + 1, 1e6) }); // prettier-ignore
    const across = motion.mode === 'zipline' && Math.hypot(state.vx, state.vz) > 0.1;
    const face = motion.mode === 'zipline' ? (across ? Math.atan2(state.vx, state.vz) : state.yaw) : wall;
    state.yaw = turnToward(state.yaw, face, m.turnRate * dt);
    return 0;
  }
  let landed = 0;
  const grounded = move.grounded && state.vy <= 0;
  const speed = Math.hypot(state.vx, state.vz);
  if (motion.sliding && move.climbed > 0 && speed > 0) {
    const k = Math.max(speed - move.climbed * m.slide.step, 0) / speed;
    [state.vx, state.vz] = [state.vx * k, state.vz * k];
  }
  const floor = groundNormal(move);
  if (grounded && !steering.wasGrounded) {
    const k = land(m, motion, [state.vx, state.vy, state.vz], floor, g, dt);
    if (motion.mode === 'skydive') [motion.fall, motion.landing] = [0, false]; // a skydive lands with no stun
    [state.vx, state.vz] = motion.mode === 'skydive' ? [state.vx, state.vz] : [state.vx * k, state.vz * k];
    if (state.vy < -2) landed = -state.vy;
    motion.jumped = false;
    if (ducking(motion)) {
      const h: [number, number] = [state.vx, state.vz];
      const scale = landSlowdown(m, motion.fall, 0) * (motion.holstered ? m.gaits.holstered : 1);
      const view = input.view === undefined ? null : ([Math.sin(input.view), Math.cos(input.view)] as const);
      tryStartSlide(m, motion, { h, normal: floor, air: true, vertical: state.vy, wish: steering.wish, view, scale, dt }); // prettier-ignore
      [state.vx, state.vz] = h;
    }
  }
  if (!grounded) [motion.floorX, motion.floorY, motion.floorZ] = [0, 1, 0];
  else if (move.vertical.length > 0) [motion.floorX, motion.floorY, motion.floorZ] = floor;
  if (!grounded && steering.wasGrounded && !steering.jumped) motion.fatigued = false;
  state.grounded = grounded;
  if (grounded) {
    Object.assign(state, { vy: 0, air: 0, jumping: false });
    motion.flight = -1;
  } else {
    state.air = Math.min(state.air + 1, 1e6);
    if (state.vy > 0 && move.moved.y < steering.desired.y * 0.5) [state.vy, state.jumping] = [0, false];
  }
  if (state.vy <= 0) state.jumping = false;
  const climbing = !grounded && motion.mode === 'climb';
  if (grounded) [motion.climbAge, motion.catches] = [-1, 0];
  motion.mode = grounded ? 'ground' : climbing ? 'climb' : motion.mode === 'skydive' ? 'skydive' : 'air';
  const [wx, wz] = steering.wish;
  const target = climbing ? wall : (input.face ?? (Math.hypot(wx, wz) > 0.1 ? Math.atan2(wx, wz) : undefined));
  if (target !== undefined) state.yaw = turnToward(state.yaw, target, m.turnRate * dt);
  return landed;
}
