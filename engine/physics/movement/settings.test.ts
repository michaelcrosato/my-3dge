/**
 * @file Unit tests for the shooter model's live tuning (engine/physics/movement/settings.ts): a setting for every number
 * and switch of the model, at the model's default, range and unit, taking effect at once; every setting at its
 * default tunes nothing; one off its default replaces that number or switch in a model character's model, a new
 * character, the original left as it was; a character without a model is never tuned.
 * @see engine/physics/movement/settings.ts
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../../core/schema';
import { createCharacter } from '../character';
import { MODEL_FIELDS } from './model';
import { MOVEMENT_SETTINGS, movementOverrides, tuneCharacter } from './settings';

/** A reader of the settings at their defaults, but `changed`. */
const reader = (changed: Record<string, number | boolean> = {}) => (path: string) => changed[path] ?? MOVEMENT_SETTINGS[path]?.default; // prettier-ignore

describe('movement settings', () => {
  it('declare every number and switch of the model at its default, range and unit, live', () => {
    const model = parse(MODEL_FIELDS, {});
    const paths = Object.keys(MOVEMENT_SETTINGS);
    const values = Object.entries(model).flatMap(([group, value]) => (typeof value === 'number' ? [`movement.${group}`] : Object.keys(value).map((key) => `movement.${group}.${key}`))); // prettier-ignore
    expect(paths.sort()).toEqual(values.sort());
    // the mantle boost: an option, as docs/PLAYGROUND.md §3.2 has it
    expect(MOVEMENT_SETTINGS['movement.mantle.boost']).toMatchObject({ type: 'boolean', default: false, when: 'now' });
    expect(MOVEMENT_SETTINGS['movement.gaits.sprint']).toMatchObject({ type: 'number', default: 6.604, minimum: 0, maximum: 100, unit: 'm/s', when: 'now' }); // prettier-ignore
    expect(MOVEMENT_SETTINGS['movement.gaits.sprint'].description).toMatch(/^Ground speeds by gait.* The sprint: 260 u\/s\.$/); // prettier-ignore
    expect(MOVEMENT_SETTINGS['movement.turnRate'].default).toBeCloseTo(4 * Math.PI, 12);
  });

  it('tune nothing at their defaults, and one number or switch of a model character off its default', () => {
    const apex = createCharacter({ movement: 'movement:apex' });
    expect(movementOverrides(reader())).toEqual([]);
    expect(tuneCharacter(apex, movementOverrides(reader()))).toBe(apex);
    const overrides = movementOverrides(reader({ 'movement.gaits.sprint': 8, 'movement.turnRate': 1 }));
    expect(overrides).toEqual([['gaits', 'sprint', 8], [undefined, 'turnRate', 1]]); // prettier-ignore
    expect(tuneCharacter(apex, movementOverrides(reader({ 'movement.mantle.boost': true }))).movement?.mantle.boost).toBe(true); // prettier-ignore
    const tuned = tuneCharacter(apex, overrides);
    expect(tuned.movement).toMatchObject({ gaits: { sprint: 8, run: 4.4069 }, turnRate: 1, air: apex.movement!.air });
    expect(apex.movement?.gaits.sprint).toBe(6.604); // the original as it was
    const platformer = createCharacter();
    expect(tuneCharacter(platformer, overrides)).toBe(platformer);
  });
});
