/**
 * @file Combining looks (PLAN.md WP 13.32): a chain made of the filters of other looks, mixed, as Style Lab mixes
 * looks (michaelcrosato/my-ai-3d-demo@34c6fa1, DESIGN.md §6.6 and src/runtime/look/resolve.js), here on the filters
 * alone. A look's `combine` (engine/gfx/post/looks.ts) lists layers: each a look, how much of it shows (`amount`),
 * which of its filters (`only`, all of them when empty) and changes to them first (`filters`, field by field, the
 * setting `post.filters`'s form). `combineChain` lays them in order on a chain with every filter off, then the look's
 * own filters that are on, then scales every filter's `amount` by the look's `strength`. The view settings
 * `post.combine` and `post.strength` do the same over the look the page draws (engine/gfx/post/resolveLook.ts), so a
 * page, a tool or an agent tunes and combines looks live, each change a uniform write.
 *
 * Laying a filter on at an amount `t` (`layFilter`): where the chain has it off, the layer's filter comes in with its
 * `amount` times `t`, so it fades in instead of popping; where both have it on, its numbers move `t` of the way to the
 * layer's (whole numbers round, the schema's `integer`), its colours mix in linear light, and its choices (the scope,
 * styles, palettes, switches) take the layer's from `t` 0.5: Style Lab's blend rules. A layer never turns a filter
 * off. A layer's look is combined first, so looks build on looks; a look already being combined is skipped with
 * advice (`GFX_LOOK_COMBINE_LOOP`, engine/gfx/post/settings.ts), so a cycle cannot loop.
 *
 * Invariants: pure functions of their arguments and the registry; every chain they return is whole, every filter
 * present; a look with no layers at strength 1 gives its own chain, the same object; nothing here touches the GPU.
 *
 * @example
 * layFilter('grade', chainOf().grade, chainOf({ grade: { scope: 'all' } }).grade, 0.25).amount; // 0.25
 * // combineChain(registry.get('look', 'look:mine') as LookEntry, registry, warn).grade.contrast;
 * @see engine/gfx/post/combine.test.ts
 */
import { Color } from 'three/webgpu';
import type { Registry } from '../../core/registry';
import type { Field } from '../../core/schema';
import { colorProblem } from './filterChecks';
import {
  FILTER_FIELDS,
  FILTER_NAMES,
  chainOf,
  layerChain,
  partialSchema,
  type FilterChain,
  type FilterName,
  type FilterSpec,
} from './filters';
import { COLOR_UNIT, num } from './filterSchema';
import type { LookEntry } from './looks';

/** One layer of a combination (see the file comment). */
export interface CombineLayer {
  /** The look laid on (`look:<name>`). */
  look: string;
  /** How much of it shows, 0 to 1 (1 when left out). */
  amount?: number;
  /** Only these of its filters (all of them when empty or left out). */
  only?: readonly FilterName[];
  /** Changes to its filters before it is laid on, field by field. */
  filters?: FilterSpec;
}

/** The field a look's `combine` and the setting `post.combine` share: the layers, in order. */
export const COMBINE_FIELD = {
  type: 'array',
  default: [],
  description:
    'Looks laid on, in order, each { look, amount?, only?, filters? }: how much of it shows, which of its filters, and changes to them.',
  items: {
    type: 'object',
    properties: {
      look: { type: 'string', required: true, description: "The look laid on: a 'look' id." },
      amount: num('How much of it shows, 0 to 1: its numbers move this far, its filters fade in this much.', 1, 0, 1),
      only: {
        type: 'array',
        default: [],
        items: { type: 'string', enum: FILTER_NAMES },
        description: 'Only these of its filters; all of them when empty.',
      },
      filters: {
        type: 'object',
        default: {},
        properties: partialSchema(FILTER_FIELDS),
        description: 'Changes to its filters before it is laid on, field by field (the form of post.filters).',
      },
    },
  },
} as const satisfies Field;

/** The field a look's `strength` and the setting `post.strength` share. */
export const STRENGTH_FIELD = num(
  "How much of the whole look shows, 0 to 1: every filter's amount is scaled by it, so 0 draws the scene clean.",
  1,
  0,
  1,
);

