/**
 * @file Material styles (PLAN.md WP 7.2, §6.7; doctrine: Common ground outside, Quality under the hood inside): the
 * same material data (engine/gfx/materials/material.ts) drawn four ways. `lambert` is v1's (engine/gfx/materials/
 * compile.ts: `MeshLambertMaterial`); `toon` is banded light with a rim (engine/gfx/materials/toon.ts); `flat` is
 * the colour as it is, darkened only by shadow and distance, as shardfall's flat style (`MeshFlatStyleNodeMaterial`:
 * no N·L); `pbr` is three.js's `MeshStandardMaterial`, the one that reads `roughness`, `metalness` and the roughness
 * map. An unlit material stays unlit in every style. Toon and flat leave the normal map out: their light follows the
 * forms, not the texture's relief (in the box room, the flagstones' relief speckled the toon bands' edges).
 *
 * `createStyleSet({ library })` compiles each material once per style (`get(id, style)`), sharing the library's baked
 * maps and, for `lambert` and unlit ones, its very materials; the toon look is one set of uniforms (`toon`). A style
 * changes what is drawn, never what is played, so it is view state: `setStyle(style, root)` re-points every visible
 * mesh under `root` drawn with a registry material (it reads `material.userData.material`, the entry's id) to that
 * material in the new style, and `apply(root)` does it again for meshes shown since (call it before a frame that
 * may show new objects; hidden ones keep theirs until they show). A mesh drawing its materials its own way wraps each
 * it is given, here and in the warm-up (`userData.restyle`: first person's player, engine/gfx/viewmodel/body.ts).
 *
 * The warm-up (engine/gfx/warmup.ts): a pipeline depends on the mesh as much as on its material (its attributes,
 * its instancing; r182 even compiles a shader per instanced mesh of 1,000 slots or fewer, as the level's walls are),
 * so probes of each material cannot stand in for the meshes. `attach(warmup, scene)` registers one entry per style,
 * after every other entry (`STYLE_WARMUP_IDS`, `~styles/<style>`), each of which points every mesh the warm-up then
 * draws (the visible ones and those it made drawable) at its style, and a last one (`~styles~`) that puts every
 * material back before the warm frame: each warm-up compiles the scene once per style, so switching styles later
 * builds no pipeline (tests/e2e/materials-v2.spec.ts). The compiled ids go into the shader key, so a material
 * compiled since re-warms before it draws.
 *
 * Invariants: one material per entry and style; reads entries' fields, never their ids' text; every material it
 * compiles carries `userData.material` (the entry's id) and `userData.style`; a warm-up leaves every material as it
 * found it; `dispose()` frees what it made (the library's own materials stay the library's). Nothing here reaches
 * the sim.
 *
 * @example
 * const styles = createStyleSet();
 * styles.get('material:brick', 'toon').type; // 'MeshBandedToonNodeMaterial'
 * styles.get('material:brick', 'pbr').type; // 'MeshStandardNodeMaterial'
 * styles.get('material:glow', 'toon') === styles.library.get('material:glow'); // true: unlit in every style
 * styles.dispose();
 * @see engine/gfx/materials/styles.test.ts
 * @see tests/e2e/materials-v2.spec.ts
 */
import { BRDF_Lambert, diffuseColor } from 'three/tsl';
import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  PhongLightingModel,
  Vector2,
  type Mesh,
  type LightingModelDirectInput,
  type Material,
  type MeshLambertNodeMaterialParameters,
  type Node,
  type Object3D,
} from 'three/webgpu';
import { codeError, defineCodes } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { TextureMaps } from '../textures/dataTexture';
import type { Warmup } from '../warmup';
import { createMaterialLibrary, type MaterialLibrary } from './library';
import { getMaterial, textureRefOf, type MaterialEntry } from './material';
import { createToonUniforms, MeshBandedToonNodeMaterial, type ToonLook, type ToonUniforms } from './toon';

/** The codes this module raises, with their fixes. */
export const STYLE_CODES = defineCodes('gfx', {
  GFX_UNKNOWN_STYLE: {
    template: 'there is no material style {style}',
    fix: 'use one of {styles}',
    doc: 'Raised by a style set (engine/gfx/materials/styles.ts) for a style name it does not have.',
  },
});

/** The material styles: v1's Lambert, toon, flat and pbr. */
export const MATERIAL_STYLES = ['lambert', 'toon', 'flat', 'pbr'] as const;

/** A material style (see `MATERIAL_STYLES`). */
export type MaterialStyle = (typeof MATERIAL_STYLES)[number];

