/**
 * @file Unit tests for levels written as storeys (T1; PLAN.md WP 13.13): engine/world/level/storeys.ts, format 2's
 * compilation in compile.ts and the 3D queries of heights.ts, on fixtures/levels/storeys/: each fixture validates
 * clean and compiles to its golden hash, again, under the sim's fdlibm swap and on a fresh registry; the house's
 * storeys stand where their blocks say, each floor slab under the floored tiles only, walls from each floor to the
 * next, heads over its doors and windows, the flights' wedges from floor to floor, the gable's two planes, walls under
 * it clipped to its underside; its rooms, openings, spawns and ground storey; `storeyView` reads any storey as a
 * format-1 level and refuses a storey it lacks; `floorBelow`, `surfaceBelow`, `storeyAt` and `roomAt` answer in 3D.
 * @see engine/world/level/storeys.ts
 * @see engine/world/level/compile.ts
 * @see engine/world/level/heights.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineStoreyFixtureGlyphs } from '../../../fixtures/levels/storeys/glyphs';
import { hashValue, type Canonical } from '../../core/hash';
import { EngineError } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { withSimMath } from '../../core/simMath';
import { compileLevel } from './compile';
import { floorBelow, floorHeight, roomAt, storeyAt, surfaceBelow, topHeight } from './heights';
import { roofHeight } from './roofs';
import { storeyView } from './storeys';
import { LEVEL_FORMAT, LEVEL_FORMAT_2, type BoxCollider, type CompiledLevel, type HullCollider } from './types';
import { validateLevel } from './validate';

const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'levels', 'storeys');
const text = (name: string) => readFileSync(join(DIR, `${name}.txt`), 'utf8');

/** A fresh registry with the fixtures' room markers. */
function rooms() {
  const registry = createRegistry();
  defineStoreyFixtureGlyphs(registry);
  return registry;
}
const REGISTRY = rooms();
const compile = (name: string, registry = REGISTRY) =>
  compileLevel(text(name), { file: `fixtures/levels/storeys/${name}.txt`, registry });
const hash = (level: CompiledLevel) => hashValue(level as unknown as Canonical);

/**
 * Each storey fixture's compiled hash: a change here is a change of the format-2 shape or of a glyph it uses.
 * Re-recorded in WP 13.14, which gave the railing and the flight recipes of their own and the bounds the eaves.
 */
const GOLDEN: Record<string, string> = {
  house: '07dfd1118ce25b2e',
  pavilion: '893392706f51530f',
  shed: 'facdd95952ad89f3',
};

const HOUSE = compile('house');
const t = HOUSE.tile;

/** The colliders of storey `k` holding `what` (a part, or a glyph id). */
const partsOf = (level: CompiledLevel, k: number, what: string) =>
  level.colliders.filter((c) => c.storey === k && (c.part ?? c.glyph) === what);

/** A collider's lowest and highest y (m). */
function span(collider: (typeof HOUSE.colliders)[number]): [number, number] {
  if (collider.shape === 'box') return [collider.min[1], collider.max[1]];
  if (collider.shape === 'hull') return [Math.min(...collider.points.map((p) => p[1])), Math.max(...collider.points.map((p) => p[1]))]; // prettier-ignore
  return [collider.center[1] - collider.height / 2, collider.center[1] + collider.height / 2];
}

describe('the storey fixtures', () => {
  it.each(Object.keys(GOLDEN))(
    '%s validates clean and compiles to its golden hash, again, under the fdlibm swap and on a fresh registry',
    (name) => {
      // prettier-ignore
      expect(validateLevel(text(name), { file: `${name}.txt`, registry: REGISTRY })).toEqual([]);
      const level = compile(name);
      expect([level.format, hash(level)]).toEqual([LEVEL_FORMAT_2, GOLDEN[name]]);
      expect(hash(compile(name))).toBe(GOLDEN[name]);
      expect(withSimMath(() => hash(compile(name)))).toBe(GOLDEN[name]);
      expect(hash(compile(name, rooms()))).toBe(GOLDEN[name]);
      expect(Object.isFrozen(level.storeys![0].floor)).toBe(true);
    },
  );
});

