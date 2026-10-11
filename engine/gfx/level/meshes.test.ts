/**
 * @file Unit tests for the level meshes (engine/gfx/level/meshes.ts, recipes.ts, surface.ts, cells.ts), in Node on the
 * fixture levels (fixtures/levels/*.txt): the room's meshes, their vertex counts, instances and bounds computed by
 * hand; every mesh clean by the QA measures and inside the level's bounds; the floor welded with no T-junctions; the
 * draw-call count (7, and 13 with one shadow map: within the budget of 20); the cells' outward directions; the
 * materials taken from the library by the recipes' ids; a glyph whose recipe nobody defined drawn as grey blocks
 * with advice, or by the recipe a game passes; the warm-up registration; and `dispose`. The GPU half (the draw calls
 * r182 counts, 0 pipelines after the warm-up, every mesh in the ID pass) is tests/e2e/level-meshes.spec.ts.
 * @see engine/gfx/level/meshes.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Scene,
  Vector3,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createLog } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { compileLevel } from '../../world/level/compile';
import { defineGlyph } from '../../world/level/glyph';
import type { CompiledLevel } from '../../world/level/types';
import { inspectGeometry } from '../geometry/inspect';
import { createMaterialLibrary } from '../materials/library';
import type { Warmup } from '../warmup';
import { createLevelMeshes, type LevelMeshes } from './meshes';
import { LEVEL_RECIPES } from './recipes';

const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'levels');
const fixture = (name: string) =>
  compileLevel(readFileSync(join(DIR, `${name}.txt`), 'utf8'), { file: `fixtures/levels/${name}.txt` });

/** Materials by id, each a plain material named by its id, made once. */
function materials() {
  const made = new Map<string, Material>();
  return {
    made,
    get(id: string) {
      if (!made.has(id)) made.set(id, Object.assign(new MeshBasicMaterial(), { name: id }));
      return made.get(id)!;
    },
  };
}

/** The level's meshes with stand-in materials. */
const build = (level: CompiledLevel) => createLevelMeshes(level, { materials: materials() });

/** The translations of an instanced mesh's instances. */
function instances(mesh: InstancedMesh): number[][] {
  const matrix = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix).toArray();
  });
}

/** What a mesh is: instanced or plain. */
const kind = (mesh: Object3D) => ((mesh as InstancedMesh).isInstancedMesh ? 'instanced' : 'mesh');

/** The world bounds of everything under `root`. */
const bounds = (root: Object3D) => {
  const box = new Box3().setFromObject(root, true);
  return [box.min.toArray(), box.max.toArray()];
};

