/**
 * @file The look a chain draws (PLAN.md WP 7.4, WP 13.24; split from engine/gfx/post/chain.ts at its size cap): what
 * the view settings name now. `createLookResolver({ settings, registry, log })` gives `resolve(perspective)`: the look
 * `post.look` names (engine/gfx/post/looks.ts), its filters with `post.filters` laid over them (`layerChain`), that
 * layer's levels and outline colour fixed first, each fix's advice once (`GFX_POST_FEW_LEVELS`, `GFX_POST_BAD_COLOR`,
 * engine/gfx/post/filterChecks.ts), and its toon numbers; for a perspective camera, when the look names a variant
 * (`perspective`), the variant's filters and toon numbers under the same layer, the look staying the look.
 *
 * Invariants: it reads the settings and the registry, never writes them; while `post.look` and `post.filters` stay
 * the same it gives the same objects, so the chain sees a change by identity (engine/gfx/post/chain.ts's `sync`).
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
import { fixColor, fixLevels, layerChain, type FilterChain, type FilterSpec } from './filters';
import type { LookEntry } from './looks';

/** What the settings name now (see the file comment); `variant` keeps a perspective camera's, once asked for. */
export type ResolvedLook = {
  id: string;
  over: unknown;
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
  let resolved: ResolvedLook | null = null;
  const resolveBase = (): ResolvedLook => {
    const id = settings.get<string>('post.look');
    const over = settings.get('post.filters');
    if (resolved && resolved.id === id && resolved.over === over) return resolved;
    const look = registry.get('look', id) as LookEntry;
    const { spec: levelled, raised } = fixLevels(over as FilterSpec);
    for (const { name, levels } of raised) {
      log.warnOnce('GFX_POST_FEW_LEVELS', { where: `post.filters.${name}.levels`, levels }, name);
    }
    const { spec, dropped } = fixColor(levelled);
    if (dropped !== null) log.warnOnce('GFX_POST_BAD_COLOR', { color: JSON.stringify(dropped) }, dropped);
    resolved = { id, over, look, chain: layerChain(look.filters, spec), toon: look.toon };
    return resolved;
  };
  return (perspective = false) => {
    const base = resolveBase();
    if (!perspective || !base.look.perspective) return base;
    if (base.variant) return base.variant;
    const variant = registry.get('look', base.look.perspective) as LookEntry;
    base.variant = { ...base, chain: layerChain(variant.filters, fixColor(fixLevels(base.over as FilterSpec).spec).spec), toon: variant.toon }; // prettier-ignore
    return base.variant;
  };
}
