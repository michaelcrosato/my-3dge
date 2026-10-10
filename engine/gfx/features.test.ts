/**
 * @file Unit tests for the feature registry (`engine/gfx/features.ts`): the built-in features and their setting are
 * declared on the shared registry; each feature is on only when the device meets its needs and `gfx.featuresOff`
 * leaves it alone; every feature off raises its advice code once, with the reason; an unknown id in the setting
 * names the closest. The browser half (the real adapter, the advice in the page) is in tests/e2e/renderer.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import { createRegistry, registry as sharedRegistry } from '../core/registry';
import { createSettings } from '../core/settings';
import type { GfxCaps } from './caps';
import { defineFeatures, resolveFeatures } from './features';

/** The capabilities of a GPU with `features`, and storage buffers of 1 GB unless `limits` says otherwise. */
function caps(features: string[], limits: Record<string, number> = {}): GfxCaps {
  return {
    adapter: { vendor: 'test', architecture: '', device: '', description: '', fallback: false },
    features,
    limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30, ...limits },
  };
}

/** Everything the built-in features need. */
const FULL = ['float32-filterable', 'timestamp-query'];

/** A fresh registry with the features, a store over it, and a log that records what it prints. */
function setup(off: string[] = []) {
  const registry = createRegistry();
  defineFeatures(registry);
  const settings = createSettings({ registry });
  settings.set('gfx.featuresOff', off);
  const printed: string[] = [];
  const log = createLog({ console: { warn: (line) => printed.push(line), error: () => {} } });
  return { registry, settings, log, printed };
}

describe('the feature kind', () => {
  it('declares the built-in features and gfx.featuresOff on the shared registry', () => {
    expect(sharedRegistry.describe('feature').ids).toEqual([
      'feature:float32Filtering',
      'feature:largeBuffers',
      'feature:timestamps',
    ]);
    const setting = sharedRegistry.get('setting', 'gfx.featuresOff');
    expect(setting).toMatchObject({ view: true, default: [] });
  });

  it('refuses a limit that is not a positive number', () => {
    const { registry } = setup();
    const bad = { description: 'x', limits: { maxBufferSize: -1 }, advice: 'GFX_SMALL_BUFFERS', downgrade: 'y' };
    expect(() => registry.def('feature', 'feature:bad', bad)).toThrow('limits.maxBufferSize must be a positive number');
  });

  it('defines everything once, however often it is called', () => {
    const { registry } = setup();
    defineFeatures(registry);
    expect(registry.list('feature')).toHaveLength(3);
  });
});

describe('resolveFeatures', () => {
  it('turns every feature on for a GPU that has everything, quietly', () => {
    const { registry, settings, log, printed } = setup();
    const report = resolveFeatures(caps(FULL), { registry, settings, log });
    expect(report).toEqual({
      on: ['feature:float32Filtering', 'feature:largeBuffers', 'feature:timestamps'],
      off: [],
      downgrades: [],
    });
    expect(printed).toEqual([]);
  });

  it('turns off what the device lacks, each with its advice code and reason, printed once', () => {
    const { registry, settings, log, printed } = setup();
    const small = caps(['float32-filterable'], { maxStorageBufferBindingSize: 134217728 });
    const report = resolveFeatures(small, { registry, settings, log });
    expect(report.on).toEqual(['feature:float32Filtering']);
    expect(report.off).toEqual([
      {
        id: 'feature:largeBuffers',
        advice: 'GFX_SMALL_BUFFERS',
        reason: "the device's maxStorageBufferBindingSize is 134217728, it needs 268435456",
      },
      { id: 'feature:timestamps', advice: 'GFX_NO_TIMESTAMPS', reason: 'the device lacks timestamp-query' },
    ]);
    expect(report.downgrades).toEqual(['GFX_NO_TIMESTAMPS', 'GFX_SMALL_BUFFERS']);
    expect(printed).toEqual([
      expect.stringMatching(
        /^\[GFX_SMALL_BUFFERS\] feature:largeBuffers is off: the device's maxStorageBufferBindingSize/,
      ),
      '[GFX_NO_TIMESTAMPS] feature:timestamps is off: the device lacks timestamp-query; the GPU time per frame stays unmeasured: ' +
        'nothing to do for play; for GPU timings use a browser and GPU with timestamp queries, and take the feature out of gfx.featuresOff if it is listed there',
    ]);
    resolveFeatures(small, { registry, settings, log });
    expect(printed, 'the same advice about the same feature prints once').toHaveLength(2);
    expect(log.advice.map((advice) => [advice.subject, advice.count])).toEqual([
      ['feature:largeBuffers', 2],
      ['feature:timestamps', 2],
    ]);
  });

  it('names a missing limit', () => {
    const { registry, settings, log } = setup();
    const report = resolveFeatures({ ...caps(FULL), limits: {} }, { registry, settings, log });
    expect(report.off[0].reason).toBe(
      "the device's maxStorageBufferBindingSize is missing, it needs 268435456; the device's maxBufferSize is missing, it needs 268435456",
    );
  });

  it('turns off what gfx.featuresOff lists, on a GPU that has it', () => {
    const { registry, settings, log } = setup(['feature:timestamps']);
    const report = resolveFeatures(caps(FULL), { registry, settings, log });
    expect(report.off).toEqual([
      { id: 'feature:timestamps', advice: 'GFX_NO_TIMESTAMPS', reason: 'gfx.featuresOff lists it' },
    ]);
    expect(log.advice[0].message).toBe(
      'feature:timestamps is off: gfx.featuresOff lists it; the GPU time per frame stays unmeasured',
    );
  });

  it('refuses an id in gfx.featuresOff that no feature has, naming the closest', () => {
    const { registry, settings, log } = setup(['feature:timestamp']);
    expect(() => resolveFeatures(caps(FULL), { registry, settings, log })).toThrow(
      /CORE_NO_ENTRY.*"feature:timestamp" \(did you mean "feature:timestamps"\?\)/,
    );
  });
});
