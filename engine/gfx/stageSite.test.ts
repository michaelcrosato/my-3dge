/**
 * @file Unit tests for engine/gfx/stageSite.ts (T1; WP 13.15) on the fixture site (fixtures/levels/storeys/site.ts):
 * each structure drawn in its level entry's looks, in a group at its place and turn, its level's meshes inside; the
 * terrain with the cut left out, its chunk holding the cut at its finest level only; in a classic view the storeys
 * above the player's and the roof indoors hidden in the structure the player stands in, the others whole, nothing
 * hidden in another camera or with the player outside, and what stands on a cut storey said to be hidden (`hides`, its
 * key `cutKey`); the cutaways made once a player stands, their twins registered with the warm-up; a ride faded in the
 * world's frame, when it stands between the camera and the player and never off their line.
 * @see engine/gfx/stageSite.ts
 */
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { defineFixtureSite } from '../../fixtures/levels/storeys/site';
import { createRegistry } from '../core/registry';
import { defineLevel } from '../world/level/level';
import { defineSite, getSite, toWorld } from '../world/site';
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
  it('draws each structure in its level entry’s looks: its recipes, its swaps and its rooms’ floors', () => {
    const registry = createRegistry();
    defineFixtureSite(registry);
    const shed = registry.get('level', 'level:fixture-shed') as unknown as { text: string };
    const wall = { shape: 'block', materials: ['material:siding', 'material:paint'], castShadow: true, receiveShadow: true }; // prettier-ignore
    defineLevel('level:fixture-sided', { text: shed.text, recipes: { wall } }, registry);
    defineSite('site:sided', { structures: [{ level: 'level:fixture-house', at: [0, 0, 0] }, { level: 'level:fixture-sided', at: [20, 0, 0] }] }, registry); // prettier-ignore
    const named = { get: (id: string) => Object.assign(new MeshBasicMaterial(), { name: id }) };
    const drawn = createStageSite(getSite('site:sided', registry), { materials: named, registry });
    const used = (s: (typeof drawn.structures)[number]) => s.meshes.root.children.flatMap((child) => [(child as Mesh).material].flat().map((m) => (m as MeshBasicMaterial).name)); // prettier-ignore
    expect(used(drawn.structures[1])).toContain('material:siding');
    expect(used(drawn.structures[0])).not.toContain('material:siding'); // the house keeps the engine's walls
    drawn.dispose();
  });

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
    expect(triangles(whole.meshes[0]) - triangles(drawn.terrain!.meshes[0])).toBe((48 + 12) * 2); // the house's 48 cells and the shed's 12
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

  it('says what stands on a storey the cut took off: above the player’s, in his structure, while it is cut', () => {
    const drawn = createStageSite(site, { materials });
    const above = [hall[0], 3.5, hall[2]] as const; // the upper floor over the hall
    const [x, z] = toWorld(site.structures[1], 1, 1); // in the shed, at the hall's floor height
    drawn.update(pose, hall, { view: true });
    const cut = [drawn.hides(...above), drawn.hides(...hall), drawn.hides(x, 0.5, z), drawn.cutKey()];
    drawn.update(pose, hall, { view: false }); // another camera: nothing cut
    expect([...cut, drawn.hides(...above), drawn.cutKey()]).toEqual([true, false, false, '0:1', false, '']);
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

  it('fades a ride in the world’s frame: one between the camera and the player, never one off their line', () => {
    const drawn = createStageSite(site, { materials });
    const ride = Object.assign(new Mesh(new BoxGeometry(1, 3, 1), new MeshBasicMaterial()), { name: 'ride' });
    ride.position.set(6, 1.5, 22); // in the yard, 4 m west of the house, whose own frame starts at (10, 12)
    ride.updateMatrixWorld(true);
    drawn.follow(() => [ride]);
    drawn.update(makePose({ position: [6, 1.6, 27] }), [6, 0, 17], { fade: true }); // the ride between them
    expect(ride.visible).toBe(false);
    drawn.update(makePose({ position: [16, 1.6, 36.5] }), [16, 0, 31.5], { fade: true }); // 10 m east of it
    expect(ride.visible).toBe(true); // in the house's frame that line runs through it: never read there
    drawn.dispose();
  });
});
