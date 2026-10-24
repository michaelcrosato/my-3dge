/**
 * @file Tests for the time of day (engine/sim/lights.ts; WP 13.23): the clock runs at its rate and past midnight, and
 * holds at 0; set again it moves, one clock a world; a rule puts its group as the hour has it, switches it on at dusk
 * and off at dawn as the clock passes them (through midnight too), and leaves a player's switch alone between; the
 * clock and its rules are in the hash and continue exactly from a capture; bad hours and rates are refused.
 * @see engine/sim/lights.ts
 */
import { describe, expect, it } from 'vitest';
import { daytimeOf, DAWN, DUSK, lightsAtDusk, litAt, passed, setDaytime, type DaytimeComponent } from './lights';
import { spawnProp, type ScenePropComponents } from './props';
import { defineScene } from './scene';
import { createSession } from './session';
import { addSwitch, flipSwitch } from './switches';
import type { World } from './world';

/** A street of two lamps (1, 2) in the group `street`, a porch lamp (3) on its switch (4), the clock at `hour`. */
function street(name: string, hour: number, rate: number) {
  const scene = defineScene(`lights-test:${name}`, {
    setup(w) {
      spawnProp(w, { prop: 'prop:lamp', at: [0, 4, 0], yaw: 0 }, { group: 'street' });
      spawnProp(w, { prop: 'prop:lamp', at: [10, 4, 0], yaw: 0 }, { group: 'street' });
      spawnProp(w, { prop: 'prop:lamp', at: [5, 2.5, 6], yaw: 0 }, { group: 'porch' });
      addSwitch(w, { at: [5, 1.2, 6.5], group: 'porch' });
      setDaytime(w, { hour, rate });
      lightsAtDusk(w, 'street');
      lightsAtDusk(w, 'porch', { on: 19, off: 23 });
    },
  });
  const session = createSession(scene, { seed: 1 });
  const lit = () => [1, 2, 3].map((id) => (session.world.get(id) as unknown as ScenePropComponents).propLight!.on);
  return { session, lit };
}

/** Steps `session` until its clock has run `hours` hours. */
function run(session: ReturnType<typeof street>['session'], hours: number): void {
  const clock = (session.world as unknown as World).query('daytime' as never)[0] as unknown as { daytime: DaytimeComponent }; // prettier-ignore
  const steps = Math.round(hours / clock.daytime.rate / session.world.dt);
  for (let i = 0; i < steps; i++) session.step({});
}

describe('the time of day', () => {
  it('runs the clock at its rate and on past midnight, and holds it at rate 0; set again, it moves', () => {
    const { session } = street('runs', 23, 1); // an hour a second
    run(session, 1.5);
    expect(daytimeOf(session.world)).toBeCloseTo(0.5, 9);
    setDaytime(session.world, { hour: 12 });
    session.step({});
    expect(daytimeOf(session.world)).toBe(12);
    expect(session.world.query('daytime' as never)).toHaveLength(1);
    const empty = createSession(defineScene('lights-test:none', { setup() {} }), { seed: 1 });
    expect(daytimeOf(empty.world)).toBeNull();
  });

  it('puts each group as the hour has it, then switches it as the clock passes dusk and dawn, midnight between', () => {
    const { session, lit } = street('dusk', 18, 0.5); // half an hour a second
    session.step({});
    expect(lit()).toEqual([false, false, false]); // 18:00: before dusk; the porch's lamp from 19:00
    run(session, 0.75); // 18:45
    expect(lit()).toEqual([true, true, false]);
    run(session, 1); // 19:45
    expect(lit()).toEqual([true, true, true]);
    run(session, 4); // 23:45: the porch's rule off at 23:00
    expect(lit()).toEqual([true, true, false]);
    run(session, 7); // 06:45, past midnight and dawn
    expect([daytimeOf(session.world)! < 7, lit()]).toEqual([true, [false, false, false]]);
    const night = street('night', 2, 0);
    night.session.step({});
    expect(night.lit()).toEqual([true, true, false]); // made at 2 am: the street lit from the start
  });

  it("leaves a player's switch alone between the rule's hours", () => {
    const { session, lit } = street('player', 19.5, 0.5);
    session.step({});
    expect(lit()).toEqual([true, true, true]);
    flipSwitch(session.world, 4); // the porch's lamp off by hand at 19:30
    run(session, 2); // 21:30: no hour of its rule passed
    expect(lit()).toEqual([true, true, false]);
  });

  it('keeps the clock and its rules in the hash, and continues exactly from a capture', () => {
    const [a, b] = [street('hash-a', 18, 0.5), street('hash-b', 18, 0.5)];
    run(a.session, 0.25);
    const capture = a.session.capture();
    run(a.session, 1);
    const after = a.session.world.hash();
    a.session.restore(capture);
    run(a.session, 1);
    expect(a.session.world.hash()).toBe(after);
    run(b.session, 1.25);
    expect(b.session.world.hash()).toBe(after);
    setDaytime(b.session.world, { hour: 18, rate: 0.5 });
    expect(b.session.world.hash()).not.toBe(after); // the clock is state
  });

  it('refuses an hour outside the day, a rate below 0 and a rule without a group', () => {
    const { session } = street('bad', 12, 0);
    expect(() => setDaytime(session.world, { hour: 24 })).toThrow(/SIM_BAD_ARGUMENT.*from 0 up to 24/s);
    expect(() => setDaytime(session.world, { hour: 6, rate: -1 })).toThrow(/SIM_BAD_ARGUMENT.*0 or more/s);
    expect(() => lightsAtDusk(session.world, '')).toThrow(/SIM_BAD_ARGUMENT.*light group/s);
    expect(() => lightsAtDusk(session.world, 'street', { on: 25 })).toThrow(/SIM_BAD_ARGUMENT/);
  });

  it('reads the hours a rule lights and the hours the clock passed, through midnight', () => {
    expect([litAt({ on: DUSK, off: DAWN }, 23), litAt({ on: DUSK, off: DAWN }, 3), litAt({ on: DUSK, off: DAWN }, 12)]).toEqual([true, true, false]); // prettier-ignore
    expect([litAt({ on: 9, off: 17 }, 12), litAt({ on: 9, off: 17 }, 17)]).toEqual([true, false]);
    expect([passed(18, 19, DUSK), passed(18.5, 19, DUSK), passed(23.9, 0.1, 0), passed(23.9, 0.1, 12)]).toEqual([true, false, true, false]); // prettier-ignore
  });
});
