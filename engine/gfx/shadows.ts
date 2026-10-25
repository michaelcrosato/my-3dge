/**
 * @file The shadow budget (PLAN.md WP 7.1, I-17): how many lights cast shadows, and how a caster is set up. At most
 * `MAX_SHADOW_CASTERS` (2) lights cast at once, the most important ones: the light pool's first slots
 * (engine/gfx/lights.ts), which it fills with its best-ranked lights, and a sky's sun (engine/gfx/sky.ts), which
 * takes the first caster when it shines. The quality tier lowers the budget (engine/gfx/quality.ts, WP 3.12): one
 * caster at `medium`, none at `low`. `enableShadows` sets the renderer's shadow map and its type, the one place that
 * names the type (docs/THREE-DELTA.md: r186 removes `PCFSoftShadowMap` from WebGPU, so the engine uses
 * `PCFShadowMap`).
 *
 * Why casters are reassigned rather than switched: r182's lights node keys every lit shader on each light's id and
 * `castShadow` (engine/gfx/warmup.ts), so turning a light's shadow on or off rebuilds every lit pipeline. A caster
 * slot therefore keeps casting while the pool moves it from light to light; only a new tier or a preset with or
 * without a sun changes who casts, and the shader key changes with it, so the renderer warms up again first instead
 * of stalling a frame.
 *
 * Invariants: a budget is a whole number from 0 to `MAX_SHADOW_CASTERS`; point casters carry the prototype's shadow
 * settings (a 512 × 512 map, near 0.1 m, bias −0.002), and r182 sets a point shadow's far plane to the light's
 * distance itself. A point caster also carries a `target`, which nothing aims: once a light has cast, r182 reads its
 * shadow's matrix each render through `LightShadow.updateMatrices`, which looks at `light.target`, and a point light
 * that stops casting (a sun taking the budget, WP 11.5's `look:daylight` after the torch-lit hall) threw there.
 *
 * The filter (WP 13.24): every caster filters through r182's PCF filters (`PCFShadowFilter`, `PointShadowFilter`),
 * copied here as `SNAPPED_PCF` and `SNAPPED_POINT` with one change: the noise that turns each pixel's five samples is
 * read where the pixel's spot lies on the frame's pixel grid (`SHADOW_GRID`, set by the post chain each frame,
 * engine/gfx/post/chain.ts), not where it lies on the screen. A camera snapped by whole blocks then moves the shadows'
 * edges with the world, as it does the toon ramp's dither (engine/gfx/materials/toon.ts); r182's screen-fixed noise
 * changed the edges' pixels at every snap. Outside the chain's frames the grid is (0, 0, 1), and the filters give r182's
 * values exactly. `snapShadow` sets a light's filter (`LightShadow.filterNode`, which r182's ShadowNode reads before the
 * renderer's shadow map type, `ShadowNode.js:508`); a cascade's shadow, cloned from the sun's, needs it set again
 * (engine/gfx/enhanced/csm.ts), since `LightShadow.copy` leaves it behind.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:442-463`: the two shadow lights that take over the lit torches
 * nearest the hero, and their shadow settings.
 *
 * @example
 * shadowCasters({ shadowCasters: null }); // 2: 'high' caps nothing, so the engine's own budget holds
 * shadowCasters({ shadowCasters: 1 }); // 1: 'medium'
 * splitCasters(2, { sun: true, points: true }); // { sun: true, points: 1 }
 * @see engine/gfx/shadows.test.ts
 */
import {
  abs,
  cross,
  cubeTexture,
  Fn,
  int,
  interleavedGradientNoise,
  normalize,
  reference,
  renderGroup,
  screenCoordinate,
  texture,
  uniform,
  vec2,
  vec3,
  vogelDiskSample,
} from 'three/tsl';
import {
  Object3D,
  PCFShadowMap,
  Vector3,
  type CubeTexture,
  type DepthTexture,
  type LightShadow,
  type Node,
  type PointLight,
  type ShadowMapType,
  type Texture,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import type { QualityBudget } from './quality';

/** The most lights that cast shadows at once: the budget at the `high` tier. */
export const MAX_SHADOW_CASTERS = 2;

/** The shadow map type every caster uses (r182's `PCFShadowMap`; see the file comment). */
export const SHADOW_MAP_TYPE: ShadowMapType = PCFShadowMap;

/** A point caster's shadow settings, carried from the prototype's shadow lights. */
export const POINT_SHADOW = { mapSize: 512, near: 0.1, bias: -0.002 } as const;

/** How many lights may cast shadows under `budget` (a quality tier's, engine/gfx/quality.ts). */
export function shadowCasters(budget: Pick<QualityBudget, 'shadowCasters'>): number {
  const cap = budget.shadowCasters ?? MAX_SHADOW_CASTERS;
  return Math.max(0, Math.min(MAX_SHADOW_CASTERS, Math.floor(cap)));
}

/** Who casts shadows: whether the sun does, and how many of the light pool's first slots. */
export interface Casters {
  sun: boolean;
  points: number;
}

/** Who casts under a budget of `casters`: the sun first when it shines, then the point lights when they shine. */
export function splitCasters(casters: number, shining: { sun: boolean; points: boolean }): Casters {
  const sun = shining.sun && casters > 0;
  return { sun, points: shining.points ? casters - (sun ? 1 : 0) : 0 };
}

/** Turns the renderer's shadow map on, with the engine's one shadow map type. */
export function enableShadows(renderer: Pick<WebGPURenderer, 'shadowMap'>): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SHADOW_MAP_TYPE;
}

