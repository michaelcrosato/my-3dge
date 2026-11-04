/**
 * @file The block's cutaway at the house (engine/gfx/stageSite.ts on the playground's site, WP 13.33; the owner's
 * report of 2026-11-03, "you can see through walls"): the house's map holds its patio, its porch and the garage's
 * apron as outdoor floor, and a player standing there, outside the house, cuts none of its walls, in the shooter's
 * camera behind him or in isometric (nor its storeys); in the hall, inside, the walls facing a camera outside are cut
 * as before.
 * @see engine/gfx/stageSite.ts
 */
import { MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { makePose, type Vec3 } from '../../../engine/gfx/cameras/pose';
import { createStageSite } from '../../../engine/gfx/stageSite';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { areaStart } from './site';

const materials = { get: () => new MeshBasicMaterial() };
const HOUSE = Object.keys(SITE_STRUCTURES).indexOf('house');

/** A perspective camera 3.8 m from the feet along z (the shooter's arm), 1.9 m up, looking a little down. */
const behind = ([x, y, z]: Vec3, dz: number) => makePose({ position: [x, y + 1.9, z + dz], yaw: dz > 0 ? 0 : Math.PI, pitch: -0.2 }); // prettier-ignore

describe('the block’s cutaway at the house', () => {
  it('cuts nothing of the house from its patio or its porch, and its walls facing the camera from the hall', () => {
    const drawn = createStageSite(SITE, { materials, registry }); // the levels' own recipes
    drawn.follow();
    const house = drawn.structures[HOUSE];
    const cut = () => Object.values(house.cutaway!.cut()).flat().length;
    const shown = () => house.meshes.root.children.filter((child) => child.visible).length;
    const all = shown();
    const patio: Vec3 = [52, 0, 46.5]; // between the backyard and the back door
    const porch: Vec3 = [52, 0, 61.5]; // between the path and the front door
    expect([drawn.where(patio)?.indoors, drawn.where(porch)?.indoors]).toEqual([false, false]); // on the house's map
    const seen: number[] = [];
    for (const [feet, dz] of [
      [patio, -3.8],
      [porch, 3.8],
    ] as const) {
      drawn.update(behind(feet, dz), feet);
      seen.push(cut());
      drawn.update(makePose({ position: [feet[0] + 20, 24, feet[2] + 20], projection: 'orthographic', pitch: -0.6 }), feet, { view: true }); // prettier-ignore
      seen.push(shown());
    }
    const hall = areaStart('house');
    drawn.update(behind(hall, 12), hall); // outside, south of the porch, the hall's south walls facing it
    expect([seen, cut() > 0]).toEqual([[0, all, 0, all], true]);
    drawn.dispose();
  });
});
