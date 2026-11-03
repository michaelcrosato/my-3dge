/**
 * @file Unit tests for the material library (engine/gfx/materials/library.ts), in Node with a stand-in warm-up:
 * a material compiles once; materials naming the same bake share its textures; `all()` compiles the registry's
 * materials; a missing id gets `material:default`'s material; `attach` puts a hidden probe per compiled material into
 * the scene, registers them as the warm-up entry `materials` and keys the shader key by the compiled ids (a material
 * compiled later changes the key); `filter` re-filters every map for a look and puts back each one's own; `dispose`
 * detaches and frees what it made. The GPU half (0 pipelines built after the warm-up) is proven by
 * tests/e2e/materials.spec.ts, and a look's textures switched with none by tests/e2e/playground-looks.spec.ts.
 * @see engine/gfx/materials/library.ts
 */
import { LinearFilter, NearestFilter, Scene, type Object3D } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { createLog } from '../../core/log';
import { createRegistry } from '../../core/registry';
import type { TextureMaps } from '../textures/dataTexture';
import type { Warmup } from '../warmup';
import { createMaterialLibrary } from './library';
import { defineMaterial, getMaterial, textureRefOf } from './material';

/** A stand-in warm-up recording what is registered and keyed. */
function fakeWarmup() {
  const entries = new Map<string, () => readonly Object3D[]>();
  const parts = new Map<string, () => string>();
  const warmup = {
    register: (id: string, entry: { objects(): readonly Object3D[] }) => {
      entries.set(id, entry.objects);
      return { dispose: () => void entries.delete(id) };
    },
    keyPart: (name: string, part: () => string) => {
      parts.set(name, part);
      return { dispose: () => void parts.delete(name) };
    },
  } as unknown as Warmup;
  return { warmup, entries, parts };
}

describe('createMaterialLibrary', () => {
  it('compiles a material once, and shares one bake between materials naming it', () => {
    const reg = createRegistry();
    defineMaterial('material:brick2', { map: 'texture:brick', color: '#ffeedd' }, reg);
    defineMaterial('material:brick3', { map: { texture: 'texture:brick', seed: 2 } }, reg);
    const library = createMaterialLibrary({ registry: reg });
    const brick = library.get('material:brick') as unknown as { map: unknown; normalMap: unknown };
    expect(library.get('material:brick')).toBe(brick);
    const same = library.get('material:brick2') as unknown as { map: unknown };
    const other = library.get('material:brick3') as unknown as { map: unknown };
    expect(same.map).toBe(brick.map);
    expect(other.map).not.toBe(brick.map);
    expect(library.ids).toEqual(['material:brick', 'material:brick2', 'material:brick3']);
    library.dispose();
  });

  it('compiles every material with all(), in id order', () => {
    const reg = createRegistry();
    const library = createMaterialLibrary({ registry: reg });
    const all = library.all();
    expect(all.map((material) => material.name)).toEqual(reg.list('material').map((entry) => entry.id));
    expect(new Set(all.map((material) => material.type))).toEqual(
      new Set(['MeshLambertMaterial', 'MeshBasicMaterial']),
    );
    library.dispose();
  });

  it("gives material:default's material for a missing id, after a warning", () => {
    const warn = vi.fn();
    const reg = createRegistry({ log: createLog({ console: { warn, error: vi.fn() } }) });
    const library = createMaterialLibrary({ registry: reg });
    expect(library.get('material:nope')).toBe(library.get('material:default'));
    expect(warn).toHaveBeenCalledTimes(1);
    library.dispose();
  });

  it('attaches hidden probes to the scene and the warm-up, keyed by the compiled ids, and detaches', () => {
    const library = createMaterialLibrary({ registry: createRegistry() });
    const scene = new Scene();
    const { warmup, entries, parts } = fakeWarmup();
    library.get('material:stone');
    const attached = library.attach(warmup, scene);
    const group = scene.getObjectByName('materials:probes')!;
    expect(group.visible).toBe(false);
    expect(entries.get('materials')!().map((probe) => probe.name)).toEqual(['probe:material:stone']);
    expect(parts.get('materials')!()).toBe('material:stone');
    library.get('material:glow');
    const probes = entries.get('materials')!() as unknown as {
      castShadow: boolean;
      receiveShadow: boolean;
      material: unknown;
    }[];
    expect(probes).toHaveLength(2);
    expect(probes[1]).toMatchObject({ castShadow: true, receiveShadow: true, material: library.get('material:glow') });
    expect(parts.get('materials')!()).toBe('material:glow,material:stone');
    attached.dispose();
    expect([entries.size, parts.size, scene.children.length]).toEqual([0, 0, 0]);
    library.dispose();
  });

  it("filters every map for a look, those made after too, and puts back each one's own, baking nothing again", () => {
    const reg = createRegistry();
    defineMaterial('material:soft-brick', { map: { texture: 'texture:brick', look: 'smooth' } }, reg);
    const library = createMaterialLibrary({ registry: reg });
    const mapsOf = (id: string) => (library.get(id), library.maps(textureRefOf(getMaterial(id, reg).map)!));
    const filters = (maps: TextureMaps) => [maps.map, maps.normalMap, maps.roughnessMap].map((one) => one.magFilter);
    const [crisp, soft] = [mapsOf('material:brick'), mapsOf('material:soft-brick')];
    expect([filters(crisp), filters(soft)]).toEqual([Array(3).fill(NearestFilter), Array(3).fill(LinearFilter)]);
    expect(library.filter('smooth'), "the crisp map's three textures").toBe(3);
    expect(filters(crisp)).toEqual(Array(3).fill(LinearFilter));
    expect(library.filter('smooth'), 'the same look again').toBe(0);
    const later = mapsOf('material:planks');
    expect(filters(later), 'made after: filtered for the look').toEqual(Array(3).fill(LinearFilter));
    expect(library.filter(null), "the brick's and the planks' back to crisp").toBe(6);
    expect([filters(crisp), filters(soft), filters(later)]).toEqual([
      Array(3).fill(NearestFilter),
      Array(3).fill(LinearFilter),
      Array(3).fill(NearestFilter),
    ]);
    expect(mapsOf('material:brick'), 'the same textures, baked once').toBe(crisp);
    library.dispose();
  });

  it('frees its materials and textures on dispose', () => {
    const library = createMaterialLibrary({ registry: createRegistry() });
    const material = library.get('material:planks') as unknown as { map: { dispose(): void }; dispose(): void };
    const disposed = [vi.spyOn(material, 'dispose'), vi.spyOn(material.map, 'dispose')];
    const { warmup, entries } = fakeWarmup();
    library.attach(warmup, new Scene());
    library.dispose();
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(0);
    expect(library.ids).toEqual([]);
  });
});
