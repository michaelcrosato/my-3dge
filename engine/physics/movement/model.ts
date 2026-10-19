/**
 * @file The shooter movement model's numbers and state (PLAN.md WP 13.3, docs/PLAYGROUND.md §3.2): what a movement
 * profile (engine/physics/movement/profile.ts) gives a character in `character.movement`, and what each such
 * character keeps between ticks, the component `motion` (engine/sim/actors.ts). The model is Apex Legends', which is
 * Titanfall 2's, as er-apex reconstructs it from the game's own code (`umiiii/er-apex`,
 * `deps/er-apex-move/src/params.rs` and `controller.rs`; MIT, engine/physics/movement/NOTICE) and the Apex Movement
 * Wiki measures it; steer.ts runs it.
 *
 * `MODEL_FIELDS`' defaults are the reference values, so a profile states only what it changes. They are Apex's
 * numbers converted from its units (1 u = 0.0254 m, as Respawn's own scripts convert): each description gives the
 * source value. Values marked "ours" have no source and are starting values for the owner's playtests. The gaits'
 * `side` and `back` are 1 in Apex (no strafe or backpedal penalty), there for games that slow either. A move's keys'
 * frame is the camera's heading (the intent `cam`), so the lurch tells a new key from a turning view. The crouch (its
 * hull and its duck's timing) and the slide are WP 13.5's (engine/physics/movement/crouch.ts).
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
    side: num(1, 0, 10, 'A gait’s speed times this moving straight across the view (er-apex’s `speed_scale_side`).'),
    back: num(1, 0, 10, 'A gait’s speed times this moving straight back from the view (`speed_scale_back`).'),
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
  crouch: group(
    'Crouching: the hull it shrinks to, and the duck’s timing (Apex’s update_duck, in whole milliseconds).',
    {
      height: num(1.1938, 0.1, 20, 'The crouched hull, top to bottom: 47 u (the standing hull is the character’s capsule).', 'm'), // prettier-ignore
      down: num(0.4, 0, 5, 'The duck: the hull shrinks as it ends, so crouch spam never shrinks it.', 's'),
      fast: num(0.2, 0, 5, 'The duck that starts a slide, or that the hull, unable to stand, takes.', 's'),
      up: num(0.2, 0, 5, 'Getting up: the hull stands as it starts, once the standing hull fits.', 's'),
      jump: { type: 'boolean', default: false, description: 'A toggled crouch jumps (Apex’s: no, the jump stands it up); a held one always does.' }, // prettier-ignore
    },
  ),
  slide: group('The slide (Apex’s TryStartSlide, and its parts of WalkMove and the jump): a crouch at speed.', {
    speed: num(5.08, 0, 100, 'The least speed across the ground a crouch slides at: 200 u/s.', 'm/s'),
    air: num(2.286, 0, 100, 'Landing ducked while falling at least `fall`, the least speed across the ground: 90 u/s.', 'm/s'), // prettier-ignore
    fall: num(5.08, 0, 100, 'The fall speed from which a landing slides from `air`: 200 u/s.', 'm/s'),
    angle: num(Math.acos(0.6), 0, Math.PI, 'On the ground, the move’s part along the view is at least this angle’s cosine (0.6: 53° at a full push).', 'rad'), // prettier-ignore
    slope: num(
      Math.acos(0.7),
      0,
      Math.PI / 2,
      'The steepest ground it starts on (a floor normal at least 0.7 up).',
      'rad',
    ),
    boost: num(3.81, 0, 100, 'Added to its speed as it starts, times the move scale: 150 u/s.', 'm/s'),
    cap: num(10.16, 0, 100, 'The boost never takes it past this, times the move scale: 400 u/s.', 'm/s'),
    cooldown: num(2, 0, 60, 'No boost until this long after the last slide began (every slide starts it again).', 's'),
    accel: num(1.27, 0, 1e4, 'Steering: its acceleration across the slide, times the move scale: 50 u/s².', 'm/s²'),
    decel: num(2.54, 0, 1e4, 'Its friction with crouch held: 100 u/s².', 'm/s²'),
    brake: num(10.16, 0, 1e4, 'Its friction with crouch let go, or the move against it: 400 u/s².', 'm/s²'),
    decay: num(0.7, 0, 1, 'Then its velocity times this a second.'),
    end: num(3.175, 0, 100, 'It ends, crouched, below this speed: 125 u/s.', 'm/s'),
    hold: num(8.89, 0, 100, 'Faster than this it slides on with crouch let go: 350 u/s.', 'm/s'),
    jump: num(1.27, 0, 100, 'The slide-jump’s height: 50 u.', 'm'),
    dead: num(
      0.4,
      0,
      5,
      'A jump this soon after a boosted slide began, its duck still going, takes the boost back.',
      's',
    ),
    long: num(
      8.89,
      0,
      100,
      'A boosted slide jumping between `longFrom` of this and this jumps at this: 350 u/s.',
      'm/s',
    ),
    longFrom: num(0.85, 0, 1, 'Where the long jump’s band starts, a share of `long`.'),
    step: num(10, 0, 1e4, 'A step up while sliding costs this much speed a metre climbed (Apex’s 10 a unit).', '1/s'),
  }),
  mantle: group('The mantle (the Apex Movement Wiki’s measures, and er-apex’s ledge test): a grab, then a pull.', {
    reach: num(2.4892, 0, 20, 'The highest ledge it mantles from the air, its lip above the feet: the highest a climb reaches less its cutoff and end boost (273 − 147 − 28), 98 u.', 'm'), // prettier-ignore
    auto: num(2.032, 0, 20, 'Holding jump on the ground, the highest ledge it mantles without leaving the ground: 80 u.', 'm'), // prettier-ignore
    probe: num(0.6096, 0, 10, 'How far ahead of its hull it finds the wall: 24 u.', 'm'),
    angle: num(50 * DEG, 0, Math.PI, 'Its move and its view within this of the wall, facing it.', 'rad'),
    low: num(1.0668, 0, 20, 'A ledge this low over the feet or lower is pulled over with no grab: 42 u.', 'm'),
    grab: num(0.45, 0, 5, 'The grab: up to the lip, hands on it (out of a climb, measured).', 's'),
    pull: num(0.3, 0, 5, 'The pull over the lip onto the top (contested: 0.45 s).', 's'),
    hang: num(1.524, 0, 20, 'Letting go of forward in the grab hangs if the lip stands this high over the ground below: 60 u.', 'm'), // prettier-ignore
    cooldown: num(0.25, 0, 5, 'No mantle within this of the last one’s end.', 's'),
    window: num(0.15, 0, 5, 'The pull’s last part, when a superglide or a mantle boost takes.', 's'),
    glide: num(1.8, 0, 10, 'A superglide’s speed, times the speed it mantled at: +80% over the holstered sprint.'),
    glideJump: num(1.27, 0, 100, 'Ours: a superglide’s rise, the slide-jump’s.', 'm'),
    boost: { type: 'boolean', default: false, description: 'The mantle boost: a crouch press in the window glides too, rising a full jump, with no cooldown of its own (it starts the slide boost’s).' }, // prettier-ignore
  }),
  climb: group('The wall-climb (the Apex Movement Wiki’s climb fundamentals): up a steep wall, in the air.', {
    angle: num(Math.acos(0.7), 0, Math.PI / 2, 'Walls steeper than this (a normal under 0.7 up), the view within this of facing one: 45.57°.', 'rad'), // prettier-ignore
    attach: num(2.54, 0, 100, 'It climbs until its feet are this far above where it caught: 100 u.', 'm'),
    cutoff: num(3.7338, 0, 100, 'Or this far above the climb space’s foot, the last ground’s: 147 u.', 'm'),
    end: num(0.7112, 0, 100, 'Then the end boost throws it this much higher: 28 u.', 'm'),
    up: num(5.715, 0, 100, 'Its speed up the wall: 225 u/s.', 'm/s'),
    across: num(6.5532, 0, 100, 'Across the wall, not climbing up: 258 u/s.', 'm/s'),
    acrossUp: num(2.921, 0, 100, 'Across the wall while climbing up: 115 u/s.', 'm/s'),
    accel: num(30, 0, 1e4, 'Ours: how fast it reaches those speeds.', 'm/s²'),
    rising: num(0.254, 0, 100, 'Rising this fast or faster it climbs on with no timer: 10 u/s.', 'm/s'),
    timer: num(1, 0, 60, 'Rising slower, it lets go this long after it caught.', 's'),
    mini: num(0.4826, 0, 100, 'A jump off below this over the climb space’s foot is a mini-bounce: 19 u.', 'm'),
    green: num(1.1938, 0, 100, 'Below this, a wall-bounce, its lift a full jump at the zone’s foot to none at its top (ours, the measures say only that it falls): 47 u.', 'm'), // prettier-ignore
    miniLift: num(0.716534, 0, 100, 'A mini-bounce’s rise: 28.21 u.', 'm'),
    miniAway: num(4.7752, 0, 100, 'Its speed away from the wall: 188 u/s.', 'm/s'),
    away: num(6.5532, 0, 100, 'A wall-bounce’s, or a jump off higher up (a wall push, no lift): 258 u/s.', 'm/s'),
    drop: num(3.2512, 0, 100, 'Letting go lowers the climb space this much: 128 u.', 'm'),
    dropJump: num(6.5024, 0, 100, 'A jump off above the mini zone lowers it this much: 256 u.', 'm'),
    turn: num(25.842 * DEG, 0, Math.PI, 'A new climb starts above the last one’s catch only on a wall turned this far from it.', 'rad'), // prettier-ignore
  }),
  zipline: group('Ziplines (the Apex Movement Wiki’s): a cable between two anchors, caught and ridden either way.', {
    speed: num(15.24, 0, 100, 'Its top speed along a sloped cable: 600 u/s.', 'm/s'),
    vertical: num(12.192, 0, 100, 'Its top speed along a vertical one: 480 u/s.', 'm/s'),
    steep: num(10 * DEG, 0, Math.PI / 2, 'Ours: a cable this close to straight up or closer is vertical.', 'rad'),
    accel: num(10.16, 0, 1e4, 'How fast it gets there: 400 u/s².', 'm/s²'),
    jumpOn: num(25.4, 0, 1e4, 'How fast, on a ride caught from the air (jumping on): 1,000 u/s².', 'm/s²'),
    look: num(35 * DEG, 0, Math.PI, 'Use catches a cable with the view within this of it.', 'rad'),
    lookAir: num(90 * DEG, 0, Math.PI, 'In the air, within this.', 'rad'),
    reach: num(1.524, 0, 20, 'Ours: use catches a cable this close to the hands: 60 u.', 'm'),
    grab: num(0.6096, 0, 20, 'Ours: in the air, a cable this close to the hands catches it unasked: 24 u.', 'm'),
    hang: num(2.032, 0, 20, 'Ours: the hands, on the cable, stand this high over the feet: 80 u.', 'm'),
    catches: { type: 'integer', default: 3, minimum: 0, maximum: 100, description: 'Catches between two touches of the ground.' }, // prettier-ignore
    jump: num(10.16, 0, 100, 'A jump off adds this along the view, across the ground: 400 u/s.', 'm/s'),
    jumpMax: num(11.303, 0, 100, 'A jump off leaves no faster across than this, unless the ride was: 445 u/s.', 'm/s'),
    exit: num(0.5, 0, 1, 'Ours: at a cable’s end it lets go keeping this share of its speed.'),
    end: num(0.6096, 0, 20, 'Ours: a ride ends this far short of an anchor: 24 u.', 'm'),
    topHop: num(1, 0, 20, 'Ours: a vertical cable’s top hops it this high...', 'm'),
    topPush: num(4.4069, 0, 100, 'Ours: ...and on along the view at this, the run.', 'm/s'),
    cooldown: num(0.25, 0, 5, 'Ours: no catch this soon after letting go of a zipline or a ladder.', 's'),
  }),
  skydive: group('The skydive (ours, from Apex’s redeploy balloon): falling with the view’s pitch, then the landing.', {
    glide: num(20, 0, 1e3, 'Its fall with the view level or up.', 'm/s'),
    dive: num(35, 0, 1e3, 'Its fall with the view straight down; between, by the view’s pitch.', 'm/s'),
    across: num(12, 0, 1e3, 'Ours: the push moves it across the ground at up to this.', 'm/s'),
    accel: num(8, 0, 1e4, 'Ours: how fast it gets there.', 'm/s²'),
    brake: num(21, 0, 1e4, 'Ours: falling faster than it should (a glide after a dive, the landing), it slows at this: from a 35 m/s dive to the touch speed within the landing’s 30 m, a tick to spare.', 'm/s²'), // prettier-ignore
    land: num(30, 0, 1e4, 'The landing pose takes over with the ground this close below.', 'm'),
    touch: num(6.096, 0, 1e3, 'Ours: the landing slows its fall to this: 240 u/s.', 'm/s'),
    launch: num(15.24, 0, 1e3, 'Ours: a balloon’s top throws it up at this.', 'm/s'),
  }),
  ladder: group('Ladders (ours, from GTA V and Red Dead Redemption 2: Apex has none).', {
    speed: num(2.2035, 0, 100, 'Tuned: up and down at this, the run × 0.5.', 'm/s'),
    reach: num(0.3048, 0, 10, 'It takes hold with its hull within this of the ladder’s face: 12 u.', 'm'),
    angle: num(45 * DEG, 0, Math.PI, 'A push within this of straight into the ladder takes hold.', 'rad'),
    gap: num(0.1016, 0, 10, 'Its hull stands this far off the ladder’s face as it climbs: 4 u.', 'm'),
    top: num(1, 0, 20, 'Taking hold from the top, its feet start this far below it.', 'm'),
    away: num(3.048, 0, 100, 'A jump off pushes it away from the ladder at this: 120 u/s...', 'm/s'),
    jump: num(0.5, 0, 20, '...rising this high.', 'm'),
  }),
  turnRate: num(720 * DEG, 0, 1e3, 'Ours: how fast it turns to face where it moves, looks or aims (720°/s).', 'rad/s'),
});

/** The model's numbers, filled: what `character.movement` holds. */
export type MovementModel = EntryOf<typeof MODEL_FIELDS>;

