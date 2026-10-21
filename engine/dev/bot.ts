/**
 * @file The bot (PLAN.md WP 5.6, §5.6, I-38; doctrines: Agent-operable, Reproducible): plays a scene's player through
 * intents, as a virtual device would, so a test or an agent gets play longer and more varied than a scripted replay
 * (soak runs, navigation smoke over many levels). It is sim-side: it reads the world and writes intents through the
 * session's step, so its play is recorded and replays as anyone's does; its own sums run under the sim's math
 * (engine/core/simMath.ts), so a run gives the same intents in Node and in a page.
 *
 * - **Navigation** (`Bot`): toward its goal down the level's flow field (engine/world/nav.ts, to the goal's nearest open
 *   tile), the last `near` metres straight at it, as one of `headings` directions (few, so its intents change seldom);
 *   there within `reach`.
 * - **Stuck, measured along the wanted direction**: each step, how far the feet went along the way it asked for. Under
 *   `progress` m/s while it asks to move, the held time grows (else it falls at twice the pace): pressed against a
 *   wall, a body jitters back and forth faster than "not moving" allows, so only the way it wants counts. Held 0.45 s,
 *   it sidesteps 1.3 rad to one side; 0.9 s, 2.2 rad; 1.5 s, it jumps and tries the other side. Held `stuck` seconds in
 *   all on one goal, it is `stuck` (`held`).
 * - **Watchdog**: a goal whose walking distance has not fallen by `gain` in `patience` seconds is given up (`stuck`,
 *   `no progress`); one no route leads to, at once (`no route`).
 * - **Runs** (`runBot`): the goals `to` in order, or a tour of `tour` open tiles both ways reachable from the start
 *   (drawn from the bot's own stream, `derive(seed, 'bot')`, never the world's), then `back` to the start; it stops
 *   when all are reached (`arrived`), stuck, at the stop condition `until` (`stopped`: a function of the world, or
 *   `component.field`, true on some entity) or at the budget of `steps` (`timeout`). The report: the status, the steps,
 *   the goals reached, where the player ended, the hash, the events by type and, every `trace` steps, a sample (120
 *   at most: the tick, the feet, the move asked, the goal).
 * - **Sweeps** (`sweepBot`): the run from a fresh session of the scene per seed (`1-20`, `5` for 1 to 5, `3,7,9`):
 *   one row for the scene, its seeds' runs inside.
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
 * parseSeeds('3,7,9'); // [3, 7, 9]
 * @see engine/dev/bot.test.ts
 */
import type { TraceRecord } from '../core/events';
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Registry } from '../core/registry';
import { derive, Rng } from '../core/rng';
import { defineSchema, parse, show, type SpecOf } from '../core/schema';
import { withSimMath } from '../core/simMath';
import type { Intents } from '../input/intents';
import { getScene, type Scene } from '../sim/scene';
import { createSession } from '../sim/session';
import type { World } from '../sim/world';
import { getLevel } from '../world/level/level';
import type { CompiledLevel } from '../world/level/types';
import { NavGrid, type FlowField, type GroundPoint } from '../world/nav';

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
});

/** What `new Bot` takes: each field of `BOT_FIELDS`, optional. */
export type BotOptions = SpecOf<typeof BOT_FIELDS>;

/** Where a bot stands with its goal. */
export type BotStatus = 'idle' | 'going' | 'arrived' | 'stuck';

/** How long held before each move (s): the sidesteps, then a jump and the other side. */
const SIDESTEP = [0.45, 0.9, 1.5] as const;
/** The sidesteps' turns (rad). */
const TURN = [1.3, 2.2] as const;
/** Steps a jump is held: a full jump. */
const JUMP_STEPS = 12;
/** The trace's most samples. */
const MAX_SAMPLES = 120;

/** The bot: one goal at a time, the intents for each step (see the file comment). */
export class Bot {
  readonly grid: NavGrid;
  readonly options: Readonly<Required<BotOptions>>;
  status: BotStatus = 'idle';
  /** Why it is stuck: `no route`, `held` or `no progress`; null otherwise. */
  reason: string | null = null;
  #goal: GroundPoint | null = null;
  #field: FlowField | null = null;
  #last: GroundPoint | null = null;
  #held = 0;
  #heldAll = 0;
  #side = 1;
  #jump = 0;
  #best = Infinity;
  #waited = 0;

  constructor(level: CompiledLevel, options: BotOptions = {}) {
    this.options = parse(BOT_FIELDS, options, 'new Bot(level, options)') as Required<BotOptions>;
    this.grid = new NavGrid(level, { climb: this.options.climb });
  }

