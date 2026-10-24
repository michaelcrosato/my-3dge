/**
 * @file Toon shading (PLAN.md WP 7.2, §5.8; doctrine: Quality under the hood): the `toon` material style. A toon
 * material is `MeshBandedToonNodeMaterial`, three.js's Lambert node material with its own lighting model,
 * `BandedToonLighting`, after shardfall's cel style (`shardfall:crates/pav_render/src/shaders/scene.wgsl:200-257`):
 * every light's diffuse share, N·L times its shadow and distance falloff, is cut into bands (`bandsOf`, the smoothed
 * bands: hard edges a pixel wide, from `fwidth`), so shadow terminators and the pools of point lights band like the
 * sun's light; a rim, gated by each light (a fresnel step at 0.72, 40% of it unlit), outlines the forms from inside.
 * Ambient and hemisphere light stay smooth. Its look is a set of uniforms (`createToonUniforms`) that every toon
 * material of a style set shares, so retuning builds no pipeline; 2 bands or fewer is a hard terminator at N·L = 0.02.
 *
 * Each material's ramp (WP 13.24, docs/PLAYGROUND.md §5.2): its lit colour, and the shade its shadows take, which
 * `shade` (0 to 1) turns from the colour darkened toward the colour shifted in hue, cooled and more saturated
 * (`shadeOf`: times `SHADE_TINT`), so a material's light falls from its own colour to its own shade, never to grey.
 * `dither` (0 to 1, pixel art) makes the bands' edges hard and, where the light changes across the picture, mixes
 * neighbouring bands over that share of each step by a 4 × 4 ordered pattern (`bayer4`) laid on the grid `grid` names:
 * cells of a block's pixels, counted from where the post chain snapped the camera, so on a snapped orthographic camera
 * the pattern stays on the world as the camera moves; 0 keeps the smoothed edges.
 *
 * The baseline it was measured against: `MeshToonMaterial` with a generated gradient map (`toonGradientMap`,
 * `TOON_BANDS`, `my-3d2dge:src/stress-world/00-setup.js:91-95`). The comparison that chose the bands
 * (tests/e2e/materials-v2.spec.ts: an orthographic camera looking down at 35°, a sphere, a floor, a shadow-casting
 * sun, a point light's pool; luma against the Lambert render; thumbnails `materials-v2-toon-*`):
 * - the gradient map follows the wrong light: r182's `ToonLightingModel` dots the geometry's own normal
 *   (`normalGeometry`, before the object's, the instance's and the camera's turns) with a view-space light, so its
 *   lit side wanders as the camera turns: luma correlation with Lambert on the sphere 0.74, against 0.96 here;
 * - the point light's pool stays a smooth falloff there (61 luma levels of 0.5% or more), 3 here;
 * - it has no rim: on the sphere's unlit half, its outer ring is 0.07 darker than the ring inside, 0.02 brighter here.
 *
 * Invariants: the same diffuse scale as Lambert (a fully lit band is Lambert at N·L = 1), so a scene's lights suit
 * every style; `shade` and `dither` 0 draw as before them; reads a light's base colour through its node
 * (`baseColorNode`, else `colorNode`), never its id.
 *
 * @example
 * const toon = createToonUniforms({ bands: 4, shade: 0.6 });
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
  renderGroup,
  saturation,
  screenCoordinate,
  smoothstep,
  step,
  uniform,
  vec3,
} from 'three/tsl';
import {
  DataTexture,
  MeshLambertNodeMaterial,
  MeshToonNodeMaterial,
  NearestFilter,
  PhongLightingModel,
  Vector3,
  type LightingModelDirectInput,
  type NodeBuilder,
  type MeshLambertNodeMaterialParameters,
  type MeshToonNodeMaterialParameters,
  type Node,
  type UniformNode,
} from 'three/webgpu';

/** The carried gradient map's levels (0–255): shadow, base, lit, as the prototype's puppets drew them. */
export const TOON_BANDS = [90, 170, 255] as const;

