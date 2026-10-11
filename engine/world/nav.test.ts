/**
 * @file Unit tests for engine/world/nav.ts (T1; PLAN.md WP 4.3's Done-when): in the hall, the flow field reaches every
 * walkable tile from the spawn and one-way ledges hold; with the hero's jump reach (the feel meter's) as the climb
 * limit, the hall's grid reaches every gallery from the spawn and a test ledge above the reach is not walkable; A*
 * goes round walls without cutting corners, its legs in clear lines, ties by index; flow fields take several goals,
 * stop at their reach, are cached and point the way; the grid rebuilds the same.
 * @see engine/world/nav.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { measureFeel } from '../sim/actors';
import { HERO } from '../../fixtures/scenes/steps/index';
import { compileLevel } from './level/compile';
import { defineGlyph } from './level/glyph';
import { NAV_CLIMB } from './level/validate';
import { NAV_DIRECTIONS, NavGrid } from './nav';

const HALL = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'), {
  file: 'hall.txt',
});
const SPAWN = HALL.spawns.find((spawn) => spawn.id === 'spawn:hero')!;
const tilesOf = (char: string) => HALL.tiles.flatMap((c, i) => (c === char ? [i] : []));

/** The tiles a body walks to from `start`, following the grid's steps forward. */
function reached(grid: NavGrid, start: number): Set<number> {
  const seen = new Set([start]);
  for (const queue = [start]; queue.length;) {
    const i = queue.shift()!;
    NAV_DIRECTIONS.forEach(([dc, dr], k) => {
      const j = i + dr * grid.cols + dc;
      if (!(grid.steps[i] & (1 << k)) || seen.has(j)) return;
      queue.push(j);
      seen.add(j);
    });
  }
  return seen;
}

const openTiles = (grid: NavGrid) => [...grid.open.keys()].filter((i) => grid.open[i]);

describe('the hall, under the crowd’s climb limit', () => {
  const grid = new NavGrid(HALL);
  const spawn = grid.cellAt(SPAWN.position[0], SPAWN.position[2]);

  it('has the flow field toward the spawn reach every walkable tile, and the spawn reach every one', () => {
    expect(grid.climb).toBe(NAV_CLIMB);
    const field = grid.flowField(spawn);
    const open = openTiles(grid);
    expect(open.length).toBe(HALL.walkable.filter(Boolean).length);
    expect(open.filter((i) => !(field.distance[i] < Infinity))).toEqual([]);
    expect(reached(grid, spawn).size).toBe(open.length);
    for (let i = 0; i < grid.open.length; i++) if (!grid.open[i]) expect(field.distance[i]).toBe(Infinity);
  });

  it('respects one-way ledges: off a gallery anywhere, onto it only by its stairs', () => {
    const edges = tilesOf('=').filter((i) => HALL.tiles[i + grid.cols] === '.');
    expect(edges.length).toBeGreaterThan(20);
    for (const i of edges) {
      expect([grid.canStep(i, i + grid.cols), grid.canStep(i + grid.cols, i)]).toEqual([true, false]);
    }
    // A goal on the gallery, from the floor right under it: round by the stairs, never up the face.
    const goal = grid.cellAt(7.5, 4.5);
    const below = goal + grid.cols;
    const field = grid.flowField(goal);
    expect(field.distance[below]).toBeGreaterThan(8);
    expect(grid.flowField(below).distance[goal]).toBe(1); // the drop is one step
    const path = grid.findPath(grid.center(below), grid.center(goal))!;
    expect(path.some((p) => HALL.tiles[grid.cellAt(p.x, p.z)] === '^' || p.y > 0)).toBe(true);
    const way = field.direction(7.5, 5.5)!;
    expect(way.z).toBeGreaterThanOrEqual(0); // not north, into the gallery's face
  });

  it('never cuts a corner: no diagonal past a pillar, a wall or a gallery’s face', () => {
    for (const i of openTiles(grid)) {
      for (let k = 4; k < 8; k++) {
        if (!(grid.steps[i] & (1 << k))) continue;
        const [dc, dr] = NAV_DIRECTIONS[k];
        expect([grid.canStep(i, i + dc), grid.canStep(i, i + dr * grid.cols)]).toEqual([true, true]);
      }
    }
  });
});

