/**
 * @file Unit tests for the resolution modes (`engine/gfx/resolution.ts`): the prototype's `fit()` numbers for each
 * mode, the device-pixel-ratio cap, the 200–330 line range of the `pixels` mode over every screen height, and the
 * controller that applies a fit to a renderer only when the canvas, the ratio or the setting changed. The browser
 * half (a real canvas, resizes, the modes drawn with 0 pipelines) is proven by tests/e2e/renderer.spec.ts.
 */
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createSettings } from '../core/settings';
import { createResolution, fitResolution, MAX_PIXEL_RATIO, PIXEL_LINES, RESOLUTION_MODES } from './resolution';

describe('fitResolution', () => {
  it("gives the prototype's sizes: whole engine pixels at 330 lines or fewer, half, or all", () => {
    const wide = { width: 1280, height: 720 };
    expect(fitResolution(wide, 1, 'pixels')).toMatchObject({ width: 427, height: 240, scale: 3, pixelated: true });
    expect(fitResolution(wide, 1, 'balanced')).toMatchObject({ width: 640, height: 360, pixelated: true });
    expect(fitResolution(wide, 1, 'full')).toMatchObject({ width: 1280, height: 720, pixelated: false });
    expect(fitResolution({ width: 960, height: 540 }, 1, 'pixels')).toMatchObject({
      width: 480,
      height: 270,
      scale: 2,
    });
    expect(fitResolution({ width: 1920, height: 1080 }, 1, 'pixels')).toMatchObject({
      width: 480,
      height: 270,
      scale: 4,
    });
  });

  it('counts screen pixels: the device pixel ratio multiplies, capped at MAX_PIXEL_RATIO', () => {
    expect(fitResolution({ width: 960, height: 540 }, 2, 'full')).toMatchObject({ width: 1920, height: 1080 });
    const dense = fitResolution({ width: 400, height: 300 }, 5, 'full');
    expect(dense).toMatchObject({
      pixelRatio: MAX_PIXEL_RATIO,
      width: 1200,
      height: 900,
      css: { width: 400, height: 300 },
    });
    expect(fitResolution({ width: 400, height: 300 }, 0, 'full').pixelRatio, 'no ratio counts as 1').toBe(1);
  });

  it('never gives an empty drawing buffer', () => {
    for (const mode of RESOLUTION_MODES) {
      expect(fitResolution({ width: 0, height: 0 }, 1, mode)).toMatchObject({ width: 1, height: 1 });
    }
  });

  it('keeps the pixels mode at most 330 lines, and at least 200 wherever a whole-pixel scale allows', () => {
    for (let height = 1; height <= 2400; height++) {
      const fit = fitResolution({ width: height * 2, height }, 1, 'pixels');
      expect(fit.height, `${height} screen lines`).toBeLessThanOrEqual(PIXEL_LINES);
      if (height >= 200 && (height <= 330 || height >= 400))
        expect(fit.height, `${height}`).toBeGreaterThanOrEqual(200);
      expect(Math.abs(fit.width * fit.scale - fit.screen.width), 'the width keeps its scale').toBeLessThanOrEqual(
        fit.scale,
      );
    }
  });
});

/** A stand-in renderer and canvas recording what the controller sets. */
function harness(size = { width: 1280, height: 720 }) {
  const calls: unknown[][] = [];
  const renderer = {
    setPixelRatio: (ratio: number) => calls.push(['ratio', ratio]),
    setSize: (width: number, height: number, style: boolean) => calls.push(['size', width, height, style]),
  } as unknown as WebGPURenderer;
  const canvas = { clientWidth: size.width, clientHeight: size.height, style: { imageRendering: '' } };
  return { calls, renderer, canvas: canvas as unknown as HTMLCanvasElement & typeof canvas };
}

describe('createResolution', () => {
  it('applies the setting to the drawing buffer once, then only when the canvas, ratio or mode changes', () => {
    const { calls, renderer, canvas } = harness();
    const settings = createSettings();
    let ratio = 1;
    const resolution = createResolution({ renderer, canvas, settings, pixelRatio: () => ratio });
    expect(resolution.current).toBeNull();
    expect(resolution.update()).toBe(true);
    expect(calls).toEqual([
      ['ratio', 1],
      ['size', 427, 240, false],
    ]);
    expect(canvas.style.imageRendering).toBe('pixelated');
    expect(resolution.update(), 'nothing changed').toBe(false);
    expect(calls).toHaveLength(2);

    settings.set('gfx.resolution', 'full');
    expect(resolution.update()).toBe(true);
    expect(calls.at(-1)).toEqual(['size', 1280, 720, false]);
    expect(canvas.style.imageRendering, 'full is drawn smooth').toBe('');

    ratio = 2;
    canvas.clientWidth = 640;
    canvas.clientHeight = 360;
    expect(resolution.update()).toBe(true);
    expect(resolution.current).toMatchObject({ mode: 'full', width: 1280, height: 720, pixelRatio: 2 });
  });

  it('reads gfx.resolution, a view setting kept out of the hash', () => {
    const settings = createSettings();
    expect(settings.get('gfx.resolution')).toBe('pixels');
    expect(settings.values({ view: false })).not.toHaveProperty('gfx.resolution');
    expect(() => settings.set('gfx.resolution', 'huge')).toThrow(/CORE_BAD_SETTING|gfx\.resolution/);
  });
});
