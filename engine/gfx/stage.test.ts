/**
 * @file Unit tests for engine/gfx/stage.ts (T1, PLAN.md WP 2.7): the stage is built in Node with no GPU; block runs
 * are split into one mesh per merged rectangle, named by their tiles, with every piece kept once; the placeable
 * component kinds are those that declare `x` and `z` in metres; stand-ins appear, move between their last two places
 * by `draw(alpha)` (the shorter way round for yaw) and leave with their entities; the warm-up registration adds the
 * stand-ins' looks to the shader key. A terrain with no level (WP 10.5) is the stage's ground: its chunks drawn and
 * registered, the stage's plane under it at its origin's height, the sun and the centre fitted to its area.
 * @see engine/gfx/stage.ts
 */
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { defineComponent } from '../sim/state';
import { compileLevel } from '../world/level/compile';
import { makeTerrain } from '../world/terrain';
import { splitRuns } from './level/runs';
import { createMaterialLibrary } from './materials/library';
import { createStage, placeableKinds, placeOf } from './stage';

const room = compileLevel(readFileSync('fixtures/levels/room.txt', 'utf8'), { file: 'room.txt' });

/** A registry with a placed kind (x, y, z, yaw in metres and radians), a flat kind (x, z), and one that is not placed. */
function kinds() {
  const registry = createRegistry();
  const m = (description: string) => ({ type: 'number', default: 0, unit: 'm', description }) as const;
  defineComponent(
    'crate',
    {
      description: 'A crate.',
      fields: { x: m('East.'), y: m('Up.'), z: m('South.'), yaw: { type: 'number', default: 0, description: 'Yaw.' } },
    },
    registry,
  );
  defineComponent('dot', { description: 'A dot.', fields: { x: m('East.'), z: m('South.') } }, registry);
  defineComponent(
    'score',
    { description: 'Points.', fields: { x: { type: 'number', default: 0, description: 'X.' } } },
    registry,
  );
  return registry;
}

describe('splitRuns', () => {
  it('splits each block into its runs, keeping every piece once, and leaves surfaces whole', () => {
    const { level, runs } = splitRuns(room);
    const walls = level.meshes.filter((mesh) => mesh.recipe === 'wall');
    expect(walls.map((mesh) => mesh.rects)).toEqual(
      room.meshes.find((m) => m.recipe === 'wall')!.rects.map((r) => [r]),
    );
    expect(walls.flatMap((mesh) => mesh.pieces).length).toBe(
      room.meshes.find((m) => m.recipe === 'wall')!.pieces.length,
    );
    expect(runs.filter(Boolean)).toHaveLength(4);
    expect(level.meshes.find((mesh) => mesh.recipe === 'floor')).toEqual(room.meshes.find((m) => m.recipe === 'floor'));
  });
});

