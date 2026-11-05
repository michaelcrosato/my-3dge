/**
 * @file The house's cut leaves no post (engine/gfx/level/cells.ts's blocks standing in rooms, cut whole by
 * engine/gfx/cutaway.ts; WP 13.41: in isometric the chimney's breast stood as a loose post of siding, its corner left
 * whole beside its cut sides): with the player at each of its rooms' markers, in each of isometric's four turns, no
 * piece of a wall, a partition, a counter or the chimney stands whole alone: its part's pieces beside it all cut (a
 * door's jamb, beside its doorway, has one; the end of a run that goes on whole is no post); nor any stub, a run of
 * whole pieces at most 2 m long with cut pieces at two ends (one stood beside the hall's doorway).
 * @see engine/gfx/level/cells.ts
 * @see engine/gfx/cutaway.ts
 */
import { MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { viewPose, viewState } from '../../../engine/gfx/cameras/presets';
import { createCutaway } from '../../../engine/gfx/cutaway';
import { cellNeighbours } from '../../../engine/gfx/level/cells';
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
    const [posts, stubs]: string[][] = [[], []];
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
            // a post: whole, its part's pieces beside it all cut (a jamb has one, beside its doorway)
            const post = !cutting && beside.includes(true) && !beside.includes(false);
            if (post) posts.push(`${room.id} turn ${turn}: ${part.name.replace('level:house/', '')} [${key}]`);
          }
          // a stub: a run of whole pieces, at most 2 m long, with its part's cut pieces at two ends or more
          const near = cellNeighbours(part.cells);
          const seen = new Set<number>();
          part.cells.forEach((cell, i) => {
            if (seen.has(i) || state.get(`${cell.tiles[0]},${cell.tiles[1]}`)) return;
            const [run, ends] = [[i], new Set<number>()];
            seen.add(i);
            for (let n = 0; n < run.length; n++) {
              for (const k of near[run[n]]) {
                if (state.get(`${part.cells[k].tiles[0]},${part.cells[k].tiles[1]}`)) ends.add(k);
                else if (!seen.has(k)) {
                  seen.add(k);
                  run.push(k);
                }
              }
            }
            if (ends.size > 1 && run.length * level.tile <= 2) stubs.push(`${room.id} turn ${turn}: ${part.name.replace('level:house/', '')} [${cell.tiles}] ${run.length}`); // prettier-ignore
          });
        }
      }
    }
    expect(cut).toBeGreaterThan(1000); // the cut ran: its walls facing the camera, and what stood in its way
    expect(posts).toEqual([]);
    expect(stubs).toEqual([]);
  });
});
