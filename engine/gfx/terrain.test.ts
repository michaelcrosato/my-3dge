/**
 * @file Unit tests for the terrain drawn (engine/gfx/terrain.ts, terrainSplat.ts), in Node: chunks of at most 32 cells
 * named by their corner cell, each a LOD at its middle with a level per step that divides it; the finest level's
 * surface is the terrain's (terrainHeight at every vertex), faces up, UVs in world metres and unit normals; every level
 * hangs its skirt facing out of the chunk; a draw call a chunk (and one per shadow map); every level registered with
 * the warm-up, and dispose frees and detaches; the splat draws each style's ground material through one copy whose
 * colour mixes the layers, and the style set re-points the chunks through it. The GPU half (the ID pass, 0 pipelines
 * after the warm-up, the levels switching) is tests/e2e/terrain.spec.ts.
 * @see engine/gfx/terrain.ts
 */
import { MeshLambertMaterial, OrthographicCamera, PerspectiveCamera, Scene, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three/webgpu'; // prettier-ignore
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { makeTerrain, terrainHeight, type Terrain } from '../world/terrain';
import { createMaterialLibrary } from './materials/library';
import { defineMaterial } from './materials/material';
import { createStyleSet } from './materials/styles';
import {
  CHUNK,
  chunkGeometry,
  createTerrainMeshes,
  levelDistance,
  LOD_DISTANCES,
  SKIRT,
  terrainNormals,
} from './terrain';
import { createTerrainSplat } from './terrainSplat';
import type { Warmup } from './warmup';

/** A hill 24 × 72 m from (72, 0, 0): three chunks of 24 × 32, 24 × 32 and 24 × 8 cells. */
const HILL: Terrain = makeTerrain({ size: [24, 72], origin: [72, 0.5, 0], seed: 3, height: 1, scale: 16, hills: [{ at: [96, 36], radius: 30, height: 10 }], materials: ['material:default', 'material:checker', 'material:planks'], high: 8 }, 'hill'); // prettier-ignore
const library = () => createMaterialLibrary();

/** The triangles of `geometry` as world-space corner triples, offset by `at`. */
function triangles(geometry: BufferGeometry, at: Vector3): Vector3[][] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const out: Vector3[][] = [];
  for (let i = 0; i < index.count; i += 3) {
    out.push([0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, index.getX(i + k)).add(at)));
  }
  return out;
}

/** A triangle's face normal. */
const faceNormal = ([a, b, c]: Vector3[]) => new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize(); // prettier-ignore

