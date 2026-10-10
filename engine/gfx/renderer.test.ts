/**
 * @file Unit tests for the renderer bootstrap's Node half (`engine/gfx/renderer.ts`): the adapter check refuses to
 * start without WebGPU, with `GFX_NO_WEBGPU` and its fix, and the code is registered in the form `x docs` reads.
 * The browser half (device, `init()`, the backend assertion, drawing) is proven by tests/e2e/hello.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { GFX_CODES, GfxError, requestWebGPU } from './renderer';

/** A stand-in for `navigator.gpu` whose `requestAdapter` resolves or rejects as told. */
const fakeGpu = (requestAdapter: () => Promise<GPUAdapter | null>) => ({ requestAdapter }) as unknown as GPU;

describe('requestWebGPU', () => {
  it('refuses without navigator.gpu (Node has none)', async () => {
    const error = await requestWebGPU().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GfxError);
    expect(error).toMatchObject({
      code: 'GFX_NO_WEBGPU',
      message: 'WebGPU is unavailable: this browser has no navigator.gpu',
      fix: GFX_CODES.GFX_NO_WEBGPU.fix,
    });
  });

  it('refuses when the browser gives no adapter, as Chromium does without the WebGPU flags', async () => {
    await expect(requestWebGPU(fakeGpu(async () => null))).rejects.toMatchObject({
      code: 'GFX_NO_WEBGPU',
      message: 'WebGPU is unavailable: navigator.gpu.requestAdapter() gave no adapter',
    });
  });

  it('refuses when requestAdapter rejects, naming the cause', async () => {
    const gpu = fakeGpu(async () => {
      throw new Error('blocked');
    });
    await expect(requestWebGPU(gpu)).rejects.toThrow('requestAdapter() failed (Error: blocked)');
  });

  it('returns the adapter it was given', async () => {
    const adapter = { features: new Set() } as unknown as GPUAdapter;
    expect(await requestWebGPU(fakeGpu(async () => adapter))).toBe(adapter);
  });
});

describe('GFX_CODES', () => {
  it('names the fix: the browser to use, and the headless flags', () => {
    const { template, fix } = GFX_CODES.GFX_NO_WEBGPU;
    expect(template).toContain('{reason}');
    expect(fix).toContain('WEBGPU_FLAGS');
    expect(fix).toContain('hardware acceleration');
  });

  it('fills every marker of a template and leaves an unknown one visible', () => {
    expect(new GfxError('GFX_NO_WEBGPU', {}).message).toBe('WebGPU is unavailable: {reason}');
    expect(new GfxError('GFX_NO_WEBGPU', { reason: 'x' }).name).toBe('GfxError');
  });
});
