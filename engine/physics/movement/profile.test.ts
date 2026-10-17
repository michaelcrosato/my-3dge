/**
 * @file Unit tests for movement profiles (engine/physics/movement/profile.ts, profiles.ts): the kind and its two
 * profiles; `movement:platformer` makes the very character `createCharacter()` makes; `movement:apex` sets Apex's hull,
 * steps, slope, gravity, jump and grace period and carries the model at Apex's numbers, each within
 * docs/PLAYGROUND.md §3.2's tolerance of its reference; a spec's own fields win field by field, and its `model` tunes
 * the profile's; a profile that is not one names the closest; every profile defined makes a valid character.
 * @see engine/physics/movement/profile.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { parse } from '../../core/schema';
import { createCharacter } from '../character';
import { MODEL_FIELDS } from './model';
import { applyMovement, defineMovement, getMovement, listMovements } from './profile';

/** One degree, in radians. */
const DEG = Math.PI / 180;

describe('movement profiles', () => {
  it('lists the two every game gets, the platformer making the default character exactly', () => {
    expect(listMovements().map((profile) => profile.id)).toEqual(expect.arrayContaining(['movement:apex', 'movement:platformer'])); // prettier-ignore
    expect(createCharacter({ movement: 'movement:platformer' })).toEqual(createCharacter());
    expect('movement' in createCharacter({ movement: 'movement:platformer' })).toBe(false);
  });

  it('gives movement:apex Apex’s hull, steps, slope, gravity, jump and grace, within the reference tolerances', () => {
    const apex = createCharacter({ movement: 'movement:apex' });
    const { radius, height } = apex.capsule;
    expect(radius).toBeCloseTo(0.41, 1); // ±2 cm: 16 u
    expect(height + 2 * radius).toBeCloseTo(1.83, 1); // 72 u
    expect(Math.abs(apex.autostep.height - 0.56)).toBeLessThanOrEqual(0.02); // 22 u
    expect(Math.abs(apex.maxSlope / DEG - 45.57)).toBeLessThanOrEqual(1); // a floor normal 0.7 up
    expect(apex.characterGravity).toBe(19.05);
    expect(apex.jumpSpeed ** 2 / (2 * 19.05)).toBeCloseTo(1.4224, 6); // a 56 u jump
    expect(apex.feel).toMatchObject({ coyote: 0.2, variableJump: 1, dash: { speed: 0 } });
    expect(apex.movement).toEqual(parse(MODEL_FIELDS, {}));
  });

  it('holds Apex’s numbers in its model, each within its tolerance (speeds ±2%, accelerations ±5%, times one tick)', () => {
    const m = getMovement('movement:apex').model!;
    const within = (value: number, reference: number, share: number) =>
      expect(Math.abs(value - reference) / reference, `${value} against ${reference}`).toBeLessThanOrEqual(share);
    for (const [value, reference] of [[m.gaits.run, 4.41], [m.gaits.sprint, 6.6], [m.gaits.walk, 2.2], [m.gaits.crouch, 2.03], [m.gaits.run * m.gaits.holstered, 5.07], [m.gaits.sprint * m.gaits.holstered, 7.59], [m.gaits.sprintSide, 4.8], [m.accel.lowSpeed, 3.05], [m.air.speed, 1.52], [m.hop.cost, 2.54], [m.lurch.max, 4.6]] as const) within(value, reference, 0.02); // prettier-ignore
    for (const [value, reference] of [[m.accel.low, 63.5], [m.accel.run, 11.4], [m.accel.sprint, 2.54], [m.decel.stand, 31.8], [m.decel.crouch, 38.1], [m.air.accel, 12.7]] as const) within(value, reference, 0.05); // prettier-ignore
    expect([m.fatigue.height, m.fatigue.from, m.fatigue.to, m.hop.window, m.lurch.window, m.lurch.full, m.lurch.strength]).toEqual([0.3, 0.15, 0.75, 1, 0.4, 0.2, 0.7]); // prettier-ignore
    expect([m.land.from, m.land.full, m.land.recover, m.land.sprint]).toEqual([expect.closeTo(7.6, 1), expect.closeTo(20.3, 1), 1, 0.7]); // prettier-ignore
    expect(m.sprint.angle / DEG).toBeCloseTo(45, 9);
  });

  it('lets a spec’s own fields win, field by field, over its profile’s', () => {
    const tuned = createCharacter({ movement: 'movement:apex', speed: 5, feel: { coyote: 0.1 } });
    expect(tuned.speed).toBe(5);
    expect(tuned.feel).toMatchObject({ coyote: 0.1, variableJump: 1, dash: { speed: 0 } });
    expect(applyMovement({ speed: 3 })).toEqual({ speed: 3 });
    const quick = createCharacter({ movement: 'movement:apex', model: { gaits: { run: 5 } } });
    expect(quick.movement?.gaits).toMatchObject({ run: 5, sprint: 6.604 });
    expect(() => createCharacter({ model: { gaits: { run: 5 } } })).toThrow(/give it with movement/);
    expect(() => createCharacter({ movement: 'movement:platformer', model: {} })).toThrow(/no model to tune/);
  });

  it('names the closest profile for a missing one, and refuses a movement that names none', () => {
    expect(() => createCharacter({ movement: 'movement:apx' })).toThrow(/movement:apex/);
    expect(() => createCharacter({ movement: 'apex' })).toThrow(/must name a profile/);
  });

  it('makes a valid character of every profile defined, and checks a profile’s model when it is defined', () => {
    for (const profile of listMovements()) expect(() => createCharacter({ movement: profile.id }), profile.id).not.toThrow(); // prettier-ignore
    const registry = createRegistry();
    defineMovement('movement:quick', { model: { gaits: { sprint: 9 } } }, registry);
    expect(getMovement('movement:quick', registry).model?.gaits).toMatchObject({ sprint: 9, run: 4.4069 });
    expect(() => defineMovement('movement:bad', { model: { gaits: { sprint: -1 } } }, registry)).toThrow(/below its minimum/); // prettier-ignore
  });
});
