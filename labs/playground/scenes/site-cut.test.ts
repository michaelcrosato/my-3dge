/**
 * @file The block's cutaway at the house (engine/gfx/stageSite.ts on the playground's site, WP 13.33; the owner's
 * report of 2026-11-03, "you can see through walls"): the house's map holds its patio and its porch as outdoor floor,
 * and a player standing there, outside the house, cuts none of its walls or storeys in a perspective camera behind him
 * looking at him; in a classic view (isometric, top-down) the house is cut on its whole map, the storeys above him and
 * the roof off and, in isometric, its walls facing the camera; in the hall, inside, the walls facing a perspective
 * camera outside are cut as before, and just inside its front, back or garage side door, with a perspective camera
 * behind him outside, only his storey's (the upper storey's, the attic's and the basement's had been cut too, each step
 * through the door switching them, WP 13.38); and a perspective camera in the house with him, in first person or 1.5 m
 * off in his room, cuts none of it in any room (every room's walls round him were cut, the kitchen's west wall in first
 * person facing it, so he saw through the wall ahead: WP 13.38). And no terrain skirt hangs between two cut cells,
 * under the block's floors on its chunk lines, where its top lay in a floor's plane and drew a grass hairline across it
 * (the porch path's at z = 64, WP 13.37).
 * @see engine/gfx/stageSite.ts
 */