/** What a shade multiplies a colour by before its saturation is raised: cooler, toward violet (see the file comment). */
export const SHADE_TINT = [0.8, 0.72, 1] as const;

/** A toon look: how many bands of light, how strong the rim is, how far shadows shift in hue, and the bands' dither. */
export interface ToonLook {
  /** Bands of direct light, 2–8; 2 or fewer is a hard terminator. */
  bands: number;
  /** The rim's strength, 0–1, as a share of the light's diffuse colour. */
  rim: number;
  /** How far each material's shade shifts in hue from its colour darkened, 0–1 (`shadeOf`). */
  shade: number;
  /** The share of each band's step mixed by the ordered pattern, 0–1; above 0 the edges are hard (pixel art). */
  dither: number;
}

/** The default look: three bands (shadow, base, lit), shardfall's rim, shadows darkened, smoothed edges. */
export const TOON_LOOK: Readonly<ToonLook> = { bands: 3, rim: 0.25, shade: 0, dither: 0 };

/** A toon look as uniforms: set `.value` (or `set`) and every material reading them follows, building nothing. */
export interface ToonUniforms {
  readonly bands: UniformNode<number>;
  readonly rim: UniformNode<number>;
  readonly shade: UniformNode<number>;
  readonly dither: UniformNode<number>;
  /** The dither's grid: (cells across, cells down, cell size in pixels), the post chain's each frame. */
  readonly grid: UniformNode<Vector3>;
  /** Changes part of the look; values are clamped to their ranges. */
  set(look: Partial<ToonLook>): void;
  /** The look now. */
  values(): ToonLook;
}

/**
 * Makes a look's uniforms, from `TOON_LOOK` and `look`: render-group uniforms, so a still mesh draws a change the next
 * frame (an object-group one waits for its object or material to change, engine/gfx/sky.ts).
 */
