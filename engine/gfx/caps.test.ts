/**
 * @file Unit tests for the capability report (`engine/gfx/caps.ts`), with stand-in adapters and devices: the device
 * is asked for every adapter feature and the adapter's own limits, read off the prototype getters WebGPU uses; a
 * refusal falls back to the default limits with advice `GFX_DEFAULT_LIMITS`; the report is sorted plain data. The
 * real adapter's report is checked by tests/e2e/renderer.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { adapterLimits, readCaps, requestDevice } from './caps';

/** Limits as WebGPU gives them: enumerable getters on a prototype, so `Object.keys` sees none of them. */
function limits(): GPUSupportedLimits {
  const prototype = Object.defineProperties(
    {},
    {
      maxBufferSize: { get: () => 1073741824, enumerable: true },
      maxBindGroups: { get: () => 4, enumerable: true },
      label: { get: () => 'not a limit', enumerable: true },
    },
  );
  return Object.create(prototype) as GPUSupportedLimits;
}

/** A log that records what it prints. */
function quietLog() {
  const printed: string[] = [];
  return { printed, log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }) };
}

/** A stand-in adapter whose `requestDevice` records its descriptors and refuses the first `refusals` of them. */
function adapter(refusals = 0) {
  const asked: GPUDeviceDescriptor[] = [];
  const device = { features: new Set(['timestamp-query', 'bgra8unorm-storage']), limits: limits() };
  const gpu = {
    features: new Set(['timestamp-query', 'bgra8unorm-storage']),
    limits: limits(),
    info: { vendor: 'google', architecture: 'swiftshader', device: '', description: '', isFallbackAdapter: true },
    async requestDevice(descriptor: GPUDeviceDescriptor) {
      asked.push(descriptor);
      if (asked.length <= refusals) throw new Error('limits refused');
      return device;
    },
  };
  return { asked, device: device as unknown as GPUDevice, gpu: gpu as unknown as GPUAdapter };
}

describe('adapterLimits', () => {
  it("reads every numeric limit off the prototype's getters, by name in order", () => {
    expect(Object.keys(limits())).toEqual([]);
    expect(adapterLimits(adapter().gpu)).toEqual({ maxBindGroups: 4, maxBufferSize: 1073741824 });
    expect(Object.keys(adapterLimits(adapter().gpu))).toEqual(['maxBindGroups', 'maxBufferSize']);
  });
});

describe('requestDevice', () => {
  it("asks for every adapter feature, sorted, and the adapter's own limits", async () => {
    const { asked, device, gpu } = adapter();
    expect(await requestDevice(gpu, { log: quietLog().log })).toBe(device);
    expect(asked).toEqual([
      {
        requiredFeatures: ['bgra8unorm-storage', 'timestamp-query'],
        requiredLimits: { maxBindGroups: 4, maxBufferSize: 1073741824 },
      },
    ]);
  });

  it('falls back to the default limits with advice GFX_DEFAULT_LIMITS when the adapter refuses its own', async () => {
    const { asked, device, gpu } = adapter(1);
    const { printed, log } = quietLog();
    expect(await requestDevice(gpu, { log })).toBe(device);
    expect(asked[1]).toEqual({ requiredFeatures: ['bgra8unorm-storage', 'timestamp-query'] });
    expect(printed).toEqual([
      expect.stringMatching(
        /^\[GFX_DEFAULT_LIMITS\] the adapter refused a device with its own limits \(Error: limits refused\)/,
      ),
    ]);
  });

  it('rejects when the adapter gives no device at all', async () => {
    await expect(requestDevice(adapter(2).gpu, { log: quietLog().log })).rejects.toThrow('limits refused');
  });
});

describe('readCaps', () => {
  it("reports the adapter's identity and the device's features and limits, sorted", () => {
    const { device, gpu } = adapter();
    expect(readCaps(gpu, device)).toEqual({
      adapter: { vendor: 'google', architecture: 'swiftshader', device: '', description: '', fallback: true },
      features: ['bgra8unorm-storage', 'timestamp-query'],
      limits: { maxBindGroups: 4, maxBufferSize: 1073741824 },
    });
  });
});
