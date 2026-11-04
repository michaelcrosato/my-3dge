/**
 * @file The block's cutaway at the house (engine/gfx/stageSite.ts on the playground's site, WP 13.33; the owner's
 * report of 2026-11-03, "you can see through walls"): the house's map holds its patio and its porch as outdoor floor,
 * and a player standing there, outside the house, cuts none of its walls or storeys in a perspective camera behind him
 * looking at him; in a classic view (isometric, top-down) the house is cut on its whole map, the storeys above him
 * and the roof off and, in isometric, its walls facing the camera; in the hall, inside, the walls facing a perspective
 * camera outside are cut as before.
 * @see engine/gfx/stageSite.ts
 */
import { MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { lookAt, makePose, type Vec3 } from '../../../engine/gfx/cameras/pose';
import { viewPose, viewState } from '../../../engine/gfx/cameras/presets';
import { createStageSite } from '../../../engine/gfx/stageSite';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { areaStart } from './site';

const materials = { get: () => new MeshBasicMaterial() };
const HOUSE = Object.keys(SITE_STRUCTURES).indexOf('house');

/** A perspective camera `dz` m from the feet along z, 1.9 m up, looking at his chest (the shooter's arm). */
const behind = ([x, y, z]: Vec3, dz: number) => {
  const position: Vec3 = [x, y + 1.9, z + dz];
  return makePose({ position, ...lookAt(position, [x, y + 1.2, z]) });
};
/** A classic view's pose (`iso`, `overhead`) on the feet, as the page's view camera frames him. */
const classic = (view: 'iso' | 'overhead', [x, y, z]: Vec3) => viewPose({ ...viewState({ view }), target: [x, y + 0.5, z] }); // prettier-ignore

describe('the block’s cutaway at the house', () => {
  it('keeps the house whole from its patio and porch behind him, cuts it in the classic views, and cuts its walls from the hall', () => {
    const drawn = createStageSite(SITE, { materials, registry }); // the levels' own recipes
    drawn.follow();
    const house = drawn.structures[HOUSE];
    const cut = () => Object.values(house.cutaway!.cut()).flat().length;
    const shown = () => house.meshes.root.children.filter((child) => child.visible).length;
    const all = shown();
    const patio: Vec3 = [52, 0, 46.5]; // between the backyard and the back door
    const porch: Vec3 = [52, 0, 61.5]; // between the path and the front door, under the porch roof
    expect([drawn.where(patio)?.indoors, drawn.where(porch)?.indoors]).toEqual([false, false]); // on the house's map
    const seen: Record<string, [number, boolean]> = {};
    for (const [name, feet, dz] of [
      ['patio', patio, -3.8],
      ['porch', porch, 3.8],
    ] as const) {
      drawn.update(behind(feet, dz), feet);
      seen[`${name}, behind`] = [cut(), shown() === all];
      for (const view of ['iso', 'overhead'] as const) {
        drawn.update(classic(view, feet), feet, { view: true });
        seen[`${name}, ${view}`] = [cut(), shown() === all];
      }
    }
    const hall = areaStart('house');
    drawn.update(behind(hall, 12), hall); // outside, south of the porch, the hall's south walls facing it
    // [whether walls are cut, whether every storey shows]: top-down looks straight down, past every wall
    expect(
      Object.fromEntries(Object.entries(seen).map(([name, [walls, whole]]) => [name, [walls > 0, whole]])),
    ).toEqual({
      'patio, behind': [false, true],
      'patio, iso': [true, false], // its walls facing the camera, to the south-east, as indoors
      'patio, overhead': [false, false],
      'porch, behind': [false, true],
      'porch, iso': [true, false],
      'porch, overhead': [false, false], // the porch roof off
    });
    expect(cut()).toBeGreaterThan(0);
    drawn.dispose();
  });
});