describe('the hall, under the hero’s jump reach', () => {
  let reach = 0;
  beforeAll(() => {
    reach = measureFeel(HERO).reach;
  });

  it('reaches every gallery tile from the spawn, jumping straight up', () => {
    expect(reach).toBeGreaterThan(1); // galleries stand 1 m up
    const grid = new NavGrid(HALL, { climb: reach });
    const seen = reached(grid, grid.cellAt(SPAWN.position[0], SPAWN.position[2]));
    expect(tilesOf('=').filter((i) => !seen.has(i))).toEqual([]);
    const goal = grid.cellAt(7.5, 4.5);
    expect(grid.canStep(goal + grid.cols, goal)).toBe(true);
    expect(grid.flowField(goal).distance[goal + grid.cols]).toBe(1);
  });

  it('does not walk onto a test ledge above the reach, and does onto one below it', () => {
    const registry = createRegistry();
    const ledge = (char: string, height: number) => ({
      char,
      description: `A test ledge ${height} m up.`,
      floor: height,
      top: height,
      collider: 'box' as const,
      mesh: 'gallery',
    });
    defineGlyph('glyph:low', ledge('L', Math.round((reach - 0.02) * 1000) / 1000), registry);
    defineGlyph('glyph:high', ledge('H', Math.round((reach + 0.02) * 1000) / 1000), registry);
    const level = compileLevel('#########\n#LL...HH#\n#LL...HH#\n#...@...#\n#########\n', { registry });
    const grid = new NavGrid(level, { climb: reach });
    const seen = reached(grid, grid.cellAt(4.5, 3.5));
    expect(['L', 'H'].map((c) => level.tiles.filter((t, i) => t === c && seen.has(i)).length)).toEqual([4, 0]);
    const field = grid.flowField(grid.cellAt(6.5, 1.5));
    expect([field.distanceAt(4.5, 3.5), field.distanceAt(7.5, 1.5)]).toEqual([Infinity, 1]);
  });
});

describe('A*', () => {
  const level = compileLevel('#########\n#.......#\n#.#####.#\n#...#...#\n#.......#\n#########\n');
  const grid = new NavGrid(level);

  it('goes round walls in clear legs, ending on the goal tile’s centre', () => {
    const from = { x: 1.5, z: 1.5 };
    const path = grid.findPath(from, { x: 5.5, z: 3.5 })!;
    expect(path.at(-1)!.toArray()).toEqual([5.5, 0, 3.5]);
    let [x, z] = [from.x, from.z];
    for (const p of path) {
      expect(grid.lineOfSight(x, z, p.x, p.z)).toBe(true);
      [x, z] = [p.x, p.z];
    }
    expect(path.length).toBeLessThan(6); // smoothed: far fewer waypoints than tiles
    expect(grid.findPath(from, from)!.map((p) => p.toArray())).toEqual([[1.5, 0, 1.5]]);
  });

  it('breaks ties by index, so a symmetric route always goes the same way', () => {
    // Round the block in the middle: north and south are equally long; the lower tiles win.
    const ring = compileLevel('#######\n#.....#\n#.###.#\n#.....#\n#######\n');
    const paths = [0, 1].map(() => new NavGrid(ring).findPath({ x: 1.5, z: 2.5 }, { x: 5.5, z: 2.5 }));
    expect(paths[0]).toEqual(paths[1]);
    expect(paths[0]!.every((p) => p.z <= 2.5)).toBe(true);
  });

  it('answers null with no route, and starts from the nearest open tile when on a wall', () => {
    const cut = new NavGrid(compileLevel('#######\n#..#..#\n#######\n'));
    expect(cut.findPath({ x: 1.5, z: 1.5 }, { x: 5.5, z: 1.5 })).toBeNull();
    expect(grid.nearestOpen(2.5, 2.5)).toBe(grid.cellAt(2.5, 1.5)); // on the wall: the open tile nearest it
    expect(grid.findPath({ x: 2.5, z: 2.4 }, { x: 1.5, z: 4.5 })).not.toBeNull();
    expect(grid.nearestOpen(-40, -40)).toBe(-1);
  });
});