describe('createTerrainMeshes', () => {
  it('draws chunks of at most 32 cells, each a LOD at its middle with a level per step that divides it', () => {
    const meshes = createTerrainMeshes(HILL, { materials: library() });
    expect(CHUNK).toBe(32);
    expect(meshes.root.name).toBe('terrain:hill');
    expect(meshes.chunks.map((lod) => lod.name)).toEqual([
      'terrain:hill/0,0',
      'terrain:hill/0,32',
      'terrain:hill/0,64',
    ]);
    expect(meshes.chunks.map((lod) => lod.levels.map((level) => level.distance))).toEqual([[...LOD_DISTANCES], [...LOD_DISTANCES], [...LOD_DISTANCES]]); // prettier-ignore
    expect(meshes.meshes.map((mesh) => mesh.name).slice(0, 3)).toEqual(['terrain:hill/0,0#0', 'terrain:hill/0,0#1', 'terrain:hill/0,0#2']); // prettier-ignore
    expect(meshes.chunks[2].position.toArray()).toEqual([84, HILL.heights[68 * 25 + 12], 68]);
    for (const mesh of meshes.meshes) expect([mesh.castShadow, mesh.receiveShadow, mesh.userData.terrain]).toEqual([true, true, 'hill']); // prettier-ignore
    const odd = createTerrainMeshes(makeTerrain({ size: [5, 3] }), { materials: library() });
    expect(odd.chunks.map((lod) => lod.levels.length)).toEqual([1]); // 5 × 3 cells: neither 2 nor 4 divides them
  });

  it('stands the finest level on the terrain’s surface, facing up, UVs in world metres, normals of unit length', () => {
    const meshes = createTerrainMeshes(HILL, { materials: library() });
    const [lod] = meshes.chunks;
    const finest = lod.levels[0].object as Mesh;
    const geometry = finest.geometry;
    const [position, uv, normal] = ['position', 'uv', 'normal'].map((name) => geometry.getAttribute(name));
    const surface = 25 * 33; // the chunk's corners, before its skirt
    for (let i = 0; i < surface; i++) {
      const p = new Vector3().fromBufferAttribute(position, i).add(lod.position);
      expect(p.y).toBeCloseTo(terrainHeight(HILL, p.x, p.z)!, 5);
      expect([uv.getX(i), uv.getY(i)]).toEqual([p.x, p.z]);
      expect(new Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 6);
    }
    const tris = triangles(geometry, lod.position);
    for (const tri of tris.slice(0, 24 * 32 * 2)) expect(faceNormal(tri).y).toBeGreaterThan(0);
    // Each triangle is the collider's: its middle stands at terrainHeight there.
    for (const tri of tris.slice(0, 200)) {
      const middle = new Vector3().add(tri[0]).add(tri[1]).add(tri[2]).divideScalar(3);
      expect(middle.y).toBeCloseTo(terrainHeight(HILL, middle.x, middle.z)!, 4);
    }
  });

  it('hangs a skirt round every level, facing out of the chunk', () => {
    const normals = terrainNormals(HILL);
    for (const step of [1, 2, 4]) {
      const middle = [84, 0, 16] as const;
      const geometry = chunkGeometry(HILL, normals, [0, 0, 24, 32], step, middle);
      const tris = triangles(geometry, new Vector3(...middle));
      const surface = (24 / step) * (32 / step) * 2;
      const skirt = tris.slice(surface);
      expect(skirt.length).toBe(2 * 2 * (24 / step + 32 / step));
      for (const tri of skirt) {
        const centre = new Vector3().add(tri[0]).add(tri[1]).add(tri[2]).divideScalar(3);
        const out = faceNormal(tri);
        expect(Math.abs(out.y)).toBeLessThan(1e-6); // upright
        expect(out.x * (centre.x - 84) + out.z * (centre.z - 16)).toBeGreaterThan(0);
        const ys = tri.map((p) => p.y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(SKIRT - 1e-5); // an edge's corner and its drop
      }
    }
  });

  it('shows a chunk’s level by its distance from a perspective camera, and by what an orthographic one frames', () => {
    // A flat strip of three chunks, their middles at z 16, 48 and 80.
    const meshes = createTerrainMeshes(makeTerrain({ size: [32, 96] }), { materials: library() });
    const lens = new PerspectiveCamera(50, 16 / 9, 0.1, 500);
    const shown = () => meshes.chunks.map((lod) => lod.levels.findIndex((level) => level.object.visible));
    lens.position.set(16, 0, -20);
    lens.updateMatrixWorld();
    for (const lod of meshes.chunks) lod.update(lens);
    expect(shown()).toEqual([0, 1, 2]); // 36, 68 and 100 m off
    expect(meshes.chunks.map((lod) => lod.getCurrentLevel())).toEqual([0, 1, 2]);
    // An orthographic view 60 m back framing 22.5 m: as near as a 50° lens framing that, 24 m: every chunk finest.
    const iso = new OrthographicCamera(-20, 20, 11.25, -11.25, 0.1, 500);
    iso.position.set(84, 60, 200);
    iso.updateMatrixWorld();
    expect(levelDistance(iso, new Vector3())).toBeCloseTo(22.5 / (2 * Math.tan((25 * Math.PI) / 180)), 9);
    for (const lod of meshes.chunks) lod.update(iso);
    expect(shown()).toEqual([0, 0, 0]);
    iso.zoom = 0.4; // zoomed out to frame 56 m, as a lens 60 m off: a level coarser
    for (const lod of meshes.chunks) lod.update(iso);
    expect(shown()).toEqual([1, 1, 1]);
  });

  it('costs a draw call a chunk, and one per shadow map', () => {
    const meshes = createTerrainMeshes(HILL, { materials: library() });
    expect([meshes.drawCalls(), meshes.drawCalls(1)]).toEqual([3, 6]);
    meshes.root.visible = false;
    expect(meshes.drawCalls(1)).toBe(0);
  });

  it('registers every level of every chunk with the warm-up, and dispose unregisters, frees and detaches', () => {
    const entries = new Map<string, () => readonly Object3D[]>();
    const warmup = {
      register: (id: string, entry: { objects(): readonly Object3D[] }) => {
        entries.set(id, entry.objects);
        return { dispose: () => void entries.delete(id) };
      },
    } as unknown as Warmup;
    const meshes = createTerrainMeshes(HILL, { materials: library() });
    const scene = new Scene();
    scene.add(meshes.root);
    meshes.register(warmup);
    expect(entries.get('terrain:hill')!().length).toBe(9);
    const disposed: string[] = [];
    for (const mesh of meshes.meshes) mesh.geometry.addEventListener('dispose', () => disposed.push(mesh.name));
    meshes.dispose();
    expect([entries.size, disposed.length, meshes.root.parent]).toEqual([0, 9, null]);
  });
});

describe('the splat', () => {
  it('draws the ground material through one copy whose colour mixes the layers', () => {
    const materials = library();
    const meshes = createTerrainMeshes(HILL, { materials });
    const drawn = new Set(meshes.meshes.map((mesh) => mesh.material));
    expect(drawn.size).toBe(1);
    const [copy] = drawn as Set<MeshLambertMaterial & { colorNode: unknown }>;
    expect(copy).not.toBe(materials.get('material:default'));
    expect([copy.name, copy.userData.material, copy.colorNode !== null]).toEqual(['material:default+splat', 'material:default', true]); // prettier-ignore
    const restyle = meshes.meshes[0].userData.restyle as (material: MeshLambertMaterial) => MeshLambertMaterial;
    expect(restyle(materials.get('material:default') as MeshLambertMaterial)).toBe(copy);
    expect(restyle(copy)).toBe(copy);
  });

  it('is re-pointed by the style set: the toon ground drawn through a copy of its own', () => {
    const registry = createRegistry();
    defineMaterial('material:test-grass', { color: '#55aa44', map: 'texture:grass' }, registry);
    const styles = createStyleSet({ registry });
    const ground = makeTerrain({ size: [8, 8], materials: ['material:test-grass'] }, 'patch');
    const meshes = createTerrainMeshes(ground, { materials: styles.library });
    const first = meshes.meshes[0].material;
    const scene = new Scene();
    scene.add(meshes.root);
    styles.setStyle('toon', scene);
    const material = meshes.meshes[0].material as MeshLambertMaterial;
    expect([material.type, material.name, material.userData.material]).toEqual(['MeshBandedToonNodeMaterial', 'material:test-grass+splat', 'material:test-grass']); // prettier-ignore
    expect(new Set(meshes.meshes.map((mesh) => mesh.material))).toEqual(new Set([material]));
    styles.setStyle('lambert', scene);
    expect(meshes.meshes[0].material).toBe(first); // the lambert ground's copy, made once
  });

  it('makes a copy once per source, and owns what it made', () => {
    const splat = createTerrainSplat({ steep: 0.7, high: 0, origin: [0, 0, 0] }, [new MeshLambertMaterial()]);
    const ground = new MeshLambertMaterial();
    const copy = splat.wrap(ground);
    expect([splat.wrap(ground) === copy, splat.owns(copy), splat.owns(ground), splat.wrap(copy) === copy]).toEqual([true, true, false, true]); // prettier-ignore
    let freed = false;
    copy.addEventListener('dispose', () => (freed = true));
    splat.dispose();
    expect(freed).toBe(true);
  });
});
