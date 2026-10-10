/**
 * @file The feature registry (PLAN.md §6.7, I-16; doctrine: WebGPU only): optional adapter features and GPU
 * techniques as entries of the registry kind `feature`, each saying what it needs (adapter features, least device
 * limits), what is lost without it and which advice code says so. `resolveFeatures` checks every entry against the
 * device's capabilities (engine/gfx/caps.ts) once, when the renderer starts, and logs the entry's advice for each one
 * that is off: a missing feature downgrades a look or a measurement, never play, and nothing degrades silently.
 *
 * The entries here are what WebGPU and three.js r182 switch on by themselves: timestamp queries (GPU timings, read
 * by WP 11.2), filtering of 32-bit float textures (r182 samples `FloatType` textures unfiltered without
 * `float32-filterable`, quietly) and the larger storage-buffer limits the device asks for (caps.ts). Later WPs add
 * their techniques with `def('feature', id, { … })` and an advice code of their own; consumers read the report, never
 * the GPU. The view setting `gfx.featuresOff` lists features to treat as missing, to see or test a downgraded look on
 * a GPU that has everything; turning one off never changes the hash (§6.7, parity contract item 3).
 *
 * Invariants: the report lists features in id order; an entry is off when any need is unmet or the setting lists it,
 * and then its advice is raised once per feature (the subject is the id), with `{feature}`, `{reason}` and
 * `{downgrade}` filled. An id in `gfx.featuresOff` that no entry has throws `CORE_NO_ENTRY`, naming the closest.
 * Carried as a concept from the prototype's WebGPU lighting module's habits (`my-3d2dge:engine/my-3d2dge.js:4329-4650`:
 * detect, fall back, report the status, a URL switch).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { createSettings } from '../core/settings';
 * const registry = createRegistry();
 * defineFeatures(registry);
 * const caps = { adapter: { vendor: '', architecture: '', device: '', description: '', fallback: false },
 *   features: ['float32-filterable'], limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30 } };
 * const quiet = { warnOnce: () => true } as unknown as Log;
 * const report = resolveFeatures(caps, { registry, settings: createSettings({ registry }), log: quiet });
 * report.downgrades; // ['GFX_NO_TIMESTAMPS']: this device has no timestamp-query
 * @see engine/gfx/features.test.ts
 */
import { defineCodes, log as sharedLog, type Log } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import type { Field, Schema } from '../core/schema';
import { createSettings, defineSettings, type Settings } from '../core/settings';
import type { GfxCaps } from './caps';

/** The advice codes of the built-in features, with their fixes. */
export const FEATURES_CODES = defineCodes('gfx', {
  GFX_NO_TIMESTAMPS: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; for GPU timings use a browser and GPU with timestamp queries, and take the feature out of gfx.featuresOff if it is listed there',
    doc: 'Advice from the feature registry (engine/gfx/features.ts) when the device has no `timestamp-query`: stats report no GPU time per frame.',
  },
  GFX_NO_FLOAT32_FILTERING: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; give data textures that must look smooth HalfFloatType, or use a GPU with float32-filterable, and take the feature out of gfx.featuresOff if it is listed there',
    doc: 'Advice from the feature registry (engine/gfx/features.ts) when the device has no `float32-filterable`: three.js r182 then samples 32-bit float textures unfiltered.',
  },
  GFX_SMALL_BUFFERS: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; a GPU or browser with larger storage-buffer limits turns it on, and take the feature out of gfx.featuresOff if it is listed there',
    doc: 'Advice from the feature registry (engine/gfx/features.ts) when the device cannot bind storage buffers of 256 MB: GPU techniques with large buffers run smaller or stay off.',
  },
});

/** The fields of a `feature` entry. */
export const FEATURE_FIELDS = {
  description: {
    type: 'string',
    required: true,
    description: 'What it gives the look or the speed, in plain sentences.',
  },
  needs: {
    type: 'array',
    items: { type: 'string' },
    default: [],
    description: "The adapter features it needs, as WebGPU names them ('timestamp-query').",
  },
  limits: {
    type: 'object',
    default: {},
    description: 'The device limits it needs: limit name → the least value (maxStorageBufferBindingSize: 268435456).',
  },
  advice: {
    type: 'string',
    required: true,
    description:
      'The advice code raised when it is off, registered with defineCodes; its template takes {feature}, {reason} and {downgrade}.',
  },
  downgrade: {
    type: 'string',
    required: true,
    description: 'What is lost when it is off, one clause: a look or a measurement, never play.',
  },
} as const satisfies Schema;

/** A `feature` entry. */
export type FeatureEntry = Entry<typeof FEATURE_FIELDS>;

