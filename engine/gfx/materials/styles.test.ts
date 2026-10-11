/**
 * @file Unit tests for material styles (engine/gfx/materials/styles.ts), in Node: each style compiles the same entry
 * to its three.js material once (pbr with roughness, metalness and the roughness map; flat without the normal map;
 * toon sharing the set's uniforms), `lambert` and unlit entries are the library's own materials, an unknown style is
 * `GFX_UNKNOWN_STYLE`; `setStyle` and `apply` re-point visible meshes (arrays too) and leave hidden ones and other
 * materials alone; the warm-up entries sort after every other, swap every drawn mesh to each style in turn and put
 * each material back, and the shader key names what was compiled; `dispose` frees what the set made. That switching
 * styles builds no pipeline on the GPU is tests/e2e/materials-v2.spec.ts.
 * @see engine/gfx/materials/styles.ts
 */
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Material,
  type MeshStandardNodeMaterial,
  type Object3D,
} from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../core/registry';
import type { Warmup } from '../warmup';
import { createMaterialLibrary } from './library';
import { defineMaterial } from './material';
import { checkStyle, createStyleSet, MATERIAL_STYLES, STYLE_WARMUP_IDS } from './styles';
import { MeshBandedToonNodeMaterial } from './toon';

/** A registry with a textured lit material and an unlit one. */
function registryWithMaterials() {
  const registry = createRegistry();
  defineMaterial(
    'material:test-metal',
    { color: '#a0a8b0', map: 'texture:stone', roughness: 0.3, metalness: 0.8, normalScale: 2 },
    registry,
  );
  defineMaterial('material:test-sign', { color: '#ffcc00', unlit: true }, registry);
  return registry;
}

/** A fake warm-up recording entries (sorted as the real one runs them) and key parts. */
function fakeWarmup() {
  const entries = new Map<string, () => readonly Object3D[]>();
  const parts = new Map<string, () => string>();
  const warmup = {
    register: (id: string, entry: { objects(): readonly Object3D[] }) => {
      entries.set(id, () => entry.objects());
      return { dispose: () => void entries.delete(id) };
    },
    keyPart: (name: string, part: () => string) => {
      parts.set(name, part);
      return { dispose: () => void parts.delete(name) };
    },
  };
  return { warmup: warmup as unknown as Warmup, entries, parts };
}

