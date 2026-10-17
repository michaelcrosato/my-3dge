/**
 * @file The feel (PLAN.md WP 3.2, §5.8; doctrine: Agent-operable): how a character's intents become its motion, and the
 * meter that measures how it handles, so agents tune feel by numbers instead of by eye.
 *
 * - `steer` and `settle` are one tick's feel, before and after the controller moves it (engine/physics/character.ts
 *   `stepCharacter` calls them): the momentum model (acceleration, deceleration when let go, skid when told to go
 *   against its motion, `airControl` in the air), jumps with coyote time and a buffer, the variable jump, the wall
 *   jump, the dash, its own gravity integrated exactly, then landing, head bumps, the dash's end and facing.
 * - The meter: `createFeelMeter` and `updateFeelMeter(meter, sample)`, one sample per tick, give a `FeelReport`.
 *   Its rules: a run starts when the move's length passes 0.3 and is steady once its speed has not grown for 10
 *   ticks; acceleration is the time to 90% of that speed; a stop starts on letting go above 0.5 m/s and ends below 0.1
 *   m/s; a turn starts when the move points against the motion (cosine below −0.5) above 1 m/s and ends at 90% of that
 *   speed the other way; a jump runs from the last tick on the ground to the first back on it (kept when longer than
 *   120 ms), its apex and distance from where it took off. `measureFeel` (engine/sim/actors.ts) drives a character
 *   over a flat course through the meter and adds the reach and the dash; `__engine.feel()` and `x sim --feel` print it.
 *
 * Ticks: seconds round to ticks (coyote 0.10 s is 6 at 60 Hz, the buffer 0.12 s is 7). A jump pressed up to `buffer`
 * ticks before the first tick on the ground jumps then; one up to `coyote` ticks after the last still jumps. A dash
 * runs `duration` at `speed`, then keeps at most the run speed; its `cooldown` counts from its start. Gravity is the
 * character's own, integrated exactly (Δy = (v₀ + v₁)/2·dt), so the apex is jumpSpeed²/2g within g·dt²/8.
 *
 * Invariants: `steer` and `settle` read and write only the state they are given (plain data, so the sim hashes and
 * restores it). The meter keeps what it measures in its own plain object.
 *
 * Carried from shardfall@fa2dab6 `crates/pav_core/src/character.rs:770-925` (the movement maths) and
 * `crates/pav_core/src/feel.rs` (`FeelMeter::update`, here in seconds), and `my-3d2dge:engine/my-3d2dge.js` §16
 * (`Platformer`: the dash and the wall jump).
 *
 * @example
 * const meter = createFeelMeter(1 / 60);
 * for (let tick = 1; tick <= 30; tick++) {
 *   const speed = Math.min(6, tick * 0.75);
 *   updateFeelMeter(meter, { tick, wish: [1, 0], velocity: [speed, 0, 0], feet: [0, 0, 0], grounded: true });
 * }
 * [meter.report.topSpeed, meter.report.accelerationTime]; // [6, 0.1333…]: 90% of 6 m/s after 8 ticks
 * @see engine/physics/feel.test.ts
 */
import { Vector3 } from '../core/math';
import type { Character, CharacterInput, CharacterState } from './character';

/** What `measureFeel` reports. */
export interface FeelReport {
  /** Ticks from pressing a direction to the first movement. */
  responseTicks: number;
  /** The steady speed of a run (m/s). */
  topSpeed: number;
  /** From pressing a direction to 90% of the top speed (s). */
  accelerationTime: number;
  /** From letting go at full speed to standing still (s). */
  stopTime: number;
  /** How far it slides while stopping (m). */
  stopDistance: number;
  /** From reversing at full speed to 90% of that speed the other way (s). */
  turnTime: number;
  /** A standing jump, held: its apex above take-off (m). */
  apex: number;
  /** A standing jump, held: its time in the air (s). */
  airTime: number;
  /** A running jump, held: the distance across the ground from take-off to landing (m). */
  jumpDistance: number;
  /** The highest ledge it jumps up onto from standing at its foot (m). */
  reach: number;
  /** A dash from standing still: the distance it covers while it dashes (m); 0 without a dash. */
  dashDistance: number;
  /** On the shooter model only: what docs/PLAYGROUND.md §3.2 measures (engine/sim/feelCourse.ts says how). */
  motion?: MotionFeel;
}

