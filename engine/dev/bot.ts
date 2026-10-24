/**
 * @file The bot (PLAN.md WP 5.6, §5.6, I-38; doctrines: Agent-operable, Reproducible): plays a scene's player through
 * intents, as a virtual device would, for play longer and more varied than a scripted replay (soaks, navigation smoke).
 * It is sim-side: it reads the world and writes intents through the session's step, so its play is recorded and
 * replays as anyone's does; its own sums run under the sim's math (engine/core/simMath.ts), alike in Node and a page.
 *
 * - **Navigation** (`Bot`): toward its goal down the level's flow field (engine/world/nav.ts, to the goal's nearest
 *   open tile) or a site's (engine/dev/botNav.ts), the last `near` metres straight at it, as one of `headings`
 *   directions (few, so its intents change seldom); there within `reach` (on a site, and 1 m of its height). A closed
 *   door its way runs into it opens as a player does (`runBot` presses use: `closedDoorAhead`, WP 13.18). On a site
 *   it walks round the scene's props, and held by one its way does not know (a door left open), finds it again.
 *   With `look` its view turns the way it walks (`LOOK_TURN`), its keys' frame (`cam`) the heading.
 * - **Stuck, measured along the wanted direction**: each step, how far the feet went along the way it asked for, or up
 *   (a ladder). Under `progress` m/s while it asks to move, the held time grows (else it falls at twice the pace):
 *   pressed against a wall, a body jitters back and forth faster than "not moving" allows, so only the way it wants
 *   counts. Held 0.45 s, it sidesteps 1.3 rad to one side; 0.9 s, 2.2 rad; 1.5 s, it jumps and tries the other side.
 *   Held `stuck` seconds in all on one goal, it is `stuck` (`held`).
 * - **Watchdog**: a goal whose walking distance has not fallen by `gain` in `patience` seconds is given up (`stuck`,
 *   `no progress`); one no route leads to, at once (`no route`).
 * - **Runs** (`runBot`): the goals `to` in order, or a tour of `tour` open tiles both ways reachable from the start
 *   (drawn from the bot's own stream, `derive(seed, 'bot')`, never the world's), then `back` to the start; it stops
 *   when all are reached (`arrived`), stuck, at the stop condition `until` (`stopped`: a function of the world, or
 *   `component.field`, true on some entity) or at the budget of `steps` (`timeout`). The report: the status, the steps,
 *   the goals reached, where the player ended, the hash, the events by type and, every `trace` steps, a sample (120
 *   at most: the tick, the feet, the move asked, the goal).
 * - **Sweeps** (`sweepBot`, engine/dev/botSweep.ts): a run from a fresh session of a scene per seed, in one row.
 *
 * Invariants: the bot holds no sim state (its own lives between steps, outside the hash); given the same scene, seed
 * and plan it plays the same steps. Carried from `my-3d2dge:src/emberdeep/93-autopilot.js` (the virtual input, the
 * progress watchdog, stuck along the wanted direction, the sidesteps and the roll free) and shardfall@fa2dab6
 * `pavilion-lite/src/tools.rs:1076-1185` and `crates/pav_tools/src/agent_tools.rs:226-307` (the run's stop condition,
 * sampled trace and event counts, the seed sweep, one row per level), mechanisms only: navigation, no combat.
 *
 * @example
 * import { compileLevel } from '../world/level/compile';
 * const maze = compileLevel('#######\n#.....#\n#.###.#\n#.#...#\n#######\n');
 * const bot = new Bot(maze).goTo({ x: 3.5, z: 3.5 });
 * bot.next({ x: 1.5, z: 1.5 }, 1 / 60).move; // [0.92, 0.38]: east along the top, round the walls
 * @see engine/dev/bot.test.ts
 */
import type { TraceRecord } from '../core/events';
import { codeError } from '../core/log';
import { defineSchema, parse, show, type SpecOf } from '../core/schema';
import { withSimMath } from '../core/simMath';
import type { Intents } from '../input/intents';
import { turnToward } from '../physics/movement/steer';
import type { World } from '../sim/world';
import type { CompiledLevel } from '../world/level/types';
import type { Site } from '../world/site';
import type { NavBlock } from '../world/siteNav';
import { propObstacles } from '../sim/propBlocks';
import { closedDoorAhead, levelBotNav, siteBotNav, tourStream, type BotNav, type BotPoint, type BotWay } from './botNav'; // prettier-ignore

