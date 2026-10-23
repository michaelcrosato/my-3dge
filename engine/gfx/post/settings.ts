/**
 * @file The post chain's codes and settings (PLAN.md WP 7.4, WP 3.12): the advice engine/gfx/post/chain.ts gives
 * (`POST_CODES`: bloom off at a tier, too few levels, the flag table full, a style without a style set) and the view
 * settings it reads (`POST_SETTINGS`: `post.look`, `post.filters`, `post.show`), declared with the setting `quality`
 * by `definePostSettings`. Split from chain.ts to keep each under 400 lines (ADR-0014 amendment 16).
 *
 * Invariants: the settings are view settings (`view: true`), so they never reach the hash; declaring them twice on a
 * registry is a no-op.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * definePostSettings(reg);
 * reg.get('setting', 'post.look').default; // 'look:clean'
 * @see engine/gfx/post/chain.test.ts
 */
import { defineCodes } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { Field } from '../../core/schema';
import { defineSettings } from '../../core/settings';
import { QUALITY_SETTINGS } from '../quality';
import { AA_CHOICE, AA_KINDS } from './aa';
import { POST_SHOW } from './composite';
import { FILTER_FIELDS, partialSchema } from './filters';

/** The codes this module raises, with their fixes. */
export const POST_CODES = defineCodes('gfx', {
  GFX_POST_NO_BLOOM: {
    template: 'bloom is off at the {tier} quality tier: {look} draws without its glow',
    fix: "raise the view setting quality to 'medium' or 'high' to see the glow; nothing else about the look changes",
    doc: 'Advice from the post chain (engine/gfx/post/chain.ts): the look asks for bloom, which the quality tier turns off (WP 3.12).',
  },
  GFX_POST_FEW_LEVELS: {
    template: '{where} asks for {levels} levels per channel; the chain draws 8',
    fix: 'posterize with 0 (off) or 8 levels and more: fewer shift the hue of dull colours (shardfall measured a grey floor turning pink)',
    doc: 'Advice from the post chain when `post.filters` sets 1–7 levels; looks are checked when they are defined.',
  },
  GFX_POST_BAD_COLOR: {
    template: 'post.filters.outline.color is {color}, which is no colour: the outline darkens the surface instead',
    fix: "give hex ('#1a1a2e'), a CSS colour name ('black') or '' to darken the surface",
    doc: 'Advice from the post chain when `post.filters` sets an outline colour that is none; looks are checked when they are defined.',
  },
  GFX_POST_FLAG_SLOTS: {
    template: '{missed} objects draw as the environment: the flag table has {slots} slots, all taken',
    fix: 'draw fewer separate objects (instance or merge them); slots come back as their objects are collected',
    doc: 'Advice from the post chain: more live drawable objects than the fixed MRT’s flag table holds (engine/gfx/post/mrt.ts).',
  },
  GFX_POST_NO_STYLES: {
    template: '{look} asks for the material style {style}, but the chain has no style set: it draws only its filters',
    fix: 'give createPost a style set (createStyleSet, WP 7.2) as options.styles, attached to the warm-up, so looks change the materials too',
    doc: 'Advice from the post chain (engine/gfx/post/chain.ts): a look with a material style, drawn by a chain made without `styles`.',
  },
});

/**
 * The view settings the chain reads, declared by `definePostSettings`: `post.look` (a `look` id,
 * engine/gfx/post/looks.ts), `post.filters` (part of a filter chain laid over the look's, filter by filter and field by
 * field) and `post.show` (`picture`, or what the MRT holds: `parts`, `normals`, `groups`).
 */
export const POST_SETTINGS = {
  'post.look': {
    type: 'string',
    default: 'look:clean',
    view: true,
    description: "The look drawn: a 'look' id (look:clean, look:hd-2d, look:palette/game-boy, …).",
  },
  'post.filters': {
    type: 'object',
    default: {},
    view: true,
    properties: partialSchema(FILTER_FIELDS),
    description: 'Filters laid over the look, field by field: { "pixel": { "scope": "environment", "size": 6 } }.',
  },
  'post.show': {
    type: 'string',
    enum: POST_SHOW,
    default: 'picture',
    view: true,
    description: "What the chain draws: the 'picture', or what its MRT holds: 'parts', 'normals' or 'groups'.",
  },
  'post.aa': {
    type: 'string',
    enum: AA_KINDS,
    default: AA_CHOICE,
    view: true,
    when: 'scene',
    description:
      "The aa filter's edge smoothing, read when the chain is made: 'fxaa' (the one that measured better), 'smaa', or 'traa' (temporal, with feature:traa).",
  },
} as const satisfies Record<string, Field>;

/**
 * Declares the chain's settings (`POST_SETTINGS`) and the setting `quality` it reads on `registry` (the shared one by
 * default), unless it has them: on the shared one when this module loads, so `node x set post.look look:game-boy`
 * knows them in Node (tools/cmd/set.ts imports the modules that declare settings), and on any other when `createPost`
 * or `createEngine` runs. The chain reads them from the store it is given: `settings.set` on that store reaches it,
 * and so do `__engine.set`, URL parameters and with them `node x shot <page> --set post.look=…`, on a page whose
 * frames and shots go through `post.view`: every `createEngine` page (the Stress Box's: `node x shot labs/box --set
 * post.look=look:game-boy`), and tests/pages/post.html.
 */
export function definePostSettings(registry: Registry = sharedRegistry): void {
  const has = (path: string) => registry.kinds().includes('setting') && registry.has('setting', path);
  if (!has('post.look')) defineSettings(POST_SETTINGS, registry);
  if (!has('quality')) defineSettings(QUALITY_SETTINGS, registry);
}
definePostSettings();