describe('createStage', () => {
  it('names every wall run by its tiles and places stand-ins for placed kinds only', () => {
    const registry = kinds();
    expect(placeableKinds(registry)).toEqual(['crate', 'dot']);
    expect(placeOf({ id: 1, dot: { x: 2, z: 3 } }, ['crate', 'dot'])).toEqual({
      kind: 'dot',
      place: { x: 2, y: 0, z: 3, yaw: 0, size: 0.5, material: 'material:default' },
    });
    const stage = createStage({ level: room, materials: createMaterialLibrary(), registry });
    const names: string[] = [];
    stage.scene.traverse((object) => void (object.name && names.push(object.name)));
    const runs = [
      'level:room/wall@0,0-15,0',
      'level:room/wall@0,1-0,11',
      'level:room/wall@15,1-15,11',
      'level:room/wall@1,11-14,11',
    ];
    expect(names.filter((name) => name.includes('/wall'))).toEqual(runs);
    expect(stage.cutaway).toBeNull(); // no player stands on it
    expect(stage.centre).toEqual([8, 0, 6]);
    stage.capture([
      { id: 4, crate: { x: 1, y: 0, z: 1, yaw: 3 } },
      { id: 5, score: { x: 9 } },
    ]);
    expect([...stage.standIns.keys()]).toEqual([4]);
    stage.capture([{ id: 4, crate: { x: 3, y: 1, z: 1, yaw: -3 } }]);
    stage.draw(0.5);
    const mesh = stage.standIns.get(4)!;
    expect([mesh.name, mesh.position.toArray(), mesh.userData.entity]).toEqual(['crate#4', [2, 0.5, 1], 4]);
    expect(Math.abs(Math.abs(mesh.rotation.y) - Math.PI)).toBeLessThan(1e-9); // through π, not through 0
    stage.capture([]);
    expect(stage.standIns.size).toBe(0);
    stage.dispose();
  });

  it("registers the ground, the level, the stand-ins, the rides and the effects, with the stand-ins' looks in the shader key", () => {
    const registry = kinds();
    const stage = createStage({ level: room, materials: createMaterialLibrary(), registry });
    const ids: string[] = [];
    const parts = new Map<string, () => string>();
    const warmup = {
      register: (id: string) => (ids.push(id), { dispose: () => ids.splice(ids.indexOf(id), 1) }),
      keyPart: (name: string, part: () => string) => (parts.set(name, part), { dispose: () => parts.delete(name) }),
    };
    const registration = stage.register(warmup);
    expect(ids).toEqual([
      'stage:ground',
      'stage:level',
      'stage:cutaway',
      'stage:stand-ins',
      'stage:actors',
      'stage:rides',
      'fx:sprites',
      'fx:decals',
      'fx:ribbons',
    ]);
    stage.capture([{ id: 1, dot: { x: 0, z: 0 } }]);
    expect(parts.get('stage:stand-ins')!()).toBe('0.5|material:default');
    registration.dispose();
    expect([ids, parts.size]).toEqual([[], 0]);
  });

  it('stands a terrain as the ground: its chunks drawn and registered, the plane, the sun and the centre on its area', () => {
    const terrain = makeTerrain({ size: [24, 40], origin: [72, 1.5, 8], hills: [{ at: [96, 28], radius: 20, height: 8 }] }, 'hill'); // prettier-ignore
    const stage = createStage({ level: null, terrain, materials: createMaterialLibrary(), registry: kinds() });
    expect(stage.terrain?.chunks.map((lod) => lod.name)).toEqual(['terrain:hill/0,0', 'terrain:hill/0,32']);
    expect(stage.terrain!.root.parent).toBe(stage.scene);
    expect(stage.centre).toEqual([84, 0, 28]);
    const ground = stage.scene.getObjectByName('stage/ground')!;
    ground.updateMatrixWorld(true);
    const box = new Box3().setFromObject(ground);
    expect([box.min.y, box.getCenter(new Vector3()).x, box.getCenter(new Vector3()).z].map((v) => +v.toFixed(3))).toEqual([1.48, 84, 28]); // prettier-ignore
    const sun = stage.sky.own.sun;
    expect([sun.target.position.x, sun.target.position.z]).toEqual([84, 28]);
    const along = new Vector3().subVectors(sun.target.position, sun.position).normalize();
    for (const [x, z] of [
      [72, 8],
      [96, 8],
      [72, 48],
      [96, 48],
    ]) {
      const depth = new Vector3(x, 0, z).sub(sun.position).dot(along);
      expect(depth).toBeLessThan(sun.shadow.camera.far); // its shadows reach every corner
    }
    const ids: string[] = [];
    const warmup = { register: (id: string) => (ids.push(id), { dispose: () => {} }), keyPart: () => ({ dispose: () => {} }) }; // prettier-ignore
    stage.register(warmup);
    expect(ids.slice(0, 3)).toEqual(['stage:ground', 'stage:terrain', 'stage:cutaway']);
    stage.dispose();
    expect(stage.terrain!.root.parent).toBeNull();
  });
});