/** The schema of a filter's field `key`. */
const fieldOf = (name: FilterName, key: string) =>
  (FILTER_FIELDS[name].properties as Record<string, Field | undefined>)[key];

/** `a` moved `t` of the way to `b`, as the filter's field `key` blends (see the file comment). */
function blendValue(name: FilterName, key: string, a: unknown, b: unknown, t: number): unknown {
  const field = fieldOf(name, key);
  if (typeof a === 'number' && typeof b === 'number') {
    const v = a + (b - a) * t;
    return field?.type === 'integer' ? Math.round(v) : v;
  }
  const colours = field?.unit === COLOR_UNIT && typeof a === 'string' && typeof b === 'string';
  if (colours && a && b && !colorProblem(a, key) && !colorProblem(b, key)) {
    return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
  }
  return t >= 0.5 ? b : a;
}

/** Filter `name` of a layer laid on the chain's at `t` (see the file comment). */
export function layFilter<F extends { scope: string; amount: number }>(
  name: FilterName,
  base: F,
  layer: F,
  t: number,
): F {
  if (layer.scope === 'off' || t <= 0) return base;
  if (base.scope === 'off') return { ...layer, amount: layer.amount * Math.min(t, 1) };
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(layer)) {
    out[key] = blendValue(name, key, (base as Record<string, unknown>)[key], (layer as Record<string, unknown>)[key], Math.min(t, 1)); // prettier-ignore
  }
  return out as F;
}

/** `layer` laid on `chain` at `t`, only the filters `only` names (all of them when empty). */
export function layChain(
  chain: FilterChain,
  layer: FilterChain,
  t: number,
  only: readonly FilterName[] = [],
): FilterChain {
  const out: Record<string, unknown> = { ...chain };
  for (const name of FILTER_NAMES) {
    if (only.length > 0 && !only.includes(name)) continue;
    out[name] = layFilter(name, chain[name], layer[name], t);
  }
  return out as FilterChain;
}

/** `chain` with every filter's amount scaled by `strength` (0 to 1); at 1, `chain` itself. */
export function strengthen(chain: FilterChain, strength: number): FilterChain {
  if (strength >= 1) return chain;
  const out: Record<string, unknown> = { ...chain };
  for (const name of FILTER_NAMES) {
    const f = chain[name];
    if (f.scope !== 'off') out[name] = { ...f, amount: f.amount * Math.max(strength, 0) };
  }
  return out as FilterChain;
}

/** How combining reports a cycle: `log.warnOnce`'s form. */
export type CombineWarn = (code: 'GFX_LOOK_COMBINE_LOOP', data: { look: string; through: string }, key: string) => void;

/** `layers` laid in order on `chain`, each layer's look combined first; `seen` holds the looks being combined. */
export function layLooks(
  chain: FilterChain,
  layers: readonly CombineLayer[],
  registry: Pick<Registry, 'get'>,
  warn: CombineWarn,
  seen: readonly string[] = [],
): FilterChain {
  let out = chain;
  for (const layer of layers) {
    if (seen.includes(layer.look)) {
      const through = [...seen, layer.look].join(' → ');
      warn('GFX_LOOK_COMBINE_LOOP', { look: layer.look, through }, through);
      continue;
    }
    const look = registry.get('look', layer.look) as LookEntry;
    const own = combineChain(look, registry, warn, [...seen, layer.look]);
    const changed = layer.filters && Object.keys(layer.filters).length > 0 ? layerChain(own, layer.filters) : own;
    out = layChain(out, changed, layer.amount ?? 1, layer.only);
  }
  return out;
}

/** A look's whole chain: its `combine` layers, then its own filters that are on, then its `strength`. */
export function combineChain(
  look: LookEntry,
  registry: Pick<Registry, 'get'>,
  warn: CombineWarn,
  seen: readonly string[] = [look.id],
): FilterChain {
  if (look.combine.length === 0 && look.strength >= 1) return look.filters;
  const combined = layLooks(chainOf(), look.combine as readonly CombineLayer[], registry, warn, seen);
  return strengthen(layChain(combined, look.filters, 1), look.strength);
}