describe("the house's storeys (fixtures/levels/storeys/house.txt)", () => {
  it('stand where their blocks say: each base, clear height, slab and full top', () => {
    const rows = HOUSE.storeys!.map((s) => [s.name, s.index, s.base, s.height, s.slab, s.fullTop].map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))); // prettier-ignore
    expect(rows).toEqual([
      ['cellar', 0, -3, 2.7, 0.3, 0],
      ['ground', 1, 0, 2.7, 0.3, 3],
      ['upper', 2, 3, 2.7, 0.3, 6],
      ['attic', 3, 6, 1.901, 0.3, 8.101], // the gable's ridge 3 m × tan 35° over the attic's floor, less its 0.2 m slab
    ]);
    expect(HOUSE.bounds.min[1]).toBeCloseTo(-3.3, 9);
    expect(HOUSE.bounds.max[1]).toBeCloseTo(6 + 3 * Math.tan((35 * Math.PI) / 180), 9);
    expect(HOUSE.ground.max[1]).toBeCloseTo(-3.3, 9); // the ground slab is under the cellar's
  });

  it("gives the level the ground storey's grids, and every storey's colliders, spawns and lights", () => {
    const ground = HOUSE.storeys![1];
    expect([HOUSE.map, HOUSE.tiles, HOUSE.floor, HOUSE.meshes]).toEqual([ground.map, ground.tiles, ground.floor, ground.meshes]); // prettier-ignore
    expect(new Set(HOUSE.colliders.map((c) => c.storey))).toEqual(new Set([0, 1, 2, 3]));
    expect(HOUSE.spawns.map((s) => [s.id, s.storey, s.position])).toEqual([['spawn:hero', 1, [2.25, 0, 4.25]]]);
  });

  it('lays each floor slab under its floored tiles only: the stairwells over the flights stay open', () => {
    for (const s of HOUSE.storeys!) {
      const covered = new Array(HOUSE.cols * HOUSE.rows).fill(0);
      for (const slab of partsOf(HOUSE, s.index, 'slab') as BoxCollider[]) {
        expect(span(slab)).toEqual([s.base - s.slab, s.base]);
        const [c0, r0, c1, r1] = slab.tiles;
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) covered[r * HOUSE.cols + c]++;
      }
      expect(covered).toEqual(s.floored.map((yes) => (yes ? 1 : 0)));
    }
    expect(HOUSE.storeys![2].floored[5 * HOUSE.cols + 1]).toBe(false); // over the hall's flight
  });

  it("raises each storey's walls from its floor to the next storey's, and clips the attic's to the gable", () => {
    for (const k of [0, 1, 2]) {
      const s = HOUSE.storeys![k];
      for (const wall of partsOf(HOUSE, k, 'glyph:wall')) expect(span(wall)).toEqual([s.base, s.fullTop]);
    }
    const roof = HOUSE.roofs![0];
    const attic = partsOf(HOUSE, 3, 'glyph:wall') as HullCollider[];
    expect(attic.length).toBeGreaterThan(0);
    for (const wall of attic) {
      expect(wall.shape).toBe('hull');
      for (const [x, y, z] of wall.points) expect(y === 6 || Math.abs(y - (roofHeight(roof, x, z) - roof.thickness)) < 1e-9).toBe(true); // prettier-ignore
    }
  });

  it('stands a head from 2.1 m to the floor above over each door and window, and a window to its 0.9 m sill', () => {
    const heads = partsOf(HOUSE, 1, 'head').map((head) => [span(head), head.tiles]);
    expect(heads).toEqual([
      [[2.1, 3], [6, 4, 6, 5]], // prettier-ignore
      [[2.1, 3], [2, 11, 3, 11]], // prettier-ignore
      [[2.1, 3], [9, 0, 12, 0]], // prettier-ignore
    ]);
    expect(partsOf(HOUSE, 1, 'glyph:window').map(span)).toEqual([[0, 0.9]]);
  });

  it("rises each flight in a wedge from its storey's floor to the next one's, toward the floor above", () => {
    expect(HOUSE.storeys!.map((s) => s.ramps.map((ramp) => [ramp.tiles, ramp.rises, ramp.bottom, ramp.top]))).toEqual([
      [[[13, 2, 14, 9], 'north', -3, 0]],
      [[[1, 2, 2, 9], 'north', 0, 3]],
      [],
      [],
    ]);
    expect(partsOf(HOUSE, 1, 'glyph:flight').map(span)).toEqual([[0, 3]]);
    const view = storeyView(HOUSE, 1);
    expect(floorHeight(view, 1, 3)).toBeCloseTo(1.5, 9); // halfway up: z 3 between the bottom at z 5 and the top at z 1
  });

  it('roofs the attic with a gable: two planes from the eaves past the walls up to the ridge, east to west', () => {
    const [roof] = HOUSE.roofs!;
    expect([roof.kind, roof.ridge, roof.storey, roof.eave, roof.eaves, roof.footprint]).toEqual(['gable', 'x', 3, 6, 0.5, [0, 0, 8, 6]]); // prettier-ignore
    expect(roof.peak).toBeCloseTo(6 + 3 * Math.tan((35 * Math.PI) / 180), 12);
    const planes = partsOf(HOUSE, 3, 'roof');
    expect(planes.map((plane) => plane.shape)).toEqual(['hull', 'hull']);
    expect(roofHeight(roof, 4, 3)).toBeCloseTo(roof.peak, 12);
    expect(roofHeight(roof, 4, -0.5)).toBeCloseTo(6 - 0.5 * roof.slope, 12); // past the wall, over the eaves
  });

  it('finds the six rooms, and the rooms either side of each door and window', () => {
    expect(HOUSE.rooms!.map((room) => [room.id, room.storey, room.marker])).toEqual([
      ['room:cellar', 0, [1, 1]],
      ['room:hall', 1, [1, 1]],
      ['room:kitchen', 1, [7, 1]],
      ['room:bedroom', 2, [1, 1]],
      ['room:study', 2, [8, 1]],
      ['room:attic', 3, [1, 4]],
    ]);
    const name = (i: number) => (i < 0 ? 'outside' : HOUSE.rooms![i].name);
    expect(HOUSE.openings!.map((o) => [o.kind, o.axis, o.width, o.rooms.map(name).join(' | ')])).toEqual([
      ['door', 'z', 1, 'hall | kitchen'],
      ['door', 'x', 1, 'hall | outside'],
      ['window', 'x', 2, 'outside | kitchen'],
      ['door', 'z', 1, 'bedroom | study'],
      ['window', 'x', 1, 'bedroom | outside'],
      ['window', 'x', 2, 'study | outside'],
    ]);
    expect(HOUSE.storeys![1].room[1 * HOUSE.cols + 3]).toBe(1); // a hall tile
    expect(HOUSE.storeys![1].room[11 * HOUSE.cols + 2]).toBe(-1); // the front door's tile: no room
  });
});

