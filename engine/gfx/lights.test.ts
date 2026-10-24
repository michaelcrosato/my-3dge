/**
 * @file Unit tests for the light pool (engine/gfx/lights.ts): the torch kind as carried, the hall's 30 light
 * sources, the flicker's numbers, the ranking and fade, and a pool that hands its fixed lights from torch to torch
 * as the focus crosses the hall, the casters always on the most important ones; the frame's lamps lit with their own
 * colour and reach, ranked with the sources (WP 13.23).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import { compileLevel } from '../world/level/compile';
import {
  createLightPool,
  defineLight,
  defineLights,
  fadeOf,
  flicker,
  lightSources,
  rankSources,
  type LightSource,
} from './lights';

const HALL = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'), {
  file: 'hall.txt',
});
const torch = (x: number, z: number): LightSource => ({ light: 'light:torch', position: [x, 1, z] });

describe('light kinds and sources', () => {
  it('declares light:torch with the prototype torch: colour, 30 cd, 170 units (10.625 m), decay 0.5, flickering', () => {
    const registry = createRegistry();
    defineLights(registry);
    expect(registry.get('light', 'light:torch')).toMatchObject({
      color: '#ffc8a0',
      intensity: 30,
      distance: 10.625,
      decay: 0.5,
      priority: 1,
      flicker: 1,
    });
    const rune = defineLight('light:rune', { color: '#4fe0cc', intensity: 8, priority: 2 }, registry);
    expect([rune.distance, rune.decay, rune.flicker]).toEqual([10, 2, 0]);
  });

  it('gives the hall 30 torch sources, 1 m above the floor on top of each brazier', () => {
    const sources = lightSources(HALL);
    expect(sources).toHaveLength(30);
    expect(new Set(sources.map((s) => s.light))).toEqual(new Set(['light:torch']));
    expect(new Set(sources.map((s) => s.position[1]))).toEqual(new Set([1]));
  });
});

describe('flicker', () => {
  it("is the prototype's FLICKER: 0.9 at rest, steady at amount 0, within 0.77 to 1.03", () => {
    expect(flicker(0, 0, 1)).toBeCloseTo(0.9, 12);
    expect(flicker(3.3, 7, 0)).toBe(1);
    const values = Array.from({ length: 2000 }, (_, i) => flicker(i / 60, 0, 1));
    expect(Math.min(...values)).toBeGreaterThan(0.77);
    expect(Math.max(...values)).toBeLessThan(1.03);
    expect(flicker(1, 0.5, 0.5)).toBeCloseTo(1 - 0.5 * (1 - flicker(1.5, 0, 1)), 12);
  });
});

describe('rankSources and fadeOf', () => {
  it('ranks by distance over priority, ties to the earlier source, and gives the cut-off', () => {
    const sources = [torch(9, 0), torch(2, 0), torch(-2, 0), torch(6, 0)];
    const ranking = rankSources(sources, [0, 1, 0], 2);
    expect(ranking.order).toEqual([1, 2]);
    expect(ranking.ranks).toEqual([2, 2]);
    expect(ranking.cutoff).toBe(6);
    // Priority 2 counts as half as far: the torch at 6 m ranks 3, ahead of none of the 2 m ones.
    expect(rankSources(sources, [0, 1, 0], 4, [1, 1, 1, 2]).order).toEqual([1, 2, 3, 0]);
    expect(rankSources(sources, [0, 1, 0], 9).cutoff).toBe(Infinity);
  });

  it('fades the last lights chosen over the last 15% of the cut-off rank', () => {
    expect(fadeOf(5, 10)).toBe(1);
    expect(fadeOf(8.5, 10)).toBe(1);
    expect(fadeOf(9.25, 10)).toBeCloseTo(0.5, 12);
    expect(fadeOf(10, 10)).toBe(0);
    expect(fadeOf(50, Infinity)).toBe(1);
  });
});

describe('createLightPool', () => {
  it('holds 8 to 16 lights, 12 by default, and refuses other sizes with GFX_BAD_LIGHT_POOL', () => {
    expect(createLightPool().lights).toHaveLength(12);
    expect(createLightPool({ size: 8 }).group.children).toHaveLength(8);
    for (const size of [7, 17, 9.5]) {
      expect(() => createLightPool({ size })).toThrow(expect.objectContaining({ code: 'GFX_BAD_LIGHT_POOL' }));
    }
  });

  it('hands its fixed lights from torch to torch as the focus crosses the hall, the casters on the nearest', () => {
    const pool = createLightPool();
    pool.setSources(lightSources(HALL), new Rng(7));
    pool.casters = 2;
    const lights = [...pool.lights];
    const seen = new Set<number>();
    let changes = 0;
    let last = '';
    for (let x = 2; x <= 62; x += 2) {
      const focus = [x, 0, 22];
      const slots = pool.update(focus, x / 10);
      expect(pool.lights).toEqual(lights);
      expect(pool.group.children).toHaveLength(12);
      expect(slots.map((slot) => slot.castShadow)).toEqual(lights.map((_, i) => i < 2));
      // The casters hold the two torches nearest the focus, lit, at their spots.
      const nearest = rankSources(pool.sources, focus, 2).order;
      expect(slots.slice(0, 2).map((slot) => slot.source)).toEqual(nearest);
      expect(pool.lights[0].position.toArray()).toEqual([...pool.sources[nearest[0]].position]);
      expect(slots[0].intensity).toBeGreaterThan(20);
      slots.forEach((slot) => seen.add(slot.source));
      const now = slots.map((slot) => slot.source).join(',');
      if (now !== last) changes++;
      last = now;
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(changes).toBeGreaterThan(10);
  });

  it('flickers each source at its own phase from the stream, the same for the same stream', () => {
    const run = (seed: number) => {
      const pool = createLightPool();
      pool.setSources(lightSources(HALL), new Rng(seed));
      return pool.update([32, 0, 22], 1.25).map((slot) => slot.intensity);
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('puts every light out at scale 0, and leaves slots without a source dark', () => {
    const pool = createLightPool({ size: 8 });
    pool.setSources([torch(0, 0), torch(4, 0)]);
    const slots = pool.update([0, 1, 0], 0);
    expect(slots.map((slot) => slot.source)).toEqual([0, 1, -1, -1, -1, -1, -1, -1]);
    expect(slots.slice(2).every((slot) => slot.intensity === 0)).toBe(true);
    expect(slots[0].intensity).toBeCloseTo(30 * 0.9, 9);
    pool.scale = 0;
    expect(pool.update([0, 1, 0], 0).every((slot) => slot.intensity === 0)).toBe(true);
  });

  it("lights the frame's lamps with their own colour and reach, ranked with the sources, a declared kind's priority", () => {
    const registry = createRegistry();
    defineLights(registry);
    defineLight('light:porch', { priority: 4 }, registry);
    const pool = createLightPool({ size: 8, registry });
    pool.setSources([torch(0, 0), torch(4, 0)]);
    const lamp = (x: number, tag: string) => ({ tag, position: [x, 2, 0] as const, color: '#ffe2b0', intensity: 8, distance: 7, decay: 1 }); // prettier-ignore
    // The porch's lamp, 12 m off but of priority 4, ranks as if 3 m away: after the room's lamp 1.4 m off.
    const slots = pool.update([0, 1, 0], 0, [lamp(1, 'lamp'), lamp(12, 'porch')]);
    expect(slots.map((slot) => slot.source)).toEqual([0, 2, 3, 1, -1, -1, -1, -1]);
    expect([slots[1].light, slots[1].intensity, slots[2].light]).toEqual(['light:lamp', 8, 'light:porch']);
    const light = pool.lights[1];
    expect([light.position.toArray(), `#${light.color.getHexString()}`, light.distance, light.decay]).toEqual([[1, 2, 0], '#ffe2b0', 7, 1]); // prettier-ignore
    pool.scale = 0;
    expect(pool.update([0, 1, 0], 0, [lamp(1, 'lamp')]).every((slot) => slot.intensity === 0)).toBe(true);
  });

  it("lights a lamp standing on a level's spot of its kind once, as that spot: a brazier on its torch", () => {
    const pool = createLightPool({ size: 8 });
    pool.setSources([torch(0, 0), torch(4, 0)]);
    const brazier = { tag: 'torch', position: [4, 1, 0.01] as const, color: '#ffc8a0', intensity: 27, distance: 10.625, decay: 0.5 }; // prettier-ignore
    const lantern = { ...brazier, position: [8, 1, 0] as const };
    expect(pool.update([0, 1, 0], 0, [brazier, lantern]).map((slot) => slot.source)).toEqual([0, 1, 2, -1, -1, -1, -1, -1]); // prettier-ignore
  });
});