  /** The goal now, or null. */
  get goal(): GroundPoint | null {
    return this.#goal;
  }

  /** Heads for `goal` (m on the ground) from the next step: the counters start again. */
  goTo(goal: GroundPoint): this {
    const tile = this.grid.nearestOpen(goal.x, goal.z);
    this.#goal = { x: goal.x, z: goal.z };
    this.#field = tile >= 0 ? this.grid.flowField(tile) : null;
    [this.status, this.reason, this.#best, this.#waited, this.#held, this.#heldAll] = [
      'going',
      null,
      Infinity,
      0,
      0,
      0,
    ];
    [this.#last, this.#jump] = [null, 0];
    return this;
  }

  /** The intents for one step of `dt` seconds, for a body whose feet are at `at` (m); none unless going. */
  next(at: GroundPoint, dt: number): Intents {
    return withSimMath(() => this.#think(at, dt));
  }

  #think(at: GroundPoint, dt: number): Intents {
    const goal = this.#goal;
    if (this.status !== 'going' || !goal) return {};
    const [dx, dz] = [goal.x - at.x, goal.z - at.z];
    const straight = Math.sqrt(dx * dx + dz * dz);
    if (straight <= this.options.reach) return this.#end('arrived', null);
    const walk = this.#field ? this.#field.distanceAt(at.x, at.z) : Infinity;
    if (!(walk < Infinity)) return this.#end('stuck', 'no route');
    const left = walk > 0 ? walk : straight;
    if (left < this.#best - this.options.gain) [this.#best, this.#waited] = [left, 0];
    else if ((this.#waited += dt) > this.options.patience) return this.#end('stuck', 'no progress');
    const way = straight < this.options.near ? null : this.#field!.direction(at.x, at.z);
    const [wx, wz] = way ? [way.x, way.z] : [dx / straight, dz / straight];
    // How far it went since the last step along the way navigation wants, not the sidestep's (see the file comment).
    const slow = this.options.progress * dt;
    const moved = this.#last ? (at.x - this.#last.x) * wx + (at.z - this.#last.z) * wz : slow;
    if (moved < slow) [this.#held, this.#heldAll] = [this.#held + dt, this.#heldAll + dt];
    else this.#held = Math.max(0, this.#held - 2 * dt);
    this.#last = { x: at.x, z: at.z };
    if (this.#heldAll > this.options.stuck) return this.#end('stuck', 'held');
    let angle = Math.atan2(wx, wz);
    if (this.#held > SIDESTEP[2]) [this.#jump, this.#held, this.#side] = [JUMP_STEPS, 0, -this.#side];
    else if (this.#held > SIDESTEP[0]) angle += this.#side * (this.#held > SIDESTEP[1] ? TURN[1] : TURN[0]);
    const move = this.#heading(angle);
    if (this.#jump <= 0) return { move };
    this.#jump--;
    return { move, b: ['jump'] };
  }

  /** `angle` (rad from +Z toward +X) as `move` takes it: snapped to the headings, two decimals cut toward 0. */
  #heading(angle: number): [number, number] {
    const n = this.options.headings;
    const snapped = n > 0 ? Math.round((angle * n) / (2 * Math.PI)) * ((2 * Math.PI) / n) : angle;
    return [Math.trunc(Math.sin(snapped) * 100) / 100 || 0, Math.trunc(Math.cos(snapped) * 100) / 100 || 0];
  }

  #end(status: BotStatus, reason: string | null): Intents {
    [this.status, this.reason] = [status, reason];
    return {};
  }
}

/** The world as the bot reads it: the session's, or the inspector's read-only view of it. */
export type BotWorld = Pick<World, 'seed' | 'tick' | 'dt' | 'hash'> & {
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
  /** The goals, in order (m on the ground). */
  to?: GroundPoint | readonly GroundPoint[];
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
function actorFeet(world: BotWorld, id: number | undefined): { x: number; y: number; z: number } {
  const actors = world.query('actor') as { id: number; actor: { player: boolean; x: number; y: number; z: number } }[];
  const found = actors.find((e) => (id === undefined ? e.actor.player : e.id === id));
  if (found) return found.actor;
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

/** The tour's goals: `n` open tiles reachable from `start` and back, drawn from the bot's stream `derive(seed, 'bot')`. */
function tourOf(grid: NavGrid, start: GroundPoint, n: number, seed: number): GroundPoint[] {
  const from = grid.nearestOpen(start.x, start.z);
  if (from < 0 || n <= 0) return [];
  const home = grid.flowField(from).distance;
  const open = [...home.keys()].filter((tile) => tile !== from && home[tile] < Infinity);
  const rng = new Rng(derive(seed, 'bot'));
  const out: GroundPoint[] = [];
  for (let tries = 0; out.length < n && open.length && tries < 8 * n; tries++) {
    const [tile] = open.splice(rng.int(0, open.length - 1), 1);
    if (!(grid.flowField(tile).distance[from] < Infinity)) continue; // reachable from the start, not only back
    const centre = grid.center(tile);
    out.push({ x: centre.x, z: centre.z });
  }
  return out;
}

/** Plays `run` with the bot over `level` (see the file comment) and reports what happened. */
export function runBot(run: BotRun, level: CompiledLevel, plan: BotPlan = {}): BotReport {
  const { to, tour, back = false, steps = 3600, until, trace = 0, actor, ...options } = plan;
  const bot = new Bot(level, options);
  const { world } = run;
  const start = actorFeet(world, actor);
  const given = to === undefined ? [] : 'x' in to ? [to as GroundPoint] : [...(to as readonly GroundPoint[])];
  const goals = tour ? tourOf(bot.grid, start, tour, world.seed) : given;
  if (back) goals.push({ x: start.x, z: start.z });
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

/** Seeds as a sweep takes them: `1-20`, `5` (1 to 5), `3,7,9`, a count or a list; 1 to 500 whole numbers from 0. */
export function parseSeeds(seeds: unknown): number[] {
  const bad = () => codeError('SIM_BAD_ARGUMENT', { where: 'the bot sweep { seeds }', value: show(seeds), expected: 'seeds like 1-20, 5 or 3,7,9 (1 to 500 of them, whole numbers from 0)' }); // prettier-ignore
  const whole = (text: unknown) => (/^\s*\d+\s*$/.test(String(text)) ? Number(text) : NaN);
  const range = (a: number, b: number) => (b >= a && b - a < 500 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []); // prettier-ignore
  let list: number[] = [];
  if (Array.isArray(seeds)) list = seeds.map(whole);
  else if (typeof seeds === 'number') list = range(1, seeds);
  else if (typeof seeds === 'string' && seeds.includes('-'))
    list = range(...(seeds.split('-').map(whole) as [number, number])); // prettier-ignore
  else if (typeof seeds === 'string' && seeds.includes(',')) list = seeds.split(',').map(whole);
  else if (typeof seeds === 'string') list = range(1, whole(seeds));
  if (!list.length || list.length > 500 || list.some((seed) => !Number.isInteger(seed))) throw bad();
  return list;
}

/** One row of the bot's report: a scene, its seeds' runs and their sums. */
export interface BotRow {
  scene: string;
  level: string;
  seeds: number[];
  arrived: number;
  stuck: number;
  stopped: number;
  timeout: number;
  /** The most steps a run took. */
  worst: number;
  runs: (BotReport & { seed: number })[];
}

/** How a sweep starts each run: the scene's settings over its own, its registry and its level. */
export interface SweepOptions {
  settings?: Readonly<Record<string, unknown>>;
  registry?: Registry;
  /** The level the bot reads: the scene's own (`getLevel(scene.level)`) when absent. */
  level?: CompiledLevel;
}

/** Plays `plan` from a fresh session of `scene` per seed (see the file comment): one row for the scene. */
export function sweepBot(
  scene: Scene | string,
  seeds: unknown,
  plan: BotPlan = {},
  options: SweepOptions = {},
): BotRow {
  const registry = options.registry ?? sharedRegistry;
  const found = typeof scene === 'string' ? getScene(scene, registry) : scene;
  const levelId = found.level ?? '';
  if (!options.level && !levelId) throw codeError('SIM_BAD_ARGUMENT', { where: 'sweepBot(scene)', value: found.id, expected: 'a scene with a level (defineScene({ level })), or { level } given' }); // prettier-ignore
  const level = options.level ?? getLevel(levelId, registry);
  const runs = parseSeeds(seeds).map((seed) => {
    const session = createSession(found, { seed, settings: options.settings, registry });
    return { seed, ...runBot(session, level, plan) };
  });
  const count = (status: BotReport['status']) => runs.filter((r) => r.status === status).length;
  const sums = {
    arrived: count('arrived'),
    stuck: count('stuck'),
    stopped: count('stopped'),
    timeout: count('timeout'),
  };
  return { scene: found.id, level: levelId, seeds: runs.map((r) => r.seed), ...sums, worst: Math.max(...runs.map((r) => r.steps)), runs }; // prettier-ignore
}
