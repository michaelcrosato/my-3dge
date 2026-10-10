/**
 * @file What the GPU offers (PLAN.md §6.7, WP 2.1): `requestDevice` asks the adapter for a device with every
 * optional feature it has and its best limits, since everything WebGPU offers is available to rendering (doctrine:
 * Quality under the hood); `readCaps` reports the adapter's identity and the device's features and limits as plain
 * data, for `__engine.info()` and the feature registry (engine/gfx/features.ts).
 *
 * Why the adapter's limits: a device gets WebGPU's default limits unless it asks for more, and on this platform's
 * SwiftShader seven of them are lower than the adapter's (storage buffers per stage 8 against 10, a storage binding
 * of 128 MB against 1 GB, measured in WP 2.1). If the adapter refuses its own limits, the device is requested again
 * with the defaults and advice `GFX_DEFAULT_LIMITS` says so: a downgrade, never a silent one.
 *
 * Invariants: features are sorted and limits keyed in name order, so two reports of one GPU are equal. Nothing here
 * draws or allocates beyond the device itself.
 *
 * @example
 * const adapter = { features: new Set(['timestamp-query']), limits: { maxBufferSize: 1024 } } as unknown as GPUAdapter;
 * adapterLimits(adapter); // { maxBufferSize: 1024 }
 * @see engine/gfx/caps.test.ts
 */
/// <reference types="@webgpu/types" />
import { defineCodes, log as sharedLog, type Log } from '../core/log';

/** The codes this module raises, with their fixes. */
export const CAPS_CODES = defineCodes('gfx', {
  GFX_DEFAULT_LIMITS: {
    template: "the adapter refused a device with its own limits ({reason}), so the device has WebGPU's default limits",
    fix: 'nothing to do for play; for larger buffers and textures, update the browser or GPU driver (node x describe feature lists what each feature needs)',
    doc: "Advice from `requestDevice` (engine/gfx/caps.ts): the device is made with every adapter feature but WebGPU's default limits. Features that need larger limits are then off, each with its own advice (engine/gfx/features.ts).",
  },
});

/** The GPU as the engine reports it: the adapter's identity, the device's features and limits. Plain data. */
export interface GfxCaps {
  /** The adapter's identity (on this platform: vendor `google`, architecture `swiftshader`, a fallback adapter). */
  adapter: { vendor: string; architecture: string; device: string; description: string; fallback: boolean };
  /** The device's optional features, sorted: every one the adapter offers. */
  features: string[];
  /** The device's limits, by name in order. */
  limits: Record<string, number>;
}

/** Every numeric member of a `GPUSupportedLimits`, by name in order. */
function limitsOf(limits: GPUSupportedLimits): Record<string, number> {
  const out: Record<string, number> = {};
  const names: string[] = [];
  // The members are getters on the prototype: `for…in` sees them where `Object.keys` does not.
  for (const name in limits) names.push(name);
  for (const name of names.sort()) {
    const value = (limits as unknown as Record<string, unknown>)[name];
    if (typeof value === 'number') out[name] = value;
  }
  return out;
}

/** The adapter's limits, by name: what `requestDevice` asks for. */
export function adapterLimits(adapter: GPUAdapter): Record<string, number> {
  return limitsOf(adapter.limits);
}

/**
 * A device with every feature `adapter` offers and its best limits; when the adapter refuses those limits, one
 * with the default limits, after advice `GFX_DEFAULT_LIMITS`. Rejects when the adapter gives no device at all.
 */
export async function requestDevice(adapter: GPUAdapter, options: { log?: Log } = {}): Promise<GPUDevice> {
  const requiredFeatures = [...adapter.features].sort() as GPUFeatureName[];
  try {
    return await adapter.requestDevice({ requiredFeatures, requiredLimits: adapterLimits(adapter) });
  } catch (error) {
    (options.log ?? sharedLog).warnOnce('GFX_DEFAULT_LIMITS', { reason: String(error) });
    return adapter.requestDevice({ requiredFeatures });
  }
}

/** The report of `device` made from `adapter`: identity, features, limits. */
export function readCaps(adapter: GPUAdapter, device: GPUDevice): GfxCaps {
  const { vendor, architecture, device: name, description, isFallbackAdapter } = adapter.info;
  return {
    adapter: { vendor, architecture, device: name, description, fallback: isFallbackAdapter === true },
    features: [...device.features].sort(),
    limits: limitsOf(device.limits),
  };
}