/** Throws `GFX_UNKNOWN_STYLE` unless `style` is a material style. */
export function checkStyle(style: unknown): MaterialStyle {
  if (MATERIAL_STYLES.includes(style as MaterialStyle)) return style as MaterialStyle;
  throw codeError('GFX_UNKNOWN_STYLE', { style: JSON.stringify(style), styles: MATERIAL_STYLES.join(', ') });
}

/** The flat style's light: each light's colour where it reaches (shadow and falloff), with no N·L; ambient as Lambert. */
export class FlatStyleLighting extends PhongLightingModel {
  constructor() {
    super(false);
  }

  direct(input: LightingModelDirectInput): void {
    const { lightColor, reflectedLight } = input as LightingModelDirectInput & { lightColor: Node };
    reflectedLight.directDiffuse.addAssign(lightColor.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
  }
}

/** The flat style's material: Lambert's parameters, drawn by `FlatStyleLighting`. */
export class MeshFlatStyleNodeMaterial extends MeshLambertNodeMaterial {
  /** Its own type, so three.js never shares a compiled Lambert material's program with it. */
  static get type(): string {
    return 'MeshFlatStyleNodeMaterial';
  }

  setupLightingModel(): PhongLightingModel {
    return new FlatStyleLighting();
  }
}

const SIDES = { front: FrontSide, back: BackSide, double: DoubleSide } as const;

/** The parameters every lit style reads from `entry` and its maps (as v1 compiles them). */
function litParameters(entry: MaterialEntry, maps: TextureMaps | null): MeshLambertNodeMaterialParameters {
  return {
    name: entry.id,
    color: new Color(entry.color),
    map: maps?.map ?? null,
    transparent: entry.transparent,
    opacity: entry.opacity,
    alphaTest: entry.alphaTest,
    side: SIDES[entry.side],
    vertexColors: entry.vertexColors,
    fog: entry.fog,
    depthWrite: entry.depthWrite,
    normalMap: maps && entry.normalScale > 0 ? maps.normalMap : null,
    normalScale: new Vector2(entry.normalScale, entry.normalScale),
    emissive: new Color(entry.emissive),
    emissiveIntensity: entry.emissiveIntensity,
    emissiveMap: maps?.emissiveMap ?? null,
    flatShading: entry.flatShading,
  };
}

/**
 * The three.js material of a lit `entry` in `style` (not `lambert`, which v1 compiles), with `maps` baked from its
 * map and the toon look `toon`.
 */
export function compileStyled(
  entry: MaterialEntry,
  maps: TextureMaps | null,
  style: Exclude<MaterialStyle, 'lambert'>,
  toon: ToonUniforms,
): Material {
  const lit = litParameters(entry, maps);
  const material =
    style === 'toon'
      ? new MeshBandedToonNodeMaterial({ ...lit, normalMap: null }, toon)
      : style === 'flat'
        ? new MeshFlatStyleNodeMaterial({ ...lit, normalMap: null })
        : new MeshStandardNodeMaterial({
            ...lit,
            roughness: entry.roughness,
            metalness: entry.metalness,
            roughnessMap: maps?.roughnessMap ?? null,
          });
  material.userData = { material: entry.id, style };
  return material;
}

/** A page's materials in every style (see the file comment). */
export interface StyleSet {
  /** The library whose maps and v1 materials it shares. */
  readonly library: MaterialLibrary;
  /** The toon look's uniforms, shared by every toon material here. */
  readonly toon: ToonUniforms;
  /** The style meshes are drawn in now. */
  readonly style: MaterialStyle;
  /** Material `id` in `style` (the current one by default), compiled on first use. Throws `GFX_UNKNOWN_STYLE`. */
  get(id: string, style?: MaterialStyle): Material;
  /** Compiles every material of the registry in every style. */
  all(): Material[];
  /** The `<id>@<style>` pairs compiled so far, sorted. */
  readonly ids: readonly string[];
  /** Switches the style, and restyles what is visible under `root`; returns how many materials it re-pointed. */
  setStyle(style: MaterialStyle, root?: Object3D): number;
  /** Re-points every visible mesh under `root` to the current style; returns how many materials changed. */
  apply(root: Object3D): number;
  /** Warms every style of what `scene` draws, with `warmup` (see the file comment); `dispose()` undoes it. */
  attach(warmup: Warmup, scene: Object3D): { dispose(): void };
  /** Frees every material it made, and detaches. */
  dispose(): void;
}

/** How `createStyleSet` makes a set. */
export interface StyleSetOptions {
  /** The library to share (a new one over `registry` by default, freed with the set). */
  library?: MaterialLibrary;
  registry?: Registry;
  /** The starting style ('lambert' by default). */
  style?: MaterialStyle;
  /** The toon look (engine/gfx/materials/toon.ts's `TOON_LOOK` by default). */
  toon?: Partial<ToonLook>;
}

/** The warm-up entries' ids: one per style, then the one that puts every material back; after every other entry. */
export const STYLE_WARMUP_IDS = [...MATERIAL_STYLES.map((style) => `~styles/${style}`), '~styles~'] as const;

/** Whether `object` draws with a registry material (one that carries `userData.material`). */
function drawsRegistryMaterial(object: Object3D): boolean {
  const material = (object as Mesh).material as Material | Material[] | undefined;
  if (!material) return false;
  return (Array.isArray(material) ? material : [material]).some((m) => typeof m?.userData?.material === 'string');
}

/** Makes a style set (see the file comment). */
export function createStyleSet(options: StyleSetOptions = {}): StyleSet {
  const registry = options.registry ?? sharedRegistry;
  const library = options.library ?? createMaterialLibrary({ registry });
  const ownLibrary = !options.library;
  const toon = createToonUniforms(options.toon);
  let current = checkStyle(options.style ?? 'lambert');
  const compiled = new Map<string, Material>();
  const detach: (() => void)[] = [];

  /** `material` (one of an object's) in `style`: a registry material re-pointed, any other kept. */
  const restyled = (material: Material, style: MaterialStyle): Material => {
    const id = material?.userData?.material as unknown;
    return typeof id === 'string' ? set.get(id, style) : material;
  };

  /** `material` as `mesh` draws it: wrapped by its `userData.restyle`, when it has one (see the file comment). */
  const worn = (mesh: Mesh, material: Material): Material => {
    const wrap = mesh.userData.restyle as ((material: Material) => Material) | undefined;
    return typeof wrap === 'function' ? wrap(material) : material;
  };

  /** Points every visible mesh under `root` drawn with a registry material at `pick(material)`; counts the changes. */
  const repoint = (root: Object3D, pick: (mesh: Mesh, material: Material, i: number) => Material): number => {
    let changed = 0;
    root.traverseVisible((object) => {
      if (!drawsRegistryMaterial(object)) return;
      const mesh = object as Mesh;
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material, i, all) => {
          const next = pick(mesh, material, i);
          if (next !== material) [all[i], changed] = [next, changed + 1];
        });
      } else {
        const next = pick(mesh, mesh.material, 0);
        if (next !== mesh.material) [mesh.material, changed] = [next, changed + 1];
      }
    });
    return changed;
  };

  const set: StyleSet = {
    library,
    toon,
    get style() {
      return current;
    },
    get(id, style = current) {
      const entry = getMaterial(id, registry);
      const chosen = checkStyle(style);
      if (chosen === 'lambert' || entry.unlit) return library.get(entry.id);
      const key = `${entry.id}@${chosen}`;
      let material = compiled.get(key);
      if (!material) {
        const ref = textureRefOf(entry.map);
        material = compileStyled(entry, ref ? library.maps(ref) : null, chosen, toon);
        compiled.set(key, material);
      }
      return material;
    },
    all() {
      return registry.list('material').flatMap((entry) => MATERIAL_STYLES.map((style) => set.get(entry.id, style)));
    },
    get ids() {
      return [...compiled.keys()].sort();
    },
    setStyle(style, root) {
      current = checkStyle(style);
      return root ? set.apply(root) : 0;
    },
    apply(root) {
      return repoint(root, (mesh, material) => worn(mesh, restyled(material, current)));
    },
    attach(warmup, scene) {
      // What each mesh drew with before the warm-up swapped it, put back by the last entry.
      const kept = new Map<Mesh, Material[]>();
      const keep = () => {
        if (kept.size) return;
        scene.traverseVisible((object) => {
          if (!drawsRegistryMaterial(object)) return;
          const mesh = object as Mesh;
          kept.set(mesh, Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material]);
        });
      };
      const entries = MATERIAL_STYLES.map((style, i) =>
        warmup.register(STYLE_WARMUP_IDS[i], {
          objects: () => {
            keep();
            for (const [mesh, materials] of kept) {
              const next = materials.map((material) => worn(mesh, restyled(material, style)));
              mesh.material = Array.isArray(mesh.material) ? next : next[0];
            }
            return [];
          },
        }),
      );
      entries.push(
        warmup.register(STYLE_WARMUP_IDS[MATERIAL_STYLES.length], {
          objects: () => {
            for (const [mesh, materials] of kept)
              mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
            kept.clear();
            return [];
          },
        }),
      );
      const part = warmup.keyPart('styles', () => set.ids.join(','));
      const undo = () => {
        for (const entry of entries) entry.dispose();
        part.dispose();
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
      for (const material of compiled.values()) material.dispose();
      compiled.clear();
      if (ownLibrary) library.dispose();
    },
  };
  return set;
}
