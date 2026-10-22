/**
 * @file The terrain's splat (PLAN.md WP 10.5): `createTerrainSplat(terrain, layers)` gives `wrap(material)`, what a
 * terrain chunk (engine/gfx/terrain.ts) draws with: a node material copy of `material` (engine/gfx/materials/
 * nodeCopy.ts), the ground layer's material in whatever style the style set points it at (engine/gfx/materials/
 * styles.ts calls `wrap` through the chunks' `userData.restyle`), its colour mixing three layers at every fragment:
 * - the ground: the material's own colour and map;
 * - the steep, where the ground rises `terrain.steep` metres a metre or more (read off the fragment's world normal),
 *   blending in over ±`BAND` of that grade;
 * - the high, from `terrain.high` metres over the terrain's origin up (none at 0), blending in over a metre either way;
 * each layer its material's colour times its map at the map's repeat (the chunks' UVs are world metres), the steep
 * over the high over the ground, the edges between them wavering by fractal noise over the ground (tslNoise.ts) so no
 * contour line shows, and the whole varied ±8% at the scale of 24 m, as a level's floor is.
 *
 * Invariants: presentation only; one copy per source material, made on first use; a copy's own uuid and its source's
 * `userData`, so the style set re-points it by its entry; `dispose` frees the copies (the sources stay the library's).
 * A material three.js cannot copy is drawn as it is: the ground alone.
 *
 * @example
 * import { MeshLambertMaterial } from 'three/webgpu';
 * const splat = createTerrainSplat({ steep: 0.7, high: 0, origin: [0, 0, 0] }, [new MeshLambertMaterial(), new MeshLambertMaterial()]);
 * const ground = new MeshLambertMaterial();
 * [splat.wrap(ground) === splat.wrap(ground), splat.owns(splat.wrap(ground)), splat.wrap(splat.wrap(ground)) === splat.wrap(ground)]; // [true, true, true]
 * splat.dispose();
 * @see engine/gfx/terrain.test.ts
 */
import { float, mix, normalWorld, positionWorld, smoothstep, texture, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { Material, MeshLambertMaterial, Node, Texture } from 'three/webgpu';
import type { Terrain } from '../world/terrain';
import { nodeCopy } from './materials/nodeCopy';
import { fractalNode, variationNode } from './textures/tslNoise';

/** How far either side of the steep grade (m a metre) the steep layer blends in. */
export const BAND = 0.15;

/** The terrain's splat: its materials (see the file comment). */
export interface TerrainSplat {
  /** `material` (the ground layer's, in any style) drawn with the layers mixed in; made once per source. */
  wrap(material: Material): Material;
  /** Whether `material` is one of its copies. */
  owns(material: Material): boolean;
  /** Frees the copies. */
  dispose(): void;
}

/** A layer's colour node: its material's colour times its map at the map's repeat, over world-metre UVs. */
function layerColor(material: Material): Node {
  const { color, map } = material as MeshLambertMaterial & { map: Texture | null };
  const tint = color ? vec3(color.r, color.g, color.b) : vec3(1, 1, 1);
  if (!map) return tint as unknown as Node;
  return texture(map, uv().mul(vec2(map.repeat.x, map.repeat.y))).rgb.mul(tint) as unknown as Node;
}

/** Makes the splat of `terrain`, `layers` the steep and the high layers' materials (see the file comment). */
export function createTerrainSplat(
  terrain: Pick<Terrain, 'steep' | 'high' | 'origin'>,
  layers: readonly Material[],
): TerrainSplat {
  const copies = new Map<Material, Material>();
  const own = new Set<Material>();
  const [steep, high] = [layers[0], layers[1]];
  // The wavering of the layers' edges: fractal noise in [−0.5, 0.5] over 6 m features.
  const waver = fractalNode(vec2(positionWorld.x, positionWorld.z).div(6), { octaves: 3, seed: 7 }).sub(0.5);
  const up = normalWorld.y.max(0.05);
  const grade = float(1).sub(up.mul(up)).max(0).sqrt().div(up).add(waver.mul(0.2));
  const steepWeight = smoothstep(terrain.steep - BAND, terrain.steep + BAND, grade);
  const above = positionWorld.y.sub(terrain.origin[1]).add(waver.mul(1.5));
  const highWeight = smoothstep(terrain.high - 1, terrain.high + 1, above);
  const variation = variationNode({ scale: 24, amount: 0.08, seed: 3 });
  const steepColor = steep ? layerColor(steep) : null;
  const highColor = high && terrain.high > 0 ? layerColor(high) : null;
  return {
    wrap(material) {
      if (own.has(material)) return material;
      const made = copies.get(material);
      if (made) return made;
      const copy = nodeCopy(material);
      if (!copy) return material;
      let color: Node = layerColor(material);
      if (highColor) color = mix(color, highColor, highWeight) as unknown as Node;
      if (steepColor) color = mix(color, steepColor, steepWeight) as unknown as Node;
      copy.colorNode = vec4(color.mul(variation), 1) as unknown as Node;
      copy.name = `${material.name || material.type}+splat`;
      copies.set(material, copy);
      own.add(copy);
      return copy;
    },
    owns: (material) => own.has(material),
    dispose() {
      for (const copy of own) copy.dispose();
      copies.clear();
      own.clear();
    },
  };
}