/** The shooter model's feel numbers (engine/sim/feelCourse.ts): speeds in m/s, times in s, heights in m. */
export interface MotionFeel {
  run: number;
  sprint: number;
  walk: number;
  crouch: number;
  runHolstered: number;
  sprintHolstered: number;
  crouchHolstered: number;
  /** From rest to 90% of the run. */
  accelerationTime: number;
  /** From the first tick past the run to the full sprint. */
  sprintTime: number;
  /** From a steady sprint, let go, to standing still. */
  stopTime: number;
  /** A jump pressed on the tick after a jump lands: its height. */
  fatigueApex: number;
  /** What a sprint jump gains air strafing. */
  strafeGain: number;
  /** The change of velocity a side key makes 0.1 s into a sprint jump. */
  lurch: number;
}

/** One tick of a character, as the meter reads it. */
export interface FeelSample {
  /** The tick's number. */
  tick: number;
  /** The move it was told, `[x, z]`. */
  wish: readonly [number, number];
  /** Its velocity after the tick (m/s). */
  velocity: readonly [number, number, number];
  /** Where its feet are after the tick (m). */
  feet: readonly [number, number, number];
  grounded: boolean;
}

/** A meter: the report so far and what it is in the middle of measuring. */
export interface FeelMeter {
  report: FeelReport;
  /** The step length (s). */
  dt: number;
  moving: boolean;
  start: number;
  responding: boolean;
  /** The run-up's speeds, one per tick since the move began. */
  run: number[];
  steady: boolean;
  stop: { tick: number; x: number; z: number } | null;
  turn: { tick: number; speed: number } | null;
  /** The last tick it stood on the ground, and where. */
  ground: { tick: number; x: number; y: number; z: number };
  air: { tick: number; x: number; y: number; z: number; top: number } | null;
}

/** A report with nothing measured yet. */
const EMPTY: FeelReport = {
  responseTicks: 0,
  topSpeed: 0,
  accelerationTime: 0,
  stopTime: 0,
  stopDistance: 0,
  turnTime: 0,
  apex: 0,
  airTime: 0,
  jumpDistance: 0,
  reach: 0,
  dashDistance: 0,
};

/** A new meter for ticks of `dt` seconds. */
export function createFeelMeter(dt = 1 / 60): FeelMeter {
  return {
    report: { ...EMPTY },
    dt,
    moving: false,
    start: 0,
    responding: false,
    run: [],
    steady: false,
    stop: null,
    turn: null,
    ground: { tick: 0, x: 0, y: 0, z: 0 },
    air: null,
  };
}

/** Reads one tick into the meter (the file comment gives the rules). */
export function updateFeelMeter(meter: FeelMeter, sample: FeelSample): void {
  const { report: r, dt } = meter;
  const { tick, wish, velocity, feet, grounded } = sample;
  const speed = Math.hypot(velocity[0], velocity[2]);
  const pushing = Math.hypot(wish[0], wish[1]) > 0.3;
  if (pushing && !meter.moving) Object.assign(meter, { start: tick, responding: true, run: [], steady: false });
  if (!pushing && meter.moving && speed > 0.5) meter.stop = { tick, x: feet[0], z: feet[2] };
  meter.moving = pushing;
  if (meter.responding && speed > 0.05) [r.responseTicks, meter.responding] = [tick - meter.start, false];
  if (pushing && !meter.steady) steadyRun(meter, speed);
  if (meter.stop && pushing) meter.stop = null;
  else if (meter.stop && speed < 0.1) {
    r.stopTime = (tick - meter.stop.tick) * dt;
    r.stopDistance = Math.hypot(feet[0] - meter.stop.x, feet[2] - meter.stop.z);
    meter.stop = null;
  }
  const along = pushing ? (velocity[0] * wish[0] + velocity[2] * wish[1]) / Math.hypot(wish[0], wish[1]) : 0;
  if (pushing && speed > 1 && !meter.turn && along < -0.5 * speed) meter.turn = { tick, speed };
  if (meter.turn && (!pushing || tick - meter.turn.tick > 300)) meter.turn = null;
  else if (meter.turn && along >= meter.turn.speed * 0.9)
    [r.turnTime, meter.turn] = [(tick - meter.turn.tick) * dt, null];
  if (!grounded && !meter.air) meter.air = { ...meter.ground, top: feet[1] };
  else if (!grounded && meter.air) meter.air.top = Math.max(meter.air.top, feet[1]);
  else if (grounded && meter.air) {
    const air = (tick - meter.air.tick) * dt;
    if (air > 0.12) {
      [r.apex, r.airTime] = [meter.air.top - meter.air.y, air];
      r.jumpDistance = Math.hypot(feet[0] - meter.air.x, feet[2] - meter.air.z);
    }
    meter.air = null;
  }
  if (grounded) meter.ground = { tick, x: feet[0], y: feet[1], z: feet[2] };
}

