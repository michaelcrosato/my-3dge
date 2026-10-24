/**
 * @file The time of day and the lights it switches (PLAN.md WP 13.23; docs/PLAYGROUND.md §8.2): sim state a scene sets
 * and runs. `setDaytime(w, { hour, rate })` sets the world's clock, the component `daytime` on an entity of its own,
 * one a world: the hour (0 to 24, 12 noon) and how fast it runs (`rate`, hours a sim second; 0, the default, holds
 * it). The system `daytime` (phase `rules`, added with the clock) moves it on by each step, past midnight to 0.
 * `lightsAtDusk(w, group, { on, off })` switches a light group (engine/sim/switches.ts: every prop spawned with that
 * `group`, and its switches) on as the clock passes `on` (`DUSK` by default) and off as it passes `off` (`DAWN`), the
 * component `dusk` on an entity of its own; between the two a player may switch the group by hand, and it stays as he
 * left it until the next. On the step after a rule is made, or the clock set, the system puts the rule's group as the
 * hour has it (`litAt`): what a scene's setup spawns is in the world only once the setup is over.
 * `daytimeOf(w)` reads the hour, null without a clock: the view lights the sky by it (engine/gfx/daylight.ts) and
 * never writes it.
 *
 * Invariants: everything is in components, so the hash, captures and replays hold the clock and its rules; the clock
 * moves by plain addition of `rate · dt`, the same in Node and Chromium; rules switch in id order; no random stream and
 * no event.
 *
 * @example
 * // in a scene's setup: a day in 20 minutes from 5 pm, the street's lamps on at dusk and off at dawn
 * // setDaytime(w, { hour: 17, rate: 24 / (20 * 60) });
 * // lightsAtDusk(w, 'street');
 * litAt({ on: DUSK, off: DAWN }, 23); // true: lit through the night
 * passed(23.9, 0.1, 0); // true: the clock passed midnight
 * @see engine/sim/lights.test.ts
 */
import type { EventMap } from '../core/events';
import { codeError } from '../core/log';
import { defineComponent } from './state';
import { switchGroup } from './switches';
import type { World } from './world';

/** When a rule's lights go on unless it says: dusk, at 18:30 (hours). */
export const DUSK = 18.5;
/** When a rule's lights go off unless it says: dawn, at 06:30 (hours). */
export const DAWN = 6.5;

/** The component `daytime`: the world's clock. */
export interface DaytimeComponent {
  hour: number;
  rate: number;
}

/** The component `dusk`: a light group the clock switches. */
export interface DuskComponent {
  group: string;
  on: number;
  off: number;
  set: boolean;
}

/** An hour's field. */
const hourField = (value: number, description: string) =>
  ({ type: 'number', default: value, minimum: 0, maximum: 24, unit: 'h', description }) as const;

defineComponent('daytime', {
  description: "The world's clock (WP 13.23): the hour of the day and how fast it runs.",
  fields: {
    hour: hourField(12, 'The hour, from 0 up to 24: 12 is noon.'),
    rate: { type: 'number', default: 0, minimum: 0, unit: 'h/s', description: 'How fast it runs, in hours a sim second; 0 holds it.' }, // prettier-ignore
  },
});

defineComponent('dusk', {
  description: 'A light group the clock switches (WP 13.23): on at one hour, off at another.',
  fields: {
    group: { type: 'string', default: '', description: "The light group it switches ('street')." },
    on: hourField(DUSK, 'The hour its lights go on.'),
    off: hourField(DAWN, 'The hour its lights go off.'),
    set: { type: 'boolean', default: false, description: 'Whether its group was put as the hour has it, after it was made or the clock set.' }, // prettier-ignore
  },
});

type Clock = { id: number; daytime: DaytimeComponent };
type Rule = { id: number; dusk: DuskComponent };

/** Whether the clock passed hour `at` going from `from` to `to` (below `from`: it passed midnight on the way). */
export function passed(from: number, to: number, at: number): boolean {
  return to >= from ? from < at && at <= to : from < at || at <= to;
}

/** Whether a rule's lights are on at `hour`: from `on` until `off`, through midnight when `off` comes first. */
export function litAt(rule: Pick<DuskComponent, 'on' | 'off'>, hour: number): boolean {
  return rule.on <= rule.off ? hour >= rule.on && hour < rule.off : hour >= rule.on || hour < rule.off;
}

