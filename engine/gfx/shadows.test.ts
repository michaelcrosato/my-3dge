/**
 * @file Unit tests for the shadow budget (engine/gfx/shadows.ts): two casters at `high`, one at `medium`, none at
 * `low`, the sun taking the first, and the renderer's one shadow map type; a point caster's shadow matrix can be read
 * as r182 reads it once the light has stopped casting; every caster filters through the engine's copies of r182's
 * filters, whose noise reads the frame's grid. The pixels those filters give are tests/e2e/playground-looks.spec.ts's.
 */
import { DirectionalLight, PCFShadowMap, PointLight, type LightShadow } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { qualityBudget } from './quality';
import {
  configurePointCaster,
  enableShadows,
  MAX_SHADOW_CASTERS,
  POINT_SHADOW,
  SHADOW_GRID,
  shadowCasters,
  snapShadow,
  SNAPPED_PCF,
  SNAPPED_POINT,
  splitCasters,
} from './shadows';

/** The filter r182's ShadowNode takes for `shadow` before the shadow map type's. */
const filterOf = (shadow: LightShadow) => (shadow as LightShadow & { filterNode?: unknown }).filterNode;

describe('shadowCasters', () => {
  it('affords 2 casters at high, 1 at medium and none at low; auto is medium on touch screens', () => {
    expect(MAX_SHADOW_CASTERS).toBe(2);
    expect(shadowCasters(qualityBudget('high', false))).toBe(2);
    expect(shadowCasters(qualityBudget('auto', false))).toBe(2);
    expect(shadowCasters(qualityBudget('medium', false))).toBe(1);
    expect(shadowCasters(qualityBudget('auto', true))).toBe(1);
    expect(shadowCasters(qualityBudget('low', false))).toBe(0);
    expect(shadowCasters({ shadowCasters: 9 })).toBe(2);
  });
});

describe('splitCasters', () => {
  it('gives the sun the first caster when it shines, the point lights the rest when they shine', () => {
    expect(splitCasters(2, { sun: false, points: true })).toEqual({ sun: false, points: 2 });
    expect(splitCasters(2, { sun: true, points: true })).toEqual({ sun: true, points: 1 });
    expect(splitCasters(1, { sun: true, points: true })).toEqual({ sun: true, points: 0 });
    expect(splitCasters(2, { sun: true, points: false })).toEqual({ sun: true, points: 0 });
    expect(splitCasters(0, { sun: true, points: true })).toEqual({ sun: false, points: 0 });
  });
});

describe('enableShadows and configurePointCaster', () => {
  it("turns the shadow map on as PCFShadowMap, and gives a point caster the prototype's settings", () => {
    const renderer = { shadowMap: { enabled: false, type: 0 } };
    enableShadows(renderer as never);
    expect(renderer.shadowMap).toEqual({ enabled: true, type: PCFShadowMap });
    const light = new PointLight();
    configurePointCaster(light);
    expect([light.shadow.mapSize.x, light.shadow.mapSize.y, light.shadow.camera.near, light.shadow.bias]).toEqual([
      POINT_SHADOW.mapSize,
      POINT_SHADOW.mapSize,
      0.1,
      -0.002,
    ]);
    expect(light.castShadow).toBe(false);
  });

  it("lets r182 read a point caster's shadow matrix after it stops casting, which a bare point light throws on", () => {
    const bare = new PointLight();
    expect(() => bare.shadow.updateMatrices(bare)).toThrow(/matrixWorld/); // r182's LightShadow reads light.target
    const caster = new PointLight();
    configurePointCaster(caster);
    caster.position.set(2, 3, 4);
    caster.updateMatrixWorld();
    expect(() => caster.shadow.updateMatrices(caster)).not.toThrow();
    expect(caster.shadow.camera.position.toArray()).toEqual([2, 3, 4]);
  });
});

describe('snapShadow', () => {
  it("filters a point caster's cube map and a sun's map through the engine's filters, r182's noise outside a frame", () => {
    const point = new PointLight();
    configurePointCaster(point);
    const sun = new DirectionalLight();
    expect(filterOf(sun.shadow)).toBeUndefined();
    snapShadow(sun.shadow);
    expect([filterOf(point.shadow), filterOf(sun.shadow)]).toEqual([SNAPPED_POINT, SNAPPED_PCF]);
    expect(SHADOW_GRID.value.toArray()).toEqual([0, 0, 1]); // no cells: the noise is read where r182 reads it
  });
});
