/**
 * @file The shooter movement model's numbers and state (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2): what a movement
 * profile (engine/physics/movement/profile.ts) gives a character in `character.movement`, and what each such
 * character keeps between ticks, the component `motion` (engine/sim/actors.ts). The model is Apex Legends', which is
 * Titanfall 2's, as er-apex reconstructs it from the game's own code (`umiiii/er-apex`,
 * `deps/er-apex-move/src/params.rs` and `controller.rs`) and the Apex Movement Wiki measures it; steer.ts runs it.
 *
 * `MODEL_FIELDS`' defaults are the reference values, so a profile states only what it changes. They are Apex's
 * numbers converted from its units (1 u = 0.0254 m, as Respawn's own scripts convert): each description gives the
 * source value. Values marked "ours" have no source and are starting values for the owner's playtests.
 *
 * Invariants: data only; seconds, metres and radians as the fields say, never ticks (steer.ts converts at its step);
 * `createMotionState()` is a character at rest on the ground, standing, holstered.
 *
 * @example
 * import { parse } from '../../core/schema';
 * parse(MODEL_FIELDS, {}).gaits.sprint; // 6.604: 260 u/s
 * createMotionState().gait; // 'idle'
 * @see engine/physics/movement/model.test.ts
 */
import { defineSchema, parse, type EntryOf, type Schema } from '../../core/schema';

/** One degree, in radians. */
const DEG = Math.PI / 180;

/** A number field: its default, range, description and unit. */
function num(value: number, minimum: number, maximum: number, description: string, unit?: string) {
  return { type: 'number', default: value, minimum, maximum, description, ...(unit ? { unit } : {}) } as const;
}

/** An object field made of `properties`, defaulting to their defaults. */
function group<const P extends Schema>(description: string, properties: P) {
  const value = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));
  return { type: 'object', description, properties, default: value } as const;
}

/** The model's numbers (see the file comment): what `character.movement` holds. */
export const MODEL_FIELDS = defineSchema({
  gaits: group('Ground speeds by gait, with a weapon out; `holstered` multiplies every one.', {
    run: num(4.4069, 0, 100, 'The run, the default gait: 173.5 u/s.', 'm/s'),
    sprint: num(6.604, 0, 100, 'The sprint: 260 u/s.', 'm/s'),
    sprintSide: num(
      4.8,
      0,
      100,
      'The sprint with the move 45° off the view (forward and a side key): measured.',
      'm/s',
    ),
    walk: num(2.2035, 0, 100, 'The walk, ours: Apex walks only aiming down sights, at the run × 0.5.', 'm/s'),
    crouch: num(2.032, 0, 100, 'The crouch-walk: 80 u/s.', 'm/s'),
    holstered: num(1.15, 0, 10, 'Every gait’s speed times this with no weapon out.'),
  }),
  accel: group('Ground acceleration toward the wished speed (Apex’s GetAccel), by the speed at the tick’s start.', {
    low: num(63.5, 0, 1e4, 'Below `lowSpeed`: 2,500 u/s².', 'm/s²'),
    lowSpeed: num(3.048, 0, 100, 'Where `low` ends: 120 u/s.', 'm/s'),
    run: num(11.43, 0, 1e4, 'From `lowSpeed` to just below the run (1 u/s): 450 u/s².', 'm/s²'),
    sprint: num(2.54, 0, 1e4, 'Faster than that, toward the sprint: 100 u/s².', 'm/s²'),
    crouch: num(63.5, 0, 1e4, 'Crouched, at every speed: 2,500 u/s².', 'm/s²'),
  }),
  decel: group('Ground deceleration of the velocity’s part the input does not push for (Apex’s Decelerate).', {
    stand: num(31.75, 0, 1e4, 'Standing, at or below the run: 1,250 u/s².', 'm/s²'),
    sprint: num(31.75, 0, 1e4, 'Faster than the run: 1,250 u/s².', 'm/s²'),
    crouch: num(38.1, 0, 1e4, 'Crouched: 0.6 of its acceleration, 1,500 u/s².', 'm/s²'),
  }),
  sprint: group('When it sprints: Apex’s sticky sprint (held, or kept on by a press while it moves on).', {
    angle: num(45 * DEG, 0, Math.PI, 'The most the move may turn from the view and sprint (a dot of 0.707).', 'rad'),
    keep: num(
      135 * DEG,
      0,
      Math.PI,
      'A press keeps the sprint on while the move stays within this of the view.',
      'rad',
    ),
    input: num(0.8, 0, 1, 'The least length of the move that sprints (a stick pushed this far).'),
    sticky: num(3, 0, 60, 'A press starts a sticky sprint within this long, if it can sprint by then.', 's'),
    hold: num(0.1, 0, 5, 'Holding the button keeps that window open this long past each tick.', 's'),
    air: num(0.25, 0, 5, 'It still sprints this long after leaving the ground, unless it jumped.', 's'),
  }),
  air: group('Air control: Quake’s air acceleration with the wished speed capped (air strafing), no air friction.', {
    speed: num(1.524, 0, 100, 'The cap on the speed along the input it accelerates to: 60 u/s.', 'm/s'),
    accel: num(12.7, 0, 1e4, 'Its acceleration: 500 u/s².', 'm/s²'),
    extra: num(0.0508, 0, 1e4, 'Along the input once past the cap, never faster overall: 2 u/s².', 'm/s²'),
  }),
  fatigue: group('Jump fatigue: a jump soon after landing from a jump goes lower.', {
    height: num(0.3, 0, 1, 'The share of the height a jump gets at first.'),
    from: num(0.15, 0, 10, 'It gets that share until this long after landing...', 's'),
    to: num(0.75, 0, 10, '...then more, linearly, the full height from this long after landing.', 's'),
  }),
  hop: group('Bunny hops: a jump soon after landing, faster than `floor`, loses speed.', {
    window: num(1, 0, 10, 'How soon after landing a jump costs speed: 1 s (contested: 0.1 s).', 's'),
    cost: num(2.54, 0, 100, 'The speed it costs: 100 u/s.', 'm/s'),
    floor: num(6.604, 0, 100, 'Never below this speed: the sprint’s.', 'm/s'),
  }),
  lurch: group('Lurch: a new move key just after a jump turns the velocity toward the new direction.', {
    window: num(0.4, 0, 5, 'How long after the take-off a key still lurches (contested: 0.5 s).', 's'),
    full: num(0.2, 0, 5, 'Until this long after the take-off it lurches at full `strength`, then less, to 0.', 's'),
    strength: num(0.7, 0, 1, 'The share of the way to the same speed in the new direction it turns.'),
    max: num(4.6, 0, 100, 'The most it changes the velocity by.', 'm/s'),
    turn: num(22.5 * DEG, 0, Math.PI, 'Ours: the least turn of the move in one tick that counts as a new key.', 'rad'),
  }),
  land: group('The fall stun: a landing from high slows it, by the impact speed along the floor’s normal.', {
    from: num(7.62, 0, 1e4, 'A fall from this high or lower keeps its speed: 300 u.', 'm'),
    full: num(20.32, 0, 1e4, 'From this high the stun is full: 800 u.', 'm'),
    floor: num(0, 0, 1, 'The share of its speed a full stun leaves.'),
    recover: num(1, 0, 60, 'How long it takes to recover.', 's'),
    power: num(2, 0, 10, 'The recovery’s curve: the share recovered is (time / recover) ^ power.'),
    sprint: num(0.7, 0, 1, 'No sprint while the speed’s share is below this.'),
  }),
  turnRate: num(720 * DEG, 0, 1e3, 'Ours: how fast it turns to face where it moves, looks or aims (720°/s).', 'rad/s'),
});

