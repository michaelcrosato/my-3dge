/**
 * @file The nav-1000 fixture scene (PLAN.md WP 4.3): 1,000 agents chasing a target round the hall, so navigation's
 * queries are timed against a budget (`node x perf fixtures/scenes/nav-1000 --budget`, tests/baselines/perf/nav-1000.json).
 *
 * The level is the hall (fixtures/scenes/nav-1000/hall.ts), registered as `level:nav-1000`, so `node x sim nav-1000
 * --map` draws its grid. The target walks a loop at 2.5 m/s, a pure function of the tick: over the floor, up the west
 * stairs, along the gallery, off its edge and back. Agents spawn on open tiles drawn from the `spawn` stream. Each step,
 * in the phase `ai`, every agent asks the way: within `nav1000.reach` metres of walking, the flow field toward the
 * target's tile (cached per tile: one Dijkstra each time the target enters a new tile); farther, an A* path, planned
 * when it reaches its waypoint and every 2 s otherwise (staggered by id), walking to its first waypoint. It keeps 0.6
 * m from its neighbours, found in a spatial hash rebuilt each step. In the phase `physics` it moves, sliding along an
 * axis when its tile has no step to where it would go, its feet on the floor (floorHeight).
 *
 * Game code: it imports only engine/sim-api.ts. The grid, its field cache and the hash are derived data, made in
 * `setup` from the level and the state: never saved, and rebuilt the same, so a capture restores and continues exactly
 * (fixtures/scenes/nav-1000/index.test.ts). Try it: `node x sim fixtures/scenes/nav-1000 --steps 300 --map`.
 */
import {
  defineComponent,
  defineLevel,
  defineScene,
  defineSettings,
  floorHeight,
  getLevel,
  NavGrid,
  SpatialHash,
  Vector3,
  type World,
} from '../../../engine/sim-api';
import { HALL_TEXT } from './hall';

/** The scene's settings. */
export const NAV_1000_SETTINGS = defineSettings({
  'nav1000.agents': {
    type: 'integer',
    default: 1000,
    minimum: 0,
    maximum: 5000,
    when: 'scene',
    description: 'Agents spawned when the scene starts.',
  },
  'nav1000.speed': { type: 'number', default: 3, minimum: 0, maximum: 10, unit: 'm/s', description: 'Walking speed.' },
  'nav1000.reach': {
    type: 'number',
    default: 24,
    minimum: 1,
    maximum: 500,
    unit: 'm',
    description: 'How far the flow field toward the target reaches; agents farther plan A* paths.',
  },
});

/** The level's id. */
export const NAV_1000_LEVEL = 'level:nav-1000';
defineLevel(NAV_1000_LEVEL, { text: HALL_TEXT, file: 'fixtures/scenes/nav-1000/hall.ts' });
const LEVEL = getLevel(NAV_1000_LEVEL);

/** The target's loop (m, [x, z]), walked at `TARGET_SPEED` from the first point. */
export const TARGET_LOOP = [
  [31.5, 30.5],
  [12.5, 30.5],
  [12.5, 11.5],
  [12.5, 3.5],
  [20.5, 3.5],
  [20.5, 12.5],
  [31.5, 12.5],
] as const;
/** The target's speed (m/s). */
export const TARGET_SPEED = 2.5;
/** How far apart agents keep (m), and how many neighbours each heeds. */
const SPACING = 0.6;
const NEIGHBOURS = 8;
/** Steps between an agent's path plans, when it has not reached its waypoint. */
const REPLAN = 120;

/** An agent of the fixture: where its feet are, its velocity this step, and its path's waypoint. */
export const NAV_AGENT = defineComponent('navAgent', {
  description: 'An agent of the nav-1000 fixture: its feet, its velocity this step, and its planned waypoint.',
  fields: {
    x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
    y: { type: 'number', default: 0, unit: 'm', description: 'Up: the floor under it.' },
    z: { type: 'number', default: 0, unit: 'm', description: 'South.' },
    vx: { type: 'number', default: 0, unit: 'm/s', description: 'Velocity, east.' },
    vz: { type: 'number', default: 0, unit: 'm/s', description: 'Velocity, south.' },
    wx: { type: 'number', default: 0, unit: 'm', description: 'Its waypoint, east, when beyond the field.' },
    wz: { type: 'number', default: 0, unit: 'm', description: 'Its waypoint, south.' },
    plan: { type: 'integer', default: -1, minimum: -1, description: 'The step it last planned a path at; −1 never.' },
  },
});

type Agent = { x: number; y: number; z: number; vx: number; vz: number; wx: number; wz: number; plan: number };
type W = World<{ navAgent: Agent }>;

/** The loop's legs (m), from each point to the next, and their sum. */
const LEGS = TARGET_LOOP.map(([x, z], i) => {
  const [qx, qz] = TARGET_LOOP[(i + 1) % TARGET_LOOP.length];
  return Math.sqrt((qx - x) * (qx - x) + (qz - z) * (qz - z));
});
const LAP = LEGS.reduce((sum, leg) => sum + leg, 0);

