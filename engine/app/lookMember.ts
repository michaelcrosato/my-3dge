/**
 * @file The inspector's `look` member (PLAN.md WP 13.32): the look drawn now, as data, so an agent reads what it
 * tuned and combined without a shot: `post.look`'s id, the looks `post.combine` lays over it, `post.strength`, and
 * every filter that is on with its scope, amount and numbers, as the chain resolves them (engine/gfx/post/
 * resolveLook.ts: the look's own layers combined, engine/gfx/post/combine.ts, then `post.combine`, `post.filters`
 * and `post.strength`). `filters` is a filter chain's part in `defineLook`'s form, so pasting it into a look draws
 * the same picture: the playground's Tune panel copies it that way (labs/playground/ui/tune.ts). It needs no renderer,
 * so it works headless as in a page; registered from here as an entry of the kind `inspectorMember`
 * (engine/dev/members.ts).
 *
 * Invariants: it reads the settings and the registry, never writes them, and records nothing; its advice is the
 * chain's (`GFX_POST_FEW_LEVELS`, `GFX_POST_BAD_COLOR`, `GFX_LOOK_COMBINE_LOOP`), each given once.
 *
 * @example
 * // __engine.set('post.combine', '[{"look":"look:cinematic"}]');
 * // __engine.look().filters.letterbox; // { scope: 'all', amount: 1, aspect: 2.39, color: '#000000' }
 * @see engine/app/viewMembers.test.ts
 */
import { defineMember, type InspectorHost } from '../dev/members';
import { FILTER_NAMES, type FilterSpec } from '../gfx/post/filters';
import { createLookResolver } from '../gfx/post/resolveLook';
import '../gfx/post/looks';
import '../gfx/post/settings';

/** What `look()` answers (see the file comment). */
export interface LookNow {
  /** The look `post.look` names (`look:clean` when it names none that exists). */
  look: string;
  /** The looks laid over it (`post.combine`), as set. */
  combine: unknown;
  /** How much of it all shows (`post.strength`). */
  strength: number;
  /** Every filter that is on, with all its fields: a look's `filters`. */
  filters: FilterSpec;
}

/** The look drawn now on `host` (see the file comment). */
export function lookNow(host: InspectorHost, perspective = false): LookNow {
  const settings = host.session.settings;
  const resolved = createLookResolver({ settings, registry: host.registry, log: host.log })(perspective);
  const filters: Record<string, unknown> = {};
  for (const name of FILTER_NAMES)
    if (resolved.chain[name].scope !== 'off') filters[name] = { ...resolved.chain[name] };
  return {
    look: resolved.look.id,
    combine: settings.get('post.combine'),
    strength: settings.get<number>('post.strength'),
    filters: filters as FilterSpec,
  };
}

defineMember('look', {
  help: "The look drawn now: post.look's id, post.combine's looks, post.strength, and every filter that is on with its scope, amount and numbers, as the chain draws them (paste filters into a look to keep it); { perspective: true } a perspective camera's.", // prettier-ignore
  args: {
    options: {
      type: 'object',
      default: {},
      description: '{ perspective }: true gives what a perspective camera draws (the look’s variant, if it names one).',
    },
  },
  impl: (h, options: { perspective?: boolean }) => lookNow(h, options.perspective === true),
});