/** How the bot moves and when it gives up: `new Bot(level, options)` and every run take them. */
export const BOT_FIELDS = defineSchema({
  reach: { type: 'number', default: 0.4, minimum: 0.01, unit: 'm', description: 'How near a goal counts as there.' },
  near: { type: 'number', default: 1, minimum: 0, unit: 'm', description: 'How near it heads straight at the goal.' },
  headings: { type: 'integer', default: 16, minimum: 0, description: 'The directions it moves in (0: any).' },
  climb: { type: 'number', default: 0.5, minimum: 0, unit: 'm', description: 'The most a step climbs, for its grid.' },
  progress: { type: 'number', default: 0.5, minimum: 0, unit: 'm/s', description: 'Slower along the way it wants is held.' }, // prettier-ignore
  stuck: { type: 'number', default: 5, minimum: 0, unit: 's', description: 'Held this long on one goal: stuck.' },
  patience: {
    type: 'number',
    default: 6,
    minimum: 0,
    unit: 's',
    description: 'The watchdog: no gain this long, stuck.',
  },
  gain: { type: 'number', default: 1, minimum: 0, unit: 'm', description: 'The walking distance the watchdog wants.' },
  look: { type: 'boolean', default: false, description: "Turn the view (the sim's look) the way it walks, as a player's mouse would." }, // prettier-ignore
});

/** What `new Bot` takes: each field of `BOT_FIELDS`, optional. */
export type BotOptions = SpecOf<typeof BOT_FIELDS>;

/** Where a bot stands with its goal. */
export type BotStatus = 'idle' | 'going' | 'arrived' | 'stuck';

/** How long held before each move (s): the sidesteps, then a jump and the other side. */
const SIDESTEP = [0.45, 0.9, 1.5] as const;
/** The sidesteps' turns (rad). */
const TURN = [1.3, 2.2] as const;
/** How far above or below a goal (m) its height still counts as there: a slope's or a flight's, not a storey's. */
const UP_REACH = 1;
/** Steps a jump is held: a full jump. */
const JUMP_STEPS = 12;
/** The trace's most samples. */
const MAX_SAMPLES = 120;
/** How near its floor (m) a falling body pushes again: never on the way down, where a push mantles back up a ledge. */
const LANDING = 0.25;
/**
 * How fast its view turns the way it walks with `look` (rad/s), as a mouse would: a body's own `movement.turnRate`,
 * 720°/s, so it faces as it would facing its heading; its keys keep the heading's frame (`cam`), so it walks as then.
 */
const LOOK_TURN = 4 * Math.PI;
/** How long a push it walks toward a drop (the shooter model's stick curve makes it 1.6 m/s). */
const DROP_PUSH = 0.2;
/** On a site, held this long (s) it finds its way again, round the props as they stand, at most once in `every` steps. */
const REPLAN = { held: 0.3, every: 120 } as const;

/**
 * The bot: one goal at a time, the intents for each step (see the file comment). On a site (engine/dev/botNav.ts) it
 * crouches where its way runs under a low ceiling (in time for the duck to end before it), steps gently toward a
 * drop (a ladder's top) and takes hold of the ladder there (use), keeps its push through a mantle, lets go of a ladder
 * (crouch) whose way goes down, and pushes nowhere while it falls, so it lands rather than catching the ladder again;
 * a goal there counts only within 1 m of its height.
 */
export class Bot {
  readonly options: Readonly<Required<BotOptions>>;
  status: BotStatus = 'idle';
  /** Why it is stuck: `no route`, `held` or `no progress`; null otherwise. */
  reason: string | null = null;
  #goal: BotPoint | null = null;
  #field: BotWay | null = null;
  #last: BotPoint | null = null;
  #held = 0;
  #heldAll = 0;
  #side = 1;
  #move: [number, number] | null = null;
  #look: [number, number] | null = null;
  /** The heading its keys are pressed toward, the `cam` it sends with its look. */
  #cam = 0;
  #drops = 0;
  #jump = 0;
  #best = Infinity;
  #waited = 0;
  #nav: BotNav;
  #site: Site | null;

