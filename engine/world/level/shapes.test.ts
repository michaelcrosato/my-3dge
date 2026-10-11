/**
 * @file Unit tests for engine/world/level/shapes.ts and the slopes of heights.ts (T1): ramps rise toward the one side
 * that meets their top, whichever it is; daises are octagons from their tiles' bounding square; the surfaces and the
 * hulls' corners, by hand; and the hall (labs/box/levels/hall.txt), whose floorHeight on the stairs and the dais
 * matches values worked out from the prototype's numbers (stairs 5 m long rising 1 m north; the dais centred at
 * (32, 22), its base 5.5 m and its top 4 m from the centre, 0.5 m up).
 * @see engine/world/level/shapes.ts
 * @see engine/world/level/heights.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileLevel } from './compile';
import { floorHeight, surfaceAt, topHeight } from './heights';
import { daisHeight, frustumPoints, octagonRadius, rampHeight, wedgePoints } from './shapes';
import type { RampDescriptor } from './types';

const HALL = compileLevel(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'labs', 'box', 'levels', 'hall.txt'), 'utf8'),
  { file: 'labs/box/levels/hall.txt' },
);

describe('ramps', () => {
  it.each([
    ['north', '#####\n#===#\n#^^^#\n#^^^#\n#...#\n#####\n', [1, 2, 3, 3]],
    ['south', '#####\n#...#\n#^^^#\n#===#\n#####\n', [1, 2, 3, 2]],
    ['west', '######\n#=^^.#\n#=^^.#\n######\n', [2, 1, 3, 2]],
    ['east', '######\n#.^^=#\n#.^^=#\n######\n', [2, 1, 3, 2]],
  ] as const)('rise toward the side their gallery is on: %s', (rises, text, tiles) => {
    const level = compileLevel(text);
    expect(level.ramps).toEqual([{ glyph: 'glyph:stairs', surface: 'stone', tiles, rises, bottom: 0, top: 1 }]);
  });

  it('slope evenly from their bottom to their top, held at both past their edges', () => {
    const ramp: RampDescriptor = { glyph: 'g', surface: 's', tiles: [2, 1, 3, 2], rises: 'east', bottom: 0.2, top: 1 };
    // Columns 2–3 of half-metre tiles: x from 1 to 2 m, rising 0.8 m eastward.
    const heights = [0.5, 1, 1.25, 1.5, 2, 3].map((x) => rampHeight(ramp, 0.5, x, 0.7));
    expect(heights).toEqual([0.2, 0.2, 0.4, 0.6, 1, 1].map((height) => expect.closeTo(height, 12)));
    expect(rampHeight({ ...ramp, rises: 'south' }, 0.5, 0, 1.25)).toBeCloseTo(0.2 + 0.8 * (0.75 / 1), 12);
  });

  it('have a hull wedge: the rectangle on the ground, raised to their top along the high side', () => {
    const [ramp] = compileLevel('######\n#=^^.#\n#=^^.#\n######\n').ramps;
    expect(wedgePoints(ramp, 1)).toEqual([
      [2, 0, 1],
      [4, 0, 1],
      [2, 0, 3],
      [4, 0, 3],
      [2, 1, 1],
      [2, 1, 3],
    ]);
    // A ramp from a raised floor stands on a step: all four corners are raised.
    expect(wedgePoints({ ...ramp, bottom: 0.25 }, 1).slice(4)).toEqual([
      [2, 1, 1],
      [4, 0.25, 1],
      [2, 1, 3],
      [4, 0.25, 3],
    ]);
  });
});

describe('daises', () => {
  it('are octagons: the radius is the distance to the nearest face, axes or diagonals', () => {
    expect([octagonRadius(3, 0), octagonRadius(0, -2), octagonRadius(3, 3)]).toEqual([3, 2, 6 * Math.SQRT1_2]);
    expect(octagonRadius(-3, 4)).toBe(7 * Math.SQRT1_2);
  });

  it("take their centre and size from their tiles' bounding square, the base half a tile outside it", () => {
    expect(HALL.daises).toEqual([
      {
        glyph: 'glyph:dais',
        surface: 'stone',
        tiles: [27, 17, 36, 26],
        center: [32, 22],
        baseRadius: 5.5,
        topRadius: 4,
        bottom: 0,
        top: 0.5,
      },
    ]);
  });

  it('slope from the base to the top, and are not there past the base', () => {
    const [dais] = HALL.daises;
    expect([daisHeight(dais, 32, 22), daisHeight(dais, 36, 22), daisHeight(dais, 37.5, 22)]).toEqual([
      0.5,
      0.5,
      -Infinity,
    ]);
    expect(daisHeight(dais, 37, 22)).toBeCloseTo(0.5 / 3, 12);
  });

  it('have a hull frustum: the base octagon on the ground and the top octagon, corners at tan(π/8) along each face', () => {
    const points = frustumPoints(HALL.daises[0]);
    const k = Math.SQRT2 - 1;
    expect(points.length).toBe(16);
    expect(points[0]).toEqual([32 + 5.5, 0, 22 + 5.5 * k]);
    expect(points[2]).toEqual([32 - 5.5 * k, 0, 22 + 5.5]);
    expect(points[8]).toEqual([32 + 4, 0.5, 22 + 4 * k]);
    // Every corner lies on its octagon: base corners at the base radius, top corners at the top radius.
    expect(points.map(([x, , z]) => octagonRadius(x - 32, z - 22))).toEqual([
      ...Array.from({ length: 8 }, () => expect.closeTo(5.5, 12)),
      ...Array.from({ length: 8 }, () => expect.closeTo(4, 12)),
    ]);
  });
});

describe('the hall, by hand', () => {
  it('has its two flights of stairs rising north to the galleries, and the dais', () => {
    expect(HALL.ramps.map((ramp) => [ramp.tiles, ramp.rises, ramp.bottom, ramp.top])).toEqual([
      [[11, 5, 13, 9], 'north', 0, 1],
      [[51, 5, 53, 9], 'north', 0, 1],
    ]);
    expect(HALL.colliders.filter((c) => c.shape === 'hull').map((c) => [c.glyph, c.tiles])).toEqual([
      ['glyph:dais', [27, 17, 36, 26]],
      ['glyph:stairs', [11, 5, 13, 9]],
      ['glyph:stairs', [51, 5, 53, 9]],
    ]);
  });

  it('answers floorHeight on the stairs: 1 m over the 5 m from z 10 up to z 5', () => {
    const probes: [number, number, number][] = [
      [12, 10, 0], // the floor at the stairs' foot
      [12, 9.5, 0.1], // (10 − 9.5) / 5
      [12, 7.5, 0.5],
      [13.999, 6, 0.8],
      [11.2, 5.25, 0.95],
      [12, 5, 1], // the top step's edge: the gallery's height
      [12, 4.5, 1], // on the gallery
      [52.5, 8, 0.4], // the east flight
      [10.5, 7.5, 0], // beside the stairs: the floor
    ];
    for (const [x, z, height] of probes) {
      expect(floorHeight(HALL, x, z), `${x}, ${z}`).toBeCloseTo(height, 12);
      expect(topHeight(HALL, x, z), `${x}, ${z}`).toBeCloseTo(height, 12);
    }
  });

  it('answers floorHeight on the dais: 0.5 m within 4 m of its centre, sloping to 0 at 5.5 m', () => {
    const probes: [number, number, number][] = [
      [32, 22, 0.5], // the centre
      [32.5, 24.5, 0.5], // the hero's spawn, on the top
      [36, 22, 0.5], // the top's east face
      [37, 22, 0.5 * (0.5 / 1.5)], // 1 m out of 5.5: a third of the way up
      [37.25, 22, 0.5 * (0.25 / 1.5)], // on the floor tile east of the dais's tiles: its base spills over
      [37.5, 22, 0], // the base's east face
      [35, 25, 0.5 * ((5.5 - 6 * Math.SQRT1_2) / 1.5)], // the south-east diagonal face, 4.243 m out
      [32, 16.75, 0.5 * (0.25 / 1.5)], // north, 5.25 m out
    ];
    for (const [x, z, height] of probes) expect(floorHeight(HALL, x, z), `${x}, ${z}`).toBeCloseTo(height, 12);
    expect(HALL.spawns.map((spawn) => [spawn.id, spawn.position])).toEqual([['spawn:hero', [32.5, 0.5, 24.5]]]);
  });

  it('samples each tile at its centre', () => {
    const at = (col: number, row: number) => row * HALL.cols + col;
    expect([HALL.floor[at(12, 9)], HALL.floor[at(12, 5)], HALL.floor[at(3, 1)]]).toEqual([0.1, 0.9, 1]);
    expect([HALL.floor[at(32, 26)], HALL.floor[at(32, 24)]]).toEqual([0.5 * (1 / 1.5), 0.5]);
    expect([HALL.top[at(61, 4)], HALL.top[at(0, 0)], HALL.bounds.max]).toEqual([0.75, 3, [64, 3.5, 44]]);
  });

  it('stands its braziers as cylinders with a torch spot 1 m up, solid within their radius only on top', () => {
    const braziers = HALL.colliders.filter((c) => c.shape === 'cylinder');
    expect([braziers.length, HALL.lights.length]).toEqual([30, 30]);
    expect(braziers[0]).toEqual({
      shape: 'cylinder',
      glyph: 'glyph:brazier',
      surface: 'iron',
      center: [61.5, 0.375, 4.5],
      radius: 0.3125,
      height: 0.75,
      tiles: [61, 4, 61, 4],
    });
    expect(HALL.lights[0]).toEqual({ tag: 'torch', glyph: 'glyph:brazier', col: 61, row: 4, position: [61.5, 1, 4.5] });
    expect([topHeight(HALL, 61.8, 4.5), topHeight(HALL, 61.9, 4.5), floorHeight(HALL, 61.5, 4.5)]).toEqual([
      0.75, 0, 0,
    ]);
    expect([surfaceAt(HALL, 61.5, 4.5), surfaceAt(HALL, 32, 22), surfaceAt(HALL, -1, 0)]).toEqual([
      'iron',
      'stone',
      '',
    ]);
  });
});
