/**
 * @file Unit tests for skies (engine/gfx/sky.ts): the presets as data, the backdrop bake (reproducible, tiling,
 * clear above its skylines), and a sky on the hall whose presets and quality tiers change only who casts shadows,
 * never how many lights the scene holds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { hashNumbers } from '../core/hash';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import { compileLevel } from '../world/level/compile';
import { defineLights } from './lights';
import { qualityBudget } from './quality';
import { BACKDROP, BACKDROP_KINDS, bakeBackdrop, createSky, defineSkies, defineSky, type SkyEntry } from './sky';
import type { Warmup } from './warmup';

const HALL = compileLevel(readFileSync(join(import.meta.dirname, '../../labs/box/levels/hall.txt'), 'utf8'), {
  file: 'hall.txt',
});
const HAZE = '#c8e4f8';

/** The scene's lights as r182's lights node keys them: id, and whether it casts. */
const lightKey = (scene: Scene) => {
  const lights: string[] = [];
  scene.traverse(
    (o: Object3D) => void ((o as { isLight?: boolean }).isLight && lights.push(`${o.id}${o.castShadow ? 's' : ''}`)),
  );
  return lights;
};

/** The height of the skyline in column `x` of a baked strip: its highest opaque texel, + 1. */
const skyline = (data: Uint8Array, x: number, width: number, height: number) => {
  for (let y = height - 1; y >= 0; y--) if (data[(y * width + x) * 4 + 3] === 255) return y + 1;
  return 0;
};

describe('sky presets', () => {
  it('declares sky:hall and sky:daylight, sky:daylight as the fallback', () => {
    const registry = createRegistry();
    defineSkies(registry);
    expect(registry.list('sky').map((e) => e.id)).toEqual(['sky:daylight', 'sky:hall']);
    const hall = registry.get('sky', 'sky:hall') as SkyEntry;
    expect(hall).toMatchObject({ background: '#06050b', pointLights: 1, dome: { show: false } });
    expect(hall.fog).toMatchObject({ start: 12, end: 70, amount: 1 });
    expect(hall.ambient).toEqual({ sky: '#5a5480', ground: '#241f30', intensity: 4 });
    expect(hall.sun.intensity).toBe(0);
    const day = registry.get('sky', 'sky:daylight') as SkyEntry;
    expect(day.backdrop.layers.map((l) => l.kind)).toEqual(['mountains', 'hills', 'forest']);
    const own = defineSky('sky:dusk', { background: '#1a1440', sun: { intensity: 1, elevation: 0.1 } }, registry);
    expect(own.sun).toEqual({ color: '#fff0d8', intensity: 1, azimuth: 0, elevation: 0.1 });
    expect(() => defineSky('sky:bad', { backdrop: { layers: [{ kind: 'dunes' }] } }, registry)).toThrow(/dunes/);
  });
});

describe('bakeBackdrop', () => {
  it('bakes the same bytes from the same layers, and other bytes from another seed', () => {
    const layers = [{ kind: 'mountains' as const, color: '#7a98c8', height: 0.9, haze: 0.4, seed: 3 }];
    const a = hashNumbers(bakeBackdrop({ haze: HAZE, layers }));
    expect(hashNumbers(bakeBackdrop({ haze: HAZE, layers }))).toBe(a);
    expect(hashNumbers(bakeBackdrop({ haze: HAZE, layers: [{ ...layers[0], seed: 4 }] }))).not.toBe(a);
    expect(bakeBackdrop({ haze: HAZE, layers: [] }).every((v) => v === 0)).toBe(true);
  });

  it('tiles: every kind steps across the wrap no more than between neighbouring columns', () => {
    const { width, height } = BACKDROP;
    for (const kind of BACKDROP_KINDS) {
      const data = bakeBackdrop({ haze: HAZE, layers: [{ kind, color: '#5aa060', height: 1, haze: 0, seed: 5 }] });
      const tops = Array.from({ length: width }, (_, x) => skyline(data, x, width, height));
      const steps = tops.slice(1).map((top, x) => Math.abs(top - tops[x]));
      expect(Math.abs(tops[0] - tops[width - 1]), kind).toBeLessThanOrEqual(Math.max(...steps));
      expect(Math.max(...tops), kind).toBeGreaterThan(height / 2);
      expect(Math.min(...tops), kind).toBeLessThan(height);
      // Above the skyline the strip is clear, so the dome or the background shows.
      const x = tops.indexOf(Math.min(...tops));
      expect(data[((height - 1) * width + x) * 4 + 3], kind).toBe(0);
    }
  });
});

describe('createSky', () => {
  const make = () => {
    const registry = createRegistry();
    defineLights(registry);
    defineSkies(registry);
    const scene = new Scene();
    const sky = createSky(scene, { level: HALL, rng: new Rng(1), registry });
    return { scene, sky };
  };

  it('switches presets and tiers without adding or removing a light: only who casts changes', () => {
    const { scene, sky } = make();
    const ids = lightKey(scene).map((key) => key.replace('s', ''));
    expect(ids).toHaveLength(12 + 2); // the pool, the sun and the ambient light
    const casting = () => lightKey(scene).filter((key) => key.endsWith('s')).length;
    sky.set('sky:hall');
    expect(sky.report().casters).toEqual({ sun: false, points: 2 });
    expect([sky.sun.intensity, sky.dome.visible, sky.backdrop.visible, casting()]).toEqual([0, false, false, 2]);
    sky.set('sky:daylight');
    expect(sky.report().casters).toEqual({ sun: true, points: 0 });
    expect([sky.sun.castShadow, sky.dome.visible, sky.backdrop.visible, casting()]).toEqual([true, true, true, 1]);
    sky.set('sky:hall');
    for (const [tier, casters] of [
      ['medium', 1],
      ['low', 0],
      ['high', 2],
    ] as const) {
      sky.budget(qualityBudget(tier, false));
      expect(casting(), tier).toBe(casters);
    }
    expect(lightKey(scene).map((key) => key.replace('s', ''))).toEqual(ids);
  });

  it('follows the camera with the dome and backdrop, and the focus with the fog and the pool', () => {
    const { sky } = make();
    sky.set('sky:hall');
    const camera = new PerspectiveCamera();
    camera.position.set(32, 12, 40);
    const slots = sky.update({ camera, focus: [32, 0.5, 24], time: 2 });
    expect(sky.dome.position.toArray()).toEqual([32, 12, 40]);
    expect(sky.backdrop.position.toArray()).toEqual([32, 12 - BACKDROP.foot + BACKDROP.band / 2, 40]);
    expect(sky.report().fog.near).toBeCloseTo(Math.hypot(12 - 0.5, 16) + 12, 9);
    expect(slots.filter((slot) => slot.source >= 0)).toHaveLength(12);
    expect(slots.slice(0, 2).every((slot) => slot.castShadow && slot.intensity > 0)).toBe(true);
  });

  it('registers the dome and the backdrop with the warm-up, and the fog in its key', () => {
    const { sky } = make();
    const entries = new Map<string, { objects(): readonly Object3D[] }>();
    const warmup = {
      register: (id: string, entry: { objects(): readonly Object3D[] }) => (entries.set(id, entry), { dispose() {} }),
      keyPart: (name: string) => (entries.set(name, { objects: () => [] }), { dispose() {} }),
    };
    sky.register(warmup as unknown as Warmup);
    expect(entries.get('sky')!.objects()).toEqual([sky.dome, sky.backdrop]);
    expect([...entries.keys()].sort()).toEqual(['atmosphere', 'sky']);
  });
});
