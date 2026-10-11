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
 * distance itself.
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
import { PCFShadowMap, type PointLight, type ShadowMapType, type WebGPURenderer } from 'three/webgpu';
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
}
