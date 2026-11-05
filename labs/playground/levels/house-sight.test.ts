/**
 * @file The player in sight in the house's classic view (engine/gfx/cutaway.ts and engine/gfx/storeyCut.ts on the
 * house, WP 13.41: in isometric a doorway between two rooms, its lintel, frame and the partition beside it, stood whole
 * between the camera and the player and hid all but his head): with the player at each room's marker, in each of
 * isometric's four turns, the storey cut and the cutaway as the stage runs them, the lines from the camera to his head
 * and his chest meet nothing the house draws.
 * @see engine/gfx/cutaway.ts
 * @see labs/playground/levels/house.ts
 */
import { MeshBasicMaterial, Raycaster, Vector3, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../../../engine/core/registry';
import { poseForward } from '../../../engine/gfx/cameras/pose';
import { viewPose, viewState } from '../../../engine/gfx/cameras/presets';
import { createCutaway, CUT_FACING } from '../../../engine/gfx/cutaway';
import { cellNeighbours } from '../../../engine/gfx/level/cells';
import { createLevelMeshes } from '../../../engine/gfx/level/meshes';
import { levelLooks } from '../../../engine/gfx/level/runs';
import { createStoreyCut, cutPlace } from '../../../engine/gfx/storeyCut';
import { getLevel } from '../../../engine/sim-api';
import type { CompiledLevel, RoomDescriptor } from '../../../engine/world/level/types';
import './house';

/** Whether `object` is drawn: it and every parent visible. */
const drawn = (object: Object3D | null): boolean => !object || (object.visible && drawn(object.parent));

/** `room`'s middle where it is its floor, else its marker: where a player stands, not a corner. */
function middleOf(level: CompiledLevel, room: RoomDescriptor): [number, number, number] {
  const [c0, r0, c1, r1] = room.rect;
  const [col, row] = [Math.floor((c0 + c1) / 2), Math.floor((r0 + r1) / 2)];
  const middle = level.storeys![room.storey].room[row * level.cols + col] === level.rooms!.indexOf(room);
  return middle ? [(col + 0.5) * level.tile, room.position[1], (row + 0.5) * level.tile] : [...room.position] as [number, number, number]; // prettier-ignore
}

describe('the player in the house’s classic view', () => {
  it('is in sight from every room in every turn of isometric: nothing drawn on the lines to his head and chest', () => {
    const level = getLevel('level:house');
    const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house');
    const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
    const [cutaway, storeys] = [createCutaway(meshes), createStoreyCut(meshes)];
    const hidden: string[] = [];
    let lines = 0;
    for (const room of level.rooms!) {
      for (const turn of [0, 90, 180, 270]) {
        const target = middleOf(level, room);
        const pose = viewPose({ ...viewState({ view: 'iso' }), turn, target });
        const place = cutPlace(level, target[0], target[1], target[2]);
        storeys.set(place.storey, place.indoors, place.low); // as the stage: the storeys above his off, then the cut
        cutaway.update(pose, target);
        meshes.root.updateMatrixWorld(true);
        const forward = new Vector3(...poseForward(pose));
        for (const height of [1.5, 1]) {
          const aim = new Vector3(target[0], target[1] + height, target[2]);
          const from = aim.clone().addScaledVector(forward, -60); // an orthographic camera looks from its plane
          const hits = new Raycaster(from, forward, 0, 60 - 0.3).intersectObject(meshes.root, true);
          const hit = hits.find((one) => drawn(one.object));
          lines += 1;
          const part = meshes.parts.find((one) => one.mesh === hit?.object);
          const range = part?.facades?.find(({ start, count }) => hit!.faceIndex! * 3 >= start && hit!.faceIndex! * 3 < start + count); // prettier-ignore
          const which = range
            ? ` range ${range.face}`
            : hit?.instanceId !== undefined
              ? ` piece ${hit.instanceId}`
              : '';
          if (hit) hidden.push(`${room.id} turn ${turn}, ${height} m: ${hit.object.name}${which} at ${hit.point.toArray().map((v) => v.toFixed(2))}`); // prettier-ignore
        }
      }
    }
    expect(lines).toBeGreaterThan(100);
    expect(hidden).toEqual([]);
  });

  it('cuts no piece beyond the player, from every room in every turn of isometric: none behind him opens his room', () => {
    const level = getLevel('level:house');
    const { levelRecipes: recipes, levelRooms: rooms } = levelLooks(registry, 'level:house');
    const meshes = createLevelMeshes(level, { materials: { get: () => new MeshBasicMaterial() }, recipes, rooms });
    const cutaway = createCutaway(meshes);
    const blocks = meshes.parts.filter((part) => part.cut && part.shape === 'block' && !part.recipe.startsWith('lining:')); // prettier-ignore
    const beyond: string[] = [];
    for (const room of level.rooms!) {
      for (const turn of [0, 90, 180, 270]) {
        const target = middleOf(level, room);
        const pose = viewPose({ ...viewState({ view: 'iso' }), turn, target });
        cutaway.update(pose, target);
        const [fx, , fz] = poseForward(pose);
        const depth = (x: number, z: number) => (x - target[0]) * fx + (z - target[2]) * fz; // along the view, from him
        const facingOut = ({ out }: { out: readonly number[] }) => -(out[0] * fx + out[1] * fz) / Math.hypot(fx, fz) > CUT_FACING; // prettier-ignore
        const cuts = cutaway.cut();
        for (const part of blocks.filter((one) => one.storey === room.storey)) {
          const gone = new Set((cuts[part.name] ?? []).map((tiles) => tiles.join()));
          const near = cellNeighbours(part.cells);
          for (const [i, { tiles, centre, out }] of part.cells.entries()) {
            const facing = facingOut({ out }); // the facing rule's
            const settled =
              near[i].length > 0 &&
              near[i].every((j) => gone.has(part.cells[j].tiles.join())) &&
              near[i].some((j) => facingOut(part.cells[j])); // prettier-ignore a lone piece on a cut line facing the camera, gone with it
            if (gone.has(tiles.join()) && !facing && !settled && depth(centre[0], centre[2]) > 1) beyond.push(`${room.id} turn ${turn}: ${part.name.replace('level:house/', '')} [${tiles}]`); // prettier-ignore
          }
        }
      }
    }
    expect(beyond).toEqual([]);
  });
});
