/**
 * @file The house's facades (engine/gfx/level/facades.ts, WP 13.40; the final visual review: in isometric, where the
 * walls facing the camera are cut to stumps, the walls over their windows and doors and their frames stood at full
 * height as loose pillars): every opening in its outer walls stands on a facade, a window over the kitchen's counter
 * too (WP 13.41: it stood on none, the counter beside it in no room); a storey the storey cut takes off stays hidden as
 * its facades are cut and drawn again (WP 13.41: its frames came back over the cut); in each of isometric's eight turns,
 * the heads, frames and facings of a facade are left out exactly when its walls are cut by facing; and while nothing is
 * cut each such part draws in one range.
 * @see engine/gfx/level/facades.ts
 */
import { MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { viewPose, viewState } from '../../../engine/gfx/cameras/presets';
import { createCutaway, planCutaway } from '../../../engine/gfx/cutaway';
import { createStoreyCut } from '../../../engine/gfx/storeyCut';
import { DOORWAY, INSIDE, openingFacade, openingRooms } from '../../../engine/gfx/level/facades';
import { LINING_FACES } from '../../../engine/gfx/level/linings';
import { createLevelMeshes } from '../../../engine/gfx/level/meshes';
import { levelLooks } from '../../../engine/gfx/level/runs';
import { getLevel } from '../../../engine/sim-api';
import { sidesOf } from '../../../engine/world/level/openings';
import { storeyView } from '../../../engine/world/level/storeys';
import './house';

/** The house's meshes as the stage draws them (its recipes and rooms), and the level. */
function house() {
  const level = getLevel('level:house');
  const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house');
  const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
  return { level, meshes };
}

/** The isometric view's turns, rad: its eight 45° steps (engine/gfx/cameras/presets.ts). */
const TURNS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);

describe('the house’s facades', () => {
  it('stand every opening in its outer walls on one, the kitchen’s windows over its counter too', () => {
    const level = getLevel('level:house');
    const outer = level.openings!.filter((opening) => {
      const view = storeyView(level, opening.storey);
      return sidesOf(opening, level.cols, level.rows).some(
        (tile) => tile && !view.solid[tile[1] * level.cols + tile[0]] && view.room![tile[1] * level.cols + tile[0]] < 0,
      ); // prettier-ignore the outdoors beside it
    });
    const inside = outer.filter((opening) => openingFacade({ ...opening, rooms: openingRooms(storeyView(level, opening.storey), opening) }) === INSIDE); // prettier-ignore
    expect(outer.length).toBeGreaterThan(20);
    expect(inside.map(({ kind, storey, tiles }) => `${kind} on ${storey} at ${tiles}`)).toEqual([]);
  });

  it('in each turn of isometric are left out exactly where their walls are cut by facing', () => {
    const { level, meshes } = house();
    const cutaway = createCutaway(meshes);
    const walls = meshes.parts.filter((part) => part.recipe === 'wall' && part.cells.length > 0);
    const facaded = meshes.parts.filter((part) => part.facades?.some(({ face }) => face >= 0));
    expect(facaded.map((part) => part.name.replace('level:house/', '')).sort()).toEqual(expect.arrayContaining(['ground/frames', 'ground/heads', 'upper/frames', 'upper/heads'])); // prettier-ignore
    for (const part of facaded) expect(part.mesh.geometry.groups, part.name).toHaveLength(1); // nothing cut: one range
    const target: [number, number, number] = [(level.cols * level.tile) / 2, 1, (level.rows * level.tile) / 2];
    for (const turn of TURNS) {
      const pose = viewPose({ ...viewState({ view: 'iso' }), turn, target });
      cutaway.update(pose, target);
      // the ways a wall faces that the camera cuts by facing alone: in isometric, the same for every wall facing so
      const plan = planCutaway([{ when: 'facing', bottom: 0, top: 3, cells: LINING_FACES.map(({ dc, dr }) => ({ centre: [0, 0, 0], size: [0.25, 0.25], out: [dc, dr] })) }], pose, target)[0]; // prettier-ignore
      const ways = new Set([...LINING_FACES.keys()].filter((face) => plan[face]));
      expect(walls.some((part) => part.cells.some(({ out }) => ways.has(LINING_FACES.findIndex(({ dc, dr }) => dc === out[0] && dr === out[1]))))).toBe(true); // prettier-ignore
      const left = cutaway.facades();
      for (const part of facaded) {
        const faces = part.facades!.filter(({ face }) => face >= 0 && face < DOORWAY).map(({ face }) => face);
        const facades = left[part.name].filter((face) => face < DOORWAY); // a doorway between rooms is cut by blocking
        expect(facades.sort(), `${part.name}, turn ${Math.round((turn * 180) / Math.PI)}°`).toEqual(faces.filter((face) => ways.has(face)).sort()); // prettier-ignore
      }
      expect(ways.size, `turn ${Math.round((turn * 180) / Math.PI)}°`).toBeGreaterThan(0);
    }
    cutaway.clear();
    for (const part of facaded) expect(part.mesh.geometry.groups, part.name).toHaveLength(1);
  });

  it('leave the storeys the storey cut takes off hidden as their facades are cut and drawn again (WP 13.41)', () => {
    const { level, meshes } = house();
    const [cutaway, storeys] = [createCutaway(meshes), createStoreyCut(meshes)];
    const target: [number, number, number] = [(level.cols * level.tile) / 2, 0, (level.rows * level.tile) / 2];
    storeys.set(1, true); // the player on the ground floor, indoors: the upper floor and the attic off
    const above = meshes.parts.filter((part) => (part.storey ?? 0) > 1);
    const shown: string[] = [];
    for (const turn of [...TURNS, 0]) {
      cutaway.update(viewPose({ ...viewState({ view: 'iso' }), turn, target }), target);
      storeys.set(1, true); // as the stage does each frame: its plan unchanged, it writes nothing
      shown.push(
        ...above
          .filter((part) => part.mesh.visible)
          .map((part) => `${part.name}, turn ${Math.round((turn * 180) / Math.PI)}°`),
      );
    }
    expect(above.some((part) => part.facades)).toBe(true);
    expect(shown).toEqual([]);
  });
});
