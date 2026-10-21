/**
 * @file Unit tests for engine/world/level/walk.ts (T1): steps sample the floor between tile centres, so bodies climb
 * stairs and a dais's edge but not a gallery's, and drop off anywhere; areas are the tiles that reach each other both
 * ways, in reading order; the hall is one area of every walkable tile.
 * @see engine/world/level/walk.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLevel } from './compile';
import { NAV_CLIMB } from './validate';
import { canStep, STEP_SAMPLES, walkAreas, walkStoreys } from './walk';

describe('canStep', () => {
  it('climbs stairs to a gallery, never its edge, and drops off it anywhere', () => {
    // Stairs 5 tiles long: 0.2 m a tile, 0.025 m a sample.
    const level = compileLevel('#####\n#=..#\n#^..#\n#^..#\n#^..#\n#^..#\n#^..#\n#...#\n#####\n');
    expect(STEP_SAMPLES).toBe(8);
    expect(canStep(level, 1, 7, 0, -1, NAV_CLIMB)).toBe(true); // onto the stairs' foot
    expect(canStep(level, 1, 2, 0, -1, NAV_CLIMB)).toBe(true); // off the top step onto the gallery
    expect(canStep(level, 2, 1, -1, 0, NAV_CLIMB)).toBe(false); // up the gallery's side: 1 m at once
    expect(canStep(level, 1, 1, 1, 0, NAV_CLIMB)).toBe(true); // down off it
    expect(canStep(level, 2, 6, -1, 0, NAV_CLIMB)).toBe(true); // onto the bottom step from beside: 0.1 m
    expect(canStep(level, 2, 4, -1, 0, NAV_CLIMB)).toBe(false); // onto a step 0.5 m up from beside
    expect(canStep(level, 1, 4, 1, 0, NAV_CLIMB)).toBe(true); // off it sideways
  });

  it('never steps from, onto or off the map, or onto a tile nobody walks on', () => {
    const level = compileLevel('###\n#.#\n###\n');
    expect([canStep(level, 1, 1, 1, 0, 9), canStep(level, 0, 1, 1, 0, 9), canStep(level, 2, 1, 1, 0, 9)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("climbs a dais's edge sample by sample: 0.5 m over 1.5 m, 0.042 m an eighth of a tile", () => {
    const level = compileLevel('#########\n#.......#\n#..ooo..#\n#..ooo..#\n#..ooo..#\n#.......#\n#########\n');
    // A 3 × 3 dais centred at (4.5, 3.5): its base 2 m out, its top 0.5 m out.
    expect([level.floor[3 * level.cols + 2], level.floor[3 * level.cols + 3]]).toEqual([0, expect.closeTo(1 / 3, 12)]);
    expect(canStep(level, 2, 3, 1, 0, 0.05)).toBe(true);
    expect(canStep(level, 2, 3, 1, 0, 0.04)).toBe(false);
    expect(canStep(level, 3, 3, -1, 0, 0)).toBe(true); // down is always fine
  });
});

describe('walkAreas', () => {
  it('groups tiles that reach each other both ways, in reading order', () => {
    const level = compileLevel('#####\n#.=.#\n#####\n');
    const { areas, areaOf } = walkAreas(level, 0.2);
    expect(areas).toEqual([
      { first: [1, 1], tiles: 1 },
      { first: [2, 1], tiles: 1 },
      { first: [3, 1], tiles: 1 },
    ]);
    expect([...areaOf.slice(5, 10)]).toEqual([-1, 0, 1, 2, -1]);
    expect(walkAreas(compileLevel('#####\n#=^.#\n#####\n'), NAV_CLIMB).areas.map((area) => area.tiles)).toEqual([3]);
  });

  it('makes the hall one area of every walkable tile: the galleries reached by their stairs', () => {
    const text = readFileSync(join(import.meta.dirname, '..', '..', '..', 'labs', 'box', 'levels', 'hall.txt'), 'utf8');
    const hall = compileLevel(text);
    const { areas } = walkAreas(hall, NAV_CLIMB);
    expect(areas).toEqual([{ first: [1, 1], tiles: hall.walkable.filter(Boolean).length }]);
    // Without its stairs, each gallery is an area of its own: dropped from, never climbed.
    const flat = compileLevel(text.replaceAll('^', '.'));
    expect(walkAreas(flat, NAV_CLIMB).areas.map((area) => [area.first, area.tiles])).toEqual([
      [[1, 1], flat.walkable.filter(Boolean).length - 160],
      [[3, 1], 80],
      [[41, 1], 80],
    ]);
  });
});

describe('walkStoreys (WP 13.13)', () => {
  /** Each storey of `maps` as a height source (1 m tiles, flat floors). */
  const sources = (...maps: string[][]) =>
    maps.map((rows) => {
      const level = compileLevel(rows.join('\n'));
      return { ...level, ramps: [], daises: [] };
    });

  it('joins storeys only through their links, walked both ways, numbering areas storey by storey', () => {
    const [low, high] = sources(['#####', '#...#', '#####'], ['#####', '#.#.#', '#####']);
    const n = 15;
    const apart = walkStoreys([low, high], [], NAV_CLIMB);
    expect(apart.areas.map((area) => [area.first, area.tiles])).toEqual([[[0, 1, 1], 3], [[1, 1, 1], 1], [[1, 3, 1], 1]]); // prettier-ignore
    const linked = walkStoreys(
      [low, high],
      [
        [6, n + 6],
        [8, n + 8],
      ],
      NAV_CLIMB,
    );
    expect(linked.areas.map((area) => [area.first, area.tiles])).toEqual([[[0, 1, 1], 5]]);
    expect([linked.areaOf[n + 6], linked.areaOf[n + 7]]).toEqual([0, -1]);
  });

  it('gives walkAreas the same areas over one storey', () => {
    const [one] = sources(['#######', '#..#..#', '#######']);
    expect(walkAreas(one, NAV_CLIMB).areas).toEqual([
      { first: [1, 1], tiles: 2 },
      { first: [4, 1], tiles: 2 },
    ]);
  });
});