/** The target's place at step `tick` (m), into `out`. */
export function targetAt(tick: number, dt: number, out = new Vector3()): Vector3 {
  let s = (tick * dt * TARGET_SPEED) % LAP;
  let i = 0;
  for (; s > LEGS[i]; i++) s -= LEGS[i];
  const [p, q] = [TARGET_LOOP[i], TARGET_LOOP[(i + 1) % TARGET_LOOP.length]];
  return out.set(p[0] + ((q[0] - p[0]) * s) / LEGS[i], 0, p[1] + ((q[1] - p[1]) * s) / LEGS[i]);
}

/** What the systems share: derived from the level and the state, never saved. */
interface Nav {
  grid: NavGrid;
  hash: SpatialHash;
  near: Int32Array;
  way: Vector3;
  target: Vector3;
}

/** Sets each agent's velocity: the way to the target, and away from its neighbours (the phase `ai`). */
function steer(w: W, nav: Nav): void {
  const { grid, hash, near, way, target } = nav;
  const [speed, reach] = [w.settings.get<number>('nav1000.speed'), w.settings.get<number>('nav1000.reach')];
  targetAt(w.tick, w.dt, target);
  const goal = grid.nearestOpen(target.x, target.z);
  const field = goal < 0 ? null : grid.flowField(goal, { reach });
  const agents = w.query('navAgent');
  hash.clear();
  for (const e of agents) hash.add(e.id, e.navAgent.x, e.navAgent.z);
  for (const e of agents) {
    const a = e.navAgent;
    way.set(0, 0, 0);
    if (field && field.distanceAt(a.x, a.z) < Infinity) {
      field.direction(a.x, a.z, way);
    } else {
      const arrived = (a.wx - a.x) * (a.wx - a.x) + (a.wz - a.z) * (a.wz - a.z) < 0.0625;
      if ((arrived && a.plan >= 0) || (w.tick + e.id) % REPLAN === 0) {
        const next = grid.findPath(a, target)?.[0] ?? a;
        [a.wx, a.wz, a.plan] = [next.x, next.z, w.tick];
      }
      const length = Math.sqrt((a.wx - a.x) * (a.wx - a.x) + (a.wz - a.z) * (a.wz - a.z));
      if (length > 0.05) way.set((a.wx - a.x) / length, 0, (a.wz - a.z) / length);
    }
    const found = Math.min(hash.query(a.x, a.z, SPACING, near), NEIGHBOURS);
    for (let k = 0; k < found; k++) {
      const other = w.get(near[k])?.navAgent;
      if (!other || near[k] === e.id) continue;
      const d = Math.sqrt((a.x - other.x) * (a.x - other.x) + (a.z - other.z) * (a.z - other.z));
      const push = d > 1e-6 ? (SPACING - d) / (SPACING * d) : 0; // away: 0 at SPACING, a whole unit when touching
      way.set(way.x + (a.x - other.x) * push, 0, way.z + (a.z - other.z) * push);
    }
    a.vx = way.x * speed;
    a.vz = way.z * speed;
  }
}

/** Moves each agent by its velocity, sliding along an axis where its tile has no step on (the phase `physics`). */
function move(w: W, nav: Nav): void {
  const { grid } = nav;
  for (const e of w.query('navAgent')) {
    const a = e.navAgent;
    const from = grid.cellAt(a.x, a.z);
    const x = a.x + a.vx * w.dt;
    const z = a.z + a.vz * w.dt;
    if (grid.canStep(from, grid.cellAt(x, z))) [a.x, a.z] = [x, z];
    else if (grid.canStep(from, grid.cellAt(x, a.z))) a.x = x;
    else if (grid.canStep(from, grid.cellAt(a.x, z))) a.z = z;
    a.y = floorHeight(LEVEL, a.x, a.z);
  }
}

export default defineScene<{ navAgent: Agent }>('nav-1000', {
  description:
    "1,000 agents chasing a target round the hall: the flow field toward the target's tile within reach, A* paths beyond it, neighbours from a spatial hash.",
  level: NAV_1000_LEVEL,
  setup(w) {
    const grid = new NavGrid(LEVEL);
    const [hash, near] = [new SpatialHash({ cell: 1 }), new Int32Array(32)];
    const nav: Nav = { grid, hash, near, way: new Vector3(), target: new Vector3() };
    const open = [...grid.open.keys()].filter((i) => grid.open[i]);
    const rng = w.rng('spawn');
    for (let n = w.settings.get<number>('nav1000.agents'), i = 0; i < n; i++) {
      const tile = grid.center(open[rng.int(0, open.length - 1)]);
      const [x, z] = [tile.x + rng.range(-0.3, 0.3), tile.z + rng.range(-0.3, 0.3)];
      w.spawn({ navAgent: { x, y: floorHeight(LEVEL, x, z), z, wx: x, wz: z } });
    }
    w.systems.add('steer', (w) => steer(w, nav), { phase: 'ai' });
    w.systems.add('move', (w) => move(w, nav), { phase: 'physics' });
  },
});