describe('style sets', () => {
  it('compile an entry once per style; lambert and unlit entries are the library’s own', () => {
    const registry = registryWithMaterials();
    const library = createMaterialLibrary({ registry });
    const styles = createStyleSet({ library, registry });
    expect(MATERIAL_STYLES).toEqual(['lambert', 'toon', 'flat', 'pbr']);
    expect(styles.style).toBe('lambert');
    expect(styles.get('material:test-metal')).toBe(library.get('material:test-metal'));
    const toon = styles.get('material:test-metal', 'toon') as MeshBandedToonNodeMaterial;
    expect(toon).toBeInstanceOf(MeshBandedToonNodeMaterial);
    expect(toon.toon).toBe(styles.toon);
    expect(toon.normalMap).not.toBeNull();
    expect(toon.userData).toEqual({ material: 'material:test-metal', style: 'toon' });
    expect(styles.get('material:test-metal', 'toon')).toBe(toon);
    const flat = styles.get('material:test-metal', 'flat') as MeshStandardNodeMaterial;
    expect([flat.type, flat.normalMap, flat.map]).toEqual(['MeshFlatStyleNodeMaterial', null, toon.map]);
    const pbr = styles.get('material:test-metal', 'pbr') as MeshStandardNodeMaterial;
    expect(pbr.type).toBe('MeshStandardNodeMaterial');
    expect([pbr.roughness, pbr.metalness]).toEqual([0.3, 0.8]);
    expect(pbr.roughnessMap).toBe(
      library.maps({ texture: 'texture:stone', seed: 1, params: {}, size: null, look: null, repeat: null })
        .roughnessMap,
    );
    expect(pbr.normalScale.x).toBe(2);
    for (const style of MATERIAL_STYLES) {
      expect(styles.get('material:test-sign', style)).toBe(library.get('material:test-sign'));
    }
    expect(styles.ids).toEqual(['material:test-metal@flat', 'material:test-metal@pbr', 'material:test-metal@toon']);
    expect(() => styles.get('material:test-metal', 'cel' as never)).toThrow(
      expect.objectContaining({ code: 'GFX_UNKNOWN_STYLE' }),
    );
    expect(() => checkStyle('cel')).toThrow(/use one of lambert, toon, flat, pbr/);
  });

  it('compile every material in every style with all()', () => {
    const registry = registryWithMaterials();
    const styles = createStyleSet({ registry });
    const lit = registry.list('material').filter((entry) => !entry.unlit).length;
    expect(styles.all()).toHaveLength(registry.list('material').length * 4);
    expect(styles.ids).toHaveLength(lit * 3);
    styles.dispose();
  });

  it('re-point visible meshes drawn with registry materials, arrays too, and leave hidden ones and others alone', () => {
    const registry = registryWithMaterials();
    const library = createMaterialLibrary({ registry });
    const styles = createStyleSet({ library, registry });
    const root = new Group();
    const box = new BoxGeometry();
    const plain = new Mesh(box, library.get('material:test-metal'));
    const other = new MeshBasicMaterial();
    const grouped = new Mesh(box, [library.get('material:test-metal'), other, library.get('material:test-sign')]);
    const hidden = new Mesh(box, library.get('material:test-metal'));
    const hider = new Group();
    hider.visible = false;
    hider.add(hidden);
    root.add(plain, grouped, hider);
    expect(styles.setStyle('pbr', root)).toBe(2);
    expect(plain.material).toBe(styles.get('material:test-metal', 'pbr'));
    expect(grouped.material).toEqual([
      styles.get('material:test-metal', 'pbr'),
      other,
      library.get('material:test-sign'),
    ]);
    expect(hidden.material).toBe(library.get('material:test-metal'));
    expect(styles.apply(root)).toBe(0);
    hider.visible = true;
    expect(styles.apply(root)).toBe(1);
    expect(styles.setStyle('lambert')).toBe(0);
    expect(styles.apply(root)).toBe(3);
    expect(plain.material).toBe(library.get('material:test-metal'));
  });

  it('warm every style: entries after every other swap each drawn mesh in turn, then put every material back', () => {
    const registry = registryWithMaterials();
    const library = createMaterialLibrary({ registry });
    const styles = createStyleSet({ library, registry, style: 'toon' });
    const scene = new Group();
    const mesh = new Mesh(new BoxGeometry(), styles.get('material:test-metal'));
    const other = new MeshBasicMaterial();
    const grouped = new Mesh(new BoxGeometry(), [other, styles.get('material:test-metal')]);
    scene.add(mesh, grouped);
    const { warmup, entries, parts } = fakeWarmup();
    const attached = styles.attach(warmup, scene);
    expect([...entries.keys()]).toEqual([...STYLE_WARMUP_IDS]);
    const order = [...STYLE_WARMUP_IDS].sort();
    expect(order.at(-1)).toBe('~styles~');
    expect([...STYLE_WARMUP_IDS, 'stage:level', 'zebra:pool'].sort().slice(-5)).toEqual(order);
    const seen: Material[] = [];
    for (const id of [...entries.keys()].sort()) {
      expect(entries.get(id)!()).toEqual([]);
      seen.push(mesh.material as Material);
    }
    expect(seen).toEqual([
      ...['flat', 'lambert', 'pbr', 'toon'].map((style) => styles.get('material:test-metal', style as 'toon')),
      styles.get('material:test-metal', 'toon'),
    ]);
    expect(grouped.material).toEqual([other, styles.get('material:test-metal', 'toon')]);
    expect(parts.get('styles')!()).toBe(styles.ids.join(','));
    attached.dispose();
    expect(entries.size + parts.size).toBe(0);
  });

  it('free the materials they made, and the library when it is their own', () => {
    const registry = registryWithMaterials();
    const library = createMaterialLibrary({ registry });
    const styles = createStyleSet({ library, registry });
    const toon = styles.get('material:test-metal', 'toon');
    const lambert = styles.get('material:test-metal', 'lambert');
    const freed = vi.spyOn(toon, 'dispose');
    const kept = vi.spyOn(lambert, 'dispose');
    const { warmup, entries } = fakeWarmup();
    styles.attach(warmup, new Group());
    styles.dispose();
    expect([freed.mock.calls.length, kept.mock.calls.length, entries.size, styles.ids.length]).toEqual([1, 0, 0, 0]);
  });
});
