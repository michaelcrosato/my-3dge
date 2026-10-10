/**
 * @file The material library (PLAN.md WP 2.3, §6.7, §8.7): what a page draws materials with. `get(id)` compiles a
 * `material` entry once (engine/gfx/materials/compile.ts) and hands out the same three.js material ever after, its
 * maps baked once per texture, seed, parameters and size (engine/gfx/textures/bake.ts) and shared by every material
 * that names them; `all()` compiles every material the registry has, as a page does at startup.
 *
 * The warm-up (engine/gfx/warmup.ts): `attach(warmup, scene)` puts a hidden group into the scene holding one probe
 * mesh per compiled material (a unit box with positions, normals and UVs, casting and receiving shadows, the way
 * level meshes and props draw them), registers the probes as the warm-up entry `materials`, and adds the compiled ids
 * to the shader key (`keyPart('materials')`). So every material's pipelines are built during a warm-up, and a
 * material compiled later changes the key, which re-warms before the next frame draws: showing a material for the
 * first time builds no pipeline (the budget is 0 after the warm-up). Meshes with other attributes or instancing
 * register their own objects (WP 2.4's level meshes, WP 3.8's instancing service).
 *
 * Invariants: one compiled material per entry id (a missing id gets `material:default`'s, after its warning); maps
 * are keyed by their bake key, look and repeat; `dispose()` frees every material, texture and probe it made and
 * detaches from the warm-up. Nothing here reaches the sim.
 *
 * @example
 * const library = createMaterialLibrary();
 * library.get('material:brick') === library.get('material:brick'); // true: compiled once
 * library.get('material:brick').type; // 'MeshLambertMaterial'
 * library.dispose();
 * @see engine/gfx/materials/library.test.ts
 * @see tests/e2e/materials.spec.ts
 */
import { BoxGeometry, Group, Mesh, type Material, type Object3D } from 'three/webgpu';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { bakeKey, bakeTexture, textureSampler } from '../textures/bake';
import { toDataTextures, type TextureMaps } from '../textures/dataTexture';
import type { Warmup } from '../warmup';
import { compileMaterial } from './compile';
import { bakeRefOf, getMaterial, materialKind, textureRefOf, type MapRef, type MaterialEntry } from './material';

/** A page's compiled materials and baked maps. */
export interface MaterialLibrary {
  /** The three.js material of material `id`, compiled on first use; a missing id gives `material:default`'s. */
  get(id: string): Material;
  /** Compiles every material in the registry; returns them in id order. */
  all(): Material[];
  /** The baked maps of a material's map (shared by every material naming the same bake, look and repeat). */
  maps(map: MapRef): TextureMaps;
  /** The ids compiled so far, sorted. */
  readonly ids: readonly string[];
  /** Puts the probes into `scene` and registers them with `warmup` (see the file comment); `dispose()` undoes it. */
  attach(warmup: Warmup, scene: Object3D): { dispose(): void };
  /** Frees every material, texture and probe made, and detaches. */
  dispose(): void;
}

/** Makes a material library over `registry` (the shared one by default). */
export function createMaterialLibrary(options: { registry?: Registry } = {}): MaterialLibrary {
  const registry = options.registry ?? sharedRegistry;
  materialKind(registry);
  const materials = new Map<string, Material>();
  const textures = new Map<string, TextureMaps>();
  const probes = new Group();
  probes.name = 'materials:probes';
  probes.visible = false;
  const box = new BoxGeometry(1, 1, 1);
  const detach: (() => void)[] = [];

  const library: MaterialLibrary = {
    get(id) {
      const entry: MaterialEntry = getMaterial(id, registry);
      const known = materials.get(entry.id);
      if (known) return known;
      const ref = textureRefOf(entry.map);
      const material = compileMaterial(entry, ref ? library.maps(ref) : null);
      materials.set(entry.id, material);
      const probe = new Mesh(box, material);
      probe.name = `probe:${entry.id}`;
      probe.castShadow = true;
      probe.receiveShadow = true;
      probes.add(probe);
      return material;
    },
    all() {
      return registry.list('material').map((entry) => library.get(entry.id));
    },
    maps(map) {
      const ref = bakeRefOf(map);
      const key = JSON.stringify([bakeKey(textureSampler(ref, registry)), map.look, map.repeat]);
      let maps = textures.get(key);
      if (!maps) {
        const bake = bakeTexture(ref, registry);
        maps = toDataTextures(bake, { look: map.look ?? undefined, repeat: map.repeat ?? undefined });
        textures.set(key, maps);
      }
      return maps;
    },
    get ids() {
      return [...materials.keys()].sort();
    },
    attach(warmup, scene) {
      scene.add(probes);
      const entry = warmup.register('materials', { objects: () => probes.children });
      const part = warmup.keyPart('materials', () => library.ids.join(','));
      const undo = () => {
        entry.dispose();
        part.dispose();
        probes.removeFromParent();
      };
      detach.push(undo);
      return {
        dispose() {
          const at = detach.indexOf(undo);
          if (at >= 0) detach.splice(at, 1)[0]();
        },
      };
    },
    dispose() {
      for (const undo of detach.splice(0)) undo();
      for (const material of materials.values()) material.dispose();
      for (const maps of textures.values()) {
        for (const texture of Object.values(maps)) texture?.dispose();
      }
      materials.clear();
      textures.clear();
      probes.clear();
      box.dispose();
    },
  };
  return library;
}
