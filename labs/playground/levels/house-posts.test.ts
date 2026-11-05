/**
 * @file The house's cut leaves no post (engine/gfx/level/cells.ts's blocks standing in rooms, cut whole by
 * engine/gfx/cutaway.ts; WP 13.41: in isometric the chimney's breast stood as a loose post of siding, its corner left
 * whole beside its cut sides): with the player at each of its rooms' markers, in each of isometric's four turns, no
 * piece of a wall, a partition, a counter or the chimney stands whole alone: its part's pieces beside it, two at least,
 * all cut (the end of a run that goes on whole is no post).
 * @see engine/gfx/level/cells.ts
 * @see engine/gfx/cutaway.ts
 */
import { MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { viewPose, viewState } from '../../../engine/gfx/cameras/presets';
import { createCutaway } from '../../../engine/gfx/cutaway';
import { createLevelMeshes } from '../../../engine/gfx/level/meshes';
import { levelLooks } from '../../../engine/gfx/level/runs';
import { getLevel } from '../../../engine/sim-api';
import './house';

describe('the house’s cut', () => {
  it('leaves no piece standing whole between cut ones, from any room in any turn of isometric', () => {
    const level = getLevel('level:house');
    const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house');
    const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
    const cutaway = createCutaway(meshes);
    const blocks = meshes.parts.filter((part) => part.cut && part.shape === 'block' && !part.recipe.startsWith('lining:')); // prettier-ignore
    const posts: string[] = [];
    let cut = 0;
    for (const room of level.rooms!) {
      for (const turn of [0, 90, 180, 270]) {
        const target = room.position as [number, number, number];
        cutaway.update(viewPose({ ...viewState({ view: 'iso' }), turn, target }), target);
        const cuts = cutaway.cut();
        for (const part of blocks.filter((one) => one.storey === room.storey)) {
          const gone = new Set((cuts[part.name] ?? []).map((tiles) => tiles.join()));
          const state = new Map(part.cells.map(({ tiles }) => [`${tiles[0]},${tiles[1]}`, gone.has(tiles.join())])); // each piece: cut or whole
          for (const [key, cutting] of state) {
            cut += Number(cutting);
            const [c, r] = key.split(',').map(Number);
            const beside = [`${c - 1},${r}`, `${c + 1},${r}`, `${c},${r - 1}`, `${c},${r + 1}`].map((one) => state.get(one)); // prettier-ignore
            // a post: whole, its part's pieces beside it cut, two of them at least, and none whole
            const post = !cutting && beside.filter((one) => one === true).length >= 2 && !beside.includes(false);
            if (post) posts.push(`${room.id} turn ${turn}: ${part.name.replace('level:house/', '')} [${key}]`);
          }
        }
      }
    }
    expect(cut).toBeGreaterThan(1000); // the cut ran: its walls facing the camera, and what stood in its way
    expect(posts).toEqual([]);
  });
});
