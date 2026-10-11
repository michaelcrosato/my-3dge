/**
 * @file The chase-walls fixture scene (PLAN.md WP 3.9): a walled level where a chase camera's arm meets a wall on
 * almost every frame, so its wall avoidance is proven in Node. Two rooms joined by a door, a pillar in each, and 1 m
 * corridors with bends and a dead end below; a scripted walker goes along `ROUTE` (tile centres, so 0.5 m from the
 * nearest wall: about a character's radius) and back, hugging walls, turning corners and squeezing through corridors.
 *
 * The level is a compiled level (text, below) turned into level bodies, so a scene's `QueryView` (`queryViewOf(w)`)
 * sees its walls from the first step. The walker is an entity with a `walker` component: its position (the feet, on
 * the floor) and the leg of the route it walks; the scene's step moves it `WALK_SPEED` along the route, there and back.
 *
 * Game code: it imports only engine/sim-api.ts.
 *
 * Tests: engine/gfx/cameras/chase.test.ts (the chase camera follows the walker for a round trip, turning all the way
 * round and tilting, and never ends inside a wall). Try it: `node x sim fixtures/scenes/chase-walls --steps 2400`.
 */
import {
  addLevelBodies,
  compileLevel,
  defineComponent,
  defineScene,
  physicsOf,
  type World,
} from '../../../engine/sim-api';

/** The level: rooms of 6 × 5 and 7 × 5 m with pillars, a door, and 1 m corridors below; 16 × 12 m in all. */
export const CHASE_WALLS = compileLevel(
  [
    '---',
    'description: The chase-walls fixture. Two rooms with a pillar each, a door, and 1 m corridors with bends and a dead end.',
    '---',
    '################',
    '#@.....#.......#',
    '#......#...PP..#',
    '#..PP..#...PP..#',
    '#..PP..........#',
    '#......#.......#',
    '####.#####.#####',
    '#....#.....#...#',
    '#.####.###.#.#.#',
    '#......#.....#.#',
    '#.ww...#.......#',
    '################',
  ].join('\n'),
  { file: 'chase-walls.txt' },
);

/** The walker's route, `[x, z]` in metres: tile centres, each leg along a row or a column of floor. */
export const ROUTE: readonly (readonly [number, number])[] = (
  [
    [1, 1],
    [6, 1],
    [6, 4],
    [14, 4],
    [14, 1],
    [8, 1],
    [8, 5],
    [10, 5],
    [10, 9],
    [12, 9],
    [12, 7],
    [14, 7],
    [14, 10],
    [8, 10],
  ] as const
).map(([col, row]) => [col + 0.5, row + 0.5] as const);

/** The walker's speed, m/s. */
export const WALK_SPEED = 2.5;

/** The walker: where its feet are, and the route point it heads for. */
export const WALKER = defineComponent('walker', {
  description: 'The chase-walls walker: its feet, and the route point it heads for (there and back).',
  fields: {
    x: { type: 'number', default: 0, unit: 'm', description: 'East.' },
    y: { type: 'number', default: 0, unit: 'm', description: 'Up: the floor.' },
    z: { type: 'number', default: 0, unit: 'm', description: 'South.' },
    next: { type: 'integer', default: 1, minimum: 0, description: 'The index in ROUTE it walks to.' },
    back: { type: 'boolean', default: false, description: 'Walking the route backwards.' },
  },
});

type Components = { walker: { x: number; y: number; z: number; next: number; back: boolean } };

/** Moves each walker `WALK_SPEED` along the route, turning back at either end. */
function walk(w: World<Components>): void {
  for (const e of w.query('walker')) {
    const m = e.walker;
    let left = WALK_SPEED * w.dt;
    while (left > 0) {
      const [tx, tz] = ROUTE[m.next];
      const [dx, dz] = [tx - m.x, tz - m.z];
      const gap = Math.sqrt(dx * dx + dz * dz);
      if (gap > left) {
        m.x += (dx / gap) * left;
        m.z += (dz / gap) * left;
        break;
      }
      [m.x, m.z, left] = [tx, tz, left - gap];
      if (m.next === (m.back ? 0 : ROUTE.length - 1)) m.back = !m.back;
      m.next += m.back ? -1 : 1;
    }
  }
}

export default defineScene<Components>('chase-walls', {
  description:
    'A walled level of rooms, a door and 1 m corridors; a scripted walker goes along its route and back, hugging the walls (the chase camera’s wall-avoidance fixture).',
  physics: true,
  setup(w) {
    addLevelBodies(physicsOf(w), CHASE_WALLS);
    const [x, z] = ROUTE[0];
    w.spawn({ walker: { x, y: 0, z, next: 1, back: false } });
  },
  step: walk,
});
