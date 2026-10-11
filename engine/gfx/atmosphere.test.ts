/**
 * @file Unit tests for the atmosphere (engine/gfx/atmosphere.ts): the fog sum's numbers (clear at the focus, whole
 * at its end, height fog on the floor only), the fog following the focus however far back the camera stands, the
 * ambient light, and the warm-up key part.
 */
import { Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createAtmosphere, fogAt, type FogSpec } from './atmosphere';
import type { Warmup } from './warmup';

const HALL: FogSpec = { color: '#06050b', start: 12, end: 70, amount: 1, floor: 0, ceiling: 1.2, height: 0.3 };

describe('fogAt', () => {
  it('is clear up to 12 m past the focus and whole 70 m past it, however far back the camera stands', () => {
    for (const focus of [8, 120]) {
      expect(fogAt(HALL, focus, 5, focus)).toBe(0);
      expect(fogAt(HALL, focus + 12, 5, focus)).toBe(0);
      expect(fogAt(HALL, focus + 41, 5, focus)).toBeCloseTo(0.5, 12);
      expect(fogAt(HALL, focus + 70, 5, focus)).toBe(1);
    }
  });

  it('adds height fog on the floor, growing from the focus, and scales the whole by amount', () => {
    expect(fogAt(HALL, 20, 0, 20)).toBe(0);
    expect(fogAt(HALL, 20 + 10, 0, 20)).toBeGreaterThan(0);
    expect(fogAt(HALL, 20 + 10, 2, 20)).toBe(0);
    expect(fogAt(HALL, 20 + 70, 0, 20)).toBe(1);
    expect(fogAt({ ...HALL, start: 100, end: 200 }, 20 + 200, 0, 20)).toBe(1);
    expect(fogAt({ ...HALL, start: 100, end: 200, height: 0.3 }, 20 + 99, 0, 20)).toBeCloseTo(0.1478, 3);
    expect(fogAt({ ...HALL, amount: 0.5 }, 20 + 70, 5, 20)).toBe(0.5);
  });
});

describe('createAtmosphere', () => {
  it('puts its fog node and ambient light on a scene, follows the focus and takes them off again', () => {
    const atmosphere = createAtmosphere();
    const scene = new Scene();
    atmosphere.install(scene);
    expect(scene.fogNode).toBe(atmosphere.fogNode);
    expect(scene.children).toContain(atmosphere.ambient);
    atmosphere.set({ fog: HALL, ambient: { sky: '#5a5480', ground: '#241f30', intensity: 4 } });
    expect([atmosphere.ambient.color.getHexString(), atmosphere.ambient.groundColor.getHexString()]).toEqual([
      '5a5480',
      '241f30',
    ]);
    expect(atmosphere.ambient.intensity).toBe(4);
    atmosphere.follow([0, 30, 40], [0, 0, 0]);
    expect(atmosphere.report()).toEqual({ near: 62, far: 120, focus: 50, amount: 1 });
    atmosphere.dispose();
    expect([scene.fogNode, scene.children.length]).toEqual([null, 0]);
  });

  it('adds the fog to the shader key while it is installed', () => {
    const parts = new Map<string, () => string>();
    const warmup = { keyPart: (name: string, part: () => string) => (parts.set(name, part), { dispose() {} }) };
    const atmosphere = createAtmosphere();
    atmosphere.register(warmup as unknown as Warmup);
    expect(parts.get('atmosphere')!()).toBe('none');
    atmosphere.install(new Scene());
    expect(parts.get('atmosphere')!()).toBe('fog');
  });
});