/** The model's numbers, filled: what `character.movement` holds. */
export type MovementModel = EntryOf<typeof MODEL_FIELDS>;

/** The model's numbers as a profile writes them: any group, and any number in one, left out is Apex's. */
export type MovementModelSpec = {
  [K in keyof MovementModel]?: MovementModel[K] extends object ? Partial<MovementModel[K]> : MovementModel[K];
};

/** Where a character is in the model: on the ground or in the air (WP 13.5–13.7 add slides, mantles and climbs). */
export const MODES = ['ground', 'air'] as const;

/** How a character moves on the ground this tick. */
export const GAITS = ['idle', 'walk', 'run', 'sprint', 'crouch'] as const;

/** How a character stands (WP 13.5 adds the crouch's timing and its capsule). */
export const STANCES = ['stand', 'crouch'] as const;

/** What a character on the model keeps between ticks: the component `motion`'s fields, hashed and captured. */
export const MOTION_FIELDS = defineSchema({
  mode: { type: 'string', enum: MODES, default: 'ground', description: 'On the ground or in the air.' },
  gait: { type: 'string', enum: GAITS, default: 'idle', description: 'How it moved on the ground this tick.' },
  stance: { type: 'string', enum: STANCES, default: 'stand', description: 'Standing or crouched.' },
  holstered: { type: 'boolean', default: true, description: 'No weapon out: every gait is the model’s `holstered` times faster.' }, // prettier-ignore
  sprinting: { type: 'boolean', default: false, description: 'It sprints this tick.' },
  sticky: { type: 'boolean', default: false, description: 'A press keeps its sprint on (the sticky sprint).' },
  stickyLeft: { type: 'integer', default: 0, minimum: 0, description: 'Ticks a press or a hold may still start a sticky sprint.' }, // prettier-ignore
  jumped: { type: 'boolean', default: false, description: 'It jumped since it last stood: no coyote jump, no sprint in the air.' }, // prettier-ignore
  fatigued: { type: 'boolean', default: false, description: 'Its last flight began with a jump: a jump soon after landing goes lower.' }, // prettier-ignore
  landAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since it last landed; −1: not yet.' },
  fall: num(0, 0, 1e6, 'The fall height its last landing counts for the stun, fading as it recovers.', 'm'),
  flight: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since its jump took off, in the air; −1: none.' }, // prettier-ignore
  wishX: num(0, -1, 1, 'Last tick’s move, east (a new key lurches).'),
  wishZ: num(0, -1, 1, 'Last tick’s move, south.'),
});

/** The component `motion`: a character's state in the model (`MOTION_FIELDS` documents each field). */
export type MotionState = { -readonly [K in keyof EntryOf<typeof MOTION_FIELDS>]: EntryOf<typeof MOTION_FIELDS>[K] };

/** A character at rest on the ground, standing and holstered: every field at its default. */
export function createMotionState(): MotionState {
  return parse(MOTION_FIELDS, {}) as MotionState;
}