/** A run-up's speed: steady once it has not grown for 10 ticks (shardfall's rule), then the top and the time to 90%. */
function steadyRun(meter: FeelMeter, speed: number): void {
  const { run, report } = meter;
  run.push(speed);
  const n = run.length;
  if (n > 12) {
    const before = run[n - 11];
    if (Math.max(...run.slice(n - 10)) <= before * 1.005 + 0.01 && before > 0.3) {
      report.topSpeed = before;
      report.accelerationTime = (run.findIndex((s) => s >= before * 0.9) + 1) * meter.dt;
      meter.steady = true;
    }
  }
  if (n > 600) meter.steady = true;
}

/** A wall jump's kick: the share of jump speed up, of run speed away, and the time without control (s). */
const WALL_KICK = { up: 0.95, away: 1.1, lock: 0.12 };
/** How long a wall touched still counts for a wall jump (s). */
const WALL_MEMORY = 0.1;

/** Seconds as whole ticks of `dt`. */
const ticks = (seconds: number, dt: number) => Math.round(seconds / dt);

/** What `steer` decided for a tick: the move it asks for, and what it started. */
export interface Steering {
  /** The translation it asks the controller for (m). */
  desired: Vector3;
  jumped: boolean;
  /** A dash started this tick. */
  dashed: boolean;
  /** It dashes this tick. */
  dashing: boolean;
  /** Where it was told to go, `[x, z]`, at most length 1. */
  wish: readonly [number, number];
  wasGrounded: boolean;
  /** The shooter model's mantle: the feet go straight to `to` (m), through nothing, standing there if it `lands`. */
  path?: { to: readonly [number, number, number]; lands: boolean };
}

/**
 * The feel of one tick, before the move: timers count, a dash starts, the velocity across the ground follows the
 * momentum model (acceleration, deceleration when let go, skid against its motion, `airControl` in the air), jumps
 * start (coyote time, buffer, wall jump), letting go cuts a rise (`variableJump`), and gravity acts, integrated
 * exactly. Changes `state` and returns the move to make.
 */
