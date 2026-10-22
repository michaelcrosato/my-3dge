/**
 * @file Unit tests for the house's fittings (engine/world/props/fittings.ts; WP 13.16), in Node: every registry gets
 * the four, filled; the pane breaks at a hit into glass, its body a thin fixed slab standing on its sill; the switch
 * and the lamp have no body, the lamp's bulb is its one lit part and its light tagged `lamp`; the garage door is
 * kinematic, the sim sliding it; none is knocked by a hit.
 * @see engine/world/props/fittings.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { FITTING_PROPS } from './fittings';
import { propBody } from './place';
import { getProp, propCentre, type PropKnock } from './prop';

const registry = createRegistry();
const PROPS = Object.keys(FITTING_PROPS).map((id) => getProp(id, registry));

describe('the house’s fittings', () => {
  it('makes the pane break at a hit into glass, the garage door kinematic, the switch and the lamp bodiless', () => {
    const rows = PROPS.map((prop) => [prop.id, prop.body.type, prop.health, prop.breaks.shards]);
    expect(rows).toEqual([
      ['prop:pane', 'fixed', 1, 'glass'],
      ['prop:switch', 'none', 0, ''],
      ['prop:lamp', 'none', 0, ''],
      ['prop:garageDoor', 'kinematic', 0, ''],
    ]);
    expect(PROPS.every((prop) => prop.description.length > 0)).toBe(true);
  });

  it('lights the lamp’s bulb while it is on, its light tagged lamp; no other fitting is lit', () => {
    const lit = PROPS.flatMap((prop) => prop.parts.filter((part) => part.lit).map((part) => `${prop.id}/${part.name}`));
    expect(lit).toEqual(['prop:lamp/bulb']);
    expect(PROPS.filter((prop) => prop.light.tag !== '').map((prop) => [prop.id, prop.light.tag])).toEqual([['prop:lamp', 'lamp']]); // prettier-ignore
  });

  it('stands the pane on its sill, 2 cm thick, turned with the wall', () => {
    const pane = propBody({ prop: 'prop:pane', at: [3, 0.9, 1], yaw: Math.PI / 2 }, registry)!;
    expect([pane.type, pane.position, propCentre(getProp('prop:pane', registry))]).toEqual(['fixed', [3, 1.5, 1], 0.6]); // prettier-ignore
    expect(pane.colliders[0].shape).toEqual({ type: 'box', size: [0.5, 1.2, 0.02] });
    expect(propBody({ prop: 'prop:switch', at: [0, 1.2, 0], yaw: 0 }, registry)).toBeNull();
  });

  it('knocks none of them on a hit: the sim breaks the pane (engine/sim/breakables.ts)', () => {
    const knocks: (PropKnock | undefined)[] = [];
    for (const prop of PROPS) prop.hit({ prop, body: 1, from: [-1, 0, 0], knock: (options) => void knocks.push(options) }); // prettier-ignore
    expect(knocks).toEqual([]);
  });
});
