/**
 * @file One tick of the shooter model (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2), in the order of Apex's own tick
 * (er-apex's `controller.rs` `tick`, lines 551-700; MIT, engine/physics/movement/NOTICE): the timers and the stance,
 * the sprint, the jump, then the walk on the ground (engine/physics/movement/ground.ts) or the lurch and the air move
 * in the air (air.ts), then gravity, integrated exactly; after the controller's move, `settleMotion` lands (the fall
 * stun, by the impact speed along the floor's normal), keeps the flight's count and turns the character toward where it
 * faces at the model's turn rate. engine/physics/character.ts's `stepCharacter` runs these in place of
 * engine/physics/feel.ts's `steer` and `settle` for a character with a model (`character.movement`); the controller's
 * move, walls, pushes and the ground probe are the same for both.
 *
 * Its input beyond the platformer's (`CharacterInput`): `sprint` and `sprintPressed`, `walk`, `crouch`, `view` (the
 * view's yaw: the sprint's 45°), `frame` (the yaw the move's keys are turned by, the camera's: the lurch's new key) and
 * `face` (a yaw to face: the look's or the aim's; without it, it faces where it moves). Jumps keep the controller's
 * coyote time and buffer (`feel.coyote`, `feel.buffer`), so a press is never lost (docs/PLAYGROUND.md §3.4); a jump
 * after a jump gets no coyote time, and there is no variable jump and no dash.
 *
 * Invariants: reads and writes only the states it is given; same states and input, same tick.
 *
 * @example
 * // in stepCharacter: const plan = steerMotion(character, state, motion, input, dt, g); … settleMotion(…)
 * @see engine/physics/movement/steer.test.ts
 */
import { Vector3 } from '../../core/math';
import type { Character, CharacterInput, CharacterState } from '../character';
import type { Steering } from '../feel';
import type { CharacterMove } from '../move';
import { airMove, hopSpeed, jumpScale, land, landSlowdown, lurch, newKey } from './air';
import { gaitSpeed, updateSprint, walkMove } from './ground';
import type { MotionState } from './model';

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

/** The tick before the move (see the file comment). Changes `state` and `motion` and returns the move to make. */
export function steerMotion(
  character: Character,
  state: CharacterState,
  motion: MotionState,
  input: CharacterInput,
  dt: number,
  g: number,
): Steering {
  const m = character.movement!;
  const ticks = (seconds: number) => Math.round(seconds / dt);
  const wasGrounded = state.grounded;
  const [coyote, buffer] = [ticks(character.feel.coyote), ticks(character.feel.buffer)];
  state.jumpAge = input.jumpPressed ? 0 : state.jumpAge >= 0 && state.jumpAge < buffer ? state.jumpAge + 1 : -1;
  if (motion.landAge >= 0) motion.landAge = Math.min(motion.landAge + 1, 1e6);
  if (motion.flight >= 0) motion.flight = Math.min(motion.flight + 1, 1e6);
  motion.stickyLeft = Math.max(0, motion.stickyLeft - 1);
  motion.stance = input.crouch ? 'crouch' : 'stand';
  const wish = clampMove(input.move);
  const keys = keysOf(wish, input.frame ?? 0);
  const view = input.view === undefined ? null : ([Math.sin(input.view), Math.cos(input.view)] as const);
  const since = sinceLanding(motion, dt);
  const slowdown = landSlowdown(m, motion.fall, since < 0 ? Infinity : since);
  const scale = slowdown * (motion.holstered ? m.gaits.holstered : 1);
  const h: [number, number] = [state.vx, state.vz];
  const footing = wasGrounded || (state.air * dt <= m.sprint.air && !motion.jumped);
  const sprint = { held: input.sprint === true, pressed: input.sprintPressed === true, blocked: input.walk === true };
  updateSprint(m, motion, { ...sprint, wish, view, velocity: h, footing, slowdown, dt });
  let jumped = false;
  if (state.jumpAge >= 0 && (wasGrounded || (state.air <= coyote && !motion.jumped))) {
    const speed = Math.hypot(h[0], h[1]);
    const kept = hopSpeed(m, speed, since, scale);
    if (kept < speed) [h[0], h[1]] = [(h[0] * kept) / speed, (h[1] * kept) / speed];
    state.vy = character.jumpSpeed * Math.sqrt(jumpScale(m, since, motion.fatigued));
    Object.assign(state, { jumping: true, air: coyote + 1, jumpAge: -1 });
    Object.assign(motion, { jumped: true, fatigued: true, flight: 0 });
    jumped = true;
  }
  if (wasGrounded && !jumped) {
    walkMove(m, h, wish, scale * gaitSpeed(m, motion, sprint.blocked, wish, view), motion.stance, scale, dt, motion.sprinting); // prettier-ignore
    const moving = Math.hypot(h[0], h[1]) > 0.1 || Math.hypot(wish[0], wish[1]) > 0.1;
    motion.gait = !moving ? 'idle' : motion.stance === 'crouch' ? 'crouch' : motion.sprinting ? 'sprint' : sprint.blocked ? 'walk' : 'run'; // prettier-ignore
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
 * The tick after the move (see the file comment): landing (the stun applied to the velocity across the ground;
 * returns the landing speed when above 2 m/s, else 0), a head bump ending a rise, walking off a ledge clearing the
 * jump's fatigue, the mode, and the turn toward `input.face`, else the move.
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
  let landed = 0;
  const grounded = move.grounded && state.vy <= 0;
  if (grounded && !steering.wasGrounded) {
    const k = land(m, motion, [state.vx, state.vy, state.vz], groundNormal(move), g, dt);
    [state.vx, state.vz] = [state.vx * k, state.vz * k];
    if (state.vy < -2) landed = -state.vy;
    motion.jumped = false;
  }
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
  motion.mode = grounded ? 'ground' : 'air';
  const [wx, wz] = steering.wish;
  const target = input.face ?? (Math.hypot(wx, wz) > 0.1 ? Math.atan2(wx, wz) : undefined);
  if (target !== undefined) state.yaw = turnToward(state.yaw, target, m.turnRate * dt);
  return landed;
}
