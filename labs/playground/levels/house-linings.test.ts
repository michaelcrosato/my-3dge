/**
 * @file The house's linings (engine/gfx/level/linings.ts, WP 13.40; the final visual review: from inside, its outer
 * walls showed their siding, so a room read as open to the outside): a ray from a room at any face of its walls that
 * opens onto it meets the wall's lining, in the room's wallpaper, never its siding; and the cutaway cuts each lining
 * exactly when it cuts the wall behind it, so no papered sheet stands where a wall is cut to a stump.
 * @see engine/gfx/level/linings.ts
 * @see labs/playground/levels/house.ts
 */
import { MeshBasicMaterial, Raycaster, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { lookAt, makePose, type Vec3 } from '../../../engine/gfx/cameras/pose';
import { createCutaway } from '../../../engine/gfx/cutaway';
import { LINING_FACES } from '../../../engine/gfx/level/linings';
import { createLevelMeshes } from '../../../engine/gfx/level/meshes';
import { levelLooks } from '../../../engine/gfx/level/runs';
import { getLevel } from '../../../engine/sim-api';
import './house';

/** The house's meshes as the stage draws them (its recipes and rooms), placed, and the level. */
function house() {
  const level = getLevel('level:house');
  const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house');
  const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
  meshes.root.updateMatrixWorld(true);
  return { level, meshes };
}

describe('the house’s linings', () => {
  it('meet a ray from the room at every face of its outer walls toward it, never the siding', () => {
    const { level, meshes } = house();
    const t = level.tile;
    const [aimed, siding] = [[] as string[], [] as string[]];
    for (const part of meshes.parts.filter((one) => one.recipe === 'wall' && one.cells.length > 0)) {
      const { solid, room } = level.storeys![part.storey!];
      for (const { tiles, centre } of part.cells) {
        const [col, row] = tiles;
        for (const { dc, dr } of LINING_FACES) {
          const [c, r] = [col + dc, row + dr];
          const at = r * level.cols + c;
          if (c < 0 || r < 0 || c >= level.cols || r >= level.rows || solid[at] || room[at] < 0) continue;
          // from the room tile's middle, half the wall's height up (a sill under a window is 0.9 m), back at its face
          const origin = new Vector3(centre[0] + dc * t, centre[1] + (part.top - part.bottom) / 2, centre[2] + dr * t);
          const [hit] = new Raycaster(origin, new Vector3(-dc, 0, -dr)).intersectObject(meshes.root, true);
          aimed.push(part.name);
          if (!hit?.object.name.includes('/lining:wall')) siding.push(`${part.name} [${tiles}] from ${dc},${dr}: ${hit?.object.name}`); // prettier-ignore
        }
      }
    }
    expect(aimed.length).toBeGreaterThan(300);
    expect(siding).toEqual([]);
  });

  it('are cut exactly when the walls behind them are, from a camera outside and in a classic view', () => {
    const { level, meshes } = house();
    const cutaway = createCutaway(meshes);
    const [cx, cz] = [(level.cols * level.tile) / 2, (level.rows * level.tile) / 2];
    const poses = ([[cx, 8, -40], [cx + 30, 25, cz + 30], [cx - 25, 4, cz]] as Vec3[]).map((position) => makePose({ position, ...lookAt(position, [cx, 1.5, cz]) })); // prettier-ignore
    let cut = 0;
    for (const pose of poses) {
      cutaway.update(pose, [cx, 1.5, cz]);
      const cuts = cutaway.cut();
      const key = (storey: number | undefined, tiles: readonly number[]) => `${storey}:${tiles.join(',')}`;
      const walls = new Set(meshes.parts.filter((part) => part.recipe === 'wall').flatMap((part) => (cuts[part.name] ?? []).map((tiles) => key(part.storey, tiles)))); // prettier-ignore
      for (const part of meshes.parts.filter((one) => one.recipe.startsWith('lining:'))) {
        const lined = new Set((cuts[part.name] ?? []).map((tiles) => key(part.storey, tiles)));
        for (const { tiles } of part.cells) expect(lined.has(key(part.storey, tiles)), `${part.name} [${tiles}]`).toBe(walls.has(key(part.storey, tiles))); // prettier-ignore
        cut += lined.size;
      }
    }
    expect(cut).toBeGreaterThan(0); // some linings were cut, with their walls
    cutaway.dispose?.();
  });
});
