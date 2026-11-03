/**
 * @file The look a chain draws (PLAN.md WP 7.4, WP 13.24, WP 13.32; split from engine/gfx/post/chain.ts at its size
 * cap): what the view settings name now. `createLookResolver({ settings, registry, log })` gives
 * `resolve(perspective)`: the look `post.look` names (engine/gfx/post/looks.ts), its chain combined from its layers
 * (`combineChain`, engine/gfx/post/combine.ts), the looks `post.combine` lays over it, then `post.filters` laid over
 * those (`layerChain`), that layer's levels and colours fixed first, each fix's advice once (`GFX_POST_FEW_LEVELS`,
 * `GFX_POST_BAD_COLOR`, engine/gfx/post/filterChecks.ts), every amount scaled by `post.strength`, and the look's toon
 * numbers; for a perspective camera, when the look names a variant (`perspective`), the variant's chain under the same
 * layers, the look staying the look.
 *
 * Invariants: it reads the settings and the registry, never writes them; while `post.look`, `post.combine`,
 * `post.filters` and `post.strength` stay the same it gives the same objects, so the chain sees a change by identity
 * (engine/gfx/post/chain.ts's `sync`).
 *
 * @example
 * // const resolve = createLookResolver({ settings, registry, log });
 * // resolve(true).chain; // the filters a perspective camera draws now
 * @see engine/gfx/post/resolveLook.test.ts
 */
import type { Log } from '../../core/log';
import type { Registry } from '../../core/registry';
import type { Settings } from '../../core/settings';
import type { ToonLook } from '../materials/toon';
import { combineChain, layLooks, strengthen, type CombineLayer } from './combine';
import { fixColor, fixLevels, layerChain, type FilterChain, type FilterSpec } from './filters';
import type { LookEntry } from './looks';

/** What the settings name now (see the file comment); `variant` keeps a perspective camera's, once asked for. */
export type ResolvedLook = {
  id: string;
  /** `post.filters`, `post.combine` and `post.strength` as they were read (compared by identity). */
  over: unknown;
  layers: unknown;
  strength: number;
  look: LookEntry;
  chain: FilterChain;
  toon: ToonLook;
  variant?: ResolvedLook;
};

/** Makes the resolver over `settings` and `registry`, its advice to `log` (see the file comment). */
export function createLookResolver(options: {
  settings: Pick<Settings, 'get'>;
  registry: Pick<Registry, 'get'>;
  log: Pick<Log, 'warnOnce'>;
}): (perspective?: boolean) => ResolvedLook {
  const { settings, registry, log } = options;
  const warn = log.warnOnce.bind(log);
  let resolved: ResolvedLook | null = null;
  let spec: FilterSpec = {};
  /** `look`'s chain under the settings' layers, `post.filters` and `post.strength` (see the file comment). */
  const chainFor = (look: LookEntry, layers: readonly CombineLayer[], strength: number): FilterChain => {
    const combined = layLooks(combineChain(look, registry, warn), layers, registry, warn);
    return strengthen(layerChain(combined, spec), strength);
  };
  const resolveBase = (): ResolvedLook => {
    const id = settings.get<string>('post.look');
    const over = settings.get('post.filters');
    const layers = settings.get('post.combine');
    const strength = settings.get<number>('post.strength');
    if (resolved?.id === id && resolved.over === over && resolved.layers === layers && resolved.strength === strength)
      return resolved;
    const look = registry.get('look', id) as LookEntry;
    const { spec: levelled, raised } = fixLevels(over as FilterSpec);
    for (const { name, levels } of raised) {
      log.warnOnce('GFX_POST_FEW_LEVELS', { where: `post.filters.${name}.levels`, levels }, name);
    }
    const fixed = fixColor(levelled);
    if (fixed.dropped !== null) {
      const { where, color } = fixed.dropped;
      log.warnOnce('GFX_POST_BAD_COLOR', { where, color: JSON.stringify(color) }, `${where}=${color}`);
    }
    spec = fixed.spec;
    const chain = chainFor(look, layers as readonly CombineLayer[], strength);
    resolved = { id, over, layers, strength, look, chain, toon: look.toon };
    return resolved;
  };
  return (perspective = false) => {
    const base = resolveBase();
    if (!perspective || !base.look.perspective) return base;
    if (base.variant) return base.variant;
    const variant = registry.get('look', base.look.perspective) as LookEntry;
    const chain = chainFor(variant, base.layers as readonly CombineLayer[], base.strength);
    base.variant = { ...base, chain, toon: variant.toon };
    return base.variant;
  };
}
