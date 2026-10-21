/**
 * @file Unit tests for engine/gfx/stageSite.ts (T1; WP 13.15) on the fixture site (fixtures/levels/storeys/site.ts):
 * each structure drawn in a group at its place and turn, its level's meshes inside; the terrain with the cut left out,
 * its chunk holding the cut at its finest level only; in a classic view the storeys above the player's and the roof
 * indoors hidden in the structure the player stands in, the others whole, nothing hidden in another camera or with
 * the player outside; the cutaways made once a player stands, their twins registered with the warm-up.
 * @see engine/gfx/stageSite.ts
 */
import { MeshBasicMaterial, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { toWorld } from '../world/site';
import { makePose } from './cameras/pose';
import { createStageSite } from './stageSite';
import { createTerrainMeshes } from './terrain';

const site = defineFixtureSite(createRegistry());
const materials = { get: () => new MeshBasicMaterial() };
const [house] = site.structures;
const hall = (() => {
  const [x, z] = toWorld(house, 2, 2);
  return [x, 0, z] as const;
})();
const pose = makePose({ position: [14, 30, 30], pitch: -0.8 });

describe('a site drawn', () => {
  it('stands each structure’s meshes in a group at its place, turned as its bodies are', () => {
    const drawn = createStageSite(site, { materials });
    const [a, b] = drawn.structures;
    expect([drawn.root.name, a.group.name, b.group.name]).toEqual(['site:fixture-lot', 'site:fixture-lot/0', 'site:fixture-lot/1']); // prettier-ignore
    expect([a.group.position.toArray(), a.group.rotation.y, b.group.position.toArray(), b.group.rotation.y]).toEqual([[10, 0, 12], 0, [24, 0, 6], Math.PI / 2]); // prettier-ignore
    expect(a.meshes.root.children.every((child) => child.name.startsWith('level:fixture-house/'))).toBe(true);
    drawn.dispose();
  });

  it('leaves the cut out of the terrain, its chunk drawn at its finest level only', () => {
    const drawn = createStageSite(site, { materials });
    const whole = createTerrainMeshes(site.terrain!, { materials });
    const triangles = (mesh: Mesh) => mesh.geometry.getIndex()!.count / 3;
    expect(drawn.terrain!.meshes.length).toBe(1); // 32 × 32 cells: one chunk, held at its finest level
    expect(triangles(whole.meshes[0]) - triangles(drawn.terrain!.meshes[0])).toBe(48 * 2); // the cellar's 48 cells
    whole.dispose();
    drawn.dispose();
  });

  it('in a classic view hides what stands above the player’s storey and the roof indoors, in its structure only', () => {
    const drawn = createStageSite(site, { materials });
    const [a, b] = drawn.structures;
    const shown = (s: typeof a) => s.meshes.root.children.filter((child) => child.visible).map((child) => child.userData.storey as number); // prettier-ignore
    expect(drawn.where(hall)).toMatchObject({ structure: house, storey: 1, indoors: true });
    drawn.update(pose, hall, { view: true });
    expect([Math.max(...shown(a)), shown(b).length]).toEqual([1, b.meshes.root.children.length]);
    drawn.update(pose, hall, { view: false }); // another camera: everything whole
    expect(shown(a).length).toBe(a.meshes.root.children.length);
    drawn.update(pose, [2, 0.2, 2], { view: true }); // the player outside
    expect([drawn.where([2, 0.2, 2]), shown(a).length]).toEqual([null, a.meshes.root.children.length]);
    drawn.dispose();
  });

  it('makes each structure’s cutaway once a player stands, and registers their twins with the warm-up', () => {
    const drawn = createStageSite(site, { materials });
    const registered: string[] = [];
    const registration = drawn.register({ register: (id) => (registered.push(id), { dispose() {} }) });
    expect(drawn.structures.map((s) => s.cutaway)).toEqual([null, null]);
    drawn.follow();
    drawn.follow();
    expect(drawn.structures.every((s) => s.cutaway !== null && s.cutaway.twins.length > 0)).toBe(true);
    drawn.update(pose, hall, { fade: true, view: true });
    expect(registered).toEqual(['site:fixture-lot/0:level', 'site:fixture-lot/1:level', 'site:fixture-lot:cutaway', 'site:fixture-lot:terrain']); // prettier-ignore
    registration.dispose();
    drawn.dispose();
  });
});
