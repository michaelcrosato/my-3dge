/**
 * @file What a filter's fields are made of (PLAN.md WP 7.4, WP 13.31): the scopes a filter takes and the schema
 * builders every filter's fields use (engine/gfx/post/filterFields.ts, filterFieldsMore.ts). A filter is an object
 * field with a `scope` (where it applies: `off`, `all`, or the characters, the objects, the environment and their
 * pairs; the filters that act on the camera or the screen take only `off` and `all`), an `amount` (how much of it
 * shows, 0 to 1: 0 as if it were off, so a blend or a look's strength fades it instead of switching it, Style Lab's
 * rule) and its numbers.
 *
 * Invariants: `scopeMask` gives 0 for `off` and 7 for `all`, the bits engine/gfx/post/mrt.ts packs (`PART_BITS`);
 * every number field has its range; a colour field is a `#rrggbb` hex string.
 *
 * @example
 * scopeMask('characters+objects'); // 3
 * filter('A filter.', { scope: scope() }).default; // { scope: 'off', amount: 1 }
 * @see engine/gfx/post/filters.test.ts
 */
import type { Field, Schema } from '../../core/schema';
import { PART_BITS } from './mrt';

/** Where a filter applies: nowhere, everywhere, or one or two parts of the scene (engine/gfx/post/mrt.ts). */
export const SCOPES = [
  'off',
  'all',
  'characters',
  'objects',
  'environment',
  'characters+objects',
  'characters+environment',
  'objects+environment',
] as const;

/** A filter's scope. */
export type Scope = (typeof SCOPES)[number];

/** The scopes of the filters that cover the whole screen. */
export const SCREEN_SCOPES = ['off', 'all'] as const;

/** The bits of a scope: characters 1, objects 2, environment 4; `off` 0. */
export function scopeMask(scope: Scope): number {
  if (scope === 'off') return 0;
  if (scope === 'all') return 7;
  const bit = { characters: PART_BITS.character, objects: PART_BITS.object, environment: PART_BITS.environment };
  return scope.split('+').reduce((mask, part) => mask | bit[part as keyof typeof bit], 0);
}

/** A number field. */
export const num = (description: string, value: number, minimum: number, maximum: number, unit?: string) =>
  ({ type: 'number', default: value, minimum, maximum, description, ...(unit ? { unit } : {}) }) as const;

/** An integer field. */
export const int = (description: string, value: number, minimum: number, maximum: number, unit?: string) =>
  ({ type: 'integer', default: value, minimum, maximum, description, ...(unit ? { unit } : {}) }) as const;

/** The unit a colour field carries: how the docs and the checks know it (engine/gfx/post/filterChecks.ts). */
export const COLOR_UNIT = '#rrggbb';

/** A colour field: a `#rrggbb` hex string, sRGB. */
export const color = (description: string, value: string) =>
  ({ type: 'string', default: value, description, unit: COLOR_UNIT }) as const;

/** A filter's scope field: by part, or (`screen`) only on or off over the whole screen. */
export const scope = (screen = false) =>
  ({
    type: 'string',
    enum: screen ? SCREEN_SCOPES : SCOPES,
    default: 'off',
    description: screen
      ? "'all' turns it on over the whole picture; 'off' turns it off."
      : "Where it applies: 'off', 'all', or 'characters', 'objects', 'environment' or two of them joined by '+'.",
  }) as const;

/** Every filter's `amount` (see the file comment). */
export const AMOUNT = num(
  "How much of the filter shows, 0 to 1: 0 is as if it were off, so a blend or a look's strength fades it.",
  1,
  0,
  1,
);

/** A filter: an object field whose default holds every property's default, its `amount` added after its scope. */
export const filter = <const P extends { scope: Field } & Schema>(description: string, properties: P) => {
  // the scope first, then the amount, then the rest: a filter with an `amount` of its own keeps it (grain, chroma)
  const all = Object.assign({ scope: properties.scope, amount: AMOUNT }, properties) as { amount: typeof AMOUNT } & P;
  const defaults = Object.fromEntries(Object.entries(all).map(([key, field]) => [key, field.default]));
  return { type: 'object', default: defaults, description, properties: all } as const;
};
