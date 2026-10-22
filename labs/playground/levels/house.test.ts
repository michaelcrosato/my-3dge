/**
 * @file Tests for the house's plans (labs/playground/levels/plan.ts and house.ts, PLAN.md WP 13.18): a plan paints
 * rectangles in metres, later paint over earlier, and refuses a size or a rectangle off whole tiles or outside its map,
 * naming it and the fix; `levelText` writes the storeys bottom first; the house compiles to its four storeys and its
 * seventeen rooms, one for each marker, each marker inside its own room.
 * @see labs/playground/levels/plan.ts
 * @see labs/playground/levels/house.ts
 */
import { describe, expect, it } from 'vitest';
import { getLevel } from '../../../engine/sim-api';
import { HOUSE_MARKERS } from './house';
import { levelText, Plan } from './plan';

describe('a storey plan', () => {
  it('paints rectangles in metres, later paint over earlier', () => {
    const hut = new Plan(2, 1.5, 0.5).box([0, 0, 2, 1.5], '#', '.').line([0.5, 1, 1.5, 1.5], '+');
    expect([hut.map, hut.at(0.75, 0.75), hut.at(0.75, 1.25)]).toEqual(['####\n#..#\n#++#', '.', '+']);
  });

  it('refuses a size or a rectangle off whole tiles or outside its map, naming it and the fix', () => {
    expect(() => new Plan(2.1, 1, 0.5)).toThrow(/its width 2.1 m is not whole 0.5 m tiles: give metres on whole tiles/);
    expect(() => new Plan(2, 1, 0.5).fill([0, 0, 3, 1], '#')).toThrow(/\[0, 0, 3, 1\] is not inside its 2 × 1 m: give x0 ≤ x1/); // prettier-ignore
    expect(() => new Plan(2, 1, 0.5).fill([1, 0, 0.5, 1], '#')).toThrow(/is not inside/);
  });

  it('writes a level’s text: its front matter, then each storey’s keys and map, bottom first', () => {
    const plan = new Plan(1, 0.5, 0.5, '.');
    const text = levelText({ description: 'Two floors.', tile: 0.5 }, [{ keys: { storey: 'ground', base: 0, height: 2.5 }, plan }, { keys: { storey: 'upper', base: 3, height: 2.5 }, plan }]); // prettier-ignore
    expect(text.indexOf('storey: ground') < text.indexOf('storey: upper')).toBe(true);
    expect(text.startsWith('---\ndescription: Two floors.\ntile: 0.5\n---\n')).toBe(true);
  });
});

describe('the house', () => {
  it('compiles to its four storeys and seventeen rooms, a marker each, inside its own room', () => {
    const house = getLevel('level:house');
    expect(house.storeys!.map((storey) => storey.name)).toEqual(['basement', 'ground', 'upper', 'attic']);
    expect(house.rooms!.map((room) => room.name).sort()).toEqual(Object.values(HOUSE_MARKERS).sort());
    for (const room of house.rooms!) {
      const [col, row] = room.marker;
      const [c0, r0, c1, r1] = room.rect;
      expect(col >= c0 && col <= c1 && row >= r0 && row <= r1, room.name).toBe(true);
    }
  });
});