/** The model's numbers as a profile writes them: any group, and any number in one, left out is Apex's. */
export type MovementModelSpec = {
  [K in keyof MovementModel]?: MovementModel[K] extends object ? Partial<MovementModel[K]> : MovementModel[K];
};

/** Where a character is in the model: on the ground, in the air, mantling, climbing, on a zipline, on a ladder, skydiving. */ // prettier-ignore
export const MODES = ['ground', 'air', 'mantle', 'climb', 'zipline', 'ladder', 'skydive'] as const;

/** A mantle's phase: none, the grab up to the lip, hanging from it, the pull over it. */
export const MANTLES = ['none', 'grab', 'hang', 'pull'] as const;

/** How a character moves on the ground this tick: a slide is a gait. */
export const GAITS = ['idle', 'walk', 'run', 'sprint', 'crouch', 'slide'] as const;

/** Its hull: standing, or crouched (the model's `crouch.height`). */
export const STANCES = ['stand', 'crouch'] as const;

/** Apex's duck: standing, going down, down, or getting up. */
export const DUCKS = ['standing', 'ducking', 'ducked', 'unducking'] as const;

/** What a character on the model keeps between ticks: the component `motion`'s fields, hashed and captured. */
export const MOTION_FIELDS = defineSchema({
  mode: {
    type: 'string',
    enum: MODES,
    default: 'ground',
    description: 'On the ground, in the air, mantling or climbing.',
  },
  gait: { type: 'string', enum: GAITS, default: 'idle', description: 'How it moved on the ground this tick.' },
  stance: { type: 'string', enum: STANCES, default: 'stand', description: 'Its hull: standing or crouched.' },
  duck: { type: 'string', enum: DUCKS, default: 'standing', description: 'Its duck: the hull shrinks as `ducking` ends and stands as `unducking` starts.' }, // prettier-ignore
  duckLeft: { type: 'integer', default: 0, minimum: 0, description: 'Milliseconds left of the duck or the getting up, counted whole (16 a tick at 60 Hz).' }, // prettier-ignore
  duckTotal: { type: 'integer', default: 0, minimum: 0, description: 'The milliseconds the duck going on takes (the view’s crouch share).' }, // prettier-ignore
  airDuck: { type: 'boolean', default: false, description: 'Its duck began in the air: the hull shrinks about its middle, the feet tucked up.' }, // prettier-ignore
  crouchHeld: { type: 'boolean', default: false, description: 'Its crouch button was held last tick: a change ends a toggled crouch.' }, // prettier-ignore
  crouchToggle: { type: 'boolean', default: false, description: 'A toggled crouch is on.' },
  sliding: { type: 'boolean', default: false, description: 'It slides.' },
  slideAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since its last slide began; −1: none yet.' }, // prettier-ignore
  slideBoost: num(0, 0, 1e4, 'What its last slide’s boost added (a dead slide takes it back).', 'm/s'),
  longJump: { type: 'boolean', default: false, description: 'Its slide was boosted and has not jumped yet: the long jump.' }, // prettier-ignore
  floorX: num(0, -1, 1, 'The ground’s normal under it after its last move, east (straight up off the ground).'),
  floorY: num(1, -1, 1, 'The ground’s normal, up.'),
  floorZ: num(0, -1, 1, 'The ground’s normal, south.'),
  holstered: { type: 'boolean', default: true, description: 'No weapon out: every gait is the model’s `holstered` times faster.' }, // prettier-ignore
  sprinting: { type: 'boolean', default: false, description: 'It sprints this tick.' },
  sticky: { type: 'boolean', default: false, description: 'A press keeps its sprint on (the sticky sprint).' },
  stickyLeft: { type: 'integer', default: 0, minimum: 0, description: 'Ticks a press or a hold may still start a sticky sprint.' }, // prettier-ignore
  jumped: { type: 'boolean', default: false, description: 'It jumped since it last stood: no coyote jump, no sprint in the air.' }, // prettier-ignore
  fatigued: { type: 'boolean', default: false, description: 'Its last flight began with a jump: a jump soon after landing goes lower.' }, // prettier-ignore
  landAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since it last landed; −1: not yet.' },
  fall: num(0, 0, 1e6, 'The fall height its last landing counts for the stun, fading as it recovers.', 'm'),
  flight: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since its jump took off, in the air; −1: none.' }, // prettier-ignore
  mantle: { type: 'string', enum: MANTLES, default: 'none', description: 'Its mantle’s phase.' },
  mantleLeft: { type: 'integer', default: 0, minimum: 0, description: 'Ticks left of the phase.' },
  mantleTotal: { type: 'integer', default: 0, minimum: 0, description: 'Ticks the phase takes.' },
  mantleCool: { type: 'integer', default: 0, minimum: 0, description: 'Ticks until it may mantle again.' },
  fromX: num(0, -1e6, 1e6, 'Where its mantle began, the feet, east.', 'm'),
  fromY: num(0, -1e6, 1e6, 'Where its mantle began, up.', 'm'),
  fromZ: num(0, -1e6, 1e6, 'Where its mantle began, south.', 'm'),
  toX: num(0, -1e6, 1e6, 'Where its mantle lands, the feet on the ledge’s top, east.', 'm'),
  toY: num(0, -1e6, 1e6, 'Where its mantle lands, up.', 'm'),
  toZ: num(0, -1e6, 1e6, 'Where its mantle lands, south.', 'm'),
  lipX: num(0, -1e6, 1e6, 'The ledge’s lip, where the hands go, east.', 'm'),
  lipY: num(0, -1e6, 1e6, 'The lip, up.', 'm'),
  lipZ: num(0, -1e6, 1e6, 'The lip, south.', 'm'),
  riseX: num(0, -1e6, 1e6, 'The column its feet rise up at the wall, the hull against it, east.', 'm'),
  riseZ: num(0, -1e6, 1e6, 'The column its feet rise up, south.', 'm'),
  wallX: num(0, -1, 1, 'The wall it mantles or climbs, its normal across the ground, east.'),
  wallZ: num(0, -1, 1, 'The wall’s normal, south.'),
  landCrouch: { type: 'boolean', default: false, description: 'Only the crouched hull fits on the ledge’s top.' },
  hangRoom: { type: 'boolean', default: false, description: 'The lip stands high enough over the ground below to hang from.' }, // prettier-ignore
  exitGait: { type: 'string', enum: GAITS, default: 'run', description: 'The gait it mantles out at: the one it came in at.' }, // prettier-ignore
  glideAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since a jump in the pull’s window hopped it out; −1: none.' }, // prettier-ignore
  climbAge: { type: 'integer', default: -1, minimum: -1, description: 'Ticks since its climb caught; −1: not climbing.' }, // prettier-ignore
  attachY: num(0, -1e6, 1e6, 'Where its last climb caught, the feet’s height.', 'm'),
  spaceY: num(0, -1e6, 1e6, 'The climb space’s foot: the last ground’s height, lowered by each letting go, dragged down by a fall below it.', 'm'), // prettier-ignore
  reattach: { type: 'boolean', default: false, description: 'It climbed since it last stood: a new climb catches below the last unless the wall turned.' }, // prettier-ignore
  keyRight: num(0, -1, 1, 'Last tick’s move in its keys’ frame, to the right (a new key lurches).'),
  keyForward: num(0, -1, 1, 'Last tick’s move in its keys’ frame, forward.'),
  ride: { type: 'integer', default: -1, minimum: -1, description: 'The zipline or ladder it rides, its entity; −1: none.' }, // prettier-ignore
  rideAt: num(0, -1e6, 1e6, 'How far along: on a zipline from its first anchor, on a ladder the feet over its foot.', 'm'), // prettier-ignore
  rideDir: { type: 'integer', default: 0, minimum: -1, maximum: 1, description: 'Which way along a zipline: 1 toward its second anchor, −1 toward its first.' }, // prettier-ignore
  rideSpeed: num(0, -1e3, 1e3, 'Its speed along the zipline, or up the ladder (down below 0).', 'm/s'),
  rideAccel: num(0, 0, 1e4, 'The ride’s acceleration: the zipline’s, or its jump-on’s caught from the air.', 'm/s²'),
  rideEnd: num(0, -1e6, 1e6, 'Where along the zipline the ride ends: short of its far anchor, or where the hull meets something.', 'm'), // prettier-ignore
  catches: { type: 'integer', default: 0, minimum: 0, description: 'Zipline catches since it last stood.' },
  rideCool: { type: 'integer', default: 0, minimum: 0, description: 'Ticks until it may catch a zipline or take a ladder again.' }, // prettier-ignore
  landing: { type: 'boolean', default: false, description: 'Skydiving, the landing pose has taken over: it slows to the touch speed.' }, // prettier-ignore
});

/** The component `motion`: a character's state in the model (`MOTION_FIELDS` documents each field). */
export type MotionState = { -readonly [K in keyof EntryOf<typeof MOTION_FIELDS>]: EntryOf<typeof MOTION_FIELDS>[K] };

/** A character at rest on the ground, standing and holstered: every field at its default. */
export function createMotionState(): MotionState {
  return parse(MOTION_FIELDS, {}) as MotionState;
}
