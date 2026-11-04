/**
 * @file Tests for the house's plans (labs/playground/levels/plan.ts and house.ts, PLAN.md WP 13.18): a plan paints
 * rectangles in metres, later paint over earlier, and refuses a size or a rectangle off whole tiles or outside its map,
 * naming it and the fix; `levelText` writes the storeys bottom first; the house compiles to its four storeys and its
 * seventeen rooms, one for each marker, each marker inside its own room; and it draws no two surfaces facing up in one
 * plane (a ray down every 0.25 m: the floors fought the walls and heads of the storey under them, z-fighting, until
 * engine/gfx/level/meshes.ts's `STOREY_SEAM`, and the window sills the wall under them, WP 13.33).
 * @see labs/playground/levels/plan.ts
 * @see labs/playground/levels/house.ts
 */
import { MeshBasicMaterial, Raycaster, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { createLevelMeshes } from '../../../engine/gfx/level/meshes';
import { levelLooks } from '../../../engine/gfx/level/runs';
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

  it('draws no two surfaces facing up in one plane: no floor in a wall’s, a head’s or a sill’s (z-fighting)', () => {
    const level = getLevel('level:house');
    const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house'); // as the stage draws it
    const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
    meshes.root.updateMatrixWorld(true);
    const ray = new Raycaster();
    const shared: string[] = [];
    for (let x = 0.125; x < level.cols * level.tile; x += 0.25)
      for (let z = 0.125; z < level.rows * level.tile; z += 0.25) {
        ray.set(new Vector3(x, 30, z), new Vector3(0, -1, 0));
        const hits = ray.intersectObject(meshes.root, true);
        for (let i = 0; i + 1 < hits.length; i++) {
          const [a, b] = [hits[i], hits[i + 1]];
          const other = a.object !== b.object || a.instanceId !== b.instanceId; // a ray along a quad's diagonal meets both its halves
          if (other && Math.abs(a.point.y - b.point.y) < 0.002) shared.push(`${a.object.name} and ${b.object.name} at (${x}, ${a.point.y.toFixed(2)}, ${z})`); // prettier-ignore
        }
      }
    expect(shared).toEqual([]);
    meshes.dispose();
  });
});