/** The world's clock, or undefined. */
const clockOf = (w: World) => (w.query('daytime' as never) as unknown as Clock[])[0];

/**
 * The system `daytime`: each rule not yet set puts its group as the hour has it (noon without a clock); then the clock
 * moves on by the step, and each rule whose hour it passed switches its group.
 */
function runClock(w: World): void {
  const clock = clockOf(w)?.daytime;
  const rules = w.query('dusk' as never) as unknown as Rule[];
  for (const { dusk } of rules) {
    if (dusk.set) continue;
    switchGroup(w, dusk.group, litAt(dusk, clock?.hour ?? 12));
    dusk.set = true;
  }
  if (!clock || clock.rate === 0) return;
  const from = clock.hour;
  const to = (from + clock.rate * w.dt) % 24;
  clock.hour = to;
  for (const { dusk } of rules) {
    if (passed(from, to, dusk.on)) switchGroup(w, dusk.group, true);
    if (passed(from, to, dusk.off)) switchGroup(w, dusk.group, false);
  }
}

/** The clock's system, added once. */
function addClock(w: World): void {
  if (!w.systems.has('daytime')) w.systems.add('daytime', runClock);
}

/**
 * Sets the world's clock to `hour` (0 up to 24), running at `rate` hours a sim second (0 holds it), making it the
 * first time (once in a setup: the clock it spawns is in the world after it); the next step puts every rule's group
 * as the hour has it. Returns the clock's entity. Throws `SIM_BAD_ARGUMENT`.
 */
export function setDaytime<C extends object, E extends EventMap>(
  world: World<C, E>,
  spec: { hour: number; rate?: number },
): number {
  const w = world as unknown as World;
  const { hour, rate = 0 } = spec;
  if (!(hour >= 0 && hour < 24)) throw codeError('SIM_BAD_ARGUMENT', { where: 'setDaytime(w, { hour })', value: String(hour), expected: 'an hour from 0 up to 24: 12 is noon, 18.5 half past six in the evening' }); // prettier-ignore
  if (!(rate >= 0 && Number.isFinite(rate))) throw codeError('SIM_BAD_ARGUMENT', { where: 'setDaytime(w, { rate })', value: String(rate), expected: 'hours a sim second, 0 or more: 24 / 1200 passes a day in 20 minutes' }); // prettier-ignore
  addClock(w);
  const clock = clockOf(w);
  const id = clock ? clock.id : w.spawn({ daytime: { hour, rate } } as never);
  if (clock) Object.assign(clock.daytime, { hour, rate });
  for (const { dusk } of w.query('dusk' as never) as unknown as Rule[]) dusk.set = false;
  return id;
}

/** The world's hour (0 up to 24), or null when it has no clock. */
export function daytimeOf<C extends object, E extends EventMap>(world: World<C, E>): number | null {
  return clockOf(world as unknown as World)?.daytime.hour ?? null;
}

/**
 * Switches light group `group` on as the clock passes `on` and off as it passes `off` (hours: dusk and dawn by
 * default); the step after, its group is put as the hour has it. Returns the rule's entity. Throws `SIM_BAD_ARGUMENT`.
 */
export function lightsAtDusk<C extends object, E extends EventMap>(
  world: World<C, E>,
  group: string,
  hours: { on?: number; off?: number } = {},
): number {
  const w = world as unknown as World;
  const rule = { group, on: hours.on ?? DUSK, off: hours.off ?? DAWN };
  if (!group) throw codeError('SIM_BAD_ARGUMENT', { where: 'lightsAtDusk(w, group)', value: "''", expected: "a light group, as its props were spawned with ('street')" }); // prettier-ignore
  for (const [key, hour] of [
    ['on', rule.on],
    ['off', rule.off],
  ] as const) {
    if (!(hour >= 0 && hour < 24)) throw codeError('SIM_BAD_ARGUMENT', { where: `lightsAtDusk(w, group, { ${key} })`, value: String(hour), expected: 'an hour from 0 up to 24' }); // prettier-ignore
  }
  addClock(w);
  return w.spawn({ dusk: rule } as never);
}