describe('storeyView', () => {
  it('reads a storey as a format-1 level: its grids, colliders, spawns, base and full top', () => {
    const upper = storeyView(HOUSE, 2);
    expect([upper.format, upper.base, upper.fullTop, upper.map]).toEqual([LEVEL_FORMAT, 3, 6, HOUSE.storeys![2].map]);
    expect(upper.colliders.every((c) => c.storey === 2)).toBe(true);
    expect(floorHeight(upper, 4, 1)).toBe(3);
    expect(topHeight(upper, 0.25, 3)).toBe(6); // a wall rises to the attic's floor
    expect(storeyView(HOUSE, 1).spawns.map((s) => s.id)).toEqual(['spawn:hero']);
    const attic = storeyView(HOUSE, 3);
    expect(topHeight(attic, 0.25, 0.25)).toBeCloseTo(6 + 0.25 * HOUSE.roofs![0].slope - 0.2, 9); // under the gable
  });

  it('is a format-1 level itself at 0, and refuses a storey a level lacks, naming the ones it has', () => {
    const room = compileLevel('###\n#.#\n###\n', { name: 'cell' });
    expect(storeyView(room, 0)).toBe(room);
    const error = (() => {
      try {
        storeyView(HOUSE, 4);
      } catch (thrown) {
        return thrown as EngineError;
      }
    })();
    expect(error).toBeInstanceOf(EngineError);
    expect(error!.message).toBe('[LEVEL_NO_STOREY] house has 4 storeys; there is no storey 4: ask for a storey from 0 (the lowest) to 3: level.storeys lists them'); // prettier-ignore
  });
});