describe('flow fields', () => {
  const grid = new NavGrid(HALL, { fields: 2 });

  it('take several goals: each tile’s distance to the nearest', () => {
    const [a, b] = [grid.cellAt(5.5, 12.5), grid.cellAt(58.5, 40.5)];
    const both = grid.flowField([b, a, b]);
    expect(both.goals).toEqual([a, b]);
    const [one, two] = [grid.flowField(a).distance, grid.flowField(b).distance];
    expect([...both.distance]).toEqual([...one].map((d, i) => Math.min(d, two[i])));
  });

  it('stop at their reach, and agree with the whole field within it', () => {
    const goal = grid.cellAt(SPAWN.position[0], SPAWN.position[2]);
    const [near, all] = [grid.flowField(goal, { reach: 12 }), grid.flowField(goal)];
    for (let i = 0; i < near.distance.length; i++) {
      expect(near.distance[i]).toBe(all.distance[i] <= 12 ? all.distance[i] : Infinity);
    }
    expect(near.direction(1.5, 42.5)).toBeNull();
  });

  it('are cached per goal set and reach, the oldest dropped first', () => {
    const [a, b, c] = [100, 200, 300].map((i) => grid.nearestOpen((i % 64) + 0.5, Math.floor(i / 64) + 0.5));
    const first = grid.flowField(a);
    expect(grid.flowField(a)).toBe(first);
    grid.flowField(b);
    expect(grid.flowField(a)).toBe(first); // used again: now the newest
    grid.flowField(c); // pushes b out
    expect(grid.flowField(a)).toBe(first);
    const again = grid.flowField(b);
    expect(again).not.toBe(first);
    expect(grid.flowField(b, { reach: 5 })).not.toBe(again);
  });

  it('point the way: following it from any open tile arrives, along legal steps only', () => {
    const goal = grid.cellAt(SPAWN.position[0], SPAWN.position[2]);
    const field = grid.flowField(goal);
    for (const start of openTiles(grid).filter((_, n) => n % 97 === 0)) {
      const p = grid.center(start);
      let cell = start;
      for (let k = 0; k < 2000 && cell !== goal; k++) {
        const way = field.direction(p.x, p.z)!;
        p.addScaledVector(way, 0.1);
        const next = grid.cellAt(p.x, p.z);
        expect(grid.canStep(cell, next), `step from ${cell} to ${next}`).toBe(true);
        cell = next;
      }
      expect(cell).toBe(goal);
    }
    expect(field.direction(SPAWN.position[0], SPAWN.position[2])).toBeNull(); // there already
  });

  it('refuse goals that are not open tiles, and a reach not above 0', () => {
    expect(() => grid.flowField(0)).toThrow(/CORE_BAD_SPEC.*goal 0 is no open tile/);
    expect(() => grid.flowField([])).toThrow(/no goal tile/);
    expect(() => grid.flowField(grid.cellAt(5.5, 12.5), { reach: 0 })).toThrow(/reach 0 is not above 0/);
  });
});

describe('the grid', () => {
  it('rebuilds the same: navigation is derived data, never saved', () => {
    const [a, b] = [new NavGrid(HALL), new NavGrid(compileLevel(HALL.map.join('\n'), { file: 'hall.txt' }))];
    expect([a.open, a.steps]).toEqual([b.open, b.steps]);
    const goal = a.cellAt(20.5, 30.5);
    expect(a.flowField(goal).distance).toEqual(b.flowField(goal).distance);
    expect(a.findPath({ x: 2.5, z: 42.5 }, { x: 60.5, z: 2.5 })).toEqual(
      b.findPath({ x: 2.5, z: 42.5 }, { x: 60.5, z: 2.5 }),
    );
  });

  it('keeps lines of sight a body’s radius off walls and off a gallery’s face, not off its top', () => {
    const level = compileLevel('########\n#......#\n#.====.#\n#......#\n########\n');
    const grid = new NavGrid(level, { radius: 0.3 });
    expect(grid.lineOfSight(1.5, 1.5, 6.5, 1.5)).toBe(true);
    expect(grid.lineOfSight(1.5, 1.85, 6.5, 1.85)).toBe(false); // within 0.3 m of the gallery's face, from below
    expect(grid.lineOfSight(2.5, 2.5, 5.5, 2.15)).toBe(true); // on top, near its edge: the drop is no wall
    expect(grid.lineOfSight(1.5, 1.2, 6.5, 1.2)).toBe(false); // within 0.3 m of the north wall
  });

  it('refuses options it cannot use, naming them', () => {
    expect(() => new NavGrid(HALL, { radius: 0.5 })).toThrow(/CORE_BAD_SPEC.*radius 0.5 m is half the 1 m tile/);
    expect(() => new NavGrid(HALL, { climb: -1 })).toThrow(/CORE_BAD_SPEC/);
  });
});