export function steer(character: Character, state: CharacterState, input: CharacterInput, dt: number, g: number) {
  const { feel } = character;
  const wasGrounded = state.grounded;
  const [coyote, buffer] = [ticks(feel.coyote, dt), ticks(feel.buffer, dt)];
  state.jumpAge = input.jumpPressed ? 0 : state.jumpAge >= 0 && state.jumpAge < buffer ? state.jumpAge + 1 : -1;
  state.wallAge = state.wallAge >= 0 && state.wallAge < ticks(WALL_MEMORY, dt) ? state.wallAge + 1 : -1;
  state.dashCooldown = Math.max(0, state.dashCooldown - 1);
  state.lock = Math.max(0, state.lock - 1);
  const [mx, mz] = input.move ?? [0, 0];
  const length = state.lock > 0 ? 0 : Math.hypot(mx, mz);
  const wish = (length > 1 ? [mx / length, mz / length] : length > 0 ? [mx, mz] : [0, 0]) as [number, number];
  const pushing = Math.min(length, 1);

  const ready = feel.dash.speed > 0 && ticks(feel.dash.duration, dt) > 0 && state.dashCooldown === 0;
  const dashed = input.dashPressed === true && ready && state.dash === 0 && state.lock === 0;
  if (dashed) {
    const [dx, dz] =
      pushing > 0.1 ? [wish[0] / pushing, wish[1] / pushing] : [Math.sin(state.yaw), Math.cos(state.yaw)];
    Object.assign(state, { dashX: dx, dashZ: dz, dash: ticks(feel.dash.duration, dt) });
    state.dashCooldown = ticks(feel.dash.cooldown, dt);
  }
  const dashing = state.dash > 0;
  if (dashing) [state.vx, state.vz] = [state.dashX * feel.dash.speed, state.dashZ * feel.dash.speed];
  else if (state.lock === 0) accelerate(character, state, wish, pushing, (wasGrounded ? 1 : feel.airControl) * dt);

  let jumped = false;
  if (state.jumpAge >= 0 && (wasGrounded || state.air <= coyote) && !state.jumping) {
    Object.assign(state, { vy: character.jumpSpeed, jumping: true, air: coyote + 1, jumpAge: -1 });
    jumped = true;
  } else if (state.jumpAge >= 0 && feel.wallJump && !wasGrounded && state.wallAge >= 0) {
    const away = character.speed * WALL_KICK.away;
    Object.assign(state, { vy: character.jumpSpeed * WALL_KICK.up, vx: state.wallX * away, vz: state.wallZ * away });
    Object.assign(state, { jumping: true, jumpAge: -1, wallAge: -1, dash: 0, lock: ticks(WALL_KICK.lock, dt) });
    jumped = true;
  }
  if (state.jumping && !input.jump && state.vy > 0) [state.vy, state.jumping] = [state.vy * feel.variableJump, false];
  const v0 = state.vy;
  state.vy = dashing ? Math.max(v0, 0) : Math.max(v0 - g * dt, -character.maxFall);
  const dy = dashing ? state.vy * dt : ((v0 + state.vy) / 2) * dt;
  const desired = new Vector3(state.vx * dt, dy, state.vz * dt);
  if (desired.lengthSq() < 1e-8) desired.y -= 1e-3;
  const steering: Steering = { desired, jumped, dashed, dashing, wish, wasGrounded };
  return steering;
}

/** The momentum model: toward the wished velocity at its acceleration, its deceleration when let go, its skid. */
function accelerate(character: Character, state: CharacterState, wish: [number, number], pushing: number, dt: number) {
  const against = state.vx * wish[0] + state.vz * wish[1] < 0;
  const rate = pushing < 0.05 ? character.deceleration : against ? character.skid : character.acceleration;
  let [dx, dz] = [wish[0] * character.speed - state.vx, wish[1] * character.speed - state.vz];
  const [gap, most] = [Math.hypot(dx, dz), rate * dt];
  if (gap > most) [dx, dz] = [(dx * most) / gap, (dz * most) / gap];
  [state.vx, state.vz] = [state.vx + dx, state.vz + dz];
}

/**
 * The feel of one tick, after the move: landing ends a fall (returns the landing speed when above 2 m/s, else 0), a
 * head bump ends a rise, a dash's last tick leaves at most the run speed, and it faces where it dashes or is told to go.
 */
export function settle(
  character: Character,
  state: CharacterState,
  steering: Steering,
  moved: Vector3,
  grounded: boolean,
) {
  let landed = 0;
  state.grounded = grounded && state.vy <= 0;
  if (state.grounded) {
    if (!steering.wasGrounded && state.vy < -2) landed = -state.vy;
    Object.assign(state, { vy: 0, air: 0, jumping: false });
  } else {
    state.air = Math.min(state.air + 1, 1e6);
    if (state.vy > 0 && moved.y < steering.desired.y * 0.5) [state.vy, state.jumping] = [0, false];
  }
  if (state.vy <= 0) state.jumping = false;
  if (steering.dashing && --state.dash === 0) {
    const speed = Math.hypot(state.vx, state.vz);
    const keep = speed > character.speed ? character.speed / speed : 1;
    [state.vx, state.vz] = [state.vx * keep, state.vz * keep];
  }
  if (steering.dashing) state.yaw = Math.atan2(state.dashX, state.dashZ);
  else if (Math.hypot(...steering.wish) > 0.1) state.yaw = Math.atan2(steering.wish[0], steering.wish[1]);
  return landed;
}
