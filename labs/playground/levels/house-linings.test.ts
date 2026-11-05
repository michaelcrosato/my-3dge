/**
 * @file The house's linings (engine/gfx/level/linings.ts, WP 13.40; the final visual review: from inside, its outer
 * walls showed their siding, so a room read as open to the outside): a ray from a room at any face of its walls that
 * opens onto it, over the kitchen's counters too (WP 13.41), meets the wall's lining, in the room's wallpaper, never
 * its siding; the wall over each window and door is papered on its room's side, a window over the counter too; and the
 * cutaway cuts each lining exactly when it cuts the wall behind it, so no papered sheet stands where a wall is cut to a stump.
 * @see engine/gfx/level/linings.ts
 * @see labs/playground/levels/house.ts
 */
import { MeshBasicMaterial, Raycaster, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { lookAt, makePose, type Vec3 } from '../../../engine/gfx/cameras/pose';
import { createCutaway } from '../../../engine/gfx/cutaway';
import { openingRooms } from '../../../engine/gfx/level/facades';
import { LINING_FACES } from '../../../engine/gfx/level/linings';
import { createLevelMeshes } from '../../../engine/gfx/level/meshes';
import { levelLooks } from '../../../engine/gfx/level/runs';
import { getLevel } from '../../../engine/sim-api';
import { storeyView } from '../../../engine/world/level/storeys';
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
      const { solid, room, top, floor } = level.storeys![part.storey!];
      for (const { tiles, centre } of part.cells) {
        const [col, row] = tiles;
        for (const { dc, dr } of LINING_FACES) {
          // the room's first open tile that way, over the kitchen's counters (0.9 m) on the way
          let [c, r, steps, over] = [col + dc, row + dr, 1, part.bottom];
          const inside = () => c >= 0 && r >= 0 && c < level.cols && r < level.rows;
          for (let i = r * level.cols + c; inside() && solid[i] && top[i] - floor[i] <= 1; i = r * level.cols + c) [c, r, steps, over] = [c + dc, r + dr, steps + 1, Math.max(over, top[i])]; // prettier-ignore
          const at = r * level.cols + c;
          if (!inside() || solid[at] || room[at] < 0 || part.top <= over) continue; // a sill wall behind a counter: unseen
          // from the room tile's middle, halfway up the face above what it looks over (a sill under a window is
          // 0.9 m), back at its face
          const origin = new Vector3(centre[0] + dc * t * steps, (over + part.top) / 2, centre[2] + dr * t * steps); // prettier-ignore
          const [hit] = new Raycaster(origin, new Vector3(-dc, 0, -dr)).intersectObject(meshes.root, true);
          aimed.push(part.name);
          if (!hit?.object.name.includes('/lining:wall')) siding.push(`${part.name} [${tiles}] from ${dc},${dr}: ${hit?.object.name}`); // prettier-ignore
        }
      }
    }
    expect(aimed.length).toBeGreaterThan(300);
    expect(siding).toEqual([]);
  });

  it('paper the wall over each window and door on its room’s side, over the kitchen’s counter too', () => {
    const { level, meshes } = house();
    const [aimed, siding] = [[] as string[], [] as string[]];
    for (const opening of level.openings!) {
      const storey = level.storeys![opening.storey];
      const view = storeyView(level, opening.storey);
      const rooms = openingRooms(view, opening);
      if (storey.fullTop - opening.top < 0.2 || rooms.filter((room) => room >= 0).length !== 1) continue; // an outer wall's, with a wall over it
      const [c0, r0, c1, r1] = opening.tiles;
      const [mx, mz] = [((c0 + c1 + 1) / 2) * level.tile, ((r0 + r1 + 1) / 2) * level.tile];
      rooms.forEach((room, k) => {
        if (room < 0) return;
        const way = (k === 0 ? -1 : 1) * 1.5; // 1.5 m into the room, over a counter, back at the wall
        const origin = opening.axis === 'x' ? new Vector3(mx, (opening.top + storey.fullTop) / 2, mz + way) : new Vector3(mx + way, (opening.top + storey.fullTop) / 2, mz); // prettier-ignore
        const [hit] = new Raycaster(origin, new Vector3(opening.axis === 'x' ? 0 : -way, 0, opening.axis === 'x' ? -way : 0).normalize()).intersectObject(meshes.root, true); // prettier-ignore
        aimed.push(`${opening.kind} [${opening.tiles}]`);
        if (!hit || /\/(wall(#\d+)?|heads:wall)$/.test(hit.object.name)) siding.push(`${opening.kind} on ${opening.storey} [${opening.tiles}] from ${k}: ${hit?.object.name}`); // prettier-ignore
      });
    }
    expect(aimed.length).toBeGreaterThan(20);
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