describe('createLevelMeshes on the room fixture', () => {
  const level = fixture('room');
  const meshes = build(level);

  it('builds one mesh per descriptor: a welded floor, and instanced walls, low walls and pillar', () => {
    expect(meshes.root.name).toBe('level:room');
    expect(meshes.parts.map((part) => [part.name, kind(part.mesh), part.glyphs.length])).toEqual([
      ['level:room/floor', 'mesh', 5],
      ['level:room/lowWall', 'instanced', 1],
      ['level:room/pillar', 'instanced', 1],
      ['level:room/wall', 'instanced', 1],
    ]);
    const [floor, lowWall, pillar, wall] = meshes.parts.map((part) => part.mesh);
    // The floor: 14 × 10 inside the walls, less 6 low-wall and 4 pillar tiles, is 130 tiles; their corners are the
    // 15 × 11 inside corners less the one under the pillar's middle, so 164 vertices and 260 triangles.
    expect([inspectGeometry(floor.geometry).vertices, inspectGeometry(floor.geometry).triangles]).toEqual([164, 260]);
    expect(floor.userData).toEqual({
      level: 'room',
      recipe: 'floor',
      glyphs: ['glyph:floor', 'glyph:hero', 'glyph:marker1', 'glyph:marker2', 'glyph:marker3'],
    });
    // Walls: the 16 + 16 + 10 + 10 border tiles, 1 × 3 × 1 m boxes standing on the ground at the tiles' centres.
    expect((wall as InstancedMesh).count).toBe(52);
    expect(instances(wall as InstancedMesh).slice(0, 3)).toEqual([
      [0.5, 0, 0.5],
      [1.5, 0, 0.5],
      [2.5, 0, 0.5],
    ]);
    expect(inspectGeometry(wall.geometry)).toMatchObject({ vertices: 24, min: [-0.5, 0, -0.5], max: [0.5, 3, 0.5] });
    expect(wall.geometry.groups.map((group) => group.count)).toEqual([24, 12]);
    expect((lowWall as InstancedMesh).count).toBe(6);
    expect(instances(lowWall as InstancedMesh)[0]).toEqual([4.5, 0, 6.5]);
    expect(inspectGeometry(lowWall.geometry).max).toEqual([0.5, 0.75, 0.5]);
    // The pillar: one 2 × 2-tile piece, a 2 × 3.5 × 2 m box at the middle of columns 11–12 and rows 3–4.
    expect(instances(pillar as InstancedMesh)).toEqual([[12, 0, 4]]);
    expect(inspectGeometry(pillar.geometry)).toMatchObject({ min: [-1, 0, -1], max: [1, 3.5, 1] });
  });

  it('draws in 7 calls, 13 with one shadow map: within the budget of 20', () => {
    expect(meshes.drawCalls()).toBe(7);
    expect(meshes.drawCalls(1)).toBe(13);
    expect(meshes.drawCalls(1)).toBeLessThanOrEqual(20);
    expect(meshes.parts.map((part) => [part.mesh.castShadow, part.mesh.receiveShadow])).toEqual([
      [false, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it("is clean by the QA measures and fills exactly the level's bounds", () => {
    for (const { name, mesh } of meshes.parts) {
      const report = inspectGeometry(mesh.geometry);
      expect(
        [report.missing, report.badIndex, report.nonFinite, report.degenerate, report.badNormals, report.flipped],
        name,
      ).toEqual([[], 0, 0, 0, 0, 0]);
    }
    expect(bounds(meshes.root)).toEqual([[...level.bounds.min], [...level.bounds.max]]);
  });

  it('faces every cell out of the room, away from the floor beside it', () => {
    const wall = meshes.parts[3];
    const at = (col: number, row: number) => wall.cells.find((cell) => cell.tiles[0] === col && cell.tiles[1] === row)!;
    expect(at(5, 0).out).toEqual([0, -1]);
    expect(at(5, 11).out).toEqual([0, 1]);
    expect(at(0, 5).out).toEqual([-1, 0]);
    expect(at(15, 5).out).toEqual([1, 0]);
    expect(at(0, 0).out.map((x) => +x.toFixed(12))).toEqual([-0.707106781187, -0.707106781187]);
    expect(at(15, 11).out.map((x) => +x.toFixed(12))).toEqual([0.707106781187, 0.707106781187]);
    expect(at(5, 0).centre).toEqual([5.5, 0, 0.5]);
    expect(meshes.cells.length).toBe(6 + 1 + 52);
    // The low wall's ends are open to one side: they lean away from it.
    const lowWall = meshes.parts[1].cells;
    expect([lowWall[0].out, lowWall[5].out]).toEqual([
      [1, 0],
      [-1, 0],
    ]);
  });
});

describe('createLevelMeshes on the other fixtures', () => {
  it('sizes pieces by the tile: half-metre tiles give half-metre walls and 1 m pillars', () => {
    const meshes = build(fixture('heights'));
    const [, , pillar, wall] = meshes.parts.map((part) => part.mesh);
    expect(inspectGeometry(wall.geometry)).toMatchObject({ min: [-0.25, 0, -0.25], max: [0.25, 3, 0.25] });
    expect(inspectGeometry(pillar.geometry)).toMatchObject({ min: [-0.5, 0, -0.5], max: [0.5, 3.5, 0.5] });
    expect(bounds(meshes.root)).toEqual([
      [0, 0, 0],
      [5, 3.5, 4],
    ]);
  });

  it('draws the 64 × 44 hall in 7 calls however many pieces, with about one floor vertex per tile', () => {
    const level = fixture('hall-v1');
    const meshes = build(level);
    expect(meshes.drawCalls()).toBe(7);
    const [floor, lowWall, pillar, wall] = meshes.parts.map((part) => part.mesh);
    expect([(lowWall as InstancedMesh).count, (pillar as InstancedMesh).count, (wall as InstancedMesh).count]).toEqual([
      39, 23, 212,
    ]);
    const floorTiles = level.meshes[0].pieces.length;
    expect(inspectGeometry(floor.geometry).triangles).toBe(2 * floorTiles);
    expect(inspectGeometry(floor.geometry).vertices / floorTiles).toBeLessThan(1.2);
    expect(bounds(meshes.root)).toEqual([[...level.bounds.min], [...level.bounds.max]]);
  });

  it('is pure: equal levels give equal buffers', () => {
    const [a, b] = [build(fixture('room')), build(fixture('room'))];
    for (const [i, part] of a.parts.entries()) {
      const other = b.parts[i].mesh;
      expect(Array.from(part.mesh.geometry.getAttribute('position').array)).toEqual(
        Array.from(other.geometry.getAttribute('position').array),
      );
      expect(Array.from(part.mesh.geometry.getIndex()!.array)).toEqual(Array.from(other.geometry.getIndex()!.array));
    }
  });
});

describe('the recipes', () => {
  it("draws with the library's materials by the recipes' ids: sides then tops for blocks", () => {
    const library = createMaterialLibrary();
    const meshes = createLevelMeshes(fixture('room'), { materials: library });
    const names = meshes.parts.map(({ mesh }) =>
      ([] as Material[]).concat(mesh.material).map((material) => material.userData.material as string),
    );
    expect(names).toEqual([
      [...LEVEL_RECIPES.floor.materials],
      [...LEVEL_RECIPES.lowWall.materials],
      [...LEVEL_RECIPES.pillar.materials],
      [...LEVEL_RECIPES.wall.materials],
    ]);
    expect(names[3]).toEqual(['material:brick', 'material:stone']);
    library.dispose();
  });

  it("draws a recipe nobody defined as grey blocks with advice, or by the game's recipe", () => {
    const reg = createRegistry();
    defineGlyph(
      'glyph:hedge',
      { char: 'h', top: 1.2, solid: true, collider: 'box', mesh: 'hedge', nav: { walkable: false } },
      reg,
    );
    defineGlyph('glyph:ledge', { char: 'L', floor: 1, top: 1, mesh: 'gallery' }, reg); // = is the engine's gallery (WP 4.2)
    const level = compileLevel('#####\n#.hL#\n#####\n', { file: 'garden.txt', registry: reg });
    const printed: string[] = [];
    const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
    const stand = materials();
    const meshes = createLevelMeshes(level, { materials: stand, log });
    expect(meshes.parts.map((part) => [part.name, kind(part.mesh)])).toEqual([
      ['level:garden/floor', 'mesh'],
      ['level:garden/gallery', 'mesh'],
      ['level:garden/hedge', 'instanced'],
      ['level:garden/wall', 'instanced'],
    ]);
    expect(printed).toEqual([
      expect.stringMatching(/^\[GFX_LEVEL_RECIPE\] level garden uses the mesh recipe gallery, which no level recipe/),
      expect.stringMatching(
        /^\[GFX_LEVEL_RECIPE\] level garden uses the mesh recipe hedge.*floor, lowWall, pillar, wall/,
      ),
    ]);
    // A block whose top is its floor is drawn as a surface at that height.
    expect(inspectGeometry(meshes.parts[1].mesh.geometry)).toMatchObject({
      vertices: 4,
      min: [3, 1, 1],
      max: [4, 1, 2],
    });
    expect([].concat(meshes.parts[2].mesh.material as never).map((m: Material) => m.name)).toEqual([
      'material:default',
      'material:default',
    ]);
    const quiet: string[] = [];
    const hedge = {
      shape: 'block',
      materials: ['material:moss', 'material:leaves'],
      castShadow: true,
      receiveShadow: true,
    } as const;
    const gallery = { ...LEVEL_RECIPES.floor };
    const own = createLevelMeshes(level, {
      materials: materials(),
      recipes: { hedge, gallery },
      log: createLog({ console: { warn: (line) => quiet.push(line), error: () => {} } }),
    });
    expect(quiet).toEqual([]);
    expect([].concat(own.parts[2].mesh.material as never).map((m: Material) => m.name)).toEqual([
      'material:moss',
      'material:leaves',
    ]);
    expect(own.drawCalls()).toBe(1 + 1 + 2 + 2);
    // A block with one material draws the whole box at once.
    const plain = createLevelMeshes(level, {
      materials: materials(),
      recipes: { hedge: { ...hedge, materials: ['material:moss'] }, gallery },
    });
    expect((plain.parts[2].mesh.material as Material).name).toBe('material:moss');
    expect(plain.drawCalls()).toBe(1 + 1 + 1 + 2);
  });
});

describe('the warm-up and dispose', () => {
  it('registers every mesh with the warm-up, and dispose unregisters, frees and detaches', () => {
    const entries = new Map<string, () => readonly Object3D[]>();
    const warmup = {
      register: (id: string, entry: { objects(): readonly Object3D[] }) => {
        entries.set(id, entry.objects);
        return { dispose: () => void entries.delete(id) };
      },
    } as unknown as Warmup;
    const meshes: LevelMeshes = build(fixture('room'));
    const scene = new Scene();
    scene.add(meshes.root);
    meshes.register(warmup);
    expect([...entries.keys()]).toEqual(['level:room']);
    expect(entries.get('level:room')!().map((object) => object.name)).toEqual(meshes.parts.map((part) => part.name));
    const disposed: string[] = [];
    for (const { name, mesh } of meshes.parts) mesh.geometry.addEventListener('dispose', () => disposed.push(name));
    meshes.dispose();
    expect(entries.size).toBe(0);
    expect(disposed).toEqual(meshes.parts.map((part) => part.name));
    expect(meshes.root.parent).toBeNull();
  });
});
