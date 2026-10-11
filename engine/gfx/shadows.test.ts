/**
 * @file Unit tests for the shadow budget (engine/gfx/shadows.ts): two casters at `high`, one at `medium`, none at
 * `low`, the sun taking the first, and the renderer's one shadow map type.
 */
import { PCFShadowMap, PointLight } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { qualityBudget } from './quality';
import {
  configurePointCaster,
  enableShadows,
  MAX_SHADOW_CASTERS,
  POINT_SHADOW,
  shadowCasters,
  splitCasters,
} from './shadows';

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
});
