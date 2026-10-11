/**
 * @file The box room, Box 1 (PLAN.md §9.0, WP 2.7): the level `level:room` (labs/box/levels/room.txt: 16 × 12 m,
 * walls, one low wall, a pillar, spawn markers) with three scripted movers, crates on fixed paths with no physics yet,
 * so that stepping changes state. Mover 1 runs back and forth from marker 1 along the low wall's north side, mover 2
 * circles south of the low wall from marker 2 (with `Math.sin` and `Math.cos`, so the fdlibm swap is exercised), and
 * mover 3 goes round the pillar from marker 3. Each step a mover goes `box.room.speed` × dt further along its path
 * and faces the way it goes; a mover that finishes a lap emits `lap`.
 *
 * The page draws each mover as a crate where its `pathMover` component says (x, y, z, yaw, size, material): the
 * engine's stand-in for entities that declare a place (engine/gfx/stage.ts), until actors and props draw themselves.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts, so `x sim` runs it in Node. The level's text is registered
 * by whoever draws it (the page, labs/box/main.ts; a Node test reads the file), since the sim of Box 1 never reads it.
 *
 * Tests: tests/replays/box-1-*.replay.json (`node x replay tests/replays/box-1-*.replay.json --browser page`),
 * tests/e2e/box.spec.ts.
 *
 * @example
 * // node x sim labs/box/scenes/room --steps 600
 * // node x sim labs/box/scenes/room --set box.room.speed=3
 * ROOM_PATHS.length; // 3: one path per mover
 */
import { defineComponent, defineScene, defineSettings, type World } from '../../../engine/sim-api';

/** The room's settings. */
export const ROOM_SETTINGS = defineSettings({
  'box.room.movers': {
    type: 'integer',
    default: 3,
    minimum: 0,
    maximum: 3,
    when: 'scene',
    description: 'How many of the three movers run, from mover 1.',
  },
  'box.room.speed': {
    type: 'number',
    default: 1.5,
    minimum: 0,
    maximum: 10,
    unit: 'm/s',
    description: 'How fast the movers go along their paths.',
  },
});

/** A mover's component: where it stands (its feet), which way it faces, how far along its path it is, how it looks. */
export const MOVER = defineComponent('pathMover', {
  description: 'A scripted mover of the box room: its place, facing, distance along its path, and its crate.',
  fields: {
    x: { type: 'number', default: 0, unit: 'm', description: 'East: the middle of its footprint.' },
    y: { type: 'number', default: 0, unit: 'm', description: 'Up: the bottom of the crate.' },
    z: { type: 'number', default: 0, unit: 'm', description: 'South: the middle of its footprint.' },
    yaw: { type: 'number', default: 0, unit: 'rad', description: 'The heading it faces: forward is (sin, cos).' },
    path: { type: 'integer', default: 0, minimum: 0, description: 'Its path in ROOM_PATHS.' },
    s: { type: 'number', default: 0, unit: 'm', description: 'How far along its path it has gone.' },
    laps: { type: 'integer', default: 0, minimum: 0, description: 'Whole laps of its path.' },
    size: { type: 'number', default: 0.8, unit: 'm', description: 'The side of its crate.' },
    material: { type: 'string', default: 'material:planks', description: 'The material its crate is drawn with.' },
  },
});

/** The room's components, typed. */
type Room = {
  pathMover: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    path: number;
    s: number;
    laps: number;
    size: number;
    material: string;
  };
};
/** The room's events. */
type RoomEvents = { lap: { id: number; laps: number } };
type W = World<Room, RoomEvents>;

/** A point on the floor, [x, z] in metres. */
type Point = readonly [number, number];

/** A fixed path: back and forth on a line, round a closed polygon, or round a circle from an angle. */
type RoomPath =
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'loop'; points: readonly Point[] }
  | { kind: 'circle'; centre: Point; radius: number; start: number };

/** The movers' paths, in mover order, in the level's metres (x east, z south; a tile is 1 m). Each starts at a marker. */
export const ROOM_PATHS: readonly RoomPath[] = [
  // Marker 1 (3.5, 4.5): east along the low wall's north side to the pillar, and back.
  { kind: 'line', from: [3.5, 4.5], to: [9.5, 4.5] },
  // Marker 2 (6.5, 7.5): round a circle south of the low wall, from its northern point.
  { kind: 'circle', centre: [6.5, 9], radius: 1.5, start: Math.PI },
  // Marker 3 (10.5, 5.5): round the pillar, east along its south side first.
  {
    kind: 'loop',
    points: [
      [10.5, 5.5],
      [14.5, 5.5],
      [14.5, 1.5],
      [10.5, 1.5],
    ],
  },
];

/** How long a path's lap is, m: a line there and back, a loop's perimeter, a circle's circumference. */
export function lapLength(path: RoomPath): number {
  if (path.kind === 'line') return 2 * Math.hypot(path.to[0] - path.from[0], path.to[1] - path.from[1]);
  if (path.kind === 'circle') return 2 * Math.PI * path.radius;
  return path.points.reduce((sum, p, i) => {
    const q = path.points[(i + 1) % path.points.length];
    return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
  }, 0);
}

/** Where a mover `s` metres along `path` stands, and the heading it faces: `[x, z, yaw]`. */
export function pathPoint(path: RoomPath, s: number): [number, number, number] {
  const lap = lapLength(path);
  const u = s - Math.floor(s / lap) * lap;
  if (path.kind === 'circle') {
    const a = path.start + u / path.radius;
    // At angle a it stands at (sin a, cos a) round the centre and goes toward +a: the tangent is (cos a, −sin a).
    return [path.centre[0] + path.radius * Math.sin(a), path.centre[1] + path.radius * Math.cos(a), a + Math.PI / 2];
  }
  const points = path.kind === 'line' ? [path.from, path.to] : path.points;
  let left = u;
  for (let i = 0; i < points.length; i++) {
    const [p, q] = [points[i], points[(i + 1) % points.length]];
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (left <= length || i === points.length - 1) {
      const k = length > 0 ? Math.min(1, left / length) : 0;
      return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, Math.atan2(q[0] - p[0], q[1] - p[1])];
    }
    left -= length;
  }
  return [points[0][0], points[0][1], 0];
}

/** Moves every mover along its path; a mover that finishes a lap emits `lap`. */
function move(w: W): void {
  const speed = w.settings.get<number>('box.room.speed');
  for (const e of w.query('pathMover')) {
    const m = e.pathMover;
    const path = ROOM_PATHS[m.path];
    const lap = lapLength(path);
    const before = Math.floor(m.s / lap);
    m.s += speed * w.dt;
    [m.x, m.z, m.yaw] = pathPoint(path, m.s);
    if (Math.floor(m.s / lap) > before) {
      m.laps++;
      w.emit('lap', { id: e.id, laps: m.laps });
    }
  }
}

/** The box room. */
export const room = defineScene<Room, RoomEvents>('box:room', {
  description:
    'Box 1: the room (16 × 12 m: walls, a low wall, a pillar) with three crates on fixed paths, no physics yet.',
  level: 'level:room',
  setup(w) {
    const count = w.settings.get<number>('box.room.movers');
    for (let path = 0; path < count; path++) {
      const [x, z, yaw] = pathPoint(ROOM_PATHS[path], 0);
      w.spawn({ pathMover: { x, z, yaw, path } });
    }
    w.systems.add('move', move, { phase: 'physics' });
  },
});

export default room;