  /** A bot on `level`, or on a site (engine/world/site.ts): its storeys and terrain, the boxes `blocked` closed. */
  constructor(level: CompiledLevel | Site, options: BotOptions = {}, blocked: readonly NavBlock[] = []) {
    this.options = parse(BOT_FIELDS, options, 'new Bot(level, options)') as Required<BotOptions>;
    const { climb } = this.options;
    this.#site = 'structures' in level ? level : null;
    this.#nav = this.#site ? siteBotNav(this.#site, climb, blocked) : levelBotNav(level as CompiledLevel, climb);
  }

  /** What it navigates by: the level's grid or the site's graph. */
  get nav(): BotNav {
    return this.#nav;
  }

  /** How long it has been held along the way it wants (s), less while it moves. */
  get held(): number {
    return this.#held;
  }

  /** On a site, finds its way again with `blocked` closed: what holds it now (a door left open, a prop moved). */
  replan(blocked: readonly NavBlock[]): void {
    if (!this.#site) return;
    this.#nav = siteBotNav(this.#site, this.options.climb, blocked);
    if (this.#goal) this.#field = this.#nav.wayTo(this.#goal);
    this.#held = 0;
  }

  /** The goal now, or null. */
  get goal(): BotPoint | null {
    return this.#goal;
  }

  /** Heads for `goal` (m on the ground; its height on a site) from the next step: the counters start again. */
  goTo(goal: BotPoint): this {
    this.#goal = { x: goal.x, y: goal.y, z: goal.z };
    this.#field = this.#nav.wayTo(goal);
    [this.status, this.reason, this.#best, this.#waited, this.#held, this.#heldAll] = [
      'going',
      null,
      Infinity,
      0,
      0,
      0,
    ];
    [this.#last, this.#jump, this.#move] = [null, 0, null];
    return this;
  }

  /** The intents for one step of `dt` seconds, for a body whose feet are at `at` (m); none unless going. */
  next(at: BotPoint, dt: number): Intents {
    return withSimMath(() => this.#think(at, dt));
  }

  #think(at: BotPoint, dt: number): Intents {
    const goal = this.#goal;
    if (this.status !== 'going' || !goal) return {};
    const [dx, dz] = [goal.x - at.x, goal.z - at.z];
    // On a site a goal names its height: one a storey above or below is not there, nor near.
    const level = goal.y === undefined || at.y === undefined || Math.abs(goal.y - at.y) <= UP_REACH;
    const straight = level ? Math.sqrt(dx * dx + dz * dz) : Infinity;
    if (straight <= this.options.reach) return this.#end('arrived', null);
    const walk = this.#field ? this.#field.distanceAt(at) : Infinity;
    if (!(walk < Infinity)) return this.#end('stuck', 'no route');
    const left = walk > 0 ? walk : straight;
    if (left < this.#best - this.options.gain) [this.#best, this.#waited] = [left, 0];
    else if ((this.#waited += dt) > this.options.patience) return this.#end('stuck', 'no progress');
    const way = straight < this.options.near ? null : this.#field!.direction(at);
    const flat = Math.sqrt(dx * dx + dz * dz) || 1;
    const [wx, wz] = way ? [way.x, way.z] : [dx / flat, dz / flat];
    // How far it went since the last step along the way navigation wants, not the sidestep's, or up or down (a ladder).
    const slow = this.options.progress * dt;
    const fell = (this.#last?.y ?? at.y ?? 0) - (at.y ?? 0);
    const rose = Math.abs(fell);
    const moved = this.#last ? Math.max((at.x - this.#last.x) * wx + (at.z - this.#last.z) * wz, rose) : slow;
    if (moved < slow) [this.#held, this.#heldAll] = [this.#held + dt, this.#heldAll + dt];
    else this.#held = Math.max(0, this.#held - 2 * dt);
    this.#last = { x: at.x, y: at.y, z: at.z };
    if (this.#heldAll > this.options.stuck) return this.#end('stuck', 'held');
    // Mantling it keeps the push it went in with (back or a crouch would let go); on a ladder whose way goes down it
    // lets go (crouch); falling, it pushes nowhere till it lands, rather than catching a ladder or a ledge again.
    if (at.mode === 'mantle' && this.#move) return { move: this.#move, ...(this.#look ? { look: this.#look, cam: this.#cam } : {}) }; // prettier-ignore
    if (at.mode === 'ladder' && (this.#field?.rise?.(at) ?? 0) < -UP_REACH) return { b: ['crouch'] };
    if (at.mode === 'air' && this.#jump <= 0 && fell > 0 && (this.#field?.over?.(at) ?? 0) > LANDING) return {};
    let angle = Math.atan2(wx, wz);
    if (this.#held > SIDESTEP[2]) [this.#jump, this.#held, this.#side] = [JUMP_STEPS, 0, -this.#side];
    else if (this.#held > SIDESTEP[0]) angle += this.#side * (this.#held > SIDESTEP[1] ? TURN[1] : TURN[0]);
    // Standing at a drop (a ladder's top, a hatch) it steps gently and takes hold of the ladder (below); crouched it cannot.
    const drop = at.mode === 'ground' && at.stance !== 'crouch' && (this.#field?.rise?.(at) ?? 0) < -UP_REACH;
    const move = (this.#move = this.#heading(angle, drop ? DROP_PUSH : 1));
    if (this.options.look) {
      this.#cam = Math.atan2(move[0], move[1]);
      this.#look = [this.#look ? turnToward(this.#look[0], this.#cam, LOOK_TURN * dt) : this.#cam, 0];
    }
    const b = this.#field?.crouch?.(at) ? ['crouch'] : [];
    // At a drop (a ladder's top) it takes hold of the ladder from there as a player does (use, every other step).
    if (drop && this.#drops++ % 2 === 0) b.push('interact');
    if (this.#jump > 0) {
      this.#jump--;
      b.push('jump');
    }
    const look = this.#look ? { look: this.#look, cam: this.#cam } : {};
    return b.length ? { move, b, ...look } : { move, ...look };
  }

  /** `angle` (rad from +Z toward +X) as `move` takes it, `push` long: snapped to the headings, two decimals cut toward 0. */ // prettier-ignore
  #heading(angle: number, push: number): [number, number] {
    const n = this.options.headings;
    const snapped = n > 0 ? Math.round((angle * n) / (2 * Math.PI)) * ((2 * Math.PI) / n) : angle;
    return [Math.trunc(Math.sin(snapped) * push * 100) / 100 || 0, Math.trunc(Math.cos(snapped) * push * 100) / 100 || 0]; // prettier-ignore
  }

  #end(status: BotStatus, reason: string | null): Intents {
    [this.status, this.reason] = [status, reason];
    return {};
  }
}

/** The world as the bot reads it: the session's, or the inspector's read-only view of it. */
export type BotWorld = Pick<World, 'seed' | 'tick' | 'dt' | 'hash'> & {
  get(id: number): object | undefined;
  query(...names: string[]): readonly object[];
  readonly events: { trace(): readonly TraceRecord[] };
};

/** What the bot plays: a world to read and a recorded step. */
export interface BotRun {
  readonly world: BotWorld;
  step(intents?: unknown): unknown;
}

/** One sample of a run's trace. */
export interface BotSample {
  t: number;
  at: [number, number, number];
  move: [number, number];
  goal: number;
}

/** What a run plays (see the file comment), with the bot's options. */
export interface BotPlan extends BotOptions {
  /** The goals, in order (m on the ground; with their heights on a site). */
  to?: BotPoint | readonly BotPoint[];
  /** Instead: this many open tiles drawn from the bot's own stream, each reachable from the start and back. */
  tour?: number;
  /** Then back to where it started. */
  back?: boolean;
  /** The step budget (3,600: a minute). */
  steps?: number;
  /** The stop condition: true on the world, or `component.field` true on some entity holding the component. */
  until?: string | ((world: BotWorld) => boolean);
  /** Sample the trace every this many steps (0: none). */
  trace?: number;
  /** The actor it plays: the first player actor when absent. */
  actor?: number;
}

/** What a run did. */
export interface BotReport {
  status: 'arrived' | 'stuck' | 'stopped' | 'timeout';
  /** Why it stuck, or null. */
  reason: string | null;
  steps: number;
  /** Goals reached, of `goals`. */
  reached: number;
  goals: number;
  /** Where the player's feet ended (m). */
  at: [number, number, number];
  hash: string;
  events: Record<string, number>;
  trace?: BotSample[];
}

/** The actor `id`'s component (the first player's when absent), or a coded error naming the fix. */
function actorFeet(
  world: BotWorld,
  id: number | undefined,
): Required<Omit<BotPoint, 'mode' | 'stance'>> & Pick<BotPoint, 'mode' | 'stance'> & { id: number } {
  // prettier-ignore
  const actors = world.query('actor') as { id: number; actor: { player: boolean; x: number; y: number; z: number }; motion?: { mode?: string; stance?: string } }[]; // prettier-ignore
  const found = actors.find((e) => (id === undefined ? e.actor.player : e.id === id));
  if (found) return { id: found.id, x: found.actor.x, y: found.actor.y, z: found.actor.z, mode: found.motion?.mode, stance: found.motion?.stance }; // prettier-ignore
  const problem = id === undefined ? 'the scene has no player actor' : `${show(id)} is no live actor`;
  throw codeError('SIM_NO_ACTOR', { what: 'the bot', problem });
}

/** The stop condition as a test of the world. */
function stopOf(until: BotPlan['until']): (world: BotWorld) => boolean {
  if (until === undefined) return () => false;
  if (typeof until === 'function') return until;
  const [component, field] = until.split('.');
  if (!component || !field) {
    throw codeError('SIM_BAD_ARGUMENT', { where: 'the bot plan { until }', value: show(until), expected: "'component.field', true on some entity (round.over)" }); // prettier-ignore
  }
  return (world) => world.query(component).some((e) => Boolean((e as Record<string, Record<string, unknown>>)[component][field])); // prettier-ignore
}

/** Plays `run` with the bot over `level` or a site (see the file comment) and reports what happened. */
export function runBot(run: BotRun, level: CompiledLevel | Site, plan: BotPlan = {}): BotReport {
  const { to, tour, back = false, steps = 3600, until, trace = 0, actor, ...options } = plan;
  const { world } = run;
  const site = 'structures' in level;
  const bot = new Bot(level, options, site ? propObstacles(world) : []); // a site's props walked round
  let replanned = -Infinity;
  const start = actorFeet(world, actor);
  const given = to === undefined ? [] : 'x' in to ? [to as BotPoint] : [...(to as readonly BotPoint[])];
  const goals = tour ? bot.nav.tour(start, tour, tourStream(world.seed)) : given;
  if (back) goals.push({ x: start.x, y: start.y, z: start.z });
  const stop = stopOf(until);
  const events: Record<string, number> = {};
  const samples: BotSample[] = [];
  let seen = world.events.trace().at(-1)?.seq ?? 0;
  let [reached, ran] = [0, 0];
  let status: BotReport['status'] = goals.length ? 'timeout' : 'arrived';
  if (goals.length) bot.goTo(goals[0]);
  for (; ran < steps && goals.length; ran++) {
    if (stop(world)) {
      status = 'stopped';
      break;
    }
    const feet = actorFeet(world, actor);
    let intents = bot.next(feet, world.dt);
    while (bot.status === 'arrived' && ++reached < goals.length)
      intents = bot.goTo(goals[reached]).next(feet, world.dt);
    if (bot.status === 'going' && closedDoorAhead(world, feet.id)) intents = { ...intents, b: [...(intents.b ?? []), 'interact'] }; // prettier-ignore
    if (site && bot.held > REPLAN.held && world.tick - replanned >= REPLAN.every) {
      bot.replan(propObstacles(world)); // held by what its way does not know: it looks again
      replanned = world.tick;
    }
    if (bot.status !== 'going') {
      status = bot.status === 'arrived' ? 'arrived' : 'stuck';
      break;
    }
    if (trace > 0 && world.tick % trace === 0 && samples.length < MAX_SAMPLES) {
      samples.push({ t: world.tick, at: [feet.x, feet.y, feet.z], move: [...(intents.move ?? [0, 0])] as [number, number], goal: reached }); // prettier-ignore
    }
    run.step(intents);
    for (const record of world.events.trace()) if (record.seq > seen) events[record.type] = (events[record.type] ?? 0) + 1; // prettier-ignore
    seen = world.events.trace().at(-1)?.seq ?? seen;
  }
  const end = actorFeet(world, actor);
  return {
    status,
    reason: status === 'stuck' ? bot.reason : null,
    steps: ran,
    reached,
    goals: goals.length,
    at: [end.x, end.y, end.z],
    hash: world.hash(),
    events,
    ...(trace > 0 ? { trace: samples } : {}),
  };
}