import { MeshBasicMaterial, Raycaster, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { createCamera } from '../../../engine/gfx/cameras/place';
import { lookAt, makePose, type Vec3 } from '../../../engine/gfx/cameras/pose';
import { viewPose, viewState } from '../../../engine/gfx/cameras/presets';
import { createStageSite } from '../../../engine/gfx/stageSite';
import { roomAt, toLocal } from '../../../engine/sim-api';
import { SITE, SITE_STRUCTURES } from '../levels/site';
import { areaStart, roomPlace } from './site';

const materials = { get: () => new MeshBasicMaterial() };
const HOUSE = Object.keys(SITE_STRUCTURES).indexOf('house');

/** A perspective camera `dz` m from the feet along z, 1.9 m up, looking at his chest (the shooter's arm). */
const behind = ([x, y, z]: Vec3, dz: number) => {
  const position: Vec3 = [x, y + 1.9, z + dz];
  return makePose({ position, ...lookAt(position, [x, y + 1.2, z]) });
};
/** Four ways 1.5 m off along the ground, east, west, south and north. */
const AROUND = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]] as const; // prettier-ignore
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

  it('cuts none of the house from a perspective camera in it with him: first person, or one 1.5 m off in his room', () => {
    const drawn = createStageSite(SITE, { materials, registry });
    drawn.follow();
    const house = drawn.structures[HOUSE];
    const { structure } = house;
    const cut = () => Object.values(house.cutaway!.cut()).flat().length;
    const roomOf = ([x, y, z]: Vec3) => {
      const [lx, lz] = toLocal(structure, x, z);
      return roomAt(structure.level, lx, y - structure.at[1] + 0.1, lz)?.name;
    };
    const tiles: Record<string, number> = {};
    for (const room of structure.level.rooms!) {
      const { at: feet, crouch } = roomPlace(structure, room);
      const [eye, chest] = crouch ? [1, 0.6] : [1.6, 1.2]; // ducked under the crawlspace's 1.4 m ceiling
      let cameras = 0;
      for (const [dx, dz] of AROUND) {
        const position: Vec3 = [feet[0] + dx, feet[1] + eye, feet[2] + dz];
        if (roomOf([position[0], feet[1], position[2]]) !== room.name) continue; // past a wall: not in his room
        cameras++;
        drawn.update(makePose({ position, ...lookAt(position, [feet[0], feet[1] + chest, feet[2]]) }), feet, { fade: true }); // prettier-ignore
        tiles[`${room.name}, 1.5 m off (${dx}, ${dz})`] = cut();
      }
      expect(cameras, room.name).toBeGreaterThan(0);
      for (const yaw of [0, 90, 180, -90]) {
        drawn.update(createCamera(`cam3=first,${yaw},0`).update({ follow: feet }), feet);
        tiles[`${room.name}, first person at ${yaw}°`] = cut();
      }
    }
    // In the kitchen 1.5 m from its west wall, facing it: its sill walls and its counter ahead were cut (126 tiles).
    const kitchen: Vec3 = [45.75, 0, 51.5];
    expect([drawn.where(kitchen)?.indoors, roomOf(kitchen)]).toEqual([true, 'kitchen']);
    drawn.update(createCamera('cam3=first,-90,0').update({ follow: kitchen }), kitchen);
    tiles['kitchen, first person facing its west wall'] = cut();
    expect(Object.keys(tiles).length).toBeGreaterThan(4 * structure.level.rooms!.length);
    expect(Object.entries(tiles).filter(([, n]) => n > 0)).toEqual([]);
    drawn.dispose();
  });

  it('just inside a door, with a perspective camera behind him outside, cuts walls on his storey only', () => {
    const drawn = createStageSite(SITE, { materials, registry });
    drawn.follow();
    const house = drawn.structures[HOUSE];
    const storeyOf = new Map(house.meshes.parts.map((part) => [part.name, part.mesh.userData.storey as number]));
    const off: string[] = [];
    for (const [door, feet, dz] of [
      ['front', [51.5, 0, 59.2], 3.8], // on the porch behind him
      ['back', [52, 0, 48.85], -3.8], // on the patio
      ['garage side', [63.5, 0, 50.85], -3.8],
    ] as const) {
      const pose = behind(feet, dz);
      drawn.update(pose, feet, { fade: true });
      expect([drawn.where(feet), drawn.where(pose.position)?.indoors ?? false], door).toMatchObject([{ storey: 1, indoors: true }, false]); // prettier-ignore
      const cut = Object.entries(house.cutaway!.cut()).filter(([, tiles]) => tiles.length > 0);
      expect(cut.length, door).toBeGreaterThan(0); // his storey's walls facing the camera
      // The upper storey's, the attic's and the basement's walls facing it hide nothing of him: cut, each step
      // through the door switched them between whole and stumped (the front door's: 20, 28 and 7 tiles).
      for (const [name, tiles] of cut) if (storeyOf.get(name) !== 1) off.push(`${door}: ${name}, ${tiles.length}`);
    }
    expect(off).toEqual([]);
    drawn.dispose();
  });

  it('hangs no terrain skirt between two cut cells: the porch path’s chunk line shows the path, not grass', () => {
    const drawn = createStageSite(SITE, { materials, registry });
    drawn.root.updateMatrixWorld(true);
    const { cols, rows } = SITE.terrain!;
    const cut = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && SITE.cut![r * cols + c] === 1;
    // Every upright terrain triangle (a skirt, on a chunk's edge) with a cut cell on both sides of it: 1,168 hung on
    // the block's chunk lines under its floors, their tops in the floors' plane (WP 13.37).
    const between: string[] = [];
    for (const mesh of drawn.terrain!.meshes) {
      const [position, index] = [mesh.geometry.getAttribute('position'), mesh.geometry.getIndex()!];
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, index.getX(i + k)).applyMatrix4(mesh.matrixWorld)); // prettier-ignore
        const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
        if (Math.abs(normal.y) > 1e-6) continue;
        const middle = new Vector3().add(a).add(b).add(c).divideScalar(3);
        const [x, z] = [Math.round(middle.x), Math.round(middle.z)];
        const sides = Math.abs(normal.x) > 0.5 ? [[x - 1, Math.floor(middle.z)], [x, Math.floor(middle.z)]] : [[Math.floor(middle.x), z - 1], [Math.floor(middle.x), z]]; // prettier-ignore
        if (sides.every(([sc, sr]) => cut(sc, sr))) between.push(`${mesh.name} at ${middle.toArray().map((v) => v.toFixed(1))}`); // prettier-ignore
      }
    }
    expect(between).toEqual([]);
    // From the shooter's eye at the porch, through the path's floor at its chunk line (z = 64), where the owner saw the
    // ground "look funny": the path, and no terrain within 2 m behind it.
    const eye = new Vector3(50.15, 2.256, 61.044);
    const seen: string[] = [];
    for (let x = 51.1; x < 53; x += 0.2) {
      const [first, ...behind] = new Raycaster(eye, new Vector3(x, 0, 63.9999).sub(eye).normalize()).intersectObject(drawn.root, true); // prettier-ignore
      seen.push(first.object.name, ...behind.filter((hit) => hit.distance - first.distance < 2 && hit.object.name.startsWith('terrain:')).map((hit) => hit.object.name)); // prettier-ignore
    }
    expect([...new Set(seen)]).toEqual(['level:path/floor']);
    drawn.dispose();
  });
});
