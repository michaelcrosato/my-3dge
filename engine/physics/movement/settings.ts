/**
 * @file The shooter model's live tuning (PLAN.md WP 13.4, docs/PLAYGROUND.md §3.4): a setting for every number and
 * switch of the model, `movement.<group>.<field>` (`movement.gaits.sprint`, `movement.mantle.boost`) and
 * `movement.turnRate`, its default, range, unit and description the model's own (engine/physics/movement/model.ts),
 * taking effect at once (the feel panel's sliders take the numbers).
 * A setting off its default replaces that number in the model of every character on one, from the next step; at its
 * default it leaves each character's own number (its profile's, tuned or not). `movementOverrides(get)` lists the
 * settings off their defaults, once a step; `tuneCharacter` lays them over a character; engine/sim/actors.ts steps the
 * tuned character, and the feel panel (engine/dev/feel/panel.ts) moves the sliders.
 *
 * Invariants: settings change play, so the world hashes, captures and replays them (only those off their defaults,
 * so declaring these changes no hash); a tuned character is a new object, the actor's own never changes; nothing is
 * tuned when every setting is at its default.
 *
 * @example
 * import { createCharacter } from '../character';
 * const overrides = movementOverrides((path) => (path === 'movement.gaits.sprint' ? 8 : MOVEMENT_SETTINGS[path]?.default)); // prettier-ignore
 * tuneCharacter(createCharacter({ movement: 'movement:apex' }), overrides).movement?.gaits.sprint; // 8
 * @see engine/physics/movement/settings.test.ts
 */
import type { Field } from '../../core/schema';
import { defineSettings } from '../../core/settings';
import type { Character } from '../character';
import { MODEL_FIELDS, type MovementModel } from './model';

/** One setting off its default: the model's group (none for `turnRate`), the number's or switch's key, and its value. */ // prettier-ignore
export type MovementOverride = readonly [group: string | undefined, key: string, value: number | boolean];

/** One number or switch of the model: its setting's path, its group (none for `turnRate`), its key and its field. */
type ModelValue = readonly [path: string, group: string | undefined, key: string, field: Field];

/** The model's numbers and switches (`crouch.jump`, `mantle.boost`), each with its group's description before its own. */ // prettier-ignore
const VALUES: readonly ModelValue[] = Object.entries(MODEL_FIELDS).flatMap(([group, field]): ModelValue[] => {
  const own = field as Field & { properties?: Record<string, Field> };
  if (!own.properties) return [[`movement.${group}`, undefined, group, own]];
  return Object.entries(own.properties).flatMap(([key, each]): ModelValue[] => {
    const description = `${own.description} ${each.description}`;
    return each.type === 'number' || each.type === 'boolean' ? [[`movement.${group}.${key}`, group, key, { ...each, description }]] : []; // prettier-ignore
  });
});

/** The settings, path → field: each the model's number or switch with its group's description first, live. */
export const MOVEMENT_SETTINGS: Readonly<Record<string, Field>> = Object.fromEntries(
  VALUES.map(([path, , , field]) => [path, { ...field, when: 'now' }]),
);
defineSettings(MOVEMENT_SETTINGS);

/** The settings `get` reads off their defaults, as overrides (none when every one is at its default). */
export function movementOverrides(get: (path: string) => unknown): MovementOverride[] {
  const out: MovementOverride[] = [];
  for (const [path, group, key, field] of VALUES) {
    const value = get(path);
    if ((typeof value === 'number' || typeof value === 'boolean') && !Object.is(value, field.default)) out.push([group, key, value]); // prettier-ignore
  }
  return out;
}

/** `character` with `overrides` over its model's values; itself when it has no model or nothing is overridden. */
export function tuneCharacter(character: Character, overrides: readonly MovementOverride[]): Character {
  if (!character.movement || overrides.length === 0) return character;
  const groups = { ...character.movement } as Record<string, unknown>;
  for (const [group, key, value] of overrides) {
    if (group === undefined) groups[key] = value;
    else groups[group] = { ...(groups[group] as object), [key]: value };
  }
  return { ...character, movement: groups as unknown as MovementModel };
}
