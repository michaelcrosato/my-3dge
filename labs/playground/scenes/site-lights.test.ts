/**
 * @file Tests for the block's light and time (labs/playground/scenes/site.ts, WP 13.23): the street's lamps and the
 * porch's dark at noon and lit at night, by the hour the scene starts at (`playground.hour`), so spawned before the
 * first step; a running day (`playground.day`) lights them as the clock passes dusk; the crawlspace's lamp on its
 * switch under the low ceiling; the dev actions `daytime` and `lights`, an unknown group refused with the groups there
 * are; and a switch changing the sim only through its own state: the group's lamps' `propLight.on` and its switches'
 * `switch.on`, nothing else.
 * @see labs/playground/scenes/site.ts
 */
import { describe, expect, it } from 'vitest';
import { createSession } from '../../../engine/sim/session';
import { diffStates } from '../../../engine/sim/state';
import { daytimeOf, type World } from '../../../engine/sim-api';
import { HOUSE_LIGHTS } from '../furnish';
import { SITE_SCENES } from './site';

type Lamp = { id: number; sceneProp: { prop: string }; propLight: { on: boolean; group: string } };

/** The street, started at `hour` with a day of `day` minutes, stepped once. */
function street(hour: number, day = 0) {
  const session = createSession(SITE_SCENES.street, { seed: 1, settings: { 'playground.hour': hour, 'playground.day': day } }); // prettier-ignore
  session.step({});
  const world = session.world as unknown as World;
  const lamps = (group: string) => (world.query('propLight') as unknown as Lamp[]).filter((e) => e.propLight.group === group); // prettier-ignore
  const lit = (group: string) => lamps(group).map((e) => e.propLight.on);
  return { session, world, lamps, lit };
}

describe("the block's light and time", () => {
  it("lights the street's four lamps and the porch's at night, not at noon, by the hour the scene starts at", () => {
    const [noon, night] = [street(12), street(22)];
    expect([noon.lit('street'), noon.lit('room:porch')]).toEqual([[false, false, false, false], [false]]);
    expect([night.lit('street'), night.lit('room:porch')]).toEqual([[true, true, true, true], [true]]);
    expect([daytimeOf(noon.world), daytimeOf(night.world)]).toEqual([12, 22]);
    expect(noon.lamps('street').every((e) => e.sceneProp.prop === 'prop:playground-streetlight')).toBe(true);
    expect(noon.lit('room:kitchen')).toEqual([true]); // a room's lamp on its switch, day or night
  });

  it('spawns them as the starting hour has them, so the first frame is right before the first step', () => {
    for (const [hour, lit] of [
      [12, false],
      [22, true],
    ] as const) {
      const session = createSession(SITE_SCENES.street, { seed: 1, settings: { 'playground.hour': hour } });
      const world = session.world as unknown as World;
      const group = (name: string) => [...(world.query('propLight') as unknown as Lamp[]).filter((e) => e.propLight.group === name).map((e) => e.propLight.on), ...(world.query('switch') as unknown as { switch: { group: string; on: boolean } }[]).filter((e) => e.switch.group === name).map((e) => e.switch.on)]; // prettier-ignore
      expect([hour, group('street'), group('room:porch')]).toEqual([hour, [lit, lit, lit, lit], [lit, lit]]);
    }
  });

  it('lights them as a running day passes dusk', () => {
    const { session, world, lit } = street(18.4, 1); // a day a minute: 0.4 h a second
    expect(lit('street').every((on) => !on)).toBe(true);
    for (let i = 0; i < 60; i++) session.step({});
    expect([daytimeOf(world)! > 18.5, lit('street').every((on) => on)]).toEqual([true, true]);
  });

  it("hangs the crawlspace's lamp under its low ceiling, its switch where a crouched player reaches", () => {
    const { world, lamps } = street(12);
    const [lamp] = lamps('room:crawlspace') as unknown as { sceneProp: { y: number } }[];
    const plate = (world.query('switch') as unknown as { switch: { group: string }; sceneProp: { y: number } }[]).find((e) => e.switch.group === 'room:crawlspace')!; // prettier-ignore
    const floor = lamp.sceneProp.y - HOUSE_LIGHTS.crawlspace.ceiling!; // the lamp's top, under the 1.4 m ceiling
    expect(plate.sceneProp.y - floor).toBeCloseTo(HOUSE_LIGHTS.crawlspace.plate!, 6);
  });

  it('sets the clock and switches a group by the dev actions, and refuses a group the block lacks', () => {
    const { session, world, lit } = street(12);
    session.act('daytime', { hour: 21 });
    session.step({});
    expect([daytimeOf(world), lit('street').every((on) => on)]).toEqual([21, true]);
    session.act('lights', { group: 'street', on: false });
    expect(lit('street').every((on) => !on)).toBe(true);
    expect(() => session.act('lights', { group: 'room:ballroom' })).toThrow(
      /no light group 'room:ballroom'.*room:kitchen/,
    );
  });

  it("changes the sim through a switch only in the switch's state: its lamps' and its switches' on", () => {
    const { session, world } = street(12);
    const before = world.state();
    session.act('lights', { group: 'room:kitchen', on: false });
    const changed = diffStates(before, world.state(), 50).map((d) => d.path);
    const kitchen = [...(world.query('propLight') as unknown as Lamp[]), ...(world.query('switch') as unknown as Lamp[])]; // prettier-ignore
    const ids = kitchen.filter((e) => (e.propLight?.group ?? (e as unknown as { switch: { group: string } }).switch.group) === 'room:kitchen').map((e) => e.id); // prettier-ignore
    expect(changed.sort()).toEqual(ids.map((id) => (world.get(id) as unknown as { switch?: object }).switch ? `entities.${id}.switch.on` : `entities.${id}.propLight.on`).sort()); // prettier-ignore
  });
});