/** Gives a point light the caster's shadow settings (`POINT_SHADOW`); whether it casts is the budget's call. */
export function configurePointCaster(light: PointLight): void {
  light.shadow.mapSize.set(POINT_SHADOW.mapSize, POINT_SHADOW.mapSize);
  light.shadow.camera.near = POINT_SHADOW.near;
  light.shadow.bias = POINT_SHADOW.bias;
  // r182's `lightShadowMatrix` (src/nodes/accessors/Lights.js:47) calls `LightShadow.updateMatrices` for a light that
  // no longer casts, and that reads `light.target`, which a point light lacks (see the file comment).
  Object.assign(light, { target: (light as PointLight & { target?: Object3D }).target ?? new Object3D() });
  snapShadow(light.shadow);
}

/**
 * The frame's pixel grid as the filters' noise reads it: (whole blocks across, whole blocks down, the block in pixels),
 * the post chain's each frame (engine/gfx/post/grid.ts `frameGrid`), (0, 0, 1) outside its frames.
 */
export const SHADOW_GRID = uniform(new Vector3(0, 0, 1)).setGroup(renderGroup);

/** The turn of a pixel's samples (rad): r182's noise, read at the pixel's spot on the frame's grid (file comment). */
const turn = () => interleavedGradientNoise(screenCoordinate.xy.add(SHADOW_GRID.xy.mul(SHADOW_GRID.z))).mul(6.28318530718); // prettier-ignore

/** A shadow's `name` field as the render group's uniform, as r182's filters read it (the pinned types lack `setGroup`). */
const field = (name: string, type: string, shadow: LightShadow): Node =>
  (reference(name, type, shadow) as unknown as UniformNode<unknown>).setGroup(renderGroup);

/** The mean of r182's five Vogel-disk samples turned by `turn()`, each `sample(offset)` one depth comparison. */
function vogelMean(sample: (offset: Node) => Node): Node {
  const phi = turn();
  return [0, 1, 2, 3, 4].map((i) => sample(vogelDiskSample(int(i), int(5), phi))).reduce((sum, s) => sum.add(s)).mul(1 / 5); // prettier-ignore
}

/** What r182's ShadowNode hands a 2D map's filter (`ShadowNode.js:516`; a type, so TSL's `Fn` takes it). */
type MapFilterInputs = { depthTexture: DepthTexture; shadowCoord: Node; shadow: LightShadow; depthLayer: Node };

/** r182's `PCFShadowFilter` (ShadowFilterNode.js), its noise on the frame's grid: the sun's and its cascades'. */
export const SNAPPED_PCF = Fn(({ depthTexture, shadowCoord, shadow, depthLayer }: MapFilterInputs) => {
  const radiusScaled = field('radius', 'float', shadow).mul(vec2(1).div(field('mapSize', 'vec2', shadow)).x);
  return vogelMean((offset) => {
    const depth = texture(depthTexture, shadowCoord.xy.add(offset.mul(radiusScaled)));
    return ((depthTexture.isArrayTexture ? depth.depth(depthLayer) : depth) as typeof depth).compare(shadowCoord.z);
  });
});

/** r182's `PointShadowFilter` (PointShadowNode.js), its noise on the frame's grid: the light pool's casters'. */
export const SNAPPED_POINT = Fn(
  ({ depthTexture, bd3D, dp, shadow }: { depthTexture: Texture; bd3D: Node; dp: Node; shadow: LightShadow }) => {
    const texelSize = field('radius', 'float', shadow).div(field('mapSize', 'vec2', shadow).x);
    const cube = depthTexture as CubeTexture; // r182's CubeDepthTexture, which its cubeTexture samples
    const absDir = abs(bd3D);
    const tangent = normalize(cross(bd3D, absDir.x.greaterThan(absDir.z).select(vec3(0, 1, 0), vec3(1, 0, 0))));
    const bitangent = cross(bd3D, tangent);
    return vogelMean((offset) =>
      cubeTexture(cube, bd3D.add(tangent.mul(offset.x).add(bitangent.mul(offset.y)).mul(texelSize))).compare(dp),
    );
  },
);

/** Gives `shadow` the engine's filter for its kind (see the file comment): a point light's for a cube map. */
export function snapShadow(shadow: LightShadow): void {
  const point = (shadow as LightShadow & { isPointLightShadow?: boolean }).isPointLightShadow === true;
  Object.assign(shadow, { filterNode: point ? SNAPPED_POINT : SNAPPED_PCF });
}