describe('the queries in 3D', () => {
  it("floorBelow: the highest floor, solid's top or roof at or under a point", () => {
    const at = (x: number, y: number, z: number) => floorBelow(HOUSE, x, y, z);
    expect(at(4, 1.2, 1.5 * t + 1)).toBe(0); // the kitchen floor under a point 1.2 m up
    expect(at(4, 4, 1.25)).toBe(3); // the study floor
    expect(at(4, -1, 1.25)).toBe(-3); // the cellar floor
    expect(at(1, 4, 3)).toBeCloseTo(1.5, 9); // halfway up the hall's flight, under the open stairwell
    expect(at(6.25, 0.5, 2)).toBe(0); // the kitchen's floor under the railing round the cellar's stairs
    expect(at(6.25, 1.5, 2)).toBe(1); // ... and the railing's top, 1 m up
    expect(at(4, 20, 3)).toBeCloseTo(HOUSE.roofs![0].peak, 9); // the ridge
    expect(at(4, 20, 0.25)).toBeCloseTo(6 + 0.25 * HOUSE.roofs![0].slope, 9); // the roof over the north wall
    expect(at(4, -3.3, 3)).toBeCloseTo(-3.3, 9); // the ground slab's top, under the cellar's slab
    expect(at(40, 0, 40)).toBeNull(); // off the ground slab
    expect(surfaceBelow(HOUSE, 4, 20, 3)).toBe('shingle');
    expect(surfaceBelow(HOUSE, 4, 4, 1.25)).toBe('stone');
  });

  it("storeyAt: the storey a height is in, from the underside of each storey's slab", () => {
    expect([-5, -3, -0.31, -0.3, 0, 2.69, 2.7, 5.69, 5.7, 9].map((y) => storeyAt(HOUSE, y))).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 3, 3]); // prettier-ignore
    expect(storeyAt(compileLevel('###\n#.#\n###\n'), 5)).toBe(0);
  });

  it('roomAt: the room of the storey and tile at a point', () => {
    expect([roomAt(HOUSE, 1, 0.5, 0.75)?.name, roomAt(HOUSE, 5, 3.5, 4)?.name, roomAt(HOUSE, 5, -2, 4)?.name]).toEqual(['hall', 'study', 'cellar']); // prettier-ignore
    expect([roomAt(HOUSE, 1.25, 0.5, 5.75), roomAt(HOUSE, 40, 0, 40), roomAt(compileLevel('###\n#.#\n###\n'), 1.5, 0, 1.5)]).toEqual([null, null, null]); // prettier-ignore
  });
});

describe('the pavilion and the shed', () => {
  it('stand a hip roof on the pavilion’s pillars, its eaves at their tops, and clip the pillars and the crawlspace to it', () => {
    const level = compile('pavilion');
    const [roof] = level.roofs!;
    expect([roof.kind, roof.ridge, roof.eave, roof.storey]).toEqual(['hip', 'x', 2.6, 0]);
    expect(roof.peak).toBeCloseTo(2.6 + 2.5 * Math.tan(Math.PI / 6), 12);
    expect(partsOf(level, 0, 'roof').length).toBe(4);
    expect(partsOf(level, 0, 'glyph:pillar').every((pillar) => pillar.shape === 'hull')).toBe(true);
    const [crawl] = partsOf(level, 0, 'head');
    expect(span(crawl)[0]).toBe(1.4);
    expect(floorBelow(level, 3.5, 10, 2.5)).toBeCloseTo(roof.peak, 9);
  });

  it("lays the shed's flat roof on its walls, 2.5 m up, 0.2 m thick, walked on at 2.7 m", () => {
    const level = compile('shed');
    const [roof] = level.roofs!;
    expect([roof.kind, roof.eave, roof.peak, roof.surface]).toEqual(['flat', 2.7, 2.7, 'tar']);
    expect(
      partsOf(level, 0, 'glyph:wall')
        .map(span)
        .every(([lo, hi]) => lo === 0 && hi === 2.5),
    ).toBe(true);
    expect(span(partsOf(level, 0, 'roof')[0])).toEqual([2.5, 2.7]);
    expect([floorBelow(level, 1.5, 5, 2), surfaceBelow(level, 1.5, 5, 2)]).toEqual([2.7, 'tar']);
    expect(floorBelow(level, 1.5, 1, 2)).toBe(0);
  });
});
