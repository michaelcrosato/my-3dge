/**
 * @file Toon shading (PLAN.md WP 7.2, §5.8; doctrine: Quality under the hood): the `toon` material style. A toon
 * material is `MeshBandedToonNodeMaterial`, three.js's Lambert node material with its own lighting model,
 * `BandedToonLighting`, after shardfall's cel style (`shardfall:crates/pav_render/src/shaders/scene.wgsl:200-257`):
 * every light's diffuse share, N·L times its shadow and distance falloff, is cut into bands (`bandsOf`, the smoothed
 * bands: hard edges a pixel wide, from `fwidth`), so shadow terminators and the pools of point lights band like the
 * sun's light; a rim, gated by each light (a fresnel step at 0.72, 40% of it unlit), outlines the forms from inside.
 * Ambient and hemisphere light stay smooth. Its look, `bands` and `rim`, is a set of uniforms (`createToonUniforms`)
 * that every toon material of a style set shares, so retuning builds no pipeline; 2 bands or fewer is a hard
 * terminator at N·L = 0.02, as in shardfall.
 *
 * The baseline it was measured against is the carried one: `MeshToonMaterial` with a generated gradient map
 * (`toonGradientMap`, `TOON_BANDS`, `my-3d2dge:src/stress-world/00-setup.js:91-95` and lab3d's `toonMat`,
 * `src/lab3d/10-materials.js:80-90`). The comparison that chose the bands (tests/e2e/materials-v2.spec.ts, on
 * tests/pages/materials-v2.html's comparison scene: an orthographic camera looking down at 35°, a sphere, a floor, a
 * shadow-casting sun, a point light's pool; luma against the Lambert render of the same scene; thumbnails
 * `materials-v2-toon-bands` and `materials-v2-toon-gradient` in tests/baselines/thumbs/):
 * - the gradient map follows the wrong light: r182's `ToonLightingModel` dots the geometry's own normal
 *   (`normalGeometry`, before the object's, the instance's and the camera's turns) with a view-space light, so its
 *   lit side wanders as the camera turns: luma correlation with Lambert on the sphere 0.74, against 0.96 here;
 * - the point light's pool stays a smooth falloff there (61 luma levels of 0.5% or more), 3 here;
 * - it has no rim: on the sphere's unlit half, its outer ring is 0.07 darker than the ring inside, 0.02 brighter here.
 *
 * Invariants: the same diffuse scale as Lambert (a fully lit band is Lambert at N·L = 1), so a scene's lights suit
 * every style; reads a light's base colour through its node (`baseColorNode`, else `colorNode`), never its id.
 *
 * @example
 * const toon = createToonUniforms({ bands: 4 });
 * toon.bands.value; // 4
 * new MeshBandedToonNodeMaterial({ color: '#c8a070' }, toon).type; // 'MeshBandedToonNodeMaterial'
 * Array.from(toonGradientMap().image.data.slice(0, 4)); // [90, 90, 90, 255]
 * @see engine/gfx/materials/toon.test.ts
 * @see tests/e2e/materials-v2.spec.ts
 */
import {
  BRDF_Lambert,
  diffuseColor,
  float,
  floor,
  fwidth,
  luminance,
  max,
  mix,
  normalView,
  positionViewDirection,
  smoothstep,
  step,
  uniform,
} from 'three/tsl';
import {
  DataTexture,
  MeshLambertNodeMaterial,
  MeshToonNodeMaterial,
  NearestFilter,
  PhongLightingModel,
  type LightingModelDirectInput,
  type MeshLambertNodeMaterialParameters,
  type MeshToonNodeMaterialParameters,
  type Node,
  type UniformNode,
} from 'three/webgpu';

/** The carried gradient map's levels (0–255): shadow, base, lit, as the prototype's puppets drew them. */
export const TOON_BANDS = [90, 170, 255] as const;

/** A toon look: how many bands of light, and how strong the rim is (0 for none). */
export interface ToonLook {
  /** Bands of direct light, 2–8; 2 or fewer is a hard terminator. */
  bands: number;
  /** The rim's strength, 0–1, as a share of the light's diffuse colour. */
  rim: number;
}

/** The default look: three bands (shadow, base, lit) and shardfall's rim. */
export const TOON_LOOK: Readonly<ToonLook> = { bands: 3, rim: 0.25 };

/** A toon look as uniforms: set `.value` (or `set`) and every material reading them follows, building nothing. */
export interface ToonUniforms {
  readonly bands: UniformNode<number>;
  readonly rim: UniformNode<number>;
  /** Changes part of the look; values are clamped to their ranges. */
  set(look: Partial<ToonLook>): void;
  /** The look now. */
  values(): ToonLook;
}

