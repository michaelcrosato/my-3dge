/**
 * @file Switches (PLAN.md WP 13.16; docs/PLAYGROUND.md §7.1, §8.2): `addSwitch(w, spec)` puts a switch on a wall (the
 * fittings' `prop:switch`, its plate's foot at `at`, facing `yaw`), with the component `switch`: on or off, and what
 * it switches, a light group (every prop spawned with that `group`: a room's lamps, `spawnProp(…, { group })`) or a
 * door (a sliding one: the garage's, engine/sim/doors.ts). Using it (engine/sim/interact.ts) turns it over: the
 * group's props go on or off (their `propLight.on`, which the view reads: their `lit` parts and lights), the door
 * opens or closes, and every switch of its group with it (two switches on a stairway's lights). The system `switches`
 * (phase `anim`, added with the first switch) holds each group at its switches' state, so the lamps a scene's setup
 * spawns follow it, and one spawned later from the step after it joins. `switchGroup(w, group, on)` sets a group and
 * its switches from a rule (the streetlights at dusk, WP 13.23).
 *
 * Events: `switch` `{ id, on, group, door }`.
 * Invariants: a switch and its group hold the same state from the step after it is made; everything is in
 * components; switches and props in id order.
 * @see engine/sim/switches.test.ts
 */
import type { EventMap } from '../core/events';
import { useDoor } from './doors';
import { defineUsable } from './interact';
import { spawnProp, type ScenePropComponents } from './props';
import { defineComponent } from './state';
import type { World } from './world';

/** What `addSwitch` takes (see the file comment). */
export interface SwitchSpec {
  at: readonly [number, number, number];
  yaw?: number;
  /** The light group it turns on and off (`'room:kitchen'`). */
  group?: string;
  /** The door it opens and closes (an entity of `addDoor`). */
  door?: number;
  /** Whether it starts on (true). */
  on?: boolean;
  /** Its prop (`prop:switch`). */
  prop?: string;
}

/** The component `switch`. */
export interface SwitchComponent {
  on: boolean;
  group: string;
  door: number;
}

type Entity = ScenePropComponents & { id: number; switch?: SwitchComponent };

defineComponent('switch', {
  description: 'A switch (WP 13.16): on or off, and what it switches, a light group or a door.',
  fields: {
    on: { type: 'boolean', default: true, description: 'Whether it is on.' },
    group: { type: 'string', default: '', description: "The light group it switches ('room:kitchen'); '' none." },
    door: { type: 'integer', default: -1, minimum: -1, description: 'The door it opens and closes; −1 none.' },
  },
});

/** Puts a switch on a wall (see the file comment) and returns its entity. */
export function addSwitch<C extends object, E extends EventMap>(world: World<C, E>, spec: SwitchSpec): number {
  const w = world as unknown as World;
  const state = { on: spec.on ?? true, group: spec.group ?? '', door: spec.door ?? -1 };
  const id = spawnProp(w, { prop: spec.prop ?? 'prop:switch', at: spec.at, yaw: spec.yaw ?? 0 }, { components: { switch: state } }); // prettier-ignore
  if (spec.group) setGroup(w, spec.group, state.on);
  if (!w.systems.has('switches')) w.systems.add('switches', holdGroups, { phase: 'anim' });
  return id;
}

/** Turns every prop of light group `group` on or off. */
function setGroup(w: World, group: string, on: boolean): void {
  for (const e of w.query('propLight' as never) as unknown as Entity[]) {
    if (e.propLight!.group === group) e.propLight!.on = on;
  }
}

/** The system `switches`: every switch's group at its state, in id order. */
function holdGroups(w: World): void {
  for (const e of w.query('switch' as never) as unknown as Entity[]) if (e.switch!.group) setGroup(w, e.switch!.group, e.switch!.on); // prettier-ignore
}

/** Turns light group `group` on or off, and its switches with it. */
export function switchGroup<C extends object, E extends EventMap>(
  world: World<C, E>,
  group: string,
  on: boolean,
): void {
  const w = world as unknown as World;
  for (const e of w.query('switch' as never) as unknown as Entity[]) if (e.switch!.group === group) e.switch!.on = on;
  setGroup(w, group, on);
}

/** Turns switch `id` over: its group on or off, its door open or shut. */
export function flipSwitch<C extends object, E extends EventMap>(world: World<C, E>, id: number): void {
  const w = world as unknown as World;
  const state = (w.get(id) as unknown as Entity).switch!;
  if (state.group)
    switchGroup(w, state.group, !state.on); // its group's switches, this one among them
  else state.on = !state.on;
  if (state.door >= 0) {
    const { sceneProp } = w.get(state.door) as unknown as Entity;
    useDoor(w, state.door, [sceneProp.x, sceneProp.y, sceneProp.z]);
  }
  w.emit('switch', { id, on: state.on, group: state.group, door: state.door });
}

defineUsable('switch', {
  prompt: (w, id) => {
    const state = (w.get(id) as unknown as Entity).switch!;
    if (state.door >= 0) return 'Switch';
    return state.on ? 'Lights off' : 'Lights on';
  },
  use: (w, id) => flipSwitch(w, id),
});
