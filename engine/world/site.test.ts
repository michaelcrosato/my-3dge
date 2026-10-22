/**
 * @file Unit tests for engine/world/site.ts (T1; WP 13.15): quarter turns carry points both ways exactly and match the
 * bodies' rotation, never giving −0; a structure's footprint and box turn with it; the terrain is flattened round each footprint to
 * its height and cut under a basement, the floors on the ground and where a structure names a cut; a bad spec is
 * refused, naming each problem.
 * @see engine/world/site.ts
 */
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { EngineError } from '../core/log';
import { Quaternion, Vector3 } from '../core/math';
import { createRegistry } from '../core/registry';
import { defineLevel } from './level/level';
import { defineSite, getSite, makeSite, quarterTurn, siteProblems, toLocal, toWorld, turnVector, worldRect } from './site'; // prettier-ignore
import { defineTerrain, terrainHeight } from './terrain';

describe('quarter turns', () => {
  it('carry a point to the world and back exactly, as the bodies’ rotation turns it', () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const s = { at: [10, 2, -4] as const, turn };
      const [x, z] = toWorld(s, 1.25, 3.5);
      expect(toLocal(s, x, z)).toEqual([1.25, 3.5]);
      const [dx, dz] = turnVector(turn, 1.25, 3.5);
      expect([x - 10, z + 4]).toEqual([dx, dz]);
      const turned = new Vector3(1.25, 0, 3.5).applyQuaternion(new Quaternion(...quarterTurn(turn)));
      expect([turned.x, turned.z].map((v) => Math.round(v * 1e12) / 1e12)).toEqual([dx, dz]);
      // A direction turned is never −0, whatever comes in: state holds it (a ladder's normal), and text drops the sign.
      for (const [x0, z0] of [[0, 1], [-0, 1], [1, -0], [-0, -0]]) expect(turnVector(turn, x0, z0).map((v) => Object.is(v, -0))).toEqual([false, false]); // prettier-ignore
    }
  });

  it('turn a rectangle to its world box: east becomes north a quarter turn on', () => {
    expect(worldRect({ at: [10, 0, 4], turn: 1 }, [0, 0, 3, 1])).toEqual([10, 1, 11, 4]);
    expect(worldRect({ at: [10, 0, 4], turn: 2 }, [0, 0, 3, 1])).toEqual([7, 3, 10, 4]);
  });
});

describe('makeSite', () => {
  const site = defineFixtureSite(createRegistry());
  const [house, shed] = site.structures;

  it('places each structure: its footprint, its box and its turn', () => {
    expect([house.name, house.footprint, house.turn]).toEqual(['fixture-house', [10, 12, 18, 18], 0]);
    expect([shed.name, shed.footprint, shed.turn]).toEqual(['fixture-shed', [24, 3, 28, 6], 1]);
    expect(house.bounds.min[1]).toBeCloseTo(-3.3, 9); // the cellar's slab
    expect(house.bounds.max[0]).toBe(18.5); // the eaves
  });

  it('flattens the ground round each footprint to its height, the margin blending back', () => {
    const terrain = site.terrain!;
    for (const [x, z] of [[10, 12], [14, 15], [18, 18], [25, 4]]) expect(terrainHeight(terrain, x, z)).toBeCloseTo(0, 9); // prettier-ignore
    expect(Math.abs(terrainHeight(terrain, 2, 2)!)).toBeGreaterThan(0.01);
  });

  it('cuts the ground under the cellar and the floors on it, every cell whose centre a floored tile holds, and nowhere else', () => {
    const { cols, cell, origin } = site.terrain!;
    const cut = [...site.cut!.keys()].filter((i) => site.cut![i]);
    expect(cut.length).toBe(48 + 12); // the house's 8 × 6 m and the shed's 3 × 4 m, 1 m cells
    for (const i of cut) {
      const [x, z] = [origin[0] + ((i % cols) + 0.5) * cell, origin[2] + (Math.floor(i / cols) + 0.5) * cell];
      expect((x > 10 && x < 18 && z > 12 && z < 18) || (x > 24 && x < 28 && z > 3 && z < 6)).toBe(true);
    }
  });

  it('cuts a one-storey level’s whole map, where a structure names a rectangle, and nothing under a storey of void', () => {
    const registry = createRegistry();
    defineLevel('level:hut', { text: '#####\n#...#\n#####\n', file: 'hut.txt' }, registry);
    const deck = ['---', 'storey: posts', 'base: 0', 'height: 2', '---', '~~~', '~~~', '---', 'storey: deck', 'base: 2.3', 'height: 2', '---', '...', '...'].join('\n'); // prettier-ignore
    defineLevel('level:deck', { text: deck, file: 'deck.txt' }, registry);
    defineTerrain('terrain:field', { size: [16, 16] }, registry);
    const cells = (site: ReturnType<typeof makeSite>) => [...(site.cut?.keys() ?? [])].filter((i) => site.cut![i]).map((i) => [i % 16, Math.floor(i / 16)]); // prettier-ignore
    const hut = makeSite({ terrain: 'terrain:field', structures: [{ level: 'level:hut', at: [4, 0, 4] }] }, 'a', registry); // prettier-ignore
    expect(cells(hut).length).toBe(5 * 3); // its 5 × 3 m map, which its floor covers
    expect(makeSite({ terrain: 'terrain:field', structures: [{ level: 'level:deck', at: [4, 0, 4] }] }, 'b', registry).cut).toBeNull(); // prettier-ignore
    const well = makeSite({ terrain: 'terrain:field', structures: [{ level: 'level:deck', at: [4, 0, 4], turn: 2, cuts: [[1, 1, 3, 2]] }] }, 'c', registry); // prettier-ignore
    expect(cells(well)).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('refuses a bad spec, naming each problem, and reads a site by id without `site:`', () => {
    const bad = { structures: [{ level: 3, at: [0, 0], turn: 5, flatten: -1, cuts: [[2, 2, 1, 1]] }] } as never;
    expect(siteProblems(bad)).toEqual([
      'structures[0].level must be a level id',
      'structures[0].at must be [x, y, z] (m)',
      'structures[0].turn must be 0, 1, 2 or 3 quarter turns',
      'structures[0].flatten must be 0 or more metres',
      'structures[0].cuts must be [x0, z0, x1, z1] rectangles (x1 > x0, z1 > z0)',
    ]);
    const registry = createRegistry();
    expect(() => defineSite('site:bad', bad, registry)).toThrow(EngineError);
    defineLevel('level:hut', { text: '###\n#.#\n###\n', file: 'hut.txt' }, registry);
    defineSite('site:yard', { structures: [{ level: 'level:hut', at: [0, 0, 0] }] }, registry);
    expect([getSite('site:yard', registry).name, getSite('site:yard', registry).terrain]).toEqual(['yard', null]);
  });
});