/** Makes a look's uniforms, from `TOON_LOOK` and `look`. */
export function createToonUniforms(look: Partial<ToonLook> = {}): ToonUniforms {
  const bands = uniform(TOON_LOOK.bands);
  const rim = uniform(TOON_LOOK.rim);
  const uniforms: ToonUniforms = {
    bands,
    rim,
    set(next) {
      if (next.bands !== undefined) bands.value = Math.min(8, Math.max(2, Math.round(next.bands)));
      if (next.rim !== undefined) rim.value = Math.min(1, Math.max(0, next.rim));
    },
    values: () => ({ bands: bands.value, rim: rim.value }),
  };
  uniforms.set(look);
  return uniforms;
}

/** The carried baseline's gradient map: one texel per level (`TOON_BANDS`), grey, nearest, for `MeshToonMaterial`. */
export function toonGradientMap(levels: readonly number[] = TOON_BANDS): DataTexture {
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((level, i) => data.set([level, level, level, 255], i * 4));
  const texture = new DataTexture(data, levels.length, 1);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A share of light, 0–1, cut into `bands` bands: the levels 0, 1/(bands − 1) … 1, each edge smoothed over about a
 * pixel (`fwidth`) so it never shimmers; 2 bands or fewer is lit wherever the share passes 0.02.
 */
export function bandsOf(share: Node, bands: Node): Node {
  const levels = max(float(bands).sub(1), 1);
  const scaled = float(share).mul(levels);
  const below = floor(scaled);
  const edge = fwidth(scaled).clamp(0.02, 0.5);
  const banded = below.add(smoothstep(edge.oneMinus().mul(0.5), edge.add(1).mul(0.5), scaled.sub(below))).div(levels);
  const hard = smoothstep(fwidth(share).negate().add(0.02), fwidth(share).add(0.02), share);
  // Arithmetic, not a branch: derivatives (fwidth) need uniform control flow, and r182's select() becomes an if.
  return mix(banded, hard, step(float(bands), float(2.5)));
}

/** What a light node keeps: its colour without shadow (once it casts), and the light. */
interface LightNodeColours {
  colorNode: Node;
  baseColorNode?: Node | null;
  light?: { isDirectionalLight?: boolean } | null;
}

/**
 * The toon lighting model (see the file comment): banded direct light and a gated rim per light, on Lambert's diffuse
 * scale; indirect light and the environment as Lambert's (it extends three.js's Phong model without specular).
 */
export class BandedToonLighting extends PhongLightingModel {
  readonly look: ToonUniforms;

  constructor(look: ToonUniforms) {
    super(false);
    this.look = look;
  }

  direct(input: LightingModelDirectInput): void {
    const { lightDirection, lightColor, reflectedLight } = input as LightingModelDirectInput & {
      lightDirection: Node;
      lightColor: Node;
    };
    const light = input.lightNode as unknown as LightNodeColours;
    const base = light.baseColorNode ?? light.colorNode;
    // The light's share here: its falloff and shadow, without its colour and intensity.
    const reach = luminance(lightColor)
      .div(max(luminance(base), 1e-6))
      .clamp(0, 1);
    const share = max(normalView.dot(lightDirection), 0).mul(reach);
    const lit = bandsOf(share, this.look.bands);
    const diffuse = BRDF_Lambert({ diffuseColor: diffuseColor.rgb });
    // The rim: grazing view, gated by the light (a directional light's rim survives its shadow at 40%).
    const facing = max(normalView.dot(positionViewDirection), 0).oneMinus();
    const width = fwidth(facing).clamp(0.005, 0.1);
    const rim = smoothstep(width.negate().add(0.72), width.add(0.72), facing).mul(this.look.rim);
    const gate = mix(float(0.4), float(1), lit).mul(light.light?.isDirectionalLight ? float(1) : reach);
    reflectedLight.directDiffuse.addAssign(base.mul(diffuse).mul(lit.add(rim.mul(gate))));
  }
}

/** The toon material: Lambert's parameters (`color`, `map`, `normalMap`, `emissive`…), drawn by `BandedToonLighting`. */
export class MeshBandedToonNodeMaterial extends MeshLambertNodeMaterial {
  /** Its own type, so three.js never shares a compiled Lambert material's program with it. */
  static get type(): string {
    return 'MeshBandedToonNodeMaterial';
  }

  readonly toon: ToonUniforms;

  constructor(parameters: MeshLambertNodeMaterialParameters = {}, toon: ToonUniforms = createToonUniforms()) {
    super(parameters);
    this.toon = toon;
  }

  setupLightingModel(): BandedToonLighting {
    return new BandedToonLighting(this.toon);
  }
}

/** The measured baseline (see the file comment): three.js's toon material with the carried gradient map. */
export function gradientToonMaterial(
  parameters: MeshToonNodeMaterialParameters,
  gradientMap: DataTexture,
): MeshToonNodeMaterial {
  return new MeshToonNodeMaterial({ ...parameters, gradientMap });
}
