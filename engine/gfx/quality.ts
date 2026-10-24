/**
 * @file Quality tiers, the defaults for phones (PLAN.md WP 3.12, ADR-0021: built, not tested): the view setting
 * `quality` (`auto`, `low`, `medium` or `high`) and what each tier turns off. `auto` is `medium` on touch screens and
 * `high` elsewhere; the app gives the touch mode (engine/input/devices/touch.ts) and applies the budget.
 *
 * - `high`: everything; on a touch screen, at most 2 device pixels per CSS pixel.
 * - `medium`: at most 1 megapixel, one shadow caster, GI and god rays off.
 * - `low`: at most 0.5 megapixel, no shadow casters, and bloom and halos off as well.
 *
 * engine/gfx/resolution.ts applies the pixel caps (`resolution.cap(budget)`), engine/gfx/shadows.ts the shadow
 * casters, the post chain the bloom (engine/gfx/post/chain.ts), and its shading the GI, the god rays (the air's light
 * shafts) and the halos (engine/gfx/post/shading.ts, WP 11.5).
 *
 * Invariants: a view setting, so `capture()`, the hash and sim-side code never see it; on the desktop `auto` is
 * `high`, which caps nothing, so a desktop draws as it did before this module. No `@example` runs here: it would be a
 * touch test, which the owner ruled out (ADR-0021).
 *
 * Carried from `shardfall:crates/pav_app/src/quality.rs:29-115` (`resolve`, `trim`, the scaler's caps; its dynamic
 * scale is left for a measured need).
 *
 * @example
 * // qualityBudget('auto', true); // { tier: 'medium', maxPixels: 1e6, shadowCasters: 1, gi: false, … }
 */
import type { Field } from '../core/schema';
import { defineSettings } from '../core/settings';

/** The `quality` setting's values. */
export const QUALITY_SETTING_VALUES = ['auto', 'low', 'medium', 'high'] as const;

/** The `quality` setting: a tier, or `auto`. */
export type QualitySetting = (typeof QUALITY_SETTING_VALUES)[number];

/** A quality tier, as `auto` resolves. */
export type QualityTier = Exclude<QualitySetting, 'auto'>;

/** The quality settings: view settings, never in the hash. */
export const QUALITY_SETTINGS = {
  quality: {
    type: 'string',
    enum: QUALITY_SETTING_VALUES,
    default: 'auto',
    view: true,
    description:
      "How much the picture costs: 'high' draws everything, 'medium' at most 1 megapixel with one shadow caster and no GI or god rays, 'low' at most 0.5 megapixel with no shadows, bloom or halos; 'auto' is medium on touch screens, high elsewhere.",
  },
} as const satisfies Record<string, Field>;
defineSettings(QUALITY_SETTINGS);

/** What a tier affords; `null` caps nothing. */
export interface QualityBudget {
  tier: QualityTier;
  /** The most pixels the drawing buffer holds. */
  maxPixels: number | null;
  /** The most device pixels drawn per CSS pixel. */
  maxPixelRatio: number | null;
  /** The most lights that cast shadows. */
  shadowCasters: number | null;
  /** Global illumination (WP 7.4). */
  gi: boolean;
  /** God rays (WP 7.4). */
  godRays: boolean;
  /** Bloom (WP 7.1). */
  bloom: boolean;
  /** Halos round lights (WP 7.1). */
  halos: boolean;
}

/** The tier `setting` means on a touch screen (`touch`) or elsewhere. */
export function resolveQuality(setting: QualitySetting, touch: boolean): QualityTier {
  return setting === 'auto' ? (touch ? 'medium' : 'high') : setting;
}

/** What `setting` affords on a touch screen (`touch`) or elsewhere (see the file comment). */
export function qualityBudget(setting: QualitySetting, touch: boolean): QualityBudget {
  const tier = resolveQuality(setting, touch);
  const all = { gi: true, godRays: true, bloom: true, halos: true };
  if (tier === 'low') {
    return { tier, maxPixels: 0.5e6, maxPixelRatio: null, shadowCasters: 0, gi: false, godRays: false, bloom: false, halos: false }; // prettier-ignore
  }
  if (tier === 'medium') {
    return { tier, maxPixels: 1e6, maxPixelRatio: null, shadowCasters: 1, ...all, gi: false, godRays: false };
  }
  return { tier, maxPixels: null, maxPixelRatio: touch ? 2 : null, shadowCasters: null, ...all };
}