/** The gfx settings this module reads; all are view settings, never in the hash. */
export const FEATURE_SETTINGS = {
  'gfx.featuresOff': {
    type: 'array',
    items: { type: 'string' },
    default: [],
    view: true,
    when: 'scene',
    description:
      'Feature ids (node x describe feature) to treat as missing, to see or test the downgraded look; read when the renderer starts.',
  },
} as const satisfies Record<string, Field>;

/** One feature that is off: its id, the advice raised and why. */
export interface FeatureOff {
  id: string;
  advice: string;
  reason: string;
}

/** What `resolveFeatures` found: the features on, those off and why, and the downgrades as advice codes. */
export interface FeatureReport {
  /** The ids of the features on, in order. */
  on: string[];
  /** The features off, in id order. */
  off: FeatureOff[];
  /** The advice codes of the features off, sorted, each once: what `__engine.info().downgrades` lists. */
  downgrades: string[];
}

/** Declares the kind `feature`, the built-in features and `gfx.featuresOff` on `registry`, unless it has them. */
export function defineFeatures(registry: Registry = sharedRegistry): void {
  if (!registry.kinds().includes('feature')) {
    registry.defineKind('feature', {
      description:
        'Optional GPU features and techniques: what each needs, what is lost without it, and its advice code.',
      fields: FEATURE_FIELDS,
      check: (entry) =>
        Object.entries(entry.limits)
          .filter(([, least]) => typeof least !== 'number' || !(least > 0))
          .map(([name]) => `limits.${name} must be a positive number`),
    });
  }
  const feature = (id: string, spec: Record<string, unknown>) =>
    registry.has('feature', id) || registry.def('feature', id, spec);
  feature('feature:timestamps', {
    description: 'GPU timestamps: how long each frame takes on the GPU, for the stats and the performance budgets.',
    needs: ['timestamp-query'],
    advice: 'GFX_NO_TIMESTAMPS',
    downgrade: 'the GPU time per frame stays unmeasured',
  });
  feature('feature:float32Filtering', {
    description:
      'Linear filtering of 32-bit float textures (FloatType data textures and render targets): three.js uses it whenever the device has it.',
    needs: ['float32-filterable'],
    advice: 'GFX_NO_FLOAT32_FILTERING',
    downgrade: 'three.js samples 32-bit float textures without filtering, blocky up close',
  });
  feature('feature:largeBuffers', {
    description:
      'Storage buffers of 256 MB and more, for GPU techniques at crowd scale (compute particles, GPU culling).',
    limits: { maxStorageBufferBindingSize: 268435456, maxBufferSize: 268435456 },
    advice: 'GFX_SMALL_BUFFERS',
    downgrade: 'GPU techniques with large buffers run smaller or stay off',
  });
  const declared = registry.kinds().includes('setting') && registry.has('setting', 'gfx.featuresOff');
  if (!declared) defineSettings(FEATURE_SETTINGS, registry);
}
defineFeatures();

/** Why `entry` is off on `caps` with `off` listed by the setting, or undefined when it is on. */
function whyOff(entry: FeatureEntry, caps: GfxCaps, off: readonly string[]): string | undefined {
  if (off.includes(entry.id)) return 'gfx.featuresOff lists it';
  const missing = entry.needs.filter((name) => !caps.features.includes(name));
  if (missing.length) return `the device lacks ${missing.join(' and ')}`;
  const low = Object.entries(entry.limits as Record<string, number>).filter(
    ([name, least]) => !((caps.limits[name] ?? 0) >= least),
  );
  if (low.length) {
    return low
      .map(([name, least]) => `the device's ${name} is ${caps.limits[name] ?? 'missing'}, it needs ${least}`)
      .join('; ');
  }
  return undefined;
}

/**
 * Checks every `feature` entry against `caps` and `gfx.featuresOff`, raises each off feature's advice once, and
 * reports what is on and off. Throws `CORE_NO_ENTRY` for an id the setting lists that no entry has.
 */
export function resolveFeatures(
  caps: GfxCaps,
  options: { registry?: Registry; settings?: Settings; log?: Log } = {},
): FeatureReport {
  const registry = options.registry ?? sharedRegistry;
  const settings = options.settings ?? createSettings({ registry });
  const log = options.log ?? sharedLog;
  const off = settings.get<readonly string[]>('gfx.featuresOff');
  for (const id of off) registry.get('feature', id);
  const report: FeatureReport = { on: [], off: [], downgrades: [] };
  for (const entry of registry.list('feature') as FeatureEntry[]) {
    const reason = whyOff(entry, caps, off);
    if (reason === undefined) {
      report.on.push(entry.id);
      continue;
    }
    log.warnOnce(entry.advice, { feature: entry.id, reason, downgrade: entry.downgrade }, entry.id);
    report.off.push({ id: entry.id, advice: entry.advice, reason });
  }
  report.downgrades = [...new Set(report.off.map((feature) => feature.advice))].sort();
  return report;
}