export function createToonUniforms(look: Partial<ToonLook> = {}): ToonUniforms {
  const each = (value: number) => uniform(value).setGroup(renderGroup);
  const [bands, rim, shade, dither] = [each(TOON_LOOK.bands), each(TOON_LOOK.rim), each(0), each(0)];
  const grid = uniform(new Vector3(0, 0, 1)).setGroup(renderGroup);
  const unit = (value: number) => Math.min(1, Math.max(0, value));
  const uniforms: ToonUniforms = {
    bands,
    rim,
    shade,
    dither,
    grid,
    set(next) {
      if (next.bands !== undefined) bands.value = Math.min(8, Math.max(2, Math.round(next.bands)));
      if (next.rim !== undefined) rim.value = unit(next.rim);
      if (next.shade !== undefined) shade.value = unit(next.shade);
      if (next.dither !== undefined) dither.value = unit(next.dither);
    },
    values: () => ({ bands: bands.value, rim: rim.value, shade: shade.value, dither: dither.value }),
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

/**
 * A share of light, 0–1, in `bands` hard bands (the levels of `bandsOf`), each step's edge at its middle moved by
 * `threshold` (0–1; 0.5 is the middle), so a threshold from an ordered pattern dithers the edge; 2 bands or fewer is
 * lit wherever the share passes 0.02. No derivatives: it may sit anywhere.
 */
export function ditheredBandsOf(share: Node, bands: Node, threshold: Node): Node {
  const levels = max(float(bands).sub(1), 1);
  const scaled = float(share).mul(levels);
  const below = floor(scaled);
  const banded = below.add(step(threshold, scaled.sub(below))).div(levels);
  return mix(banded, step(0.02, share), step(float(bands), float(2.5)));
}

/** `a` modulo `b` for floats, never negative (WGSL's `%` keeps the sign of `a`). */
const wrap = (a: Node, b: number) => a.sub(floor(a.div(b)).mul(b));

/** Bayer's 2 × 2 order at whole (x, y) in 0–1: 0, 2, 3, 1 (as 0–3). */
const bayer2 = (x: Node, y: Node) => wrap(x.mul(2).add(y.mul(3)), 4);

/**
 * The 4 × 4 ordered pattern's threshold (0–1, a cell's rank plus a half, over 16) at the whole cell `cell`: the
 * composite's table (engine/gfx/post/shaders/common.ts `post_bayer4`), built from the 2 × 2 order, any cell
 * (negative ones too) in the pattern.
 */
export function bayer4(cell: Node): Node {
  const m = wrap(floor(cell), 4);
  const low = wrap(m, 2);
  const high = floor(m.div(2));
  return bayer2(low.x, low.y).mul(4).add(bayer2(high.x, high.y)).add(0.5).div(16);
}

/** The ordered threshold this fragment takes on `grid` (cells counted from the snapped camera; see the file comment). */
export function gridThreshold(grid: Node): Node {
  return bayer4(floor(screenCoordinate.xy.div(max(grid.z, 1))).add(grid.xy));
}

/** A colour's shade (see the file comment): `colour` times `SHADE_TINT`, more saturated, `shade` (0–1) of the way. */
export function shadeOf(colour: Node, shade: Node): Node {
  const cooled = saturation(colour.mul(vec3(...SHADE_TINT)), float(shade).mul(0.4).add(1));
  return mix(colour, max(cooled, vec3(0)), shade);
}

/** What a light node keeps: its colour without shadow (once it casts), and the light. */
interface LightNodeColours {
  colorNode: Node;
  baseColorNode?: Node | null;
  light?: { isDirectionalLight?: boolean } | null;
}

/**
 * The toon lighting model (see the file comment): banded direct light and a gated rim per light, on Lambert's diffuse
 * scale; indirect light and the environment as Lambert's on the material's shade (it extends three.js's Phong model
 * without specular).
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
    const { bands, dither, grid } = this.look;
    // The edge on the ordered pattern, `dither` of the way from the step's middle where the light changes across the
    // picture (a pool's falloff, a terminator, a shadow's edge); a flat share keeps a hard band, never a whole surface
    // of dither. Smoothed while `dither` is 0.
    const changing = smoothstep(0.002, 0.02, fwidth(share.mul(max(float(bands).sub(1), 1))));
    const threshold = mix(float(0.5), gridThreshold(grid), dither.mul(changing));
    const lit = mix(bandsOf(share, bands), ditheredBandsOf(share, bands, threshold), step(1e-3, dither));
    const diffuse = BRDF_Lambert({ diffuseColor: diffuseColor.rgb });
    // The rim: grazing view, gated by the light (a directional light's rim survives its shadow at 40%).
    const facing = max(normalView.dot(positionViewDirection), 0).oneMinus();
    const width = fwidth(facing).clamp(0.005, 0.1);
    const rim = smoothstep(width.negate().add(0.72), width.add(0.72), facing).mul(this.look.rim);
    const gate = mix(float(0.4), float(1), lit).mul(light.light?.isDirectionalLight ? float(1) : reach);
    reflectedLight.directDiffuse.addAssign(base.mul(diffuse).mul(lit.add(rim.mul(gate))));
  }

  /** Lambert's indirect light on the material's shade (`shadeOf`): what lights the shadows takes their hue. */
  indirect(builder: NodeBuilder): void {
    const { ambientOcclusion, irradiance, reflectedLight } = (builder as unknown as { context: IndirectContext })
      .context;
    const shade = shadeOf(diffuseColor.rgb, this.look.shade);
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: shade })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

/** What r182's lighting context hands `indirect`. */
interface IndirectContext {
  ambientOcclusion: Node;
  irradiance: Node;
  reflectedLight: { indirectDiffuse: Node };
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

  /** Copies `source`, its toon look's uniforms shared (so a clone, the viewmodel's among them, keeps the look's bands). */
  copy(source: MeshBandedToonNodeMaterial): this {
    super.copy(source);
    (this as { toon: ToonUniforms }).toon = source.toon;
    return this;
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
